import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  FactoryReservationId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type RunId,
  SourceControlProviderError,
  SourceControlProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderRuntimeRecoveryService from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import type * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import {
  makeMilestones,
  memberFixture,
  testHelperCache,
  windowsDir,
} from "../process/custody/testMilestones.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as NodePtyAdapter from "../terminal/NodePtyAdapter.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import {
  type FactoryCustody,
  preparationFailures,
  readExecutionCustody,
} from "./factoryCustody.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import type * as FactoryGitReadback from "./FactoryGitReadback.ts";
import { makeFactoryOutcomes } from "./factoryOutcomes.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryRunPreparation from "./FactoryRunPreparation.ts";
import * as FactoryStore from "./FactoryStore.ts";

/**
 * A contained run's setup script, run by the real launch service, setup runner and terminal
 * manager in a real PTY, joined through the factory's own resolver to a real job object. The
 * script starts a detached grandchild that a console close cannot end: only its container can.
 * Only the provider, Git hosting, branch naming and project lookup are fakes.
 */

const projectId = ProjectId.make("project:factory-setup-containment");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" } as const;

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("no provider runs before its setup is accounted for"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layerFor = (
  directory: string,
  repo: string,
  setupCommand: string,
  setupAsync: boolean,
  holders: Array<ExecutionContainment.ContainmentHolder>,
  shell: string,
) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerSettings = ServerSettings.layerTest({ worktreesDirectory: `${directory}/worktrees` });
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerStores = Layer.mergeAll(ProjectionStore.layer, EffectOutbox.layer).pipe(
    Layer.provide(layerDatabase),
  );
  const layerThreads = ThreadManagement.layer.pipe(
    Layer.provideMerge(
      ProviderReplayHarness.layerWithRegistry(
        { name: "factory-setup-containment" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: layerDatabase, runEffectWorker: false },
      ),
    ),
    Layer.provide(layerSettings),
    Layer.provide(layerReceipts),
  );
  const layerPlatform = Layer.mergeAll(
    NodeServices.layer,
    ServerConfig.layerTest(process.cwd(), `${directory}/t3`).pipe(
      Layer.provide(NodeServices.layer),
    ),
  );
  const layerProjects = Layer.mock(ProjectService.ProjectService)({
    getById: (id) =>
      Effect.succeed(
        id === projectId
          ? Option.some({
              id: projectId,
              title: "Setup containment",
              workspaceRoot: repo,
              repositoryIdentity: null,
              faviconPath: null,
              defaultModelSelection: modelSelection,
              defaultThreadEnvMode: null,
              scripts: [
                {
                  id: "setup",
                  name: "Setup",
                  command: setupCommand,
                  icon: "configure",
                  runOnWorktreeCreate: true,
                  async: setupAsync,
                },
              ],
              createdAt: "2026-10-31T00:00:00.000Z",
              updatedAt: "2026-10-31T00:00:00.000Z",
              deletedAt: null,
            })
          : Option.none(),
      ),
  });
  const layerGitDriver = GitVcsDriver.layer.pipe(Layer.provideMerge(layerPlatform));
  const layerGitWorkflow = GitWorkflow.layer.pipe(
    Layer.provide(
      GitManager.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
              resolveLink: () => Effect.die("no source control link in this test"),
              resolve: ({ cwd }) =>
                Effect.fail(
                  new SourceControlProviderError({
                    provider: SourceControlProviderKind.make("github"),
                    operation: "resolve",
                    cwd,
                    detail: "no source control host in this test",
                  }),
                ),
            }),
            Layer.mock(TextGeneration.TextGeneration)({}),
            Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
            Layer.mock(ProjectStore.ProjectStoreV2)({}),
            ProviderRegistryMock.layer(),
            Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
              runForThread: () => Effect.succeed({ status: "no-script" as const }),
            }),
            layerSettings,
            NodeCrypto.layer,
          ),
        ),
      ),
    ),
    Layer.provide(
      VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer), Layer.provide(layerPlatform)),
    ),
    Layer.provideMerge(layerGitDriver),
  );
  // The host's job objects, recording each holder so a test can end it as the server's own
  // death would.
  const layerContainment = Layer.effect(
    ExecutionContainment.ExecutionContainment,
    Effect.map(
      ExecutionContainment.makeWindows({ cacheDir: testHelperCache, windowsDir }),
      (shape): ExecutionContainment.ExecutionContainmentShape => ({
        ...shape,
        hold: (name) =>
          shape.hold(name).pipe(
            Effect.tap((holder) =>
              Effect.sync(() => {
                holders.push(holder);
              }),
            ),
          ),
      }),
    ),
  );
  // As the server builds them: the generations, and the resolver terminals ask, which reads them.
  // The replay harness builds the same generations layer without containment, and a layer is
  // shared by reference, so these are built in a memo of their own. A fresh layer is rebuilt
  // wherever it is used; `suspend` builds it once for the terminals and the test alike.
  const layerCustody = Layer.suspend(() =>
    Layer.fresh(
      FactoryExecutionGenerations.layerExecutionJoin.pipe(
        Layer.provideMerge(FactoryExecutionGenerations.layer),
      ),
    ),
  ).pipe(
    Layer.provideMerge(FactoryStore.layer),
    Layer.provideMerge(layerContainment),
    Layer.provide(layerStores),
    Layer.provide(layerDatabase),
    Layer.provide(NodeCrypto.layer),
  );
  const layerTerminals = Layer.effect(
    TerminalManager.TerminalManager,
    Effect.flatMap(PtyAdapter.PtyAdapter, (ptyAdapter) =>
      TerminalManager.makeWithOptions({
        logsDir: `${directory}/terminals`,
        ptyAdapter,
        shellResolver: () => shell,
        processTable: Effect.succeed([]),
      }),
    ),
  ).pipe(
    Layer.provide(NodePtyAdapter.layer),
    Layer.provide(ProcessRunner.layer),
    Layer.provide(layerCustody),
    Layer.provide(NodeServices.layer),
  );
  const layerSetup = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(layerProjects, layerStores, layerTerminals, layerSettings, NodeCrypto.layer),
    ),
  );
  const layerLaunch = ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerGitWorkflow,
        layerSetup,
        layerTerminals,
        layerSettings,
        layerThreads,
        layerReceipts,
        layerDatabase,
        WorktreeSetupTracker.layer,
        IdAllocator.layer,
        ProviderRegistryMock.layer(),
        Layer.mock(TextGeneration.TextGeneration)({}),
        Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: `${directory}/projects`,
          isScratchProject: () => Effect.succeed(false),
          folderForThread: () => Effect.succeedNone,
        }),
        layerProjects,
      ),
    ),
  );
  // As `runtimeLayer.ts` provides it to the claim service.
  const layerRunPreparation = Layer.effect(
    FactoryRunPreparation.FactoryRunPreparation,
    Effect.map(ThreadLaunch.ThreadLaunchService, (launches) => ({
      available: true,
      startOwned: launches.prepareRunOwned,
      currentOwner: launches.currentPreparationOwner,
    })),
  ).pipe(Layer.provideMerge(layerLaunch));
  const layerRecovery = ProviderRuntimeRecoveryService.layer.pipe(
    Layer.provide(Layer.mergeAll(layerThreads, layerStores, layerSettings, IdAllocator.layer)),
  );
  return Layer.mergeAll(
    layerRunPreparation,
    layerRecovery,
    layerThreads,
    layerStores,
    layerCustody,
    layerTerminals,
    FactoryOutcomeStore.layer.pipe(Layer.provide(layerDatabase)),
    layerDatabase,
    layerGitDriver,
  );
};

