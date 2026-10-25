/**
 * Command jobs against the real scheduler service, thread launch, thread management and
 * orchestrator on an in-memory database, running a real child process. Git, projects and the
 * provider are the faked boundary: the provider refuses to open a session, so any model turn the
 * job caused would fail loudly.
 */
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CommandJobs from "./CommandJobs.ts";

const projectId = ProjectId.make("project:factory");
const otherProjectId = ProjectId.make("project:other");
const builder = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const baseProject = {
  id: projectId,
  title: "Factory",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
  faviconPath: null,
  defaultModelSelection: builder,
  defaultThreadEnvMode: null,
  scripts: [],
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  deletedAt: null,
} as const;

const JOB_SCRIPT = `
const fs = require("node:fs");
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const input = JSON.parse(fs.readFileSync(process.env.T3_JOB_INPUT, "utf8"));
fs.appendFileSync(plan.log, JSON.stringify(input.workers) + "\\n");
if (plan.output) fs.writeFileSync(process.env.T3_JOB_OUTPUT, JSON.stringify(plan.output));
`;

const makeLayer = (
  stateDir: string,
  openedSessions: Array<string>,
  processes: Layer.Layer<
    ProcessRunner.ProcessRunner,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > = ProcessRunner.layer,
) => {
  // setup() creates this repository beside the state directory.
  const workspaceRoot = `${stateDir}/../repo`;
  const project = { ...baseProject, workspaceRoot };
  const adapter = {
    instanceId: builder.instanceId,
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: (input: unknown) => {
      openedSessions.push(JSON.stringify(input));
      return Effect.die("a command job must not open a provider session");
    },
  } as unknown as ProviderAdapter.ProviderAdapterV2["Service"];
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerRegistry = ProviderAdapterRegistry.layerFromAdapters([adapter]);
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "command-jobs" },
    layerRegistry,
    // The effect worker runs, so any provider turn a launch requested would reach the adapter.
    { databaseLayer: layerDatabase, runEffectWorker: true },
  );
  const layerServerSettings = ServerSettings.layerTest();
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(layerReceipts),
  );
  const layerExternal = Layer.mergeAll(
    WorktreeSetupTracker.layer,
    Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
    Layer.mock(TerminalManager.TerminalManager)({ close: () => Effect.void }),
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) =>
        Effect.succeed(
          id === projectId
            ? Option.some(project)
            : id === otherProjectId
              ? Option.some({ ...project, id: otherProjectId, workspaceRoot: "/other" })
              : Option.none(),
        ),
      getByWorkspaceRoot: () => Effect.succeed(Option.some(project)),
    }),
    Layer.mock(GitWorkflow.GitWorkflowService)({
      hasCommit: (input) =>
        Effect.succeed(input.refName === "main" || /^[0-9a-f]{40}$/.test(input.refName)),
      hasRefNamed: () => Effect.succeed(false),
      createWorktree: (input) =>
        Effect.succeed({
          worktree: {
            path: `/repo-worktrees/${input.newRefName}`,
            refName: input.newRefName,
            headSha: "abc",
          },
        } as never),
      removeWorktree: () => Effect.void,
    }),
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
      runForThread: () => Effect.succeed({ status: "no-script" as const }),
    }),
    Layer.mock(TextGeneration.TextGeneration)({}),
    layerServerSettings,
    ProviderRegistryMock.layer(),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: () => Effect.succeed(false),
      folderForThread: () => Effect.succeed(Option.none()),
    }),
  );
  const layerLaunch = ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(layerExternal, layerThreadManagement, layerReceipts, IdAllocator.layer),
    ),
  );
  const layerCommandJobs = CommandJobs.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerLaunch,
        layerThreadManagement,
        processes,
        layerExternal,
        NodeCrypto.layer,
        Layer.succeed(ServerConfig.ServerConfig, { stateDir } as never),
      ),
    ),
  );
  const layerScheduledTasks = ScheduledTasks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerLaunch,
        layerThreadManagement,
        layerExternal,
        layerCommandJobs,
        layerDatabase,
        NodeCrypto.layer,
        Scheduler.layer,
        Layer.mock(SecretRequests.SecretRequests)({}),
      ),
    ),
  );
  return Layer.mergeAll(
    layerScheduledTasks,
    layerThreadManagement,
    layerLaunch,
    layerDatabase,
  ).pipe(Layer.provideMerge(NodeServices.layer));
};

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

