/**
 * Model-free scheduled command jobs.
 *
 * A scheduled task whose prompt is exactly `command-job:<name>` runs the command configured as
 * `<name>` in `<stateDir>/command-jobs.json` instead of starting a provider turn. That host file is
 * the trust anchor: clients can only reference a job, never choose its executable, arguments or
 * launch ceiling. The job names the tasks allowed to run it and the one project it works in, and a
 * task whose own runtime mode is below the launch ceiling cannot run it, so knowing a job's name
 * grants nothing.
 *
 * Each pass writes `input.json` (the workers this job launched and their current state) and runs
 * the executable directly with `T3_JOB_INPUT` / `T3_JOB_OUTPUT` pointing at files, so snapshots and
 * requests of any size never travel through argv or stdout. The output path is new for every pass,
 * so nothing an earlier pass left behind is ever read. Requests are untrusted: each is validated
 * against the job's launch ceiling before anything runs.
 *
 * Launch command ids derive from the job and work id, so the orchestration command receipt is the
 * durable dedupe across retries and crashes. The job's own `receipts.json` records intent before a
 * launch and the thread after it, which lets a restarted pass finish an accepted launch or drop one
 * that never started. This is durable dedupe and recovery, not exactly-once execution of the
 * command itself.
 *
 * A server crash mid-pass cannot leave the job running into the next pass on Windows, where Node
 * starts children in a job object that the system kills with the server. On POSIX the job runs in
 * its own process group and survives a hard crash; no restart reconciliation exists for that yet.
 */
import {
  CommandId,
  MessageId,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderInteractionMode,
  ProjectId,
  RuntimeMode,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import {
  DispatchModeLimit,
  exceededDispatchModeLimit,
} from "../orchestration-v2/DispatchModeLimit.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";

const COMMAND_JOB_PROMPT_PREFIX = "command-job:";
export const COMMAND_JOBS_CONFIG_FILE = "command-jobs.json";
const LOG_LIMIT_BYTES = 64 * 1024;
const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
const RECEIPT_RETENTION = 1000;
const DEFAULT_MAX_LAUNCHES_PER_PASS = 3;
/** Triggers that arrive during a pass coalesce into one follow-up; this bounds the chain. */
const MAX_PASSES_PER_RUN = 3;
/** Run history per worker in each snapshot; older runs are flagged rather than sent. */
const MAX_RUNS_PER_WORKER = 100;
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
]);
const TERMINAL_SUBAGENT_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
/** Interaction mode never limits a job, so ceilings compare runtime mode alone. */
const exceedsRuntimeMode = (ceiling: RuntimeMode, mode: RuntimeMode) =>
  exceededDispatchModeLimit(
    { runtimeMode: ceiling, interactionMode: "default" },
    { runtimeMode: mode, interactionMode: "default" },
  ) !== undefined;
/** Run states after which the job should look at its workers again. */
const WAKE_RUN_STATUSES = new Set([
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
]);

/** The job name a task references, or null for an ordinary agent task. */
export function commandJobName(prompt: string): string | null {
  const trimmed = prompt.trim();
  return trimmed.startsWith(COMMAND_JOB_PROMPT_PREFIX)
    ? trimmed.slice(COMMAND_JOB_PROMPT_PREFIX.length).trim()
    : null;
}

const JobName = /^[A-Za-z0-9_-]{1,64}$/;
const Identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/));
const Branch = Schema.String.check(
  Schema.isPattern(/^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![/.])$/),
);
const MessageText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
);

const LaunchCeiling = Schema.Struct({
  baseRef: TrimmedNonEmptyString,
  branchPrefix: TrimmedNonEmptyString,
  models: Schema.Record(Schema.String, ModelSelection),
  runtimeMode: RuntimeMode,
  maxLaunchesPerPass: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  ),
});
type LaunchCeiling = typeof LaunchCeiling.Type;

const JobConfig = Schema.Struct({
  /** Workers launch here, and only tasks in this project may run the job. */
  projectId: ProjectId,
  taskIds: Schema.Array(ScheduledTaskId).check(Schema.isMinLength(1)),
  executable: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  cwd: TrimmedNonEmptyString,
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 3_600_000 })),
  launch: Schema.optional(LaunchCeiling),
});
type JobConfig = typeof JobConfig.Type;

const ConfigFile = Schema.Struct({ jobs: Schema.Record(Schema.String, JobConfig) });