/** An admitted worktree stage's launched run, bound to its reservation and not yet prepared. */
const launchedExecution = (unit: string) =>
  Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const sql = yield* SqlClient.SqlClient;
    const threadId = ThreadId.make(`thread:factory-setup:${unit}`);
    const reservationId = FactoryReservationId.make(`reservation:factory-setup:${unit}`);
    const reservation = {
      origin: "admitted",
      reservationId,
      factoryId: "factory-setup",
      itemKey: "zainmitchell/t3-native-connectors#89",
      poolId: "pool",
      units: 1,
      state: "held",
      createdAt: "2026-10-31T00:00:00.000Z",
      decisionKey: `decision:${unit}`,
      taskKind: "implement",
      itemVersion: "37e76bef78816fd023f16ddab7cd82df",
      policyRevision: "policy",
      configRevision: 1,
      packetDigest: "packet",
      modelSelection,
      execution: {
        commandId: `command:factory-setup:${unit}`,
        threadId,
        runId: `run:unassigned:${unit}`,
        taskNodeId: `node:${unit}`,
      },
    };
    yield* sql`
      INSERT INTO factory_reservations (
        reservation_id, factory_id, origin, state, decision_key, item_key, pool_id, units,
        execution_thread_id, record_json, created_at
      ) VALUES (
        ${reservationId}, ${reservation.factoryId}, 'admitted', 'held',
        ${reservation.decisionKey}, ${reservation.itemKey}, 'pool', 1, ${threadId},
        ${JSON.stringify(reservation)}, ${reservation.createdAt}
      )
    `;
    yield* sql`
      INSERT INTO factory_thread_bindings (thread_id, reservation_id)
      VALUES (${threadId}, ${reservationId})
    `;
    const launched = yield* launches.launch({
      commandId: CommandId.make(`command:factory-setup:${unit}`),
      threadId,
      projectId,
      title: `#89 ${unit}`,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "worktree", baseRef: "main", branch: `factory/89-setup-${unit}` },
      initialMessage: {
        messageId: MessageId.make(`message:factory-setup:${unit}`),
        text: "Implement #89.",
        attachments: [],
      },
      createdBy: "user",
      creationSource: "web",
    });
    const runId: RunId = launched.projection.runs[0]!.id;
    yield* sql`
      UPDATE factory_reservations
      SET record_json = ${JSON.stringify({ ...reservation, execution: { ...reservation.execution, runId } })}
      WHERE reservation_id = ${reservationId}
    `;
    return { threadId, runId, reservationId };
  });