const setup = Effect.fn("setup")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "command-jobs-int-" });
  const stateDir = path.join(root, "userdata");
  const fixtureDir = path.join(root, "fixture");
  yield* fs.makeDirectory(stateDir, { recursive: true });
  yield* fs.makeDirectory(fixtureDir, { recursive: true });
  const script = path.join(fixtureDir, "job.cjs");
  const planPath = path.join(fixtureDir, "plan.json");
  const logPath = path.join(fixtureDir, "runs.ndjson");
  yield* fs.writeFileString(script, JOB_SCRIPT);
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
          taskIds: ["task:factory-tick", "task:a-job"],
          executable: process.execPath,
          args: [script, planPath],
          cwd: fixtureDir,
          timeoutMs: 30_000,
          launch: {
            baseRef: "main",
            branchPrefix: "factory/",
            models: { builder },
            runtimeMode: "auto-accept-edits",
          },
        },
      },
    }),
  );
  const receiptsPath = path.join(stateDir, "command-jobs", "tick", "receipts.json");
  return {
    stateDir,
    repo,
    baseCommit,
    receiptsPath,
    writePlan: (output?: unknown) =>
      fs.writeFileString(planPath, JSON.stringify({ log: logPath, output })),
    runs: fs.readFileString(logPath).pipe(
      Effect.map((text) =>
        text
          .trim()
          .split("\n")
          .map(
            (line) =>
              JSON.parse(line) as Array<{ workId: string; threadId: string | null; state: string }>,
          ),
      ),
    ),
    ranAtAll: fs.exists(logPath),
    readReceipts: fs
      .readFileString(receiptsPath)
      .pipe(
        Effect.map(
          (text) => JSON.parse(text).receipts as Array<{ workId: string; threadId: string | null }>,
        ),
      ),
    writeReceipts: (receipts: unknown) =>
      fs.writeFileString(receiptsPath, JSON.stringify({ receipts })),
  };
});

/** Runs the task the way "Run now" does and waits for the run it started to be recorded. */
const runNowAndSettle = Effect.fn("runNowAndSettle")(function* (task: ScheduledTask) {
  const tasks = yield* ScheduledTasks.ScheduledTaskService;
  const before = (yield* tasks.list()).tasks.find(
    (candidate) => candidate.id === task.id,
  )!.runCount;
  const settled = yield* tasks.subscribeList().pipe(
    Stream.map(({ tasks: current }) => current.find((candidate) => candidate.id === task.id)),
    Stream.filter(
      (current) =>
        current !== undefined && current.runCount > before && current.lastRunStatus !== "running",
    ),
    Stream.runHead,
    Effect.forkChild,
  );
  yield* tasks.runNow({ id: task.id });
  return Option.getOrThrow(yield* Fiber.join(settled))!;
});

const createTask = Effect.fn("createTask")(function* () {
  const tasks = yield* ScheduledTasks.ScheduledTaskService;
  const { task } = yield* tasks.upsert({
    id: ScheduledTaskId.make("task:factory-tick"),
    title: "Factory tick",
    prompt: "command-job:tick",
    enabled: false,
    schedule: { type: "interval", everyMs: 60_000 },
    projectId,
    workspaceStrategy: { type: "root" },
    modelSelection: builder,
    runtimeMode: "full-access",
    interactionMode: "default",
  });
  return task;
});

