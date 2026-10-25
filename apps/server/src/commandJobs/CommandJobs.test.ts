import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../config.ts";
import * as DispatchModeLimit from "../orchestration-v2/DispatchModeLimit.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as CommandJobs from "./CommandJobs.ts";

const projectId = ProjectId.make("project:factory");
const windowsHost = HostProcess.Platform.defaultValue() === "win32";
const builder = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

const task: ScheduledTask = {
  id: ScheduledTaskId.make("task:tick"),
  title: "Factory tick",
  prompt: "command-job:tick",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId,
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: builder,
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

/**
 * The job under test: records what it saw, then does what its plan file says. It runs as a real
 * child of the test process, started the same way the server starts a configured job.
 */
const JOB_SCRIPT = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const raw = fs.readFileSync(process.env.T3_JOB_INPUT);
const input = JSON.parse(raw.toString("utf8"));
fs.appendFileSync(plan.log, JSON.stringify({
  argv: process.argv.slice(3),
  runId: process.env.T3_JOB_RUN_ID,
  inputBytes: raw.length,
  workers: input.workers.map((worker) => worker.workId),
  previousRejected: input.previousRejected.length,
  baseCommit: input.scope ? input.scope.baseCommit : null,
}) + "\\n");
// Moves the base ref while the pass is running, before any request reaches the server.
if (plan.moveRef) require("node:child_process").execFileSync("git", ["-C", plan.moveRef, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "--allow-empty", "-q", "-m", "moved"]);
if (plan.pidFile) fs.writeFileSync(plan.pidFile, String(process.pid));
if (plan.grandchild) {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { stdio: "ignore" });
  fs.writeFileSync(plan.grandchild, String(child.pid));
}
if (plan.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, plan.sleepMs);
if (plan.output !== undefined) fs.writeFileSync(process.env.T3_JOB_OUTPUT, Buffer.from(plan.output, "base64"));
if (plan.stderr) process.stderr.write(plan.stderr);
process.exit(plan.exitCode ?? 0);
`;

interface Plan {
  readonly output?: string | Uint8Array;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly sleepMs?: number;
  readonly grandchild?: boolean;
  /** Writes the job's own process id, so a test can find a job a crashed server left behind. */
  readonly pidFile?: boolean;
  /** Commits to the project repository mid-pass, moving its base ref. */
  readonly moveRef?: boolean;
}

const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

interface Calls {
  readonly launches: Array<ThreadLaunchService.ThreadLaunchInput>;
  readonly sends: Array<ThreadManagementService.ThreadManagementSendInput>;
  /** The mode limit each send ran under, which the orchestrator re-checks inside the thread lock. */
  readonly sendLimits: Array<DispatchModeLimit.DispatchModeLimitValue | undefined>;
  readonly interrupts: Array<ThreadManagementService.ThreadManagementInterruptInput>;
}

/** What every worker's thread looks like right now; a test edits it as a user would. */
interface WorkerShell {
  current:
    | "unreadable"
    | {
        projectId: string;
        runtimeMode: string;
        interactionMode: string;
        modelSelection: unknown;
        status: string;
        worktreePath: string | null;
        pendingRuntimeRequest: { kind: string } | null;
      }
    | null;
}

/**
 * A fixture job directory plus the service under test. Thread launch and thread management are
 * the boundary here; `CommandJobs.integration.test.ts` drives the real ones.
 */
const setup = Effect.fn("setup")(function* (options: {
  readonly launch?: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly args?: ReadonlyArray<string>;
  readonly acceptedCommands?: ReadonlySet<string>;
  readonly baseRefMissing?: boolean;
  readonly events?: Queue.Queue<OrchestrationV2DomainEvent>;
  readonly processes?: Layer.Layer<ProcessRunner.ProcessRunner>;
  readonly taskIds?: ReadonlyArray<string>;
  readonly shell?: WorkerShell;
  readonly records?: {
    current: { runs: ReadonlyArray<unknown>; subagents: ReadonlyArray<unknown> };
  };
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "command-jobs-" });
  const stateDir = path.join(root, "userdata");
  const fixtureDir = path.join(root, "fixture");
  yield* fs.makeDirectory(stateDir, { recursive: true });
  yield* fs.makeDirectory(fixtureDir, { recursive: true });
  const script = path.join(fixtureDir, "job.cjs");
  const planPath = path.join(fixtureDir, "plan.json");
  const logPath = path.join(fixtureDir, "runs.ndjson");
  const pidPath = path.join(fixtureDir, "grandchild.pid");
  const jobPidPath = path.join(fixtureDir, "job.pid");
  yield* fs.writeFileString(script, JOB_SCRIPT);
  // The project repository the job's base ref resolves in.
  const repo = path.join(root, "repo");
  yield* fs.makeDirectory(repo, { recursive: true });
  yield* git(repo, "init", "-q", "-b", "main");
  yield* git(repo, "commit", "--allow-empty", "-q", "-m", "base");
  const baseCommit = yield* git(repo, "rev-parse", "HEAD");
  yield* fs.writeFileString(
    path.join(stateDir, CommandJobs.COMMAND_JOBS_CONFIG_FILE),
    JSON.stringify({
      jobs: {
        tick: {
          projectId,
          taskIds: options.taskIds ?? [task.id],
          executable: process.execPath,
          args: [script, planPath, ...(options.args ?? [])],
          cwd: fixtureDir,
          timeoutMs: options.timeoutMs ?? 30_000,
          ...(options.launch === undefined ? {} : { launch: options.launch }),
        },
      },
    }),
  );
  const writePlan = (plan: Plan) =>
    fs.writeFileString(
      planPath,
      JSON.stringify({
        ...plan,
        log: logPath,
        ...(plan.grandchild === true ? { grandchild: pidPath } : {}),
        ...(plan.pidFile === true ? { pidFile: jobPidPath } : {}),
        ...(plan.moveRef === true ? { moveRef: repo } : {}),
        ...(plan.output === undefined
          ? {}
          : {
              output: Buffer.from(
                typeof plan.output === "string"
                  ? new TextEncoder().encode(plan.output)
                  : plan.output,
              ).toString("base64"),
            }),
      }),
    );
  const runs = fs.readFileString(logPath).pipe(
    Effect.map((text) =>
      text
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              argv: Array<string>;
              runId: string;
              inputBytes: number;
              workers: Array<string>;
              previousRejected: number;
              baseCommit: string | null;
            },
        ),
    ),
    Effect.orElseSucceed(() => []),
  );
  const jobFile = (name: string) => path.join(stateDir, "command-jobs", "tick", name);
  const readJson = (name: string) =>
    fs.readFileString(jobFile(name)).pipe(Effect.map((text) => JSON.parse(text)));

  const calls: Calls = { launches: [], sends: [], sendLimits: [], interrupts: [] };
  const layer = CommandJobs.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ServerConfig.ServerConfig, { stateDir } as never),
        options.processes ?? ProcessRunner.layer,
        NodeCrypto.layer,
        Layer.mock(ProjectService.ProjectService)({
          getById: (id) =>
            Effect.succeed(
              id === projectId ? Option.some({ workspaceRoot: repo } as never) : Option.none(),
            ),
        }),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          checkWorktreeBase: () =>
            options.baseRefMissing === true
              ? Effect.fail(
                  new ThreadLaunchService.ThreadLaunchBaseRefError({
                    projectId,
                    projectTitle: "Factory",
                    workspaceRoot: "/repo",
                    baseRef: "main",
                  }),
                )
              : Effect.void,
          // Like the real service, a replayed command id resolves to the thread it created.
          launch: (input) =>
            Effect.sync(() => {
              calls.launches.push(input);
              return {
                threadId: ThreadId.make(`thread:${input.commandId}`),
                resumed: false,
              } as ThreadLaunchService.ThreadLaunchResult;
            }),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: () =>
            options.shell?.current === "unreadable"
              ? Effect.fail(new Error("projection unavailable") as never)
              : Effect.sync(() => (options.shell?.current ?? null) as never),
          getThreadRecords: () =>
            Effect.sync(() => (options.records?.current ?? { runs: [], subagents: [] }) as never),
          hasReceipt: (commandId) =>
            Effect.succeed(options.acceptedCommands?.has(commandId) ?? false),
          sendToThread: (input) =>
            Effect.gen(function* () {
              calls.sends.push(input);
              calls.sendLimits.push(yield* DispatchModeLimit.DispatchModeLimit);
              return {} as ThreadManagementService.ThreadManagementSendResult;
            }),
          interruptThread: (input) =>
            Effect.sync(() => {
              calls.interrupts.push(input);
              return { type: "no_active_run" } as const;
            }),
          streamDomainEvents:
            options.events === undefined ? Stream.never : Stream.fromQueue(options.events),
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  return {
    fs,
    path,
    stateDir,
    fixtureDir,
    repo,
    baseCommit,
    pidPath,
    jobPidPath,
    writePlan,
    runs,
    jobFile,
    readJson,
    calls,
    jobs: Context.get(yield* Layer.build(layer), CommandJobs.CommandJobs),
  };
});

/** Runs git for fixture repositories, returning trimmed stdout. */
const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], {
        cwd,
        stderr: "ignore",
      }),
    );
    const out = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
    yield* child.exitCode;
    return out.trim();
  }).pipe(Effect.scoped, Effect.orDie);

const runJob = (jobs: CommandJobs.CommandJobs["Service"], invoker: Partial<ScheduledTask> = {}) =>
  jobs.run({ task: { ...task, ...invoker }, jobName: "tick" }).pipe(Effect.flip, Effect.option);

const ceiling = {
  baseRef: "main",
  branchPrefix: "factory/",
  models: { builder, reviewer: { instanceId: "claudeAgent", model: "claude-opus-5-5" } },
  runtimeMode: "auto",
};

const launchRequest = (workId: string, extra: Record<string, unknown> = {}) => ({
  type: "launch",
  workId,
  title: `Build ${workId}`,
  prompt: `Implement ${workId}.`,
  branch: `factory/${workId}`,
  model: "builder",
  ...extra,
});

it.live("an idle pass runs the configured executable directly and starts nothing", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ args: ["a & echo injected", "%PATH%", '"quoted"'] });
    yield* fixture.writePlan({});
    const failure = yield* runJob(fixture.jobs);
    assert.isTrue(failure._tag === "None");
    const [run] = yield* fixture.runs;
    // cmd.exe would have expanded %PATH% and split on &; a direct spawn hands them over as is.
    assert.deepEqual(run?.argv, ["a & echo injected", "%PATH%", '"quoted"']);
    assert.match(run?.runId ?? "", /^[0-9]+-1-[0-9a-z]+$/);
    assert.lengthOf(fixture.calls.launches, 0);
    const status = yield* fixture.readJson("status.json");
    assert.equal(status.status, "succeeded");
    assert.equal(status.exitCode, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("snapshots and requests larger than 32KB travel through files, with or without a BOM", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling });
    const receipts = Array.from({ length: 400 }, (_, index) => ({
      workId: `existing-${index}`,
      taskId: task.id,
      threadId: `thread:existing-${index}`,
      request: launchRequest(`existing-${index}`),
      recordedAt: "2026-10-22T00:00:00.000Z",
    }));
    yield* fixture.fs.makeDirectory(fixture.path.dirname(fixture.jobFile("receipts.json")), {
      recursive: true,
    });
    yield* fixture.fs.writeFileString(
      fixture.jobFile("receipts.json"),
      JSON.stringify({ receipts }),
    );
    const prompt = "x".repeat(40_000);
    const body = utf8({ requests: [launchRequest("big", { prompt })] });
    yield* fixture.writePlan({ output: new Uint8Array([0xef, 0xbb, 0xbf, ...body]) });
    const failure = yield* runJob(fixture.jobs);
    assert.isTrue(failure._tag === "None", JSON.stringify(failure));
    const [run] = yield* fixture.runs;
    assert.isAbove(run?.inputBytes ?? 0, 32 * 1024);
    assert.lengthOf(run?.workers ?? [], 400);
    assert.isAbove(body.length, 32 * 1024);
    assert.lengthOf(fixture.calls.launches, 1);
    assert.equal(fixture.calls.launches[0]?.initialMessage?.text, prompt);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("UTF-16 output blocks the job instead of being guessed at", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling });
    const text = JSON.stringify({ requests: [launchRequest("one")] });
    const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Buffer.from(text, "utf16le"))]);
    yield* fixture.writePlan({ output: utf16 });
    const failure = yield* runJob(fixture.jobs);
    assert.match(
      failure._tag === "Some" ? failure.value.message : "",
      /^Blocked: output-[0-9a-z-]+.json must be UTF-8 text.$/,
    );
    assert.lengthOf(fixture.calls.launches, 0);
    assert.equal((yield* fixture.readJson("status.json")).status, "blocked");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("checks every request against the job's ceiling before acting on it", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: { ...ceiling, maxLaunchesPerPass: 2 } });
    yield* fixture.writePlan({
      output: JSON.stringify({
        requests: [
          launchRequest("ok", { runtimeMode: "auto-accept-edits", model: "reviewer" }),
          launchRequest("unknown-model", { model: "frontier" }),
          launchRequest("too-permissive", { runtimeMode: "full-access" }),
          launchRequest("outside-prefix", { branch: "main" }),
          launchRequest("bad id with spaces"),
          { type: "send", workId: "never-launched", sendId: "s1", text: "Hello" },
          { type: "run_shell", command: "rm -rf /" },
          launchRequest("second"),
          launchRequest("over-limit"),
        ],
      }),
    });
    const failure = yield* runJob(fixture.jobs);
    const message = failure._tag === "Some" ? failure.value.message : "";
    assert.match(
      message,
      /^Blocked: 7 of 9 request\(s\) not run\. unknown-model: Model "frontier"/,
    );
    assert.deepEqual(
      fixture.calls.launches.map((launch) => ({
        commandId: String(launch.commandId),
        model: launch.modelSelection.model,
        runtimeMode: launch.runtimeMode,
        workspace: launch.workspaceStrategy,
        projectId: launch.projectId,
      })),
      [
        {
          commandId: "command-job:tick:ok",
          model: "claude-opus-5-5",
          runtimeMode: "auto-accept-edits",
          workspace: {
            type: "worktree",
            baseRef: fixture.baseCommit,
            branch: "factory/ok",
            startFromOrigin: false,
          },
          projectId,
        },
        {
          commandId: "command-job:tick:second",
          model: "gpt-5.4",
          runtimeMode: "auto",
          workspace: {
            type: "worktree",
            baseRef: fixture.baseCommit,
            branch: "factory/second",
            startFromOrigin: false,
          },
          projectId,
        },
      ],
    );
    assert.lengthOf(fixture.calls.sends, 0);
    const status = yield* fixture.readJson("status.json");
    assert.deepEqual(
      status.rejected.map((entry: { reason: string }) => entry.reason.slice(0, 24)),
      [
        'Model "frontier" is not a',
        'Runtime mode "full-access',
        'Branch must start with "f',
        "Invalid request: Expecte",
        "Only workers this job la",
        "Invalid request: Expecte",
        "Launch limit for this pa",
      ].map((reason) => reason.slice(0, 24)),
    );
    // The next pass tells the job what was refused last time.
    yield* fixture.writePlan({});
    yield* runJob(fixture.jobs);
    const [, second] = yield* fixture.runs;
    assert.equal(second?.previousRejected, 7);
    assert.deepEqual(second?.workers, ["ok", "second"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a missing base ref or a job without launch permission blocks the launch", () =>
  Effect.gen(function* () {
    const missingBase = yield* setup({ launch: ceiling, baseRefMissing: true });
    yield* missingBase.writePlan({ output: JSON.stringify({ requests: [launchRequest("one")] }) });
    const baseFailure = yield* runJob(missingBase.jobs);
    assert.match(baseFailure._tag === "Some" ? baseFailure.value.message : "", /Base ref "main"/);
    assert.lengthOf(missingBase.calls.launches, 0);

    const readOnly = yield* setup({});
    yield* readOnly.writePlan({ output: JSON.stringify({ requests: [launchRequest("one")] }) });
    const readOnlyFailure = yield* runJob(readOnly.jobs);
    assert.match(
      readOnlyFailure._tag === "Some" ? readOnlyFailure.value.message : "",
      /no launch permission/,
    );
    assert.lengthOf(readOnly.calls.launches, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a restart finishes launches the orchestrator accepted and forgets ones it never saw", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({
      launch: ceiling,
      acceptedCommands: new Set(["command-job:tick:accepted"]),
    });
    const pending = (workId: string) => ({
      workId,
      taskId: task.id,
      threadId: null,
      request: launchRequest(workId),
      recordedAt: "2026-10-22T00:00:00.000Z",
    });
    yield* fixture.fs.makeDirectory(fixture.path.dirname(fixture.jobFile("receipts.json")), {
      recursive: true,
    });
    yield* fixture.fs.writeFileString(
      fixture.jobFile("receipts.json"),
      JSON.stringify({ receipts: [pending("accepted"), pending("never-started")] }),
    );
    // The job asks again for the accepted work in the same pass; it must not launch twice.
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("accepted")] }) });
    const failure = yield* runJob(fixture.jobs);
    assert.isTrue(failure._tag === "None", JSON.stringify(failure));
    assert.deepEqual(
      fixture.calls.launches.map((launch) => launch.commandId),
      ["command-job:tick:accepted"],
    );
    const [run] = yield* fixture.runs;
    assert.deepEqual(run?.workers, ["accepted"]);
    const { receipts } = yield* fixture.readJson("receipts.json");
    assert.deepEqual(
      receipts.map((receipt: { workId: string; threadId: string | null }) => [
        receipt.workId,
        receipt.threadId,
      ]),
      [["accepted", "thread:command-job:tick:accepted"]],
    );
    assert.deepEqual((yield* fixture.readJson("status.json")).unchanged, ["accepted"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

/** A worker exactly as the job launched it, inside the ceiling. */
const launchedShell = () => ({
  projectId,
  runtimeMode: "auto",
  interactionMode: "default",
  modelSelection: builder,
  status: "completed",
  worktreePath: null,
  pendingRuntimeRequest: null,
});

it.live("messages and interrupts reach only this job's own workers", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling, shell: { current: launchedShell() } });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
    yield* runJob(fixture.jobs);
    yield* fixture.writePlan({
      output: JSON.stringify({
        requests: [
          { type: "send", workId: "w1", sendId: "review-1", text: "Address the review." },
          { type: "interrupt", workId: "w1" },
          { type: "interrupt", workId: "someone-else" },
        ],
      }),
    });
    const failure = yield* runJob(fixture.jobs);
    assert.match(failure._tag === "Some" ? failure.value.message : "", /^Blocked: 1 of 3/);
    assert.deepEqual(
      fixture.calls.sends.map((send) => [send.threadId, send.commandId, send.text, send.mode]),
      [
        [
          "thread:command-job:tick:w1",
          "command-job:tick:w1:send:review-1",
          "Address the review.",
          "queue",
        ],
      ],
    );
    assert.deepEqual(
      fixture.calls.interrupts.map((interrupt) => interrupt.threadId),
      ["thread:command-job:tick:w1"],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a timeout kills the job's whole process tree and is reported", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ timeoutMs: 1_000 });
    yield* fixture.writePlan({ sleepMs: 60_000, grandchild: true });
    const failure = yield* runJob(fixture.jobs);
    assert.equal(failure._tag === "Some" ? failure.value.message : null, "Timed out after 1000ms.");
    const grandchild = Number(yield* fixture.fs.readFileString(fixture.pidPath));
    const alive = (() => {
      try {
        process.kill(grandchild, 0);
        return true;
      } catch {
        return false;
      }
    })();
    if (alive) process.kill(grandchild);
    assert.isFalse(alive, `grandchild ${grandchild} survived the timeout`);
    const status = yield* fixture.readJson("status.json");
    assert.equal(status.status, "failed");
    assert.isTrue(status.timedOut);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a failing exit is visible and its logs stay bounded", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling });
    yield* fixture.writePlan({
      exitCode: 3,
      stderr: `${"noise ".repeat(40_000)}final reason`,
      output: JSON.stringify({ requests: [launchRequest("ignored")] }),
    });
    const failure = yield* runJob(fixture.jobs);
    const message = failure._tag === "Some" ? failure.value.message : "";
    assert.match(message, /^Exited with code 3: /);
    assert.isAtMost(message.length, 540);
    // Requests from a failed run are never acted on.
    assert.lengthOf(fixture.calls.launches, 0);
    const log = yield* fixture.fs.stat(fixture.jobFile("last-run.log"));
    assert.isBelow(Number(log.size), 3 * 64 * 1024);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

/** Stands in for the process so a test can hold a pass open. */
const gatedProcesses = Effect.gen(function* () {
  const started = yield* Queue.unbounded<number>();
  const release = yield* Deferred.make<void>();
  const interrupted = yield* Deferred.make<void>();
  const count = yield* Ref.make(0);
  const layer = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: () =>
      Ref.updateAndGet(count, (n) => n + 1).pipe(
        Effect.tap((n) => Queue.offer(started, n)),
        Effect.andThen(Deferred.await(release)),
        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        Effect.as({
          stdout: "",
          stderr: "",
          code: 0 as never,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        }),
      ),
  });
  return { started, release, interrupted, count, layer };
});

it.live("triggers during a pass coalesce into one follow-up pass", () =>
  Effect.gen(function* () {
    const gate = yield* gatedProcesses;
    const fixture = yield* setup({ processes: gate.layer, taskIds: [task.id, "task:other"] });
    const first = yield* fixture.jobs.run({ task, jobName: "tick" }).pipe(Effect.forkChild);
    assert.equal(yield* Queue.take(gate.started), 1);
    // A second task on the same job, a worker completion and a manual run all land mid-pass.
    yield* fixture.jobs.run({
      task: { ...task, id: ScheduledTaskId.make("task:other") },
      jobName: "tick",
    });
    assert.isTrue(yield* fixture.jobs.requestPass(task, "tick"));
    assert.isTrue(yield* fixture.jobs.requestPass(task, "tick"));
    // A task the job is not bound to neither coalesces nor runs.
    const unbound = { ...task, id: ScheduledTaskId.make("task:not-bound") };
    assert.isFalse(yield* fixture.jobs.requestPass(unbound, "tick"));
    assert.isTrue((yield* runJob(fixture.jobs, unbound))._tag === "Some");
    yield* Deferred.succeed(gate.release, undefined);
    yield* Fiber.join(first);
    assert.equal(yield* Ref.get(gate.count), 2);
    // Idle again: nothing is running to coalesce into.
    assert.isFalse(yield* fixture.jobs.requestPass(task, "tick"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("stop ends a running pass and interrupts its process", () =>
  Effect.gen(function* () {
    const gate = yield* gatedProcesses;
    const fixture = yield* setup({ processes: gate.layer });
    const running = yield* runJob(fixture.jobs).pipe(Effect.forkChild);
    yield* Queue.take(gate.started);
    yield* fixture.jobs.requestPass(task, "tick");
    yield* fixture.jobs.stop(task, "tick");
    const failure = yield* Fiber.join(running);
    assert.equal(failure._tag === "Some" ? failure.value.message : null, "Stopped.");
    yield* Deferred.await(gate.interrupted);
    // A stop is not overridden by a pending follow-up.
    assert.equal(yield* Ref.get(gate.count), 1);
    assert.equal((yield* fixture.readJson("status.json")).status, "failed");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a worker finishing wakes its idle job's task", () =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const fixture = yield* setup({ launch: ceiling, events });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
    yield* runJob(fixture.jobs);
    const wakeup = yield* fixture.jobs.wakeups.pipe(Stream.runHead, Effect.forkChild);
    const runUpdated = (threadId: string, status: string) =>
      ({
        type: "run.updated",
        threadId,
        payload: { status },
      }) as unknown as OrchestrationV2DomainEvent;
    yield* Queue.offer(events, runUpdated("thread:unrelated", "completed"));
    yield* Queue.offer(events, runUpdated("thread:command-job:tick:w1", "running"));
    yield* Queue.offer(events, runUpdated("thread:command-job:tick:w1", "completed"));
    const woken = yield* Fiber.join(wakeup);
    assert.deepEqual(woken._tag === "Some" ? woken.value : null, task.id);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("references a job only by an exact prompt prefix", () => {
  assert.equal(CommandJobs.commandJobName("command-job:tick"), "tick");
  assert.equal(CommandJobs.commandJobName("  command-job: tick \n"), "tick");
  assert.isNull(CommandJobs.commandJobName("Run command-job:tick"));
  assert.isNull(CommandJobs.commandJobName("Audit the repo."));
});

it.live("only a bound task in the job's project with an adequate ceiling can run it", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
    for (const invoker of [
      { projectId: ProjectId.make("project:unrelated") },
      { runtimeMode: "approval-required" as const },
      { id: ScheduledTaskId.make("task:not-bound") },
    ]) {
      const failure = yield* runJob(fixture.jobs, invoker);
      assert.match(
        failure._tag === "Some" ? failure.value.message : "",
        /may not run command job "tick"/,
        JSON.stringify(invoker),
      );
    }
    // Refused before the command ran or anything launched.
    assert.lengthOf(yield* fixture.runs, 0);
    assert.lengthOf(fixture.calls.launches, 0);
    // A refused task cannot add a pass to a running one either.
    assert.isFalse(
      yield* fixture.jobs.requestPass(
        { ...task, id: ScheduledTaskId.make("task:not-bound") },
        "tick",
      ),
    );

    const allowed = yield* runJob(fixture.jobs, { runtimeMode: "auto" });
    assert.isTrue(allowed._tag === "None", JSON.stringify(allowed));
    assert.lengthOf(fixture.calls.launches, 1);
    assert.equal(fixture.calls.launches[0]?.projectId, projectId);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a pass that writes no output acts on nothing, even after one that did", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("fresh")] }) });
    yield* runJob(fixture.jobs);
    yield* fixture.writePlan({});
    const quiet = yield* runJob(fixture.jobs);
    assert.isTrue(quiet._tag === "None", JSON.stringify(quiet));
    assert.deepEqual(
      fixture.calls.launches.map((launch) => String(launch.commandId)),
      ["command-job:tick:fresh"],
    );
    assert.deepEqual((yield* fixture.readJson("status.json")).unchanged, []);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// Holding a file open without delete sharing is how Windows makes a removal fail.
it.live.runIf(windowsHost)(
  "output left behind by an earlier pass is never acted on, even when it cannot be removed",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ launch: ceiling });
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      yield* fixture.fs.makeDirectory(fixture.path.dirname(fixture.jobFile("x")), {
        recursive: true,
      });
      const stale = fixture.jobFile("output.json");
      yield* fixture.fs.writeFileString(
        stale,
        JSON.stringify({ requests: [launchRequest("stale")] }),
      );
      const holder = yield* spawner.spawn(
        ChildProcess.make(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$f = [IO.File]::Open('${stale.replaceAll("'", "''")}', 'Open', 'Read', 'Read'); 'held'; Start-Sleep -Seconds 120`,
          ],
          { stderr: "ignore" },
        ),
      );
      const held = yield* holder.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runHead,
      );
      assert.equal(Option.getOrNull(held), "held");
      const removal = yield* Effect.result(fixture.fs.remove(stale));
      assert.isTrue(removal._tag === "Failure", "the held file should not be removable");

      yield* fixture.writePlan({});
      const failure = yield* runJob(fixture.jobs);
      assert.isTrue(failure._tag === "None", JSON.stringify(failure));
      assert.lengthOf(fixture.calls.launches, 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Resolves once `file` exists, woken by directory events rather than polling. */
const awaitFile = (fs: FileSystem.FileSystem, dir: string, file: string) =>
  Stream.concat(Stream.make(undefined), fs.watch(dir)).pipe(
    Stream.mapEffect(() => fs.exists(file)),
    Stream.filter((exists) => exists),
    Stream.runHead,
  );

// The proof is platform behaviour: Node puts every child it starts on Windows in a job object that
// the system closes, killing the children, when the parent dies however it dies. A POSIX child
// runs in its own process group and outlives a crashed server; see CommandJobs.ts.
it.live.runIf(windowsHost)(
  "a hard server crash ends its running job, so the restarted server's pass never overlaps it",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup({});
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const harness = yield* fixture.path.fromFileUrl(
        new URL("../provider/testFixtures/command-job-crash-harness.mjs", import.meta.url),
      );
      yield* fixture.writePlan({ sleepMs: 120_000, pidFile: true });
      const server = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [harness, fixture.stateDir, JSON.stringify(task)], {
          stdout: "ignore",
          stderr: "ignore",
        }),
      );
      yield* awaitFile(fixture.fs, fixture.fixtureDir, fixture.jobPidPath);
      const job = Number(yield* fixture.fs.readFileString(fixture.jobPidPath));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (isAlive(job)) process.kill(job);
        }),
      );
      assert.isTrue(isAlive(job), "the job should be mid-pass");
      // TerminateProcess: the server runs none of its own shutdown code.
      process.kill(server.pid);
      yield* server.exitCode.pipe(Effect.ignore);
      assert.isFalse(isAlive(job), `job ${job} outlived the crashed server`);

      yield* fixture.writePlan({});
      const failure = yield* runJob(fixture.jobs);
      assert.isTrue(failure._tag === "None", JSON.stringify(failure));
      assert.lengthOf(yield* fixture.runs, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a message reaches a worker only while it is still inside the job's ceiling", () =>
  Effect.gen(function* () {
    const shell: WorkerShell = { current: launchedShell() };
    const fixture = yield* setup({ launch: ceiling, shell });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
    yield* runJob(fixture.jobs);
    const send = (sendId: string) =>
      fixture
        .writePlan({
          output: JSON.stringify({
            requests: [{ type: "send", workId: "w1", sendId, text: "Next step." }],
          }),
        })
        .pipe(Effect.andThen(runJob(fixture.jobs)));
    const refusal = (failure: Option.Option<CommandJobs.CommandJobError>) =>
      failure._tag === "Some" ? failure.value.message : "sent";

    assert.equal(refusal(yield* send("unchanged")), "sent");
    // The orchestrator re-checks the worker's modes against this under the thread's lock.
    assert.deepEqual(fixture.calls.sendLimits, [
      { runtimeMode: "auto", interactionMode: "default" },
    ]);
    // Another model the job is configured to use is still inside the ceiling.
    shell.current = { ...launchedShell(), modelSelection: ceiling.models.reviewer };
    assert.equal(refusal(yield* send("reviewer")), "sent");

    // A user later raised the worker's mode, moved it to another model, or another project.
    shell.current = { ...launchedShell(), runtimeMode: "full-access" };
    assert.match(refusal(yield* send("raised")), /runs in full-access mode, above the job's auto/);
    shell.current = {
      ...launchedShell(),
      modelSelection: { ...builder, options: [{ id: "fastMode", value: true }] },
    };
    assert.match(refusal(yield* send("other-options")), /uses a model this job is not configured/);
    shell.current = { ...launchedShell(), projectId: "project:elsewhere" };
    assert.match(refusal(yield* send("moved")), /is no longer in project/);
    shell.current = null;
    assert.match(refusal(yield* send("deleted")), /no longer exists/);
    assert.deepEqual(
      fixture.calls.sends.map((sent) => String(sent.commandId).split(":").at(-1)),
      ["unchanged", "reviewer"],
    );

    // Interrupting only ever stops work, so the job may still halt a worker a user widened.
    shell.current = { ...launchedShell(), runtimeMode: "full-access" };
    yield* fixture.writePlan({
      output: JSON.stringify({ requests: [{ type: "interrupt", workId: "w1" }] }),
    });
    assert.equal(refusal(yield* runJob(fixture.jobs)), "sent");
    assert.lengthOf(fixture.calls.interrupts, 1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("only a task bound to the job can stop its running pass", () =>
  Effect.gen(function* () {
    const gate = yield* gatedProcesses;
    const fixture = yield* setup({ processes: gate.layer, taskIds: [task.id, "task:shared"] });
    const running = yield* runJob(fixture.jobs).pipe(Effect.forkChild);
    yield* Queue.take(gate.started);
    yield* fixture.jobs.stop({ ...task, id: ScheduledTaskId.make("task:not-bound") }, "tick");
    yield* fixture.jobs.stop(
      { ...task, id: ScheduledTaskId.make("task:shared"), projectId: ProjectId.make("project:x") },
      "tick",
    );
    assert.isTrue(yield* fixture.jobs.requestPass(task, "tick"), "the pass should still run");
    // Bound tasks share the job, so any of them may stop it.
    yield* fixture.jobs.stop({ ...task, id: ScheduledTaskId.make("task:shared") }, "tick");
    const failure = yield* Fiber.join(running);
    assert.equal(failure._tag === "Some" ? failure.value.message : null, "Stopped.");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const reviewerSelection = { instanceId: "claudeAgent", model: "claude-opus-5-5" };
const PROMPT_W1_SHA256 = "3bb89f4b3a5950e1882fb0967850410c8408bc5c2e16e23fbb23ac81a6f14700";

const writeReceipts = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  receipts: ReadonlyArray<unknown>,
) =>
  fixture.fs
    .makeDirectory(fixture.path.dirname(fixture.jobFile("receipts.json")), { recursive: true })
    .pipe(
      Effect.andThen(
        fixture.fs.writeFileString(fixture.jobFile("receipts.json"), JSON.stringify({ receipts })),
      ),
    );

it.live(
  "every launch in a pass starts from the commit its base ref named when the pass began",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ launch: ceiling });
      // The ref moves while the job runs, before its launch request reaches the server.
      yield* fixture.writePlan({
        moveRef: true,
        output: JSON.stringify({ requests: [launchRequest("w1")] }),
      });
      const failure = yield* runJob(fixture.jobs);
      assert.isTrue(failure._tag === "None", JSON.stringify(failure));
      const moved = yield* git(fixture.repo, "rev-parse", "HEAD");
      assert.notEqual(moved, fixture.baseCommit);

      const [run] = yield* fixture.runs;
      assert.equal(run?.baseCommit, fixture.baseCommit, "the job is shown the pass's base");
      assert.deepEqual(fixture.calls.launches[0]?.workspaceStrategy, {
        type: "worktree",
        baseRef: fixture.baseCommit,
        branch: "factory/w1",
        startFromOrigin: false,
      });
      const { receipts } = yield* fixture.readJson("receipts.json");
      assert.deepEqual(receipts[0].launch, {
        resolvedBaseCommit: fixture.baseCommit,
        promptSha256: PROMPT_W1_SHA256,
        effective: {
          providerInstanceId: "codex",
          modelSelection: builder,
          runtimeMode: "auto",
          interactionMode: "default",
        },
        worktreePath: null,
      });

      // The next pass shows the moved ref as its base, and the worker's receipt as launched.
      yield* fixture.writePlan({});
      yield* runJob(fixture.jobs);
      const input = yield* fixture.readJson("input.json");
      assert.equal(input.scope.baseCommit, moved);
      assert.deepEqual(input.workers[0].receipt, {
        prompt: "Implement w1.",
        promptSha256: PROMPT_W1_SHA256,
        branch: "factory/w1",
        resolvedBaseCommit: fixture.baseCommit,
        worktreePath: null,
        effective: receipts[0].launch.effective,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a launch accepted before a crash is finished from what was pinned, not today's ref", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({
      launch: ceiling,
      acceptedCommands: new Set(["command-job:tick:w1"]),
    });
    const pinned = {
      resolvedBaseCommit: fixture.baseCommit,
      promptSha256: PROMPT_W1_SHA256,
      effective: {
        providerInstanceId: "claudeAgent",
        modelSelection: reviewerSelection,
        runtimeMode: "auto-accept-edits",
        interactionMode: "plan",
      },
      worktreePath: null,
    };
    yield* writeReceipts(fixture, [
      {
        workId: "w1",
        taskId: task.id,
        threadId: null,
        request: launchRequest("w1"),
        recordedAt: "2026-10-22T00:00:00.000Z",
        launch: pinned,
      },
    ]);
    // Since the crash the ref moved; the request alone would now mean another base and model.
    yield* git(fixture.repo, "commit", "--allow-empty", "-q", "-m", "moved");
    yield* fixture.writePlan({});
    const failure = yield* runJob(fixture.jobs);
    assert.isTrue(failure._tag === "None", JSON.stringify(failure));
    const replay = fixture.calls.launches[0];
    assert.equal(String(replay?.commandId), "command-job:tick:w1");
    assert.deepEqual(replay?.workspaceStrategy, {
      type: "worktree",
      baseRef: fixture.baseCommit,
      branch: "factory/w1",
      startFromOrigin: false,
    });
    assert.deepEqual(replay?.modelSelection, reviewerSelection);
    assert.equal(replay?.runtimeMode, "auto-accept-edits");
    assert.equal(replay?.interactionMode, "plan");
    const { receipts } = yield* fixture.readJson("receipts.json");
    assert.equal(receipts[0].threadId, "thread:command-job:tick:w1");
    assert.deepEqual(receipts[0].launch, pinned);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("an accepted launch that cannot be finished is kept with its error, never dropped", () =>
  Effect.gen(function* () {
    // The job's launch permission was removed after the orchestrator accepted the launch.
    const fixture = yield* setup({ acceptedCommands: new Set(["command-job:tick:w1"]) });
    yield* writeReceipts(fixture, [
      {
        workId: "w1",
        taskId: task.id,
        threadId: null,
        request: launchRequest("w1"),
        recordedAt: "2026-10-22T00:00:00.000Z",
      },
    ]);
    yield* fixture.writePlan({});
    const failure = yield* runJob(fixture.jobs);
    assert.match(
      failure._tag === "Some" ? failure.value.message : "",
      /^Blocked: .*no longer has launch permission/,
    );
    assert.lengthOf(fixture.calls.launches, 0);
    const { receipts } = yield* fixture.readJson("receipts.json");
    assert.equal(receipts[0].threadId, null);
    assert.match(receipts[0].recoveryError, /no longer has launch permission/);
    const input = yield* fixture.readJson("input.json");
    assert.equal(input.workers[0].state, "launching");
    assert.match(input.workers[0].lastError, /no longer has launch permission/);
    assert.isNull(input.workers[0].terminal);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const at = (iso: string) => DateTime.makeUnsafe(iso);
const runRecord = (ordinal: number, status: string, model: unknown = builder) => ({
  id: `run:${ordinal}`,
  threadId: "thread:command-job:tick:w1",
  ordinal,
  providerInstanceId: (model as { instanceId: string }).instanceId,
  modelSelection: model,
  status,
  queuePosition: status === "queued" ? 1 : null,
  queueHeld: false,
  requestedAt: at("2026-10-22T10:00:00.000Z"),
  startedAt: status === "queued" ? null : at("2026-10-22T10:00:01.000Z"),
  completedAt: status === "completed" ? at("2026-10-22T10:05:00.000Z") : null,
});

it.live("each worker's run history, liveness and terminal state are reported as recorded", () =>
  Effect.gen(function* () {
    const shell: WorkerShell = { current: { ...launchedShell(), worktreePath: "C:/wt/w1" } };
    const records: {
      current: { runs: ReadonlyArray<unknown>; subagents: ReadonlyArray<unknown> };
    } = {
      current: {
        runs: [runRecord(2, "queued", reviewerSelection), runRecord(1, "completed")],
        subagents: [{ status: "running" }],
      },
    };
    const fixture = yield* setup({ launch: ceiling, shell, records });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
    yield* runJob(fixture.jobs);
    const nextWorker = fixture.writePlan({}).pipe(
      Effect.andThen(runJob(fixture.jobs)),
      Effect.andThen(fixture.readJson("input.json")),
      Effect.map((input) => input.workers[0]),
    );

    let worker = yield* nextWorker;
    assert.deepEqual(
      worker.runs.map((run: { ordinal: number; status: string; modelSelection: unknown }) => [
        run.ordinal,
        run.status,
        run.modelSelection,
      ]),
      [
        [1, "completed", builder],
        [2, "queued", reviewerSelection],
      ],
    );
    assert.deepEqual(worker.runs[0], {
      id: "run:1",
      ordinal: 1,
      status: "completed",
      providerInstanceId: "codex",
      modelSelection: builder,
      requestedAt: "2026-10-22T10:00:00.000Z",
      startedAt: "2026-10-22T10:00:01.000Z",
      completedAt: "2026-10-22T10:05:00.000Z",
      queuePosition: null,
      queueHeld: false,
      restartContinuationOfRunId: null,
      delegatedTaskId: null,
    });
    // No mode is reported per run: T3 does not persist one.
    assert.notProperty(worker.runs[0], "runtimeMode");
    assert.isTrue(worker.runsComplete);
    assert.equal(worker.runCount, 2);
    assert.equal(worker.liveSubagents, 1);
    assert.isFalse(worker.terminal, "a queued run and a live child are not terminal");
    assert.equal(worker.receipt.worktreePath, "C:/wt/w1", "recorded once the workspace exists");

    records.current = {
      runs: [runRecord(1, "completed"), runRecord(2, "completed")],
      subagents: [{ status: "completed" }],
    };
    worker = yield* nextWorker;
    assert.isTrue(worker.terminal);

    records.current = {
      runs: Array.from({ length: 101 }, (_, index) => runRecord(index + 1, "completed")),
      subagents: [],
    };
    worker = yield* nextWorker;
    assert.isFalse(worker.runsComplete);
    assert.equal(worker.runCount, 101);
    assert.lengthOf(worker.runs, 100);
    assert.equal(worker.runs[0].ordinal, 2, "the newest 100 runs are kept");

    // The recorded worktree never changes, and a thread moved out of the project reads as unknown.
    shell.current = {
      ...launchedShell(),
      worktreePath: "C:/elsewhere",
      projectId: "project:other",
    };
    worker = yield* nextWorker;
    assert.equal(worker.state, "outside-project");
    assert.deepEqual(worker.runs, []);
    assert.isNull(worker.runCount);
    assert.isNull(worker.terminal);
    assert.isNull(worker.current);
    assert.isNull(worker.worktreePath);
    assert.equal(worker.receipt.worktreePath, "C:/wt/w1");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "a receipt from before launch facts existed reports them as unknown, never back-filled",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ launch: ceiling, shell: { current: launchedShell() } });
      yield* writeReceipts(fixture, [
        {
          workId: "old",
          taskId: task.id,
          threadId: "thread:old",
          request: launchRequest("old"),
          recordedAt: "2026-10-21T00:00:00.000Z",
        },
      ]);
      yield* fixture.writePlan({});
      yield* runJob(fixture.jobs);
      const input = yield* fixture.readJson("input.json");
      assert.isNull(input.workers[0].receipt);
      const { receipts } = yield* fixture.readJson("receipts.json");
      assert.notProperty(receipts[0], "launch");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a malformed launch is still reported against the work it names", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ launch: ceiling });
    yield* fixture.writePlan({
      output: JSON.stringify({ requests: [{ type: "launch", workId: "w-bad" }] }),
    });
    yield* runJob(fixture.jobs);
    const status = yield* fixture.readJson("status.json");
    assert.equal(status.rejected[0].workId, "w-bad");
    assert.match(status.rejected[0].reason, /^Invalid request/);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("a worker whose thread cannot be read is unknown, not missing and never terminal", () =>
  Effect.gen(function* () {
    const shell: WorkerShell = { current: launchedShell() };
    const fixture = yield* setup({ launch: ceiling, shell });
    yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
    yield* runJob(fixture.jobs);
    shell.current = "unreadable";
    yield* fixture.writePlan({});
    yield* runJob(fixture.jobs);
    const worker = (yield* fixture.readJson("input.json")).workers[0];
    assert.equal(worker.state, "unreadable");
    assert.isNull(worker.terminal);
    assert.isNull(worker.runCount);
    assert.isFalse(worker.runsComplete);
    // Gone from T3 entirely reads differently.
    shell.current = null;
    yield* runJob(fixture.jobs);
    const gone = (yield* fixture.readJson("input.json")).workers[0];
    assert.equal(gone.state, "missing");
    assert.isNull(gone.terminal);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "work launched before whose receipt is gone fails instead of getting new launch facts",
  () =>
    Effect.gen(function* () {
      // The orchestrator accepted this launch long ago; the job's receipt was pruned or lost.
      const fixture = yield* setup({
        launch: ceiling,
        acceptedCommands: new Set(["command-job:tick:w1"]),
      });
      yield* git(fixture.repo, "commit", "--allow-empty", "-q", "-m", "moved since");
      yield* fixture.writePlan({ output: JSON.stringify({ requests: [launchRequest("w1")] }) });
      const failure = yield* runJob(fixture.jobs);
      assert.match(
        failure._tag === "Some" ? failure.value.message : "",
        /^Blocked: .*w1: This work was launched before/,
      );
      assert.lengthOf(fixture.calls.launches, 0);
      const status = yield* fixture.readJson("status.json");
      assert.deepEqual(status.rejected, [], "a rejection would let a consumer release the claim");
      assert.equal(status.failed[0].workId, "w1");
      const { receipts } = yield* fixture.readJson("receipts.json");
      assert.deepEqual(receipts, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
