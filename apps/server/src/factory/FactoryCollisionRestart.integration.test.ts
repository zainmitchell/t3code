// @effect-diagnostics nodeBuiltinImport:off - pins the policy fixture and runs a disposable custody host.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as PlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
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
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as CommandJobFence from "../commandJobs/CommandJobFence.ts";
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
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import { makeMilestones, testHelperCache, windowsDir } from "../process/custody/testMilestones.ts";
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
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryClaimService from "./FactoryClaimService.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import * as FactoryCommandPolicy from "./FactoryCommandPolicy.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import * as FactoryGitReadback from "./FactoryGitReadback.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryRunPreparation from "./FactoryRunPreparation.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryTracker from "./FactoryTracker.ts";
import * as FactoryTransferStore from "./FactoryTransferStore.ts";

/**
 * #47's collision across fresh runtimes over one database file and repository: real Git, launch,
 * preparation, stores, lifecycle passes, policy process and containment. Only the provider (never
 * reached), tracker and project lookup are fakes. A rebuilt runtime is not an OS restart of Main.
 */

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const policyScript = NodePath.join(import.meta.dirname, "factoryPolicy.fixture.ts");
const hostFixture = NodePath.join(import.meta.dirname, "custodyHost.fixture.ts");
const projectId = ProjectId.make("project:factory-collision-restart");
const factoryId = FactoryId.make("collision-restart");
const pool = FactoryPoolId.make("builders");
const repository = "example-org/collision";
const collidingItem = FactoryItemKey.make(`github:${repository}#55`);
const neverStartedItem = FactoryItemKey.make(`github:${repository}#56`);
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" } as const;
const collidingBranch = "factory/55-collision-restart";
const successorBranch = "factory/55-collision-restart-r2";

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("no provider runs in this test"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const unused = () => Effect.die("this test reads its items and writes nothing to the tracker");

/** Both items stay open; the policy decides nothing for either, so nothing new is admitted. */
const tracker = Layer.succeed(FactoryTracker.FactoryTracker, {
  withSession: (_input, use) =>
    use({
      account: { accountId: "9001" },
      readIssue: ({ issueNumber }) =>
        Effect.succeed({
          state: "open" as const,
          title: `Item ${issueNumber}`,
          body: `Synthetic item ${issueNumber}.`,
          labels: ["policy:blocked"],
          comments: [],
        }),
      listOpenIssues: () => Effect.die("reconciliation lists no repository"),
      readComment: () => Effect.die("no claim comment in this test"),
      createComment: unused,
      closeIssue: unused,
      createIssue: unused,
      findIssueByMarker: unused,
      addSubIssue: unused,
      addBlockedBy: unused,
      findPullRequest: unused,
      readPullRequest: unused,
      createPullRequest: unused,
      markReadyForReview: unused,
      mergePullRequest: unused,
      readChecks: unused,
      readReviewFindings: unused,
      readCommit: unused,
      ensureSuccessStatus: unused,
    }),
});

/** One runtime over the database file and repository: fresh layers and store connections. */
const layerRuntime = (directory: string, repo: string) => {
  const layerDatabase = SqlitePersistence.layerFromPath(`${directory}/t3/state.sqlite`).pipe(
    Layer.provide(NodeServices.layer),
  );
  const layerSettings = ServerSettings.layerTest({ worktreesDirectory: `${directory}/worktrees` });
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerHarness = ProviderReplayHarness.layerWithRegistry(
    { name: "factory-collision-restart" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerThreads = ThreadManagement.layer.pipe(
    Layer.provide(layerHarness),
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
  const layerProjects = Layer.mock(ProjectService.ProjectService)({
    getById: (id) =>
      Effect.succeed(
        id === projectId
          ? Option.some({
              id: projectId,
              title: "Collision restart",
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
            PlatformCrypto.layer,
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
        layerProjects,
      ),
    ),
  );
  // As `runtimeLayer.ts` provides it to the claim service and to read-state custody.
  const layerRunPreparation = Layer.effect(
    FactoryRunPreparation.FactoryRunPreparation,
    Effect.map(ThreadLaunch.ThreadLaunchService, (launches) => ({
      available: true,
      startOwned: launches.prepareRunOwned,
      currentOwner: launches.currentPreparationOwner,
    })),
  ).pipe(Layer.provideMerge(layerLaunch));
  const layerStores = Layer.mergeAll(
    FactoryClaimStore.layer.pipe(Layer.provideMerge(FactoryStore.layer)),
    FactoryOutcomeStore.layer,
    FactoryOperationStore.layer,
    FactoryExecutionGenerations.layer.pipe(
      Layer.provide(ExecutionContainment.layerWindows({ cacheDir: testHelperCache, windowsDir })),
    ),
    FactoryTransferStore.layer,
    CommandJobFence.layer,
    EffectOutbox.layer,
    ProjectionStore.layer,
  ).pipe(Layer.provideMerge(layerDatabase));
  const layerClaims = FactoryClaimService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(layerHarness, layerStores, layerRunPreparation, layerReceipts, tracker),
    ),
  );
  const layerRecovery = ProviderRuntimeRecoveryService.layer.pipe(
    Layer.provide(Layer.mergeAll(layerHarness, layerStores, layerSettings, IdAllocator.layer)),
  );
  return FactoryLifecycle.layerUsingStores.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        FactoryCommandPolicy.layer.pipe(Layer.provide(ProcessRunner.layer)),
        FactoryGitReadback.layer.pipe(Layer.provide(layerProjects)),
        FactoryEffects.layerWakes,
        tracker,
        layerProjects,
        layerHarness,
        layerRecovery,
        layerClaims,
      ),
    ),
    Layer.provideMerge(layerRunPreparation),
    Layer.provideMerge(layerThreads),
    Layer.provideMerge(layerGitDriver),
    Layer.provideMerge(layerStores),
  );
};

/**
 * A disposable custody host holding one run's container with a live member and its child, as
 * `FactoryExecutionGenerations.test.ts` runs it. Cleanup signals only its own pid and awaits it.
 */
const spawnHost = (dbPath: string, job: Record<string, unknown>) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const lines = yield* Queue.unbounded<string>();
      const exited = yield* Deferred.make<void>();
      const child = NodeChildProcess.spawn(
        process.execPath,
        [hostFixture, dbPath, JSON.stringify(job)],
        { stdio: ["pipe", "pipe", "inherit"], windowsHide: true },
      );
      child.stdin.on("error", () => {});
      let partial = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        partial += chunk;
        for (let index = partial.indexOf("\n"); index >= 0; index = partial.indexOf("\n")) {
          Queue.offerUnsafe(lines, partial.slice(0, index).trim());
          partial = partial.slice(index + 1);
        }
      });
      child.once("close", () => Deferred.doneUnsafe(exited, Effect.void));
      return { child, next: Queue.take(lines), exited: Deferred.await(exited) };
    }),
    ({ child, exited }) =>
      Effect.gen(function* () {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        yield* exited;
      }),
  );