const LaunchRequest = Schema.Struct({
  type: Schema.Literal("launch"),
  workId: Identifier,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  prompt: MessageText,
  branch: Branch,
  model: Schema.String,
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
type LaunchRequest = typeof LaunchRequest.Type;

const JobRequest = Schema.Union([
  LaunchRequest,
  Schema.Struct({
    type: Schema.Literal("send"),
    workId: Identifier,
    sendId: Identifier,
    text: MessageText,
  }),
  Schema.Struct({ type: Schema.Literal("interrupt"), workId: Identifier }),
]);
type JobRequest = typeof JobRequest.Type;

const OutputFile = Schema.Struct({
  requests: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(100)),
});

/**
 * What a launch was dispatched with, pinned in the intent before dispatch and never changed, so
 * a launch finished after a restart uses it even if the ref or the config moved since. Receipts
 * from before it existed have none.
 */
const LaunchRecord = Schema.Struct({
  resolvedBaseCommit: Schema.String,
  promptSha256: Schema.String,
  /** The settings the thread was created with, not whatever it runs with later. */
  effective: Schema.Struct({
    providerInstanceId: Schema.String,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
  }),
  /** Filled once, when the worker's workspace is ready. */
  worktreePath: Schema.NullOr(Schema.String),
});
type LaunchRecord = typeof LaunchRecord.Type;

const Receipt = Schema.Struct({
  workId: Schema.String,
  taskId: ScheduledTaskId,
  /** Null while the launch is in flight; a restart resolves it against the command receipt. */
  threadId: Schema.NullOr(ThreadId),
  request: LaunchRequest,
  recordedAt: Schema.String,
  launch: Schema.optional(LaunchRecord),
  /** Why an accepted launch could not be finished yet; the intent is kept, not dropped. */
  recoveryError: Schema.optional(Schema.String),
});
type Receipt = typeof Receipt.Type;
const ReceiptsFile = Schema.Struct({ receipts: Schema.Array(Receipt) });

const StatusFile = Schema.Struct({
  rejected: Schema.Array(Schema.Unknown),
});

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(ConfigFile));
const decodeOutput = Schema.decodeUnknownEffect(Schema.fromJsonString(OutputFile));
const decodeReceipts = Schema.decodeUnknownEffect(Schema.fromJsonString(ReceiptsFile));
const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(StatusFile));
const decodeRequest = Schema.decodeUnknownEffect(JobRequest);

export class CommandJobError extends Schema.TaggedError<CommandJobError>()("CommandJobError", {
  operation: Schema.Literals([
    "validate",
    "hash",
    "read",
    "write",
    "decode",
    "prepare",
    "launch",
    "run",
    "dispatch",
  ]),
  job: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason !== undefined) return this.reason;
    const subject = this.job === undefined ? "Command job" : `Command job "${this.job}"`;
    const location = this.path === undefined ? "" : ` at ${this.path}`;
    return `${subject} ${this.operation} failed${location}.`;
  }
}

const fail = (
  reason: string,
  context: Omit<ConstructorParameters<typeof CommandJobError>[0], "reason"> = {
    operation: "validate",
  },
) => Effect.fail(new CommandJobError({ ...context, reason }));

const isoOrNull = (value: DateTime.DateTime | null | undefined) =>
  value == null ? null : DateTime.formatIso(value);

const launchCommandId = (job: string, workId: string) =>
  CommandId.make(`command-job:${job}:${workId}`);