it.live("an idle tick runs the command and makes no thread, turn or provider call", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    return yield* Effect.gen(function* () {
      const threads = yield* ThreadManagement.ThreadManagementService;
      const task = yield* createTask();
      yield* fixture.writePlan();
      const settled = yield* runNowAndSettle(task);
      assert.equal(settled.lastRunStatus, "succeeded", settled.lastRunError ?? "");
      assert.lengthOf(yield* fixture.runs, 1);
      assert.lengthOf(yield* threads.listProjectThreads({ projectId, includeSubagents: true }), 0);
      assert.deepEqual(openedSessions, []);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

it.live("launches, messages and recovers workers through the real thread services", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    return yield* Effect.gen(function* () {
      const threads = yield* ThreadManagement.ThreadManagementService;
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const task = yield* createTask();
      const request = {
        type: "launch",
        workId: "issue-7-build",
        title: "Build issue 7",
        prompt: "Implement issue 7 and record the result.",
        branch: "factory/issue-7",
        model: "builder",
      };
      yield* fixture.writePlan({ requests: [request] });
      const first = yield* runNowAndSettle(task);
      assert.equal(first.lastRunStatus, "succeeded", first.lastRunError ?? "");

      const [worker] = yield* threads.listProjectThreads({ projectId, includeSubagents: true });
      assert.isDefined(worker);
      const shell = yield* threads.getThreadShell(worker!.id);
      assert.equal(shell?.title, "Build issue 7");
      assert.equal(shell?.branch, "factory/issue-7");
      assert.equal(shell?.runtimeMode, "auto-accept-edits");
      assert.deepEqual(shell?.modelSelection, builder);
      assert.equal(shell?.createdBy, "system");
      const projection = yield* threads.getThreadProjection(worker!.id);
      // The base the real launch prepared from is the commit the receipt pins.
      assert.deepEqual(projection.runs[0]?.workspacePreparation, {
        type: "worktree",
        baseRef: fixture.baseCommit,
        branch: "factory/issue-7",
        startFromOrigin: false,
      });
      const launched = JSON.parse(
        yield* FileSystem.FileSystem.pipe(
          Effect.flatMap((fs) => fs.readFileString(fixture.receiptsPath)),
        ),
      ).receipts[0];
      assert.equal(launched.launch.resolvedBaseCommit, fixture.baseCommit);
      assert.deepEqual(launched.launch.effective, {
        providerInstanceId: "codex",
        modelSelection: builder,
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
      });
      assert.equal(projection.messages[0]?.text, request.prompt);
      assert.equal(projection.messages[0]?.scheduledTaskId, task.id);
      assert.deepEqual(
        (yield* fixture.readReceipts).map((receipt) => [receipt.workId, receipt.threadId]),
        [["issue-7-build", worker!.id]],
      );

      // A review follow-up, a repeated launch of the same work and a repeated send.
      const send = {
        type: "send",
        workId: "issue-7-build",
        sendId: "review-1",
        text: "Fix review finding 1.",
      };
      yield* fixture.writePlan({ requests: [request, send] });
      const second = yield* runNowAndSettle(task);
      assert.equal(second.lastRunStatus, "succeeded", second.lastRunError ?? "");
      const messagesAfterSend = yield* threads.getMessageCount(worker!.id);
      yield* fixture.writePlan({ requests: [send] });
      yield* runNowAndSettle(task);
      assert.equal(yield* threads.getMessageCount(worker!.id), messagesAfterSend);

      // Crash after the orchestrator accepted a launch but before its receipt recorded the
      // thread, plus a launch whose intent was written but never reached the orchestrator.
      yield* fixture.writeReceipts([
        { ...(yield* fixture.readReceipts)[0]!, threadId: null },
        {
          ...(yield* fixture.readReceipts)[0]!,
          workId: "never-started",
          threadId: null,
          request: { ...request, workId: "never-started", branch: "factory/never" },
        },
      ]);
      yield* fixture.writePlan();
      const recovered = yield* runNowAndSettle(task);
      assert.equal(recovered.lastRunStatus, "succeeded", recovered.lastRunError ?? "");
      assert.deepEqual(
        (yield* fixture.readReceipts).map((receipt) => [receipt.workId, receipt.threadId]),
        [["issue-7-build", worker!.id]],
      );
      assert.lengthOf(yield* threads.listProjectThreads({ projectId, includeSubagents: true }), 1);
      const lastSnapshot = (yield* fixture.runs).at(-1)!;
      assert.deepEqual(
        lastSnapshot.map((entry) => [entry.workId, entry.threadId]),
        [["issue-7-build", worker!.id]],
      );

      // The command receipt is what makes the replay safe: the same id never makes a second thread.
      const replay = yield* launches.launch({
        commandId: CommandId.make("command-job:tick:issue-7-build"),
        projectId,
        title: "Build issue 7",
        modelSelection: builder,
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
        workspaceStrategy: {
          type: "worktree",
          baseRef: "main",
          branch: "factory/issue-7",
          startFromOrigin: false,
        },
        createdBy: "system",
        creationSource: "server",
      });
      assert.equal(replay.threadId, worker!.id);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

it.live(
  "Run now refuses a bound task moved to another project or lowered below the ceiling",
  () => {
    const openedSessions: Array<string> = [];
    return Effect.gen(function* () {
      const fixture = yield* setup();
      return yield* Effect.gen(function* () {
        const tasks = yield* ScheduledTasks.ScheduledTaskService;
        const threads = yield* ThreadManagement.ThreadManagementService;
        const base = {
          prompt: "command-job:tick",
          enabled: false,
          schedule: { type: "interval" as const, everyMs: 60_000 },
          workspaceStrategy: { type: "root" as const },
          modelSelection: builder,
          interactionMode: "default" as const,
        };
        // Both ids are bound to the job, so only the project and permission checks can refuse them.
        const { task: elsewhere } = yield* tasks.upsert({
          ...base,
          id: ScheduledTaskId.make("task:factory-tick"),
          title: "Moved",
          projectId: otherProjectId,
          runtimeMode: "full-access",
        });
        const { task: lowered } = yield* tasks.upsert({
          ...base,
          id: ScheduledTaskId.make("task:a-job"),
          title: "Lowered",
          projectId,
          runtimeMode: "approval-required",
        });
        yield* fixture.writePlan({
          requests: [
            {
              type: "launch",
              workId: "w1",
              title: "Work",
              prompt: "Do the work.",
              branch: "factory/w1",
              model: "builder",
            },
          ],
        });
        const moved = yield* runNowAndSettle(elsewhere);
        assert.equal(moved.lastRunStatus, "failed");
        assert.include(moved.lastRunError ?? "", `not "${projectId}"`);
        const below = yield* runNowAndSettle(lowered);
        assert.equal(below.lastRunStatus, "failed");
        assert.include(below.lastRunError ?? "", "is below the job's launch ceiling");
        // Nothing ran: no command pass, no thread, no provider session.
        assert.isFalse(yield* fixture.ranAtAll);
        for (const id of [projectId, otherProjectId])
          assert.lengthOf(
            yield* threads.listProjectThreads({ projectId: id, includeSubagents: true }),
            0,
          );
        assert.deepEqual(openedSessions, []);
      }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
  },
);

it.live("a task naming an unconfigured job fails instead of falling back to a model turn", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const { task } = yield* tasks.upsert({
        title: "Unknown job",
        prompt: "command-job:missing",
        enabled: false,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId,
        workspaceStrategy: { type: "root" },
        modelSelection: builder,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const settled = yield* runNowAndSettle(task);
      assert.equal(settled.lastRunStatus, "failed");
      assert.include(settled.lastRunError ?? "", 'Command job "missing" is not configured.');
      assert.lengthOf(yield* threads.listProjectThreads({ projectId, includeSubagents: true }), 0);
      assert.deepEqual(openedSessions, []);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

/** Holds every job process open until released, so a test can act mid-pass. */
const gatedProcesses = Effect.gen(function* () {
  const started = yield* Queue.unbounded<number>();
  const release = yield* Deferred.make<void>();
  const count = yield* Ref.make(0);
  const interrupted = yield* Deferred.make<void>();
  // Only the job's own command is held and counted; the job's git base lookups run for real.
  const layer = Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.map(ProcessRunner.make(), (real) => ({
      run: (input: ProcessRunner.ProcessRunInput) =>
        input.command !== process.execPath
          ? real.run(input)
          : Ref.updateAndGet(count, (n) => n + 1).pipe(
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
    })),
  );
  return { started, release, count, interrupted, layer };
});

const settledRun = (taskId: ScheduledTaskId, minRuns: number) =>
  Effect.gen(function* () {
    const tasks = yield* ScheduledTasks.ScheduledTaskService;
    return yield* tasks.subscribeList().pipe(
      Stream.map(({ tasks: current }) => current.find((candidate) => candidate.id === taskId)),
      Stream.filter(
        (current) =>
          current !== undefined &&
          current.runCount >= minRuns &&
          current.lastRunStatus !== "running",
      ),
      Stream.runHead,
      Effect.map((found) => Option.getOrThrow(found)!),
      Effect.forkChild,
    );
  });

it.effect("a long job does not hold up other due tasks, and Run now coalesces into it", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    const gate = yield* gatedProcesses;
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const base = {
        enabled: true,
        schedule: { type: "interval" as const, everyMs: 60_000 },
        projectId,
        workspaceStrategy: { type: "root" as const },
        modelSelection: builder,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
      };
      const { task: job } = yield* tasks.upsert({
        ...base,
        id: ScheduledTaskId.make("task:a-job"),
        title: "Tick",
        prompt: "command-job:tick",
      });
      const { task: agent } = yield* tasks.upsert({
        ...base,
        id: ScheduledTaskId.make("task:b-agent"),
        title: "Audit",
        prompt: "Audit the repository.",
      });
      const agentSettled = yield* settledRun(agent.id, 1);
      const jobSettled = yield* settledRun(job.id, 1);
      yield* TestClock.adjust("65 seconds");
      assert.equal(yield* Queue.take(gate.started), 1);
      // The agent task launched while the job's first pass is still open.
      const agentRun = yield* Fiber.join(agentSettled);
      assert.equal(agentRun.lastRunStatus, "succeeded", agentRun.lastRunError ?? "");
      const midPass = (yield* tasks.list()).tasks.find((candidate) => candidate.id === job.id);
      assert.equal(midPass?.lastRunStatus, "running");
      yield* tasks.runNow({ id: job.id });
      yield* Deferred.succeed(gate.release, undefined);
      const jobRun = yield* Fiber.join(jobSettled);
      assert.equal(jobRun.lastRunStatus, "succeeded", jobRun.lastRunError ?? "");
      // One recorded run, two passes: the first plus the coalesced Run now.
      assert.equal(jobRun.runCount, 1);
      assert.equal(yield* Ref.get(gate.count), 2);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions, gate.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

it.effect("pausing a running job's task stops it", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    const gate = yield* gatedProcesses;
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const task = yield* createTask();
      yield* tasks.setEnabled({ id: task.id, enabled: true });
      const settled = yield* settledRun(task.id, 1);
      yield* tasks.runNow({ id: task.id });
      yield* Queue.take(gate.started);
      yield* tasks.setEnabled({ id: task.id, enabled: false });
      const stopped = yield* Fiber.join(settled);
      assert.equal(stopped.lastRunStatus, "failed");
      assert.include(stopped.lastRunError ?? "", "Stopped.");
      assert.isFalse(stopped.enabled);
      assert.equal(yield* Ref.get(gate.count), 1);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions, gate.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

it.effect("pausing or deleting a task the job is not bound to does not stop it", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    const gate = yield* gatedProcesses;
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const task = yield* createTask();
      const settled = yield* settledRun(task.id, 1);
      yield* tasks.runNow({ id: task.id });
      yield* Queue.take(gate.started);
      // Anyone allowed to schedule tasks can point one at the job; it must not reach the pass.
      const { task: intruder } = yield* tasks.upsert({
        title: "Not bound",
        prompt: "command-job:tick",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId,
        workspaceStrategy: { type: "root" },
        modelSelection: builder,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      yield* tasks.setEnabled({ id: intruder.id, enabled: false });
      yield* tasks.delete({ id: intruder.id });
      yield* Deferred.succeed(gate.release, undefined);
      const run = yield* Fiber.join(settled);
      assert.equal(run.lastRunStatus, "succeeded", run.lastRunError ?? "");
      assert.equal(yield* Ref.get(gate.count), 1);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions, gate.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

/** The upsert a client form or MCP `update_scheduled_task` sends to edit an existing task. */
const editTask = (task: ScheduledTask, changes: Partial<ScheduledTaskUpsertInput>) =>
  Effect.gen(function* () {
    const tasks = yield* ScheduledTasks.ScheduledTaskService;
    return yield* tasks.upsert({
      id: task.id,
      title: task.title,
      prompt: task.prompt,
      enabled: task.enabled,
      schedule: { type: "interval", everyMs: 60_000 },
      projectId: task.projectId,
      threadId: task.threadId,
      workspaceStrategy: task.workspaceStrategy,
      modelSelection: task.modelSelection,
      runtimeMode: task.runtimeMode,
      interactionMode: task.interactionMode,
      ...changes,
    });
  });

it.effect.each([
  { name: "disabling", changes: { enabled: false } },
  { name: "pointing it away from its job", changes: { prompt: "Audit the repository." } },
  { name: "pointing it at another job", changes: { prompt: "command-job:other" } },
])("an edit $name stops the task's running job", ({ changes }) => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    const gate = yield* gatedProcesses;
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const task = yield* createTask();
      const enabled = (yield* tasks.setEnabled({ id: task.id, enabled: true })).task;
      const settled = yield* settledRun(task.id, 1);
      yield* tasks.runNow({ id: task.id });
      yield* Queue.take(gate.started);
      yield* editTask(enabled, changes);
      const run = yield* Fiber.join(settled);
      assert.equal(run.lastRunStatus, "failed");
      assert.include(run.lastRunError ?? "", "Stopped.");
      assert.equal(yield* Ref.get(gate.count), 1);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions, gate.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

it.effect("an edit that leaves the job running or edits an unbound task does not stop it", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    const gate = yield* gatedProcesses;
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const task = yield* createTask();
      const enabled = (yield* tasks.setEnabled({ id: task.id, enabled: true })).task;
      const settled = yield* settledRun(task.id, 1);
      yield* tasks.runNow({ id: task.id });
      yield* Queue.take(gate.started);
      // Renaming the bound task keeps it on its job.
      yield* editTask(enabled, { title: "Renamed tick" });
      // Editing a task the job is not bound to reaches nothing, whatever it changes.
      const { task: intruder } = yield* tasks.upsert({
        title: "Not bound",
        prompt: "command-job:tick",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId,
        workspaceStrategy: { type: "root" },
        modelSelection: builder,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      yield* editTask(intruder, { enabled: false });
      yield* editTask({ ...intruder, enabled: true }, { prompt: "Something else." });
      yield* Deferred.succeed(gate.release, undefined);
      const run = yield* Fiber.join(settled);
      assert.equal(run.lastRunStatus, "succeeded", run.lastRunError ?? "");
      assert.equal(yield* Ref.get(gate.count), 1);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions, gate.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});

it.effect("deleting the thread a job's task is bound to stops its running job", () => {
  const openedSessions: Array<string> = [];
  return Effect.gen(function* () {
    const fixture = yield* setup();
    const gate = yield* gatedProcesses;
    return yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const threadId = ThreadId.make("thread:factory-manager");
      const task = yield* createTask();
      // schedule_task called from a thread binds the task to it by default.
      yield* editTask(task, { threadId, enabled: true });
      yield* tasks.runNow({ id: task.id });
      yield* Queue.take(gate.started);
      yield* tasks.deleteForThread(threadId);
      // The row is gone, so the stop shows only as the pass process being interrupted.
      yield* Deferred.await(gate.interrupted);
      assert.lengthOf((yield* tasks.list()).tasks, 0);
      assert.equal(yield* Ref.get(gate.count), 1);
    }).pipe(Effect.provide(makeLayer(fixture.stateDir, openedSessions, gate.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
});