/**
 * The run's preparation by `ownerId`, joined to the run's held container as the claim service
 * joins it, and the status the run leaves `preparing` for.
 */
const prepareOwned = (threadId: ThreadId, runId: RunId, ownerId: PreparationOwnerId) =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const preparation = yield* FactoryRunPreparation.FactoryRunPreparation;
    const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    const commandId = FactoryClaimStore.preparationCommandId(runId);
    const afterSequence = yield* threads.getThreadEventSequence(threadId);
    const handle = yield* preparation
      .startOwned({ commandId, threadId, runId, ownerId, join: generations.joinFor(runId) })
      .pipe(Effect.map(Option.getOrThrow));
    const left = yield* threads
      .streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" })
      .pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "run.updated" &&
            stored.event.payload.id === runId &&
            stored.event.payload.status !== "preparing",
        ),
        Stream.runHead,
      );
    const status = Option.map(left, (stored) =>
      stored.event.type === "run.updated" ? stored.event.payload.status : undefined,
    ).pipe(Option.getOrUndefined);
    return { handle, status };
  });

/**
 * A claimed run of a worktree stage whose async setup is running after its release, prepared as
 * the claim service prepares it: its container held before any workspace work, and its owned
 * preparation joined to it.
 */
const runningSetup = (unit: string) =>
  Effect.gen(function* () {
    const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    const store = yield* FactoryStore.FactoryStore;
    const { threadId, runId, reservationId } = yield* launchedExecution(unit);
    const ownerId = PreparationOwnerId.make(`owner:${unit}:1`);
    const commandId = FactoryClaimStore.preparationCommandId(runId);
    yield* store.openWorkspaceObligation({ runId, reservationId, threadId, commandId, ownerId });
    const generation = yield* generations.openIntent({ runId, reservationId, threadId });
    yield* generations.hold(generation);
    const { handle, status } = yield* prepareOwned(threadId, runId, ownerId);
    assert.strictEqual(status, "starting");
    const bound = Option.getOrThrow(yield* store.bindingForThread(threadId));
    return { threadId, runId, ownerId, generation, handle, reservation: bound };
  });

/**
 * The lifecycle's ordinary outcome cleanup over this server's own stores and containers. No
 * provider session opens here, and nothing settles a thread: no settlement service runs.
 */