// Strips a UTF-8 BOM and throws on anything else that is not UTF-8, including the UTF-16 that
// Windows PowerShell 5.1 writes by default.
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeTextFile(bytes: Uint8Array): string | null {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

interface PassOutcome {
  readonly launched: Array<string>;
  readonly unchanged: Array<string>;
  readonly rejected: Array<{
    readonly index: number;
    readonly workId?: string;
    readonly reason: string;
  }>;
  readonly failed: Array<{
    readonly index: number;
    readonly workId?: string;
    readonly reason: string;
  }>;
}

export class CommandJobs extends Context.Service<
  CommandJobs,
  {
    readonly run: (input: {
      readonly task: ScheduledTask;
      readonly jobName: string;
    }) => Effect.Effect<void, CommandJobError>;
    /**
     * True when a pass is running and will run once more for this task; false when the caller
     * must start one, including when the task may not run the job, so `run` reports why.
     */
    readonly requestPass: (task: ScheduledTask, jobName: string) => Effect.Effect<boolean>;
    /**
     * Ends a running pass, killing its process tree. Tasks bound to one job share it, so any of
     * them may stop it; a task the job is not bound to cannot.
     */
    readonly stop: (
      task: Pick<ScheduledTask, "id" | "projectId">,
      jobName: string,
    ) => Effect.Effect<void>;
    /** Tasks whose workers changed state while their job was idle. */
    readonly wakeups: Stream.Stream<ScheduledTaskId>;
  }
>()("t3/commandJobs/CommandJobs") {}

export const layer = Layer.effect(
  CommandJobs,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const processes = yield* ProcessRunner.ProcessRunner;
    const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const crypto = yield* Crypto.Crypto;
    const sha256 = (text: string) =>
      crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(
        Effect.map((bytes) =>
          Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
        Effect.mapError((cause) => new CommandJobError({ operation: "hash", cause })),
      );
    const configPath = path.join(stateDir, COMMAND_JOBS_CONFIG_FILE);
    const jobDir = (job: string) => path.join(stateDir, "command-jobs", job);

    // Presence means a pass is running; `dirty` asks it for one more.
    const passes = yield* Ref.make<
      ReadonlyMap<
        string,
        {
          readonly dirty: boolean;
          readonly stop: Deferred.Deferred<void>;
          /** The binding the pass was authorized under, so stopping it needs no file read. */
          readonly config: JobConfig;
        }
      >
    >(new Map());
    const workers = yield* Ref.make<
      ReadonlyMap<ThreadId, { job: string; taskId: ScheduledTaskId }>
    >(new Map());
    const wakeQueue = yield* Queue.unbounded<ScheduledTaskId>();

    const writeJson = (filePath: string, value: unknown) =>
      writeFileStringAtomically({ filePath, contents: `${JSON.stringify(value, null, 2)}\n` }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError(
          (cause) => new CommandJobError({ operation: "write", path: filePath, cause }),
        ),
      );

    const readText = Effect.fn("CommandJobs.readText")(function* (
      filePath: string,
      limit?: number,
    ) {
      if (!(yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false)))) return null;
      if (limit !== undefined) {
        const info = yield* fs
          .stat(filePath)
          .pipe(
            Effect.mapError(
              (cause) => new CommandJobError({ operation: "read", path: filePath, cause }),
            ),
          );
        if (Number(info.size) > limit)
          return yield* fail(`${path.basename(filePath)} is larger than ${limit} bytes.`);
      }
      const bytes = yield* fs
        .readFile(filePath)
        .pipe(
          Effect.mapError(
            (cause) => new CommandJobError({ operation: "read", path: filePath, cause }),
          ),
        );
      const text = decodeTextFile(bytes);
      if (text === null) return yield* fail(`${path.basename(filePath)} must be UTF-8 text.`);
      return text;
    });

    /** The job's host configuration, once `task` is shown to be allowed to run it. */
    const loadJob = Effect.fn("CommandJobs.loadJob")(function* (task: ScheduledTask, job: string) {
      if (!JobName.test(job)) return yield* fail(`Invalid command job name "${job}".`);
      const text = yield* readText(configPath);
      if (text === null) return yield* fail(`No ${COMMAND_JOBS_CONFIG_FILE} on this server.`);
      const config = yield* decodeConfig(text).pipe(
        Effect.mapError(
          (cause) =>
            new CommandJobError({
              operation: "decode",
              path: configPath,
              job,
              cause,
            }),
        ),
      );
      const found = config.jobs[job];
      if (found === undefined) return yield* fail(`Command job "${job}" is not configured.`);
      const refuse = (reason: string) =>
        fail(`Task "${task.id}" may not run command job "${job}": ${reason}`);
      if (!found.taskIds.includes(task.id)) return yield* refuse("it is not in the job's taskIds.");
      if (task.projectId !== found.projectId)
        return yield* refuse(`it is in project "${task.projectId}", not "${found.projectId}".`);
      if (
        found.launch !== undefined &&
        exceedsRuntimeMode(task.runtimeMode, found.launch.runtimeMode)
      )
        return yield* refuse(
          `its runtime mode "${task.runtimeMode}" is below the job's launch ceiling "${found.launch.runtimeMode}".`,
        );
      if (!path.isAbsolute(found.executable) || !path.isAbsolute(found.cwd))
        return yield* fail("A command job's executable and cwd must be absolute paths.");
      const extension = path.extname(found.executable).toLowerCase();
      // Node can only start .cmd/.bat through cmd.exe, which re-parses the arguments.
      if (extension === ".cmd" || extension === ".bat")
        return yield* fail("Command jobs run executables directly; .cmd and .bat need a shell.");
      return found;
    });

    const readReceipts = Effect.fnUntraced(function* (job: string) {
      const text = yield* readText(path.join(jobDir(job), "receipts.json"));
      if (text === null) return [] as ReadonlyArray<Receipt>;
      return (yield* decodeReceipts(text).pipe(
        Effect.mapError(
          (cause) =>
            new CommandJobError({
              operation: "decode",
              job,
              path: path.join(jobDir(job), "receipts.json"),
              cause,
            }),
        ),
      )).receipts;
    });

    const indexWorkers = (job: string, receipts: ReadonlyArray<Receipt>) =>
      Ref.update(workers, (current) => {
        const next = new Map(current);
        for (const receipt of receipts)
          if (receipt.threadId !== null)
            next.set(receipt.threadId, { job, taskId: receipt.taskId });
        return next;
      });

    /** The commit `baseRef` names in the project's repository now, or null if it names none. */
    const resolveBaseCommit = Effect.fn("CommandJobs.resolveBaseCommit")(function* (
      projectId: ProjectId,
      baseRef: string,
    ) {
      const project = yield* projects.getById(projectId).pipe(
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      );
      if (project === null) return null;
      const resolved = yield* processes
        .run({
          command: "git",
          args: ["rev-parse", "--verify", "--quiet", "--end-of-options", `${baseRef}^{commit}`],
          cwd: project.workspaceRoot,
          timeout: 30_000,
          timeoutBehavior: "timedOutResult",
        })
        .pipe(Effect.orElseSucceed(() => null));
      const commit = resolved?.code === 0 ? resolved.stdout.trim() : "";
      return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit) ? commit : null;
    });

    /** Records the worker's worktree path once its workspace is ready; nothing else changes. */
    const observeWorktree = Effect.fn("CommandJobs.observeWorktree")(function* (
      threadId: ThreadId,
      record: LaunchRecord,
      projectId: ProjectId,
    ) {
      if (record.worktreePath !== null) return record;
      const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
      return shell === null || shell.projectId !== projectId || shell.worktreePath === null
        ? record
        : { ...record, worktreePath: shell.worktreePath };
    });

    const workerSnapshot = Effect.fn("CommandJobs.workerSnapshot")(function* (
      receipt: Receipt,
      projectId: ProjectId,
    ) {
      // A failed read is not a missing thread: both leave the worker's state unknown, but only
      // a thread T3 no longer has is reported missing.
      const read =
        receipt.threadId === null
          ? null
          : yield* Effect.result(threads.getThreadShell(receipt.threadId));
      const unreadable = read !== null && read._tag === "Failure";
      const found = read === null || read._tag === "Failure" ? null : read.success;
      // A thread moved to another project is no longer this job's to read.
      const outside = found !== null && found.projectId !== projectId;
      const shell = outside ? null : found;
      const records =
        receipt.threadId === null || shell === null
          ? null
          : yield* threads
              .getThreadRecords(receipt.threadId, ["runs", "subagents"])
              .pipe(Effect.orElseSucceed(() => null));
      const runs = records === null ? [] : [...records.runs].sort((a, b) => a.ordinal - b.ordinal);
      const liveSubagents =
        records === null
          ? null
          : records.subagents.filter((child) => !TERMINAL_SUBAGENT_STATUSES.has(child.status))
              .length;
      return {
        workId: receipt.workId,
        threadId: receipt.threadId,
        title: receipt.request.title,
        model: receipt.request.model,
        recordedAt: receipt.recordedAt,
        receipt:
          receipt.launch === undefined
            ? null
            : {
                prompt: receipt.request.prompt,
                promptSha256: receipt.launch.promptSha256,
                branch: receipt.request.branch,
                resolvedBaseCommit: receipt.launch.resolvedBaseCommit,
                worktreePath: receipt.launch.worktreePath,
                effective: receipt.launch.effective,
              },
        state:
          receipt.threadId === null
            ? "launching"
            : outside
              ? "outside-project"
              : unreadable
                ? "unreadable"
                : shell === null
                  ? "missing"
                  : shell.status,
        pendingRequest: shell?.pendingRuntimeRequest?.kind ?? null,
        lastError: receipt.recoveryError ?? shell?.lastError ?? null,
        branch: shell?.branch ?? receipt.request.branch,
        worktreePath: shell?.worktreePath ?? null,
        latestRunId: shell?.latestRunId ?? null,
        current:
          shell === null
            ? null
            : {
                modelSelection: shell.modelSelection,
                runtimeMode: shell.runtimeMode,
                interactionMode: shell.interactionMode,
              },
        // Per-run runtime and interaction modes are not persisted, so they are not reported.
        runs: runs.slice(-MAX_RUNS_PER_WORKER).map((run) => ({
          id: run.id,
          ordinal: run.ordinal,
          status: run.status,
          providerInstanceId: run.providerInstanceId,
          modelSelection: run.modelSelection,
          requestedAt: isoOrNull(run.requestedAt),
          startedAt: isoOrNull(run.startedAt),
          completedAt: isoOrNull(run.completedAt),
          queuePosition: run.queuePosition ?? null,
          queueHeld: run.queueHeld ?? false,
          restartContinuationOfRunId: run.restartContinuationOfRunId ?? null,
          delegatedTaskId: run.delegatedTaskId ?? null,
        })),
        runsComplete: records !== null && runs.length <= MAX_RUNS_PER_WORKER,
        runCount: records === null ? null : runs.length,
        liveSubagents,
        // Null when the thread cannot be read: unknown, never terminal.
        terminal:
          records === null || shell === null
            ? null
            : runs.length > 0 &&
              runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status)) &&
              shell.pendingRuntimeRequest === null &&
              liveSubagents === 0,
      };
    });

    const runPass = Effect.fn("CommandJobs.runPass")(function* (input: {
      readonly task: ScheduledTask;
      readonly job: string;
      readonly config: JobConfig;
      readonly stop: Deferred.Deferred<void>;
      readonly pass: number;
    }) {
      const { task, job, config, stop } = input;
      const dir = jobDir(job);
      yield* fs
        .makeDirectory(dir, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) => new CommandJobError({ operation: "prepare", job, path: dir, cause }),
          ),
        );
      const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
      const started = yield* DateTime.now;
      const startedAt = DateTime.formatIso(started);
      const nonce = (yield* Random.nextIntBetween(0, 2 ** 31 - 1)).toString(36);
      const runId = `${DateTime.toEpochMillis(started)}-${input.pass}-${nonce}`;
      const inputPath = path.join(dir, "input.json");
      // Never reused, so a file an earlier pass left (or an orphan of it still writes) is never read.
      const outputPath = path.join(dir, `output-${runId}.json`);
      const receiptsPath = path.join(dir, "receipts.json");
      const receipts = new Map(
        (yield* readReceipts(job)).map((receipt) => [receipt.workId, receipt]),
      );
      const saveReceipts = () => {
        const kept = [...receipts.values()];
        const excess = kept.length - RECEIPT_RETENTION;
        return writeJson(receiptsPath, {
          receipts: excess > 0 ? kept.filter((r, i) => r.threadId === null || i >= excess) : kept,
        });
      };
      const outcome: PassOutcome = { launched: [], unchanged: [], rejected: [], failed: [] };
      // Every launch in the pass starts from the commit the ref names now, which is also what the
      // job is shown, so a ref that moves while the job runs cannot change what it launches.
      const baseCommit =
        config.launch === undefined
          ? null
          : yield* resolveBaseCommit(config.projectId, config.launch.baseRef);

      const validateLaunch = Effect.fn("CommandJobs.validateLaunch")(function* (
        request: LaunchRequest,
        ceiling: LaunchCeiling,
        base: string | null,
      ) {
        if (base === null)
          return yield* fail(`Base ref "${ceiling.baseRef}" does not resolve to a commit.`);
        const modelSelection = ceiling.models[request.model];
        if (modelSelection === undefined)
          return yield* fail(`Model "${request.model}" is not allowed.`);
        const runtimeMode = request.runtimeMode ?? ceiling.runtimeMode;
        if (exceedsRuntimeMode(ceiling.runtimeMode, runtimeMode))
          return yield* fail(`Runtime mode "${runtimeMode}" exceeds "${ceiling.runtimeMode}".`);
        if (!request.branch.startsWith(ceiling.branchPrefix))
          return yield* fail(`Branch must start with "${ceiling.branchPrefix}".`);
        const workspaceStrategy = {
          type: "worktree" as const,
          baseRef: base,
          branch: request.branch,
          startFromOrigin: false,
        };
        yield* threadLaunch
          .checkWorktreeBase({ projectId: config.projectId, workspaceStrategy })
          .pipe(
            Effect.mapError(
              (cause) =>
                new CommandJobError({
                  operation: "validate",
                  job,
                  reason: `Base ref "${ceiling.baseRef}" is not in the project.`,
                  cause,
                }),
            ),
          );
        return {
          modelSelection,
          runtimeMode,
          interactionMode: request.interactionMode ?? ("default" as const),
          workspaceStrategy,
        };
      });

      type LaunchSettings = Effect.Success<ReturnType<typeof validateLaunch>>;
      const pinnedLaunch = (request: LaunchRequest, record: LaunchRecord): LaunchSettings => ({
        modelSelection: record.effective.modelSelection,
        runtimeMode: record.effective.runtimeMode,
        interactionMode: record.effective.interactionMode,
        workspaceStrategy: {
          type: "worktree",
          baseRef: record.resolvedBaseCommit,
          branch: request.branch,
          startFromOrigin: false,
        },
      });

      const launch = Effect.fn("CommandJobs.launch")(function* (
        request: LaunchRequest,
        { modelSelection, runtimeMode, interactionMode, workspaceStrategy }: LaunchSettings,
      ) {
        const launched = yield* threadLaunch
          .launch({
            commandId: launchCommandId(job, request.workId),
            projectId: config.projectId,
            title: request.title,
            modelSelection,
            runtimeMode,
            interactionMode,
            workspaceStrategy,
            initialMessage: {
              messageId: MessageId.make(`command-job-message:${job}:${request.workId}`),
              scheduledTaskId: task.id,
              text: request.prompt,
              attachments: [],
            },
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(
            Effect.mapError((cause) => new CommandJobError({ operation: "launch", job, cause })),
          );
        return launched.threadId;
      });

      const readReceipt = (workId: string) =>
        threads
          .hasReceipt(launchCommandId(job, workId))
          .pipe(Effect.mapError((cause) => new CommandJobError({ operation: "read", job, cause })));

      // Launches whose intent was recorded but whose thread was not. Ones the orchestrator never
      // saw are forgotten, so a runner that still wants the work asks again. Accepted ones are
      // finished from what was pinned before dispatch (the replay returns the same thread); if
      // that cannot happen, the intent stays with its error, since the work may exist and no
      // consumer may release its claim.
      for (const receipt of receipts.values()) {
        if (receipt.threadId !== null) continue;
        const accepted = yield* Effect.result(readReceipt(receipt.workId));
        if (accepted._tag === "Failure") {
          receipts.set(receipt.workId, { ...receipt, recoveryError: accepted.failure.message });
          outcome.failed.push({
            index: -1,
            workId: receipt.workId,
            reason: accepted.failure.message,
          });
          continue;
        }
        if (!accepted.success) {
          receipts.delete(receipt.workId);
          continue;
        }
        const ceiling = config.launch;
        const resumed = yield* Effect.result(
          ceiling === undefined
            ? fail(
                "This job no longer has launch permission, so its accepted launch was not finished.",
              )
            : receipt.launch !== undefined
              ? launch(receipt.request, pinnedLaunch(receipt.request, receipt.launch))
              : validateLaunch(receipt.request, ceiling, baseCommit).pipe(
                  Effect.flatMap((valid) => launch(receipt.request, valid)),
                ),
        );
        if (resumed._tag === "Success") {
          const { recoveryError: _recovered, ...rest } = receipt;
          receipts.set(receipt.workId, { ...rest, threadId: resumed.success });
          continue;
        }
        receipts.set(receipt.workId, { ...receipt, recoveryError: resumed.failure.message });
        outcome.failed.push({ index: -1, workId: receipt.workId, reason: resumed.failure.message });
      }
      // A worker's workspace is prepared after its launch returns, so its path lands later.
      for (const receipt of receipts.values()) {
        if (receipt.threadId === null || receipt.launch === undefined) continue;
        receipts.set(receipt.workId, {
          ...receipt,
          launch: yield* observeWorktree(receipt.threadId, receipt.launch, config.projectId),
        });
      }
      yield* saveReceipts();
      yield* indexWorkers(job, [...receipts.values()]);

      const previous = yield* readText(path.join(dir, "status.json")).pipe(
        Effect.flatMap((text) => (text === null ? Effect.succeed(null) : decodeStatus(text))),
        Effect.orElseSucceed(() => null),
      );
      yield* writeJson(inputPath, {
        version: 1,
        job,
        taskId: task.id,
        runId,
        startedAt,
        scope:
          config.launch === undefined
            ? null
            : {
                projectId: config.projectId,
                baseRef: config.launch.baseRef,
                baseCommit,
                branchPrefix: config.launch.branchPrefix,
                runtimeMode: config.launch.runtimeMode,
                models: config.launch.models,
                maxLaunchesPerPass:
                  config.launch.maxLaunchesPerPass ?? DEFAULT_MAX_LAUNCHES_PER_PASS,
              },
        workers: yield* Effect.forEach([...receipts.values()], (receipt) =>
          workerSnapshot(receipt, config.projectId),
        ),
        previousRejected: previous?.rejected ?? [],
      });

      const finished = yield* Effect.raceFirst(
        processes
          .run({
            command: config.executable,
            args: config.args,
            cwd: config.cwd,
            timeout: config.timeoutMs,
            timeoutBehavior: "timedOutResult",
            env: {
              T3_JOB_NAME: job,
              T3_JOB_RUN_ID: runId,
              T3_JOB_INPUT: inputPath,
              T3_JOB_OUTPUT: outputPath,
            },
            maxOutputBytes: LOG_LIMIT_BYTES,
            outputMode: "truncate",
            truncatedMarker: "\n[truncated]\n",
          })
          .pipe(
            Effect.map((result) => ({ _tag: "exited" as const, result })),
            Effect.mapError(
              (cause) =>
                new CommandJobError({ operation: "run", job, path: config.executable, cause }),
            ),
          ),
        Deferred.await(stop).pipe(Effect.as({ _tag: "stopped" as const })),
      );

      const writeStatus = (status: string, error: string | null) =>
        nowIso.pipe(
          Effect.flatMap((finishedAt) =>
            writeJson(path.join(dir, "status.json"), {
              runId,
              taskId: task.id,
              startedAt,
              finishedAt,
              status,
              error,
              exitCode: finished._tag === "exited" ? finished.result.code : null,
              timedOut: finished._tag === "exited" && finished.result.timedOut,
              ...outcome,
            }),
          ),
        );

      if (finished._tag === "exited") {
        const { stdout, stderr } = finished.result;
        yield* fs
          .writeFileString(
            path.join(dir, "last-run.log"),
            `run ${runId} exit ${String(finished.result.code)}\n--- stdout\n${stdout}\n--- stderr\n${stderr}\n`,
          )
          .pipe(Effect.ignore);
      }
      const processError =
        finished._tag === "stopped"
          ? "Stopped."
          : finished.result.timedOut
            ? `Timed out after ${config.timeoutMs}ms.`
            : finished.result.code !== 0
              ? `Exited with code ${String(finished.result.code)}: ${finished.result.stderr.trim().slice(-500)}`
              : null;
      if (processError !== null) {
        yield* fs.remove(outputPath).pipe(Effect.ignore);
        yield* writeStatus("failed", processError);
        return yield* fail(
          finished._tag === "exited" && !finished.result.timedOut
            ? `Exited with code ${String(finished.result.code)}.`
            : processError,
          { operation: "run", job },
        );
      }
      const outputText = yield* Effect.result(readText(outputPath, OUTPUT_LIMIT_BYTES));
      yield* fs.remove(outputPath).pipe(Effect.ignore);
      const output =
        outputText._tag === "Failure"
          ? outputText
          : outputText.success === null
            ? null
            : yield* Effect.result(
                decodeOutput(outputText.success).pipe(
                  Effect.mapError(
                    (cause) =>
                      new CommandJobError({ operation: "decode", job, path: outputPath, cause }),
                  ),
                ),
              );
      if (output !== null && output._tag === "Failure") {
        yield* writeStatus("blocked", output.failure.message);
        return yield* fail(`Blocked: ${output.failure.message}`, {
          operation: "decode",
          job,
          path: outputPath,
          cause: output.failure,
        });
      }

      const requests = output?.success.requests ?? [];
      let launchesLeft = config.launch?.maxLaunchesPerPass ?? DEFAULT_MAX_LAUNCHES_PER_PASS;
      let dispatchFailure: CommandJobError | undefined;
      for (const [index, raw] of requests.entries()) {
        if (yield* Deferred.isDone(stop)) break;
        const decoded = yield* Effect.result(decodeRequest(raw));
        if (decoded._tag === "Failure") {
          // A malformed request still names its work, where it gives one, so a consumer can match it.
          const workId =
            typeof raw === "object" &&
            raw !== null &&
            "workId" in raw &&
            typeof raw.workId === "string"
              ? raw.workId
              : undefined;
          outcome.rejected.push({
            index,
            ...(workId === undefined ? {} : { workId }),
            reason: "Invalid request: the output does not match the request schema.",
          });
          continue;
        }
        const request: JobRequest = decoded.success;
        const reject = (reason: string) =>
          outcome.rejected.push({ index, workId: request.workId, reason });
        const existing = receipts.get(request.workId);
        if (request.type === "launch") {
          const ceiling = config.launch;
          if (ceiling === undefined) {
            reject("This job has no launch permission.");
            continue;
          }
          if (existing !== undefined) {
            outcome.unchanged.push(request.workId);
            continue;
          }
          // Accepted before, but its local receipt is gone (pruned or lost): a fresh intent would
          // claim today's base, model and prompt for a thread launched with others. Its facts
          // are unknown, so this fails, and the work stays claimed until someone reconciles it.
          if (
            yield* readReceipt(request.workId).pipe(
              Effect.tapError((error) => writeStatus("blocked", error.message)),
            )
          ) {
            outcome.failed.push({
              index,
              workId: request.workId,
              reason:
                "This work was launched before but has no local receipt, so its launch facts are unknown; reconcile it before launching again.",
            });
            continue;
          }
          const valid = yield* Effect.result(validateLaunch(request, ceiling, baseCommit));
          if (valid._tag === "Failure") {
            reject(valid.failure.message);
            continue;
          }
          if (launchesLeft === 0) {
            reject("Launch limit for this pass reached.");
            continue;
          }
          launchesLeft -= 1;
          const recordedAt = yield* nowIso;
          const intent: LaunchRecord = {
            resolvedBaseCommit: valid.success.workspaceStrategy.baseRef,
            promptSha256: yield* sha256(request.prompt),
            effective: {
              providerInstanceId: valid.success.modelSelection.instanceId,
              modelSelection: valid.success.modelSelection,
              runtimeMode: valid.success.runtimeMode,
              interactionMode: valid.success.interactionMode,
            },
            worktreePath: null,
          };
          const receipt = {
            workId: request.workId,
            taskId: task.id,
            threadId: null,
            request,
            recordedAt,
            launch: intent,
          };
          receipts.set(request.workId, receipt);
          yield* saveReceipts();
          const launched = yield* Effect.result(launch(request, valid.success));
          if (launched._tag === "Failure") {
            const accepted = yield* Effect.result(readReceipt(request.workId));
            const error = accepted._tag === "Failure" ? accepted.failure : launched.failure;
            if (accepted._tag === "Success" && !accepted.success) {
              receipts.delete(request.workId);
            } else {
              receipts.set(request.workId, { ...receipt, recoveryError: error.message });
            }
            yield* saveReceipts();
            outcome.failed.push({
              index,
              workId: request.workId,
              reason: error.message,
            });
            continue;
          }
          receipts.set(request.workId, {
            workId: request.workId,
            taskId: task.id,
            threadId: launched.success,
            request,
            recordedAt,
            launch: yield* observeWorktree(launched.success, intent, config.projectId),
          });
          yield* saveReceipts();
          yield* indexWorkers(job, [receipts.get(request.workId)!]);
          outcome.launched.push(request.workId);
          continue;
        }
        if (existing?.threadId == null || config.launch === undefined) {
          reject("Only workers this job launched can be messaged or interrupted.");
          continue;
        }
        const threadId = existing.threadId;
        const projectId = config.projectId;
        const limit = {
          runtimeMode: config.launch.runtimeMode,
          interactionMode: "default" as const,
        };
        // A user may have widened the worker since the job launched it, and the config may have
        // tightened; a message would start a turn under whatever the thread has now. Interrupts
        // only stop work, so the job may still halt its own worker after a user widened it.
        if (request.type === "send") {
          const shell = yield* threads
            .getThreadShell(threadId)
            .pipe(Effect.orElseSucceed(() => null));
          const refusal =
            shell === null
              ? "Its thread no longer exists."
              : shell.projectId !== projectId
                ? `Its thread is no longer in project "${projectId}".`
                : exceededDispatchModeLimit(limit, shell) !== undefined
                  ? `Its thread runs in ${shell.runtimeMode} mode, above the job's ${limit.runtimeMode} ceiling.`
                  : !Object.values(config.launch.models).some((model) =>
                        modelSelectionsEqual(model, shell.modelSelection),
                      )
                    ? "Its thread uses a model this job is not configured to launch."
                    : null;
          if (refusal !== null) {
            reject(refusal);
            continue;
          }
        }
        const result = yield* Effect.result<unknown, unknown, never>(
          request.type === "send"
            ? threads
                .sendToThread({
                  projectId,
                  commandId: CommandId.make(
                    `command-job:${job}:${request.workId}:send:${request.sendId}`,
                  ),
                  threadId,
                  messageId: MessageId.make(
                    `command-job-message:${job}:${request.workId}:send:${request.sendId}`,
                  ),
                  scheduledTaskId: task.id,
                  text: request.text,
                  attachments: [],
                  mode: "queue",
                  createdBy: "system",
                  creationSource: "server",
                })
                // Re-checked inside the thread's command lock, so a change after the read above
                // is refused too.
                .pipe(Effect.provideService(DispatchModeLimit, limit))
            : threads.interruptThread({
                projectId,
                commandId: CommandId.make(
                  `command-job:${job}:${request.workId}:interrupt:${runId}`,
                ),
                threadId,
                reason: "Interrupted by its command job.",
              }),
        );
        if (result._tag === "Failure") {
          dispatchFailure = new CommandJobError({
            operation: "dispatch",
            job,
            cause: result.failure,
          });
          outcome.failed.push({ index, workId: request.workId, reason: dispatchFailure.message });
        }
      }

      const problems = [...outcome.rejected, ...outcome.failed];
      if (problems.length === 0) return yield* writeStatus("succeeded", null);
      const first = problems[0]!;
      const message = `Blocked: ${problems.length} of ${requests.length} request(s) not run. ${first.workId ?? `#${first.index}`}: ${first.reason}`;
      yield* writeStatus("blocked", message);
      return yield* fail(message, { operation: "dispatch", job, cause: dispatchFailure });
    });

    const run: CommandJobs["Service"]["run"] = Effect.fn("CommandJobs.run")(function* ({
      task,
      jobName,
    }) {
      const config = yield* loadJob(task, jobName);
      const stop = yield* Deferred.make<void>();
      const claimed = yield* Ref.modify(passes, (current) => {
        const running = current.get(jobName);
        if (running !== undefined)
          return [false, new Map(current).set(jobName, { ...running, dirty: true })] as const;
        return [true, new Map(current).set(jobName, { dirty: false, stop, config })] as const;
      });
      // Another task referencing the same job is mid-pass; it runs once more for this trigger.
      if (!claimed) return;
      yield* Effect.gen(function* () {
        for (let pass = 1; ; pass += 1) {
          const result = yield* Effect.result(runPass({ task, job: jobName, config, stop, pass }));
          const again = yield* Ref.modify(passes, (current) => {
            const state = current.get(jobName);
            const next = new Map(current);
            if (
              state?.dirty === true &&
              pass < MAX_PASSES_PER_RUN &&
              !Deferred.isDoneUnsafe(stop)
            ) {
              next.set(jobName, { ...state, dirty: false });
              return [true, next] as const;
            }
            next.delete(jobName);
            return [false, next] as const;
          });
          if (!again) {
            if (result._tag === "Failure") return yield* Effect.fail(result.failure);
            return;
          }
        }
      }).pipe(
        Effect.ensuring(
          Ref.update(passes, (current) => {
            if (current.get(jobName)?.stop !== stop) return current;
            const next = new Map(current);
            next.delete(jobName);
            return next;
          }),
        ),
      );
    });

    const markDirty = (jobName: string) =>
      Ref.modify(passes, (current) => {
        const running = current.get(jobName);
        if (running === undefined) return [false, current] as const;
        return [true, new Map(current).set(jobName, { ...running, dirty: true })] as const;
      });

    const requestPass: CommandJobs["Service"]["requestPass"] = (task, jobName) =>
      loadJob(task, jobName).pipe(
        Effect.andThen(markDirty(jobName)),
        Effect.orElseSucceed(() => false),
      );

    // Only the binding is checked: a bound task lowered below the launch ceiling can still be
    // paused to stop the job it can no longer start.
    const stop: CommandJobs["Service"]["stop"] = (task, jobName) =>
      Ref.get(passes).pipe(
        Effect.flatMap((current) => {
          const running = current.get(jobName);
          return running === undefined ||
            !running.config.taskIds.includes(task.id) ||
            task.projectId !== running.config.projectId
            ? Effect.void
            : Deferred.succeed(running.stop, undefined);
        }),
        Effect.asVoid,
      );

    // Index existing workers so their completions wake the job after a restart too.
    yield* readText(configPath).pipe(
      Effect.flatMap((text) => (text === null ? Effect.succeed(null) : decodeConfig(text))),
      Effect.flatMap((config) =>
        Effect.forEach(Object.keys(config?.jobs ?? {}), (job) =>
          readReceipts(job).pipe(Effect.flatMap((receipts) => indexWorkers(job, receipts))),
        ),
      ),
      Effect.catch((cause) => Effect.logWarning("Could not index command job workers", { cause })),
    );

    yield* threads.streamDomainEvents.pipe(
      Stream.runForEach((event) =>
        event.type === "run.updated" && WAKE_RUN_STATUSES.has(event.payload.status)
          ? Ref.get(workers).pipe(
              Effect.flatMap((current) => {
                const owner = current.get(event.threadId);
                if (owner === undefined) return Effect.void;
                return markDirty(owner.job).pipe(
                  Effect.flatMap((coalesced) =>
                    coalesced ? Effect.void : Queue.offer(wakeQueue, owner.taskId),
                  ),
                );
              }),
            )
          : Effect.void,
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Command job worker watch stopped", { cause }),
      ),
      Effect.forkScoped,
    );

    return CommandJobs.of({ run, requestPass, stop, wakeups: Stream.fromQueue(wakeQueue) });
  }),
);
