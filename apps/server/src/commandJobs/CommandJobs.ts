/**
 * A task whose prompt is `command-job:<name>` runs `<name>` from the host's command-jobs.json, the
 * trust anchor: clients only name a job its tasks, project and launch ceiling allow. Requests are
 * untrusted; receipts dedupe launches durably (not exactly-once); a raised writer fence stops writes.
 * On POSIX a job survives a hard server crash, and no restart reconciliation exists for that yet.
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
import * as CommandJobFence from "./CommandJobFence.ts";

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
const PassMarker = Schema.Struct({
  runId: Schema.NullOr(Schema.String),
  status: Schema.optional(Schema.String),
});
const decodePassMarker = Schema.decodeUnknownEffect(Schema.fromJsonString(PassMarker));

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(ConfigFile));
const decodeOutput = Schema.decodeUnknownEffect(Schema.fromJsonString(OutputFile));
const decodeReceipts = Schema.decodeUnknownEffect(Schema.fromJsonString(ReceiptsFile));
const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(StatusFile));
const decodeRequest = Schema.decodeUnknownEffect(JobRequest);

export class CommandJobError extends Schema.TaggedError<CommandJobError>()("CommandJobError", {
  message: Schema.String,
}) {}

const fail = (message: string) => Effect.fail(new CommandJobError({ message }));

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

/** A job's launched work as its own receipts record it, with each worker's thread as T3 sees it. */
export interface CommandJobDescription {
  readonly job: string;
  readonly projectId: ProjectId;
  /** The digest of the receipts file the description was read from; null when there is none. */
  readonly receiptsSha256: string | null;
  /**
   * The newest pass that started and how it ended. `unfinished` when it never recorded an end, as
   * a crash leaves it: whatever that pass's own process wrote outside T3 is not known.
   */
  readonly lastPass: { readonly runId: string; readonly status: string } | null;
  readonly workers: ReadonlyArray<{
    readonly workId: string;
    readonly taskId: ScheduledTaskId;
    readonly threadId: ThreadId | null;
    readonly title: string;
    readonly branch: string;
    readonly model: string;
    readonly recordedAt: string;
    readonly promptSha256: string | null;
    readonly resolvedBaseCommit: string | null;
    readonly recoveryError: string | null;
    /** `launching`, `missing`, `unreadable`, `outside-project`, or the thread's status. */
    readonly state: string;
    /** Every run ended, nothing pending, no live subagent; null when it cannot be read. */
    readonly terminal: boolean | null;
    readonly runs: ReadonlyArray<{ readonly id: string; readonly status: string }>;
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
    /** The job's launched work and its workers now, for an owner taking the work over. */
    readonly describe: (jobName: string) => Effect.Effect<CommandJobDescription, CommandJobError>;
    /** Whether a pass of the job is still running, including one a fence already stopped writing. */
    readonly running: (jobName: string) => Effect.Effect<boolean>;
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
    const fence = yield* CommandJobFence.CommandJobFence;
    const crypto = yield* Crypto.Crypto;
    const sha256 = (text: string) =>
      crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(
        Effect.map((bytes) =>
          Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
        Effect.mapError((cause) => new CommandJobError({ message: cause.message })),
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
          (cause) =>
            new CommandJobError({ message: `Could not write ${filePath}: ${cause.message}` }),
        ),
      );

    const readText = Effect.fnUntraced(function* (filePath: string, limit?: number) {
      if (!(yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false)))) return null;
      if (limit !== undefined) {
        const info = yield* fs
          .stat(filePath)
          .pipe(Effect.mapError((cause) => new CommandJobError({ message: cause.message })));
        if (Number(info.size) > limit)
          return yield* fail(`${path.basename(filePath)} is larger than ${limit} bytes.`);
      }
      const bytes = yield* fs
        .readFile(filePath)
        .pipe(Effect.mapError((cause) => new CommandJobError({ message: cause.message })));
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
              message: `Invalid ${COMMAND_JOBS_CONFIG_FILE}: ${cause.message}`,
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
          (cause) => new CommandJobError({ message: `Invalid receipts.json: ${cause.message}` }),
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
    const observeWorktree = Effect.fnUntraced(function* (
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

    const workerSnapshot = Effect.fnUntraced(function* (receipt: Receipt, projectId: ProjectId) {
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
        .pipe(Effect.mapError((cause) => new CommandJobError({ message: cause.message })));
      const writer = yield* fence.current(job).pipe(Effect.orElseSucceed(() => null));
      // An unreadable fence is a raised one: the pass writes nothing it cannot prove it may.
      const fencedNow = fence.current(job).pipe(
        Effect.map(
          (now) =>
            writer === null ||
            writer.holders.length > 0 ||
            now.generation !== writer.generation ||
            now.holders.length > 0,
        ),
        Effect.orElseSucceed(() => true),
      );
      const fencedReason = fence.current(job).pipe(
        Effect.map(
          (now) => `Fenced: ${now.holders.join(", ") || "a native owner"} holds this job's work.`,
        ),
        Effect.orElseSucceed(() => "Fenced: the job's writer fence cannot be read."),
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
      const writeFencedStatus = Effect.fnUntraced(function* () {
        const reason = yield* fencedReason;
        yield* writeJson(path.join(dir, "status.json"), {
          runId,
          taskId: task.id,
          startedAt,
          finishedAt: yield* nowIso,
          status: "fenced",
          error: reason,
          exitCode: null,
          timedOut: false,
          ...outcome,
        });
      });
      // Refused before it wrote its input: status.json keeps describing the last pass that ran.
      if (yield* fencedNow) {
        return yield* writeJson(path.join(dir, "fence.json"), {
          taskId: task.id,
          at: yield* nowIso,
          reason: yield* fencedReason,
        });
      }
      // Every launch in the pass starts from the commit the ref names now, which is also what the
      // job is shown, so a ref that moves while the job runs cannot change what it launches.
      const baseCommit =
        config.launch === undefined
          ? null
          : yield* resolveBaseCommit(config.projectId, config.launch.baseRef);

      const validateLaunch = Effect.fnUntraced(function* (
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
              () =>
                new CommandJobError({
                  message: `Base ref "${ceiling.baseRef}" is not in the project.`,
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

      const launch = Effect.fnUntraced(function* (
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
            Effect.mapError(
              (cause) => new CommandJobError({ message: `Launch failed: ${cause.message}` }),
            ),
          );
        return launched.threadId;
      });

      // Intent recorded without a thread: launches the orchestrator never saw are forgotten (the
      // runner asks again); accepted ones finish from what was pinned before dispatch. If that
      // fails the intent keeps its error: the work may exist and no consumer may release its claim.
      let fenced = yield* fencedNow;
      for (const receipt of receipts.values()) {
        if (receipt.threadId !== null || fenced) continue;
        // An unreadable receipt is not a missing one: the launch may be accepted, so it stays.
        const accepted = yield* Effect.result(
          threads.hasReceipt(launchCommandId(job, receipt.workId)),
        );
        if (accepted._tag === "Failure") {
          const reason = `Its launch receipt could not be read: ${accepted.failure.message}`;
          receipts.set(receipt.workId, { ...receipt, recoveryError: reason });
          outcome.failed.push({ index: -1, workId: receipt.workId, reason });
          continue;
        }
        if (!accepted.success) {
          receipts.delete(receipt.workId);
          continue;
        }
        const ceiling = config.launch;
        fenced = yield* fencedNow;
        if (fenced) continue;
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

      if (fenced || (yield* fencedNow)) return yield* writeFencedStatus();

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
                new CommandJobError({ message: `Could not run the job: ${cause.message}` }),
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
        return yield* fail(processError);
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
                      new CommandJobError({ message: `Invalid output file: ${cause.message}` }),
                  ),
                ),
              );
      if (output !== null && output._tag === "Failure") {
        yield* writeStatus("blocked", output.failure.message);
        return yield* fail(`Blocked: ${output.failure.message}`);
      }

      const requests = output?.success.requests ?? [];
      let launchesLeft = config.launch?.maxLaunchesPerPass ?? DEFAULT_MAX_LAUNCHES_PER_PASS;
      for (const [index, raw] of requests.entries()) {
        if (yield* Deferred.isDone(stop)) break;
        if (yield* fencedNow) {
          const reason = yield* fencedReason;
          for (const [later, rest] of requests.slice(index).entries()) {
            const workId =
              typeof rest === "object" &&
              rest !== null &&
              "workId" in rest &&
              typeof rest.workId === "string"
                ? rest.workId
                : undefined;
            outcome.rejected.push({
              index: index + later,
              ...(workId === undefined ? {} : { workId }),
              reason,
            });
          }
          return yield* writeFencedStatus();
        }
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
            reason: `Invalid request: ${decoded.failure.message}`,
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
          const accepted = yield* Effect.result(
            threads.hasReceipt(launchCommandId(job, request.workId)),
          );
          if (accepted._tag === "Failure") {
            outcome.failed.push({
              index,
              workId: request.workId,
              reason: `Whether this work was launched before is unknown (its receipt could not be read: ${accepted.failure.message}); nothing was launched.`,
            });
            continue;
          }
          if (accepted.success) {
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
          receipts.set(request.workId, {
            workId: request.workId,
            taskId: task.id,
            threadId: null,
            request,
            recordedAt,
            launch: intent,
          });
          yield* saveReceipts();
          const launched = yield* Effect.result(launch(request, valid.success));
          if (launched._tag === "Failure") {
            receipts.delete(request.workId);
            yield* saveReceipts();
            outcome.failed.push({
              index,
              workId: request.workId,
              reason: launched.failure.message,
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
        if (result._tag === "Failure")
          outcome.failed.push({ index, workId: request.workId, reason: String(result.failure) });
      }

      const problems = [...outcome.rejected, ...outcome.failed];
      if (problems.length === 0) return yield* writeStatus("succeeded", null);
      const first = problems[0]!;
      const message = `Blocked: ${problems.length} of ${requests.length} request(s) not run. ${first.workId ?? `#${first.index}`}: ${first.reason}`;
      yield* writeStatus("blocked", message);
      return yield* fail(message);
    });

    const run: CommandJobs["Service"]["run"] = Effect.fn("CommandJobs.run")(function* ({
      task,
      jobName,
    }) {
      const config = yield* loadJob(task, jobName);
      const writer = yield* fence.current(jobName).pipe(Effect.orElseSucceed(() => null));
      if (writer === null || writer.holders.length > 0) {
        yield* fs.makeDirectory(jobDir(jobName), { recursive: true }).pipe(Effect.ignore);
        yield* writeJson(path.join(jobDir(jobName), "fence.json"), {
          taskId: task.id,
          at: DateTime.formatIso(yield* DateTime.now),
          reason:
            writer === null
              ? "Fenced: the job's writer fence cannot be read."
              : `Fenced: ${writer.holders.join(", ")} holds this job's work.`,
        }).pipe(Effect.ignore);
        return;
      }
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
          yield* runPass({ task, job: jobName, config, stop, pass });
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
          if (!again) return;
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

    const describe: CommandJobs["Service"]["describe"] = Effect.fn("CommandJobs.describe")(
      function* (jobName) {
        if (!JobName.test(jobName)) return yield* fail(`Invalid command job name "${jobName}".`);
        const text = yield* readText(configPath);
        if (text === null) return yield* fail(`No ${COMMAND_JOBS_CONFIG_FILE} on this server.`);
        const config = yield* decodeConfig(text).pipe(
          Effect.mapError(
            (cause) =>
              new CommandJobError({
                message: `Invalid ${COMMAND_JOBS_CONFIG_FILE}: ${cause.message}`,
              }),
          ),
        );
        const found = config.jobs[jobName];
        if (found === undefined) return yield* fail(`Command job "${jobName}" is not configured.`);
        const receiptsText = yield* readText(path.join(jobDir(jobName), "receipts.json"));
        const marker = (name: string) =>
          readText(path.join(jobDir(jobName), name)).pipe(
            Effect.flatMap((text) =>
              text === null ? Effect.succeed(null) : decodePassMarker(text),
            ),
            Effect.orElseSucceed(() => null),
          );
        const started = yield* marker("input.json");
        const ended = yield* marker("status.json");
        const lastPass =
          started?.runId == null
            ? null
            : {
                runId: started.runId,
                status: ended?.runId === started.runId ? (ended.status ?? "unknown") : "unfinished",
              };
        const workers = yield* Effect.forEach(yield* readReceipts(jobName), (receipt) =>
          Effect.map(workerSnapshot(receipt, found.projectId), (snapshot) => ({
            workId: receipt.workId,
            taskId: receipt.taskId,
            threadId: receipt.threadId,
            title: receipt.request.title,
            branch: receipt.request.branch,
            model: receipt.request.model,
            recordedAt: receipt.recordedAt,
            promptSha256: receipt.launch?.promptSha256 ?? null,
            resolvedBaseCommit: receipt.launch?.resolvedBaseCommit ?? null,
            recoveryError: receipt.recoveryError ?? null,
            state: snapshot.state,
            terminal: snapshot.terminal,
            runs: snapshot.runs.map((run) => ({ id: run.id, status: run.status })),
          })),
        );
        return {
          job: jobName,
          projectId: found.projectId,
          receiptsSha256: receiptsText === null ? null : yield* sha256(receiptsText),
          lastPass,
          workers,
        };
      },
    );

    const running: CommandJobs["Service"]["running"] = (jobName) =>
      Ref.get(passes).pipe(Effect.map((current) => current.has(jobName)));

    return CommandJobs.of({
      run,
      requestPass,
      stop,
      wakeups: Stream.fromQueue(wakeQueue),
      describe,
      running,
    });
  }),
);