const outcomeCleanup = Effect.gen(function* () {
  const context = yield* Effect.context<
    | FactoryStore.FactoryStore
    | ProjectionStore.ProjectionStoreV2
    | EffectOutbox.EffectOutboxV2
    | FactoryExecutionGenerations.FactoryExecutionGenerations
  >();
  const unused = () => Effect.die("the outcome cleanup does not use this");
  return makeFactoryOutcomes({
    store: yield* FactoryStore.FactoryStore,
    outcomes: yield* FactoryOutcomeStore.FactoryOutcomeStore,
    projections: yield* ProjectionStore.ProjectionStoreV2,
    generations: yield* FactoryExecutionGenerations.FactoryExecutionGenerations,
    sessions: {
      isLive: () => Effect.succeed(false),
    } as unknown as ProviderSessionManager.ProviderSessionManagerV2Shape,
    git: {} as FactoryGitReadback.FactoryGitReadbackShape,
    custodyOf: (reservation) =>
      readExecutionCustody(reservation).pipe(
        Effect.provide(context),
        Effect.orElseSucceed((): FactoryCustody => ({
          state: "unknown",
          reasons: ["execution_unreadable"],
        })),
      ),
    settleThread: unused,
    verifyEvidence: unused,
    readArtifact: unused,
    adoptedCriteria: unused,
    onReported: unused,
    ensureOperation: unused,
    getOperation: unused,
  });
});

/** A setup that reports `setup`, starts a detached `leaf`, and runs until something ends it. */
const setupCommand = (port: number) =>
  `& '${process.execPath}' '${memberFixture}' ${port} setup --spawn leaf`;

/** A setup that fails the first time it runs and succeeds after, as a flaky install does. */
const failingOnce = (_port: number, directory: string) => {
  const marker = `${directory}\\failed-once`;
  return `if (-not (Test-Path '${marker}')) { New-Item -ItemType File '${marker}' | Out-Null; & '${process.execPath}' -e 'process.exit(3)' }`;
};

