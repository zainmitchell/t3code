import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  FactoryReservationId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  SourceControlProviderError,
  SourceControlProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import * as FactoryRunPreparation from "./FactoryRunPreparation.ts";
import * as FactoryStore from "./FactoryStore.ts";

/**
 * A reopened item's new unit derives the branch its earlier unit still has checked out, dirty.
 * Real Git, the real launch service and Git workflow, and the factory's preparation adapter as
 * the runtime layer provides it. Only the provider, tracker, setup script and project lookup
 * are fakes, and none of them may be reached.
 */

const projectId = ProjectId.make("project:factory-collision");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" } as const;
const collidingBranch = "factory/47-native-workspace-collision";
const successorBranch = "factory/47-native-workspace-collision-r2";

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("no provider runs in a workspace preparation test"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layerFor = (directory: string, repo: string) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerSettings = ServerSettings.layerTest({ worktreesDirectory: `${directory}/worktrees` });
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerThreads = ThreadManagement.layer.pipe(
    Layer.provide(
      ProviderReplayHarness.layerWithRegistry(
        { name: "factory-workspace-collision" },
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
  const layerGitDriver = GitVcsDriver.layer.pipe(Layer.provideMerge(layerPlatform));
  const layerSetup = Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
    runForThread: () => Effect.succeed({ status: "no-script" as const }),
  });
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
            layerSetup,
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
  const layerLaunch = ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerGitWorkflow,
        layerSetup,
        layerSettings,
        layerThreads,
        layerReceipts,
        layerDatabase,
        WorktreeSetupTracker.layer,
        IdAllocator.layer,
        ProviderRegistryMock.layer(),
        Layer.mock(TextGeneration.TextGeneration)({}),
        Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
        Layer.mock(TerminalManager.TerminalManager)({ close: () => Effect.void }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: `${directory}/projects`,
          isScratchProject: () => Effect.succeed(false),
          folderForThread: () => Effect.succeedNone,
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: (id) =>
            Effect.succeed(
              id === projectId
                ? Option.some({
                    id: projectId,
                    title: "Collision",
                    workspaceRoot: repo,
                    repositoryIdentity: null,
                    faviconPath: null,
                    defaultModelSelection: modelSelection,
                    defaultThreadEnvMode: null,
                    scripts: [],
                    createdAt: "2026-10-28T00:00:00.000Z",
                    updatedAt: "2026-10-28T00:00:00.000Z",
                    deletedAt: null,
                  })
                : Option.none(),
            ),
        }),
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
  return Layer.mergeAll(
    layerRunPreparation,
    layerThreads,
    layerDatabase,
    layerGitDriver,
    FactoryStore.layer.pipe(Layer.provide(layerDatabase)),
  );
};