// Job objects are the Windows mechanism; elsewhere containment is unavailable by design.
describe.runIf(HostProcess.Platform.defaultValue() === "win32")("factory collision restart", () => {
  it.live(
    "a colliding preparation across fresh runtimes over one store keeps the live stage held, fails a never-started stage once, and starts one successor",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: "factory-collision-restart-",
        });
        const repo = path.join(directory, "repo");
        yield* fs.makeDirectory(repo);
        const milestones = yield* makeMilestones;

        const git = (cwd: string, args: ReadonlyArray<string>) =>
          Effect.flatMap(GitVcsDriver.GitVcsDriver, (driver) =>
            driver
              .execute({ operation: "factory-collision-restart-test", cwd, args: [...args] })
              .pipe(Effect.map((result) => result.stdout)),
          );
        const threadOf = (unit: string) =>
          ThreadId.make(`thread:factory-collision-restart:${unit}`);
        const reservationOf = (unit: string) =>
          FactoryReservationId.make(`reservation:factory-collision-restart:${unit}`);
        const worktreeOf = (branch: string) =>
          path.join(directory, "worktrees", "repo", branch.replaceAll("/", "-"));

        const threadView = (threadId: ThreadId) =>
          Effect.flatMap(ThreadManagement.ThreadManagementService, (threads) =>
            threads.getThreadProjection(threadId),
          ).pipe(
            Effect.map((projection) => ({
              runs: projection.runs,
              worktreePath: projection.thread.worktreePath,
              branch: projection.thread.branch,
              failures: projection.turnItems.flatMap((item) =>
                item.type === "command_execution" && item.status === "failed"
                  ? [item.output ?? ""]
                  : [],
              ),
            })),
          );

        /**
         * An admitted stage with no claim of its own, bound before launch as the factory binds
         * it, so only its owner's preparation may run. One with no branch asks for no workspace.
         */
        const admitAndLaunch = (unit: string, itemKey: FactoryItemKey, branch?: string) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const launches = yield* ThreadLaunch.ThreadLaunchService;
            const threadId = threadOf(unit);
            const reservationId = reservationOf(unit);
            const reservation = {
              origin: "admitted",
              reservationId,
              factoryId,
              itemKey,
              poolId: pool,
              units: 1,
              state: "held",
              createdAt: "2026-10-28T00:00:00.000Z",
              decisionKey: sha256(`decision:${unit}`),
              taskKind: "implement",
              itemVersion: "2e74f78829404f3e426104f4d2bb5358",
              policyRevision: "policy-r1",
              configRevision: 1,
              packetDigest: "packet",
              modelSelection,
              execution: {
                commandId: `command:factory-collision-restart:${unit}`,
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
                ${reservationId}, ${factoryId}, 'admitted', 'held', ${reservation.decisionKey},
                ${itemKey}, ${pool}, 1, ${threadId}, ${JSON.stringify(reservation)},
                ${reservation.createdAt}
              )
            `;
            yield* sql`
              INSERT INTO factory_thread_bindings (thread_id, reservation_id)
              VALUES (${threadId}, ${reservationId})
            `;
            const launched = yield* launches.launch({
              commandId: CommandId.make(`command:factory-collision-restart:${unit}`),
              threadId,
              projectId,
              title: `${itemKey} ${unit}`,
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              workspaceStrategy:
                branch === undefined
                  ? { type: "root" as const }
                  : { type: "worktree" as const, baseRef: "main", branch },
              initialMessage: {
                messageId: MessageId.make(`message:factory-collision-restart:${unit}`),
                text: `Implement ${itemKey}.`,
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
            return { threadId, reservationId, runId };
          });

        /** Opens the stage's workspace obligation and runs its owned preparation to its end. */
        const prepare = (stage: {
          readonly threadId: ThreadId;
          readonly reservationId: FactoryReservationId;
          readonly runId: RunId;
        }) =>
          Effect.gen(function* () {
            const store = yield* FactoryStore.FactoryStore;
            const preparation = yield* FactoryRunPreparation.FactoryRunPreparation;
            // The binding kept the launch from preparing it.
            assert.deepStrictEqual(
              (yield* threadView(stage.threadId)).runs.map((run) => run.status),
              ["preparing"],
            );
            const ownerId = PreparationOwnerId.make(`owner:${stage.runId}:1`);
            const commandId = FactoryClaimStore.preparationCommandId(stage.runId);
            yield* store.openWorkspaceObligation({ ...stage, commandId, ownerId });
            const handle = yield* preparation.startOwned({
              commandId,
              threadId: stage.threadId,
              runId: stage.runId,
              ownerId,
            });
            assert.isTrue(Option.isSome(handle));
            const ended = yield* Option.getOrThrow(handle).ended;
            // As the claim service's handoff does: with no container, only a preparation that
            // ran no process is accounted for.
            if (ended.type === "no_external_work") {
              yield* store.settleWorkspaceObligation({
                runId: stage.runId,
                ownerId,
                scope: { type: "no_external_work" },
              });
            }
            return ended;
          });

        const snapshot = (worktree: string) =>
          Effect.gen(function* () {
            return {
              head: yield* git(worktree, ["rev-parse", "HEAD"]),
              branch: yield* git(worktree, ["symbolic-ref", "HEAD"]),
              status: yield* git(worktree, [
                "status",
                "--porcelain=v2",
                "--branch",
                "--untracked-files=all",
              ]),
              tracked: yield* fs.readFile(path.join(worktree, "tracked.txt")),
              staged: yield* fs.readFile(path.join(worktree, "staged.txt")),
              untracked: yield* fs.readFile(path.join(worktree, "notes", "untracked.bin")),
            };
          });

        const custodies = Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
          factory.readState({ factoryId }),
        ).pipe(
          Effect.map((state) =>
            state.reservations.map((reservation) => [
              reservation.reservationId.replace("reservation:factory-collision-restart:", ""),
              reservation.state,
              reservation.custody,
            ]),
          ),
        );
        const writerContainer = (runId: RunId) =>
          Effect.flatMap(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) =>
            Effect.map(generations.observe([runId]), (facts) => facts.get(runId)),
          );

        /** Everything a duplicate would add to: rows, runs, outcomes, releases and worktrees. */
        const ledger = Effect.gen(function* () {
          const store = yield* FactoryStore.FactoryStore;
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const outbox = yield* EffectOutbox.EffectOutboxV2;
          const sql = yield* SqlClient.SqlClient;
          const reservations = yield* store.listReservations(factoryId);
          const stages = [];
          for (const unit of ["earlier", "reopened", "never-started", "successor"]) {
            const reservation = reservations.find(
              (candidate) => candidate.reservationId === reservationOf(unit),
            );
            if (reservation === undefined) continue;
            stages.push({
              unit,
              state: reservation.state,
              releasedReason: reservation.releasedReason,
              runs: (yield* threadView(threadOf(unit))).runs.map((run) => run.id),
              outcomes: (yield* outcomes.listForOrigin(reservationOf(unit))).map((outcome) => [
                outcome.state,
                outcome.report.outcome,
              ]),
              launches: (yield* outbox.listLaunchesForThread(threadOf(unit))).map((launch) => [
                launch.id,
                launch.status,
                launch.attemptCount,
              ]),
            });
          }
          const rows = yield* sql<{
            readonly effect_id: string;
            readonly effect_type: string;
            readonly status: string;
            readonly attempt_count: number;
          }>`
            SELECT effect_id, effect_type, status, attempt_count FROM orchestration_v2_effect_outbox
            ORDER BY effect_id
          `;
          const preparations = [];
          for (const row of rows) {
            if (row.effect_type !== "factory-execution.prepare") continue;
            const { request } = Option.getOrThrow(yield* outbox.get(row.effect_id));
            assert.strictEqual(request.type, "factory-execution.prepare");
            preparations.push({
              id: row.effect_id,
              runId: request.type === "factory-execution.prepare" ? request.runId : undefined,
              status: row.status,
              attempts: row.attempt_count,
            });
          }
          const worktrees = yield* git(repo, ["worktree", "list", "--porcelain"]);
          return {
            reservations: reservations.length,
            stages,
            // Provider launches and tracker writes.
            effects: rows
              .filter((row) => row.effect_type !== "factory-execution.prepare")
              .map((row) => [row.effect_id, row.status, row.attempt_count]),
            preparations,
            worktrees: worktrees.split("\n").filter((line) => line.startsWith("worktree ")),
          };
        });
        type Ledger = Effect.Success<typeof ledger>;
        type Origin = {
          readonly base: string;
          readonly priorBefore: Effect.Success<ReturnType<typeof snapshot>>;
        };
        const withoutPreparations = ({ preparations: _, ...rest }: Ledger) => rest;

        /**
         * Proofs #3 and #5 after a delivery: nothing but a settled replay of an owed run was added,
         * no run owns two live preparations, and the earlier stage stays held, charged and unlaunched.
         */
        const holds = (baseline: Ledger, owed: ReadonlyArray<RunId>, origin: Origin) =>
          Effect.gen(function* () {
            const now = yield* ledger;
            assert.deepStrictEqual(withoutPreparations(now), withoutPreparations(baseline));
            const current = new Map(now.preparations.map((row) => [row.id, row]));
            const live = new Map<RunId | undefined, number>();
            for (const row of now.preparations) {
              const before = baseline.preparations.find((candidate) => candidate.id === row.id);
              if (
                before !== undefined &&
                before.status !== "pending" &&
                before.status !== "running"
              ) {
                assert.deepStrictEqual(row, before);
                continue;
              }
              assert.include(owed, row.runId, `${row.id} replays an owed run`);
              assert.include(["pending", "running", "succeeded"], row.status, row.id);
              if (row.status === "pending" || row.status === "running") {
                live.set(row.runId, (live.get(row.runId) ?? 0) + 1);
              }
            }
            for (const before of baseline.preparations) {
              assert.strictEqual(current.get(before.id)?.runId, before.runId, before.id);
            }
            for (const [runId, count] of live) assert.strictEqual(count, 1, `${runId} owns one`);
            const held = now.stages.filter((stage) => stage.state === "held");
            assert.include(
              held.map((stage) => stage.unit),
              "earlier",
            );
            assert.deepStrictEqual(
              (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
                factoryId,
              })).pools.map((entry) => entry.occupiedUnits),
              [held.length],
            );
            assert.deepStrictEqual(yield* snapshot(prior), origin.priorBefore);
            if (now.worktrees.length === 3) {
              const next = worktreeOf(successorBranch);
              assert.strictEqual((yield* git(next, ["rev-parse", "HEAD"])).trim(), origin.base);
              assert.strictEqual(
                yield* git(next, ["status", "--porcelain=v2", "--untracked-files=all"]),
                "",
              );
            }
          });

        /**
         * Claims one preparation row as `EffectOutbox.claimNext` claims, under its eligibility:
         * pending, due, and no running or earlier pending row on its thread. Nothing else is claimed.
         */
        const claimPreparation = (effectId: string, workerId: string) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const outbox = yield* EffectOutbox.EffectOutboxV2;
            const now = yield* DateTime.now;
            const nowIso = DateTime.formatIso(now);
            const leaseExpiresAt = DateTime.formatIso(DateTime.add(now, { milliseconds: 30_000 }));
            const claimed = yield* sql<{ readonly effect_id: string }>`
              UPDATE orchestration_v2_effect_outbox
              SET
                status = 'running',
                attempt_count = attempt_count + 1,
                lease_owner = ${workerId},
                lease_expires_at = ${leaseExpiresAt},
                updated_at = ${nowIso},
                last_error = NULL
              WHERE effect_id = (
                SELECT candidate.effect_id
                FROM orchestration_v2_effect_outbox AS candidate
                WHERE candidate.effect_id = ${effectId}
                  AND candidate.effect_type = 'factory-execution.prepare'
                  AND candidate.available_at <= ${nowIso}
                  AND candidate.status = 'pending'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM orchestration_v2_effect_outbox AS active
                    WHERE active.thread_id = candidate.thread_id
                      AND (
                        active.status = 'running'
                        OR (active.status = 'pending' AND active.rowid < candidate.rowid)
                      )
                      AND active.effect_type != 'thread-title.generate'
                  )
              )
              RETURNING effect_id
            `;
            assert.deepStrictEqual(
              claimed.map((row) => row.effect_id),
              [effectId],
              `${effectId} is claimable`,
            );
            return Option.getOrThrow(yield* outbox.get(effectId));
          });

        /**
         * One runtime's delivery: each pass's queued preparations are claimed, run through the
         * claim service as `EffectWorker` runs them, and settled with the real outbox. Its
         * baseline is this runtime's own, taken at its first pass.
         */
        const makeWorker = (workerId: string, owed: ReadonlyArray<RunId>, origin: Origin) => {
          let baseline: Ledger | undefined;
          const deliver = (effect: EffectOutbox.OrchestrationEffectV2) =>
            Effect.gen(function* () {
              const claims = yield* FactoryClaimService.FactoryClaimService;
              const outbox = yield* EffectOutbox.EffectOutboxV2;
              const { request } = effect;
              if (request.type !== "factory-execution.prepare") {
                return assert.fail(`${effect.id} is not a preparation`);
              }
              const exit = yield* Effect.exit(
                claims.prepareFirstUse({
                  reservationId: request.reservationId,
                  runId: request.runId,
                }),
              );
              if (Exit.isFailure(exit)) {
                const error = Cause.pretty(exit.cause);
                assert.isTrue(yield* outbox.fail({ effectId: effect.id, workerId, error }));
                return assert.fail(`${effect.id} failed: ${error}`);
              }
              assert.isTrue(yield* outbox.succeed({ effectId: effect.id, workerId }));
            });
          const pass = (trigger: FactoryLifecycle.FactoryTrigger, leaveRunning?: RunId) =>
            Effect.gen(function* () {
              const factory = yield* FactoryLifecycle.FactoryLifecycle;
              const sql = yield* SqlClient.SqlClient;
              const result = yield* factory.reconcile({ factoryId, trigger });
              assert.strictEqual(result.type, "collected");
              baseline ??= yield* ledger;
              const queued = yield* sql<{ readonly effect_id: string }>`
                SELECT effect_id FROM orchestration_v2_effect_outbox
                WHERE effect_type = 'factory-execution.prepare' AND status = 'pending'
                ORDER BY available_at, created_at, effect_id
              `;
              for (const { effect_id: effectId } of queued) {
                const effect = yield* claimPreparation(effectId, workerId);
                // Claimed and never settled, as a process that died mid-effect leaves it.
                if (
                  effect.request.type === "factory-execution.prepare" &&
                  effect.request.runId === leaveRunning
                ) {
                  continue;
                }
                yield* deliver(effect);
                yield* holds(baseline, owed, origin);
              }
              return result.type === "collected" ? result.admissions : [];
            });
          const rebase = Effect.gen(function* () {
            baseline = yield* ledger;
          });
          return { pass, rebase };
        };
        const recover = Effect.flatMap(
          ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService,
          (recovery) => recovery.recover,
        );
        /** Every replay of a run its recovery id owns, as `[status, attempts]`. */
        const replaysOf = (runId: RunId) =>
          Effect.flatMap(EffectOutbox.EffectOutboxV2, (outbox) =>
            outbox.listByCommandId(CommandId.make(`factory-recovery-check:${runId}`)),
          ).pipe(
            Effect.map((rows) =>
              rows.flatMap((row) =>
                row.request.type === "factory-execution.prepare" && row.request.runId === runId
                  ? [[row.status, row.attemptCount] as const]
                  : [],
              ),
            ),
          );
        const settledReplays = (runId: RunId) =>
          Effect.map(
            replaysOf(runId),
            (rows) => rows.filter(([status]) => status === "succeeded").length,
          );
        /** The runs some settled replay prepared, read from their durable rows. */
        const replayedRuns = (runIds: ReadonlyArray<RunId>) =>
          Effect.gen(function* () {
            const outbox = yield* EffectOutbox.EffectOutboxV2;
            const replayed = [];
            for (const runId of runIds) {
              // The stage's own first preparation never ran through the outbox.
              assert.isTrue(
                Option.isNone(yield* outbox.get(`effect:factory-execution.prepare:${runId}`)),
              );
              if ((yield* settledReplays(runId)) > 0) replayed.push(runId);
            }
            return replayed;
          });

        const trackedBytes = new TextEncoder().encode("base\nedited by the earlier unit\r\n");
        const stagedBytes = new TextEncoder().encode("staged, not committed\n");
        const untrackedBytes = Uint8Array.from([0, 1, 2, 255, 13, 10]);
        const prior = worktreeOf(collidingBranch);

        // The first runtime: the earlier unit, its live writer, the collision, an unclaimed stage.
        const first = yield* Effect.gen(function* () {
          yield* git(repo, ["init", "-b", "main"]);
          yield* git(repo, ["config", "user.name", "Test"]);
          yield* git(repo, ["config", "user.email", "test@example.test"]);
          yield* git(repo, ["config", "core.autocrlf", "false"]);
          yield* fs.writeFileString(path.join(repo, "tracked.txt"), "base\n");
          yield* git(repo, ["add", "tracked.txt"]);
          yield* git(repo, ["commit", "-m", "base"]);
          const base = (yield* git(repo, ["rev-parse", "HEAD"])).trim();
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          yield* factory.configure({
            factoryId,
            projectId,
            policyRevision: "policy-r1",
            enabled: true,
            pools: [{ poolId: pool, capacityUnits: 4 }],
            execution: { modelSelection, runtimeMode: "full-access", interactionMode: "default" },
            packet: { briefSchemaVersion: "brief-v1", helper: null },
            artifactRoot: directory,
            claim: {
              host: "github.com",
              accountId: "9001",
              foreignClaimLabels: [],
              foreignClaimCommentPatterns: [],
              observedClaimPool: { poolId: pool, units: 1 },
            },
            policy: {
              executable: process.execPath,
              script: policyScript,
              sha256: sha256(NodeFS.readFileSync(policyScript)),
            },
          });

          // The earlier unit made the branch and its worktree, and its writer is still at work in
          // it: a host holding the run's container with a live member, outliving every runtime.
          const earlier = yield* admitAndLaunch("earlier", collidingItem, collidingBranch);
          assert.deepStrictEqual(yield* prepare(earlier), {
            type: "external_work",
            boundary: "process",
          });
          assert.strictEqual((yield* threadView(earlier.threadId)).worktreePath, prior);
          const writer = yield* spawnHost(`${directory}/t3/state.sqlite`, {
            mode: "hold",
            port: milestones.port,
            ...earlier,
          });
          assert.match(yield* writer.next, /^held /);
          yield* milestones.arrived("member");
          yield* milestones.arrived("child");
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

          // The reopened item's unit derives the same branch: Git refuses, and its run fails.
          const reopened = yield* admitAndLaunch("reopened", collidingItem, collidingBranch);
          assert.deepStrictEqual(yield* prepare(reopened), {
            type: "external_work",
            boundary: "process",
          });
          const refused = yield* threadView(reopened.threadId);
          assert.deepStrictEqual(
            refused.runs.map((run) => run.status),
            ["failed"],
          );
          assert.include(refused.failures.at(-1), "(branch_already_exists)");
          assert.isNull(refused.worktreePath);
          assert.deepStrictEqual(yield* snapshot(prior), priorBefore);

          // Separately, a stage whose launch nothing ever claimed and no container ever held.
          const unclaimed = yield* admitAndLaunch("never-started", neverStartedItem);
          assert.deepStrictEqual(yield* prepare(unclaimed), {
            type: "no_external_work",
            fiber: "succeeded",
          });
          assert.deepStrictEqual(yield* custodies, [
            ["earlier", "held", { state: "live", reasons: ["run_active", "launch_pending"] }],
            ["never-started", "held", { state: "live", reasons: ["run_active", "launch_pending"] }],
            [
              "reopened",
              "held",
              { state: "unknown", reasons: ["workspace_obligation_unresolved"] },
            ],
          ]);
          return { base, earlier, reopened, unclaimed, writer, priorBefore };
        }).pipe(Effect.provide(layerRuntime(directory, repo)));

        // A fresh runtime over the same file and repository.
        const restarted = yield* Effect.gen(function* () {
          const worker = makeWorker(
            "factory-collision-restart:runtime-2",
            [first.earlier.runId, first.reopened.runId],
            first,
          );
          yield* recover;
          assert.deepStrictEqual(yield* worker.pass("restart"), []);
          assert.deepStrictEqual(yield* worker.pass("operation"), []);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const outbox = yield* EffectOutbox.EffectOutboxV2;
          const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
          // The earlier stage is held and charged, its writer's container still unproven; the
          // replay its pass queued prepared nothing. The never-started stage failed and released.
          assert.deepStrictEqual(yield* custodies, [
            ["earlier", "held", { state: "unknown", reasons: ["workspace_obligation_unresolved"] }],
            ["never-started", "released", { state: "quiescent", reasons: ["never_started"] }],
            [
              "reopened",
              "held",
              { state: "unknown", reasons: ["workspace_obligation_unresolved"] },
            ],
          ]);
          assert.deepStrictEqual(
            (yield* factory.readState({ factoryId })).pools.map((entry) => entry.occupiedUnits),
            [2],
          );
          assert.deepStrictEqual(yield* writerContainer(first.earlier.runId), {
            type: "unknown",
            reason: "container_unverified",
          });
          assert.sameMembers(
            yield* replayedRuns([first.earlier.runId, first.reopened.runId, first.unclaimed.runId]),
            [first.earlier.runId, first.reopened.runId],
          );
          assert.deepStrictEqual(
            (yield* threadView(first.earlier.threadId)).runs.map((run) => run.id),
            [first.earlier.runId],
          );
          assert.deepStrictEqual(yield* snapshot(prior), first.priorBefore);
          // Its one launch was never claimed, and no container was ever opened for it.
          assert.deepStrictEqual(
            (yield* outbox.listLaunchesForThread(first.unclaimed.threadId)).map((launch) => [
              launch.status,
              launch.attemptCount,
            ]),
            [["cancelled", 0]],
          );
          assert.deepStrictEqual(yield* generations.generations(first.unclaimed.runId), []);

          // The successor's distinct branch prepares beside the prior worktree.
          const successor = yield* admitAndLaunch("successor", collidingItem, successorBranch);
          assert.deepStrictEqual(yield* prepare(successor), {
            type: "external_work",
            boundary: "process",
          });
          const made = yield* threadView(successor.threadId);
          assert.strictEqual(made.worktreePath, worktreeOf(successorBranch));
          assert.strictEqual(made.branch, successorBranch);
          const next = worktreeOf(successorBranch);
          assert.strictEqual((yield* git(next, ["rev-parse", "HEAD"])).trim(), first.base);
          assert.strictEqual(
            yield* git(next, ["status", "--porcelain=v2", "--untracked-files=all"]),
            "",
          );

          const settled = yield* ledger;
          assert.deepStrictEqual((yield* custodies).at(-1), [
            "successor",
            "held",
            { state: "live", reasons: ["run_active", "launch_pending"] },
          ]);
          assert.strictEqual(settled.worktrees.length, 3);
          assert.deepStrictEqual(
            settled.stages.map((stage) => [
              stage.unit,
              stage.state,
              stage.releasedReason,
              stage.runs.length,
              stage.outcomes,
            ]),
            [
              ["earlier", "held", undefined, 1, []],
              ["reopened", "held", undefined, 1, []],
              ["never-started", "released", "outcome_verified", 1, [["verified", "failed"]]],
              ["successor", "held", undefined, 1, []],
            ],
          );
          // Repeated passes after the restart add nothing but settled replays.
          yield* worker.rebase;
          for (const _pass of [1, 2, 3])
            assert.deepStrictEqual(yield* worker.pass("operation"), []);
          assert.deepStrictEqual(withoutPreparations(yield* ledger), withoutPreparations(settled));
          // Each of the five passes after a settled replay queued a fresh one, and it was delivered.
          assert.strictEqual(yield* settledReplays(first.earlier.runId), 5);
          assert.strictEqual(yield* settledReplays(first.reopened.runId), 5);
          // The runtime ends with the earlier stage's replay claimed and unsettled.
          assert.deepStrictEqual(yield* worker.pass("operation", first.earlier.runId), []);
          const unsettled = (yield* replaysOf(first.earlier.runId)).filter(
            ([status]) => status !== "succeeded",
          );
          assert.deepStrictEqual(unsettled, [["running", 1]]);
          const left = (yield* ledger).preparations.find((row) => row.status === "running")!;
          assert.strictEqual(
            Option.getOrThrow(yield* outbox.get(left.id)).leaseOwner,
            "factory-collision-restart:runtime-2",
          );
          return { settled: yield* ledger, successor, left: left.id };
        }).pipe(Effect.provide(layerRuntime(directory, repo)));

        // A second fresh runtime: its recovery and passes add nothing either.
        yield* Effect.gen(function* () {
          const worker = makeWorker(
            "factory-collision-restart:runtime-3",
            [first.earlier.runId, first.reopened.runId, restarted.successor.runId],
            first,
          );
          const outbox = yield* EffectOutbox.EffectOutboxV2;
          yield* recover;
          // Startup recovery requeued the replay the last runtime left mid-effect.
          const requeued = Option.getOrThrow(yield* outbox.get(restarted.left));
          assert.deepStrictEqual(
            [requeued.status, requeued.attemptCount, requeued.leaseOwner],
            ["pending", 1, null],
          );
          assert.deepStrictEqual(yield* worker.pass("restart"), []);
          assert.deepStrictEqual(yield* worker.pass("operation"), []);
          assert.deepStrictEqual(yield* custodies, [
            ["earlier", "held", { state: "unknown", reasons: ["workspace_obligation_unresolved"] }],
            ["never-started", "released", { state: "quiescent", reasons: ["never_started"] }],
            [
              "reopened",
              "held",
              { state: "unknown", reasons: ["workspace_obligation_unresolved"] },
            ],
            [
              "successor",
              "held",
              { state: "unknown", reasons: ["workspace_obligation_unresolved"] },
            ],
          ]);
          // Recovery cancelled the successor's unclaimed launch and changed nothing else.
          const closing = withoutPreparations(restarted.settled);
          const [launch] = closing.stages.find((stage) => stage.unit === "successor")!.launches;
          assert.deepStrictEqual(launch?.slice(1), ["pending", 0]);
          const cancelled = [launch![0], "cancelled", 0];
          assert.deepStrictEqual(withoutPreparations(yield* ledger), {
            ...closing,
            effects: closing.effects.map((row) => (row[0] === launch![0] ? cancelled : row)),
            stages: closing.stages.map((stage) =>
              stage.unit === "successor" ? { ...stage, launches: [cancelled] } : stage,
            ),
          });
          // The replay left running was delivered once, here; the successor's replay prepared
          // nothing again.
          const redelivered = Option.getOrThrow(yield* outbox.get(restarted.left));
          assert.deepStrictEqual([redelivered.status, redelivered.attemptCount], ["succeeded", 2]);
          assert.sameMembers(
            yield* replayedRuns([
              first.earlier.runId,
              first.reopened.runId,
              first.unclaimed.runId,
              restarted.successor.runId,
            ]),
            [first.earlier.runId, first.reopened.runId, restarted.successor.runId],
          );
          // Later passes queue and deliver fresh replays again: one per pass, and the earlier
          // stage's restart pass delivered the requeued one instead of queueing another.
          for (const _pass of [1, 2]) assert.deepStrictEqual(yield* worker.pass("operation"), []);
          assert.strictEqual(yield* settledReplays(first.earlier.runId), 5 + 1 + 3);
          assert.strictEqual(yield* settledReplays(first.reopened.runId), 6 + 4);
          assert.strictEqual(yield* settledReplays(restarted.successor.runId), 4);
          assert.deepStrictEqual(
            Option.getOrThrow(yield* outbox.get(restarted.left)).attemptCount,
            2,
          );
          const next = worktreeOf(successorBranch);
          assert.strictEqual((yield* git(next, ["rev-parse", "HEAD"])).trim(), first.base);
          assert.strictEqual(
            yield* git(next, ["status", "--porcelain=v2", "--untracked-files=all"]),
            "",
          );
          assert.deepStrictEqual(yield* writerContainer(first.earlier.runId), {
            type: "unknown",
            reason: "container_unverified",
          });
          assert.deepStrictEqual(yield* snapshot(prior), first.priorBefore);
          assert.deepStrictEqual(first.priorBefore.tracked, trackedBytes);
          assert.deepStrictEqual(first.priorBefore.staged, stagedBytes);
          assert.deepStrictEqual(first.priorBefore.untracked, untrackedBytes);
        }).pipe(Effect.provide(layerRuntime(directory, repo)));

        // The writer ends normally, closing its container and everything it held.
        first.writer.child.stdin.write("exit\n");
        yield* first.writer.exited;
        yield* milestones.ended("child");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