const withRepository = <A, E, R>(
  body: (
    milestones: Effect.Success<typeof makeMilestones>,
    holders: ReadonlyArray<ExecutionContainment.ContainmentHolder>,
    repo: string,
  ) => Effect.Effect<A, E, R>,
  setup: {
    readonly command?: (port: number, directory: string) => string;
    readonly async?: boolean;
    readonly shell?: string;
  } = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "factory-setup-" });
      const repo = path.join(directory, "repo");
      yield* fs.makeDirectory(repo);
      const milestones = yield* makeMilestones;
      // Every container still held when the test ends is closed, and with it its members.
      const holders: Array<ExecutionContainment.ContainmentHolder> = [];
      const command = (setup.command ?? setupCommand)(milestones.port, directory);
      return yield* Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const git = (args: ReadonlyArray<string>) =>
          driver.execute({ operation: "factory-setup-test", cwd: repo, args: [...args] });
        yield* git(["init", "-b", "main"]);
        yield* git(["config", "user.name", "Test"]);
        yield* git(["config", "user.email", "test@example.test"]);
        yield* git(["config", "core.autocrlf", "false"]);
        yield* fs.writeFileString(path.join(repo, "tracked.txt"), "base\n");
        yield* git(["add", "tracked.txt"]);
        yield* git(["commit", "-m", "base"]);
        return yield* body(milestones, holders, repo);
      }).pipe(
        Effect.provide(
          layerFor(
            directory,
            repo,
            command,
            setup.async ?? true,
            holders,
            setup.shell ?? "powershell.exe",
          ),
        ),
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer));

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Job objects are the Windows mechanism; elsewhere containment is unavailable by design.
describe.runIf(HostProcess.Platform.defaultValue() === "win32")(
  "a contained run's setup processes",
  () => {
    it.live(
      "Claims/R2-S03: a restart's cancellation leaves the running setup counted in its container until it ends",
      () =>
        withRepository((milestones, holders) =>
          Effect.gen(function* () {
            const store = yield* FactoryStore.FactoryStore;
            const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
            const threads = yield* ThreadManagement.ThreadManagementService;
            const prepared = yield* runningSetup("restart");
            const setupPid = yield* milestones.arrived("setup");
            const leafPid = yield* milestones.arrived("leaf");

            // The setup's shell, its script and the script's detached child are all members.
            const own = (yield* generations.observe([prepared.runId])).get(prepared.runId);
            assert.strictEqual(own?.type, "live");
            assert.isAtLeast(own?.type === "live" ? own.members : 0, 3);
            const running = yield* readExecutionCustody(prepared.reservation);
            assert.strictEqual(running.state, "live");
            assert.includeMembers(
              [...running.reasons],
              ["contained_processes", "workspace_preparation"],
            );

            // The server restarts before any provider start was claimed: recovery cancels the
            // released run, which stops its preparation and closes the setup's terminal. (Git
            // made the worktree first, so the first boundary it crossed was a process.)
            yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
            assert.deepStrictEqual(yield* prepared.handle.ended, {
              type: "external_work",
              boundary: "process",
            });
            const run = (yield* threads.getThreadProjection(prepared.threadId)).runs.find(
              (candidate) => candidate.id === prepared.runId,
            );
            assert.strictEqual(run?.status, "cancelled");
            // As the claim service's watcher settles it: the container accounts for the setup.
            assert.isTrue(
              yield* store.settleWorkspaceObligation({
                runId: prepared.runId,
                ownerId: prepared.ownerId,
                scope: { type: "contained", generationId: prepared.generation.generationId },
              }),
            );
            const settled = yield* readExecutionCustody(prepared.reservation);
            if (settled.state === "quiescent") {
              // An empty container means the kernel already ended every member.
              assert.isFalse(isRunning(setupPid));
              assert.isFalse(isRunning(leafPid));
            } else {
              assert.deepStrictEqual(settled, { state: "live", reasons: ["contained_processes"] });
            }

            // Closing the terminal ended the join, and its job took the detached child with it.
            yield* milestones.ended("setup");
            yield* milestones.ended("leaf");

            // The server's own end takes the holder: the container is gone, and so is the work.
            const [holder] = holders;
            process.kill(holder!.pid);
            yield* holder!.exited;
            assert.deepStrictEqual(yield* readExecutionCustody(prepared.reservation), {
              state: "quiescent",
              reasons: ["never_started"],
            });
          }),
        ),
    );

    it.live(
      "a contained setup asked for a shell this host lacks runs, with its work, in a shell it has",
      () =>
        withRepository(
          (milestones, holders) =>
            Effect.gen(function* () {
              const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
              const terminals = yield* TerminalManager.TerminalManager;
              const started: Array<{ threadId: string; terminalId: string }> = [];
              const shellEnded = yield* Deferred.make<void>();
              yield* terminals.subscribe((event) =>
                event.type === "started"
                  ? Effect.sync(() => {
                      started.push(event);
                    })
                  : event.type === "exited"
                    ? Deferred.succeed(shellEnded, undefined).pipe(Effect.asVoid)
                    : Effect.void,
              );
              const prepared = yield* runningSetup("missing-shell");
              const ran = yield* Effect.raceFirst(
                milestones.arrived("setup").pipe(Effect.as(true)),
                Deferred.await(shellEnded).pipe(Effect.as(false)),
              );
              assert.isTrue(ran, "the setup's shell ended before its script ran");
              yield* milestones.arrived("leaf");
              // The shell, its script and the script's detached child are the container's.
              const own = (yield* generations.observe([prepared.runId])).get(prepared.runId);
              assert.isAtLeast(own?.type === "live" ? own.members : 0, 3);
              const setup = started.find((terminal) => terminal.threadId === prepared.threadId);
              const shell = yield* terminals.getShell(setup!);
              assert.match(shell, /(pwsh|powershell)\.exe$/i);
              const [holder] = holders;
              process.kill(holder!.pid);
              yield* holder!.exited;
              yield* milestones.ended("setup");
              yield* milestones.ended("leaf");
            }),
          { shell: "t3-no-such-shell.exe" },
        ),
    );

    it.live("a setup still running when its server dies ends with the container's holder", () =>
      withRepository((milestones, holders) =>
        Effect.gen(function* () {
          const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
          const prepared = yield* runningSetup("server-death");
          yield* milestones.arrived("setup");
          yield* milestones.arrived("leaf");
          const own = (yield* generations.observe([prepared.runId])).get(prepared.runId);
          assert.strictEqual(own?.type, "live");

          // Nothing closes the terminal here: the holder, the server's own child, just ends.
          const [holder] = holders;
          process.kill(holder!.pid);
          yield* holder!.exited;
          yield* milestones.ended("setup");
          yield* milestones.ended("leaf");
        }),
      ),
    );

    it.live(
      "Claims/R2: a failed setup's shell leaves its container, so a same-run retry and its outcome release the stage",
      () =>
        withRepository(
          (_milestones, _holders, repo) =>
            Effect.gen(function* () {
              const store = yield* FactoryStore.FactoryStore;
              const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
              const threads = yield* ThreadManagement.ThreadManagementService;
              const terminals = yield* TerminalManager.TerminalManager;
              const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
              const { threadId, runId, reservationId } = yield* launchedExecution("retry");
              const setupTerminals: Array<string> = [];
              yield* terminals.subscribe((event) =>
                Effect.sync(() => {
                  if (
                    event.threadId === threadId &&
                    event.type === "started" &&
                    event.terminalId !== "owner"
                  ) {
                    setupTerminals.push(event.terminalId);
                  }
                }),
              );
              const first = PreparationOwnerId.make("owner:retry:1");
              yield* store.openWorkspaceObligation({
                runId,
                reservationId,
                threadId,
                commandId: FactoryClaimStore.preparationCommandId(runId),
                ownerId: first,
              });
              const generation = yield* generations.openIntent({ runId, reservationId, threadId });
              yield* generations.hold(generation);
              // The owner's own terminal, opened while the run is held, is one of its members.
              yield* terminals.open({
                threadId,
                terminalId: "owner",
                cwd: repo,
                cols: 80,
                rows: 24,
              });

              const failed = yield* prepareOwned(threadId, runId, first);
              assert.strictEqual(failed.status, "failed");
              yield* failed.handle.ended;
              assert.include(
                preparationFailures(yield* threads.getThreadProjection(threadId)).get(runId),
                "Setup script exited with 3",
              );
              const failedShell = yield* Effect.exit(
                terminals.getShell({ threadId, terminalId: setupTerminals[0]! }),
              );

              // The same run prepares again under a new owner, in the same container, and its
              // setup succeeds in a terminal of its own.
              const second = PreparationOwnerId.make("owner:retry:2");
              assert.isTrue(
                yield* store.reownWorkspaceObligation({
                  runId,
                  fromOwnerId: first,
                  toOwnerId: second,
                  endedGenerations: [],
                }),
              );
              yield* threads.dispatch({
                type: "prepared-run.retry",
                commandId: CommandId.make(`factory-recovery:${runId}:${second}`),
                threadId,
                runId,
              });
              const retried = yield* prepareOwned(threadId, runId, second);
              assert.strictEqual(retried.status, "starting");
              yield* retried.handle.ended;
              assert.strictEqual(new Set(setupTerminals).size, 2);
              // As the claim service's watcher settles it: the container accounts for the setup.
              assert.isTrue(
                yield* store.settleWorkspaceObligation({
                  runId,
                  ownerId: second,
                  scope: { type: "contained", generationId: generation.generationId },
                }),
              );
              // No provider starts here: a restart's recovery cancels the released run.
              yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
              assert.deepStrictEqual(
                (yield* threads.getThreadProjection(threadId)).runs.map((run) => run.status),
                ["cancelled"],
              );

              const reservation = Option.getOrThrow(yield* store.bindingForThread(threadId));
              const outcomeId = `outcome:${reservationId}`;
              yield* outcomes.insertReported({
                outcomeId,
                factoryId: reservation.factoryId,
                itemKey: reservation.itemKey,
                origin: { type: "native", reservationId },
                stage: "implement",
                report: { outcome: "failed", failure: "Setup failed.", summary: "Nothing built." },
                reportDigest: "report",
                reportedAt: "2026-10-31T00:00:01.000Z",
                state: "reported",
              });
              assert.isTrue(
                yield* outcomes.markVerified({
                  outcomeId,
                  receipt: { verifiedAt: "2026-10-31T00:00:02.000Z" },
                }),
              );

              const { settle } = yield* outcomeCleanup;
              // The owner's shell is theirs: the cleanup leaves it running, and it holds the stage.
              assert.isFalse(yield* settle(reservation));
              assert.isTrue(
                Exit.isSuccess(
                  yield* Effect.exit(terminals.getShell({ threadId, terminalId: "owner" })),
                ),
              );
              yield* terminals.close({ threadId, terminalId: "owner" });
              // Each collection pass settles again: a closed shell leaves its container once its
              // process has exited, which nothing reports.
              const released = yield* settle(reservation).pipe(
                Effect.repeat({
                  until: (done) => done,
                  times: 40,
                  // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- a job object signals nothing when a member exits; passes re-read its count, as the lifecycle's do.
                  schedule: Schedule.spaced("250 millis"),
                }),
              );
              assert.isTrue(released, "no setup shell of the run may hold its container");
              assert.isTrue(Exit.isFailure(failedShell), "the failed setup's shell was retired");
              assert.strictEqual(
                Option.map(yield* store.getReservation(reservationId), (held) => held.state).pipe(
                  Option.getOrUndefined,
                ),
                "released",
              );
            }),
          { command: failingOnce, async: false },
        ),
    );
  },
);