it.effect(
  "a colliding factory workspace preparation preserves the dirty prior worktree, and a distinct successor is made once",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "factory-collision-" });
      const repo = path.join(directory, "repo");
      yield* fs.makeDirectory(repo);
      yield* Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const git = (cwd: string, args: ReadonlyArray<string>) =>
          driver
            .execute({ operation: "factory-collision-test", cwd, args: [...args] })
            .pipe(Effect.map((result) => result.stdout));
        const launches = yield* ThreadLaunch.ThreadLaunchService;
        const threads = yield* ThreadManagement.ThreadManagementService;
        const preparation = yield* FactoryRunPreparation.FactoryRunPreparation;
        const store = yield* FactoryStore.FactoryStore;
        const sql = yield* SqlClient.SqlClient;

        yield* git(repo, ["init", "-b", "main"]);
        yield* git(repo, ["config", "user.name", "Test"]);
        yield* git(repo, ["config", "user.email", "test@example.test"]);
        yield* git(repo, ["config", "core.autocrlf", "false"]);
        yield* fs.writeFileString(path.join(repo, "tracked.txt"), "base\n");
        yield* git(repo, ["add", "tracked.txt"]);
        yield* git(repo, ["commit", "-m", "base"]);
        const base = (yield* git(repo, ["rev-parse", "HEAD"])).trim();

        const runOf = (threadId: ThreadId, runId: RunId) =>
          Effect.map(threads.getThreadProjection(threadId), (projection) => ({
            run: projection.runs.find((run) => run.id === runId),
            thread: projection.thread,
            failures: projection.turnItems.flatMap((item) =>
              item.runId === runId && item.type === "command_execution" && item.status === "failed"
                ? [item.output ?? ""]
                : [],
            ),
          }));

        /** One owned preparation through the factory's adapter, to its end. */
        const prepareOwned = (threadId: ThreadId, runId: RunId, ownerId: PreparationOwnerId) =>
          preparation
            .startOwned({
              commandId: FactoryClaimStore.preparationCommandId(runId),
              threadId,
              runId,
              ownerId,
            })
            .pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.succeedNone,
                  onSome: (handle) => Effect.asSome(handle.ended),
                }),
              ),
            );

        /**
         * An admitted stage of item #47 with no claim of its own, launched and prepared as the
         * factory does: bound before launch, so only its owner's preparation may run.
         */
        const admitAndPrepare = (unit: string, branch: string) =>
          Effect.gen(function* () {
            const threadId = ThreadId.make(`thread:factory-collision:${unit}`);
            const reservationId = `reservation:factory-collision:${unit}`;
            const reservation = {
              origin: "admitted",
              reservationId,
              factoryId: "factory-collision",
              itemKey: "example-org/connector#47",
              poolId: "pool",
              units: 1,
              state: "held",
              createdAt: "2026-10-28T00:00:00.000Z",
              decisionKey: `decision:${unit}`,
              taskKind: "implement",
              itemVersion: "37e76bef78816fd023f16ddab7cd82df",
              policyRevision: "policy",
              configRevision: 1,
              packetDigest: "packet",
              modelSelection,
              execution: {
                commandId: `command:factory-collision:${unit}`,
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
              commandId: CommandId.make(`command:factory-collision:${unit}`),
              threadId,
              projectId,
              title: `#47 ${unit}`,
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              workspaceStrategy: { type: "worktree", baseRef: "main", branch },
              initialMessage: {
                messageId: MessageId.make(`message:factory-collision:${unit}`),
                text: "Implement #47.",
                attachments: [],
              },
              createdBy: "user",
              creationSource: "web",
            });
            const runId = launched.projection.runs[0]!.id;
            yield* sql`
              UPDATE factory_reservations
              SET record_json = ${JSON.stringify({
                ...reservation,
                execution: { ...reservation.execution, runId },
              })}
              WHERE reservation_id = ${reservationId}
            `;
            // The binding kept the launch from preparing it.
            assert.strictEqual((yield* runOf(threadId, runId)).run?.status, "preparing");
            const ownerId = PreparationOwnerId.make(`owner:${unit}:1`);
            yield* store.openWorkspaceObligation({
              runId,
              reservationId: FactoryReservationId.make(reservationId),
              threadId,
              commandId: FactoryClaimStore.preparationCommandId(runId),
              ownerId,
            });
            const ended = yield* prepareOwned(threadId, runId, ownerId);
            return { threadId, runId, ownerId, ended };
          });

        const worktreeOf = (branch: string) =>
          path.join(directory, "worktrees", "repo", branch.replaceAll("/", "-"));
        const snapshot = (worktree: string) =>
          Effect.all({
            head: git(worktree, ["rev-parse", "HEAD"]),
            branch: git(worktree, ["symbolic-ref", "HEAD"]),
            status: git(worktree, [
              "status",
              "--porcelain=v2",
              "--branch",
              "--untracked-files=all",
            ]),
            tracked: fs.readFile(path.join(worktree, "tracked.txt")),
            staged: fs.readFile(path.join(worktree, "staged.txt")),
            untracked: fs.readFile(path.join(worktree, "notes", "untracked.bin")),
          });
        const repository = Effect.all({
          worktrees: git(repo, ["worktree", "list", "--porcelain"]),
          branches: git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]),
          root: git(repo, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]),
        });

        // The earlier unit made the branch and its worktree, and left work in it uncommitted.
        const earlier = yield* admitAndPrepare("earlier", collidingBranch);
        const prior = worktreeOf(collidingBranch);
        assert.strictEqual(
          (yield* runOf(earlier.threadId, earlier.runId)).thread.worktreePath,
          prior,
        );
        const trackedBytes = new TextEncoder().encode("base\nedited by the earlier unit\r\n");
        const stagedBytes = new TextEncoder().encode("staged, not committed\n");
        const untrackedBytes = Uint8Array.from([0, 1, 2, 255, 13, 10]);
        yield* fs.writeFile(path.join(prior, "tracked.txt"), trackedBytes);
        yield* fs.writeFile(path.join(prior, "staged.txt"), stagedBytes);
        yield* git(prior, ["add", "staged.txt"]);
        yield* fs.makeDirectory(path.join(prior, "notes"));
        yield* fs.writeFile(path.join(prior, "notes", "untracked.bin"), untrackedBytes);
        const priorBefore = yield* snapshot(prior);
        assert.strictEqual(priorBefore.head.trim(), base);
        assert.strictEqual(priorBefore.branch.trim(), `refs/heads/${collidingBranch}`);
        assert.include(priorBefore.status, " tracked.txt");
        assert.include(priorBefore.status, " staged.txt");
        assert.include(priorBefore.status, "? notes/untracked.bin");
        const repositoryBefore = yield* repository;

        // The reopened item's unit derives the same branch: Git refuses, and the run fails.
        const reopened = yield* admitAndPrepare("reopened", collidingBranch);
        assert.deepStrictEqual(
          reopened.ended,
          Option.some({ type: "external_work", boundary: "process" }),
        );
        const refused = yield* runOf(reopened.threadId, reopened.runId);
        assert.strictEqual(refused.run?.status, "failed");
        assert.include(refused.failures.at(-1), "(branch_already_exists)");
        assert.isNull(refused.thread.worktreePath);
        assert.deepStrictEqual(yield* snapshot(prior), priorBefore);
        assert.deepStrictEqual(yield* repository, repositoryBefore);

        // A distinct successor branch prepares beside it.
        const successor = yield* admitAndPrepare("successor", successorBranch);
        assert.deepStrictEqual(
          successor.ended,
          Option.some({ type: "external_work", boundary: "process" }),
        );
        const made = yield* runOf(successor.threadId, successor.runId);
        assert.notInclude(["preparing", "failed"], made.run?.status);
        const next = worktreeOf(successorBranch);
        assert.strictEqual(made.thread.worktreePath, next);
        assert.strictEqual(made.thread.branch, successorBranch);
        assert.strictEqual((yield* git(next, ["rev-parse", "HEAD"])).trim(), base);
        assert.strictEqual(
          yield* git(next, ["status", "--porcelain=v2", "--untracked-files=all"]),
          "",
        );
        assert.deepStrictEqual(yield* snapshot(prior), priorBefore);
        const repositoryAfterSuccessor = yield* repository;
        assert.strictEqual(
          repositoryAfterSuccessor.worktrees
            .split("\n")
            .filter((line) => line.startsWith("worktree ")).length,
          3,
        );

        // Recovery re-owns the refused run's obligation and retries it under the new owner, as
        // the factory's own recovery does: Git refuses again.
        const recoveryOwner = PreparationOwnerId.make("owner:reopened:2");
        assert.isTrue(
          yield* store.reownWorkspaceObligation({
            runId: reopened.runId,
            fromOwnerId: reopened.ownerId,
            toOwnerId: recoveryOwner,
            endedGenerations: [],
          }),
        );
        yield* threads.dispatch({
          type: "prepared-run.retry",
          commandId: CommandId.make(`factory-recovery:${reopened.runId}:${recoveryOwner}`),
          threadId: reopened.threadId,
          runId: reopened.runId,
        });
        assert.deepStrictEqual(
          yield* prepareOwned(reopened.threadId, reopened.runId, recoveryOwner),
          Option.some({ type: "external_work", boundary: "process" }),
        );
        const refusedAgain = yield* runOf(reopened.threadId, reopened.runId);
        assert.strictEqual(refusedAgain.run?.status, "failed");
        assert.include(refusedAgain.failures.at(-1), "(branch_already_exists)");
        // A second preparation of the prepared successor schedules nothing.
        assert.isTrue(
          Option.isNone(
            yield* prepareOwned(
              successor.threadId,
              successor.runId,
              PreparationOwnerId.make("owner:successor:2"),
            ),
          ),
        );
        assert.deepStrictEqual(yield* repository, repositoryAfterSuccessor);
        assert.deepStrictEqual(yield* snapshot(prior), priorBefore);
        assert.deepStrictEqual(priorBefore.tracked, trackedBytes);
        assert.deepStrictEqual(priorBefore.staged, stagedBytes);
        assert.deepStrictEqual(priorBefore.untracked, untrackedBytes);
      }).pipe(Effect.provide(layerFor(directory, repo)));
    }).pipe(Effect.provide(NodeServices.layer)),
);
