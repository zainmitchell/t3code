// @effect-diagnostics nodeBuiltinImport:off - sha256 of test fixtures.
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  GitCommandError,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  EnvironmentId,
  EventId,
  FactoryClaimCarrierKey,
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  FactoryReadGeneration,
  type FactoryReportInput,
  FactoryReservationId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ProviderCapabilities,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ScheduledTaskId,
  type ServerProvider,
  SourceControlProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import { McpSchema, McpServer } from "effect/ai";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderRuntimeRecoveryService from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../orchestration-v2/ThreadSearch.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ProviderTurnStartServiceTestkit from "../orchestration-v2/ProviderTurnStartService.testkit.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { ProviderAdapterOpenSessionError } from "@t3tools/provider-core/server/ProviderAdapter";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import {
  GitHubPullRequestApi,
  GitHubRequestPolicy,
  GitHubRest,
} from "@t3tools/source-control-github/server/api";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import * as ExecutionJoin from "@t3tools/shared/ExecutionJoin";
import * as FactoryCommandPolicy from "./FactoryCommandPolicy.ts";
import * as FactoryGitReadback from "./FactoryGitReadback.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import { issueObservation } from "./factoryClaimPolicy.ts";
import { factoryStateView } from "./factoryStateView.ts";
import * as FactoryClaimService from "./FactoryClaimService.ts";
import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import type { FactoryCustody } from "./factoryCustody.ts";
import * as FactoryRunPreparation from "./FactoryRunPreparation.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import {
  type HistoricalProvenance,
  HistoricalProvenanceSource,
  type HostBoot,
  HostBootReader,
  HostBootUnreadable,
} from "./factoryHistoricalTermination.ts";
import { criterionToken, outputRootName } from "./factoryCoordination.ts";
import * as FactoryTracker from "./FactoryTracker.ts";
import * as FactoryTransferStore from "./FactoryTransferStore.ts";
import type { FactoryTransferInput } from "./factoryTransfers.ts";
import * as CommandJobFence from "../commandJobs/CommandJobFence.ts";
import * as CommandJobs from "../commandJobs/CommandJobs.ts";

const layerPlatformTest = Layer.merge(
  NodeServices.layer,
  Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    resolveLink: () => Effect.die("unused title link"),
  }),
);

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-factory-lifecycle-",
});

const driver = ProviderDriverKind.make("codex");
const betaSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;

/**
 * Every provider turn the runtime actually starts. A started turn's scripted process never
 * reports exit, so nothing here proves it stopped.
 */
export class ProviderStarts extends Context.Service<
  ProviderStarts,
  Ref.Ref<ReadonlyArray<ProviderAdapter.ProviderAdapterV2TurnInput>>
>()("t3/factory/FactoryLifecycle.test/ProviderStarts") {}

/** Every steer the runtime sends into a scripted turn that is still running. */
class ProviderSteers extends Context.Service<
  ProviderSteers,
  Ref.Ref<ReadonlyArray<ProviderAdapter.ProviderAdapterV2SteerInput>>
>()("t3/factory/FactoryLifecycle.test/ProviderSteers") {}

/**
 * How the scripted provider's process joins. By default as the real runner does, under its own
 * session; `legacy` with no execution context, so no
 * session is recorded; `skip` not at all, for a process that started outside every container;
 * `failOpen` never, because opening the session itself fails, as connector #49's did.
 */
class ScriptedJoinTarget extends Context.Service<
  ScriptedJoinTarget,
  { legacy: boolean; skip: boolean; failOpen: boolean }
>()("t3/factory/FactoryLifecycle.test/ScriptedJoinTarget") {}
const layerScriptedJoinTarget = Layer.sync(ScriptedJoinTarget, () => ({
  legacy: false,
  skip: false,
  failOpen: false,
}));

/**
 * What the scripted contained provider's pending-work probe answers: `idle` by default, `pending`
 * while a wake is in flight that no run records yet, `fails` when the runtime cannot answer.
 */
class ScriptedPendingWork extends Context.Service<
  ScriptedPendingWork,
  { answer: "idle" | "pending" | "fails" }
>()("t3/factory/FactoryLifecycle.test/ScriptedPendingWork") {}
const layerScriptedPendingWork = Layer.sync(ScriptedPendingWork, () => ({
  answer: "idle" as const,
}));

const scriptedSession = (
  instanceId: ProviderInstanceId,
  capabilities: OrchestrationV2ProviderCapabilities,
  starts: ProviderStarts["Service"],
  steers: ProviderSteers["Service"],
  sessionDriver: ProviderDriverKind,
  executionJoin: ExecutionJoin.ExecutionJoinShape | undefined,
  joinTarget: ScriptedJoinTarget["Service"] | undefined,
  pendingWork?: ScriptedPendingWork["Service"],
): ProviderAdapter.ProviderAdapterV2["Service"]["openSession"] =>
  Effect.fnUntraced(function* (input) {
    if (joinTarget?.failOpen === true) {
      return yield* new ProviderAdapterOpenSessionError({
        driver: sessionDriver,
        providerSessionId: input.providerSessionId,
      });
    }
    // A contained driver's process joins its run's container, as the real Claude runner's query
    // for each thread does; the scripted process is admitted once and then counts as gone
    // (members are scripted).
    const joinContainer = (threadId: ThreadId) =>
      executionJoin === undefined || joinTarget?.skip === true
        ? Effect.void
        : Effect.gen(function* () {
            const join = yield* (
              joinTarget?.legacy === true
                ? executionJoin.forThread(threadId)
                : executionJoin.forThread(threadId, {
                    providerSessionId: input.providerSessionId,
                  })
            ).pipe(Effect.orDie);
            if (Option.isNone(join)) return;
            const ticket = yield* join
              .value("scripted-provider", [], "provider")
              .pipe(Effect.orDie);
            yield* ticket.admit(1).pipe(Effect.orDie);
          });
    const now = yield* DateTime.now;
    const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
    const turns = new Map<string, OrchestrationV2ProviderTurn>();
    const pendingAnswer = Effect.suspend(() =>
      pendingWork?.answer === "fails"
        ? Effect.die(new Error("scripted pending-work probe failed"))
        : Effect.succeed(pendingWork?.answer === "pending"),
    );
    return {
      ...(pendingWork === undefined
        ? {}
        : {
            hasPendingBackgroundWork: pendingAnswer,
            hasPendingBackgroundWorkForThread: () => pendingAnswer,
          }),
      instanceId,
      driver: sessionDriver,
      providerSessionId: input.providerSessionId,
      providerSession: {
        id: input.providerSessionId,
        driver: sessionDriver,
        providerInstanceId: instanceId,
        status: "ready",
        cwd: "/workspace/beta",
        model: "scripted",
        capabilities,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
      events: Stream.fromQueue(events),
      ensureThread: ({ threadId }) =>
        Effect.as(joinContainer(threadId), {
          id: ProviderThreadId.make(`provider-thread:scripted:${threadId}`),
          driver: sessionDriver,
          providerInstanceId: instanceId,
          providerSessionId: input.providerSessionId,
          appThreadId: threadId,
          ownerNodeId: null,
          nativeThreadRef: {
            driver: sessionDriver,
            nativeId: `native:${threadId}`,
            strength: "strong",
          },
          nativeConversationHeadRef: null,
          status: "idle",
          firstRunOrdinal: null,
          lastRunOrdinal: null,
          handoffIds: [],
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
        }),
      resumeThread: ({ providerThread }) =>
        Effect.as(
          providerThread.appThreadId === null
            ? Effect.void
            : joinContainer(providerThread.appThreadId),
          providerThread,
        ),
      startTurn: (turn) =>
        Effect.gen(function* () {
          yield* Ref.update(starts, (all) => [...all, turn]);
          const providerTurn: OrchestrationV2ProviderTurn = {
            id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
            providerThreadId: turn.providerThread.id,
            nodeId: turn.rootNodeId,
            runAttemptId: turn.attemptId,
            nativeTurnRef: {
              driver: sessionDriver,
              nativeId: `native-turn:${turn.attemptId}`,
              strength: "strong",
            },
            ordinal: turn.providerTurnOrdinal,
            status: "running",
            startedAt: now,
            completedAt: null,
          };
          turns.set(providerTurn.id, providerTurn);
          yield* Queue.offer(events, {
            type: "provider_turn.updated",
            driver: sessionDriver,
            providerTurn,
          });
        }),
      steerTurn: (steer) => Ref.update(steers, (all) => [...all, steer]),
      // Confirms the turn ended; that says nothing about work the turn left running.
      interruptTurn: (interrupt) =>
        Effect.gen(function* () {
          const running = turns.get(interrupt.providerTurnId);
          if (running === undefined) return;
          yield* Queue.offer(events, {
            type: "provider_turn.updated",
            driver: sessionDriver,
            providerTurn: { ...running, status: "interrupted", completedAt: yield* DateTime.now },
          });
        }),
      respondToRuntimeRequest: () => Effect.die("unused respondToRuntimeRequest"),
      readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
      rollbackThread: () => Effect.die("unused rollbackThread"),
      // A native fork opens the target the way ensureThread opens a thread.
      forkThread: ({ targetThreadId }) =>
        Effect.succeed({
          id: ProviderThreadId.make(`provider-thread:scripted:${targetThreadId}`),
          driver: sessionDriver,
          providerInstanceId: instanceId,
          providerSessionId: input.providerSessionId,
          appThreadId: targetThreadId,
          ownerNodeId: null,
          nativeThreadRef: {
            driver: sessionDriver,
            nativeId: `native-fork:${targetThreadId}`,
            strength: "strong",
          },
          nativeConversationHeadRef: null,
          status: "idle",
          firstRunOrdinal: null,
          lastRunOrdinal: null,
          handoffIds: [],
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
        }),
    };
  });

const testProviderInstance = (
  instanceId: ProviderInstanceId,
  capabilities: OrchestrationV2ProviderCapabilities,
  starts: ProviderStarts["Service"],
  steers: ProviderSteers["Service"],
  driverKind: ProviderDriverKind = driver,
  executionJoin?: ExecutionJoin.ExecutionJoinShape,
  joinTarget?: ScriptedJoinTarget["Service"],
  pendingWork?: ScriptedPendingWork["Service"],
) =>
  ({
    instanceId,
    driverKind,
    continuationIdentity: { driverKind, continuationKey: `${instanceId}:test` },
    displayName: `Test ${instanceId}`,
    enabled: true,
    snapshot: { getSnapshot: Effect.succeed({}) } as unknown as ProviderInstance["snapshot"],
    orchestrationAdapter: {
      instanceId,
      driver: driverKind,
      getCapabilities: () => Effect.succeed(capabilities),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
      openSession: scriptedSession(
        instanceId,
        capabilities,
        starts,
        steers,
        driverKind,
        executionJoin,
        joinTarget,
        pendingWork,
      ),
    } as ProviderAdapter.ProviderAdapterV2["Service"],
    textGeneration: {} as ProviderInstance["textGeneration"],
  }) satisfies ProviderInstance;

const layerProviderStarts = Layer.mergeAll(
  Layer.effect(
    ProviderStarts,
    Ref.make<ReadonlyArray<ProviderAdapter.ProviderAdapterV2TurnInput>>([]),
  ),
  Layer.effect(
    ProviderSteers,
    Ref.make<ReadonlyArray<ProviderAdapter.ProviderAdapterV2SteerInput>>([]),
  ),
);

/** An empty scratch folder as the project workspace, so provider sessions can open there. */
class FactoryWorkspace extends Context.Service<FactoryWorkspace, string>()(
  "t3/factory/FactoryLifecycle.test/FactoryWorkspace",
) {}
/** How the next issue-comment create behaves; GitHub offers no other guarantee to lean on. */
type CreateOutcome =
  | { readonly type: "apply" }
  /** The comment is created, but the response never reaches T3 (a lost response). */
  | { readonly type: "apply_then_lose" }
  | { readonly type: "fail_before_apply" }
  | { readonly type: "reject"; readonly status: number }
  | { readonly type: "server_error"; readonly status: number };

interface FakeComment {
  readonly id: number;
  readonly body: string;
  readonly user: { readonly id: number; readonly login: string };
  readonly created_at: string;
}

/** A pull request on the code repository; GitHub tracks its head branch until it merges. */
interface FakePull {
  readonly number: number;
  readonly repository: string;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  state: "open" | "closed";
  merged: { readonly head: string; readonly commit: string } | undefined;
  /** GitHub refuses to merge a draft; only the GraphQL ready-for-review mutation clears it. */
  draft?: boolean;
}

interface FakeIssue {
  readonly number: number;
  state: "open" | "closed";
  title: string;
  body: string;
  labels: Array<string>;
  comments: Array<FakeComment>;
  /** Set on an issue created through the API: its numeric id, author and GitHub's creation time. */
  readonly created?: {
    readonly id: number;
    readonly user: { readonly id: number };
    readonly at: number;
  };
  /** Relations GitHub answers for; an issue without them answers not found, as seeded ones do. */
  parentNumber?: number;
  blockerNumbers?: Array<number>;
  /** GitHub's issues API also answers a pull request's number, marked with `pull_request`. */
  pullRequest?: boolean;
}

/**
 * An in-memory GitHub issue tracker behind the real `GitHubRest` interface. Every create makes a
 * new comment, as GitHub does; there is no compare-and-set or idempotency key.
 */
interface GitHubFakeState {
  readonly issues: Map<string, FakeIssue>;
  readonly requests: Array<{
    readonly method: string;
    readonly path: string;
    readonly query?: string;
  }>;
  readonly outcomes: Array<CreateOutcome>;
  /** Runs inside a create before it applies, so a test can land a foreign claim first. */
  beforeCreate: Effect.Effect<void> | undefined;
  /** Runs before a comment is read by id, so a test can stop the reader there. */
  beforeCommentRead: Effect.Effect<void> | undefined;
  /** Runs before an issue is read, so a test can hold a collection pass there. */
  beforeIssueRead: Effect.Effect<void> | undefined;
  /** Runs once an issue read is answered, so a test can change the issue behind its reader. */
  afterIssueRead: ((issueNumber: number) => Effect.Effect<void>) | undefined;
  /** Issues whose reads never answer, as an overloaded tracker's would not in time. */
  readonly slowIssues: Set<number>;
  nextCommentId: number;
  readonly pulls: Map<number, FakePull>;
  /** The code repository's branches on GitHub, as pushes leave them. */
  readonly remoteBranches: Map<string, string>;
  /** Each commit's required check as CI reports it; a commit without one is still running. */
  readonly checks: Map<string, "success" | "failure">;
  /** Set to make the next merge apply but its answer be lost. */
  loseNextMerge: boolean;
  nextPullNumber: number;
  /** Commit statuses by sha and context, as GitHub records the latest of each. */
  readonly statuses: Map<string, Map<string, string>>;
  nextIssueNumber: number;
  /** Set to make the next issue create apply but its answer be lost. */
  loseNextIssueCreate: boolean;
  /** Created issues the `since` listing does not show yet, as a lagging list would not. */
  readonly unlistedIssues: Set<number>;
  /** Set to keep every issue created from now on out of the `since` listing. */
  listingLags: boolean;
  /** How far GitHub's clock runs behind this host's, in milliseconds. */
  clockBehindMs: number;
  /** Issues whose blocked-by writes GitHub refuses with a validation error. */
  readonly refuseBlockedBy: Set<number>;
  /** Issues whose next read fails before GitHub answers, once each. */
  readonly failNextIssueRead: Set<number>;
  /** Set to make the next blocked-by write apply but its answer be lost. */
  loseNextBlockedBy: boolean;
  /** Set to end the server process at the next issue create, before or after GitHub applies it. */
  processLossAtNextIssueCreate: "before" | "after" | undefined;
  /** Runs inside an issue create before it applies, so a test can hold it in flight. */
  beforeIssueCreate: Effect.Effect<void> | undefined;
  /** Set to make the next marker listing fail before GitHub answers. */
  failNextMarkerListing: boolean;
  /** Status contexts branch protection requires before a pull request is clean. */
  readonly requiredContexts: Set<string>;
  /** What GitHub answers an issue's read with, for as long as the entry stays. */
  readonly issueReadErrors: Map<number, GitHubRequestPolicy.GitHubApiError>;
  /** While set, open-issue listings fail before GitHub answers. */
  listingUnreachable: boolean;
  /** While set, the factory account's identity read fails with it before any request. */
  identityFailure: GitHubPullRequestApi.GitHubPullRequestApiError | undefined;
  identityReads: number;
  /** Parents whose sub-issue listing fails before GitHub answers. */
  unlistedSubIssues?: Set<number>;
}

class GitHubFake extends Context.Service<GitHubFake, GitHubFakeState>()(
  "t3/factory/FactoryLifecycle.test/GitHubFake",
) {}

/** The legacy command job a transfer takes work from: its receipts and whether a pass runs. */
class CommandJobsFake extends Context.Service<
  CommandJobsFake,
  { description: CommandJobs.CommandJobDescription; running: boolean }
>()("t3/factory/FactoryLifecycle.test/CommandJobsFake") {}

const layerCommandJobsFake = Layer.effect(
  CommandJobs.CommandJobs,
  Effect.map(CommandJobsFake, (fake) =>
    CommandJobs.CommandJobs.of({
      run: () => Effect.die("the factory never runs a legacy job"),
      requestPass: () => Effect.succeed(false),
      stop: () => Effect.void,
      wakeups: Stream.never,
      describe: (jobName) =>
        jobName === fake.description.job
          ? Effect.succeed(fake.description)
          : Effect.fail(
              new CommandJobs.CommandJobError({
                message: `Command job "${jobName}" is not configured.`,
              }),
            ),
      running: () => Effect.sync(() => fake.running),
    }),
  ),
).pipe(
  Layer.provideMerge(
    Layer.sync(CommandJobsFake, () => ({
      description: {
        job: "none",
        projectId: ProjectId.make("project:none"),
        receiptsSha256: null,
        lastPass: null,
        workers: [],
      },
      running: false,
    })),
  ),
);

/** The admission policy this process has installed; a test turns it off to model none yet. */
interface PolicyFakeState {
  available: boolean;
  /** The policy revisions each pass resolved its policy for, in order. */
  readonly revisions: Array<string>;
  propose: ProposeFn;
  /** Set to decide a whole pass at once, as a project policy that weighs work under way does. */
  decide: FactoryLifecycle.FactoryAdmissionProposer["decide"] | undefined;
  /** Set to make the policy fail a whole pass, as a broken pin or rules adoption would. */
  failAll: string | undefined;
  /** The work under way each pass showed the policy, latest last. */
  readonly active: Array<ReadonlyArray<FactoryLifecycle.FactoryPolicyActive>>;
}

type ProposeFn = (
  input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
  } & FactoryLifecycle.FactoryPolicyItem,
) => Effect.Effect<FactoryLifecycle.FactoryPolicyDecision>;

/** A proposer that decides each item on its own, in the order the pass read them. */
const perItemPolicy = (propose: ProposeFn): FactoryLifecycle.FactoryAdmissionProposer => ({
  decide: ({ configuration, items }) =>
    Effect.forEach(items, (item) =>
      Effect.map(propose({ configuration, ...item }), (decision) => ({
        itemKey: item.observation.itemKey,
        decision,
      })),
    ),
});

class PolicyFake extends Context.Service<PolicyFake, PolicyFakeState>()(
  "t3/factory/FactoryLifecycle.test/PolicyFake",
) {}

const layerPolicyFake = Layer.effect(
  PolicyFake,
  Effect.sync((): PolicyFakeState => ({
    available: true,
    revisions: [],
    propose: (input) => proposeImplementation(input),
    decide: undefined,
    failAll: undefined,
    active: [],
  })),
);

const layerAdmissionPolicy = Layer.effect(
  FactoryLifecycle.FactoryAdmissionPolicy,
  Effect.map(PolicyFake, (fake) => ({
    forFactory: ({ policyRevision }: { readonly policyRevision: string }) => {
      if (!fake.available) return Option.none();
      fake.revisions.push(policyRevision);
      const perItem = perItemPolicy((input) => fake.propose(input));
      return Option.some<FactoryLifecycle.FactoryAdmissionProposer>({
        decide: (input) => {
          fake.active.push(input.active);
          if (fake.failAll !== undefined) {
            return Effect.succeed({ type: "policy_failed", reason: fake.failAll });
          }
          return fake.decide === undefined ? perItem.decide(input) : fake.decide(input);
        },
      });
    },
  })),
);

/** The verified account T3's claim writes as. */
const factoryAccount = { id: 9001, login: "t3-factory" };

const issueKey = (repository: string, issueNumber: number) => `${repository}#${issueNumber}`;

const layerGitHubFake = Layer.effect(
  GitHubFake,
  Effect.sync((): GitHubFakeState => ({
    issues: new Map(),
    requests: [],
    outcomes: [],
    beforeCreate: undefined,
    beforeCommentRead: undefined,
    beforeIssueRead: undefined,
    afterIssueRead: undefined,
    slowIssues: new Set(),
    nextCommentId: 1000,
    pulls: new Map(),
    remoteBranches: new Map(),
    checks: new Map(),
    loseNextMerge: false,
    nextPullNumber: 9000,
    statuses: new Map(),
    requiredContexts: new Set(),
    nextIssueNumber: 8000,
    loseNextIssueCreate: false,
    unlistedIssues: new Set(),
    listingLags: false,
    clockBehindMs: 0,
    refuseBlockedBy: new Set(),
    failNextIssueRead: new Set(),
    loseNextBlockedBy: false,
    processLossAtNextIssueCreate: undefined,
    beforeIssueCreate: undefined,
    failNextMarkerListing: false,
    issueReadErrors: new Map(),
    listingUnreachable: false,
    identityFailure: undefined,
    identityReads: 0,
  })),
);

const layerGitHubRestFake = Layer.effect(
  GitHubRest.GitHubRest,
  Effect.gen(function* () {
    const fake = yield* GitHubFake;
    const graph = yield* GitGraphFake;
    const ok = (body: unknown, status = 200): GitHubRest.GitHubRestResponse => ({
      status,
      headers: {},
      body: JSON.stringify(body),
      truncated: false,
      invalidUtf8: false,
    });
    const notFound = (operation: string) =>
      new GitHubRequestPolicy.GitHubApiNotFoundError({ host: "github.com", operation });
    const refused = (operation: string, status: number, githubErrors?: ReadonlyArray<string>) =>
      new GitHubRequestPolicy.GitHubApiResponseError({
        host: "github.com",
        operation,
        status,
        ...(githubErrors === undefined ? {} : { githubErrors }),
      });
    // A connection that drops after GitHub merged also loses the read that would have shown it.
    let dropNextPullRead = false;
    const reachable = (commit: string) => {
      const seen = new Set<string>();
      const queue = [commit];
      while (queue.length > 0) {
        const next = queue.pop()!;
        if (seen.has(next) || !graph.parents.has(next)) continue;
        seen.add(next);
        queue.push(...graph.parents.get(next)!);
      }
      return seen;
    };
    // Branch protection as beta configures it: required checks pass and the head is up to date.
    const pullJson = (pull: FakePull) => {
      const head = pull.merged?.head ?? fake.remoteBranches.get(pull.head) ?? "";
      const baseTip = graph.branches.get(pull.base) ?? "";
      const mergeable =
        pull.state !== "open"
          ? "unknown"
          : graph.conflicts.has(`${baseTip}:${head}`)
            ? "dirty"
            : !reachable(head).has(baseTip)
              ? "behind"
              : fake.checks.get(head) === "success" &&
                  [...fake.requiredContexts].every(
                    (context) => fake.statuses.get(head)?.get(context) === "success",
                  )
                ? "clean"
                : "blocked";
      return {
        number: pull.number,
        state: pull.state,
        merged: pull.merged !== undefined,
        merge_commit_sha: pull.merged?.commit ?? null,
        head: { ref: pull.head, sha: head },
        base: { ref: pull.base, sha: baseTip },
        title: pull.title,
        body: pull.body,
        node_id: `PR_node_${pull.number}`,
        draft: pull.draft === true,
        mergeable_state: mergeable,
      };
    };
    const pullRoute = (
      operation: string,
      method: string,
      repository: string,
      number: number | undefined,
      merge: boolean,
      query: URLSearchParams,
      body: unknown,
    ) =>
      Effect.gen(function* () {
        if (number === undefined && method === "GET") {
          const head = query.get("head")?.split(":")[1];
          const base = query.get("base");
          return ok(
            [...fake.pulls.values()]
              .filter(
                (pull) =>
                  pull.repository === repository &&
                  (head === undefined || pull.head === head) &&
                  (base === null || pull.base === base),
              )
              .map(pullJson),
          );
        }
        if (number === undefined && method === "POST") {
          const create = body as {
            readonly title: string;
            readonly head: string;
            readonly base: string;
            readonly body: string;
          };
          const duplicate = [...fake.pulls.values()].some(
            (pull) =>
              pull.state === "open" && pull.head === create.head && pull.base === create.base,
          );
          if (!fake.remoteBranches.has(create.head) || duplicate) {
            return yield* refused(operation, 422);
          }
          const pull: FakePull = {
            number: fake.nextPullNumber++,
            repository,
            head: create.head,
            base: create.base,
            title: create.title,
            body: create.body,
            state: "open",
            merged: undefined,
          };
          fake.pulls.set(pull.number, pull);
          return ok(pullJson(pull), 201);
        }
        const pull = number === undefined ? undefined : fake.pulls.get(number);
        if (pull === undefined || pull.repository !== repository) return yield* notFound(operation);
        if (!merge && dropNextPullRead) {
          dropNextPullRead = false;
          return yield* new GitHubRequestPolicy.GitHubApiRequestError({
            host: "github.com",
            operation,
            cause: "the connection dropped",
          });
        }
        if (!merge) return ok(pullJson(pull));
        const request = body as {
          readonly sha: string;
          readonly commit_title: string;
          readonly commit_message: string;
        };
        const current = pullJson(pull);
        if (pull.state !== "open" || pull.draft === true) return yield* refused(operation, 405);
        if (request.sha !== current.head.sha) return yield* refused(operation, 409);
        if (current.mergeable_state !== "clean") return yield* refused(operation, 405);
        const commit = `m${String(graph.parents.size).padStart(7, "0")}`;
        graph.parents.set(commit, [current.base.sha, current.head.sha]);
        graph.messages.set(commit, `${request.commit_title}\n\n${request.commit_message}`);
        graph.branches.set(pull.base, commit);
        pull.merged = { head: current.head.sha, commit };
        pull.state = "closed";
        if (fake.loseNextMerge) {
          fake.loseNextMerge = false;
          dropNextPullRead = true;
          return yield* new GitHubRequestPolicy.GitHubApiRequestError({
            host: "github.com",
            operation,
            cause: "the response was lost after GitHub merged the pull request",
          });
        }
        return ok({ sha: commit, merged: true, message: "Pull Request successfully merged" });
      });
    const commitRoute = (operation: string, sha: string, part: string | undefined) =>
      Effect.gen(function* () {
        if (!graph.parents.has(sha)) return yield* notFound(operation);
        const check = fake.checks.get(sha);
        if (part === "/check-runs") {
          return ok({
            total_count: 1,
            check_runs: [
              {
                name: "ci / test",
                status: check === undefined ? "in_progress" : "completed",
                conclusion: check ?? null,
              },
            ],
          });
        }
        // GitHub's combined status is pending when a commit has no statuses at all.
        if (part === "/status") {
          const posted = [...(fake.statuses.get(sha)?.entries() ?? [])];
          return ok({
            state: posted.length === 0 ? "pending" : "success",
            statuses: posted.map(([context, state]) => ({ context, state })),
          });
        }
        return ok({
          sha,
          parents: graph.parents.get(sha)!.map((parent) => ({ sha: parent })),
          commit: { message: graph.messages.get(sha) ?? "", tree: { sha: `tree-${sha}` } },
        });
      });
    return GitHubRest.GitHubRest.of({
      credential: () =>
        Effect.die(
          "the claim adapter must use the verified pinned credential, not the ambient one",
        ),
      appCredential: () => Effect.die("the factory must not read the app credential"),
      rest: (input) =>
        Effect.gen(function* () {
          const method = input.method ?? "GET";
          const path = input.path.split("?")[0]!;
          fake.requests.push({ method, path, query: input.path.split("?")[1] ?? "" });
          const pullMatch = /^repos\/([^/]+\/[^/]+)\/pulls(?:\/(\d+)(\/merge)?)?$/.exec(path);
          if (pullMatch !== null) {
            return yield* pullRoute(
              input.operation,
              method,
              pullMatch[1]!,
              pullMatch[2] === undefined ? undefined : Number(pullMatch[2]),
              pullMatch[3] !== undefined,
              new URLSearchParams(input.path.split("?")[1] ?? ""),
              input.body,
            );
          }
          if (path === "graphql" && method === "POST") {
            const { query, variables } = input.body as {
              readonly query: string;
              readonly variables: { readonly pullRequestId: string };
            };
            const pull = [...fake.pulls.values()].find(
              (candidate) => `PR_node_${candidate.number}` === variables.pullRequestId,
            );
            if (!query.includes("markPullRequestReadyForReview") || pull === undefined) {
              return ok({ errors: [{ message: "Could not resolve to a node" }] });
            }
            pull.draft = false;
            return ok({ data: { markPullRequestReadyForReview: { clientMutationId: null } } });
          }
          const statusMatch = /^repos\/([^/]+\/[^/]+)\/statuses\/([^/]+)$/.exec(path);
          if (statusMatch !== null && method === "POST") {
            const posted = input.body as { readonly state: string; readonly context: string };
            const sha = statusMatch[2]!;
            fake.statuses.set(
              sha,
              new Map(fake.statuses.get(sha)).set(posted.context, posted.state),
            );
            return ok({ state: posted.state, context: posted.context }, 201);
          }
          const commitMatch =
            /^repos\/([^/]+\/[^/]+)\/commits\/([^/]+)(\/check-runs|\/status)?$/.exec(path);
          if (commitMatch !== null) {
            return yield* commitRoute(input.operation, commitMatch[2]!, commitMatch[3]);
          }
          const issueMatch = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/comments|\/labels)?$/.exec(
            path,
          );
          const listMatch = /^repos\/([^/]+\/[^/]+)\/issues$/.exec(path);
          if (fake.listingUnreachable && listMatch !== null && method === "GET") {
            return yield* new GitHubRequestPolicy.GitHubApiRequestError({
              host: "github.com",
              operation: input.operation,
              cause: "GitHub is unreachable",
            });
          }
          const relatedJson = (repository: string, number: number) => ({
            number,
            state: fake.issues.get(issueKey(repository, number))?.state ?? "open",
            repository_url: `https://api.github.com/repos/${repository}`,
          });
          // GitHub counts a parent's sub-issues on its own read; seeded issues without any say none.
          const subIssueSummary = (repository: string, number: number) => {
            const total = [...fake.issues.entries()].filter(
              ([key, issue]) => key.startsWith(`${repository}#`) && issue.parentNumber === number,
            ).length;
            return total === 0 ? {} : { sub_issues_summary: { total } };
          };
          const byId = (repository: string, id: number) =>
            [...fake.issues.entries()].find(
              ([key, candidate]) =>
                key.startsWith(`${repository}#`) && candidate.created?.id === id,
            )?.[1];
          if (listMatch !== null && method === "POST") {
            const create = input.body as {
              readonly title: string;
              readonly body: string;
              readonly labels: ReadonlyArray<string>;
            };
            if (fake.beforeIssueCreate !== undefined) yield* fake.beforeIssueCreate;
            const processLoss = fake.processLossAtNextIssueCreate;
            fake.processLossAtNextIssueCreate = undefined;
            // The attempt dies with the process: nothing after this point runs or is recorded.
            if (processLoss === "before") return yield* Effect.die("server process ended");
            const created: FakeIssue = {
              number: fake.nextIssueNumber++,
              state: "open",
              title: create.title,
              body: create.body,
              labels: [...create.labels],
              comments: [],
              created: {
                id: 700_000 + fake.nextIssueNumber,
                user: { id: factoryAccount.id },
                at: DateTime.toEpochMillis(yield* DateTime.now) - fake.clockBehindMs,
              },
            };
            fake.issues.set(issueKey(listMatch[1]!, created.number), created);
            if (fake.listingLags) fake.unlistedIssues.add(created.number);
            if (processLoss === "after") return yield* Effect.die("server process ended");
            if (fake.loseNextIssueCreate) {
              fake.loseNextIssueCreate = false;
              return yield* new GitHubRequestPolicy.GitHubApiRequestError({
                host: "github.com",
                operation: input.operation,
                cause: "the response was lost after GitHub created the issue",
              });
            }
            return ok(
              {
                id: created.created!.id,
                number: created.number,
                body: created.body,
                user: created.created!.user,
              },
              201,
            );
          }
          if (listMatch !== null && method === "GET" && input.path.includes("since=")) {
            if (fake.failNextMarkerListing) {
              fake.failNextMarkerListing = false;
              return yield* new GitHubRequestPolicy.GitHubApiRequestError({
                host: "github.com",
                operation: input.operation,
                cause: "the connection dropped before GitHub answered",
              });
            }
            const query = new URLSearchParams(input.path.split("?")[1] ?? "");
            // GitHub compares `since` with its own clock.
            const since = Date.parse(query.get("since") ?? "");
            const listed = [...fake.issues.entries()]
              .filter(
                ([key, issue]) =>
                  key.startsWith(`${listMatch[1]}#`) &&
                  issue.created !== undefined &&
                  issue.created.at >= since &&
                  !fake.unlistedIssues.has(issue.number),
              )
              .map(([, issue]) => ({
                id: issue.created!.id,
                number: issue.number,
                body: issue.body,
                user: issue.created!.user,
              }));
            return ok(query.get("page") === "1" ? listed : []);
          }
          const relationMatch =
            /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/(parent|sub_issues|dependencies\/blocked_by)$/.exec(
              path,
            );
          if (relationMatch !== null) {
            const repository = relationMatch[1]!;
            const target = fake.issues.get(issueKey(repository, Number(relationMatch[2])));
            if (target === undefined) return yield* notFound(input.operation);
            if (relationMatch[3] === "parent") {
              return target.parentNumber === undefined
                ? yield* notFound(input.operation)
                : ok(relatedJson(repository, target.parentNumber));
            }
            if (relationMatch[3] === "sub_issues" && method === "GET") {
              if (fake.unlistedSubIssues?.has(target.number) === true) {
                return yield* new GitHubRequestPolicy.GitHubApiRequestError({
                  host: "github.com",
                  operation: input.operation,
                  cause: "the sub-issue listing was lost",
                });
              }
              const query = new URLSearchParams(input.path.split("?")[1] ?? "");
              const children = [...fake.issues.entries()]
                .filter(
                  ([key, issue]) =>
                    key.startsWith(`${repository}#`) && issue.parentNumber === target.number,
                )
                .map(([, issue]) => relatedJson(repository, issue.number));
              return ok((query.get("page") ?? "1") === "1" ? children : []);
            }
            if (relationMatch[3] === "sub_issues" && method === "POST") {
              const child = byId(
                repository,
                (input.body as { readonly sub_issue_id: number }).sub_issue_id,
              );
              if (child === undefined) return yield* refused(input.operation, 422);
              child.parentNumber = target.number;
              return ok(relatedJson(repository, child.number), 201);
            }
            if (relationMatch[3] === "dependencies/blocked_by" && method === "POST") {
              const blocker = byId(
                repository,
                (input.body as { readonly issue_id: number }).issue_id,
              );
              if (blocker === undefined) return yield* refused(input.operation, 422);
              if (fake.refuseBlockedBy.has(target.number)) {
                return yield* refused(input.operation, 422, ["synthetic validation refusal"]);
              }
              if (target.blockerNumbers?.includes(blocker.number) === true) {
                return yield* refused(input.operation, 422);
              }
              target.blockerNumbers = [...(target.blockerNumbers ?? []), blocker.number];
              if (fake.loseNextBlockedBy) {
                fake.loseNextBlockedBy = false;
                return yield* new GitHubRequestPolicy.GitHubApiRequestError({
                  host: "github.com",
                  operation: input.operation,
                  cause: "the response was lost after GitHub recorded the blocker",
                });
              }
              return ok(relatedJson(repository, blocker.number), 201);
            }
            if (
              relationMatch[3] === "dependencies/blocked_by" &&
              target.blockerNumbers !== undefined
            ) {
              return ok(target.blockerNumbers.map((number) => relatedJson(repository, number)));
            }
            return yield* notFound(input.operation);
          }
          if (listMatch !== null && method === "GET") {
            const query = new URLSearchParams(input.path.split("?")[1] ?? "");
            const label = query.get("labels");
            const listed = [...fake.issues.entries()]
              .filter(
                ([key, issue]) =>
                  key.startsWith(`${listMatch[1]}#`) &&
                  issue.state === (query.get("state") ?? "open") &&
                  (label === null || issue.labels.includes(label)),
              )
              .map(([, issue]) => ({
                number: issue.number,
                labels: issue.labels.map((name) => ({ name })),
                comments: issue.comments.length,
                ...(issue.pullRequest === true ? { pull_request: { url: "pull" } } : {}),
              }));
            return ok(query.get("page") === "1" ? listed : []);
          }
          const commentMatch = /^repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/.exec(path);
          if (commentMatch !== null) {
            if (fake.beforeCommentRead !== undefined) yield* fake.beforeCommentRead;
            const id = Number(commentMatch[2]);
            for (const issue of fake.issues.values()) {
              const comment = issue.comments.find((candidate) => candidate.id === id);
              if (comment !== undefined) return ok(comment);
            }
            return yield* notFound(input.operation);
          }
          if (issueMatch === null) return yield* notFound(input.operation);
          const issue = fake.issues.get(issueKey(issueMatch[1]!, Number(issueMatch[2])));
          if (issue === undefined) return yield* notFound(input.operation);
          const readError = fake.issueReadErrors.get(issue.number);
          if (readError !== undefined && issueMatch[3] === undefined && method === "GET") {
            return yield* readError;
          }
          if (issueMatch[3] === "/labels") return ok(issue.labels.map((name) => ({ name })));
          if (issueMatch[3] === undefined && method === "PATCH") {
            const patch = input.body as { readonly state?: "open" | "closed" };
            if (patch.state !== undefined) issue.state = patch.state;
            return ok({ number: issue.number, state: issue.state });
          }
          if (issueMatch[3] === undefined) {
            if (fake.slowIssues.has(issue.number)) return yield* Effect.never;
            if (fake.failNextIssueRead.delete(issue.number)) {
              return yield* new GitHubRequestPolicy.GitHubApiRequestError({
                host: "github.com",
                operation: input.operation,
                cause: "the connection dropped before GitHub answered",
              });
            }
            if (fake.beforeIssueRead !== undefined) yield* fake.beforeIssueRead;
            const answer = ok({
              number: issue.number,
              state: issue.state,
              title: issue.title,
              body: issue.body,
              labels: issue.labels.map((name) => ({ name })),
              ...(issue.pullRequest === true ? { pull_request: { url: "pull" } } : {}),
              ...subIssueSummary(issueMatch[1]!, issue.number),
              ...(issue.created === undefined
                ? {}
                : { user: { id: issue.created.user.id, login: factoryAccount.login } }),
            });
            if (fake.afterIssueRead !== undefined) yield* fake.afterIssueRead(issue.number);
            return answer;
          }
          if (method === "GET") return ok(issue.comments);
          const outcome = fake.outcomes.shift() ?? { type: "apply" };
          if (fake.beforeCreate !== undefined) yield* fake.beforeCreate;
          if (outcome.type === "fail_before_apply") {
            return yield* new GitHubRequestPolicy.GitHubApiRequestError({
              host: "github.com",
              operation: input.operation,
              cause: "connection reset before the request was sent",
            });
          }
          if (outcome.type === "reject" || outcome.type === "server_error") {
            return yield* new GitHubRequestPolicy.GitHubApiResponseError({
              host: "github.com",
              operation: input.operation,
              status: outcome.status,
            });
          }
          const comment: FakeComment = {
            id: fake.nextCommentId++,
            body: (input.body as { readonly body: string }).body,
            user: factoryAccount,
            created_at: "2026-10-24T00:00:00Z",
          };
          issue.comments.push(comment);
          if (outcome.type === "apply_then_lose") {
            return yield* new GitHubRequestPolicy.GitHubApiRequestError({
              host: "github.com",
              operation: input.operation,
              cause: "the response was lost after GitHub applied the request",
            });
          }
          return ok(comment, 201);
        }),
    });
  }),
);

/** Pins the verified factory account across a read, write and read, as the real API does. */
const layerGitHubPullRequestApiFake = Layer.unwrap(
  Effect.map(GitHubFake, (fake) =>
    Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({
      withVerifiedCredential: (_input, use) =>
        Effect.sync(() => {
          fake.identityReads += 1;
          return fake.identityFailure;
        }).pipe(
          Effect.flatMap((failure) => (failure === undefined ? Effect.void : Effect.fail(failure))),
          Effect.andThen(
            use({
              accountId: String(factoryAccount.id),
              viewer: factoryAccount.login,
              credentialFingerprint: "fingerprint:t3-factory",
            }),
          ),
        ),
    }),
  ),
);

const layerFactoryWorkspace = Layer.effect(
  FactoryWorkspace,
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.makeTempDirectoryScoped({ prefix: "t3-factory-workspace-" }),
  ),
);

const layerTestProviderInstanceRegistry = Layer.effect(
  ProviderInstanceRegistry.ProviderInstanceRegistry,
  Effect.gen(function* () {
    const starts = yield* ProviderStarts;
    const steers = yield* ProviderSteers;
    const executionJoin = yield* ExecutionJoin.ExecutionJoin;
    const joinTarget = yield* ScriptedJoinTarget;
    const pendingWork = yield* ScriptedPendingWork;
    const providerInstances = [
      // Declares no complete background roster, like most adapters today.
      testProviderInstance(
        ProviderInstanceId.make("codex"),
        CodexProviderCapabilitiesV2,
        starts,
        steers,
      ),
      testProviderInstance(
        ProviderInstanceId.make("roster-reporting"),
        {
          ...CodexProviderCapabilitiesV2,
          subagents: { ...CodexProviderCapabilitiesV2.subagents, reportsBackgroundRoster: true },
        },
        starts,
        steers,
      ),
      // Scripted, on the driver whose processes start inside execution containers.
      testProviderInstance(
        ProviderInstanceId.make("contained-claude"),
        {
          ...CodexProviderCapabilitiesV2,
          subagents: { ...CodexProviderCapabilitiesV2.subagents, reportsBackgroundRoster: true },
        },
        starts,
        steers,
        ProviderDriverKind.make("claudeAgent"),
        executionJoin,
        joinTarget,
        pendingWork,
      ),
      // Codex shares one session across threads unless the thread is a factory execution.
      testProviderInstance(
        ProviderInstanceId.make("contained-codex"),
        {
          ...CodexProviderCapabilitiesV2,
          subagents: { ...CodexProviderCapabilitiesV2.subagents, reportsBackgroundRoster: true },
        },
        starts,
        steers,
        ProviderDriverKind.make("codex"),
        executionJoin,
        joinTarget,
        pendingWork,
      ),
      testProviderInstance(
        ProviderInstanceId.make("contained-muse"),
        {
          ...CodexProviderCapabilitiesV2,
          sessions: {
            ...CodexProviderCapabilitiesV2.sessions,
            supportsMultipleProviderThreadsPerSession: false,
          },
          subagents: { ...CodexProviderCapabilitiesV2.subagents, reportsBackgroundRoster: true },
        },
        starts,
        steers,
        ProviderDriverKind.make("muse"),
        executionJoin,
        joinTarget,
        pendingWork,
      ),
    ];
    return {
      getInstance: (instanceId: ProviderInstanceId) =>
        Effect.succeed(providerInstances.find((instance) => instance.instanceId === instanceId)),
      listInstances: Effect.succeed(providerInstances),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    };
  }),
);

const layerVcsDriverRegistryTest = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(layerServerConfig),
  Layer.provide(layerPlatformTest),
);

/**
 * What workspace preparation was asked to do, and where a test holds it. Git, setup scripts and
 * branch naming are recorded stubs: they show how often each was asked, never what an OS or a
 * real checkout would do.
 */
interface PreparationFakeState {
  readonly worktrees: Array<{ readonly branch: string | undefined; readonly baseRef: string }>;
  readonly setups: Array<string>;
  readonly branchNames: Array<string>;
  /** Runs inside a worktree create, once it is recorded, so a test can hold preparation there. */
  duringWorktreeCreate: Effect.Effect<void> | undefined;
  /** What Git answers a worktree create with instead of making it, as when its branch exists. */
  worktreeCreateFailure: GitCommandError | undefined;
  /** The setup script preparation runs in a worktree; none unless a test sets one. */
  setup: ProjectSetupScriptRunner.ProjectSetupScriptRunnerResult;
  /** Runs once setup is done and before the run is released, so a test can hold it there. */
  beforeRelease: Effect.Effect<void> | undefined;
  /**
   * Which launch service owns preparation: the first, or a fresh one standing for the owner a
   * restarted server would have, which never saw the first one's work.
   */
  owner: "first" | "fresh";
}

class PreparationFake extends Context.Service<PreparationFake, PreparationFakeState>()(
  "t3/factory/FactoryLifecycle.test/PreparationFake",
) {}

const layerPreparationFake = Layer.effect(
  PreparationFake,
  Effect.sync((): PreparationFakeState => ({
    worktrees: [],
    setups: [],
    branchNames: [],
    duringWorktreeCreate: undefined,
    worktreeCreateFailure: undefined,
    setup: { status: "no-script" },
    beforeRelease: undefined,
    owner: "first",
  })),
);

const layerPreparationStubs = Layer.unwrap(
  Effect.gen(function* () {
    const fake = yield* PreparationFake;
    const workspace = yield* FactoryWorkspace;
    return Layer.mergeAll(
      Layer.mock(GitWorkflow.GitWorkflowService)({
        createWorktree: (input) =>
          Effect.gen(function* () {
            fake.worktrees.push({ branch: input.newRefName, baseRef: input.refName });
            if (fake.duringWorktreeCreate !== undefined) yield* fake.duringWorktreeCreate;
            if (fake.worktreeCreateFailure !== undefined) return yield* fake.worktreeCreateFailure;
            return { worktree: { path: workspace, refName: input.newRefName ?? input.refName } };
          }),
        removeWorktree: () => Effect.void,
        resolveCommit: (input) => Effect.succeed({ commitSha: input.revision }),
      }),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
        runForThread: (input) =>
          Effect.sync(() => {
            fake.setups.push(input.worktreePath);
            return fake.setup;
          }),
      }),
      Layer.mock(TextGeneration.TextGeneration)({
        generateBranchName: (input) =>
          Effect.sync(() => {
            fake.branchNames.push(input.message);
            return { branch: "named-by-a-model" };
          }),
      }),
      Layer.succeed(WorktreeSetupTracker.WorktreeSetupTracker, {
        begin: () => Effect.void,
        update: () => Effect.void,
        stage: () => Effect.void,
        stageStatus: () => Effect.void,
        appendTail: () => Effect.void,
        finish: () => Effect.succeed(null),
        markUncancellable: () => Effect.suspend(() => fake.beforeRelease ?? Effect.void),
        cancel: () => Effect.succeed(false),
        get: () => Effect.succeed(null),
        stream: () => Stream.empty,
      }),
      Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
      Layer.mock(TerminalManager.TerminalManager)({ close: () => Effect.void }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([codexSnapshot]),
        refreshInstance: () => Effect.succeed([codexSnapshot]),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
        folderForThread: () => Effect.succeedNone,
      }),
      CommandReceiptStore.layer,
      IdAllocator.layer,
    );
  }),
);

/** One launch service over the runtime's own thread management; each build is a new owner. */
const layerOwnedLaunch = ThreadLaunchService.layer.pipe(Layer.provide(layerPreparationStubs));

class FreshLaunchOwner extends Context.Service<
  FreshLaunchOwner,
  ThreadLaunchService.ThreadLaunchService["Service"]
>()("t3/factory/FactoryLifecycle.test/FreshLaunchOwner") {}

/**
 * The runtime's workspace preparation, provided before its claim service is built, as
 * production does. It delegates to whichever launch service currently owns preparation.
 */
const layerFactoryRunPreparationTest = Layer.effect(
  FactoryRunPreparation.FactoryRunPreparation,
  Effect.gen(function* () {
    const fake = yield* PreparationFake;
    const first = yield* ThreadLaunchService.ThreadLaunchService;
    const fresh = yield* FreshLaunchOwner;
    const owner = () => (fake.owner === "first" ? first : fresh);
    const adapter: FactoryRunPreparation.FactoryRunPreparationShape = {
      available: true,
      startOwned: (input) => Effect.suspend(() => owner().prepareRunOwned(input)),
      currentOwner: (commandId) => Effect.suspend(() => owner().currentPreparationOwner(commandId)),
    };
    return adapter;
  }),
).pipe(
  Layer.provide(
    Layer.effect(FreshLaunchOwner, ThreadLaunchService.ThreadLaunchService).pipe(
      Layer.provide(Layer.fresh(layerOwnedLaunch)),
    ),
  ),
  // The first owner is also the launch service a test drives directly, as clients would.
  Layer.provideMerge(layerOwnedLaunch),
  Layer.provide(RuntimeLayer.layerThreadManagementProvided),
);

/**
 * What a bound verification's first use observes, scripted: the account its provider instance
 * reports (SYNTHETIC: no real provider, account or credential is read) and the commit and tree
 * its prepared worktree has checked out.
 */
class LaunchFake extends Context.Service<
  LaunchFake,
  {
    auth: ServerProvider["auth"];
    head: { readonly commit: string; readonly tree: string } | undefined;
    refreshes: number;
  }
>()("t3/factory/FactoryLifecycle.test/LaunchFake") {}

const layerLaunchFake = Layer.sync(LaunchFake, () => ({
  auth: { status: "authenticated" as const, email: "verifier@example.invalid" },
  head: undefined,
  refreshes: 0,
}));

const layerLaunchObservations = Layer.mergeAll(
  Layer.effect(
    ProviderRegistry.ProviderRegistry,
    Effect.map(LaunchFake, (fake) =>
      ProviderRegistry.ProviderRegistry.of({
        getProviders: Effect.sync(() => [{ ...codexSnapshot, auth: fake.auth }]),
        refreshInstance: (instanceId: ServerProvider["instanceId"]) =>
          Effect.sync(() => {
            fake.refreshes++;
            return [{ ...codexSnapshot, instanceId, auth: fake.auth }];
          }),
        observeInstance: (instanceId: ServerProvider["instanceId"]) =>
          Effect.sync(() => {
            fake.refreshes++;
            return Option.some({ ...codexSnapshot, instanceId, auth: fake.auth });
          }),
      } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
    ),
  ),
  Layer.effect(
    FactoryRunPreparation.FactoryWorkspaceHead,
    Effect.map(LaunchFake, (fake) => ({
      read: () => Effect.sync(() => Option.fromNullishOr(fake.head)),
    })),
  ),
);

const makeLayerRuntime = (continueAfterRestart: boolean) =>
  Layer.mergeAll(RuntimeLayer.layer, RuntimeLayer.layerEventSink).pipe(
    Layer.provide(layerLaunchObservations),
    // Merged, so read-state custody sees the same preparation adapter the runtime uses.
    Layer.provideMerge(layerFactoryRunPreparationTest),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provide(
      Layer.mock(WorkspacePaths.WorkspacePaths)({
        normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      }),
    ),
    Layer.provide(ProviderTurnStartServiceTestkit.layer),
    Layer.provide(
      Layer.succeed(ProjectEnrichmentService.ProjectEnrichmentService, {
        peek: () =>
          Effect.succeed({
            repositoryIdentity: null,
            faviconPath: null,
            repositoryIdentityResolved: false,
          }),
        request: () => Effect.void,
        getAvailable: () =>
          Effect.succeed({
            repositoryIdentity: null,
            faviconPath: null,
            repositoryIdentityResolved: false,
          }),
        readRepositoryIdentity: () => Effect.succeed(null),
        invalidate: () => Effect.void,
        subscribeChanges: Effect.never,
      }),
    ),
    Layer.provide(McpSessionRegistryTestkit.layer),
    Layer.provide(McpProviderSessions.layer),
    Layer.provide(Layer.provide(CheckpointStore.layer, layerVcsDriverRegistryTest)),
    Layer.provide(layerServerConfig),
    Layer.provide(
      ServerSettings.layerTest({ continueThreadsAfterServerUpdate: continueAfterRestart }),
    ),
    Layer.provide(layerPlatformTest),
  );

/**
 * A recording containment collaborator, standing in for the host's job objects so these tests
 * reach the contained path. Member counts are scripted per container; it observes no process.
 * The actual-process proof is in `process/custody` and the custody host fixtures.
 */
class ContainmentFake extends Context.Service<
  ContainmentFake,
  {
    readonly members: Map<string, number>;
    readonly created: Set<string>;
    /** Each holder's exit, so a test can stand for its host being lost. */
    readonly holders: Map<string, Deferred.Deferred<void>>;
    /** Set to make the next holder creation fail, as a host lost while creating it would. */
    failNextHold: boolean;
    /** While set, the host reports no identity, as one whose helper cannot be built does. */
    failIdentity: boolean;
  }
>()("t3/factory/FactoryLifecycle.test/ContainmentFake") {}

/** Every container held so far loses its holder: its members end and it reads absent. */
const loseContainers = Effect.gen(function* () {
  const fake = yield* ContainmentFake;
  for (const [name, exited] of fake.holders) {
    fake.members.delete(name);
    yield* Deferred.succeed(exited, undefined);
  }
});

/**
 * A recorded commit graph standing in for a project's repository: commits with their parents,
 * and branches. The factory reads it back exactly as it would read Git.
 */
class GitGraphFake extends Context.Service<
  GitGraphFake,
  {
    readonly parents: Map<string, ReadonlyArray<string>>;
    readonly branches: Map<string, string>;
    /** Each integration commit's message, which carries its operation marker. */
    readonly messages: Map<string, string>;
    /** `base:head` pairs whose merge conflicts. */
    readonly conflicts: Set<string>;
    /** Set to make the next integration land but its answer be lost, as a crash would. */
    loseNextAnswer: boolean;
    /** Every integration write the fake applied, in order. */
    readonly writes: Array<string>;
    /** While set, every readback fails, as a repository T3 cannot read would. */
    unreadable?: boolean;
  }
>()("t3/factory/FactoryLifecycle.test/GitGraphFake") {}

/** Integration over the recorded graph: a compare-and-set on the branch, as the real one does. */
const layerIntegratorFake = Layer.effect(
  FactoryIntegrator.FactoryIntegrator,
  Effect.map(Effect.all([GitGraphFake, GitHubFake]), ([graph, github]) => {
    const ancestors = (commit: string) => {
      const seen = new Set<string>();
      const queue = [commit];
      while (queue.length > 0) {
        const next = queue.pop()!;
        if (seen.has(next) || !graph.parents.has(next)) continue;
        seen.add(next);
        queue.push(...graph.parents.get(next)!);
      }
      return seen;
    };
    const commitOf = (commit: string) => ({
      commit,
      parents: graph.parents.get(commit) ?? [],
      tree: `tree-${commit}`,
    });
    return FactoryIntegrator.FactoryIntegrator.of({
      publish: ({ branch, commit }) =>
        Effect.sync(() => {
          const current = github.remoteBranches.get(branch);
          if (current !== undefined && current !== commit && !ancestors(commit).has(current)) {
            return { type: "diverged" as const, tip: current };
          }
          github.remoteBranches.set(branch, commit);
          return { type: "published" as const };
        }),
      tip: ({ target }) => Effect.sync(() => graph.branches.get(target.branch) ?? null),
      landed: ({ target, marker, reviewedHead }) =>
        Effect.sync(() => {
          const tip = graph.branches.get(target.branch);
          if (tip === undefined) return Option.none();
          for (let commit: string | undefined = tip; commit !== undefined;) {
            if (graph.messages.get(commit)?.includes(marker) === true) {
              return Option.some({ ...commitOf(commit), attribution: "operation" as const });
            }
            commit = graph.parents.get(commit)?.[0];
          }
          return ancestors(tip).has(reviewedHead)
            ? Option.some({ ...commitOf(reviewedHead), attribution: "external" as const })
            : Option.none();
        }),
      apply: ({ target, expected, reviewedHead, mode, message }) =>
        Effect.gen(function* () {
          const tip = graph.branches.get(target.branch) ?? null;
          if (tip !== expected) return { type: "moved" as const, tip };
          if (graph.conflicts.has(`${expected}:${reviewedHead}`)) {
            return { type: "conflict" as const, detail: "CONFLICT (content): b.txt" };
          }
          let commit = reviewedHead;
          if (mode === "merge") {
            commit = `f${String(graph.parents.size).padStart(7, "0")}`;
            graph.parents.set(commit, [expected, reviewedHead]);
            graph.messages.set(commit, message);
          } else if (!ancestors(reviewedHead).has(expected)) {
            return { type: "not_fast_forward" as const };
          }
          graph.branches.set(target.branch, commit);
          graph.writes.push(commit);
          if (graph.loseNextAnswer) {
            graph.loseNextAnswer = false;
            return yield* new FactoryIntegrator.FactoryIntegratorError({
              operation: "push",
              cause: "the connection dropped after the remote applied the push",
            });
          }
          return { type: "applied" as const, ...commitOf(commit) };
        }),
    });
  }),
);

const layerGitGraphFake = Layer.effect(
  FactoryGitReadback.FactoryGitReadback,
  Effect.map(GitGraphFake, (graph) => {
    const resolve = (ref: string) => graph.branches.get(ref.replace(/^refs\/heads\//, "")) ?? ref;
    const ancestors = (commit: string) => {
      const seen = new Set<string>();
      const queue = [resolve(commit)];
      while (queue.length > 0) {
        const next = queue.pop()!;
        if (seen.has(next) || !graph.parents.has(next)) continue;
        seen.add(next);
        queue.push(...graph.parents.get(next)!);
      }
      return seen;
    };
    const read = <A>(operation: string, answer: () => A) =>
      graph.unreadable === true
        ? Effect.fail(
            new FactoryGitReadback.FactoryGitReadbackError({ operation, cause: "unreadable" }),
          )
        : Effect.sync(answer);
    return FactoryGitReadback.FactoryGitReadback.of({
      commitExists: (input) =>
        read("commit-exists", () => graph.parents.has(resolve(input.commit))),
      isAncestor: (input) =>
        read("is-ancestor", () => ancestors(input.descendant).has(input.ancestor)),
      branchExists: (input) => read("branch-exists", () => graph.branches.has(input.branch)),
    });
  }),
);

// Shared at the bottom of the test layer, so the REST fake reads the same graph.
const layerGitGraphState = Layer.sync(GitGraphFake, () => ({
  parents: new Map<string, ReadonlyArray<string>>([["base000", []]]),
  branches: new Map<string, string>([["main", "base000"]]),
  messages: new Map<string, string>(),
  conflicts: new Set<string>(),
  loseNextAnswer: false,
  writes: [],
}));

/** With `contained: false` the host has no mechanism, as on a host without job objects. */
const makeLayerContainmentFake = (contained: boolean) =>
  Layer.effect(
    ExecutionContainment.ExecutionContainment,
    Effect.map(ContainmentFake, (fake): ExecutionContainment.ExecutionContainmentShape => {
      if (!contained) return ExecutionContainment.ExecutionContainment.defaultValue();
      const identity = { machine: "test-machine", session: 1 };
      return {
        mechanism: "windows_job",
        identity: Effect.suspend(() =>
          fake.failIdentity
            ? Effect.fail(
                new ExecutionContainment.ContainmentUnavailable({
                  reason: "the compiled helper exited 4294967295 on version",
                }),
              )
            : Effect.succeed(identity),
        ),
        hold: (name) =>
          Effect.gen(function* () {
            if (fake.failNextHold) {
              fake.failNextHold = false;
              return yield* new ExecutionContainment.ContainmentHolderError({
                name,
                detail: "lost while creating",
              });
            }
            if (fake.created.has(name)) {
              return yield* new ExecutionContainment.ContainmentHolderError({
                name,
                detail: "failed exists",
              });
            }
            fake.created.add(name);
            fake.members.set(name, 0);
            const exited = yield* Deferred.make<void>();
            fake.holders.set(name, exited);
            return {
              name,
              identity,
              pid: 1,
              // A lost holder answers nothing, as the real one's closed channel does.
              count: Effect.suspend(() => {
                const members = fake.members.get(name);
                return members === undefined
                  ? Effect.fail(
                      new ExecutionContainment.ContainmentHolderError({ name, detail: "exited" }),
                    )
                  : Effect.succeed(members);
              }),
              // Admission is recorded by the generations service; members stay as scripted.
              assign: () => Effect.void,
              close: Effect.sync(() => fake.members.delete(name)).pipe(
                Effect.andThen(Deferred.succeed(exited, undefined)),
              ),
              exited: Deferred.await(exited),
            };
          }),
        joinCommand: (_name, command, args) => Effect.succeed({ command, args }),
        probe: (name) =>
          Effect.sync(() => {
            const members = fake.members.get(name);
            return members === undefined
              ? { type: "absent" as const, identity }
              : { type: "active" as const, members, identity };
          }),
      };
    }),
  ).pipe(
    Layer.provideMerge(
      Layer.sync(ContainmentFake, () => ({
        members: new Map<string, number>(),
        created: new Set<string>(),
        holders: new Map<string, Deferred.Deferred<void>>(),
        failNextHold: false,
        failIdentity: false,
      })),
    ),
  );

interface TestRuntimeOptions {
  readonly continueAfterRestart?: boolean;
  /** Whether the host can contain executions; true unless a test says otherwise. */
  readonly contained?: boolean;
}

/**
 * Holds the first read of the owner's decisions after it is armed, where an answer has read its
 * decision as pending and not yet written anything: what another answer can do in that gap.
 */
class DecisionReadHold extends Context.Service<
  DecisionReadHold,
  {
    readonly armed: Ref.Ref<boolean>;
    readonly reached: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  }
>()("t3/factory/FactoryLifecycle.test/DecisionReadHold") {}

const layerDecisionReadHold = Layer.effect(
  DecisionReadHold,
  Effect.all({
    armed: Ref.make(false),
    reached: Deferred.make<void>(),
    release: Deferred.make<void>(),
  }),
);

const layerHeldOutcomeStore = Layer.effect(
  FactoryOutcomeStore.FactoryOutcomeStore,
  Effect.gen(function* () {
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    const hold = yield* DecisionReadHold;
    return FactoryOutcomeStore.FactoryOutcomeStore.of({
      ...outcomes,
      reservedDecisions: (factoryId) =>
        Effect.gen(function* () {
          const decisions = yield* outcomes.reservedDecisions(factoryId);
          if (yield* Ref.getAndSet(hold.armed, false)) {
            yield* Deferred.succeed(hold.reached, undefined);
            yield* Deferred.await(hold.release);
          }
          return decisions;
        }),
    });
  }),
).pipe(Layer.provide(FactoryOutcomeStore.layer));

/** Fails the next grant issued once it is armed, inside whatever transaction issues it. */
class GrantIssueFault extends Context.Service<GrantIssueFault, Ref.Ref<boolean>>()(
  "t3/factory/FactoryLifecycle.test/GrantIssueFault",
) {}

const layerGrantIssueFault = Layer.effect(GrantIssueFault, Ref.make(false));

interface AdmissionLookupsState {
  /** Runs before the factory looks an admission up, so a test can act between two admissions. */
  before: Effect.Effect<void> | undefined;
  /** Runs before the factory records an operation intent, so a test can act just before it. */
  beforeIntent:
    | ((intent: FactoryOperationStore.FactoryOperationIntent) => Effect.Effect<void>)
    | undefined;
}

class AdmissionLookups extends Context.Service<AdmissionLookups, AdmissionLookupsState>()(
  "t3/factory/FactoryLifecycle.test/AdmissionLookups",
) {}

const layerAdmissionLookups = Layer.effect(
  AdmissionLookups,
  Effect.sync((): AdmissionLookupsState => ({ before: undefined, beforeIntent: undefined })),
);

const layerFaultableOperations = Layer.effect(
  FactoryOperationStore.FactoryOperationStore,
  Effect.gen(function* () {
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    const lookups = yield* AdmissionLookups;
    const before = (intent: FactoryOperationStore.FactoryOperationIntent) =>
      Effect.suspend(() => lookups.beforeIntent?.(intent) ?? Effect.void);
    return FactoryOperationStore.FactoryOperationStore.of({
      ...operations,
      intend: (input) => Effect.andThen(before(input.intent), operations.intend(input)),
      intendBeside: (input, fence) =>
        Effect.andThen(before(input.intent), operations.intendBeside(input, fence)),
    });
  }),
).pipe(Layer.provide(FactoryOperationStore.layer));

const layerFaultableStore = Layer.effect(
  FactoryStore.FactoryStore,
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const fault = yield* GrantIssueFault;
    const lookups = yield* AdmissionLookups;
    return FactoryStore.FactoryStore.of({
      ...store,
      findAdmission: (input) =>
        Effect.suspend(() =>
          lookups.before === undefined
            ? store.findAdmission(input)
            : Effect.andThen(lookups.before, store.findAdmission(input)),
        ),
      issueGrant: (input) =>
        Effect.flatMap(Ref.getAndSet(fault, false), (armed) =>
          armed
            ? Effect.fail(
                new FactoryStore.FactoryStoreError({ operation: "issue-grant", cause: "injected" }),
              )
            : store.issueGrant(input),
        ),
    });
  }),
).pipe(Layer.provide(FactoryStore.layer));

// One in-memory database backs the runtime, the factory and the rows this test reads back.
const makeLayerTest = (options: TestRuntimeOptions = {}) => {
  const layerContainmentFake = makeLayerContainmentFake(options.contained ?? true);
  return FactoryLifecycle.layerUsingStores
    .pipe(
      Layer.provideMerge(layerAdmissionPolicy),
      Layer.provideMerge(layerPolicyFake),
      Layer.provideMerge(
        Layer.mergeAll(
          FactoryClaimStore.layer.pipe(Layer.provideMerge(layerFaultableStore)),
          layerHeldOutcomeStore,
          layerFaultableOperations,
          FactoryTransferStore.layer,
          CommandJobFence.layer,
          EffectOutbox.layer,
          ProjectionStore.layer,
          ProviderAdapterRegistry.layerFromProviderInstanceRegistry,
        ),
      ),
      Layer.provideMerge(makeLayerRuntime(options.continueAfterRestart ?? false)),
      Layer.provideMerge(FactoryExecutionGenerations.layer),
      Layer.provideMerge(layerContainmentFake),
      Layer.provideMerge(layerIntegratorFake),
      Layer.provideMerge(layerCommandJobsFake),
      Layer.provideMerge(layerGitGraphFake),
      Layer.provideMerge(FactoryEffects.layerWakes),
      Layer.provideMerge(layerPreparationFake),
      Layer.provideMerge(layerLaunchFake),
      Layer.provideMerge(layerTestProviderInstanceRegistry),
      // The scripted contained provider resolves its join exactly as the real runner does.
      Layer.provideMerge(
        FactoryExecutionGenerations.layerExecutionJoin.pipe(
          Layer.provide(FactoryExecutionGenerations.layer),
          Layer.provide(Layer.merge(FactoryStore.layer, ProjectionStore.layer)),
          Layer.provide(layerContainmentFake),
        ),
      ),
    )
    .pipe(
      Layer.provideMerge(layerProviderStarts),
      Layer.provideMerge(FactoryTracker.layer),
      Layer.provideMerge(Layer.mergeAll(layerGitHubRestFake, layerGitHubPullRequestApiFake)),
      Layer.provideMerge(layerGitHubFake),
      Layer.provideMerge(layerGitGraphState),
      Layer.provideMerge(layerFactoryWorkspace),
      Layer.provideMerge(layerScriptedJoinTarget),
      Layer.provideMerge(layerScriptedPendingWork),
      Layer.provideMerge(layerDecisionReadHold),
      Layer.provideMerge(layerGrantIssueFault),
      Layer.provideMerge(layerAdmissionLookups),
      Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
      Layer.provideMerge(layerPlatformTest),
    );
};
const layerTest = makeLayerTest();

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const projectId = ProjectId.make("project:beta");
const factoryId = FactoryId.make("beta");
const builders = FactoryPoolId.make("builders");
const itemKeyOf = (key: string) => FactoryItemKey.make(key);
const pool = (capacityUnits: number) => [{ poolId: builders, capacityUnits }];

const configureFactory = (overrides: Partial<FactoryLifecycle.FactoryConfigurationInput> = {}) =>
  Effect.gen(function* () {
    const projects = yield* ProjectService.ProjectService;
    yield* projects
      .create({
        commandId: CommandId.make("command:factory-test-project"),
        projectId,
        title: "beta",
        workspaceRoot: yield* FactoryWorkspace,
      })
      .pipe(Effect.ignore);
    const factory = yield* FactoryLifecycle.FactoryLifecycle;
    return yield* factory.configure({
      factoryId,
      projectId,
      policyRevision: "policy-r1",
      enabled: true,
      pools: pool(2),
      execution: {
        modelSelection: betaSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
      packet: { briefSchemaVersion: "brief-v1", helper: null },
      artifactRoot: process.cwd(),
      ...overrides,
    });
  });

const packetText = (itemKey: string) => `Implement ${itemKey} under the pinned brief.`;

/** A collection pass's read generation, allocated before it reads. */
const beginCollection = Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
  factory.beginCollection({ factoryId }),
).pipe(Effect.map(({ generation }) => generation));

interface ObserveOverrides {
  readonly itemVersion?: string;
  /** Defaults to a freshly allocated generation, as a new collection pass would use. */
  readonly generation?: FactoryReadGeneration;
  readonly complete?: boolean;
  readonly evidence?: FactoryLifecycle.ItemObservationInput["evidence"];
  readonly claims?: ReadonlyArray<{ readonly carrierKey: string }>;
}

const observeResult = (itemKey: string, overrides: ObserveOverrides = {}) =>
  Effect.gen(function* () {
    const factory = yield* FactoryLifecycle.FactoryLifecycle;
    return yield* factory.recordItemObservation({
      factoryId,
      itemKey: itemKeyOf(itemKey),
      itemVersion: overrides.itemVersion ?? "v1",
      generation: overrides.generation ?? (yield* beginCollection),
      complete: overrides.complete ?? true,
      evidence: overrides.evidence ?? [
        { carrierId: `${itemKey}:body`, bodyDigest: sha256(itemKey), version: "1" },
      ],
      sources: [{ sourceKey: "github:beta@main", version: "base-sha-1" }],
      claims: (overrides.claims ?? []).map((claim) => ({
        carrierKey: FactoryClaimCarrierKey.make(claim.carrierKey),
        poolId: builders,
        units: 1,
      })),
    });
  });

/** Records a read that the factory keeps as the item's current observation. */
const observe = (itemKey: string, overrides: ObserveOverrides = {}) =>
  Effect.flatMap(observeResult(itemKey, overrides), (result) =>
    result.type === "recorded"
      ? Effect.succeed(result.observation)
      : Effect.die(new Error(`Expected a recorded observation, got ${result.type}`)),
  );

const inOneHour = Effect.map(DateTime.now, DateTime.add({ hours: 1 }));

const admissionFor = (
  itemKey: string,
  basis: FactoryLifecycle.FactoryAdmissionRequest["basis"],
  overrides: Partial<FactoryLifecycle.FactoryAdmissionRequest> = {},
): FactoryLifecycle.FactoryAdmissionRequest => ({
  factoryId,
  itemKey: itemKeyOf(itemKey),
  taskKind: "implement",
  policyRevision: "policy-r1",
  basis,
  poolId: builders,
  units: 1,
  title: `Implement ${itemKey}`,
  packet: {
    text: packetText(itemKey),
    sha256: sha256(packetText(itemKey)),
    briefSchemaVersion: "brief-v1",
    helperSha256: null,
  },
  artifactPaths: [],
  ...overrides,
});

/** Proposes the decision for the item's current observation, as one collection pass would. */
const proposeCurrent = (
  itemKey: string,
  overrides: Partial<FactoryLifecycle.FactoryAdmissionRequest> = {},
) =>
  Effect.gen(function* () {
    const factory = yield* FactoryLifecycle.FactoryLifecycle;
    const observation = yield* observe(itemKey);
    return yield* factory.admit(
      admissionFor(
        itemKey,
        { observationId: observation.observationId, deadline: yield* inOneHour },
        overrides,
      ),
    );
  });

const executionOf = (reservation: FactoryStore.FactoryReservation) =>
  FactoryStore.isNativeReservation(reservation) ? reservation.execution : undefined;

/** Nothing of a refused execution exists: no reservation, thread or launch effect. */
const assertNothingStarted = (itemKey: string, commandIds: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const factory = yield* FactoryLifecycle.FactoryLifecycle;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const state = yield* factory.readState({ factoryId });
    assert.deepStrictEqual(
      state.reservations.filter((reservation) => reservation.itemKey === itemKey),
      [],
    );
    const { threads } = yield* projections.getShellSnapshot();
    assert.deepStrictEqual(
      threads.filter((shell) => shell.title === `Implement ${itemKey}`).map((shell) => shell.id),
      [],
    );
    for (const commandId of commandIds) {
      assert.deepStrictEqual(yield* outbox.listByCommandId(CommandId.make(commandId)), []);
    }
  });

const runIsolated = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof layerTest>>,
  options: TestRuntimeOptions = {},
) => effect.pipe(Effect.provide(makeLayerTest(options)));

it.effect("N01: repeated triggers for one eligible issue admit one native execution", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;

      // The tracker event, the fallback clock and restart reconciliation each read the item
      // afresh and propose the same decision.
      const first = yield* proposeCurrent("github:beta#101");
      const second = yield* proposeCurrent("github:beta#101");
      const third = yield* proposeCurrent("github:beta#101");

      assert.strictEqual(first.type, "admitted");
      assert.strictEqual(second.type, "existing");
      assert.strictEqual(third.type, "existing");
      if (first.type === "refused" || second.type === "refused") return;
      assert.deepStrictEqual(second.reservation, first.reservation);

      const execution = executionOf(first.reservation);
      assert.isDefined(execution);
      if (execution === undefined) return;
      const thread = yield* orchestrator.getThreadProjection(execution.threadId);
      assert.deepStrictEqual(
        thread.runs.map((run) => run.id),
        [execution.runId],
      );
      assert.strictEqual(thread.thread.lineage.parentThreadId, null);
      const starts = (yield* outbox.listByCommandId(execution.commandId)).filter(
        (effect) => effect.request.type === "provider-turn.start",
      );
      assert.strictEqual(starts.length, 1);

      const state = yield* factory.readState({ factoryId });
      assert.strictEqual(state.reservations.length, 1);
      assert.deepStrictEqual(state.pools, [
        { poolId: builders, capacityUnits: 2, occupiedUnits: 1 },
      ]);
    }),
  ),
);

it.effect("G1-D02: a delayed proposal whose item basis changed is refused before any write", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const delayed = yield* observe("github:beta#102");
      // The issue body changes and the collector reads it again before the old proposal lands.
      const current = yield* observe("github:beta#102", {
        itemVersion: "v2",
        evidence: [
          { carrierId: "github:beta#102:body", bodyDigest: sha256("edited"), version: "2" },
        ],
      });
      const deadline = yield* inOneHour;

      const stale = yield* factory.admit(
        admissionFor("github:beta#102", { observationId: delayed.observationId, deadline }),
      );
      assert.deepStrictEqual(stale, { type: "refused", reason: "stale_basis" });
      yield* assertNothingStarted("github:beta#102");

      const fresh = yield* factory.admit(
        admissionFor("github:beta#102", { observationId: current.observationId, deadline }),
      );
      assert.strictEqual(fresh.type, "admitted");
    }),
  ),
);

it.effect("G1-D02: an unchanged re-read keeps the earlier basis valid", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const earlier = yield* observe("github:beta#103");
      yield* observe("github:beta#103", {});
      const result = yield* factory.admit(
        admissionFor("github:beta#103", {
          observationId: earlier.observationId,
          deadline: yield* inOneHour,
        }),
      );
      assert.strictEqual(result.type, "admitted");
    }),
  ),
);

it.effect("G1-D02: incomplete reads and expired deadlines are refused before any write", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const partial = yield* observe("github:beta#104", { complete: false });
      const incomplete = yield* factory.admit(
        admissionFor("github:beta#104", {
          observationId: partial.observationId,
          deadline: yield* inOneHour,
        }),
      );
      assert.deepStrictEqual(incomplete, { type: "refused", reason: "incomplete_basis" });
      yield* assertNothingStarted("github:beta#104");

      const complete = yield* observe("github:beta#105");
      const deadline = yield* inOneHour;
      yield* TestClock.adjust("2 hours");
      const expired = yield* factory.admit(
        admissionFor("github:beta#105", { observationId: complete.observationId, deadline }),
      );
      assert.deepStrictEqual(expired, { type: "refused", reason: "deadline_expired" });
      yield* assertNothingStarted("github:beta#105");
    }),
  ),
);

it.effect("G1-D02: the reservation commit itself rechecks the basis and deadline", () =>
  runIsolated(
    Effect.gen(function* () {
      const configuration = yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const itemKey = "github:beta#106";

      // A start that passed preflight reaches the commit after its basis or deadline lapsed.
      const startAtCommit = (
        decision: string,
        observation: FactoryStore.ItemObservation,
        itemVersion: string,
        deadline: DateTime.Utc,
      ) =>
        orchestrator
          .dispatch({
            type: "factory.execution.start",
            commandId: CommandId.make(`factory:beta:decision:${decision}`),
            threadId: ThreadId.make(`thread:factory:beta:${decision}`),
            projectId,
            title: `Implement ${itemKey}`,
            modelSelection: betaSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            prompt: packetText(itemKey),
            admission: {
              factoryId,
              configRevision: configuration.revision,
              decisionKey: FactoryDecisionKey.make(decision),
              itemKey: itemKeyOf(itemKey),
              itemVersion,
              taskKind: "implement",
              policyRevision: "policy-r1",
              poolId: builders,
              units: 1,
              packetDigest: sha256(packetText(itemKey)),
              observationId: observation.observationId,
              basisDigest: observation.basisDigest,
              deadline,
            },
          })
          .pipe(Effect.flip);

      const delayed = yield* observe(itemKey);
      yield* observe(itemKey, { itemVersion: "v2" });
      const stale = yield* startAtCommit("stale", delayed, "v1", yield* inOneHour);
      assert.strictEqual(stale._tag, "OrchestratorFactoryReservationRefusedError");
      if (stale._tag === "OrchestratorFactoryReservationRefusedError") {
        assert.strictEqual(stale.refusal, "stale_basis");
      }
      yield* assertNothingStarted(itemKey);

      const current = yield* observe(itemKey, { itemVersion: "v2" });
      const expiredAt = yield* Effect.map(DateTime.now, DateTime.subtract({ seconds: 1 }));
      const late = yield* startAtCommit("late", current, "v2", expiredAt);
      assert.strictEqual(late._tag, "OrchestratorFactoryReservationRefusedError");
      if (late._tag === "OrchestratorFactoryReservationRefusedError") {
        assert.strictEqual(late.refusal, "deadline_expired");
      }
      yield* assertNothingStarted(itemKey, [
        "factory:beta:decision:stale",
        "factory:beta:decision:late",
      ]);
      const state = yield* factory.readState({ factoryId });
      assert.strictEqual(state.pools[0]?.occupiedUnits, 0);
    }),
  ),
);

const admittedExecution = (result: FactoryLifecycle.FactoryAdmissionResult) => {
  const execution = result.type === "refused" ? undefined : executionOf(result.reservation);
  if (execution === undefined) {
    throw new Error(`Expected an admitted execution, got ${JSON.stringify(result)}`);
  }
  return execution;
};

/** An agent in `threadId` asks for a delegated task, as the MCP delegate_task tool does. */
const delegateFrom = (threadId: ThreadId, label: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const run = projection.runs.at(-1)!;
    return yield* orchestrator.dispatch({
      type: "delegated_task.request",
      createdBy: "agent",
      creationSource: "mcp",
      commandId: CommandId.make(`command:delegate:${label}`),
      parentThreadId: threadId,
      parentRunId: run.id,
      parentNodeId: run.rootNodeId!,
      task: `Delegated work ${label}`,
      modelSelection: betaSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });

/** A user's ordinary conversation with an active run. */
const startUnrelatedConversation = (label: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(`thread:unrelated:${label}`);
    yield* orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:unrelated-create:${label}`),
      threadId,
      projectId,
      title: `Unrelated ${label}`,
      modelSelection: betaSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:unrelated-message:${label}`),
      threadId,
      messageId: MessageId.make(`message:unrelated:${label}`),
      text: "Plan my week.",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
    });
    return threadId;
  });

const childThreadsOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    return projection.subagents.flatMap((task) =>
      task.childThreadId === null ? [] : [task.childThreadId],
    );
  });

it.effect("N04: a factory worker's delegated task reserves capacity like any factory start", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(2) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#201"));

      yield* delegateFrom(worker.threadId, "first");
      const [child] = yield* childThreadsOf(worker.threadId);
      const afterFirst = yield* factory.readState({ factoryId });
      assert.strictEqual(afterFirst.pools[0]?.occupiedUnits, 2);
      const inherited = afterFirst.reservations.find(
        (reservation) => executionOf(reservation)?.threadId === child,
      );
      assert.strictEqual(inherited?.origin, "inherited");
      assert.strictEqual(inherited?.itemKey, "github:beta#201");

      // The pool is now full: a further delegation is refused before its child exists.
      const refused = yield* delegateFrom(worker.threadId, "second").pipe(Effect.flip);
      assert.strictEqual(refused._tag, "OrchestratorFactoryReservationRefusedError");
      if (refused._tag === "OrchestratorFactoryReservationRefusedError") {
        assert.strictEqual(refused.refusal, "capacity_exhausted");
      }
      assert.strictEqual((yield* childThreadsOf(worker.threadId)).length, 1);
      assert.strictEqual((yield* factory.readState({ factoryId })).pools[0]?.occupiedUnits, 2);
    }),
  ),
);

it.effect("N04: unrelated conversations still delegate while the factory is full", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(1) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      admittedExecution(yield* proposeCurrent("github:beta#202"));
      const conversation = yield* startUnrelatedConversation("full-factory");

      yield* delegateFrom(conversation, "unrelated");
      assert.strictEqual((yield* childThreadsOf(conversation)).length, 1);
      const state = yield* factory.readState({ factoryId });
      assert.strictEqual(state.reservations.length, 1);
      assert.strictEqual(state.pools[0]?.occupiedUnits, 1);
    }),
  ),
);

it.effect("N04: racing starts for the last unit commit exactly one reservation", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(2) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#203"));
      const observation = yield* observe("github:beta#204");
      const deadline = yield* inOneHour;

      // A new admission and the worker's own delegation compete for the one free unit.
      const [admission, delegation] = yield* Effect.all(
        [
          factory.admit(
            admissionFor("github:beta#204", {
              observationId: observation.observationId,
              deadline,
            }),
          ),
          Effect.result(delegateFrom(worker.threadId, "race")),
        ],
        { concurrency: "unbounded" },
      );

      const winners = [admission.type === "admitted", delegation._tag === "Success"].filter(
        Boolean,
      );
      assert.strictEqual(winners.length, 1);
      const state = yield* factory.readState({ factoryId });
      assert.strictEqual(state.pools[0]?.occupiedUnits, 2);
      assert.strictEqual(state.reservations.length, 2);
    }),
  ),
);

/** The effect worker runs every queued launch. No provider runs in these tests. */
const drainLaunches = Effect.gen(function* () {
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  for (;;) {
    const claimed = yield* outbox.claimNext({ workerId: "worker:test" });
    if (Option.isNone(claimed)) return;
    yield* outbox.succeed({ effectId: claimed.value.id, workerId: "worker:test" });
  }
});

/** The provider reports the run finished, as ingestion would, after its launch ran. */
const completeLatestRun = (
  threadId: ThreadId,
  status: "completed" | "failed" = "completed",
  runId?: RunId,
) =>
  Effect.gen(function* () {
    yield* drainLaunches;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const sink = yield* EventSink.EventSinkV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    // Queued follow-ups have not started, so the latest started run is the one that finished.
    const run =
      runId === undefined
        ? projection.runs.findLast((candidate) => candidate.status !== "queued")!
        : projection.runs.find((candidate) => candidate.id === runId)!;
    const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
    const now = yield* DateTime.now;
    // As the runtime settles a turn the provider reported ended: the provider turn, its attempt
    // and the run together. The launch was only marked done, so the turn may not exist yet.
    const settled =
      attempt === undefined
        ? []
        : [
            {
              id: EventId.make(`event:complete-turn:${run.id}`),
              type: "provider-turn.updated" as const,
              threadId,
              runId: run.id,
              nodeId: attempt.rootNodeId,
              providerInstanceId: run.providerInstanceId,
              occurredAt: now,
              payload: {
                ...(projection.providerTurns.find(
                  (candidate) => candidate.runAttemptId === attempt.id,
                ) ?? {
                  id: ProviderTurnId.make(`provider-turn:${attempt.id}`),
                  providerThreadId: attempt.providerThreadId,
                  nodeId: attempt.rootNodeId,
                  runAttemptId: attempt.id,
                  nativeTurnRef: null,
                  ordinal:
                    projection.providerTurns.filter(
                      (candidate) => candidate.providerThreadId === attempt.providerThreadId,
                    ).length + 1,
                  startedAt: now,
                }),
                status,
                completedAt: now,
              },
            },
            {
              id: EventId.make(`event:complete-attempt:${run.id}`),
              type: "run-attempt.updated" as const,
              threadId,
              runId: run.id,
              nodeId: attempt.rootNodeId,
              providerInstanceId: run.providerInstanceId,
              occurredAt: now,
              payload: {
                ...attempt,
                status,
                startedAt: attempt.startedAt ?? now,
                completedAt: now,
              },
            },
          ];
    yield* sink.write({
      events: [
        ...settled,
        {
          id: EventId.make(`event:complete:${run.id}`),
          type: "run.updated",
          threadId,
          runId: run.id,
          providerInstanceId: run.providerInstanceId,
          occurredAt: now,
          payload: { ...run, status, startedAt: now, completedAt: now },
        },
      ],
    });
    return run;
  });

const sendUserMessage = (threadId: ThreadId, label: string, senderThreadId?: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "message.dispatch",
      createdBy: senderThreadId === undefined ? "user" : "agent",
      creationSource: senderThreadId === undefined ? "web" : "mcp",
      commandId: CommandId.make(`command:message:${label}`),
      threadId,
      messageId: MessageId.make(`message:${label}`),
      text: `Message ${label}`,
      attachments: [],
      ...(senderThreadId === undefined ? {} : { senderThreadId }),
      dispatchMode: { type: "start_immediately" },
    });
  });

const createTopLevelThread = (threadId: ThreadId, createdBy: "user" | "agent") =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      createdBy,
      creationSource: createdBy === "user" ? "web" : "mcp",
      commandId: CommandId.make(`command:create:${threadId}`),
      threadId,
      projectId,
      title: `Thread ${threadId}`,
      modelSelection: betaSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
  });

const runCount = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return (yield* orchestrator.getThreadProjection(threadId)).runs.length;
  });

const occupied = Effect.gen(function* () {
  const factory = yield* FactoryLifecycle.FactoryLifecycle;
  return (yield* factory.readState({ factoryId })).pools[0]?.occupiedUnits;
});

const expectRefusal = (
  error: Orchestrator.OrchestratorV2Error,
  refusal: FactoryStore.FactoryReservationRefusal,
) => {
  assert.strictEqual(error._tag, "OrchestratorFactoryReservationRefusedError");
  if (error._tag === "OrchestratorFactoryReservationRefusedError") {
    assert.strictEqual(error.refusal, refusal);
  }
};

it.effect("G1-D01: a fork of a factory worker is counted when it first runs", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(2) });
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#301"));
      const run = yield* completeLatestRun(worker.threadId);
      const fork = (label: string) =>
        orchestrator.dispatch({
          type: "thread.fork",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:fork:${label}`),
          sourceThreadId: worker.threadId,
          targetThreadId: ThreadId.make(`thread:fork:${label}`),
          sourcePoint: { type: "run", runId: run.id },
        });

      // Forking alone starts nothing; the fork's first UI message, without a sender, does.
      yield* fork("first");
      assert.strictEqual(yield* occupied, 1);
      yield* sendUserMessage(ThreadId.make("thread:fork:first"), "fork-first");
      assert.strictEqual(yield* occupied, 2);

      yield* fork("second");
      const refused = yield* sendUserMessage(
        ThreadId.make("thread:fork:second"),
        "fork-second",
      ).pipe(Effect.flip);
      expectRefusal(refused, "capacity_exhausted");
      assert.strictEqual(yield* runCount(ThreadId.make("thread:fork:second")), 0);
    }),
  ),
);

it.effect("G1-D01: later runs on a bound thread continue its execution without a new charge", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(1) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#302"));
      yield* completeLatestRun(worker.threadId);

      // A user follow-up and a worker-to-itself wake both run on the bound thread.
      yield* sendUserMessage(worker.threadId, "follow-up");
      yield* completeLatestRun(worker.threadId);
      yield* sendUserMessage(worker.threadId, "self-wake", worker.threadId);
      assert.strictEqual(yield* runCount(worker.threadId), 3);
      const state = yield* factory.readState({ factoryId });
      assert.strictEqual(state.reservations.length, 1);
      assert.strictEqual(state.pools[0]?.occupiedUnits, 1);
    }),
  ),
);

it.effect("G1-D01: a thread a factory worker launches is counted from its first run", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(2) });
      const worker = admittedExecution(yield* proposeCurrent("github:beta#303"));
      const launched = ThreadId.make("thread:launched-by-worker");
      yield* createTopLevelThread(launched, "agent");
      yield* sendUserMessage(launched, "launched-first", worker.threadId);
      assert.strictEqual(yield* occupied, 2);

      const another = ThreadId.make("thread:launched-by-worker-2");
      yield* createTopLevelThread(another, "agent");
      const refused = yield* sendUserMessage(another, "launched-second", worker.threadId).pipe(
        Effect.flip,
      );
      expectRefusal(refused, "capacity_exhausted");
      assert.strictEqual(yield* runCount(another), 0);
    }),
  ),
);

it.effect("G1-D01: a factory worker cannot start work in an existing unrelated conversation", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(3) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#304"));
      const conversation = yield* startUnrelatedConversation("existing");
      yield* completeLatestRun(conversation);

      const refused = yield* sendUserMessage(conversation, "borrowed", worker.threadId).pipe(
        Effect.flip,
      );
      expectRefusal(refused, "unbound_destination");
      assert.strictEqual(yield* runCount(conversation), 1);

      // The user's own follow-up in that conversation stays unrelated and uncharged.
      yield* sendUserMessage(conversation, "user-follow-up");
      assert.strictEqual(yield* runCount(conversation), 2);
      assert.strictEqual((yield* factory.readState({ factoryId })).reservations.length, 1);
    }),
  ),
);

it.effect("G1-D01: a schedule a factory worker created is counted when it launches a thread", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(2) });
      const store = yield* FactoryStore.FactoryStore;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#305"));
      const workerSchedule = ScheduledTaskId.make("schedule:worker");
      const userSchedule = ScheduledTaskId.make("schedule:user");
      yield* store.recordScheduleOrigin({
        scheduledTaskId: workerSchedule,
        callerThreadId: worker.threadId,
      });
      yield* store.recordScheduleOrigin({
        scheduledTaskId: userSchedule,
        callerThreadId: yield* startUnrelatedConversation("schedule-owner"),
      });

      // A fresh-thread scheduled run carries only its server-set schedule id.
      const launch = (label: string, scheduledTaskId: ScheduledTaskId) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make(`thread:scheduled:${label}`);
          yield* createTopLevelThread(threadId, "agent");
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            createdBy: "agent",
            creationSource: "mcp",
            scheduledTaskId,
            commandId: CommandId.make(`command:scheduled:${label}`),
            threadId,
            messageId: MessageId.make(`message:scheduled:${label}`),
            text: "Scheduled work",
            attachments: [],
            dispatchMode: { type: "start_immediately" },
          });
          return threadId;
        });

      yield* launch("user", userSchedule);
      assert.strictEqual(yield* occupied, 1);
      yield* launch("worker-1", workerSchedule);
      assert.strictEqual(yield* occupied, 2);
      const refused = yield* launch("worker-2", workerSchedule).pipe(Effect.flip);
      expectRefusal(refused, "capacity_exhausted");
      assert.strictEqual(yield* runCount(ThreadId.make("thread:scheduled:worker-2")), 0);
    }),
  ),
);

/** The contained driver: its runs start inside (scripted) execution containers. */
const rosterSelection = {
  instanceId: ProviderInstanceId.make("contained-claude"),
  model: "claude-test",
} satisfies ModelSelection;

/** A provider that reports its roster but whose processes no container records. */
const uncontainedRosterSelection = {
  instanceId: ProviderInstanceId.make("roster-reporting"),
  model: "claude-test",
} satisfies ModelSelection;

/** Scripts how many processes are in the containers of a thread's runs. */
const setContainedMembers = (threadId: ThreadId, members: number) =>
  Effect.gen(function* () {
    const fake = yield* ContainmentFake;
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_execution_generations
      WHERE thread_id = ${threadId} AND state = 'held'
    `;
    for (const row of rows) {
      const name = (JSON.parse(row.record_json) as { readonly name: string }).name;
      if (fake.members.has(name)) fake.members.set(name, members);
    }
  });

/** Scripts how many processes one run's held container holds, leaving the thread's others. */
const setGenerationMembers = (runId: RunId, members: number) =>
  Effect.gen(function* () {
    const fake = yield* ContainmentFake;
    const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    for (const generation of yield* generations.generations(runId)) {
      if (generation.state === "held" && fake.members.has(generation.name)) {
        fake.members.set(generation.name, members);
      }
    }
  });

/**
 * The server's record of a provider-native wake: the adapter saw its CLI re-invoke the model for a
 * finished background task, and the continuation service dispatched this message for it.
 */
const dispatchProviderContinuation = (threadId: ThreadId, label: string) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`provider-continuation:message:${label}`),
      threadId,
      messageId: MessageId.make(`message:${label}`),
      text: `Monitor "focused tests" finished (${label})`,
      notification: {
        source: { kind: "monitor" },
        outcome: "completed",
        summary: 'Monitor "focused tests" finished',
      },
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "provider",
    }),
  );

const configureRosterFactory = (capacityUnits = 1) =>
  configureFactory({
    pools: pool(capacityUnits),
    execution: {
      modelSelection: rosterSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  });

const configureUncontainedRosterFactory = (capacityUnits = 1) =>
  configureFactory({
    pools: pool(capacityUnits),
    execution: {
      modelSelection: uncontainedRosterSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  });

/** The provider's background roster for the execution, as adapter ingestion writes it. */
const setRoster = (
  threadId: ThreadId,
  tasks: ReadonlyArray<{ readonly taskId: string; readonly kind: "subagent" | "background_task" }>,
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const sink = yield* EventSink.EventSinkV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const run = projection.runs.at(-1)!;
    const providerThread = projection.providerThreads.find(
      (candidate) => candidate.id === run.providerThreadId,
    )!;
    const now = yield* DateTime.now;
    const sequence = yield* sink.latestSequence({ threadId });
    yield* sink.write({
      events: [
        {
          id: EventId.make(`event:roster:${threadId}:${tasks.length}:${sequence}`),
          type: "provider-thread.updated",
          threadId,
          driver: providerThread.driver,
          providerInstanceId: providerThread.providerInstanceId,
          occurredAt: now,
          payload: { ...providerThread, pendingBackgroundTasks: [...tasks], updatedAt: now },
        },
      ],
    });
  });

const custodyOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const factory = yield* FactoryLifecycle.FactoryLifecycle;
    const state = yield* factory.readState({ factoryId });
    const reservation = state.reservations.find(
      (candidate) => executionOf(candidate)?.threadId === threadId,
    );
    assert.isDefined(reservation);
    return reservation!.custody;
  });

const launchEffects = (commandId: CommandId) =>
  Effect.gen(function* () {
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    return (yield* outbox.listByCommandId(commandId)).filter(
      (effect) => effect.request.type === "provider-turn.start",
    );
  });

it.effect("N07: background work after the provider turn completes keeps custody and capacity", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureUncontainedRosterFactory(1);
      const worker = admittedExecution(yield* proposeCurrent("github:alpha#501"));
      yield* completeLatestRun(worker.threadId);
      yield* setRoster(worker.threadId, [{ taskId: "native-subagent-1", kind: "subagent" }]);

      assert.deepStrictEqual(yield* custodyOf(worker.threadId), {
        state: "live",
        reasons: ["background_work"],
      });
      // Collection and fallback clocks keep running across a long wake gap.
      yield* TestClock.adjust("56 minutes");
      assert.strictEqual(yield* runCount(worker.threadId), 1);
      assert.deepStrictEqual(yield* custodyOf(worker.threadId), {
        state: "live",
        reasons: ["background_work"],
      });
      assert.strictEqual((yield* proposeCurrent("github:alpha#501")).type, "existing");
      assert.deepStrictEqual(yield* proposeCurrent("github:alpha#502"), {
        type: "refused",
        reason: "capacity_exhausted",
      });
      assert.strictEqual((yield* launchEffects(worker.commandId)).length, 1);

      // An emptied roster names no process: without a container the work is still unknown.
      yield* setRoster(worker.threadId, []);
      assert.deepStrictEqual(yield* custodyOf(worker.threadId), {
        state: "unknown",
        reasons: ["process_containment_unsupported"],
      });
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

it.effect(
  "N08/N33: a terminal worker without quiescence proof stays unknown through any wait",
  () =>
    runIsolated(
      Effect.gen(function* () {
        // No container recorded this worker's processes, so nothing proves they ended.
        yield* configureFactory({ pools: pool(1) });
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const worker = admittedExecution(yield* proposeCurrent("github:alpha#503"));
        yield* completeLatestRun(worker.threadId);
        const unknown = { state: "unknown", reasons: ["process_containment_unsupported"] } as const;
        assert.deepStrictEqual(yield* custodyOf(worker.threadId), unknown);

        for (const _wake of [1, 2, 3]) {
          yield* TestClock.adjust("90 minutes");
          assert.deepStrictEqual(yield* custodyOf(worker.threadId), unknown);
        }
        assert.strictEqual(yield* runCount(worker.threadId), 1);
        assert.strictEqual((yield* launchEffects(worker.commandId)).length, 1);
        // A changed issue is a new decision, but the item is still owned: no takeover or relaunch.
        const changed = yield* observe("github:alpha#503", {
          itemVersion: "v2",
          evidence: [
            { carrierId: "github:alpha#503:body", bodyDigest: sha256("edited"), version: "2" },
          ],
        });
        assert.deepStrictEqual(
          yield* factory.admit(
            admissionFor("github:alpha#503", {
              observationId: changed.observationId,
              deadline: yield* inOneHour,
            }),
          ),
          { type: "refused", reason: "item_owned" },
        );
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect(
  "N28: a start whose launch outcome is ambiguous across a restart keeps one identity",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureUncontainedRosterFactory(2);
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        const first = yield* proposeCurrent("github:beta#601");
        const worker = admittedExecution(first);

        // A worker claimed the provider start; the server then dies before the outcome is known.
        const claimed = yield* outbox.claimNext({
          workerId: "worker:crashed",
        });
        assert.isTrue(Option.isSome(claimed));
        assert.deepStrictEqual(yield* custodyOf(worker.threadId), {
          state: "live",
          reasons: ["run_active"],
        });
        yield* recovery.recover;

        const afterRestart = yield* custodyOf(worker.threadId);
        assert.strictEqual(afterRestart.state, "unknown");
        assert.include(afterRestart.reasons, "process_containment_unsupported");
        const replay = yield* proposeCurrent("github:beta#601");
        assert.strictEqual(replay.type, "existing");
        if (replay.type !== "existing" || first.type !== "admitted") return;
        assert.deepStrictEqual(replay.reservation, first.reservation);
        assert.strictEqual(yield* runCount(worker.threadId), 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect("N08: restart cancellation of background work is not proof the work stopped", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureUncontainedRosterFactory(1);
      const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
      const worker = admittedExecution(yield* proposeCurrent("github:alpha#504"));
      yield* completeLatestRun(worker.threadId);
      yield* setRoster(worker.threadId, [
        { taskId: "native-background-1", kind: "background_task" },
      ]);
      yield* recovery.recover;

      // Recovery clears the roster and records the cancellation; the process may still run.
      assert.deepStrictEqual(yield* custodyOf(worker.threadId), {
        state: "unknown",
        reasons: ["process_containment_unsupported"],
      });
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

/** A scratch directory standing in for the factory's artifact root and its pinned helper. */
const withScratch = <A, E, R>(use: (root: string) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const scratch = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
      return yield* use(scratch);
    }),
  );

const proposeWith = (
  itemKey: string,
  overrides: Partial<FactoryLifecycle.FactoryAdmissionRequest>,
) => proposeCurrent(itemKey, overrides);

it.effect("N14: a wrong packet, helper pin or brief schema is refused before anything starts", () =>
  runIsolated(
    withScratch((scratch) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const helperPath = path.join(scratch, "factory-helper.py");
        yield* fs.writeFileString(helperPath, "print('helper v1')\n");
        const helperSha256 = sha256("print('helper v1')\n");
        yield* configureFactory({
          packet: {
            briefSchemaVersion: "brief-v1",
            helper: { path: helperPath, sha256: helperSha256 },
          },
        });
        const packet = (itemKey: string) => ({
          text: packetText(itemKey),
          sha256: sha256(packetText(itemKey)),
          briefSchemaVersion: "brief-v1",
          helperSha256,
        });

        const refusals = [
          [
            "github:alpha#801",
            { packet: { ...packet("github:alpha#801"), sha256: sha256("other") } },
            "packet_digest_mismatch",
          ],
          [
            "github:alpha#802",
            { packet: { ...packet("github:alpha#802"), briefSchemaVersion: "brief-v0" } },
            "brief_schema_mismatch",
          ],
          [
            "github:alpha#803",
            { packet: { ...packet("github:alpha#803"), helperSha256: sha256("worker helper") } },
            "helper_pin_mismatch",
          ],
          [
            "github:alpha#804",
            { policyRevision: "policy-r0", packet: packet("github:alpha#804") },
            "policy_revision_mismatch",
          ],
        ] as const;
        for (const [itemKey, overrides, reason] of refusals) {
          assert.deepStrictEqual(yield* proposeWith(itemKey, overrides), {
            type: "refused",
            reason,
          });
          yield* assertNothingStarted(itemKey);
        }

        // The pinned helper is replaced on disk: the worker would not find the CLI it was briefed on.
        yield* fs.writeFileString(helperPath, "print('helper v2')\n");
        assert.deepStrictEqual(
          yield* proposeWith("github:alpha#805", { packet: packet("github:alpha#805") }),
          { type: "refused", reason: "helper_unavailable" },
        );
        yield* fs.remove(helperPath);
        assert.deepStrictEqual(
          yield* proposeWith("github:alpha#806", { packet: packet("github:alpha#806") }),
          { type: "refused", reason: "helper_unavailable" },
        );
        yield* assertNothingStarted("github:alpha#806");

        yield* fs.writeFileString(helperPath, "print('helper v1')\n");
        assert.strictEqual(
          (yield* proposeWith("github:alpha#807", { packet: packet("github:alpha#807") })).type,
          "admitted",
        );
      }),
    ),
  ),
);

it.effect("N21: artifact paths must resolve inside the factory root under host path rules", () =>
  runIsolated(
    withScratch((scratch) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(scratch, "Records");
        const outside = path.join(scratch, "elsewhere");
        yield* fs.makeDirectory(path.join(root, "runs"), { recursive: true });
        yield* fs.makeDirectory(outside);
        // A junction on Windows, a directory symlink elsewhere: both escape the root.
        NodeFS.symlinkSync(outside, path.join(root, "escape"), "junction");
        yield* configureFactory({ artifactRoot: root });

        const inside = [path.join(root, "runs", "901", "report.json"), root];
        assert.strictEqual(
          (yield* proposeWith("github:alpha#901", { artifactPaths: inside })).type,
          "admitted",
        );

        const escapes = [
          path.join(root, "escape", "report.json"),
          `${path.join(root, "runs")}${path.sep}..${path.sep}..${path.sep}elsewhere${path.sep}x`,
          path.join("runs", "relative.json"),
          "C:runs\\drive-relative.json",
          path.join(outside, "report.json"),
        ];
        for (const [index, artifactPath] of escapes.entries()) {
          const itemKey = `github:alpha#91${index}`;
          assert.deepStrictEqual(
            yield* proposeWith(itemKey, { artifactPaths: [artifactPath] }),
            { type: "refused", reason: "artifact_path_outside_root" },
            artifactPath,
          );
          yield* assertNothingStarted(itemKey);
        }

        // Windows compares paths case-insensitively; case-sensitive hosts treat it as another dir.
        const caseChanged = path.join(scratch, "RECORDS", "runs", "case.json");
        const expected = path.sep === "\\" ? "admitted" : "refused";
        assert.strictEqual(
          (yield* proposeWith("github:alpha#920", { artifactPaths: [caseChanged] })).type,
          expected,
        );
      }),
    ),
  ),
);

it.effect("N21: identities stay bounded and long histories never cap routine admission", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(100) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const oversized = `github:alpha#${"9".repeat(300)}`;
      const recorded = yield* Effect.exit(observe(oversized));
      assert.isTrue(recorded._tag === "Failure");

      // Many reads of one item, then many admitted items.
      for (let read = 0; read < 300; read += 1) {
        yield* observe("github:alpha#930");
      }
      assert.strictEqual((yield* proposeCurrent("github:alpha#930")).type, "admitted");
      for (let item = 931; item < 961; item += 1) {
        assert.strictEqual((yield* proposeCurrent(`github:alpha#${item}`)).type, "admitted");
      }
      const state = yield* factory.readState({ factoryId });
      assert.strictEqual(state.reservations.length, 31);
      assert.strictEqual(state.pools[0]?.occupiedUnits, 31);
    }),
  ),
);

it.effect(
  "N05: a claim mirroring a native reservation charges once; unattributed claims stay separate",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(3) });
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const store = yield* FactoryStore.FactoryStore;
        const admitted = yield* proposeCurrent("github:beta#1001");
        if (admitted.type !== "admitted") throw new Error("expected admission");

        // T3's own claim effect wrote this label and read it back; an outside label has no
        // native operation behind it.
        yield* store.recordClaimOperation({
          reservationId: admitted.reservation.reservationId,
          carrierKey: FactoryClaimCarrierKey.make("github:beta#1001:label:claimed:event-1"),
        });
        yield* observe("github:beta#1001", {
          claims: [{ carrierKey: "github:beta#1001:label:claimed:event-1" }],
        });
        yield* observe("github:beta#1002", {
          claims: [{ carrierKey: "github:beta#1002:label:claimed:event-2" }],
        });
        const state = yield* factory.readState({ factoryId });
        assert.strictEqual(state.pools[0]?.occupiedUnits, 2);
        assert.deepStrictEqual(
          state.reservations.map((reservation) => [
            reservation.itemKey,
            reservation.origin,
            reservation.custody.state,
          ]),
          [
            ["github:beta#1001", "admitted", "live"],
            ["github:beta#1002", "observed", "unknown"],
          ],
        );
      }),
    ),
);

it.effect("N06: ownership is never inferred from a label, actor or timestamp", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(4) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const historical = yield* proposeCurrent("github:beta#1101");
      const other = yield* proposeCurrent("github:beta#1102");
      if (historical.type !== "admitted" || other.type !== "admitted") throw new Error("setup");
      yield* completeLatestRun(executionOf(historical.reservation)!.threadId);

      // In the same second, the same actor applies a manual claim to the ticket; another claim
      // names a reservation that belongs to a different ticket.
      const manual = yield* observe("github:beta#1101", {
        itemVersion: "v2",
        evidence: [
          { carrierId: "github:beta#1101:body", bodyDigest: sha256("rework"), version: "2" },
        ],
        claims: [
          {
            carrierKey: "github:beta#1101:label:claimed:manual",
          },
          {
            carrierKey: "github:beta#1101:label:claimed:foreign",
          },
        ],
      });
      const state = yield* factory.readState({ factoryId });
      assert.deepStrictEqual(
        state.reservations
          .filter((reservation) => reservation.itemKey === "github:beta#1101")
          .map((reservation) => reservation.origin),
        ["admitted", "observed", "observed"],
      );
      assert.deepStrictEqual(
        yield* factory.admit(
          admissionFor("github:beta#1101", {
            observationId: manual.observationId,
            deadline: yield* inOneHour,
          }),
        ),
        { type: "refused", reason: "item_owned" },
      );
    }),
  ),
);

it.effect(
  "N19: new decisions use the current account; earlier work keeps its original selection",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(3) });
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const before = admittedExecution(yield* proposeCurrent("github:alpha#1201"));

        // The owner moves new work to another account and options.
        const alphaClaude = { ...rosterSelection, options: [{ id: "effort", value: "high" }] };
        yield* configureFactory({
          pools: pool(3),
          execution: {
            modelSelection: alphaClaude,
            runtimeMode: "full-access",
            interactionMode: "default",
          },
        });
        const after = admittedExecution(yield* proposeCurrent("github:alpha#1202"));

        const runOf = (threadId: ThreadId) =>
          Effect.map(
            orchestrator.getThreadProjection(threadId),
            (projection) => projection.runs[0]!,
          );
        assert.deepStrictEqual((yield* runOf(before.threadId)).modelSelection, betaSelection);
        assert.deepStrictEqual((yield* runOf(after.threadId)).modelSelection, alphaClaude);
        const state = yield* factory.readState({ factoryId });
        const pinned = (threadId: ThreadId) =>
          state.reservations.find(
            (
              reservation,
            ): reservation is Extract<typeof reservation, FactoryStore.NativeReservation> =>
              executionOf(reservation)?.threadId === threadId,
          )!;
        assert.deepStrictEqual(pinned(before.threadId).modelSelection, betaSelection);
        assert.deepStrictEqual(pinned(before.threadId).configRevision, 1);
        assert.deepStrictEqual(pinned(after.threadId).modelSelection, alphaClaude);
        assert.notStrictEqual(pinned(before.threadId).custody.reasons[0], "selection_mismatch");

        // Negative control: a running worker relabelled to the new account is not silently accepted.
        const run = yield* runOf(before.threadId);
        yield* sink.write({
          events: [
            {
              id: EventId.make("event:relabel"),
              type: "run.updated",
              threadId: before.threadId,
              runId: run.id,
              providerInstanceId: run.providerInstanceId,
              occurredAt: yield* DateTime.now,
              payload: { ...run, modelSelection: alphaClaude },
            },
          ],
        });
        assert.deepStrictEqual(yield* custodyOf(before.threadId), {
          state: "unknown",
          reasons: ["selection_mismatch"],
        });
      }),
    ),
);

// Review round 1 controls. Each asserts the required behaviour; against candidate 2b75ffcc7 they
// fail on the defect each Spec finding describes.

const delegateWith = (threadId: ThreadId, label: string, modelSelection: ModelSelection) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const run = (yield* orchestrator.getThreadProjection(threadId)).runs.at(-1)!;
    return yield* orchestrator.dispatch({
      type: "delegated_task.request",
      createdBy: "agent",
      creationSource: "mcp",
      commandId: CommandId.make(`command:delegate:${label}`),
      parentThreadId: threadId,
      parentRunId: run.id,
      parentNodeId: run.rootNodeId!,
      task: `Delegated work ${label}`,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });

it.effect("Spec/G1-S04: a descendant must use the factory's current account and pause state", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(4) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const worker = admittedExecution(yield* proposeCurrent("github:beta#1301"));

      const otherAccount = yield* delegateWith(
        worker.threadId,
        "other-account",
        rosterSelection,
      ).pipe(Effect.flip);
      expectRefusal(otherAccount, "selection_not_configured");

      // The owner moves new work to another account; a child on the new account is admitted and
      // pins the current configuration, while the parent keeps its own.
      const moved = yield* configureFactory({
        pools: pool(4),
        execution: {
          modelSelection: rosterSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      });
      yield* delegateWith(worker.threadId, "new-account", rosterSelection);
      const child = (yield* factory.readState({ factoryId })).reservations.find(
        (reservation): reservation is Extract<typeof reservation, { origin: "inherited" }> =>
          reservation.origin === "inherited",
      )!;
      assert.strictEqual(child.configRevision, moved.revision);
      assert.deepStrictEqual(child.modelSelection, rosterSelection);

      yield* configureFactory({
        enabled: false,
        pools: pool(4),
        execution: {
          modelSelection: rosterSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      });
      const paused = yield* delegateWith(worker.threadId, "paused", rosterSelection).pipe(
        Effect.flip,
      );
      expectRefusal(paused, "factory_paused");
    }),
  ),
);

it.effect("Spec/G1-S03: a claim that only names a native reservation is not its mirror", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(3) });
      const store = yield* FactoryStore.FactoryStore;
      const admitted = yield* proposeCurrent("github:beta#1401");
      if (admitted.type !== "admitted") throw new Error("expected admission");
      // A distinct external claim, whatever its metadata says, has no native claim operation.
      yield* observe("github:beta#1401", {
        claims: [{ carrierKey: "github:beta#1401:label:claimed:outside-actor" }],
      });
      assert.strictEqual(yield* occupied, 2);

      // Positive control: the carrier T3's own claim operation produced is the mirror.
      yield* store.recordClaimOperation({
        reservationId: admitted.reservation.reservationId,
        carrierKey: FactoryClaimCarrierKey.make("github:beta#1401:label:claimed:native"),
      });
      yield* observe("github:beta#1401", {
        claims: [
          { carrierKey: "github:beta#1401:label:claimed:outside-actor" },
          { carrierKey: "github:beta#1401:label:claimed:native" },
        ],
      });
      assert.strictEqual(yield* occupied, 2);
    }),
  ),
);

it.effect("Spec/G1-S02: a delayed earlier read cannot displace a newer known read", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      // Collection 1 starts reading v1; collection 2 starts later, sees v2 and records first.
      const older = yield* beginCollection;
      const newer = yield* beginCollection;
      const current = yield* observe("github:beta#1501", {
        generation: newer,
        itemVersion: "v2",
        evidence: [{ carrierId: "github:beta#1501:body", bodyDigest: sha256("v2"), version: "2" }],
      });
      const delayed = yield* observeResult("github:beta#1501", { generation: older });
      assert.deepStrictEqual(delayed, { type: "superseded", current });
      assert.strictEqual(
        (yield* factory.admit(
          admissionFor("github:beta#1501", {
            observationId: current.observationId,
            deadline: yield* inOneHour,
          }),
        )).type,
        "admitted",
      );
    }),
  ),
);

it.effect("Spec/G1-S02: two different reads under one generation token cannot both stand", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const generation = yield* beginCollection;
      const first = yield* observe("github:beta#1502", { generation });
      // A second, different payload arrives under the same token after the first.
      const conflicting = yield* observeResult("github:beta#1502", {
        generation,
        itemVersion: "v2",
        evidence: [{ carrierId: "github:beta#1502:body", bodyDigest: sha256("v2"), version: "2" }],
      });
      assert.deepStrictEqual(conflicting, { type: "conflict", recorded: first });
      // An identical replay of the first read is the same observation.
      const replay = yield* observe("github:beta#1502", { generation });
      assert.strictEqual(replay.observationId, first.observationId);
      // Requirement correction (round 2): the conflict fences the first basis until a fresh read.
      // Formerly this test expected the first observation to remain admissible.
      assert.deepStrictEqual(
        yield* factory.admit(
          admissionFor("github:beta#1502", {
            observationId: first.observationId,
            deadline: yield* inOneHour,
          }),
        ),
        { type: "refused", reason: "stale_basis" },
      );
      // A token the factory never allocated is not a read generation at all.
      assert.deepStrictEqual(
        yield* observeResult("github:beta#1502", { generation: FactoryReadGeneration.make(999) }),
        { type: "unknown_generation" },
      );
      const fresh = yield* observe("github:beta#1502");
      assert.strictEqual(
        (yield* factory.admit(
          admissionFor("github:beta#1502", {
            observationId: fresh.observationId,
            deadline: yield* inOneHour,
          }),
        )).type,
        "admitted",
      );
    }),
  ),
);

it.effect("Spec/G1-S02: a later change and change-back cannot resurrect an earlier basis", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory();
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const earlier = yield* observe("github:beta#1503");
      yield* observe("github:beta#1503", {
        itemVersion: "v2",
        evidence: [{ carrierId: "github:beta#1503:body", bodyDigest: sha256("v2"), version: "2" }],
      });
      const reverted = yield* observe("github:beta#1503");
      assert.deepStrictEqual(
        yield* factory.admit(
          admissionFor("github:beta#1503", {
            observationId: earlier.observationId,
            deadline: yield* inOneHour,
          }),
        ),
        { type: "refused", reason: "stale_basis" },
      );
      // The read after the change-back is a current basis in its own right.
      assert.strictEqual(
        (yield* factory.admit(
          admissionFor("github:beta#1503", {
            observationId: reverted.observationId,
            deadline: yield* inOneHour,
          }),
        )).type,
        "admitted",
      );
    }),
  ),
);

/** Waits for the scripted provider's running turn to reach the projection. */
const awaitRunningTurn = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.streamDomainEvents.pipe(
      Stream.filter(
        (event) =>
          event.threadId === threadId &&
          event.type === "provider-turn.updated" &&
          event.payload.status === "running",
      ),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    );
  });

/** Runs the effect worker over everything queued, as the daemon would. */
const runEffects = Effect.gen(function* () {
  const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
  yield* worker.drain();
});

const startedTurns = Effect.flatMap(ProviderStarts, Ref.get);

/** Admits a worker and lets the effect worker start its provider turn. */
const startWorker = (itemKey: string) =>
  Effect.gen(function* () {
    const execution = admittedExecution(yield* proposeCurrent(itemKey));
    const running = yield* awaitRunningTurn(execution.threadId);
    yield* runEffects;
    yield* Fiber.join(running);
    return execution;
  });

it.effect(
  "Spec/G1-S05: a restart does not start a second execution while factory custody is unknown",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
          const worker = yield* startWorker("github:beta#1601");
          assert.strictEqual((yield* startedTurns).length, 1);

          // The server loses its runtime while the scripted process never reported exit.
          yield* recovery.recover;
          yield* runEffects;

          assert.strictEqual((yield* startedTurns).length, 1);
          const custody = yield* custodyOf(worker.threadId);
          assert.strictEqual(custody.state, "unknown");
          assert.strictEqual(yield* occupied, 1);
        }),
      ),
      { continueAfterRestart: true },
    ),
);

it.effect(
  "Spec/G1-S05: a user message after the owned session is gone does not start another execution",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
          const worker = yield* startWorker("github:beta#1602");
          yield* recovery.recover;
          yield* sendUserMessage(worker.threadId, "after-restart");
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
        }),
      ),
    ),
);

it.effect("Spec/G1-S05 control: unrelated conversations still continue after a restart", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        const conversation = ThreadId.make("thread:unrelated:restart");
        yield* createTopLevelThread(conversation, "user");
        const running = yield* awaitRunningTurn(conversation);
        yield* sendUserMessage(conversation, "unrelated-work");
        yield* runEffects;
        yield* Fiber.join(running);
        yield* recovery.recover;
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 2);
      }),
    ),
    { continueAfterRestart: true },
  ),
);

it.effect("Spec/G1-S05: a cached session does not let a follow-up start a second execution", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const worker = yield* startWorker("github:beta#1603");
        // The provider reports the turn finished; T3 still holds the session runtime, but nothing
        // proves the next turn would run inside the same native process.
        yield* completeLatestRun(worker.threadId);
        yield* sendUserMessage(worker.threadId, "cached-session-follow-up");
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect("Spec/G1-S05 control: a follow-up after positively quiescent predecessors starts", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureRosterFactory(1);
        const worker = yield* startWorker("github:beta#1604");
        // A roster-declaring provider finished the turn with nothing left in its roster.
        yield* completeLatestRun(worker.threadId);
        assert.strictEqual((yield* custodyOf(worker.threadId)).state, "quiescent");
        yield* sendUserMessage(worker.threadId, "quiescent-follow-up");
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 2);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect("Spec/G1-S05 control: steering joins the live turn without starting another", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* startWorker("github:beta#1605");
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:message:steer"),
          threadId: worker.threadId,
          messageId: MessageId.make("message:steer"),
          text: "Also cover the edge case.",
          attachments: [],
          dispatchMode: { type: "steer_active", targetRunId: worker.runId },
        });
        yield* runEffects;
        assert.strictEqual((yield* Effect.flatMap(ProviderSteers, Ref.get)).length, 1);
        assert.strictEqual((yield* startedTurns).length, 1);
      }),
    ),
  ),
);

/** Stands in for ThreadLaunchService on a root workspace: create the thread, then send its first message. */
const layerScheduledTasks = ScheduledTaskService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.effect(
        ThreadLaunchService.ThreadLaunchService,
        Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          return ThreadLaunchService.ThreadLaunchService.of({
            launch: (input: ThreadLaunchService.ThreadLaunchInput) =>
              Effect.gen(function* () {
                const initialMessage = input.initialMessage!;
                const threadId = ThreadId.make(`thread:launched:${input.commandId}`);
                yield* orchestrator.dispatch({
                  type: "thread.create",
                  createdBy: input.createdBy ?? "agent",
                  creationSource: input.creationSource ?? "server",
                  commandId: CommandId.make(`${input.commandId}:create`),
                  threadId,
                  projectId: input.projectId,
                  title: input.title,
                  modelSelection: input.modelSelection,
                  runtimeMode: input.runtimeMode,
                  interactionMode: input.interactionMode,
                  branch: null,
                  worktreePath: null,
                });
                yield* orchestrator.dispatch({
                  type: "message.dispatch",
                  createdBy: input.createdBy ?? "agent",
                  creationSource: input.creationSource ?? "server",
                  commandId: input.commandId,
                  threadId,
                  messageId:
                    initialMessage.messageId ?? MessageId.make(`message:${input.commandId}`),
                  text: initialMessage.text,
                  attachments: [],
                  ...(initialMessage.scheduledTaskId === undefined
                    ? {}
                    : { scheduledTaskId: initialMessage.scheduledTaskId }),
                  dispatchMode: { type: "start_immediately" },
                });
                return { threadId } as unknown as ThreadLaunchService.ThreadLaunchResult;
              }).pipe(Effect.orDie),
          } as unknown as ThreadLaunchService.ThreadLaunchService["Service"]);
        }),
      ),
      Layer.mock(SecretRequests.SecretRequests)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      NodeCryptoLayer.layer,
      Scheduler.layer,
    ),
  ),
);

const freshThreadSchedule = (title: string) => ({
  title,
  prompt: "Check progress",
  enabled: true,
  schedule: { type: "interval" as const, everyMs: 60_000 },
  projectId,
  threadId: null,
  workspaceStrategy: { type: "root" as const },
  modelSelection: betaSelection,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
});

it.effect(
  "Spec/G1-S01: a crash between a worker's schedule and its lineage leaves no unreserved start",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        const sql = yield* SqlClient.SqlClient;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const worker = admittedExecution(yield* proposeCurrent("github:beta#1701"));

        // The origin write fails after the schedule write, as a crash between them would.
        yield* sql`CREATE TRIGGER crash_before_origin BEFORE INSERT ON factory_schedule_origins
        BEGIN SELECT RAISE(ABORT, 'injected crash'); END`;
        const saved = yield* Effect.exit(
          service.upsert(freshThreadSchedule("worker schedule"), {
            callerThreadId: worker.threadId,
          }),
        );
        assert.isTrue(saved._tag === "Failure");
        yield* sql`DROP TRIGGER crash_before_origin`;

        // After the restart, whatever schedule survived becomes due and runs.
        for (const task of (yield* service.list()).tasks) {
          if (task.title === "worker schedule") yield* service.runNow({ id: task.id });
        }
        const { threads } = yield* projections.getShellSnapshot();
        const unreserved = threads.filter(
          (shell) => shell.title === "worker schedule" && shell.latestRunId !== null,
        );
        assert.deepStrictEqual(
          unreserved.map((shell) => shell.id),
          [],
        );
        assert.deepStrictEqual(
          (yield* service.list()).tasks.filter((task) => task.title === "worker schedule"),
          [],
        );
        assert.strictEqual(yield* occupied, 1);
      }).pipe(Effect.provide(layerScheduledTasks)),
    ),
);

// Review round 2 controls. Against candidate 4945d58e each negative control fails on the defect
// its Spec finding describes.

const runStatuses = (threadId: ThreadId) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    Effect.map(orchestrator.getThreadProjection(threadId), (projection) =>
      projection.runs.map((run) => run.status),
    ),
  );

const restartWorkerRun = (worker: { readonly threadId: ThreadId; readonly runId: RunId }) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:restart:${worker.runId}`),
      threadId: worker.threadId,
      messageId: MessageId.make(`message:restart:${worker.runId}`),
      text: "Start over with the new constraint.",
      attachments: [],
      dispatchMode: { type: "restart_active", targetRunId: worker.runId },
    });
    yield* runEffects;
  });

it.effect(
  "Spec/G1-R2-S01: a same-run restart does not start a second execution while custody is unknown",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* startWorker("github:beta#2001");
          assert.strictEqual((yield* startedTurns).length, 1);
          // The interrupt confirms the turn ended; nothing proves its background work stopped.
          yield* restartWorkerRun(worker);
          assert.strictEqual((yield* startedTurns).length, 1);
          const projection = yield* orchestrator.getThreadProjection(worker.threadId);
          assert.strictEqual(projection.runs.length, 1);
          assert.strictEqual(yield* occupied, 1);
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R2-S01 control: a same-run restart after positively quiescent predecessors starts",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureRosterFactory(1);
          const worker = yield* startWorker("github:beta#2002");
          // A roster-declaring provider confirms the interrupt with nothing left in its roster.
          yield* restartWorkerRun(worker);
          assert.strictEqual((yield* startedTurns).length, 2);
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R2-S02: an original never-started launch does not vouch for a later execution",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
          const worker = admittedExecution(yield* proposeCurrent("github:beta#2101"));
          // The server restarts before the original start was ever claimed.
          yield* recovery.recover;
          assert.deepStrictEqual(yield* runStatuses(worker.threadId), ["cancelled"]);
          // Genuine never-started predecessor: the first follow-up may start.
          const running = yield* awaitRunningTurn(worker.threadId);
          yield* sendUserMessage(worker.threadId, "first-follow-up");
          yield* runEffects;
          yield* Fiber.join(running);
          assert.strictEqual((yield* startedTurns).length, 1);

          // A later server startup while that execution's outcome is unknown. Recovery's command
          // id includes the startup instant, so this startup gets its own distinct instant.
          yield* TestClock.adjust("1 minute");
          yield* recovery.recover;
          assert.deepStrictEqual(yield* runStatuses(worker.threadId), ["cancelled", "cancelled"]);
          const custodyAfterRestart = (yield* custodyOf(worker.threadId)).state;
          yield* sendUserMessage(worker.threadId, "second-follow-up");
          yield* runEffects;
          assert.deepStrictEqual(
            [custodyAfterRestart, (yield* startedTurns).length],
            ["unknown", 1],
          );
        }),
      ),
    ),
);

it.effect("Spec/G1-R2-S02 control: pruned launch evidence is not never-started proof", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        const sql = yield* SqlClient.SqlClient;
        const worker = admittedExecution(yield* proposeCurrent("github:beta#2102"));
        yield* recovery.recover;
        // Settled outbox rows are pruned after retention; their absence proves nothing.
        yield* sql`DELETE FROM orchestration_v2_effect_outbox WHERE command_id = ${worker.commandId}`;
        yield* sendUserMessage(worker.threadId, "after-prune");
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
      }),
    ),
  ),
);

it.effect("Spec/G1-R2-S03: a conflicting read fences the older proposal and keeps its claim", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({ pools: pool(2) });
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const generation = yield* beginCollection;
      const first = yield* observe("github:beta#2201", { generation });
      // Under the same token a second read sees a changed issue and a manual claim.
      const conflicting = yield* observeResult("github:beta#2201", {
        generation,
        itemVersion: "v2",
        evidence: [{ carrierId: "github:beta#2201:body", bodyDigest: sha256("v2"), version: "2" }],
        claims: [{ carrierKey: "github:beta#2201:label:claimed:manual" }],
      });
      assert.strictEqual(conflicting.type, "conflict");
      // An exact replay of the first read does not clear the conflict.
      assert.strictEqual(
        (yield* observe("github:beta#2201", { generation })).observationId,
        first.observationId,
      );
      assert.deepStrictEqual(
        yield* factory.admit(
          admissionFor("github:beta#2201", {
            observationId: first.observationId,
            deadline: yield* inOneHour,
          }),
        ),
        { type: "refused", reason: "stale_basis" },
      );
      const state = yield* factory.readState({ factoryId });
      assert.deepStrictEqual(
        state.reservations.map((reservation) => [reservation.origin, reservation.custody.state]),
        [["observed", "unknown"]],
      );
      assert.strictEqual(state.pools[0]?.occupiedUnits, 1);
    }),
  ),
);

// Parent queue-scope question: queued intent is custody in readState, but it never executed, so
// it cannot be a predecessor that blocks the queue's own next start.

const queueUserMessage = (threadId: ThreadId, label: string) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:message:${label}`),
      threadId,
      messageId: MessageId.make(`message:${label}`),
      text: `Message ${label}`,
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
    }),
  );

/**
 * Forks a wait for the next matching event of the thread. The cursor is taken before the caller
 * acts, so an event the detached queue reactor writes first is still seen.
 */
const awaitEvent = (threadId: ThreadId, matches: (event: OrchestrationV2DomainEvent) => boolean) =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const after = yield* sink.latestSequence({ threadId });
    return yield* sink.stream({ threadId, afterSequence: after }).pipe(
      Stream.filter((stored) => matches(stored.event)),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    );
  });

const runUpdated =
  (matches: (run: OrchestrationV2Run) => boolean) => (event: OrchestrationV2DomainEvent) =>
    event.type === "run.updated" && matches(event.payload);

it.effect("Queue scope: a quiet first execution lets the queue start its next follow-up once", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureRosterFactory(1);
        const worker = yield* startWorker("github:beta#2301");
        yield* queueUserMessage(worker.threadId, "queued-first");
        yield* queueUserMessage(worker.threadId, "queued-second");
        assert.deepStrictEqual(yield* runStatuses(worker.threadId), [
          "running",
          "queued",
          "queued",
        ]);

        const promoted = yield* awaitEvent(
          worker.threadId,
          runUpdated((run) => run.ordinal === 2 && run.status === "starting"),
        );
        // The start either commits the run as running or the fence settles it failed.
        const startedOrRefused = yield* awaitEvent(
          worker.threadId,
          runUpdated(
            (run) => run.ordinal === 2 && (run.status === "running" || run.status === "failed"),
          ),
        );
        // A roster-declaring provider finished the first turn with nothing left in its roster.
        // The terminal events are fixture writes; the Orchestrator's own run-update reactor then
        // promotes the next queued follow-up, as it does after a real turn ends.
        yield* completeLatestRun(worker.threadId);
        yield* Fiber.join(promoted);
        yield* runEffects;
        yield* Fiber.join(startedOrRefused);

        assert.strictEqual((yield* startedTurns).length, 2);
        assert.deepStrictEqual(yield* runStatuses(worker.threadId), [
          "completed",
          "running",
          "queued",
        ]);
        // readState still counts the later intent as custody.
        assert.include((yield* custodyOf(worker.threadId)).reasons, "run_queued");
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect("Queue scope control: an unproven first execution keeps the queue from starting", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        // This provider does not declare a complete roster, so the first turn's end proves nothing.
        yield* configureFactory({ pools: pool(1) });
        const worker = yield* startWorker("github:beta#2302");
        yield* queueUserMessage(worker.threadId, "queued-unproven-first");
        yield* queueUserMessage(worker.threadId, "queued-unproven-second");

        const promoted = yield* awaitEvent(
          worker.threadId,
          runUpdated((run) => run.ordinal === 2 && run.status === "starting"),
        );
        const held = yield* awaitEvent(
          worker.threadId,
          runUpdated((run) => run.ordinal === 3 && run.queueHeld === true),
        );
        yield* completeLatestRun(worker.threadId);
        yield* Fiber.join(promoted);
        yield* runEffects;
        // The refused start fails the follow-up, and the native queue holds the rest.
        yield* Fiber.join(held);

        assert.strictEqual((yield* startedTurns).length, 1);
        assert.deepStrictEqual(yield* runStatuses(worker.threadId), [
          "completed",
          "failed",
          "queued",
        ]);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

// Review round 3 (Spec/G1-R3-S01): a thread a factory worker creates without a first message
// keeps its factory origin, whoever later starts it. These compose the real MCP create_threads
// service over the factory runtime; the later start is the native UI message path.

const codexSnapshot: ServerProvider = {
  instanceId: betaSelection.instanceId,
  driver,
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-23T00:00:00.000Z",
  models: [
    { slug: betaSelection.model, name: betaSelection.model, isCustom: false, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
};

/** The real MCP thread tools over this runtime; only launch and git, which they do not use, are stubbed. */
const layerMcpService = OrchestratorMcpService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(GitVcsDriver.GitVcsDriver)({}),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([codexSnapshot]),
        refreshInstance: () => Effect.succeed([codexSnapshot]),
      }),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
      Layer.mock(RemoteDelegation.RemoteDelegation)({}),
      NodeCryptoLayer.layer,
      ServerSettings.layerTest(),
    ),
  ),
);

/** The MCP scope of an agent running in `threadId`, as its provider session authenticates it. */
const agentScope = (threadId: ThreadId): McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:factory"),
  requestNamespace: `provider-session:${threadId}`,
  thread: {
    threadId,
    providerSessionId: `provider-session:${threadId}`,
    providerInstanceId: betaSelection.instanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
});

/** An agent in `threadId` creates one top-level thread through create_threads. */
const createThreadFrom = (
  threadId: ThreadId,
  request: { readonly clientRequestId: string; readonly prompt?: string },
) =>
  Effect.gen(function* () {
    const service = yield* OrchestratorMcpService.OrchestratorMcpService;
    return yield* service.createThreads(agentScope(threadId), {
      threads: [
        {
          title: `Follow-up ${request.clientRequestId}`,
          ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
        },
      ],
      clientRequestId: request.clientRequestId,
    });
  });

const threadTitled = (title: string) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { threads } = yield* projections.getShellSnapshot();
    const found = threads.filter((shell) => shell.title === title);
    assert.strictEqual(found.length, 1);
    return found[0]!.id;
  });

/** What a start attempt came to: accepted, or the factory refusal that stopped it. */
const startOutcome = <A, R>(start: Effect.Effect<A, Orchestrator.OrchestratorV2Error, R>) =>
  Effect.map(Effect.exit(start), (exit) => {
    if (exit._tag === "Success") return "accepted";
    const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
    return error?._tag === "OrchestratorFactoryReservationRefusedError"
      ? error.refusal
      : `failed:${error?._tag ?? "defect"}`;
  });

const bindingOf = (threadId: ThreadId) =>
  Effect.flatMap(FactoryStore.FactoryStore, (store) => store.bindingForThread(threadId));

/** The thread's first run either started or was settled before start. */
const awaitFirstRunSettled = (threadId: ThreadId) =>
  awaitEvent(
    threadId,
    runUpdated((run) => run.ordinal === 1 && (run.status === "running" || run.status === "failed")),
  );

it.effect("Spec/G1-R3-S01: a worker-created empty thread cannot start outside a full pool", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const worker = yield* startWorker("github:beta#3001");
        const created = yield* createThreadFrom(worker.threadId, { clientRequestId: "empty" }).pipe(
          Effect.provide(layerMcpService),
        );
        const target = created.threads[0]!.threadId;
        assert.strictEqual(created.threads[0]!.runId, null);

        // Later the user starts it from the UI, with no sender.
        assert.strictEqual(
          yield* startOutcome(sendUserMessage(target, "ui-first")),
          "capacity_exhausted",
        );
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.isTrue(Option.isNone(yield* bindingOf(target)));
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect(
  "Spec/G1-R3-S01: a refused sender-bearing start does not make a later senderless start free",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const worker = yield* startWorker("github:beta#3002");
          // The prompted first message is refused, but the created thread remains.
          const prompted = yield* Effect.exit(
            createThreadFrom(worker.threadId, {
              clientRequestId: "prompted",
              prompt: "Do it.",
            }).pipe(Effect.provide(layerMcpService)),
          );
          assert.strictEqual(prompted._tag, "Failure");
          const target = yield* threadTitled("Follow-up prompted");

          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "ui-retry")),
            "capacity_exhausted",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.isTrue(Option.isNone(yield* bindingOf(target)));
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R3-S01: a UI start before the creation record, then a failed record, leaves no free target",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const worker = yield* startWorker("github:beta#3003");
          const interleaved = yield* Ref.make<string | undefined>(undefined);
          // The creation record is a later, separate command: the user starts the target first,
          // then the record never lands, as if the server stopped between the two.
          const layerInterleavedThreads = Layer.effect(
            ThreadManagementService.ThreadManagementService,
            Effect.gen(function* () {
              const threads = yield* ThreadManagementService.ThreadManagementService;
              const context = yield* Effect.context<
                Orchestrator.OrchestratorV2 | EffectWorker.OrchestrationEffectWorkerV2
              >();
              return ThreadManagementService.ThreadManagementService.of({
                ...threads,
                dispatch: (command) =>
                  command.type === "thread.created.record"
                    ? startOutcome(
                        sendUserMessage(command.targetThreadId, "ui-before-record"),
                      ).pipe(
                        Effect.tap((outcome) => Ref.set(interleaved, outcome)),
                        Effect.andThen(runEffects),
                        Effect.provide(context),
                        Effect.orDie,
                        Effect.andThen(Effect.die("server stopped before the creation record")),
                      )
                    : threads.dispatch(command),
              });
            }),
          );
          const result = yield* Effect.exit(
            createThreadFrom(worker.threadId, { clientRequestId: "interleaved" }).pipe(
              Effect.provide(layerMcpService.pipe(Layer.provide(layerInterleavedThreads))),
            ),
          );
          assert.strictEqual(result._tag, "Failure");
          const target = yield* threadTitled("Follow-up interleaved");

          assert.strictEqual(yield* Ref.get(interleaved), "capacity_exhausted");
          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "ui-after-crash")),
            "capacity_exhausted",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.isTrue(Option.isNone(yield* bindingOf(target)));
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R3-S01 control: with capacity, the later start is the worker's counted descendant",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(2) });
          const worker = yield* startWorker("github:beta#3004");
          const workerReservation = yield* bindingOf(worker.threadId);
          const first = yield* createThreadFrom(worker.threadId, {
            clientRequestId: "replayed",
          }).pipe(Effect.provide(layerMcpService));
          // A retried create_threads replays its receipt: same thread, no second origin.
          const replay = yield* createThreadFrom(worker.threadId, {
            clientRequestId: "replayed",
          }).pipe(Effect.provide(layerMcpService));
          const target = first.threads[0]!.threadId;
          assert.strictEqual(replay.threads[0]!.threadId, target);

          const settled = yield* awaitFirstRunSettled(target);
          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "ui-with-room")),
            "accepted",
          );
          yield* runEffects;
          yield* Fiber.join(settled);

          assert.strictEqual((yield* startedTurns).length, 2);
          const binding = Option.getOrThrow(yield* bindingOf(target));
          assert.strictEqual(binding.origin, "inherited");
          assert.strictEqual(
            binding.origin === "inherited" ? binding.parentReservationId : null,
            Option.getOrThrow(workerReservation).reservationId,
          );
          assert.strictEqual(yield* occupied, 2);
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R3-S01 control: the later start meets the policy in force then, not at creation",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(2) });
          const worker = yield* startWorker("github:beta#3005");
          const workerBefore = yield* bindingOf(worker.threadId);
          const created = yield* createThreadFrom(worker.threadId, {
            clientRequestId: "paused",
          }).pipe(Effect.provide(layerMcpService));
          yield* configureFactory({ pools: pool(2), enabled: false });

          assert.strictEqual(
            yield* startOutcome(sendUserMessage(created.threads[0]!.threadId, "ui-paused")),
            "factory_paused",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          // The worker keeps its admitted pins.
          assert.deepStrictEqual(yield* bindingOf(worker.threadId), workerBefore);
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R3-S01 control: unrelated conversations still start while the pool is full",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          yield* startWorker("github:beta#3006");

          // A thread the user creates, and one an ordinary conversation's agent creates.
          const userThread = ThreadId.make("thread:user-created");
          yield* createTopLevelThread(userThread, "user");
          const conversation = ThreadId.make("thread:ordinary-conversation");
          yield* createTopLevelThread(conversation, "user");
          const conversationRunning = yield* awaitFirstRunSettled(conversation);
          yield* sendUserMessage(conversation, "ordinary-start");
          yield* runEffects;
          yield* Fiber.join(conversationRunning);
          const created = yield* createThreadFrom(conversation, {
            clientRequestId: "ordinary",
          }).pipe(Effect.provide(layerMcpService));
          const agentCreated = created.threads[0]!.threadId;

          for (const [threadId, label] of [
            [userThread, "user-start"],
            [agentCreated, "agent-created-start"],
          ] as const) {
            const settled = yield* awaitFirstRunSettled(threadId);
            assert.strictEqual(yield* startOutcome(sendUserMessage(threadId, label)), "accepted");
            yield* runEffects;
            yield* Fiber.join(settled);
            assert.isTrue(Option.isNone(yield* bindingOf(threadId)));
          }
          assert.strictEqual((yield* startedTurns).length, 4);
          assert.strictEqual(yield* occupied, 1);
        }),
      ),
    ),
);

/**
 * The real launch service over this runtime. A root launch whose first message is refused never
 * reaches workspace preparation, so the git, terminal, setup and title services stay stubs.
 */
const layerLaunchService = ThreadLaunchService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(WorktreeSetupTracker.WorktreeSetupTracker)({}),
      Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
      Layer.mock(TerminalManager.TerminalManager)({}),
      Layer.mock(GitWorkflow.GitWorkflowService)({}),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
      Layer.mock(TextGeneration.TextGeneration)({}),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([codexSnapshot]),
        refreshInstance: () => Effect.succeed([codexSnapshot]),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
        folderForThread: () => Effect.succeedNone,
      }),
      ServerSettings.layerTest(),
      CommandReceiptStore.layer,
      IdAllocator.layer,
    ),
  ),
);

it.effect(
  "Spec/G1-R3-S01: a launch whose first message is refused leaves no free thread behind",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const worker = yield* startWorker("github:beta#3007");
          // t3_thread_launch from the worker, with a message: the server sets the sender.
          const launched = yield* Effect.exit(
            Effect.flatMap(ThreadLaunchService.ThreadLaunchService, (launches) =>
              launches.launch({
                commandId: CommandId.make("command:launch:refused"),
                threadId: ThreadId.make("thread:launched-refused"),
                projectId,
                title: "Launched follow-up",
                modelSelection: betaSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                workspaceStrategy: { type: "root" },
                initialMessage: {
                  senderThreadId: worker.threadId,
                  text: "Do it.",
                  attachments: [],
                },
                createdBy: "agent",
                creationSource: "mcp",
              }),
            ).pipe(Effect.provide(layerLaunchService)),
          );
          assert.strictEqual(launched._tag, "Failure");
          const target = ThreadId.make("thread:launched-refused");
          assert.strictEqual(yield* runCount(target), 0);

          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "ui-after-launch")),
            "capacity_exhausted",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.isTrue(Option.isNone(yield* bindingOf(target)));
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R3-S01: a scheduled launch whose first message is refused leaves no free thread behind",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const store = yield* FactoryStore.FactoryStore;
          const worker = yield* startWorker("github:beta#3008");
          // The worker's schedule, recorded as ScheduledTaskService.upsert records it.
          const schedule = ScheduledTaskId.make("schedule:worker-follow-up");
          yield* store.recordScheduleOrigin({
            scheduledTaskId: schedule,
            callerThreadId: worker.threadId,
          });
          const target = ThreadId.make("thread:scheduled-refused");
          const launched = yield* Effect.exit(
            Effect.flatMap(ThreadLaunchService.ThreadLaunchService, (launches) =>
              launches.launch({
                commandId: CommandId.make("command:launch:scheduled-refused"),
                threadId: target,
                projectId,
                title: "Scheduled follow-up",
                modelSelection: betaSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                workspaceStrategy: { type: "root" },
                initialMessage: { scheduledTaskId: schedule, text: "Check.", attachments: [] },
                createdBy: "system",
                creationSource: "server",
              }),
            ).pipe(Effect.provide(layerLaunchService)),
          );
          assert.strictEqual(launched._tag, "Failure");
          assert.strictEqual(yield* runCount(target), 0);

          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "ui-after-scheduled")),
            "capacity_exhausted",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.isTrue(Option.isNone(yield* bindingOf(target)));
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R3-S01 control: a failed origin write creates no thread and blocks no other conversation",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const sql = yield* SqlClient.SqlClient;
          const projections = yield* ProjectionStore.ProjectionStoreV2;
          const worker = yield* startWorker("github:beta#3009");
          // The origin write fails inside the creation commit.
          yield* sql`CREATE TRIGGER fail_thread_origin BEFORE INSERT ON factory_thread_origins
          BEGIN SELECT RAISE(ABORT, 'injected origin failure'); END`;
          const created = yield* Effect.exit(
            createThreadFrom(worker.threadId, { clientRequestId: "origin-failed" }).pipe(
              Effect.provide(layerMcpService),
            ),
          );
          assert.strictEqual(created._tag, "Failure");
          const { threads } = yield* projections.getShellSnapshot();
          assert.deepStrictEqual(
            threads.filter((shell) => shell.title === "Follow-up origin-failed"),
            [],
          );

          const userThread = ThreadId.make("thread:user-during-origin-failure");
          yield* createTopLevelThread(userThread, "user");
          const settled = yield* awaitFirstRunSettled(userThread);
          assert.strictEqual(
            yield* startOutcome(sendUserMessage(userThread, "user-ok")),
            "accepted",
          );
          yield* runEffects;
          yield* Fiber.join(settled);
          assert.strictEqual((yield* startedTurns).length, 2);
        }),
      ),
    ),
);

// Review round 4 (Spec/G1-R4-S01): a fork an agent makes belongs to the agent's work, whatever
// thread it selects as context. These call the real MCP t3_thread_transfer tool.

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "factory-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "factory-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

/** The real thread tools; schedules and search, which a fork does not use, are stubbed. */
const layerThreadTools = McpHttpServer.layerThreadToolkit.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mergeAll(
      NodeCryptoLayer.layer,
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
      Layer.mock(ThreadSearch.ThreadSearch)({}),
    ),
  ),
);

/** An agent in `callerThreadId` forks `sourceThreadId` at `runId` through t3_thread_transfer. */
const forkThroughTool = (callerThreadId: ThreadId, sourceThreadId: ThreadId, runId: RunId) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({
      name: "t3_thread_transfer",
      arguments: { action: "fork", threadId: sourceThreadId, sourcePoint: { type: "run", runId } },
    });
    const payload = JSON.parse(
      result.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join(""),
    ) as { readonly targetThreadId?: ThreadId };
    return payload.targetThreadId;
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, agentScope(callerThreadId)),
    Effect.provideService(McpSchema.McpServerClient, mcpClient),
    Effect.provide(layerThreadTools),
  );

/** A completed ordinary conversation, forkable at its finished run. */
const completedConversation = (label: string) =>
  Effect.gen(function* () {
    const threadId = yield* startUnrelatedConversation(label);
    const run = yield* completeLatestRun(threadId);
    return { threadId, runId: run.id };
  });

const userFork = (sourceThreadId: ThreadId, runId: RunId, label: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const targetThreadId = ThreadId.make(`thread:user-fork:${label}`);
    yield* orchestrator.dispatch({
      type: "thread.fork",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:user-fork:${label}`),
      sourceThreadId,
      targetThreadId,
      sourcePoint: { type: "run", runId },
    });
    return targetThreadId;
  });

it.effect(
  "Spec/G1-R4-S01: a worker's fork of an ordinary thread cannot start outside a full pool",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(1) });
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* startWorker("github:beta#4001");
          const source = yield* completedConversation("fork-source");
          const target = yield* forkThroughTool(worker.threadId, source.threadId, source.runId);
          assert.isDefined(target);
          // The selected source stays the fork's context.
          assert.strictEqual(
            (yield* orchestrator.getThreadProjection(target!)).thread.lineage.parentThreadId,
            source.threadId,
          );

          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target!, "fork-ui")),
            "capacity_exhausted",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.isTrue(Option.isNone(yield* bindingOf(target!)));
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R4-S01 control: with capacity, the worker's fork is its counted descendant",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(2) });
          const worker = yield* startWorker("github:beta#4002");
          const workerReservation = Option.getOrThrow(yield* bindingOf(worker.threadId));
          const source = yield* completedConversation("fork-room");
          const target = (yield* forkThroughTool(worker.threadId, source.threadId, source.runId))!;

          const settled = yield* awaitFirstRunSettled(target);
          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "fork-room-ui")),
            "accepted",
          );
          yield* runEffects;
          yield* Fiber.join(settled);
          const binding = Option.getOrThrow(yield* bindingOf(target));
          assert.strictEqual(binding.origin, "inherited");
          assert.strictEqual(
            binding.origin === "inherited" ? binding.parentReservationId : null,
            workerReservation.reservationId,
          );
          assert.strictEqual(yield* occupied, 2);
          // The source conversation stays unbound.
          assert.isTrue(Option.isNone(yield* bindingOf(source.threadId)));
        }),
      ),
    ),
);

it.effect("Spec/G1-R4-S01 control: a user's fork of an ordinary thread still starts", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const worker = (yield* startWorker("github:beta#4003")).threadId;
        const source = yield* completedConversation("user-fork-source");
        const target = yield* userFork(source.threadId, source.runId, "ordinary");
        // A client cannot claim a creator either.
        const claimed = ThreadId.make("thread:user-fork:claimed");
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        yield* orchestrator.dispatch(
          ThreadManagementService.withCreationProvenance(
            {
              type: "thread.fork",
              createdBy: "agent",
              creationSource: "mcp",
              createdFrom: { type: "thread", threadId: worker },
              commandId: CommandId.make("command:user-fork:claimed"),
              sourceThreadId: source.threadId,
              targetThreadId: claimed,
              sourcePoint: { type: "run", runId: source.runId },
            } as Parameters<typeof ThreadManagementService.withCreationProvenance>[0],
            { createdBy: "user", creationSource: "web" },
          ),
        );

        for (const [threadId, label] of [
          [target, "user-fork-ui"],
          [claimed, "claimed-fork-ui"],
        ] as const) {
          const settled = yield* awaitFirstRunSettled(threadId);
          assert.strictEqual(yield* startOutcome(sendUserMessage(threadId, label)), "accepted");
          yield* runEffects;
          yield* Fiber.join(settled);
          assert.isTrue(Option.isNone(yield* bindingOf(threadId)));
        }
        assert.strictEqual((yield* startedTurns).length, 3);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect(
  "Spec/G1-R4-S01: a worker's fork of another worker's thread is refused, not reassigned",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(3) });
          const forker = yield* startWorker("github:beta#4004");
          const other = admittedExecution(yield* proposeCurrent("github:beta#4005"));
          const otherBefore = yield* bindingOf(other.threadId);
          const otherRun = yield* completeLatestRun(other.threadId);
          const target = (yield* forkThroughTool(forker.threadId, other.threadId, otherRun.id))!;

          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "conflict-ui")),
            "origin_conflict",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.isTrue(Option.isNone(yield* bindingOf(target)));
          assert.deepStrictEqual(yield* bindingOf(other.threadId), otherBefore);
          assert.strictEqual(yield* occupied, 2);
        }),
      ),
    ),
);

it.effect("Spec/G1-R4-S01: a failed origin write leaves no fork behind", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureFactory({ pools: pool(1) });
        const sql = yield* SqlClient.SqlClient;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const worker = yield* startWorker("github:beta#4006");
        const source = yield* completedConversation("fork-origin-failed");
        yield* sql`CREATE TRIGGER fail_fork_origin BEFORE INSERT ON factory_thread_origins
        BEGIN SELECT RAISE(ABORT, 'injected origin failure'); END`;

        const forked = yield* forkThroughTool(worker.threadId, source.threadId, source.runId);
        assert.isUndefined(forked);
        const { threads } = yield* projections.getShellSnapshot();
        assert.deepStrictEqual(
          threads.filter((shell) => shell.id.endsWith(":fork")).map((shell) => shell.id),
          [],
        );
        // A user's fork writes no origin and still succeeds.
        const target = yield* userFork(source.threadId, source.runId, "during-origin-failure");
        assert.strictEqual(yield* runCount(target), 0);
      }),
    ),
  ),
);

// Review round 4 (Spec/G1-R4-S02): every start on a bound execution keeps its pinned
// provider instance, model and options.

const followUpWith = (
  threadId: ThreadId,
  label: string,
  modelSelection: ModelSelection | undefined,
) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:follow-up:${label}`),
      threadId,
      messageId: MessageId.make(`message:follow-up:${label}`),
      text: `Continue ${label}`,
      attachments: [],
      ...(modelSelection === undefined ? {} : { modelSelection }),
      dispatchMode: { type: "start_immediately" },
    }),
  );

it.effect.each([
  ["provider instance", betaSelection],
  ["model", { ...rosterSelection, model: "claude-other" }],
  ["options", { ...rosterSelection, options: [{ id: "effort", value: "low" }] }],
] as const)("Spec/G1-R4-S02: a quiescent worker's follow-up cannot change its %s", ([, changed]) =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureRosterFactory(1);
        const worker = yield* startWorker("github:beta#4101");
        yield* completeLatestRun(worker.threadId);
        assert.strictEqual((yield* custodyOf(worker.threadId)).state, "quiescent");
        const pinned = yield* bindingOf(worker.threadId);

        assert.strictEqual(
          yield* startOutcome(followUpWith(worker.threadId, "changed", changed)),
          "selection_pinned",
        );
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.deepStrictEqual(yield* bindingOf(worker.threadId), pinned);
        assert.strictEqual(yield* runCount(worker.threadId), 1);
      }),
    ),
  ),
);

it.effect(
  "Spec/G1-R4-S02 control: a worker keeps its pinned selection across a configuration change",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureRosterFactory(1);
          const worker = yield* startWorker("github:beta#4102");
          const pinned = yield* bindingOf(worker.threadId);
          yield* completeLatestRun(worker.threadId);
          // New work moves to another account; this worker's execution does not.
          yield* configureFactory({ pools: pool(1) });

          const continued = yield* awaitEvent(
            worker.threadId,
            runUpdated(
              (run) => run.ordinal === 2 && (run.status === "running" || run.status === "failed"),
            ),
          );
          assert.strictEqual(
            yield* startOutcome(followUpWith(worker.threadId, "pinned", undefined)),
            "accepted",
          );
          yield* runEffects;
          yield* Fiber.join(continued);
          assert.strictEqual((yield* startedTurns).length, 2);
          assert.deepStrictEqual(
            (yield* startedTurns).map((turn) => turn.modelSelection?.instanceId),
            [rosterSelection.instanceId, rosterSelection.instanceId],
          );
          assert.deepStrictEqual(yield* bindingOf(worker.threadId), pinned);

          yield* completeLatestRun(worker.threadId);
          assert.strictEqual(
            yield* startOutcome(followUpWith(worker.threadId, "new-config", betaSelection)),
            "selection_pinned",
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 2);
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R4-S02: a queued follow-up whose selection changed before promotion does not start",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureRosterFactory(1);
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const sink = yield* EventSink.EventSinkV2;
          const worker = yield* startWorker("github:beta#4103");
          yield* queueUserMessage(worker.threadId, "queued-pinned");
          const queued = (yield* orchestrator.getThreadProjection(worker.threadId)).runs[1]!;
          assert.strictEqual(queued.status, "queued");
          // Fixture write: promotion re-applies a stored selection (queuedRunModelSelection)
          // without a new run.created; here it has changed underneath the queue.
          yield* sink.write({
            events: [
              {
                id: EventId.make("event:queued-selection-changed"),
                type: "run.updated",
                threadId: worker.threadId,
                runId: queued.id,
                providerInstanceId: queued.providerInstanceId,
                occurredAt: yield* DateTime.now,
                payload: {
                  ...queued,
                  modelSelection: { ...rosterSelection, model: "claude-other" },
                },
              },
            ],
          });

          const startedOrRefused = yield* awaitEvent(
            worker.threadId,
            runUpdated(
              (run) => run.ordinal === 2 && (run.status === "running" || run.status === "failed"),
            ),
          );
          yield* completeLatestRun(worker.threadId);
          yield* runEffects;
          yield* Fiber.join(startedOrRefused);
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.deepStrictEqual(yield* runStatuses(worker.threadId), ["completed", "failed"]);
        }),
      ),
    ),
);

it.effect(
  "Spec/G1-R4-S01 control: a descendant's fork of its own worker's thread is counted, not refused",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureFactory({ pools: pool(3) });
          const worker = yield* startWorker("github:beta#4007");
          const workerReservation = Option.getOrThrow(yield* bindingOf(worker.threadId));
          yield* delegateFrom(worker.threadId, "forking-child");
          const child = (yield* childThreadsOf(worker.threadId))[0]!;
          const childRunning = yield* awaitFirstRunSettled(child);
          yield* runEffects;
          yield* Fiber.join(childRunning);
          const workerRun = yield* completeLatestRun(worker.threadId);

          // The child (initiator) and the worker (context) belong to one admitted decision.
          const target = (yield* forkThroughTool(child, worker.threadId, workerRun.id))!;
          const settled = yield* awaitFirstRunSettled(target);
          assert.strictEqual(
            yield* startOutcome(sendUserMessage(target, "same-decision")),
            "accepted",
          );
          yield* runEffects;
          yield* Fiber.join(settled);
          assert.strictEqual((yield* startedTurns).length, 3);
          const binding = Option.getOrThrow(yield* bindingOf(target));
          assert.strictEqual(binding.origin, "inherited");
          assert.strictEqual(
            binding.origin === "inherited" ? binding.decisionKey : null,
            FactoryStore.isNativeReservation(workerReservation)
              ? workerReservation.decisionKey
              : null,
          );
          assert.strictEqual(yield* occupied, 3);
        }),
      ),
    ),
);

// Parent comparator counterexample: an option list with a repeated id reads its first entry, so
// reordering it changes what the provider runs under an otherwise equal selection.
const configureOptionsFactory = (options: ReadonlyArray<{ id: string; value: string }>) =>
  configureFactory({
    pools: pool(1),
    execution: {
      modelSelection: { ...rosterSelection, options },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  });

it.effect("Spec/G1-R4-S02: a repeated option id cannot be reordered under the same pin", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const ambiguous = [
          { id: "effort", value: "low" },
          { id: "effort", value: "high" },
        ];
        yield* configureOptionsFactory(ambiguous);
        const worker = yield* startWorker("github:beta#4201");
        yield* completeLatestRun(worker.threadId);

        assert.strictEqual(
          yield* startOutcome(
            followUpWith(worker.threadId, "reordered-duplicate", {
              ...rosterSelection,
              options: ambiguous.toReversed(),
            }),
          ),
          "selection_pinned",
        );
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 1);

        // The exact pinned list is the same execution's selection.
        const continued = yield* awaitEvent(
          worker.threadId,
          runUpdated(
            (run) => run.ordinal === 2 && (run.status === "running" || run.status === "failed"),
          ),
        );
        assert.strictEqual(
          yield* startOutcome(
            followUpWith(worker.threadId, "exact-duplicate", {
              ...rosterSelection,
              options: ambiguous,
            }),
          ),
          "accepted",
        );
        yield* runEffects;
        yield* Fiber.join(continued);
        assert.strictEqual((yield* startedTurns).length, 2);
      }),
    ),
  ),
);

it.effect("Spec/G1-R4-S02 control: reordering distinct options keeps the same pin", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const distinct = [
          { id: "effort", value: "high" },
          { id: "thinking", value: "on" },
        ];
        yield* configureOptionsFactory(distinct);
        const worker = yield* startWorker("github:beta#4202");
        yield* completeLatestRun(worker.threadId);

        const continued = yield* awaitEvent(
          worker.threadId,
          runUpdated(
            (run) => run.ordinal === 2 && (run.status === "running" || run.status === "failed"),
          ),
        );
        assert.strictEqual(
          yield* startOutcome(
            followUpWith(worker.threadId, "reordered-distinct", {
              ...rosterSelection,
              options: distinct.toReversed(),
            }),
          ),
          "accepted",
        );
        yield* runEffects;
        yield* Fiber.join(continued);
        assert.strictEqual((yield* startedTurns).length, 2);
      }),
    ),
  ),
);

// Gate 1 completion A: a native factory claim is written and read back before any provider work.
// These red controls drive the component admission seam with a hand-written observation; the
// final tests drive the same scenarios through the native collection seam.

const claimRepository = "example-org/beta";
const claimConfig = {
  host: "github.com",
  accountId: String(factoryAccount.id),
  eligibilityLabel: "ready",
  foreignClaimLabels: ["claimed"],
  foreignClaimCommentPatterns: ["^Claimed issue-"],
  observedClaimPool: { poolId: builders, units: 1 },
};

/** Synthetic helper contract; this test verifies packet arguments without executing it. */
const syntheticHelperPath = NodeURL.fileURLToPath(
  new URL("./resultHelper.fixture.txt", import.meta.url),
);
const syntheticHelperSha256 = sha256(NodeFS.readFileSync(syntheticHelperPath, "utf8"));
const syntheticResultInvocation: FactoryStore.FactoryHelperInvocation = {
  command: "result",
  required: ["--key", "--task", "--checks", "--next", "--records"],
  choices: { "--task": ["implement", "rework", "verify", "review", "batch-review"] },
  supplied: { "--task": "taskKind", "--key": "decisionKey" } as const,
  workerSupplied: ["--checks", "--next", "--records"],
};

const configureClaimFactory = (capacityUnits = 1) =>
  configureFactory({ pools: pool(capacityUnits), claim: claimConfig });

const seedIssue = (issueNumber: number, overrides: Partial<FakeIssue> = {}) =>
  Effect.map(GitHubFake, (fake) => {
    fake.issues.set(issueKey(claimRepository, issueNumber), {
      number: issueNumber,
      state: "open",
      title: `Issue ${issueNumber}`,
      body: `Implement issue ${issueNumber}.`,
      labels: ["ready"],
      comments: [],
      ...overrides,
    });
    return fake.issues.get(issueKey(claimRepository, issueNumber))!;
  });

const claimComments = (issueNumber: number) =>
  Effect.map(GitHubFake, (fake) =>
    (fake.issues.get(issueKey(claimRepository, issueNumber))?.comments ?? []).filter((comment) =>
      comment.body.includes("t3-factory-claim"),
    ),
  );

/** The single claim's state and its last attempt, as the native records hold them. */
const claimRecord = Effect.gen(function* () {
  const claims = yield* FactoryClaimStore.FactoryClaimStore;
  const [claim] = yield* claims.list(factoryId);
  if (claim === undefined) return undefined;
  const entry = Option.getOrThrow(yield* claims.get(claim.reservationId));
  const last = entry.attempts.at(-1);
  return {
    state: claim.state,
    reason: "reason" in claim ? claim.reason : null,
    attempts: entry.attempts.length,
    phase: last?.phase ?? null,
    cause: last !== undefined && "cause" in last ? last.cause : null,
  };
});

const commentPosts = Effect.map(
  GitHubFake,
  (fake) => fake.requests.filter((request) => request.method === "POST").length,
);

/**
 * The policy these tests run: every eligible issue proposes one implementation decision, under
 * the policy revision the pass found configured.
 */
const proposeImplementation = (input: {
  readonly observation: FactoryStore.ItemObservation;
  readonly configuration?: FactoryStore.FactoryConfiguration;
}) =>
  Effect.map(inOneHour, (deadline) =>
    admissionFor(
      input.observation.itemKey,
      { observationId: input.observation.observationId, deadline },
      input.configuration === undefined
        ? {}
        : { policyRevision: input.configuration.policyRevision },
    ),
  );

/** One native collection pass over the issue, as a tracker event, the clock or a restart runs it. */
const collectIssues = (
  issueNumbers: ReadonlyArray<number>,
  trigger: FactoryLifecycle.FactoryCollectionInput["trigger"] = "tracker_event",
) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    factory.collect({
      factoryId,
      trigger,
      subjects: issueNumbers.map((issueNumber) => ({ repository: claimRepository, issueNumber })),
    }),
  );

const proposeIssue = (
  issueNumber: number,
  trigger?: FactoryLifecycle.FactoryCollectionInput["trigger"],
) =>
  Effect.map(collectIssues([issueNumber], trigger), (result) =>
    result.type === "collected" ? result.admissions[0] : undefined,
  );

it.effect("Claims/N01: the only provider start follows one verified claim", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(5001);
      const execution = admittedExecution((yield* proposeIssue(5001))!);
      // Nothing may launch before the claim is read back.
      assert.deepStrictEqual(yield* launchEffects(execution.commandId), []);
      yield* runEffects;
      const comments = yield* claimComments(5001);
      assert.strictEqual(comments.length, 1);
      assert.strictEqual(comments[0]!.user.id, factoryAccount.id);
      assert.strictEqual((yield* startedTurns).length, 1);
      // The clock and a restart collect again: the item is ours now, so nothing new is admitted.
      assert.strictEqual(yield* proposeIssue(5001, "clock"), undefined);
      yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
      assert.strictEqual(yield* proposeIssue(5001, "restart"), undefined);
      yield* runEffects;
      assert.strictEqual((yield* claimComments(5001)).length, 1);
      assert.strictEqual(yield* commentPosts, 1);
      assert.strictEqual((yield* startedTurns).length, 1);
      assert.deepStrictEqual(
        (yield* GitHubFake).requests.filter((request) => request.path.includes("/pulls")),
        [],
      );
      const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
      assert.deepStrictEqual(
        state.reservations.map((reservation) => reservation.claim?.state),
        ["verified"],
      );
      assert.strictEqual(state.pools[0]?.occupiedUnits, 1);
    }),
  ),
);

// Unknown foreign custody stays charged while T3's unwritten reservation is released.
it.effect(
  "Claims/N04: a manual claim seen before the write keeps its own unit; ours is freed",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(5002);
        yield* seedIssue(5012);
        const native = admittedExecution((yield* proposeIssue(5002))!);
        // A person claims the issue by hand after admission, before T3 writes.
        const fake = yield* GitHubFake;
        fake.issues.get(issueKey(claimRepository, 5002))!.labels.push("claimed");
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.strictEqual(yield* commentPosts, 0);
        const record = yield* claimRecord;
        assert.deepStrictEqual([record?.state, record?.attempts], ["released", 0]);
        const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
        assert.deepStrictEqual(
          state.reservations.map((reservation) => [
            reservation.origin,
            reservation.state,
            reservation.origin === "observed" ? reservation.carrierKey : null,
            reservation.custody.state,
          ]),
          [
            ["admitted", "released", null, "unknown"],
            ["observed", "held", `github:${claimRepository}#5002:label:claimed`, "unknown"],
          ],
        );
        assert.notStrictEqual(
          state.reservations[1]?.reservationId,
          state.reservations[0]?.reservationId,
        );
        assert.strictEqual(executionOf(state.reservations[0]!)?.threadId, native.threadId);
        assert.strictEqual(yield* occupied, 1);
        // The external claim holds the final unit: another decision cannot take it.
        assert.deepStrictEqual(yield* proposeIssue(5012), {
          type: "refused",
          reason: "capacity_exhausted",
        });
      }),
    ),
);

it.effect("Claims/N28: a lost create response is held, never re-posted or started", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(5003);
      admittedExecution((yield* proposeIssue(5003))!);
      (yield* GitHubFake).outcomes.push({ type: "apply_then_lose" });
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      assert.strictEqual(yield* commentPosts, 1);
      assert.strictEqual(yield* occupied, 1);
      const lost = yield* claimRecord;
      assert.deepStrictEqual([lost?.state, lost?.phase], ["unknown", "ambiguous"]);
      // Another delivery of the same decision must not post again.
      yield* proposeIssue(5003);
      yield* runEffects;
      assert.strictEqual(yield* commentPosts, 1);
      assert.strictEqual((yield* startedTurns).length, 0);
    }),
  ),
);

it.effect.each([408, 502] as const)(
  "Claims/N28: a %s answer to the create is ambiguous and held",
  (status) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(5004);
        admittedExecution((yield* proposeIssue(5004))!);
        (yield* GitHubFake).outcomes.push({ type: "server_error", status });
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.strictEqual(yield* commentPosts, 1);
        assert.strictEqual(yield* occupied, 1);
        const record = yield* claimRecord;
        assert.deepStrictEqual([record?.state, record?.phase], ["unknown", "ambiguous"]);
        assert.include(record?.cause ?? "", String(status));
      }),
    ),
);

it.effect("Claims/N04: a rejected create proves no claim and frees the unit", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(5005);
      admittedExecution((yield* proposeIssue(5005))!);
      (yield* GitHubFake).outcomes.push({ type: "reject", status: 422 });
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      assert.strictEqual(yield* commentPosts, 1);
      assert.strictEqual(yield* occupied, 0);
      const record = yield* claimRecord;
      assert.deepStrictEqual([record?.state, record?.phase], ["released", "rejected"]);
    }),
  ),
);

it.effect("Claims/N06: an issue changed after admission is not claimed or started", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      const issue = yield* seedIssue(5006);
      admittedExecution((yield* proposeIssue(5006))!);
      // The source changes with no collection pass recording it.
      issue.body = "Implement issue 5006, now with a different scope.";
      yield* runEffects;
      assert.strictEqual(yield* commentPosts, 0);
      assert.strictEqual((yield* startedTurns).length, 0);
      assert.strictEqual(yield* occupied, 0);
      const record = yield* claimRecord;
      assert.deepStrictEqual([record?.state, record?.reason], ["released", "source_changed"]);
    }),
  ),
);

it.effect("Claims/N19: a factory thread cannot start before its claim is verified", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(5007);
      const execution = admittedExecution((yield* proposeIssue(5007))!);
      // The claim effect has not run; a person messages the worker thread from the UI.
      assert.strictEqual(
        yield* startOutcome(sendUserMessage(execution.threadId, "before-claim")),
        "claim_not_ready",
      );
      assert.strictEqual((yield* startedTurns).length, 0);
    }),
  ),
);

it.effect("Claims/N14: a packet must name the configured helper and required arguments", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureFactory({
        pools: pool(1),
        claim: claimConfig,
        packet: {
          briefSchemaVersion: "brief-v1",
          helper: {
            path: syntheticHelperPath,
            sha256: syntheticHelperSha256,
            invocation: syntheticResultInvocation,
          },
        },
      });
      const issue = yield* seedIssue(5008);
      const factory = yield* FactoryLifecycle.FactoryLifecycle;
      const itemKey = `github:${claimRepository}#5008`;
      // Component seam: one read of the issue, observed by the production observation contract.
      const recorded = yield* factory.recordItemObservation({
        ...issueObservation({
          issue: { ...issue, comments: [] },
          subject: { tracker: "github", repository: claimRepository, issueNumber: 5008 },
          claim: claimConfig,
        }),
        factoryId,
        itemKey: itemKeyOf(itemKey),
        generation: yield* beginCollection,
      });
      if (recorded.type !== "recorded") return yield* Effect.die("unrecorded");
      const basis = {
        observationId: recorded.observation.observationId,
        deadline: yield* inOneHour,
      };
      const decisionKey = FactoryLifecycle.decisionKeyOf(
        {
          factoryId,
          itemKey: itemKeyOf(itemKey),
          taskKind: "implement",
          policyRevision: "policy-r1",
        },
        recorded.observation,
      );
      const withPacket = (text: string) =>
        admissionFor(itemKey, basis, {
          packet: {
            text,
            sha256: sha256(text),
            briefSchemaVersion: "brief-v1",
            helperSha256: syntheticHelperSha256,
          },
        });
      const report = (args: string) =>
        `Finish by posting what ${syntheticHelperPath} ${args} prints.`;
      const obligations = "--checks <checks> --next <next> --records <records>";
      // Each malformed call would surface only after the claim, when the worker reports.
      for (const [args, reason] of [
        [`result --key ${decisionKey} ${obligations}`, "helper_argument_missing"],
        [`result --key ${decisionKey} --task implement`, "helper_argument_missing"],
        [`result --key ${decisionKey} --task ship ${obligations}`, "helper_argument_invalid"],
        [
          `result --key issue-5008-implement-1 --task implement ${obligations}`,
          "helper_argument_mismatch",
        ],
        [`report --key ${decisionKey} --task implement ${obligations}`, "helper_command_missing"],
      ] as const) {
        assert.deepStrictEqual(yield* factory.admit(withPacket(report(args))), {
          type: "refused",
          reason,
        });
      }
      assert.strictEqual(yield* commentPosts, 0);
      assert.strictEqual(yield* occupied, 0);
      // A valid invocation bound to this decision is admitted.
      const valid = yield* factory.admit(
        withPacket(report(`result --key ${decisionKey} --task implement ${obligations}`)),
      );
      assert.strictEqual(valid.type, "admitted");
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

// The first provider start after a verified claim is its own boundary: the settle commit only
// queues it. These run the claim effect alone, so the queued start waits while things change.

/** Runs one admitted decision's claim effect alone, leaving every other queued effect waiting. */
const settleClaimOnly = (execution: { readonly commandId: CommandId }) =>
  Effect.gen(function* () {
    const claims = yield* FactoryClaimService.FactoryClaimService;
    yield* claims.process(FactoryReservationId.make(`reservation:${execution.commandId}`));
    const record = yield* claimRecord;
    assert.strictEqual(record?.state, "verified");
  });

it.effect.each([
  ["the tracker issue changed", "source"],
  ["a new configuration revision was adopted", "configuration"],
  ["the factory was paused", "pause"],
] as const)(
  "Claims/N14: a verified claim's queued first start does not run once %s",
  ([, change]) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        const issue = yield* seedIssue(5101);
        const execution = admittedExecution((yield* proposeIssue(5101))!);
        yield* settleClaimOnly(execution);
        assert.strictEqual((yield* launchEffects(execution.commandId)).length, 0);
        assert.strictEqual(
          (yield* (yield* EffectOutbox.EffectOutboxV2).listLaunchesForThread(execution.threadId))
            .length,
          1,
        );
        // No collection pass sees these changes; only the start itself can.
        if (change === "source") issue.body = "Implement issue 5101 differently.";
        if (change === "configuration") {
          yield* configureFactory({
            pools: pool(1),
            claim: { ...claimConfig, eligibilityLabel: "go" },
          });
        }
        if (change === "pause") {
          yield* configureFactory({ pools: pool(1), claim: claimConfig, enabled: false });
        }
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        const record = yield* claimRecord;
        // Our comment exists, so the unit stays held.
        assert.strictEqual(record?.state, "stale_after_claim");
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect(
  "Claims/N19 control: a started worker keeps its pins after its first start conditions change",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const rosterExecution = {
            modelSelection: rosterSelection,
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
          };
          yield* configureFactory({
            pools: pool(1),
            claim: claimConfig,
            execution: rosterExecution,
          });
          const issue = yield* seedIssue(5102);
          const execution = admittedExecution((yield* proposeIssue(5102))!);
          const running = yield* awaitRunningTurn(execution.threadId);
          yield* runEffects;
          yield* Fiber.join(running);
          assert.strictEqual((yield* startedTurns).length, 1);
          yield* completeLatestRun(execution.threadId);
          // New work follows a new revision; the source moves on too. The worker continues.
          yield* configureFactory({
            pools: pool(1),
            claim: { ...claimConfig, eligibilityLabel: "go" },
            execution: rosterExecution,
          });
          issue.body = "Implement issue 5102 with a later note.";
          yield* TestClock.adjust("2 hours");
          const continued = yield* awaitEvent(
            execution.threadId,
            runUpdated(
              (run) => run.ordinal === 2 && (run.status === "running" || run.status === "failed"),
            ),
          );
          assert.strictEqual(
            yield* startOutcome(sendUserMessage(execution.threadId, "continue-after-change")),
            "accepted",
          );
          yield* runEffects;
          yield* Fiber.join(continued);
          assert.strictEqual((yield* startedTurns).length, 2);
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["completed", "running"]);
          assert.strictEqual((yield* claimRecord)?.state, "verified");
        }),
      ),
    ),
);

// Carrier provenance: what a claim's comment is, not only its id, decides whether it is ours.

it.effect("Claims/N05: an attested claim comment edited into a manual claim is charged again", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      yield* seedIssue(5201);
      admittedExecution((yield* proposeIssue(5201))!);
      yield* runEffects;
      assert.strictEqual((yield* claimRecord)?.state, "verified");
      // Unchanged, our own comment is our reservation's mirror: one unit.
      yield* proposeIssue(5201, "clock");
      assert.strictEqual(yield* occupied, 1);
      // Someone with the same account rewrites it into a manual claim, keeping its id.
      const [ours] = yield* claimComments(5201);
      const fake = yield* GitHubFake;
      const issue = fake.issues.get(issueKey(claimRepository, 5201))!;
      issue.comments = issue.comments.map((comment) =>
        comment.id === ours!.id
          ? { ...comment, body: "Claimed issue-5201-implement-1: taking this by hand." }
          : comment,
      );
      yield* proposeIssue(5201, "clock");
      // The edited comment is a claim nobody can attribute; ours stays held beside it.
      assert.strictEqual(yield* occupied, 2);
    }),
  ),
);

it.effect(
  "Claims/N28: a written receipt left by a stopped writer is verified once, with no second post",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory(2);
          yield* seedIssue(5202);
          const execution = admittedExecution((yield* proposeIssue(5202))!);
          const fake = yield* GitHubFake;
          const reached = yield* Deferred.make<void>();
          fake.beforeCommentRead = Deferred.succeed(reached, undefined).pipe(
            Effect.andThen(Effect.never),
          );
          // The writer posts, records its receipt, then stops before reading the comment back.
          const writer = yield* Effect.forkScoped(
            (yield* FactoryClaimService.FactoryClaimService).process(
              FactoryReservationId.make(`reservation:${execution.commandId}`),
            ),
          );
          yield* Deferred.await(reached);
          yield* Fiber.interrupt(writer);
          fake.beforeCommentRead = undefined;
          const written = yield* claimRecord;
          assert.deepStrictEqual([written?.state, written?.phase], ["writing", "written"]);
          // Before the readback, a collection pass sees our comment: charged until attested.
          yield* proposeIssue(5202, "clock");
          assert.strictEqual(yield* occupied, 2);
          // The server restarts; its collection finishes the receipt it finds.
          yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
          yield* proposeIssue(5202, "restart");
          const running = yield* awaitRunningTurn(execution.threadId);
          yield* runEffects;
          yield* Fiber.join(running);
          assert.strictEqual(yield* commentPosts, 1);
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.strictEqual((yield* claimRecord)?.state, "verified");
          assert.strictEqual(yield* occupied, 1);
        }),
      ),
    ),
);

it.effect("Claims/N06: our comment edited before its readback is not certified as our write", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      yield* seedIssue(5301);
      admittedExecution((yield* proposeIssue(5301))!);
      const fake = yield* GitHubFake;
      // After GitHub answered the create, the same account rewrites the comment, keeping its
      // operation id and nonce and adding a manual claim of its own.
      fake.beforeCommentRead = Effect.sync(() => {
        fake.beforeCommentRead = undefined;
        const issue = fake.issues.get(issueKey(claimRepository, 5301))!;
        issue.comments = issue.comments.map((comment) =>
          comment.body.includes("t3-factory-claim")
            ? { ...comment, body: `${comment.body}\nClaimed issue-5301-implement-1 by hand.` }
            : comment,
        );
      });
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      assert.strictEqual(yield* commentPosts, 1);
      const record = yield* claimRecord;
      assert.deepStrictEqual(
        [record?.state, record?.reason],
        ["conflicted", "own_comment_changed"],
      );
      // The edited comment is someone's claim: collected, it is charged on its own.
      yield* proposeIssue(5301, "clock");
      assert.strictEqual(yield* occupied, 2);
    }),
  ),
);

// Later controls; several follow the behaviour they check (see TDD_LEDGER).

it.effect("Claims/N04: another writer's prepared request is left to it, then verified once", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(5401);
        const execution = admittedExecution((yield* proposeIssue(5401))!);
        const fake = yield* GitHubFake;
        const posting = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        fake.beforeCreate = Deferred.succeed(posting, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        // This writer holds the only prepared request, mid-send.
        const writer = yield* Effect.forkScoped(
          (yield* FactoryClaimService.FactoryClaimService).process(
            FactoryReservationId.make(`reservation:${execution.commandId}`),
          ),
        );
        yield* Deferred.await(posting);
        // Everything else that runs meanwhile leaves its attempt alone and sends nothing.
        yield* proposeIssue(5401, "clock");
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        yield* proposeIssue(5401, "restart");
        yield* runEffects;
        assert.deepStrictEqual(
          [(yield* claimRecord)?.state, (yield* claimRecord)?.phase],
          ["writing", "prepared"],
        );
        assert.strictEqual(yield* commentPosts, 1);
        assert.strictEqual((yield* startedTurns).length, 0);
        // The writer's own answer arrives and settles it.
        fake.beforeCreate = undefined;
        const running = yield* awaitRunningTurn(execution.threadId);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(writer);
        yield* runEffects;
        yield* Fiber.join(running);
        assert.strictEqual((yield* claimRecord)?.state, "verified");
        assert.strictEqual(yield* commentPosts, 1);
        assert.strictEqual((yield* startedTurns).length, 1);
      }),
    ),
  ),
);

it.effect("Claims/N28: a lost response stays unknown when a copy replaces our comment", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      yield* seedIssue(5402);
      admittedExecution((yield* proposeIssue(5402))!);
      const fake = yield* GitHubFake;
      fake.outcomes.push({ type: "apply_then_lose" });
      yield* runEffects;
      // Someone copies our exact body under the same account, then deletes the original.
      const issue = fake.issues.get(issueKey(claimRepository, 5402))!;
      const original = issue.comments.find((comment) => comment.body.includes("t3-factory-claim"))!;
      issue.comments = [{ ...original, id: fake.nextCommentId++ }];
      yield* proposeIssue(5402, "clock");
      yield* runEffects;
      const record = yield* claimRecord;
      assert.deepStrictEqual([record?.state, record?.phase], ["unknown", "ambiguous"]);
      assert.strictEqual(yield* commentPosts, 1);
      assert.strictEqual((yield* startedTurns).length, 0);
      // The copy is nobody's attested claim: charged beside ours.
      assert.strictEqual(yield* occupied, 2);
    }),
  ),
);

it.effect("Claims/N06: a manual claim by our own account in the same second is not ours", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(5403);
      admittedExecution((yield* proposeIssue(5403))!);
      const fake = yield* GitHubFake;
      // Tracker-shaped: the same account and timestamp, a different comment and no nonce.
      fake.issues.get(issueKey(claimRepository, 5403))!.comments.push({
        id: fake.nextCommentId++,
        body: "Claimed issue-5403-implement-1: implement attempt 1 from synthetic commit abc.",
        user: factoryAccount,
        created_at: "2026-10-24T00:00:00Z",
      });
      yield* runEffects;
      assert.strictEqual(yield* commentPosts, 0);
      assert.strictEqual((yield* startedTurns).length, 0);
      const record = yield* claimRecord;
      assert.deepStrictEqual([record?.state, record?.reason], ["released", "foreign_claim"]);
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

it.effect("Claims/N19: a factory thread whose first start was refused takes no follow-up", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      const issue = yield* seedIssue(5404);
      const execution = admittedExecution((yield* proposeIssue(5404))!);
      yield* settleClaimOnly(execution);
      issue.body = "Implement issue 5404 differently.";
      yield* runEffects;
      assert.strictEqual((yield* claimRecord)?.state, "stale_after_claim");
      assert.strictEqual(
        yield* startOutcome(sendUserMessage(execution.threadId, "after-stale")),
        "claim_not_ready",
      );
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
    }),
  ),
);

it.effect("Claims/N01: triggers during a collection pass coalesce into one more pass", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(5405);
        const fake = yield* GitHubFake;
        const reading = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        const first = yield* Effect.forkScoped(collectIssues([5405], "tracker_event"));
        yield* Deferred.await(reading);
        // The clock and a second tracker event arrive while the pass is reading.
        assert.deepStrictEqual(yield* collectIssues([5405], "clock"), { type: "coalesced" });
        assert.deepStrictEqual(yield* collectIssues([5405], "tracker_event"), {
          type: "coalesced",
        });
        fake.beforeIssueRead = undefined;
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(first);
        // One more pass covers both triggers; the item is admitted once, and the second pass
        // finds its decision in progress without proposing it again.
        assert.deepStrictEqual(
          result.type === "collected"
            ? [result.passes, result.admissions.map((admission) => admission.type)]
            : result,
          [2, ["admitted"]],
        );
        yield* runEffects;
        assert.strictEqual(yield* commentPosts, 1);
        assert.strictEqual((yield* startedTurns).length, 1);
      }),
    ),
  ),
);

// Claims correction 1: the final first-use authorization follows the last external read, the
// current own carrier is required, freshly observed foreign claims are charged, coalesced subjects
// are read, and an explicit workspace is prepared before the claimed execution starts.

const observedRows = Effect.gen(function* () {
  const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
  return state.reservations.filter((reservation) => reservation.origin === "observed").length;
});

it.effect.each([
  // Pausing adopts a new revision, and the revision fence is checked first.
  ["the factory is paused", "pause", "configuration_changed"],
  ["a new configuration revision is adopted", "configuration", "configuration_changed"],
  ["the admission deadline passes", "deadline", "deadline_expired"],
] as const)(
  "Claims/S01: a first start does not run when %s during its final tracker read",
  ([, change, reason]) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6101);
        const execution = admittedExecution((yield* proposeIssue(6101))!);
        yield* settleClaimOnly(execution);
        const fake = yield* GitHubFake;
        const services =
          yield* Effect.context<Effect.Services<ReturnType<typeof configureFactory>>>();
        // Native state changes while the first start's own read of the tracker is in flight.
        fake.beforeIssueRead = Effect.gen(function* () {
          fake.beforeIssueRead = undefined;
          if (change === "pause") {
            yield* configureFactory({ pools: pool(1), claim: claimConfig, enabled: false });
          }
          if (change === "configuration") {
            yield* configureFactory({
              pools: pool(1),
              claim: { ...claimConfig, eligibilityLabel: "go" },
            });
          }
          if (change === "deadline") yield* TestClock.adjust("2 hours");
        }).pipe(Effect.orDie, Effect.provide(services));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        const record = yield* claimRecord;
        assert.deepStrictEqual([record?.state, record?.reason], ["stale_after_claim", reason]);
        assert.strictEqual(yield* commentPosts, 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect.each([
  ["deleted", "delete", "own_claim_missing"],
  ["edited away", "edit", "own_claim_changed"],
] as const)(
  "Claims/S02: a first start does not run once our attested claim comment is %s",
  ([, change, reason]) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        const issue = yield* seedIssue(6102);
        const execution = admittedExecution((yield* proposeIssue(6102))!);
        yield* settleClaimOnly(execution);
        issue.comments =
          change === "delete"
            ? []
            : issue.comments.map((comment) => ({
                ...comment,
                body: "Owner changed this instruction: do not start this execution.",
              }));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        const record = yield* claimRecord;
        assert.deepStrictEqual([record?.state, record?.reason], ["stale_after_claim", reason]);
        // Our write applied once; nothing posts again and the unit stays held.
        assert.strictEqual(yield* commentPosts, 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect("Claims/S03: a foreign claim seen at first start is charged with the conflict", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      const issue = yield* seedIssue(6103);
      yield* seedIssue(6104);
      const execution = admittedExecution((yield* proposeIssue(6103))!);
      yield* settleClaimOnly(execution);
      assert.strictEqual(yield* occupied, 1);
      issue.labels.push("claimed");
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      const record = yield* claimRecord;
      assert.deepStrictEqual([record?.state, record?.reason], ["conflicted", "foreign_claim"]);
      // Our written claim and the distinct foreign claim each hold a unit, with no gap between.
      assert.strictEqual(yield* observedRows, 1);
      assert.strictEqual(yield* occupied, 2);
      const next = yield* proposeIssue(6104);
      assert.strictEqual(next?.type, "refused");
      assert.strictEqual(yield* commentPosts, 1);
    }),
  ),
);

it.effect("Claims/S03: a foreign claim landing during our write is charged with the conflict", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      const issue = yield* seedIssue(6105);
      yield* seedIssue(6106);
      admittedExecution((yield* proposeIssue(6105))!);
      const fake = yield* GitHubFake;
      fake.beforeCreate = Effect.sync(() => {
        fake.beforeCreate = undefined;
        issue.labels.push("claimed");
      });
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      const record = yield* claimRecord;
      assert.deepStrictEqual([record?.state, record?.reason], ["conflicted", "foreign_claim"]);
      assert.strictEqual(yield* observedRows, 1);
      assert.strictEqual(yield* occupied, 2);
      const next = yield* proposeIssue(6106);
      assert.strictEqual(next?.type, "refused");
      assert.strictEqual(yield* commentPosts, 1);
    }),
  ),
);

it.effect("Claims/S04: a different subject coalesced into a running pass is read before done", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6107);
        yield* seedIssue(6108);
        const fake = yield* GitHubFake;
        const reading = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        const first = yield* Effect.forkScoped(collectIssues([6107]));
        yield* Deferred.await(reading);
        assert.deepStrictEqual(yield* collectIssues([6108]), { type: "coalesced" });
        fake.beforeIssueRead = undefined;
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(first);
        assert.isTrue(
          fake.requests.some((request) => request.path === `repos/${claimRepository}/issues/6108`),
        );
        const sql = yield* SqlClient.SqlClient;
        const observed = yield* sql<{ readonly item_key: string }>`
          SELECT item_key FROM factory_item_observations
        `;
        assert.isTrue(observed.some((row) => row.item_key.endsWith("#6108")));
        assert.deepStrictEqual(
          result.type === "collected"
            ? result.admissions
                .flatMap((admission) =>
                  admission.type === "admitted" ? [admission.reservation.itemKey] : [],
                )
                .toSorted()
            : result,
          [
            itemKeyOf(`github:${claimRepository}#6107`),
            itemKeyOf(`github:${claimRepository}#6108`),
          ],
        );
      }),
    ),
  ),
);

it.effect(
  "Claims/S05: a claimed execution on an explicit root workspace is prepared and started",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6109);
        (yield* PolicyFake).propose = (input) =>
          Effect.map(proposeImplementation(input), (request) => ({
            ...request,
            workspaceStrategy: { type: "root" as const },
          }));
        const collected = yield* collectIssues([6109]);
        assert.strictEqual(collected.type, "collected");
        if (collected.type !== "collected") return;
        const execution = admittedExecution(collected.admissions[0]!);
        yield* runEffects;
        // Preparing the workspace used the claim for this run (r2.1): its intent is recorded.
        assert.strictEqual((yield* claimRecord)?.state, "workspace_authorized");
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["running"]);
        assert.deepStrictEqual(
          [(yield* PreparationFake).worktrees, (yield* PreparationFake).branchNames],
          [[], []],
        );
        const projection = yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(
          execution.threadId,
        );
        assert.deepStrictEqual(projection.runs[0]?.workspacePreparation, { type: "root" });
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect("Claims/S03: a foreign claim seen at first start holds its own unit at once", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      const issue = yield* seedIssue(6110);
      yield* seedIssue(6111);
      const execution = admittedExecution((yield* proposeIssue(6110))!);
      yield* settleClaimOnly(execution);
      issue.labels.push("claimed");
      yield* runEffects;
      // Only the charge: our held unit plus the foreign claim's, before anything else reads it.
      assert.deepStrictEqual([yield* observedRows, yield* occupied], [1, 2]);
      assert.strictEqual((yield* proposeIssue(6111))?.type, "refused");
    }),
  ),
);

it.effect(
  "Claims/S03: a foreign claim read while our claim moves is still charged, and nothing starts",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        const issue = yield* seedIssue(6113);
        yield* seedIssue(6114);
        const execution = admittedExecution((yield* proposeIssue(6113))!);
        yield* settleClaimOnly(execution);
        const claims = yield* FactoryClaimStore.FactoryClaimStore;
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const settled = Option.getOrThrow(yield* claims.get(reservationId)).claim;
        assert.strictEqual(settled.state, "verified");
        if (settled.state !== "verified") return;
        const fake = yield* GitHubFake;
        // While the first start's read is in flight, another writer holds our claim, and the
        // read sees a distinct foreign claim.
        fake.beforeIssueRead = Effect.gen(function* () {
          fake.beforeIssueRead = undefined;
          yield* claims.transition({
            reservationId,
            from: ["verified"],
            to: {
              state: "stale_after_claim",
              carrierKey: settled.carrierKey,
              reason: "factory_paused",
            },
          });
          issue.labels.push("claimed");
        }).pipe(Effect.orDie);
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        const record = yield* claimRecord;
        assert.deepStrictEqual(
          [record?.state, record?.reason],
          ["stale_after_claim", "factory_paused"],
        );
        assert.deepStrictEqual([yield* observedRows, yield* occupied], [1, 2]);
        assert.strictEqual((yield* proposeIssue(6114))?.type, "refused");
      }),
    ),
);

it.effect(
  "Claims/S01: a first start does not run when its helper changes during the final read",
  () =>
    runIsolated(
      withScratch((scratch) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const helperPath = (yield* Path.Path).join(scratch, "factory-helper.py");
          yield* fs.writeFileString(helperPath, "print('helper v1')\n");
          const helperSha256 = sha256("print('helper v1')\n");
          yield* configureFactory({
            pools: pool(1),
            claim: claimConfig,
            packet: {
              briefSchemaVersion: "brief-v1",
              helper: { path: helperPath, sha256: helperSha256 },
            },
          });
          yield* seedIssue(6115);
          (yield* PolicyFake).propose = (input) =>
            Effect.map(proposeImplementation(input), (request) => ({
              ...request,
              packet: { ...request.packet, helperSha256 },
            }));
          const collected = yield* collectIssues([6115]);
          assert.strictEqual(collected.type, "collected");
          if (collected.type !== "collected") return;
          const execution = admittedExecution(collected.admissions[0]!);
          yield* settleClaimOnly(execution);
          const fake = yield* GitHubFake;
          fake.beforeIssueRead = fs.writeFileString(helperPath, "print('helper v2')\n").pipe(
            Effect.tap(() => Effect.sync(() => (fake.beforeIssueRead = undefined))),
            Effect.orDie,
          );
          yield* runEffects;
          assert.strictEqual((yield* startedTurns).length, 0);
          const record = yield* claimRecord;
          assert.deepStrictEqual(
            [record?.state, record?.reason],
            ["stale_after_claim", "helper_changed"],
          );
        }),
      ),
    ),
);

it.effect(
  "Claims/S01: a follow-up after a first start that never ran is still authorized afresh",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6116);
        const execution = admittedExecution((yield* proposeIssue(6116))!);
        yield* settleClaimOnly(execution);
        // The server restarts before the queued first start was ever claimed: recovery cancels
        // the run, and no provider ever started.
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        yield* configureFactory({ pools: pool(1), claim: claimConfig, enabled: false });
        yield* startOutcome(sendUserMessage(execution.threadId, "after-restart"));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        const record = yield* claimRecord;
        assert.deepStrictEqual(
          [record?.state, record?.reason],
          ["stale_after_claim", "configuration_changed"],
        );
      }),
    ),
);

// Post-implementation: written after authorizeFirstUse; its negative replay runs it against the
// pre-edit source from logs/23-red-snapshot.
it.effect("Claims/S01: a first start does not run when our claim moves during its final read", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6117);
      const execution = admittedExecution((yield* proposeIssue(6117))!);
      yield* settleClaimOnly(execution);
      const claims = yield* FactoryClaimStore.FactoryClaimStore;
      const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
      const settled = Option.getOrThrow(yield* claims.get(reservationId)).claim;
      assert.strictEqual(settled.state, "verified");
      if (settled.state !== "verified") return;
      const fake = yield* GitHubFake;
      // Tracker, helper and configuration stay as admitted; only another native writer holds
      // our claim while the first start's read is in flight.
      fake.beforeIssueRead = Effect.gen(function* () {
        fake.beforeIssueRead = undefined;
        yield* claims.transition({
          reservationId,
          from: ["verified"],
          to: {
            state: "stale_after_claim",
            carrierKey: settled.carrierKey,
            reason: "factory_paused",
          },
        });
      }).pipe(Effect.orDie);
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      const record = yield* claimRecord;
      assert.deepStrictEqual(
        [record?.state, record?.reason],
        ["stale_after_claim", "factory_paused"],
      );
      assert.deepStrictEqual([yield* observedRows, yield* occupied], [0, 1]);
    }),
  ),
);

// Post-implementation: the post-write charge when another writer moves our claim first.
it.effect(
  "Claims/S03: a foreign claim read after our write is charged even if our claim moved",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        const issue = yield* seedIssue(6118);
        yield* seedIssue(6119);
        const execution = admittedExecution((yield* proposeIssue(6118))!);
        const claims = yield* FactoryClaimStore.FactoryClaimStore;
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const fake = yield* GitHubFake;
        let reads = 0;
        // The second issue read is the one after our write: before it returns, another writer
        // holds our claim, and a foreign claim lands.
        fake.beforeIssueRead = Effect.gen(function* () {
          reads++;
          if (reads !== 2) return;
          fake.beforeIssueRead = undefined;
          yield* claims.transition({
            reservationId,
            from: ["writing"],
            to: { state: "unknown", reason: "create_ambiguous" },
          });
          issue.labels.push("claimed");
        }).pipe(Effect.orDie);
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        const entry = Option.getOrThrow(yield* claims.get(reservationId));
        // Our own moves rolled back: the other writer's state stands and the attempt stays written.
        assert.deepStrictEqual(
          [entry.claim.state, entry.attempts.map((attempt) => attempt.phase)],
          ["unknown", ["written"]],
        );
        // The foreign claim is charged; our own comment is not.
        assert.deepStrictEqual([yield* observedRows, yield* occupied], [1, 2]);
        assert.strictEqual((yield* proposeIssue(6119))?.type, "refused");
        assert.strictEqual(yield* commentPosts, 1);
      }),
    ),
);

// Post-implementation: the admission policy seam did not exist before this change.
it.effect("Claims/S04: subjects read with no policy installed stay pending until one is", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6120);
      const policy = yield* PolicyFake;
      policy.available = false;
      const first = yield* collectIssues([6120]);
      assert.deepStrictEqual(
        first.type === "collected" ? [first.admissions, first.deferred] : first,
        [[], { reason: "policy_unavailable", subjects: 1 }],
      );
      // Read and recorded, but not decided: no reservation, nothing written.
      const sql = yield* SqlClient.SqlClient;
      const observed = yield* sql<{ readonly item_key: string }>`
        SELECT item_key FROM factory_item_observations
      `;
      assert.isTrue(observed.some((row) => row.item_key.endsWith("#6120")));
      assert.deepStrictEqual([yield* occupied, yield* commentPosts], [0, 0]);
      // Once a policy is installed, a later trigger naming nothing still decides the subject.
      policy.available = true;
      const later = yield* collectIssues([], "restart");
      assert.deepStrictEqual(
        later.type === "collected"
          ? [later.admissions.map((admission) => admission.type), later.deferred]
          : later,
        [["admitted"], null],
      );
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

it.effect("Claims/S04: a revision adopted during a pass is decided again under that revision", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6121);
      const fake = yield* GitHubFake;
      const services =
        yield* Effect.context<Effect.Services<ReturnType<typeof configureFactory>>>();
      // The first pass reads under policy-r1; while it reads, policy-r2 is adopted.
      fake.beforeIssueRead = Effect.gen(function* () {
        fake.beforeIssueRead = undefined;
        yield* configureFactory({
          pools: pool(1),
          claim: claimConfig,
          policyRevision: "policy-r2",
        });
      }).pipe(Effect.orDie, Effect.provide(services));
      const result = yield* collectIssues([6121]);
      assert.deepStrictEqual((yield* PolicyFake).revisions, ["policy-r1", "policy-r2"]);
      assert.deepStrictEqual(
        result.type === "collected"
          ? [result.passes, result.admissions.map((admission) => admission.type)]
          : result,
        [2, ["refused", "admitted"]],
      );
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

// Post-implementation S05 controls. The red-first S05 proof is the root-strategy red in logs/01;
// these exercise the agreed preparation handoff, with git and setup as recorded stubs.

/** Collects one issue whose policy asks for `workspaceStrategy`, returning the admission. */
const proposeWithWorkspace = (
  issueNumber: number,
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
) =>
  Effect.gen(function* () {
    (yield* PolicyFake).propose = (input) =>
      Effect.map(proposeImplementation(input), (request) => ({ ...request, workspaceStrategy }));
    return (yield* proposeIssue(issueNumber))!;
  });

/**
 * Settles the next queued effect as done without running it, for work a test already ran by
 * calling its service directly. Effects on one thread are claimed in order.
 */
const retireNextEffect = (expectedIdPrefix: string) =>
  Effect.gen(function* () {
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const next = yield* outbox.claimNext({ workerId: "test:retired" });
    const effect = Option.getOrThrow(next);
    assert.isTrue(effect.id.startsWith(expectedIdPrefix), effect.id);
    yield* outbox.succeed({ effectId: effect.id, workerId: "test:retired" });
  });

const claimedRunOf = (execution: { readonly threadId: ThreadId }) =>
  Effect.map(
    Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.getThreadProjection(execution.threadId),
    ),
    (projection) => projection.runs[0]!,
  );

it.effect(
  "Claims/S05: a factory worktree with no branch gets its decision's branch, unrenamed",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6201);
        const admitted = yield* proposeWithWorkspace(6201, { type: "worktree", baseRef: "main" });
        const execution = admittedExecution(admitted);
        yield* runEffects;
        const decisionKey =
          admitted.type === "admitted" && admitted.reservation.origin === "admitted"
            ? admitted.reservation.decisionKey
            : "";
        const preparation = yield* PreparationFake;
        assert.deepStrictEqual(preparation.worktrees, [
          { branch: `t3-factory/beta/${String(decisionKey).slice(0, 16)}`, baseRef: "main" },
        ]);
        // No model named or renamed the branch.
        assert.deepStrictEqual(preparation.branchNames, []);
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["running"]);
      }),
    ),
);

it.effect(
  "Claims/S05: an explicit factory branch is kept, and a temporary-looking one refused",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6202);
        yield* seedIssue(6203);
        const refused = yield* proposeWithWorkspace(6202, {
          type: "worktree",
          baseRef: "main",
          branch: "t3/0123abcd",
        });
        assert.deepStrictEqual(refused, { type: "refused", reason: "workspace_branch_temporary" });
        assert.deepStrictEqual([yield* occupied, yield* commentPosts], [0, 0]);
        admittedExecution(
          yield* proposeWithWorkspace(6203, {
            type: "worktree",
            baseRef: "main",
            branch: "feature/issue-6203",
          }),
        );
        yield* runEffects;
        const preparation = yield* PreparationFake;
        assert.deepStrictEqual(
          [preparation.worktrees.map((worktree) => worktree.branch), preparation.branchNames],
          [["feature/issue-6203"], []],
        );
      }),
    ),
);

it.effect(
  "Claims/S05: a factory branch the repository already has is refused before anything is reserved",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6204);
        // A reopened item's earlier unit keeps its branch, checked out in its own worktree.
        const graph = yield* GitGraphFake;
        graph.branches.set("feature/issue-6204", "base000");
        const strategy = {
          type: "worktree",
          baseRef: "main",
          branch: "feature/issue-6204",
        } as const;
        assert.deepStrictEqual(yield* proposeWithWorkspace(6204, strategy), {
          type: "refused",
          reason: "workspace_branch_exists",
        });
        const preparation = yield* PreparationFake;
        assert.deepStrictEqual(
          [yield* occupied, yield* commentPosts, preparation.worktrees.length],
          [0, 0, 0],
        );
        // The next unit on a branch of its own is admitted and prepared; the old one is untouched.
        admittedExecution(
          yield* proposeWithWorkspace(6204, { ...strategy, branch: "feature/issue-6204-reopen" }),
        );
        yield* runEffects;
        assert.deepStrictEqual(
          preparation.worktrees.map((worktree) => worktree.branch),
          ["feature/issue-6204-reopen"],
        );
        assert.strictEqual(graph.branches.get("feature/issue-6204"), "base000");
        assert.strictEqual((yield* startedTurns).length, 1);
      }),
    ),
);

it.effect("Claims/S05: a workspace refused at its final read is never prepared", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6204);
      const execution = admittedExecution(
        yield* proposeWithWorkspace(6204, { type: "worktree", baseRef: "main" }),
      );
      yield* settleClaimOnly(execution);
      const fake = yield* GitHubFake;
      const services =
        yield* Effect.context<Effect.Services<ReturnType<typeof configureFactory>>>();
      fake.beforeIssueRead = Effect.gen(function* () {
        fake.beforeIssueRead = undefined;
        yield* configureFactory({ pools: pool(1), claim: claimConfig, enabled: false });
      }).pipe(Effect.orDie, Effect.provide(services));
      yield* runEffects;
      assert.deepStrictEqual((yield* PreparationFake).worktrees, []);
      assert.strictEqual((yield* startedTurns).length, 0);
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
      const record = yield* claimRecord;
      assert.deepStrictEqual(
        [record?.state, record?.reason],
        ["stale_after_claim", "configuration_changed"],
      );
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

it.effect(
  "Claims/S05: a preparation handoff lost before authorization replays on the same run, once",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6205);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(6205, { type: "worktree", baseRef: "main" }),
        );
        yield* settleClaimOnly(execution);
        yield* retireNextEffect("effect:factory-claim.write:");
        const run = yield* claimedRunOf(execution);
        // A worker took the handoff, then its process died before authorizing anything.
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const claimed = yield* outbox.claimNext({
          workerId: "worker:crashed",
        });
        assert.strictEqual(
          Option.getOrUndefined(claimed)?.id,
          `effect:factory-execution.prepare:${run.id}`,
        );
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
        (yield* PreparationFake).owner = "fresh";
        yield* runEffects;
        assert.strictEqual((yield* PreparationFake).worktrees.length, 1);
        assert.strictEqual((yield* startedTurns).length, 1);
        const after = yield* claimedRunOf(execution);
        assert.deepStrictEqual([after.id, after.status], [run.id, "running"]);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

/**
 * Runs the claimed run's preparation until `hold` signals, then loses that owner: the drain is
 * interrupted, and recovery runs as a restarted server's would. Whatever the old owner started
 * is left as it is, possibly still running.
 */
const loseOwnerDuringPreparation = (
  execution: { readonly commandId: CommandId; readonly threadId: ThreadId },
  hold: (reached: Deferred.Deferred<void>) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* settleClaimOnly(execution);
    const reached = yield* Deferred.make<void>();
    yield* hold(reached);
    const drain = yield* Effect.forkScoped(runEffects);
    yield* Deferred.await(reached);
    yield* Fiber.interrupt(drain);
    yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
    assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
  });

const holdForever = (reached: Deferred.Deferred<void>) =>
  Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never));

it.effect.each([
  ["inside the worktree create", "worktree"],
  ["during a live setup script", "setup"],
  ["after setup, before the run is released", "release"],
] as const)("Claims/S05: workspace work lost %s is held, never prepared again", ([, point]) =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6206);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(6206, { type: "worktree", baseRef: "main" }),
        );
        const preparation = yield* PreparationFake;
        yield* loseOwnerDuringPreparation(execution, (reached) =>
          Effect.sync(() => {
            if (point === "worktree") preparation.duringWorktreeCreate = holdForever(reached);
            if (point === "setup") {
              preparation.setup = {
                status: "started",
                scriptId: "setup",
                scriptName: "Setup",
                scriptCommand: "./setup",
                terminalId: "setup-terminal",
                cwd: "/workspace",
                async: false,
                completion: holdForever(reached).pipe(Effect.as({ exitCode: 0, durationMs: 0 })),
              };
            }
            if (point === "release") preparation.beforeRelease = holdForever(reached);
          }),
        );
        // A restarted server's launch service never saw that work.
        preparation.owner = "fresh";
        preparation.duringWorktreeCreate = undefined;
        preparation.beforeRelease = undefined;
        preparation.setup = { status: "no-script" };
        yield* runEffects;
        assert.deepStrictEqual(
          [preparation.worktrees.length, preparation.setups.length],
          [1, point === "worktree" ? 0 : 1],
        );
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        const record = yield* claimRecord;
        assert.deepStrictEqual(
          [record?.state, record?.reason],
          ["stale_after_claim", "workspace_preparation_unknown"],
        );
        // Still held and charged, and visible as such.
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect(
  "Claims/S05: preparation still running in this runtime is awaited, never started twice",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory();
          yield* seedIssue(6207);
          const execution = admittedExecution(
            yield* proposeWithWorkspace(6207, { type: "worktree", baseRef: "main" }),
          );
          const preparation = yield* PreparationFake;
          const gate = yield* Deferred.make<void>();
          yield* loseOwnerDuringPreparation(execution, (reached) =>
            Effect.sync(() => {
              preparation.duringWorktreeCreate = Deferred.succeed(reached, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
              );
            }),
          );
          // Only the drain was lost: this runtime's launch service is still preparing.
          const replay = yield* Effect.forkScoped(runEffects);
          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(replay);
          assert.strictEqual(preparation.worktrees.length, 1);
          assert.strictEqual((yield* startedTurns).length, 1);
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["running"]);
          assert.strictEqual((yield* claimRecord)?.state, "workspace_authorized");
        }),
      ),
    ),
);

it.effect("Claims/S05: a preparation that fails holds the claim and starts nothing", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6208);
      const execution = admittedExecution(
        yield* proposeWithWorkspace(6208, { type: "worktree", baseRef: "main" }),
      );
      // The interruption a graceful shutdown delivers to the launch service's preparation.
      (yield* PreparationFake).duringWorktreeCreate = Effect.interrupt;
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, 0);
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
      const record = yield* claimRecord;
      assert.deepStrictEqual(
        [record?.state, record?.reason],
        ["stale_after_claim", "workspace_preparation_failed"],
      );
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

it.effect(
  "Claims/S05: a workspace claim authorizes only its own run, not a later one after recovery",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6209);
        const execution = admittedExecution(yield* proposeWithWorkspace(6209, { type: "root" }));
        yield* settleClaimOnly(execution);
        yield* retireNextEffect("effect:factory-claim.write:");
        const run = yield* claimedRunOf(execution);
        // Prepared and released, its handoff done, but the server restarts before the provider
        // start runs.
        yield* (yield* FactoryClaimService.FactoryClaimService).prepareFirstUse({
          reservationId: FactoryReservationId.make(`reservation:${execution.commandId}`),
          runId: run.id,
        });
        yield* retireNextEffect("effect:factory-execution.prepare:");
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["starting"]);
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        yield* configureFactory({ pools: pool(1), claim: claimConfig, enabled: false });
        yield* startOutcome(sendUserMessage(execution.threadId, "after-restart"));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        // The intent stays bound to the run it was recorded for.
        const claims = yield* FactoryClaimStore.FactoryClaimStore;
        const claim = Option.getOrThrow(
          yield* claims.get(FactoryReservationId.make(`reservation:${execution.commandId}`)),
        ).claim;
        assert.deepStrictEqual(
          [claim.state, claim.state === "workspace_authorized" ? claim.runId : null],
          ["workspace_authorized", run.id],
        );
      }),
    ),
);

// Claims correction 2: desired-behaviour controls for the second review's findings.

/** The carriers held as observed reservations, which nothing native produced. */
const observedCarriers = Effect.gen(function* () {
  const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
  return state.reservations
    .flatMap((reservation) =>
      reservation.origin === "observed" && reservation.state === "held"
        ? [String(reservation.carrierKey)]
        : [],
    )
    .toSorted();
});

/**
 * A collection pass under a later generation, or under the one given, reads the issue as it is now
 * and records it.
 */
const recordLaterRead = (issueNumber: number, issue: FakeIssue, at?: FactoryReadGeneration) =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const generation = at ?? (yield* store.beginCollection(factoryId));
    yield* store.recordItemObservation({
      ...issueObservation({
        issue: {
          state: issue.state,
          title: issue.title,
          body: issue.body,
          labels: [...issue.labels],
          comments: issue.comments.map((comment) => ({
            id: comment.id,
            authorId: String(comment.user.id),
            body: comment.body,
          })),
        },
        subject: { tracker: "github", repository: claimRepository, issueNumber },
        claim: claimConfig,
      }),
      factoryId,
      itemKey: itemKeyOf(`github:${claimRepository}#${issueNumber}`),
      generation,
    });
  });

/**
 * Holds the `nth` issue read: a later collection records what it sees first, then a foreign
 * claim lands, so the held read returns a carrier the newer observation does not have.
 */
const laterReadThenForeignClaim = (nth: number, issueNumber: number, issue: FakeIssue) =>
  Effect.gen(function* () {
    const fake = yield* GitHubFake;
    const services = yield* Effect.context<Effect.Services<ReturnType<typeof recordLaterRead>>>();
    let reads = 0;
    fake.beforeIssueRead = Effect.gen(function* () {
      reads++;
      if (reads !== nth) return;
      fake.beforeIssueRead = undefined;
      yield* recordLaterRead(issueNumber, issue);
      issue.labels.push("claimed");
    }).pipe(Effect.orDie, Effect.provide(services));
  });

it.effect(
  "Claims/R2-S01: a foreign claim seen by a superseded first-use read is still charged",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        const issue = yield* seedIssue(6601);
        yield* seedIssue(6602);
        const execution = admittedExecution((yield* proposeIssue(6601))!);
        yield* settleClaimOnly(execution);
        yield* laterReadThenForeignClaim(1, 6601, issue);
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual([yield* observedRows, yield* occupied], [1, 2]);
        assert.strictEqual((yield* proposeIssue(6602))?.type, "refused");
      }),
    ),
);

it.effect(
  "Claims/R2-S01: a foreign claim seen by a superseded post-write read is still charged",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        const issue = yield* seedIssue(6603);
        yield* seedIssue(6604);
        admittedExecution((yield* proposeIssue(6603))!);
        // The first issue read is before the write; the second is the readback's fresh read.
        yield* laterReadThenForeignClaim(2, 6603, issue);
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual(
          [(yield* claimRecord)?.state, (yield* claimRecord)?.reason],
          ["conflicted", "foreign_claim"],
        );
        // Our attested comment is ours once; the foreign claim is charged separately.
        assert.deepStrictEqual(yield* observedCarriers, [
          `github:${claimRepository}#6603:label:claimed`,
        ]);
        assert.strictEqual(yield* occupied, 2);
        assert.strictEqual((yield* proposeIssue(6604))?.type, "refused");
        assert.strictEqual(yield* commentPosts, 1);
      }),
    ),
);

it.effect("Claims/R2-S01: a foreign claim seen by a superseded pre-write read takes the unit", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(1);
      const issue = yield* seedIssue(6605);
      admittedExecution((yield* proposeIssue(6605))!);
      yield* laterReadThenForeignClaim(1, 6605, issue);
      yield* runEffects;
      assert.strictEqual(yield* commentPosts, 0);
      assert.strictEqual((yield* claimRecord)?.state, "released");
      // The unwritten native unit passes to the foreign owner the read saw.
      assert.deepStrictEqual(yield* observedCarriers, [
        `github:${claimRepository}#6605:label:claimed`,
      ]);
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

/**
 * A lifecycle over the same database whose SQL hands each final empty pending-subject read to
 * `atFinalRead` before returning it unchanged, the boundary the retained probes use.
 */
const lifecycleHeldAtFinalRead = (atFinalRead: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    let held = false;
    const proxy = new Proxy(sql, {
      apply(target, self, args) {
        const statement = Reflect.apply(target, self, args) as Effect.Effect<
          ReadonlyArray<unknown>
        >;
        const query = Array.isArray(args[0]) ? args[0].join(" ").replace(/\s+/g, " ") : "";
        if (!query.includes("FROM factory_collection_subjects WHERE factory_id")) return statement;
        return statement.pipe(
          Effect.filterOrElse(
            (rows) => rows.length !== 0 || held,
            (rows) =>
              Effect.sync(() => {
                held = true;
              }).pipe(Effect.andThen(atFinalRead), Effect.as(rows)),
          ),
        );
      },
    });
    const built = yield* Layer.build(
      Layer.fresh(
        FactoryLifecycle.layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, proxy))),
      ),
    );
    return Context.get(built, FactoryLifecycle.FactoryLifecycle);
  });

it.effect(
  "Claims/R2-S02: a trigger accepted at the collector's final read is read before it exits",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory(2);
          yield* seedIssue(6606);
          yield* seedIssue(6607);
          const coalesced = yield* Deferred.make<FactoryLifecycle.FactoryCollectionResult>();
          let factory: FactoryLifecycle.FactoryLifecycle["Service"] | undefined;
          factory = yield* lifecycleHeldAtFinalRead(
            Effect.suspend(() =>
              factory!.collect({
                factoryId,
                trigger: "tracker_event",
                subjects: [{ repository: claimRepository, issueNumber: 6607 }],
              }),
            ).pipe(
              Effect.flatMap((result) => Deferred.succeed(coalesced, result)),
              Effect.orDie,
            ),
          );
          yield* factory.collect({
            factoryId,
            trigger: "tracker_event",
            subjects: [{ repository: claimRepository, issueNumber: 6606 }],
          });
          assert.deepStrictEqual(yield* Deferred.await(coalesced), { type: "coalesced" });
          const fake = yield* GitHubFake;
          assert.isTrue(
            fake.requests.some(
              (request) => request.path === `repos/${claimRepository}/issues/6607`,
            ),
          );
          const sql = yield* SqlClient.SqlClient;
          const pending = yield* sql<{ readonly item_key: string }>`
          SELECT item_key FROM factory_collection_subjects WHERE requested > completed
        `;
          assert.deepStrictEqual(pending, []);
        }),
      ),
    ),
);

it.effect("Claims/R2-S02: a trigger coalesced into an interrupted collector is still served", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6608);
        yield* seedIssue(6609);
        const fake = yield* GitHubFake;
        const reading = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(Effect.never),
        );
        const owner = yield* Effect.forkScoped(collectIssues([6608]));
        yield* Deferred.await(reading);
        assert.deepStrictEqual(yield* collectIssues([6609]), { type: "coalesced" });
        const proposed6609 = yield* Deferred.make<void>();
        let proposals6609 = 0;
        const policy = yield* PolicyFake;
        policy.propose = (input) =>
          (input.observation.itemKey.endsWith("#6609")
            ? Effect.sync(() => proposals6609++).pipe(
                Effect.andThen(Deferred.succeed(proposed6609, undefined)),
              )
            : Effect.void
          ).pipe(Effect.andThen(proposeImplementation(input)));
        fake.beforeIssueRead = undefined;
        yield* Fiber.interrupt(owner);
        // Translated (r2.1 A): this call is a new trigger, so either it or the interrupted
        // owner's catch-up may win; whichever does serves the coalesced subject, once.
        yield* collectIssues([]);
        yield* Deferred.await(proposed6609);
        assert.strictEqual(proposals6609, 1);
      }),
    ),
  ),
);

/** A claimed worktree execution whose async setup is still running after its release. */
const preparedWithUnresolvedSetup = (issueNumber: number) =>
  Effect.gen(function* () {
    yield* configureFactory({
      pools: pool(1),
      claim: claimConfig,
      execution: {
        modelSelection: rosterSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });
    yield* seedIssue(issueNumber);
    const execution = admittedExecution(
      yield* proposeWithWorkspace(issueNumber, { type: "worktree", baseRef: "main" }),
    );
    yield* settleClaimOnly(execution);
    yield* retireNextEffect("effect:factory-claim.write:");
    const preparation = yield* PreparationFake;
    const setupAwaited = yield* Deferred.make<void>();
    const setupExit = yield* Deferred.make<{ exitCode: number; durationMs: number }>();
    preparation.setup = {
      status: "started",
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "./setup",
      terminalId: "setup-terminal",
      cwd: "/workspace",
      async: true,
      completion: Deferred.succeed(setupAwaited, undefined).pipe(
        Effect.andThen(Deferred.await(setupExit)),
      ),
    };
    const run = yield* claimedRunOf(execution);
    yield* (yield* FactoryClaimService.FactoryClaimService).prepareFirstUse({
      reservationId: FactoryReservationId.make(`reservation:${execution.commandId}`),
      runId: run.id,
    });
    yield* Deferred.await(setupAwaited);
    yield* retireNextEffect("effect:factory-execution.prepare:");
    return { execution, run, setupExit };
  });

const custodyOfReservation = (execution: { readonly commandId: CommandId }) =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    return state.reservations.find(
      (reservation) => reservation.reservationId === `reservation:${execution.commandId}`,
    )?.custody;
  });

it.effect("Claims/R2-S03: running setup keeps a never-started execution live, not quiescent", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution } = yield* preparedWithUnresolvedSetup(6610);
      // The server restarts before the provider start was claimed: no provider ever ran.
      yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
      yield* runEffects;
      assert.deepStrictEqual(yield* custodyOfReservation(execution), {
        state: "live",
        reasons: ["workspace_preparation"],
      });
    }),
  ),
);

it.effect("Claims/R2-S03: running setup keeps a finished provider execution live", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution } = yield* preparedWithUnresolvedSetup(6611);
      yield* runEffects;
      yield* completeLatestRun(execution.threadId);
      yield* setRoster(execution.threadId, []);
      assert.deepStrictEqual(yield* custodyOfReservation(execution), {
        state: "live",
        reasons: ["workspace_preparation"],
      });
      const before = (yield* startedTurns).length;
      yield* startOutcome(sendUserMessage(execution.threadId, "while-setup-runs"));
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, before);
    }),
  ),
);

it.effect.each([
  ["running", "running"],
  ["completed by its provider", "completed"],
] as const)(
  "Claims/R2-S04: replaying preparation for a released run that is %s keeps its claim",
  ([, status]) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(status === "running" ? 6612 : 6613);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(status === "running" ? 6612 : 6613, { type: "root" }),
        );
        yield* runEffects;
        if (status === "completed") yield* completeLatestRun(execution.threadId);
        const run = yield* claimedRunOf(execution);
        assert.strictEqual(run.status, status);
        const starts = (yield* startedTurns).length;
        yield* (yield* FactoryClaimService.FactoryClaimService).prepareFirstUse({
          reservationId: FactoryReservationId.make(`reservation:${execution.commandId}`),
          runId: run.id,
        });
        yield* runEffects;
        assert.strictEqual((yield* claimRecord)?.state, "workspace_authorized");
        assert.strictEqual((yield* startedTurns).length, starts);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

// Post-implementation: charging a superseded read's carriers leaves the newer read authoritative.
it.effect(
  "Claims/R2-S01: the newer observation stays the item's record after a superseded read",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        const issue = yield* seedIssue(6614);
        const execution = admittedExecution((yield* proposeIssue(6614))!);
        yield* settleClaimOnly(execution);
        const sql = yield* SqlClient.SqlClient;
        const before = yield* sql<{ readonly generation: number }>`
        SELECT generation FROM factory_item_observations
        WHERE item_key = ${`github:${claimRepository}#6614`} ORDER BY generation
      `;
        yield* laterReadThenForeignClaim(1, 6614, issue);
        yield* runEffects;
        const after = yield* sql<{ readonly generation: number; readonly basis_digest: string }>`
        SELECT generation, basis_digest FROM factory_item_observations
        WHERE item_key = ${`github:${claimRepository}#6614`} ORDER BY generation
      `;
        // Exactly one more observation: the later collection's. The superseded first-use read
        // added a charge, not a record, and changed no basis.
        assert.strictEqual(after.length, before.length + 1);
        const conflicts = yield* sql`SELECT 1 FROM factory_item_conflicts`;
        assert.strictEqual(conflicts.length, 0);
        assert.deepStrictEqual(yield* observedCarriers, [
          `github:${claimRepository}#6614:label:claimed`,
        ]);
      }),
    ),
);

it.effect(
  "Claims/R2-S04: replaying preparation after a released run's provider failed keeps its claim",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6615);
        const execution = admittedExecution(yield* proposeWithWorkspace(6615, { type: "root" }));
        yield* runEffects;
        // The workspace was released and the provider ran; then the provider's turn failed.
        yield* completeLatestRun(execution.threadId, "failed");
        const run = yield* claimedRunOf(execution);
        assert.strictEqual(run.status, "failed");
        yield* (yield* FactoryClaimService.FactoryClaimService).prepareFirstUse({
          reservationId: FactoryReservationId.make(`reservation:${execution.commandId}`),
          runId: run.id,
        });
        assert.strictEqual((yield* claimRecord)?.state, "workspace_authorized");
      }),
    ),
);

it.effect("Claims/R2-S04: a claimed factory run's workspace is not prepared again by a retry", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6616);
      const execution = admittedExecution(
        yield* proposeWithWorkspace(6616, { type: "worktree", baseRef: "main" }),
      );
      yield* runEffects;
      yield* completeLatestRun(execution.threadId, "failed");
      const run = yield* claimedRunOf(execution);
      // A retry would prepare the workspace again outside the claim's first-use authorization.
      const retried = yield* Effect.exit(
        (yield* Orchestrator.OrchestratorV2).dispatch({
          type: "prepared-run.retry",
          commandId: CommandId.make(`command:retry:${run.id}`),
          threadId: execution.threadId,
          runId: run.id,
        }),
      );
      assert.isTrue(Exit.isFailure(retried));
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
      assert.strictEqual((yield* PreparationFake).worktrees.length, 1);
    }),
  ),
);

// Post-implementation collector controls (r2.1 A). None was run at the old source: there the
// direct witness would not terminate, since nothing serves the coalesced subject.

class SnapshotUnavailable extends Schema.TaggedError<SnapshotUnavailable>()(
  "SnapshotUnavailable",
  {},
) {}

/** Holds every issue read until `gate` opens, signalling `reading` at each. */
const holdReads = (
  fake: GitHubFakeState,
  reading: Queue.Queue<void>,
  gate: Deferred.Deferred<void>,
) => {
  fake.beforeIssueRead = Queue.offer(reading, undefined).pipe(Effect.andThen(Deferred.await(gate)));
};

/** The policy proposes as usual, and signals when it proposes `issueNumber`. */
const signalProposal = (issueNumber: number) =>
  Effect.gen(function* () {
    const proposed = yield* Deferred.make<void>();
    const policy = yield* PolicyFake;
    policy.propose = (input) =>
      (input.observation.itemKey.endsWith(`#${issueNumber}`)
        ? Deferred.succeed(proposed, undefined)
        : Effect.void
      ).pipe(Effect.andThen(proposeImplementation(input)));
    return proposed;
  });

it.effect(
  "Claims/R2-S02: an interrupted collector's coalesced subject is served with no further trigger",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory(2);
          yield* seedIssue(6620);
          yield* seedIssue(6621);
          const fake = yield* GitHubFake;
          const reading = yield* Deferred.make<void>();
          fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
            Effect.andThen(Effect.never),
          );
          const owner = yield* Effect.forkScoped(collectIssues([6620]));
          yield* Deferred.await(reading);
          assert.deepStrictEqual(yield* collectIssues([6621]), { type: "coalesced" });
          const proposed = yield* signalProposal(6621);
          fake.beforeIssueRead = undefined;
          yield* Fiber.interrupt(owner);
          // No other trigger: only the interrupted owner's handoff can propose this.
          yield* Deferred.await(proposed);
        }),
      ),
    ),
);

it.effect("Claims/R2-S02: an older owner's cleanup leaves the newer owner's collector held", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6622);
        yield* seedIssue(6623);
        const fake = yield* GitHubFake;
        const firstRead = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(firstRead, undefined).pipe(
          Effect.andThen(Effect.never),
        );
        const owner = yield* Effect.forkScoped(collectIssues([6622]));
        yield* Deferred.await(firstRead);
        assert.deepStrictEqual(yield* collectIssues([6623]), { type: "coalesced" });
        // The catch-up that takes over is held in its own read.
        const reading = yield* Queue.unbounded<void>();
        const gate = yield* Deferred.make<void>();
        holdReads(fake, reading, gate);
        yield* Fiber.interrupt(owner);
        yield* Queue.take(reading);
        // The interrupted owner has finished its cleanup; the catch-up still owns the collector.
        assert.deepStrictEqual(yield* collectIssues([]), { type: "coalesced" });
        const proposed = yield* signalProposal(6623);
        fake.beforeIssueRead = undefined;
        yield* Deferred.succeed(gate, undefined);
        yield* Deferred.await(proposed);
      }),
    ),
  ),
);

it.effect(
  "Claims/R2-S02: an owner failing before its first snapshot hands off a later trigger",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory(2);
          yield* seedIssue(6624);
          yield* seedIssue(6625);
          const proposed = yield* signalProposal(6625);
          const sql = yield* SqlClient.SqlClient;
          let factory: FactoryLifecycle.FactoryLifecycle["Service"] | undefined;
          let failures = 0;
          // The owner's first snapshot read fails, after a second trigger was accepted while it
          // held the collector.
          const proxy = new Proxy(sql, {
            apply(target, self, args) {
              const statement = Reflect.apply(target, self, args) as Effect.Effect<
                ReadonlyArray<unknown>,
                SnapshotUnavailable
              >;
              const query = Array.isArray(args[0]) ? args[0].join(" ").replace(/\s+/g, " ") : "";
              if (!query.includes("SELECT requested, completed FROM factory_collection_requests")) {
                return statement;
              }
              if (failures > 0) return statement;
              failures++;
              return Effect.suspend(() =>
                factory!.collect({
                  factoryId,
                  trigger: "tracker_event",
                  subjects: [{ repository: claimRepository, issueNumber: 6625 }],
                }),
              ).pipe(
                Effect.flatMap((nested) => {
                  assert.deepStrictEqual(nested, { type: "coalesced" });
                  return Effect.fail(new SnapshotUnavailable());
                }),
              );
            },
          });
          const built = yield* Layer.build(
            Layer.fresh(
              FactoryLifecycle.layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, proxy))),
            ),
          );
          factory = Context.get(built, FactoryLifecycle.FactoryLifecycle);
          const failed = yield* Effect.exit(
            factory.collect({
              factoryId,
              trigger: "tracker_event",
              subjects: [{ repository: claimRepository, issueNumber: 6624 }],
            }),
          );
          assert.isTrue(Exit.isFailure(failed));
          // The catch-up, floored at the count it read, serves both subjects once.
          yield* Deferred.await(proposed);
          assert.strictEqual(failures, 1);
        }),
      ),
    ),
);

it.effect("Claims/R2-S02: a handoff into a closed lifecycle starts nothing and loses nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6626);
        yield* seedIssue(6627);
        const fake = yield* GitHubFake;
        const reading = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(Effect.never),
        );
        const lifecycleScope = yield* Scope.make();
        const closing = Context.get(
          yield* Layer.build(Layer.fresh(FactoryLifecycle.layer)).pipe(
            Effect.provideService(Scope.Scope, lifecycleScope),
          ),
          FactoryLifecycle.FactoryLifecycle,
        );
        const owner = yield* Effect.forkScoped(
          closing.collect({
            factoryId,
            trigger: "tracker_event",
            subjects: [{ repository: claimRepository, issueNumber: 6626 }],
          }),
        );
        yield* Deferred.await(reading);
        assert.deepStrictEqual(
          yield* closing.collect({
            factoryId,
            trigger: "tracker_event",
            subjects: [{ repository: claimRepository, issueNumber: 6627 }],
          }),
          { type: "coalesced" },
        );
        fake.beforeIssueRead = undefined;
        // The lifecycle is shut down first: its owner's handoff has nowhere to run.
        yield* Scope.close(lifecycleScope, Exit.void);
        yield* Fiber.interrupt(owner);
        const sql = yield* SqlClient.SqlClient;
        const pending = yield* sql<{ readonly item_key: string }>`
          SELECT item_key FROM factory_collection_subjects WHERE requested > completed
          ORDER BY item_key
        `;
        assert.deepStrictEqual(
          pending.map((row) => row.item_key),
          [`github:${claimRepository}#6626`, `github:${claimRepository}#6627`],
        );
        // The durable subjects wait for the next trigger, which reads them.
        const proposed = yield* signalProposal(6627);
        yield* collectIssues([]);
        yield* Deferred.await(proposed);
      }),
    ),
  ),
);

// Post-implementation R2-S03 controls: what a settled, open or missing workspace obligation lets
// custody say. Git and setup are recorded stubs; nothing here observes an OS process.

const workspaceObligationOf = (runId: RunId) =>
  Effect.flatMap(FactoryStore.FactoryStore, (store) => store.workspaceObligation(runId));

/** Runs one claimed execution with `workspaceStrategy` to its provider's completion. */
const finishedWorkspaceExecution = (
  issueNumber: number,
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  options: { readonly awaitStart?: boolean; readonly modelSelection?: ModelSelection } = {},
) =>
  Effect.gen(function* () {
    yield* configureFactory({
      pools: pool(1),
      claim: claimConfig,
      execution: {
        modelSelection: options.modelSelection ?? rosterSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });
    yield* seedIssue(issueNumber);
    const execution = admittedExecution(
      yield* proposeWithWorkspace(issueNumber, workspaceStrategy),
    );
    // With `awaitStart`, the scripted turn's own "running" report lands before the run is
    // completed, so it cannot reopen the completed turn afterwards.
    if (options.awaitStart === true) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const running = yield* awaitRunningTurn(execution.threadId);
          yield* runEffects;
          yield* Fiber.join(running);
        }),
      );
    } else {
      yield* runEffects;
    }
    yield* completeLatestRun(execution.threadId);
    yield* setRoster(execution.threadId, []);
    return { execution, run: yield* claimedRunOf(execution) };
  });

it.effect(
  "Claims/R2-S03: preparation with no process at all settles, and the execution is quiet",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* finishedWorkspaceExecution(6630, { type: "root" });
        assert.strictEqual(
          Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.state,
          "settled",
        );
        // The obligation settles, and the run's container holds no process.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["contained_quiet"],
        });
      }),
    ),
);

it.effect(
  "Custody/F1: a completed contained stage whose provider started outside its container stays held",
  () =>
    runIsolated(
      Effect.gen(function* () {
        // As the stable port's adapters did: the run's container is held, but the provider
        // process never joined it, so its quiet container proves nothing about that process.
        (yield* ScriptedJoinTarget).skip = true;
        const { execution, run } = yield* finishedWorkspaceExecution(
          6631,
          { type: "root" },
          { awaitStart: true },
        );
        const [own] = yield* generationFactsOf(run.id);
        assert.deepStrictEqual([own?.state, own?.providerJoins], ["held", undefined]);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        yield* TestClock.adjust("2 hours");
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect(
  "N26/N27: a review on Codex or Muse settles once its own contained provider has ended",
  () =>
    Effect.gen(function* () {
      for (const [issueNumber, instance] of [
        [6640, "contained-codex"],
        [6641, "contained-muse"],
      ] as const) {
        yield* runIsolated(
          Effect.gen(function* () {
            const { execution } = yield* finishedWorkspaceExecution(
              issueNumber,
              { type: "root" },
              {
                modelSelection: { instanceId: ProviderInstanceId.make(instance), model: "review" },
              },
            );
            // Its provider process started inside its own run's container, so the review
            // settles like any contained execution rather than staying unknown.
            assert.deepStrictEqual(yield* custodyOfReservation(execution), {
              state: "quiescent",
              reasons: ["contained_quiet"],
            });
            // A Codex session otherwise serves every thread of its instance; the execution's
            // is its own, so its container holds only its own work.
            const orchestrator = yield* Orchestrator.OrchestratorV2;
            const idAllocator = yield* IdAllocator.IdAllocatorV2.pipe(
              Effect.provide(IdAllocator.layer),
            );
            const [providerThread] = (yield* orchestrator.getThreadProjection(execution.threadId))
              .providerThreads;
            assert.notStrictEqual(
              providerThread?.providerSessionId,
              idAllocator.derive.providerSession({
                providerInstanceId: ProviderInstanceId.make(instance),
              }),
            );
          }),
        );
      }
    }),
);

it.effect("N26/N27: an unclaimed Codex execution starts on a session of its own as well", () =>
  runIsolated(
    Effect.gen(function* () {
      const codex = ProviderInstanceId.make("contained-codex");
      yield* configureFactory({
        pools: pool(1),
        execution: {
          modelSelection: { instanceId: codex, model: "review" },
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      });
      // No claim: the start commit plans its first message before any binding exists.
      const worker = admittedExecution(yield* proposeCurrent("github:alpha#6642"));
      yield* runEffects;
      yield* completeLatestRun(worker.threadId);
      yield* setRoster(worker.threadId, []);
      assert.deepStrictEqual(yield* custodyOf(worker.threadId), {
        state: "quiescent",
        reasons: ["contained_quiet"],
      });
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const idAllocator = yield* IdAllocator.IdAllocatorV2.pipe(Effect.provide(IdAllocator.layer));
      const [providerThread] = (yield* orchestrator.getThreadProjection(worker.threadId))
        .providerThreads;
      assert.notStrictEqual(
        providerThread?.providerSessionId,
        idAllocator.derive.providerSession({ providerInstanceId: codex }),
      );
    }),
  ),
);

it.effect("Claims/R2-S03: a worktree prepared through Git stays unresolved after it finishes", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution, run } = yield* finishedWorkspaceExecution(6631, {
        type: "worktree",
        baseRef: "main",
      });
      // The handle saw the preparation end; an awaited Git root process still proves nothing
      // of what it may have started.
      assert.strictEqual(
        Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.state,
        "open",
      );
      assert.deepStrictEqual(yield* custodyOfReservation(execution), {
        state: "unknown",
        reasons: ["workspace_obligation_unresolved"],
      });
      const before = (yield* startedTurns).length;
      yield* startOutcome(sendUserMessage(execution.threadId, "after-git"));
      yield* runEffects;
      assert.strictEqual((yield* startedTurns).length, before);
    }),
    // A host with no containment keeps this safe negative.
    { contained: false },
  ),
);

it.effect.each([
  ["has no setup script", "settled", { status: "no-script" } as const],
  [
    "ran a setup whose terminal closed before it reported",
    "open",
    {
      status: "started",
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "./setup",
      terminalId: "setup-terminal",
      cwd: "/workspace",
      async: false,
      completion: Effect.succeed({ exitCode: null, durationMs: 0 }),
    } as const,
  ],
  [
    "ran a setup that exited 0",
    "open",
    {
      status: "started",
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "./setup",
      terminalId: "setup-terminal",
      cwd: "/workspace",
      async: false,
      completion: Effect.succeed({ exitCode: 0, durationMs: 0 }),
    } as const,
  ],
] as const)(
  "Claims/R2-S03: an existing worktree whose project %s leaves its obligation %s",
  ([, expected, setup]) =>
    runIsolated(
      Effect.gen(function* () {
        (yield* PreparationFake).setup = setup;
        const workspace = yield* FactoryWorkspace;
        const { execution, run } = yield* finishedWorkspaceExecution(
          expected === "settled" ? 6632 : 6633,
          { type: "existing_worktree", worktreePath: workspace },
        );
        assert.strictEqual(
          Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.state,
          expected,
        );
        // Without containment the provider's own processes stay unproved either way.
        assert.strictEqual((yield* custodyOfReservation(execution))?.state, "unknown");
      }),
      { contained: false },
    ),
);

it.effect("Claims/R2-S03: a setup runner failing after it opened keeps the obligation open", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(6634);
      const preparation = yield* PreparationFake;
      // The runner opens its terminal and writes the command, then reports a failure.
      preparation.setup = {
        status: "started",
        scriptId: "setup",
        scriptName: "Setup",
        scriptCommand: "./setup",
        terminalId: "setup-terminal",
        cwd: "/workspace",
        async: false,
        completion: Effect.succeed({ exitCode: 1, durationMs: 0 }),
      };
      const workspace = yield* FactoryWorkspace;
      const execution = admittedExecution(
        yield* proposeWithWorkspace(6634, { type: "existing_worktree", worktreePath: workspace }),
      );
      yield* runEffects;
      const run = yield* claimedRunOf(execution);
      assert.strictEqual(run.status, "failed");
      assert.strictEqual(
        Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.state,
        "open",
      );
      assert.deepStrictEqual(yield* custodyOfReservation(execution), {
        state: "unknown",
        reasons: ["workspace_obligation_unresolved"],
      });
    }),
    { contained: false },
  ),
);

// Custody 1, contained preparation (recording containment collaborator; no OS process here):
// Git and setup join the run's container, so their obligation settles to it, and custody follows
// what the container holds.
it.effect(
  "Custody/C2: contained Git work settles to the run's container, which decides custody",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* finishedWorkspaceExecution(7201, {
          type: "worktree",
          baseRef: "main",
        });
        const obligation = Option.getOrUndefined(yield* workspaceObligationOf(run.id));
        assert.strictEqual(obligation?.state, "settled");
        assert.strictEqual(
          obligation?.state === "settled" ? obligation.scope : undefined,
          "contained",
        );
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["contained_quiet"],
        });
        // A process the preparation left behind keeps the execution live and its unit held.
        yield* setContainedMembers(execution.threadId, 1);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["contained_processes"],
        });
        const before = (yield* startedTurns).length;
        yield* startOutcome(sendUserMessage(execution.threadId, "after-contained-git"));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, before);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect("Custody/C2: a contained setup that exited settles to the container", () =>
  runIsolated(
    Effect.gen(function* () {
      (yield* PreparationFake).setup = {
        status: "started",
        scriptId: "setup",
        scriptName: "Setup",
        scriptCommand: "./setup",
        terminalId: "setup-terminal",
        cwd: "/workspace",
        async: false,
        completion: Effect.succeed({ exitCode: 0, durationMs: 0 }),
      };
      const workspace = yield* FactoryWorkspace;
      const { execution, run } = yield* finishedWorkspaceExecution(7202, {
        type: "existing_worktree",
        worktreePath: workspace,
      });
      const obligation = Option.getOrUndefined(yield* workspaceObligationOf(run.id));
      assert.strictEqual(
        obligation?.state === "settled" ? obligation.scope : undefined,
        "contained",
      );
      assert.strictEqual((yield* custodyOfReservation(execution))?.state, "quiescent");
    }),
  ),
);

it.effect("Claims/R2-S03: a preparation this runtime does not own reads as unresolved", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution, run, setupExit } = yield* preparedWithUnresolvedSetup(6635);
      const reasonsOf = (custody: FactoryCustody | undefined): ReadonlyArray<string> =>
        custody?.reasons ?? [];
      const live = yield* custodyOfReservation(execution);
      assert.strictEqual(live?.state, "live");
      assert.isTrue(reasonsOf(live).includes("workspace_preparation"));
      // A restarted server's launch service never saw that preparation.
      (yield* PreparationFake).owner = "fresh";
      assert.isFalse(
        reasonsOf(yield* custodyOfReservation(execution)).includes("workspace_preparation"),
      );
      // Another owner cannot take over the command, and a stale owner cannot settle.
      const adapter = yield* FactoryRunPreparation.FactoryRunPreparation;
      (yield* PreparationFake).owner = "first";
      const second = yield* adapter.startOwned({
        commandId: FactoryClaimStore.preparationCommandId(run.id),
        threadId: execution.threadId,
        runId: run.id,
        ownerId: PreparationOwnerId.make("owner:another"),
      });
      assert.isTrue(Option.isNone(second));
      const store = yield* FactoryStore.FactoryStore;
      assert.isFalse(
        yield* store.settleWorkspaceObligation({
          runId: run.id,
          ownerId: PreparationOwnerId.make("owner:another"),
          scope: { type: "no_external_work" },
        }),
      );
      assert.strictEqual(
        Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.state,
        "open",
      );
      yield* Deferred.succeed(setupExit, { exitCode: 0, durationMs: 0 });
    }),
  ),
);

it.effect(
  "Claims/R2-S03: a run that asked for a workspace but has no obligation reads unresolved",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* finishedWorkspaceExecution(6636, { type: "root" });
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM factory_workspace_obligations WHERE run_id = ${run.id}`;
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["workspace_obligation_unresolved"],
        });
      }),
    ),
);

it.effect(
  "Claims/R2-S04: a claimed run whose preparation failed is not prepared again by a retry",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        yield* seedIssue(6640);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(6640, { type: "worktree", baseRef: "main" }),
        );
        const preparation = yield* PreparationFake;
        // Git fails inside the worktree create: a genuine workspace-preparation failure.
        preparation.duringWorktreeCreate = Effect.die("worktree create failed");
        yield* runEffects;
        const run = yield* claimedRunOf(execution);
        assert.strictEqual(run.status, "failed");
        const held = yield* claimRecord;
        assert.deepStrictEqual(
          [held?.state, held?.reason],
          ["stale_after_claim", "workspace_preparation_failed"],
        );
        preparation.duringWorktreeCreate = undefined;
        // An ordinary retry, as a client sends it.
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const afterSequence = yield* orchestrator.getThreadEventSequence(execution.threadId);
        const retried = yield* Effect.exit(
          (yield* ThreadLaunchService.ThreadLaunchService).retryPreparation({
            commandId: CommandId.make(`command:retry:${run.id}`),
            threadId: execution.threadId,
            runId: run.id,
          }),
        );
        // A retry that was accepted prepares in the background; wait until the run has left
        // preparation again, as its persisted events show, whichever way it went.
        if ((yield* claimedRunOf(execution)).status === "preparing") {
          yield* orchestrator
            .streamStoredEventsFrom({
              threadId: execution.threadId,
              afterSequence,
              eventType: "run.updated",
            })
            .pipe(
              Stream.filter(
                (stored) =>
                  stored.event.type === "run.updated" &&
                  stored.event.payload.id === run.id &&
                  stored.event.payload.status !== "preparing",
              ),
              Stream.runHead,
            );
        }
        yield* runEffects;
        // No second workspace invocation, and the held claim still starts nothing.
        assert.strictEqual(preparation.worktrees.length, 1);
        assert.isTrue(Exit.isFailure(retried));
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.strictEqual((yield* claimRecord)?.state, "stale_after_claim");
      }),
    ),
);

// Claims correction 3: an acquired collector token is covered by cleanup for its whole life.

/**
 * A lifecycle over the same database, built in `scope`. At its owner's final empty pending-subject
 * read, a trigger for `coalescedIssue` is committed (and returns `coalesced`). The owner's next
 * trigger re-read, after it released, is then held until `gate` opens, after signalling
 * `atRecheck`. Every SQL result is returned unchanged.
 */
const lifecycleHeldAtTransfer = (scope: Scope.Scope, coalescedIssue: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const atRecheck = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    const coalesced = yield* Deferred.make<FactoryLifecycle.FactoryCollectionResult>();
    let factory: FactoryLifecycle.FactoryLifecycle["Service"] | undefined;
    let accepted = false;
    let held = false;
    const proxy = new Proxy(sql, {
      apply(target, self, args) {
        const statement = Reflect.apply(target, self, args) as Effect.Effect<
          ReadonlyArray<unknown>,
          SnapshotUnavailable
        >;
        const query = Array.isArray(args[0]) ? args[0].join(" ").replace(/\s+/g, " ") : "";
        if (query.includes("FROM factory_collection_subjects WHERE factory_id")) {
          return statement.pipe(
            Effect.filterOrElse(
              (rows) => rows.length !== 0 || accepted,
              (rows) =>
                Effect.sync(() => {
                  accepted = true;
                }).pipe(
                  Effect.andThen(
                    Effect.suspend(() =>
                      factory!.collect({
                        factoryId,
                        trigger: "tracker_event",
                        subjects: [{ repository: claimRepository, issueNumber: coalescedIssue }],
                      }),
                    ),
                  ),
                  Effect.flatMap((result) => Deferred.succeed(coalesced, result)),
                  Effect.orDie,
                  Effect.as(rows),
                ),
            ),
          );
        }
        if (query.includes("SELECT requested FROM factory_collection_requests") && !held) {
          return Effect.flatMap(statement, (rows) =>
            Deferred.isDone(coalesced).pipe(
              Effect.flatMap((afterAccept) =>
                afterAccept
                  ? Effect.sync(() => {
                      held = true;
                    }).pipe(
                      Effect.andThen(Deferred.succeed(atRecheck, undefined)),
                      Effect.andThen(Deferred.await(gate)),
                      Effect.as(rows),
                    )
                  : Effect.succeed(rows),
              ),
            ),
          );
        }
        return statement;
      },
    });
    const built = yield* Layer.build(
      Layer.fresh(
        FactoryLifecycle.layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, proxy))),
      ),
    ).pipe(Effect.provideService(Scope.Scope, scope));
    factory = Context.get(built, FactoryLifecycle.FactoryLifecycle);
    return { factory, atRecheck, gate, coalesced };
  });

it.effect(
  "Claims/R3-S01: an owner interrupted while it takes over a coalesced trigger leaves no orphan",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory(2);
          yield* seedIssue(6701);
          yield* seedIssue(6702);
          const lifecycleScope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
            Scope.close(scope, exit),
          );
          const { factory, atRecheck, gate, coalesced } = yield* lifecycleHeldAtTransfer(
            lifecycleScope,
            6702,
          );
          const owner = yield* Effect.forkScoped(
            factory.collect({
              factoryId,
              trigger: "tracker_event",
              subjects: [{ repository: claimRepository, issueNumber: 6701 }],
            }),
          );
          yield* Deferred.await(atRecheck);
          assert.deepStrictEqual(yield* Deferred.await(coalesced), { type: "coalesced" });
          // The service is shutting down, so no catch-up can run; then the owner is interrupted
          // while it re-reads the triggers it is about to take over.
          yield* Scope.close(lifecycleScope, Exit.void);
          // The request must be registered before the held read resumes; `Fiber.interrupt` would
          // wait on the masked owner instead.
          yield* Effect.sync(() => owner.interruptUnsafe());
          yield* Deferred.succeed(gate, undefined);
          assert.isTrue(Exit.isFailure(yield* Fiber.await(owner)));
          // No token outlived its owner: the next trigger owns the collector and reads 6702.
          const proposed = yield* signalProposal(6702);
          const later = yield* factory.collect({ factoryId, trigger: "restart", subjects: [] });
          assert.strictEqual(later.type, "collected");
          yield* Deferred.await(proposed);
        }),
      ),
    ),
);

it.effect("Claims/R3-S01 control: an owner that is not interrupted takes over and reads it", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6703);
        yield* seedIssue(6704);
        const lifecycleScope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
          Scope.close(scope, exit),
        );
        const { factory, atRecheck, gate, coalesced } = yield* lifecycleHeldAtTransfer(
          lifecycleScope,
          6704,
        );
        const proposed = yield* signalProposal(6704);
        const owner = yield* Effect.forkScoped(
          factory.collect({
            factoryId,
            trigger: "tracker_event",
            subjects: [{ repository: claimRepository, issueNumber: 6703 }],
          }),
        );
        yield* Deferred.await(atRecheck);
        assert.deepStrictEqual(yield* Deferred.await(coalesced), { type: "coalesced" });
        yield* Deferred.succeed(gate, undefined);
        const result = yield* Fiber.join(owner);
        assert.strictEqual(result.type, "collected");
        yield* Deferred.await(proposed);
        const sql = yield* SqlClient.SqlClient;
        const pending = yield* sql`
          SELECT 1 FROM factory_collection_subjects WHERE requested > completed
        `;
        assert.strictEqual(pending.length, 0);
      }),
    ),
  ),
);

// An interrupted owner hands the coalesced trigger to the next collector.
it.effect(
  "Claims/R3-S01: an owner interrupted while it takes over hands the trigger off, no wake needed",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureClaimFactory(2);
          yield* seedIssue(6705);
          yield* seedIssue(6706);
          const lifecycleScope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
            Scope.close(scope, exit),
          );
          const { factory, atRecheck, gate, coalesced } = yield* lifecycleHeldAtTransfer(
            lifecycleScope,
            6706,
          );
          const proposed = yield* signalProposal(6706);
          const owner = yield* Effect.forkScoped(
            factory.collect({
              factoryId,
              trigger: "tracker_event",
              subjects: [{ repository: claimRepository, issueNumber: 6705 }],
            }),
          );
          yield* Deferred.await(atRecheck);
          assert.deepStrictEqual(yield* Deferred.await(coalesced), { type: "coalesced" });
          yield* Effect.sync(() => owner.interruptUnsafe());
          yield* Deferred.succeed(gate, undefined);
          assert.isTrue(Exit.isFailure(yield* Fiber.await(owner)));
          yield* Deferred.await(proposed);
        }),
      ),
    ),
);

// Interruption at the owner's first pass, before
// it covers anything, releases the token; the owner's own trigger stays for the next one.
it.effect("Claims/R3-S01 control: an owner interrupted at its first pass leaves no orphan", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureClaimFactory(2);
        yield* seedIssue(6707);
        const sql = yield* SqlClient.SqlClient;
        const atFirstPass = yield* Deferred.make<void>();
        let held = false;
        const proxy = new Proxy(sql, {
          apply(target, self, args) {
            const statement = Reflect.apply(target, self, args) as Effect.Effect<
              ReadonlyArray<unknown>,
              SnapshotUnavailable
            >;
            const query = Array.isArray(args[0]) ? args[0].join(" ").replace(/\s+/g, " ") : "";
            if (!query.includes("SELECT requested, completed FROM factory_collection_requests")) {
              return statement;
            }
            if (held) return statement;
            held = true;
            // The owner holds its token and is at its first pass: it stays here until stopped.
            return Deferred.succeed(atFirstPass, undefined).pipe(Effect.andThen(Effect.never));
          },
        });
        const lifecycleScope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
          Scope.close(scope, exit),
        );
        const factory = Context.get(
          yield* Layer.build(
            Layer.fresh(
              FactoryLifecycle.layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, proxy))),
            ),
          ).pipe(Effect.provideService(Scope.Scope, lifecycleScope)),
          FactoryLifecycle.FactoryLifecycle,
        );
        const owner = yield* Effect.forkScoped(
          factory.collect({
            factoryId,
            trigger: "tracker_event",
            subjects: [{ repository: claimRepository, issueNumber: 6707 }],
          }),
        );
        yield* Deferred.await(atFirstPass);
        yield* Fiber.interrupt(owner);
        const proposed = yield* signalProposal(6707);
        const later = yield* factory.collect({ factoryId, trigger: "restart", subjects: [] });
        assert.strictEqual(later.type, "collected");
        yield* Deferred.await(proposed);
      }),
    ),
  ),
);

/**
 * While an owner for 6801 holds its tracker read, 6802's trigger coalesces and the factory loses
 * its claim: `claimless` reconfigures without one; `modeledMissing` makes later configuration
 * reads return no rows without deleting the row. Past a bound a configuration read fails the owner,
 * so an owner that keeps reacquiring ends too.
 */
const ownerLosingClaim = (scope: Scope.Scope, loss: "claimless" | "modeledMissing") =>
  Effect.gen(function* () {
    yield* configureClaimFactory(2);
    yield* seedIssue(6801);
    yield* seedIssue(6802);
    const sql = yield* SqlClient.SqlClient;
    let configurationReads = 0;
    let unavailable = false;
    const proxy = new Proxy(sql, {
      apply(target, self, args) {
        const statement = Reflect.apply(target, self, args) as Effect.Effect<
          ReadonlyArray<unknown>,
          SnapshotUnavailable
        >;
        const query = Array.isArray(args[0]) ? args[0].join(" ").replace(/\s+/g, " ") : "";
        if (!query.includes("SELECT config_json FROM factory_configurations")) return statement;
        configurationReads++;
        if (configurationReads > 25) return Effect.die("collector reacquired without end");
        return unavailable ? Effect.as(statement, []) : statement;
      },
    });
    const factory = Context.get(
      yield* Layer.build(
        Layer.fresh(
          FactoryLifecycle.layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, proxy))),
        ),
      ).pipe(Effect.provideService(Scope.Scope, scope)),
      FactoryLifecycle.FactoryLifecycle,
    );
    const fake = yield* GitHubFake;
    const reading = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
      Effect.andThen(Deferred.await(gate)),
    );
    const owner = yield* Effect.forkScoped(
      factory.collect({
        factoryId,
        trigger: "tracker_event",
        subjects: [{ repository: claimRepository, issueNumber: 6801 }],
      }),
    );
    yield* Deferred.await(reading);
    assert.deepStrictEqual(
      yield* factory.collect({
        factoryId,
        trigger: "tracker_event",
        subjects: [{ repository: claimRepository, issueNumber: 6802 }],
      }),
      { type: "coalesced" },
    );
    if (loss === "claimless") yield* configureFactory({ pools: pool(2) });
    else unavailable = true;
    fake.beforeIssueRead = undefined;
    yield* Deferred.succeed(gate, undefined);
    return yield* Fiber.join(owner);
  });

const pendingIssues = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly issue_number: number }>`
    SELECT issue_number FROM factory_collection_subjects WHERE requested > completed
  `;
  return rows.map((row) => row.issue_number);
});

// Without a claim nothing can be decided: the owner stops, its accepted triggers counted as
// seen rather than reacquired for, and the later subject stays pending for a pass that can claim.
it.effect("Claims/R3-S01: an owner whose factory stops claiming mid-pass ends, work pending", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const lifecycleScope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
          Scope.close(scope, exit),
        );
        const result = yield* ownerLosingClaim(lifecycleScope, "claimless");
        assert.strictEqual(result.type, "collected");
        assert.include(yield* pendingIssues, 6802);
      }),
    ),
  ),
);

// Modeled, not a deleted row: the SQL proxy returns no configuration rows after the hold.
it.effect(
  "Claims/R3-S01: an owner whose configuration reads come back empty mid-pass ends, work pending",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycleScope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
            Scope.close(scope, exit),
          );
          const result = yield* ownerLosingClaim(lifecycleScope, "modeledMissing");
          assert.strictEqual(result.type, "collected");
          assert.include(yield* pendingIssues, 6802);
        }),
      ),
    ),
);

// Custody 1: an ended foreground turn, a capability and an empty roster name no process the
// execution started, so together they prove nothing about whether its processes ended.

it.effect(
  "Custody/R1: a completed turn with an empty roster is not proof the execution ended",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureUncontainedRosterFactory(1);
        const worker = admittedExecution(yield* proposeCurrent("github:alpha#7101"));
        yield* completeLatestRun(worker.threadId);
        yield* setRoster(worker.threadId, []);
        assert.strictEqual((yield* custodyOf(worker.threadId)).state, "unknown");
      }),
    ),
);

it.effect("Custody/R2: a follow-up after a roster-empty completed turn starts nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureUncontainedRosterFactory(1);
        const worker = yield* startWorker("github:beta#7102");
        yield* completeLatestRun(worker.threadId);
        yield* sendUserMessage(worker.threadId, "roster-empty-follow-up");
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect("Custody/R2: a same-run restart after a roster-empty interrupt starts nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureUncontainedRosterFactory(1);
        const worker = yield* startWorker("github:beta#7103");
        yield* restartWorkerRun(worker);
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

// Requirement correction: this control first expected the later start to be refused. That refusal
// came from the scripted turn's late "running" report reopening the completed turn (custody read
// `run_active`), not from any rule. With the turn proved ended, a claimed contained execution's
// positively quiet predecessor lets one later start run, as the Spec/G1-S05 control does.
it.effect("Custody/R2 control: a claimed execution proved quiet takes one later start", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { execution } = yield* finishedWorkspaceExecution(
          7104,
          { type: "root" },
          { awaitStart: true },
        );
        assert.strictEqual((yield* custodyOfReservation(execution))?.state, "quiescent");
        const before = (yield* startedTurns).length;
        yield* startOutcome(sendUserMessage(execution.threadId, "after-roster-empty"));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, before + 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

// Custody 1, routine recovery of a held preparation (recording containment collaborator; the
// actual-process proofs of ended containers are in FactoryExecutionGenerations.test.ts).

const configureContainedClaimFactory = () =>
  configureFactory({
    pools: pool(1),
    claim: claimConfig,
    execution: {
      modelSelection: rosterSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  });

const generationStatesOf = (runId: RunId) =>
  Effect.flatMap(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) =>
    Effect.map(generations.generations(runId), (rows) => rows.map((row) => row.state)),
  );

it.effect(
  "Custody/A5a: a preparation lost after its intent recovers on the same run, claim and decision",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureContainedClaimFactory();
        yield* seedIssue(7301);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(7301, { type: "worktree", baseRef: "main" }),
        );
        // The container cannot be created, as for a host lost right after the intent committed.
        (yield* ContainmentFake).failNextHold = true;
        yield* runEffects;
        const run = yield* claimedRunOf(execution);
        assert.strictEqual(run.status, "failed");
        assert.strictEqual((yield* PreparationFake).worktrees.length, 0);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const claims = yield* FactoryClaimStore.FactoryClaimStore;
        assert.strictEqual(
          Option.getOrUndefined(yield* claims.get(reservationId))?.claim.state,
          "stale_after_claim",
        );
        const startedBefore = (yield* startedTurns).length;

        // The next collection pass proves the intent's container absent and recovers the run.
        yield* collectIssues([]);
        yield* runEffects;
        const recovered = yield* claimedRunOf(execution);
        assert.strictEqual(recovered.id, run.id);
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended", "held"]);
        const obligation = Option.getOrUndefined(yield* workspaceObligationOf(run.id));
        assert.strictEqual(obligation?.priorOwners?.length, 1);
        assert.strictEqual((yield* PreparationFake).worktrees.length, 1);
        // Same reservation and decision, now started: one provider turn, on the same thread.
        const started = yield* startedTurns;
        assert.strictEqual(started.length, startedBefore + 1);
        assert.strictEqual(started.at(-1)?.threadId, execution.threadId);
        const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
        assert.strictEqual(state.reservations.length, 1);
        assert.strictEqual(state.reservations[0]?.reservationId, reservationId);
      }),
    ),
);

it.effect(
  "Custody/A5a: a recovered preparation that fails again fails its run again and is held, not left preparing",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureContainedClaimFactory();
        yield* seedIssue(7302);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(7302, { type: "worktree", baseRef: "main" }),
        );
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const claims = yield* FactoryClaimStore.FactoryClaimStore;
        (yield* ContainmentFake).failNextHold = true;
        yield* runEffects;
        assert.strictEqual((yield* claimedRunOf(execution)).status, "failed");
        // The recovery's own container cannot be created either: the same run fails a second time.
        (yield* ContainmentFake).failNextHold = true;
        yield* collectIssues([]);
        yield* runEffects;
        const run = yield* claimedRunOf(execution);
        assert.strictEqual(run.status, "failed");
        assert.deepStrictEqual(
          Option.getOrUndefined(yield* claims.get(reservationId))?.claim.state,
          "stale_after_claim",
        );
        assert.strictEqual((yield* PreparationFake).worktrees.length, 0);
      }),
    ),
);

/** A claimed worktree preparation, held at `point`, then its host lost and the claim held. */
const preparationLostAt = (issueNumber: number, point: "worktree" | "setup") =>
  Effect.gen(function* () {
    yield* configureContainedClaimFactory();
    yield* seedIssue(issueNumber);
    const execution = admittedExecution(
      yield* proposeWithWorkspace(issueNumber, { type: "worktree", baseRef: "main" }),
    );
    yield* settleClaimOnly(execution);
    yield* retireNextEffect("effect:factory-claim.write:");
    const preparation = yield* PreparationFake;
    const reached = yield* Deferred.make<void>();
    const never = Effect.andThen(Deferred.succeed(reached, undefined), Effect.never);
    if (point === "worktree") preparation.duringWorktreeCreate = never;
    else {
      preparation.setup = {
        status: "started",
        scriptId: "setup",
        scriptName: "Setup",
        scriptCommand: "./setup",
        terminalId: "setup-terminal",
        cwd: "/workspace",
        async: false,
        completion: never.pipe(Effect.as({ exitCode: 0, durationMs: 0 })),
      };
    }
    const run = yield* claimedRunOf(execution);
    const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
    const claimService = yield* FactoryClaimService.FactoryClaimService;
    yield* Effect.forkScoped(claimService.prepareFirstUse({ reservationId, runId: run.id }));
    yield* Deferred.await(reached);
    yield* retireNextEffect("effect:factory-execution.prepare:");
    // The host is lost: its containers end, and a restarted owner never saw that preparation.
    yield* loseContainers;
    preparation.owner = "fresh";
    yield* claimService.prepareFirstUse({ reservationId, runId: run.id });
    return { execution, run, reservationId };
  });

it.effect.each([
  ["while its worktree was being created, before it was recorded", "worktree"],
  ["while its setup may have been running", "setup"],
] as const)("Custody/A5: a preparation lost %s is not repeated", ([, point]) =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { execution, run, reservationId } = yield* preparationLostAt(7310, point);
        const claims = yield* FactoryClaimStore.FactoryClaimStore;
        assert.strictEqual(
          Option.getOrUndefined(yield* claims.get(reservationId))?.claim.state,
          "stale_after_claim",
        );
        const worktrees = (yield* PreparationFake).worktrees.length;
        const startedBefore = (yield* startedTurns).length;
        // Its processes are gone, but what it may have done cannot be reconciled: held, not redone.
        yield* collectIssues([]);
        yield* runEffects;
        assert.strictEqual(
          Option.getOrUndefined(yield* claims.get(reservationId))?.claim.state,
          "stale_after_claim",
        );
        assert.strictEqual((yield* PreparationFake).worktrees.length, worktrees);
        assert.strictEqual((yield* startedTurns).length, startedBefore);
        assert.strictEqual((yield* claimedRunOf(execution)).id, run.id);
        assert.strictEqual(yield* occupied, 1);
        // Declined, not attempted: the obligation keeps its owner and no new container is intended.
        assert.isUndefined(
          Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.priorOwners,
        );
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended"]);
      }),
    ),
  ),
);

// A failed containment preparation can leave a verified claim on a cancelled run.

const prepareEffectIdOf = (runId: RunId) => `effect:factory-execution.prepare:${runId}`;

const effectOutcome = (effectId: string) =>
  Effect.map(
    Effect.flatMap(EffectOutbox.EffectOutboxV2, (outbox) => outbox.get(effectId)),
    (effect) => Option.map(effect, (found) => [found.status, found.attemptCount] as const),
  );

/**
 * A claimed, deferred-start execution on a host that can contain nothing: its own prepare effect
 * fails through the real worker until the worker gives up, with the run still preparing.
 */
const exhaustedPreparation = (issueNumber: number) =>
  Effect.gen(function* () {
    yield* configureContainedClaimFactory();
    yield* seedIssue(issueNumber);
    const execution = admittedExecution(
      yield* proposeWithWorkspace(issueNumber, { type: "worktree", baseRef: "main" }),
    );
    yield* settleClaimOnly(execution);
    yield* retireNextEffect("effect:factory-claim.write:");
    (yield* ContainmentFake).failIdentity = true;
    const run = yield* claimedRunOf(execution);
    // Each failure is retried after a backoff of under a second; the fifth is final.
    for (let attempt = 0; attempt < 5; attempt++) {
      yield* runEffects;
      yield* TestClock.adjust("1 second");
    }
    assert.deepStrictEqual(Option.getOrUndefined(yield* effectOutcome(prepareEffectIdOf(run.id))), [
      "failed",
      5,
    ]);
    assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
    return {
      execution,
      run,
      reservationId: FactoryReservationId.make(`reservation:${execution.commandId}`),
    };
  });

const claimStateOf = (reservationId: FactoryReservationId) =>
  Effect.gen(function* () {
    const claims = yield* FactoryClaimStore.FactoryClaimStore;
    const claim = Option.getOrThrow(yield* claims.get(reservationId)).claim;
    return {
      state: claim.state,
      runId: claim.state === "workspace_authorized" ? claim.runId : null,
      reason: "reason" in claim ? claim.reason : null,
    };
  });

it.effect.each([
  ["with a queued follow-up the user took back", true],
  ["on its own", false],
] as const)(
  "Custody/A5b: a run the old runtime's stop cancelled after its preparation was exhausted revives on the same run, attempt, claim and decision, %s",
  ([, queuedFollowUp]) =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId } = yield* exhaustedPreparation(7320);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        if (queuedFollowUp) {
          // A message queued behind the preparing run, which the user then takes back.
          yield* sendUserMessage(execution.threadId, "follow-up-7320");
          const queued = (yield* orchestrator.getThreadProjection(execution.threadId)).runs.find(
            (candidate) => candidate.status === "queued",
          )!;
          yield* orchestrator.dispatch({
            type: "queued-run.cancel",
            commandId: CommandId.make("command:cancel-queued:7320"),
            threadId: execution.threadId,
            runId: queued.id,
          });
        }
        const runIds = (yield* orchestrator.getThreadProjection(execution.threadId)).runs.map(
          (candidate) => candidate.id,
        );
        // The synthetic host stops: its finalizer cancels the preparing run, since no live effect
        // owns it, and leaves the claim, the reservation and the exhausted effect as they are.
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        yield* recovery.reconcile("shutdown");
        assert.deepStrictEqual(
          yield* runStatuses(execution.threadId),
          runIds.map(() => "cancelled"),
        );
        assert.strictEqual((yield* claimStateOf(reservationId)).state, "verified");
        assert.deepStrictEqual(
          Option.getOrUndefined(yield* effectOutcome(prepareEffectIdOf(run.id))),
          ["failed", 5],
        );
        assert.isTrue(Option.isNone(yield* workspaceObligationOf(run.id)));
        assert.deepStrictEqual(yield* generationStatesOf(run.id), []);
        assert.strictEqual(yield* occupied, 1);
        const startedBefore = (yield* startedTurns).length;
        const postsBefore = yield* commentPosts;

        // Hours pass before the new runtime starts, far outside the admission window, on a host
        // that builds its helper: its startup reconciliation finds nothing live to cancel, and its
        // first lifecycle pass gives the claim one replay.
        yield* TestClock.adjust("2 hours");
        (yield* ContainmentFake).failIdentity = false;
        yield* recovery.recover;
        yield* collectIssues([], "restart");
        yield* runEffects;

        const revived = yield* orchestrator.getThreadProjection(execution.threadId);
        assert.deepStrictEqual(
          revived.runs.map((candidate) => candidate.id),
          runIds,
        );
        const first = revived.runs.find((candidate) => candidate.id === run.id)!;
        assert.strictEqual(first.activeAttemptId, run.activeAttemptId);
        assert.include(["starting", "running"], first.status);
        for (const other of revived.runs.filter((candidate) => candidate.id !== run.id)) {
          assert.strictEqual(other.status, "cancelled");
        }
        assert.deepStrictEqual(yield* claimStateOf(reservationId), {
          state: "workspace_authorized",
          runId: run.id,
          reason: null,
        });
        assert.strictEqual(
          Option.getOrThrow(yield* workspaceObligationOf(run.id)).reservationId,
          reservationId,
        );
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["held"]);
        // The provider joined the revived run's own container, not one made for the follow-up
        // the user took back: that run never executed and gets no generation of its own.
        const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
        assert.strictEqual((yield* generations.generations(run.id))[0]?.providerJoins, 1);
        for (const other of revived.runs.filter((candidate) => candidate.id !== run.id)) {
          assert.deepStrictEqual(yield* generationStatesOf(other.id), []);
        }
        assert.strictEqual((yield* PreparationFake).worktrees.length, 1);
        const started = yield* startedTurns;
        assert.strictEqual(started.length, startedBefore + 1);
        assert.strictEqual(started.at(-1)?.threadId, execution.threadId);
        // No second claim, no second reservation; the exhausted effect stays as history and the
        // replay has an id of its own.
        assert.strictEqual(yield* commentPosts, postsBefore);
        assert.strictEqual(yield* occupied, 1);
        assert.deepStrictEqual(
          Option.getOrUndefined(yield* effectOutcome(prepareEffectIdOf(run.id))),
          ["failed", 5],
        );
        const replays = yield* outbox.listByCommandId(
          CommandId.make(`factory-recovery-check:${run.id}`),
        );
        assert.deepStrictEqual(
          replays.map((replay) => replay.status),
          ["succeeded"],
        );
        assert.isTrue(replays[0]!.id.startsWith(`${prepareEffectIdOf(run.id)}:replay:`));
        const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
        assert.deepStrictEqual(
          state.reservations.map((reservation) => reservation.reservationId),
          [reservationId],
        );
      }),
    ),
);

/** One run's generation records as stored: facts a closure may end but never rewrites. */
const generationFactsOf = (runId: RunId) =>
  Effect.flatMap(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) =>
    Effect.map(generations.generations(runId), (rows) =>
      rows.map((row) => ({
        generationId: row.generationId,
        runId: row.runId,
        state: row.state,
        providerJoins: row.providerJoins,
        providerSessions: row.providerSessions,
      })),
    ),
  );

const reservationOf = (reservationId: FactoryReservationId) =>
  Effect.map(
    Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
      factory.readState({ factoryId }),
    ),
    (state) =>
      state.reservations.find((reservation) => reservation.reservationId === reservationId),
  );

/**
 * A synthetic recovery state: the revived run's provider was bound
 * to the container of the queued follow-up the user took back. The execution's own container is
 * empty and never joined, while its sibling of the same reservation and thread holds the worker.
 */
const misboundRevival = (issueNumber: number, join: "sibling" | "none" = "sibling") =>
  Effect.gen(function* () {
    const { execution, run, reservationId } = yield* exhaustedPreparation(issueNumber);
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* sendUserMessage(execution.threadId, `follow-up-${issueNumber}`);
    const queued = (yield* orchestrator.getThreadProjection(execution.threadId)).runs.find(
      (candidate) => candidate.status === "queued",
    )!;
    yield* orchestrator.dispatch({
      type: "queued-run.cancel",
      commandId: CommandId.make(`command:cancel-queued:${issueNumber}`),
      threadId: execution.threadId,
      runId: queued.id,
    });
    const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
    yield* recovery.reconcile("shutdown");
    yield* TestClock.adjust("2 hours");
    (yield* ContainmentFake).failIdentity = false;
    const target = yield* ScriptedJoinTarget;
    // The provider joined none of the revived run's containers.
    target.skip = true;
    // The revived turn's own "running" report lands before a test completes the run.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const running = yield* awaitRunningTurn(execution.threadId);
        yield* recovery.recover;
        yield* collectIssues([], "restart");
        yield* runEffects;
        yield* Fiber.join(running);
      }),
    );
    target.skip = false;
    const statuses = yield* runStatuses(execution.threadId);
    assert.include(["starting", "running"], statuses[0]);
    assert.strictEqual(statuses[1], "cancelled");
    const own = yield* generationFactsOf(run.id);
    assert.strictEqual(own.length, 1);
    assert.strictEqual(own[0]!.state, "held");
    assert.strictEqual(own[0]!.providerJoins, undefined);
    if (join === "sibling") {
      // Its binding, as the rows record it: the provider process was admitted to a container
      // the earlier synthetic turn opened for the cancelled follow-up, with no session named.
      const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
      yield* generations.ensureHeld({
        runId: queued.id,
        reservationId,
        threadId: execution.threadId,
      });
      yield* (yield* generations.joinFor(queued.id)("scripted-provider", [], "provider")).admit(1);
    }
    const sibling = yield* generationFactsOf(queued.id);
    if (join === "sibling") {
      assert.strictEqual(sibling.length, 1);
      assert.strictEqual(sibling[0]!.state, "held");
      assert.strictEqual(sibling[0]!.providerJoins, 1);
      assert.strictEqual(sibling[0]!.providerSessions, undefined);
    } else {
      assert.deepStrictEqual(sibling, []);
    }
    return { execution, run, queued, reservationId, sibling: sibling[0] };
  });

it.effect(
  "Custody/A6: a provider bound to the cancelled follow-up's container of its own execution settles once every container of the execution is quiet",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, queued, reservationId, sibling } = yield* misboundRevival(7330);
        // The worker's processes live in the sibling container: the execution is live, not
        // unknown for its own empty container, and nothing settles or starts here.
        yield* setGenerationMembers(queued.id, 3);
        yield* completeLatestRun(execution.threadId, "completed", run.id);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["contained_processes"],
        });
        yield* recordCommit("b7330000", []);
        yield* recordCommit("c7330001", ["b7330000"]);
        const reported = yield* reportFrom(execution.threadId, {
          outcome: "implemented",
          subject: subjectFor("c7330001", "b7330000"),
          summary: "Implemented 7330.",
        });
        assert.strictEqual(reported.state, "reported");
        yield* collectIssues([], "outcome");
        yield* runEffects;
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.strictEqual(yield* occupied, 1);
        // The worker exits. Every container of the reservation and thread is quiet and the
        // provider did join one of them, so the execution is proved quiet and settles.
        yield* setGenerationMembers(queued.id, 0);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["contained_quiet"],
        });
        yield* collectIssues([], "outcome");
        yield* runEffects;
        const released = yield* reservationOf(reservationId);
        assert.deepStrictEqual(
          [released?.state, released?.releasedReason],
          ["released", "outcome_verified"],
        );
        // Both generation facts stand in the synthetic recovery state.
        assert.deepStrictEqual(yield* generationFactsOf(queued.id), [sibling]);
        assert.strictEqual((yield* generationFactsOf(run.id))[0]?.providerJoins, undefined);
      }),
    ),
);

it.effect(
  "Custody/A6: only a quiet or ended container of the same reservation and thread certifies the execution; an unrelated join or an unverified sibling does not",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, queued, reservationId } = yield* misboundRevival(7331, "none");
        yield* completeLatestRun(execution.threadId, "completed", run.id);
        const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
        const fake = yield* ContainmentFake;
        const unknown = { state: "unknown", reasons: ["process_containment_unsupported"] } as const;
        // Its own container is empty and no provider joined any container of this execution.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), unknown);
        // A provider that joined a container of another reservation on this thread is not this
        // execution's provider.
        const unrelated = RunId.make(`${run.id}:unrelated`);
        yield* generations.ensureHeld({
          runId: unrelated,
          reservationId: FactoryReservationId.make(`${reservationId}:other`),
          threadId: execution.threadId,
        });
        yield* (yield* generations.joinFor(unrelated)("scripted-provider", [], "provider")).admit(
          5,
        );
        assert.deepStrictEqual(yield* custodyOfReservation(execution), unknown);
        // The synthetic recovery binding: the provider joined the cancelled follow-up's container
        // of this very reservation and thread. That is positive proof, once it is quiet.
        yield* generations.ensureHeld({
          runId: queued.id,
          reservationId,
          threadId: execution.threadId,
        });
        yield* (yield* generations.joinFor(queued.id)("scripted-provider", [], "provider")).admit(
          6,
        );
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["contained_quiet"],
        });
        // A sibling container of the execution that another host holds and that still reads
        // active is unverified: nothing settles until it is proved gone.
        const foreign = {
          generationId: `foreign-${run.id}`,
          runId: queued.id,
          reservationId,
          threadId: execution.threadId,
          name: `Local\\t3-custody-foreign-${run.id}`,
          identity: { machine: "test-machine", session: 1 },
          ownerHost: "another-host",
          openedAt: "2026-10-25T12:00:00.000Z",
          state: "held",
          heldAt: "2026-10-25T12:00:00.000Z",
        };
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO factory_execution_generations (
            generation_id, run_id, reservation_id, thread_id, state, record_json
          ) VALUES (
            ${foreign.generationId}, ${foreign.runId}, ${foreign.reservationId},
            ${foreign.threadId}, 'held', ${JSON.stringify(foreign)}
          )
        `;
        fake.members.set(foreign.name, 1);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["container_unverified", "process_containment_unsupported"],
        });
        // Its host lost it: the probe proves it gone, and the execution settles again.
        fake.members.delete(foreign.name);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["contained_quiet", "descendants_ended"],
        });
      }),
    ),
);

/**
 * alpha #69's shape: the provider turn ended while its focused tests and their monitor kept running
 * inside the provider's own contained process.
 */
const backgroundExecution = (issueNumber: number) =>
  Effect.gen(function* () {
    const { execution, run } = yield* finishedWorkspaceExecution(
      issueNumber,
      { type: "root" },
      { awaitStart: true },
    );
    yield* setRoster(execution.threadId, [
      { taskId: "bjuvxz3km", kind: "background_task" },
      { taskId: "bwogu8a1y", kind: "background_task" },
    ]);
    yield* setContainedMembers(execution.threadId, 2);
    assert.deepStrictEqual(yield* custodyOfReservation(execution), {
      state: "live",
      reasons: ["background_work", "contained_processes"],
    });
    const projection = yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(
      execution.threadId,
    );
    return {
      execution,
      run,
      reservationId: FactoryReservationId.make(`reservation:${execution.commandId}`),
      sessionId: projection.providerThreads[0]!.providerSessionId!,
    };
  });

const runOrdinal = (threadId: ThreadId, ordinal: number) =>
  Effect.map(
    Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.getThreadProjection(threadId),
    ),
    (projection) => projection.runs.find((candidate) => candidate.ordinal === ordinal)!,
  );

const signalItemsOf = (threadId: ThreadId, runId: RunId) =>
  Effect.map(
    Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.getThreadProjection(threadId),
    ),
    (projection) =>
      projection.turnItems
        .filter((item) => item.runId === runId && item.type === "error")
        .map((item) => item.id),
  );

it.effect(
  "Custody/C3: a background completion wake continues its own execution inside the live provider's container",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, sessionId } = yield* backgroundExecution(7340);
        const [own] = yield* generationFactsOf(run.id);
        assert.deepStrictEqual(
          [own?.state, own?.providerJoins, own?.providerSessions],
          ["held", 1, [sessionId]],
        );
        const startedBefore = (yield* startedTurns).length;
        // The monitor finishes: its notification leaves the roster, and the CLI re-invokes the
        // model in the same process; the server records that wake as a provider continuation.
        yield* setRoster(execution.threadId, [{ taskId: "bjuvxz3km", kind: "background_task" }]);
        // The scripted turn's own "running" report lands before the run is completed below.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const running = yield* awaitRunningTurn(execution.threadId);
            yield* dispatchProviderContinuation(execution.threadId, "wake-7340");
            yield* runEffects;
            yield* Fiber.join(running);
          }),
        );
        const wake = yield* runOrdinal(execution.threadId, 2);
        assert.include(["starting", "running"], wake.status);
        const started = yield* startedTurns;
        assert.strictEqual(started.length, startedBefore + 1);
        assert.strictEqual(started.at(-1)?.runId, wake.id);
        // It runs in the session's process: no container of its own, and the execution's is as
        // it was.
        assert.deepStrictEqual(yield* generationFactsOf(wake.id), []);
        assert.deepStrictEqual(yield* generationFactsOf(run.id), [own]);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["run_active", "background_work", "contained_processes"],
        });
        yield* completeLatestRun(execution.threadId);
        // The same notification offered twice is the same continuation, not new work.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const running = yield* awaitRunningTurn(execution.threadId);
            yield* dispatchProviderContinuation(execution.threadId, "wake-7340-again");
            yield* runEffects;
            yield* Fiber.join(running);
          }),
        );
        const again = yield* runOrdinal(execution.threadId, 3);
        assert.include(["starting", "running"], again.status);
        assert.deepStrictEqual(yield* generationFactsOf(again.id), []);
        yield* completeLatestRun(execution.threadId);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), [
          "completed",
          "completed",
          "completed",
        ]);
        // Closure stays unproven while the tests run, and while their processes remain.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["background_work", "contained_processes"],
        });
        assert.strictEqual(yield* occupied, 1);
        yield* setRoster(execution.threadId, []);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["contained_processes"],
        });
        // Every turn ran in the session whose provider joined this container: once it is empty,
        // the whole execution is proved quiet.
        yield* setContainedMembers(execution.threadId, 0);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["contained_quiet"],
        });
        assert.deepStrictEqual(yield* generationFactsOf(run.id), [own]);
      }),
    ),
);

/**
 * beta #14's shape: a background wake continued in the session's process, checkpoint capture then
 * held an empty container for the wake's run, and the session's exit ended both containers.
 */
const endedWakeExecution = (issueNumber: number, options: { readonly secondJoin?: boolean } = {}) =>
  Effect.gen(function* () {
    const { execution, run, sessionId } = yield* backgroundExecution(issueNumber);
    yield* setRoster(execution.threadId, [{ taskId: "bjuvxz3km", kind: "background_task" }]);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const running = yield* awaitRunningTurn(execution.threadId);
        yield* dispatchProviderContinuation(execution.threadId, `wake-${issueNumber}`);
        yield* runEffects;
        yield* Fiber.join(running);
      }),
    );
    const wake = yield* runOrdinal(execution.threadId, 2);
    assert.deepStrictEqual(yield* generationFactsOf(wake.id), []);
    yield* completeLatestRun(execution.threadId);
    // Turn-end checkpoint Git joins the thread's current run, which is the wake's.
    assert.isTrue(
      Option.isSome(yield* (yield* ExecutionJoin.ExecutionJoin).forThread(execution.threadId)),
    );
    const [late] = yield* generationFactsOf(wake.id);
    assert.deepStrictEqual([late?.state, late?.providerJoins], ["held", undefined]);
    yield* setRoster(execution.threadId, []);
    if (options.secondJoin === true) {
      // A second provider process joined the same container: which one ran the wake is not shown.
      const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
      yield* (yield* generations.joinFor(run.id)("scripted-provider", [], "provider")).admit(9);
    }
    // The session stops: its process exits and both containers are proved gone.
    yield* loseContainers;
    return { execution, run, wake, sessionId };
  });

it.effect(
  "Custody/C3: a wake that continued in its session's process is proved ended once that process's container ends",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, wake, sessionId } = yield* endedWakeExecution(7343);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["descendants_ended"],
        });
        // Ending a container keeps which session's process it held.
        const [own] = yield* generationFactsOf(run.id);
        assert.deepStrictEqual(
          [own?.state, own?.providerJoins, own?.providerSessions],
          ["ended", 1, [sessionId]],
        );
        const [late] = yield* generationFactsOf(wake.id);
        assert.deepStrictEqual([late?.state, late?.providerJoins], ["ended", undefined]);
      }),
    ),
);

/** One run's ended container as an earlier runtime recorded it, without its sessions. */
const asEndedBeforeSessionsWereKept = (
  runId: RunId,
  times: { readonly openedAt?: string; readonly endedAt?: string } = {},
) =>
  Effect.gen(function* () {
    // Observed gone first, so the ended record exists as a custody read leaves it.
    yield* (yield* FactoryExecutionGenerations.FactoryExecutionGenerations).observe([runId]);
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly generation_id: string; readonly record_json: string }>`
      SELECT generation_id, record_json FROM factory_execution_generations
      WHERE run_id = ${runId} AND state = 'ended'
    `;
    assert.strictEqual(rows.length, 1);
    const { providerSessions: _sessions, ...kept } = JSON.parse(rows[0]!.record_json) as Record<
      string,
      unknown
    >;
    yield* sql`
      UPDATE factory_execution_generations
      SET record_json = ${JSON.stringify({ ...kept, ...times })}
      WHERE generation_id = ${rows[0]!.generation_id}
    `;
  });

it.effect(
  "Custody/C3: a wake whose session's ended container lost its session is attributed by the execution's one provider join",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* endedWakeExecution(7344);
        yield* asEndedBeforeSessionsWereKept(run.id);
        const [own] = yield* generationFactsOf(run.id);
        assert.deepStrictEqual([own?.providerJoins, own?.providerSessions], [1, undefined]);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["descendants_ended"],
        });
      }),
    ),
);

it.effect(
  "Custody/C3: a second provider join leaves a wake on its container with no session unattributed",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* endedWakeExecution(7345, { secondJoin: true });
        yield* asEndedBeforeSessionsWereKept(run.id);
        const [own] = yield* generationFactsOf(run.id);
        assert.deepStrictEqual([own?.providerJoins, own?.providerSessions], [2, undefined]);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
      }),
    ),
);

it.effect.each(["ended before the wake's turn completed", "opened after the wake started"])(
  "Custody/C3: a wake is not attributed to a container with no session that %s",
  (shape) =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, wake } = yield* endedWakeExecution(7346);
        const projection = yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(
          execution.threadId,
        );
        const attempt = projection.attempts.find((candidate) => candidate.runId === wake.id)!;
        const turn = projection.providerTurns.find(
          (candidate) => candidate.runAttemptId === attempt.id,
        )!;
        const shifted = (at: DateTime.Utc, millis: number) =>
          DateTime.formatIso(DateTime.add(at, { milliseconds: millis }));
        yield* asEndedBeforeSessionsWereKept(
          run.id,
          shape === "opened after the wake started"
            ? { openedAt: shifted(attempt.startedAt!, 1) }
            : { endedAt: shifted(turn.completedAt!, -1) },
        );
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
      }),
    ),
);

it.effect(
  "Custody/C3: a wake is refused while the execution's live processes are not proved to be its session's",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId } = yield* backgroundExecution(7341);
        const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
        const startedBefore = (yield* startedTurns).length;
        // A container of this execution holds processes of a session that is not the wake's.
        const stray = RunId.make(`${run.id}:stray`);
        yield* generations.ensureHeld({
          runId: stray,
          reservationId,
          threadId: execution.threadId,
        });
        yield* (yield* generations.joinFor(stray, { providerSessionId: "session:other" })(
          "scripted-provider",
          [],
          "provider",
        )).admit(9);
        yield* setGenerationMembers(stray, 1);
        yield* setGenerationMembers(run.id, 0);
        yield* setRoster(execution.threadId, []);
        yield* dispatchProviderContinuation(execution.threadId, "wake-7341");
        yield* runEffects;
        const wake = yield* runOrdinal(execution.threadId, 2);
        assert.strictEqual(wake.status, "failed");
        assert.strictEqual(wake.startedAt, null);
        assert.deepStrictEqual(yield* signalItemsOf(execution.threadId, wake.id), [
          `turn-item:run:${encodeURIComponent(wake.id)}:signal:factory-custody-unknown`,
        ]);
        assert.strictEqual((yield* startedTurns).length, startedBefore);
        assert.deepStrictEqual(yield* generationFactsOf(wake.id), []);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["contained_processes"],
        });
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect(
  "Custody/C3: a wake is refused when the execution's container never recorded which session its provider was",
  () =>
    runIsolated(
      Effect.gen(function* () {
        // The synthetic provider joined without a session: its rows prove a provider joined, not
        // which one.
        (yield* ScriptedJoinTarget).legacy = true;
        const { execution, run } = yield* backgroundExecution(7342);
        const [own] = yield* generationFactsOf(run.id);
        assert.deepStrictEqual([own?.providerJoins, own?.providerSessions], [1, undefined]);
        const startedBefore = (yield* startedTurns).length;
        yield* dispatchProviderContinuation(execution.threadId, "wake-7342");
        yield* runEffects;
        const wake = yield* runOrdinal(execution.threadId, 2);
        assert.strictEqual(wake.status, "failed");
        assert.strictEqual(wake.startedAt, null);
        assert.strictEqual((yield* startedTurns).length, startedBefore);
        assert.deepStrictEqual(yield* generationFactsOf(wake.id), []);
        assert.deepStrictEqual(yield* generationFactsOf(run.id), [own]);
      }),
    ),
);

it.effect(
  "Custody/C4: a background wake the fence refused is delivered again exactly once, when its execution is proved quiet",
  () =>
    runIsolated(
      Effect.gen(function* () {
        (yield* ScriptedJoinTarget).legacy = true;
        const { execution, run } = yield* backgroundExecution(7350);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        yield* dispatchProviderContinuation(execution.threadId, "wake-7350");
        yield* runEffects;
        const refused = yield* runOrdinal(execution.threadId, 2);
        assert.strictEqual(refused.status, "failed");
        // A message of the user's that the fence refused is theirs to send again, not T3's.
        yield* sendUserMessage(execution.threadId, "user-7350");
        yield* runEffects;
        assert.strictEqual((yield* runOrdinal(execution.threadId, 3)).status, "failed");
        const startedBefore = (yield* startedTurns).length;
        assert.deepStrictEqual(yield* signalItemsOf(execution.threadId, refused.id), [
          `turn-item:run:${encodeURIComponent(refused.id)}:signal:factory-custody-unknown`,
        ]);
        const refusedMessage = (yield* orchestrator.getThreadProjection(
          execution.threadId,
        )).messages.find((message) => message.id === refused.userMessageId);
        assert.deepStrictEqual(
          [refusedMessage?.createdBy, refusedMessage?.creationSource],
          ["agent", "provider"],
        );
        // While the execution is live nothing is delivered, however many passes run.
        yield* collectIssues([], "restart");
        yield* runEffects;
        assert.strictEqual(yield* runCount(execution.threadId), 3);
        // The runtime restarts: the worker's container is proved gone, the refused wake never
        // started a provider, so the execution is quiet and the wake is owed to it.
        yield* loseContainers;
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["descendants_ended"],
        });
        yield* collectIssues([], "restart");
        yield* runEffects;
        assert.strictEqual(yield* runCount(execution.threadId), 4);
        const delivered = yield* runOrdinal(execution.threadId, 4);
        const projection = yield* orchestrator.getThreadProjection(execution.threadId);
        const original = projection.messages.find(
          (message) => message.id === refused.userMessageId,
        )!;
        const redelivered = projection.messages.find(
          (message) => message.id === delivered.userMessageId,
        )!;
        assert.strictEqual(redelivered.text, original.text);
        assert.deepStrictEqual(redelivered.notification, original.notification);
        assert.deepStrictEqual(
          [redelivered.createdBy, redelivered.creationSource],
          ["agent", "server"],
        );
        assert.include(["starting", "running"], delivered.status);
        assert.strictEqual((yield* startedTurns).length, startedBefore + 1);
        assert.deepStrictEqual(yield* generationStatesOf(delivered.id), ["held"]);
        // Once only: another pass delivers nothing more, and the refused runs stay as they were.
        yield* collectIssues([], "restart");
        yield* runEffects;
        assert.strictEqual(yield* runCount(execution.threadId), 4);
        assert.strictEqual((yield* runOrdinal(execution.threadId, 2)).status, "failed");
        assert.strictEqual((yield* runOrdinal(execution.threadId, 3)).status, "failed");
        assert.deepStrictEqual(yield* signalItemsOf(execution.threadId, refused.id), [
          `turn-item:run:${encodeURIComponent(refused.id)}:signal:factory-custody-unknown`,
        ]);
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended"]);
      }),
    ),
);

/** The staged policy with every later worker stage bound to a worktree, as alpha's review and rework are. */
const stageRequestInWorktrees = (input: ProposeInput) =>
  Effect.map(stageRequest(input), (decision) =>
    decision !== undefined && "taskKind" in decision && decision.taskKind !== "implement"
      ? { ...decision, workspaceStrategy: { type: "worktree" as const, baseRef: "main" } }
      : decision,
  );

/**
 * An implement stage reported, and its review admitted into a worktree of its own. The review
 * runs under the implement decision's claim and makes none of its own; its run waits in
 * `preparing` for the factory to prepare that worktree.
 */
const reviewInWorktree = (issueNumber: number, retained = false) =>
  Effect.gen(function* () {
    const graph = yield* GitGraphFake;
    graph.parents.set(lifecycleBase, []);
    graph.branches.set("main", lifecycleBase);
    yield* usePolicy(stageRequestInWorktrees);
    yield* configureFactory(lifecycleConfiguration());
    yield* seedIssue(issueNumber);
    const implement = admittedBy(yield* advance("tracker_event", 1));
    const head = `c${issueNumber}001`;
    yield* recordCommit(head, [lifecycleBase]);
    yield* Effect.scoped(
      workStage(implement, {
        outcome: "implemented",
        subject: subjectFor(head, lifecycleBase),
        summary: `Implemented ${issueNumber}.`,
      }),
    );
    // Passes until the review is admitted, running every effect before it; its own prepare
    // effect is left queued. With `retained`, that effect is removed instead, as a recovering
    // runtime's no-op left #75's rework: preparing, with no owner, obligation or container.
    for (let round = 0; round < 6; round++) {
      const admissions = yield* reconcileFactory(round === 0 ? "outcome" : "operation");
      const review = admissions.find((admission) => admission.type === "admitted");
      if (review === undefined) {
        yield* runEffects;
        continue;
      }
      assert.deepStrictEqual(stageOf(review), [itemKeyFor(issueNumber), "review"]);
      const execution = admittedExecution(review);
      const run = yield* claimedRunOf(execution);
      assert.strictEqual(run.status, "preparing");
      assert.isDefined(run.workspacePreparation);
      if (retained) {
        const sql = yield* SqlClient.SqlClient;
        const removed = yield* sql<{ readonly status: string }>`
          DELETE FROM orchestration_v2_effect_outbox
          WHERE effect_id LIKE ${`effect:factory-execution.prepare:${run.id}%`}
          RETURNING status
        `;
        assert.deepStrictEqual(
          removed.map((row) => row.status),
          ["pending"],
        );
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
      }
      return { execution, run, worktreesBefore: (yield* PreparationFake).worktrees.length };
    }
    return assert.fail("the review was never admitted");
  });

const preparedAndStarted = (
  execution: { readonly threadId: ThreadId },
  run: { readonly id: RunId; readonly activeAttemptId: string | null },
  worktreesBefore: number,
) =>
  Effect.gen(function* () {
    const current = (yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(
      execution.threadId,
    )).runs.find((candidate) => candidate.id === run.id)!;
    assert.include(["starting", "running"], current.status);
    assert.strictEqual(current.activeAttemptId, run.activeAttemptId);
    assert.strictEqual((yield* PreparationFake).worktrees.length, worktreesBefore + 1);
    const obligation = Option.getOrUndefined(yield* workspaceObligationOf(run.id));
    assert.strictEqual(obligation?.state, "settled");
    assert.strictEqual(obligation?.threadId, execution.threadId);
    assert.deepStrictEqual(yield* generationStatesOf(run.id), ["held"]);
    assert.strictEqual((yield* startedTurns).at(-1)?.threadId, execution.threadId);
  });

it.effect(
  "Stages/W1: a later stage bound to a worktree prepares it under the owning claim and starts",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, worktreesBefore } = yield* reviewInWorktree(7400);
        yield* runEffects;
        yield* preparedAndStarted(execution, run, worktreesBefore);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["run_active"],
        });
      }),
    ),
);

it.effect(
  "Stages/W1: a later stage the runtime left preparing with nothing owning it is prepared by the next pass",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, worktreesBefore } = yield* reviewInWorktree(7401, true);
        yield* runEffects;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
        assert.isTrue(Option.isNone(yield* workspaceObligationOf(run.id)));
        assert.deepStrictEqual(yield* generationStatesOf(run.id), []);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["run_active"],
        });
        const startedBefore = (yield* startedTurns).length;
        yield* reconcileFactory("operation");
        yield* runEffects;
        yield* preparedAndStarted(execution, run, worktreesBefore);
        assert.strictEqual((yield* startedTurns).length, startedBefore + 1);
        const replays = yield* (yield* EffectOutbox.EffectOutboxV2).listByCommandId(
          CommandId.make(`factory-recovery-check:${run.id}`),
        );
        assert.deepStrictEqual(
          replays.map((replay) => replay.status),
          ["succeeded"],
        );
      }),
    ),
);

it.effect(
  "Stages/W1: a later stage's run a runtime stop cancelled while nothing owned it revives on the same run and attempt",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, worktreesBefore } = yield* reviewInWorktree(7402, true);
        yield* runEffects;
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        yield* recovery.reconcile("shutdown");
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
        yield* recovery.recover;
        yield* reconcileFactory("restart");
        yield* runEffects;
        yield* preparedAndStarted(execution, run, worktreesBefore);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect(
  "Stages/W1: a later stage's preparing run the user interrupted is left as they left it",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, worktreesBefore } = yield* reviewInWorktree(7403, true);
        yield* runEffects;
        yield* (yield* Orchestrator.OrchestratorV2).dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("command:interrupt:7403"),
          threadId: execution.threadId,
          runId: run.id,
        });
        const startedBefore = (yield* startedTurns).length;
        yield* reconcileFactory("operation");
        yield* runEffects;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["interrupted"]);
        assert.strictEqual((yield* PreparationFake).worktrees.length, worktreesBefore);
        assert.strictEqual((yield* startedTurns).length, startedBefore);
        assert.isTrue(Option.isNone(yield* workspaceObligationOf(run.id)));
      }),
    ),
);

it.effect(
  "Stages/W1: a later stage whose worktree branch already exists never started, and fails once instead of holding its pool",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* reviewInWorktree(7404);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        // The branch appeared after admission read the repository, as BTC #14's earlier unit's did.
        const preparation = yield* PreparationFake;
        preparation.worktreeCreateFailure = new GitCommandError({
          operation: "GitVcsDriver.createWorktree",
          command: "git worktree add",
          cwd: "/repo",
          detail: "git worktree add failed",
          reason: "branch_already_exists",
        });
        const startedBefore = (yield* startedTurns).length;
        yield* runEffects;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        assert.strictEqual(
          Option.getOrUndefined(yield* workspaceObligationOf(run.id))?.state,
          "settled",
        );
        assert.strictEqual((yield* startedTurns).length, startedBefore);
        // The run's own failure item, with no launch, is the runtime's record that nothing ran.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["never_started"],
        });
        preparation.worktreeCreateFailure = undefined;
        // A restart, then the passes after it: the stage fails once, on its own record.
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        yield* advance("restart");
        const released = yield* reservationOf(reservationId);
        assert.deepStrictEqual(
          [released?.state, released?.releasedReason],
          ["released", "outcome_verified"],
        );
        const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
        const [failed, ...more] = yield* outcomes.listForOrigin(reservationId);
        assert.deepStrictEqual(more, []);
        assert.strictEqual(failed?.report.outcome, "failed");
        assert.include(failed?.report.failure, "branch_already_exists");
        // The failed run itself is never prepared or started again.
        yield* advance("operation", 2);
        assert.strictEqual((yield* outcomes.listForOrigin(reservationId)).length, 1);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        assert.isFalse(
          (yield* startedTurns).some((started) => started.threadId === execution.threadId),
        );
      }),
    ),
);

it.effect(
  "Stages/W1: a client's retry of a later stage whose preparation failed is refused, held or released",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* reviewInWorktree(7405);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const preparation = yield* PreparationFake;
        preparation.worktreeCreateFailure = new GitCommandError({
          operation: "GitVcsDriver.createWorktree",
          command: "git worktree add",
          cwd: "/repo",
          detail: "git worktree add failed",
          reason: "branch_already_exists",
        });
        yield* runEffects;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        const worktreesAfterFailure = preparation.worktrees.length;
        // Accepted, the retry would run git and setup with no obligation or container, and fail
        // again on the same run; the settled obligation would then vouch for work it never saw.
        const retry = (attempt: string) =>
          Effect.flatMap(ThreadLaunchService.ThreadLaunchService, (launches) =>
            Effect.exit(
              launches.retryPreparation({
                commandId: CommandId.make(`command:retry:${run.id}:${attempt}`),
                threadId: execution.threadId,
                runId: run.id,
              }),
            ),
          );
        assert.isTrue(Exit.isFailure(yield* retry("held")));
        yield* runEffects;
        assert.strictEqual(preparation.worktrees.length, worktreesAfterFailure);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["never_started"],
        });
        yield* advance("operation");
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "released");
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        // The passes may admit the item's next stage elsewhere; only this thread's retry counts.
        const worktreesAfterRelease = preparation.worktrees.length;
        assert.isTrue(Exit.isFailure(yield* retry("released")));
        yield* runEffects;
        assert.strictEqual(preparation.worktrees.length, worktreesAfterRelease);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
      }),
    ),
);

/**
 * The stage's records as the process that wrote them leaves them to the next one: its admission
 * and obligation name that earlier process, or nothing at all when a build before this one did.
 * Only a name the build already wrote is replaced; an older build refuses an obligation field it
 * does not know.
 */
const fromEarlierProcess = (
  reservationId: FactoryReservationId,
  runId: RunId,
  servingId: string | undefined,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const restamp = (record: Record<string, unknown>, field: string) => {
      if (!(field in record)) return record;
      const { [field]: _written, ...rest } = record;
      return servingId === undefined ? rest : { ...rest, [field]: servingId };
    };
    const [reservation] = yield* sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_reservations WHERE reservation_id = ${reservationId}
    `;
    yield* sql`
      UPDATE factory_reservations
      SET record_json = ${JSON.stringify(restamp(JSON.parse(reservation!.record_json), "admittedIn"))}
      WHERE reservation_id = ${reservationId}
    `;
    const [obligation] = yield* sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_workspace_obligations WHERE run_id = ${runId}
    `;
    yield* sql`
      UPDATE factory_workspace_obligations
      SET record_json = ${JSON.stringify(restamp(JSON.parse(obligation!.record_json), "openedIn"))}
      WHERE run_id = ${runId}
    `;
  });

/**
 * Runs `effect` as a build without the launch fence would, as c4fc8389 does: the thread's factory
 * binding unseen. The fence is the launch service's only change, so the path is otherwise exact.
 */
const asUnfencedRuntime = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [binding] = yield* sql<{ readonly reservation_id: string }>`
      SELECT reservation_id FROM factory_thread_bindings WHERE thread_id = ${threadId}
    `;
    yield* sql`DELETE FROM factory_thread_bindings WHERE thread_id = ${threadId}`;
    return yield* effect.pipe(
      Effect.ensuring(
        sql`
          INSERT INTO factory_thread_bindings (thread_id, reservation_id)
          VALUES (${threadId}, ${binding!.reservation_id})
        `.pipe(Effect.orDie),
      ),
    );
  });

/** Until the run's preparation fails again after `afterSequence`. */
const preparationFailsAgain = (threadId: ThreadId, runId: RunId, afterSequence: number) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" }).pipe(
      Stream.filter(
        (stored) =>
          stored.event.type === "run.updated" &&
          stored.event.payload.id === runId &&
          stored.event.payload.status === "failed",
      ),
      Stream.runHead,
    ),
  );

const branchAlreadyExists = () =>
  new GitCommandError({
    operation: "GitVcsDriver.createWorktree",
    command: "git worktree add",
    cwd: "/repo",
    detail: "git worktree add failed",
    reason: "branch_already_exists",
  });

it.effect(
  "Stages/W1: a stage that failed and settled before a downgrade is not proved never started after it",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* reviewInWorktree(7406);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        (yield* PreparationFake).worktreeCreateFailure = branchAlreadyExists();
        yield* runEffects;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        // In the process that admitted and prepared it, the record is proof.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "quiescent",
          reasons: ["never_started"],
        });
        // It stops before the pass that would release it. An older build then serves the store
        // and accepts a client's retry, which prepares the run outside every container and fails.
        yield* fromEarlierProcess(reservationId, run.id, "process:before-downgrade");
        yield* TestClock.adjust("1 second");
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const before = yield* orchestrator.getThreadEventSequence(execution.threadId);
        const launches = yield* ThreadLaunchService.ThreadLaunchService;
        yield* asUnfencedRuntime(
          execution.threadId,
          launches.retryPreparation({
            commandId: CommandId.make(`command:retry:${run.id}:old-build`),
            threadId: execution.threadId,
            runId: run.id,
          }),
        );
        assert.isTrue(
          Option.isSome(yield* preparationFailsAgain(execution.threadId, run.id, before)),
        );
        // The upgrade back: nothing it holds says what that retry did.
        yield* TestClock.adjust("1 second");
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        yield* advance("restart");
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.deepStrictEqual(
          yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId),
          [],
        );
      }),
    ),
);

it.effect(
  "Stages/W1: a preparation failure an older build admitted and settled is not proof the stage never started",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* reviewInWorktree(7407);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        (yield* PreparationFake).worktreeCreateFailure = branchAlreadyExists();
        yield* runEffects;
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        // BTC #14's shape: failed before it settled, all by a build that also prepared a run for
        // any client's retry, and that names no serving process.
        yield* fromEarlierProcess(reservationId, run.id, undefined);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
        yield* advance("restart");
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.deepStrictEqual(
          yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId),
          [],
        );
      }),
    ),
);

it.effect(
  "Stages/W1: an older build's replay of a recovery retry is not hidden by the recovery that follows the upgrade back",
  () =>
    runIsolated(
      Effect.gen(function* () {
        // The r3 review's RB1 sequence.
        const { execution, run, worktreesBefore } = yield* reviewInWorktree(7409, true);
        yield* runEffects;
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        yield* recovery.reconcile("shutdown");
        yield* recovery.recover;
        const store = yield* FactoryStore.FactoryStore;
        const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const ownerId = PreparationOwnerId.make("owner:before-downgrade");
        yield* store.openWorkspaceObligation({
          runId: run.id,
          reservationId,
          threadId: execution.threadId,
          commandId: FactoryClaimStore.preparationCommandId(run.id),
          ownerId,
        });
        const generation = yield* generations.openIntent({
          runId: run.id,
          reservationId,
          threadId: execution.threadId,
        });
        const replayedId = CommandId.make(`factory-recovery:${run.id}:${ownerId}`);
        yield* orchestrator.dispatch({
          type: "prepared-run.retry",
          commandId: replayedId,
          threadId: execution.threadId,
          runId: run.id,
        });
        // The process stops here: the intent and the retry committed, its owned preparation never
        // invoked, and its container ended with it.
        yield* generations.abandonIntent(generation);
        yield* fromEarlierProcess(reservationId, run.id, "process:before-downgrade");
        // An older build replays the accepted retry and prepares outside every container.
        const preparation = yield* PreparationFake;
        preparation.worktreeCreateFailure = branchAlreadyExists();
        const before = yield* orchestrator.getThreadEventSequence(execution.threadId);
        yield* TestClock.adjust("1 second");
        const replayed = yield* asUnfencedRuntime(
          execution.threadId,
          (yield* ThreadLaunchService.ThreadLaunchService).retryPreparation({
            commandId: replayedId,
            threadId: execution.threadId,
            runId: run.id,
          }),
        );
        assert.isTrue(replayed.replayed);
        assert.isTrue(
          Option.isSome(yield* preparationFailsAgain(execution.threadId, run.id, before)),
        );
        assert.strictEqual(preparation.worktrees.length, worktreesBefore + 1);
        // The upgrade back: recovery reowns the obligation, prepares under its owner, fails and
        // settles. None of that accounts for the older build's preparation.
        yield* TestClock.adjust("1 second");
        yield* advance("restart", 2);
        const settled = Option.getOrThrow(yield* store.workspaceObligation(run.id));
        assert.strictEqual(settled.state, "settled");
        assert.strictEqual(settled.priorOwners?.length, 1);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.deepStrictEqual(
          yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId),
          [],
        );
      }),
    ),
);

/**
 * BTC #14's shape: a stage failed before it started, under records from an older build, with its
 * container ended as the next runtime ended it. Nothing proves its preparation history.
 */
const legacyNeverStartedStage = (issueNumber: number) =>
  Effect.gen(function* () {
    const { execution, run } = yield* reviewInWorktree(issueNumber);
    const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
    (yield* PreparationFake).worktreeCreateFailure = branchAlreadyExists();
    yield* runEffects;
    assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
    yield* fromEarlierProcess(reservationId, run.id, undefined);
    assert.isTrue(
      yield* (yield* FactoryExecutionGenerations.FactoryExecutionGenerations).closeIfQuiet(run.id),
    );
    assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended"]);
    assert.deepStrictEqual(yield* custodyOfReservation(execution), {
      state: "unknown",
      reasons: ["process_containment_unsupported"],
    });
    return { execution, run, reservationId };
  });

const attestationOf = (reservationId: FactoryReservationId) =>
  Effect.map(reservationOf(reservationId), (reservation) =>
    reservation?.origin === "admitted" ? reservation.neverStartedAttestation : undefined,
  );

const disposeNeverStarted = (reservationId: FactoryReservationId, expectDigest?: string) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    factory.disposeNeverStarted({
      factoryId,
      reservationId,
      by: "owner:test",
      reason: "never started: its branch already existed",
      ...(expectDigest === undefined ? {} : { expectDigest }),
    }),
  );

it.effect(
  "Owner/D1: the owner's attestation releases a stage nothing proves never started, once, through its failure",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, reservationId } = yield* legacyNeverStartedStage(7470);
        const read = yield* disposeNeverStarted(reservationId);
        assert.deepStrictEqual([read.disposed, read.refusals], [false, []]);
        assert.isDefined(read.evidenceDigest);
        // A digest of anything but the evidence now records nothing.
        const stale = yield* disposeNeverStarted(reservationId, "0".repeat(64));
        assert.deepStrictEqual([stale.disposed, stale.refusals], [false, ["evidence_changed"]]);
        assert.isUndefined(yield* attestationOf(reservationId));
        const attested = yield* disposeNeverStarted(reservationId, read.evidenceDigest);
        assert.deepStrictEqual(
          [attested.disposed, attested.evidenceDigest],
          [true, read.evidenceDigest],
        );
        const again = yield* disposeNeverStarted(reservationId, read.evidenceDigest);
        assert.deepStrictEqual([again.disposed, again.refusals], [false, ["not_held_admitted"]]);
        assert.strictEqual((yield* attestationOf(reservationId))?.evidence, read.evidence);
        const released = yield* reservationOf(reservationId);
        assert.deepStrictEqual(
          [released?.state, released?.releasedReason],
          ["released", "owner_disposition"],
        );
        const [failed, ...more] =
          yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId);
        assert.deepStrictEqual(more, []);
        assert.strictEqual(failed?.report.outcome, "failed");
        assert.include(failed?.report.failure, "branch_already_exists");
        assert.include(failed?.report.failure, `evidence ${read.evidenceDigest}`);
        // The attestation proved nothing: custody still reads as it did.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        const after = yield* disposeNeverStarted(reservationId, read.evidenceDigest);
        assert.deepStrictEqual(after.refusals, ["not_held_admitted"]);
      }),
    ),
);

it.effect(
  "Owner/D2: an attestation releases nothing once custody lacks more than the preparation history",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId } = yield* legacyNeverStartedStage(7471);
        const read = yield* disposeNeverStarted(reservationId);
        // Its obligation becomes unreadable before the write: that is not what the owner read.
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM factory_workspace_obligations WHERE run_id = ${run.id}`;
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["workspace_obligation_unresolved"],
        });
        assert.isFalse((yield* disposeNeverStarted(reservationId, read.evidenceDigest)).disposed);
        yield* advance("operation");
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.deepStrictEqual(
          yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId),
          [],
        );
      }),
    ),
);

it.effect(
  "Owner/D6: a stage whose provider session never opened, its thread deleted, is attested from its retained records",
  () =>
    runIsolated(
      Effect.gen(function* () {
        // Connector #49's shape: every session open fails, then the owner deletes the thread, so
        // no runtime path can read the execution any more.
        const { execution, run } = yield* reviewInWorktree(7490);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        const joinTarget = yield* ScriptedJoinTarget;
        joinTarget.failOpen = true;
        for (let round = 0; round < 8; round++) {
          yield* runEffects;
          yield* TestClock.adjust("1 minute");
        }
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        const launches = yield* (yield* EffectOutbox.EffectOutboxV2).listLaunchesForThread(
          execution.threadId,
        );
        assert.isTrue(launches.some((launch) => launch.attemptCount > 0));
        assert.isTrue(
          yield* (yield* FactoryExecutionGenerations.FactoryExecutionGenerations).closeIfQuiet(
            run.id,
          ),
        );
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended"]);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        yield* (yield* Orchestrator.OrchestratorV2).dispatch({
          type: "thread.delete",
          commandId: CommandId.make("command:delete:7490"),
          threadId: execution.threadId,
        });
        yield* runEffects;
        // Every runtime path still treats the deleted execution as unreadable.
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "unknown",
          reasons: ["execution_unreadable"],
        });
        const read = yield* disposeNeverStarted(reservationId);
        assert.deepStrictEqual([read.disposed, read.refusals], [false, []]);
        assert.include(read.evidence, '"beforeTurn":"provider-session-open-failure"');
        const attested = yield* disposeNeverStarted(reservationId, read.evidenceDigest);
        assert.isTrue(attested.disposed);
        const released = yield* reservationOf(reservationId);
        assert.deepStrictEqual(
          [released?.state, released?.releasedReason],
          ["released", "owner_disposition"],
        );
        // The item is reviewed again, natively, on a new execution.
        joinTarget.failOpen = false;
        const retried = (yield* advance("owner_decision")).filter(
          (admission) => admission.type === "admitted",
        );
        assert.deepStrictEqual(retried.map(stageOf), [[itemKeyFor(7490), "review"]]);
        assert.notStrictEqual(admittedExecution(retried[0]!).threadId, execution.threadId);
      }),
    ),
);

it.effect(
  "Owner/D7: a session-open failure proves nothing once a provider joined the run's container",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* reviewInWorktree(7491);
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        (yield* ScriptedJoinTarget).failOpen = true;
        for (let round = 0; round < 8; round++) {
          yield* runEffects;
          yield* TestClock.adjust("1 minute");
        }
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
        assert.isTrue(
          yield* (yield* FactoryExecutionGenerations.FactoryExecutionGenerations).closeIfQuiet(
            run.id,
          ),
        );
        // The ended container's record shows a provider joined it: that process may have worked.
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE factory_execution_generations SET record_json = json_set(record_json, '$.providerJoins', 1) WHERE run_id = ${run.id}`;
        const read = yield* disposeNeverStarted(reservationId);
        assert.include(read.refusals, "launch_claimed");
        assert.isFalse((yield* disposeNeverStarted(reservationId, read.evidenceDigest)).disposed);
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
      }),
    ),
);

it.effect("Independent control: provider start after attestation must keep custody held", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution, run, reservationId } = yield* legacyNeverStartedStage(7479);
      const read = yield* disposeNeverStarted(reservationId);
      const store = yield* FactoryStore.FactoryStore;
      const expected = Option.getOrThrow(yield* store.getReservation(reservationId));
      assert.isTrue(
        yield* store.attestNeverStarted({
          reservationId,
          expected,
          by: "owner:test",
          reason: "legacy attestation",
          evidenceDigest: read.evidenceDigest!,
          evidence: read.evidence!,
        }),
      );
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_v2_projection_run_attempts SET payload_json = json_set(payload_json, '$.startedAt', '2026-10-27T00:00:00.000Z') WHERE run_id = ${run.id}`;
      assert.deepStrictEqual(yield* custodyOfReservation(execution), {
        state: "unknown",
        reasons: ["process_containment_unsupported"],
      });
      yield* advance("operation");
      assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
    }),
  ),
);
it.effect(
  "Independent control: an unrelated verified outcome must not substitute for disposition failure",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { reservationId } = yield* legacyNeverStartedStage(7480);
        const reservation = (yield* reservationOf(reservationId))!;
        const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
        yield* outcomes.insertReported({
          outcomeId: "synthetic-verified",
          factoryId,
          itemKey: reservation.itemKey,
          origin: { type: "native", reservationId },
          stage: "review",
          report: { outcome: "review_passed", summary: "synthetic" },
          reportDigest: "synthetic",
          reportedAt: "2026-10-27T00:00:00.000Z",
          state: "reported",
        });
        yield* outcomes.markVerified({
          outcomeId: "synthetic-verified",
          receipt: { verifiedAt: "2026-10-27T00:00:00.000Z" },
        });
        const read = yield* disposeNeverStarted(reservationId);
        assert.isFalse((yield* disposeNeverStarted(reservationId, read.evidenceDigest)).disposed);
        assert.isUndefined(yield* attestationOf(reservationId));
        yield* advance("operation");
        const records = yield* outcomes.listForOrigin(reservationId);
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.isFalse(records.some((record) => record.report.outcome === "failed"));
      }),
    ),
);
it.effect("Owner: a failed release rolls back the attestation and verified failure", () =>
  runIsolated(
    Effect.gen(function* () {
      const { reservationId } = yield* legacyNeverStartedStage(7481);
      const read = yield* disposeNeverStarted(reservationId);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TRIGGER refuse_owner_release BEFORE UPDATE OF state ON factory_reservations
        WHEN NEW.state = 'released' BEGIN SELECT RAISE(ABORT, 'synthetic release failure'); END`;
      const result = yield* Effect.exit(disposeNeverStarted(reservationId, read.evidenceDigest));
      assert.isTrue(Exit.isFailure(result));
      assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
      assert.isUndefined(yield* attestationOf(reservationId));
      assert.deepStrictEqual(
        yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId),
        [],
      );
    }),
  ),
);

it.effect("Owner: a provider start after evidence read refuses the disposition", () =>
  runIsolated(
    Effect.gen(function* () {
      const { run, reservationId } = yield* legacyNeverStartedStage(7482);
      const read = yield* disposeNeverStarted(reservationId);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_v2_projection_run_attempts SET payload_json = json_set(payload_json, '$.startedAt', '2026-10-27T00:00:00.000Z') WHERE run_id = ${run.id}`;
      const result = yield* disposeNeverStarted(reservationId, read.evidenceDigest);
      assert.include(result.refusals, "provider_started");
      assert.isFalse(result.disposed);
      assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
      assert.isUndefined(yield* attestationOf(reservationId));
      assert.deepStrictEqual(
        yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(reservationId),
        [],
      );
    }),
  ),
);

it.effect("Owner/D3: the owner cannot attest a stage whose custody is already proved", () =>
  runIsolated(
    Effect.gen(function* () {
      // Proved in this process: the factory releases it itself.
      const { execution } = yield* reviewInWorktree(7472);
      (yield* PreparationFake).worktreeCreateFailure = branchAlreadyExists();
      yield* runEffects;
      const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
      const read = yield* disposeNeverStarted(reservationId);
      assert.include(read.refusals, "custody_not_unproved");
      assert.isFalse((yield* disposeNeverStarted(reservationId, read.evidenceDigest)).disposed);
      assert.isUndefined(yield* attestationOf(reservationId));
    }),
  ),
);

it.effect("Owner/D4: the owner cannot attest a stage still preparing", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution } = yield* reviewInWorktree(7473, true);
      yield* runEffects;
      const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
      const read = yield* disposeNeverStarted(reservationId);
      assert.include(read.refusals, "run_not_terminal");
      assert.isFalse((yield* disposeNeverStarted(reservationId, read.evidenceDigest)).disposed);
      assert.isUndefined(yield* attestationOf(reservationId));
    }),
  ),
);

it.effect("Owner/D5: the owner cannot attest a stage whose container is not ended", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution, run } = yield* reviewInWorktree(7474);
      const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
      (yield* PreparationFake).worktreeCreateFailure = branchAlreadyExists();
      yield* runEffects;
      yield* fromEarlierProcess(reservationId, run.id, undefined);
      const read = yield* disposeNeverStarted(reservationId);
      assert.include(read.refusals, "container_not_ended");
      assert.isFalse((yield* disposeNeverStarted(reservationId, read.evidenceDigest)).disposed);
      assert.isUndefined(yield* attestationOf(reservationId));
    }),
  ),
);

it.effect(
  "Stages/W1: while a revived stage prepares under its owner, a replayed retry or a bare preparation schedules nothing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, run, worktreesBefore } = yield* reviewInWorktree(7408, true);
          yield* runEffects;
          const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
          yield* recovery.reconcile("shutdown");
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
          yield* recovery.recover;
          const preparation = yield* PreparationFake;
          const reached = yield* Deferred.make<void>();
          const gate = yield* Deferred.make<void>();
          preparation.duringWorktreeCreate = Deferred.succeed(reached, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
          );
          yield* Effect.forkScoped(Effect.andThen(reconcileFactory("restart"), runEffects));
          yield* Deferred.await(reached);
          const owner = Option.getOrThrow(yield* workspaceObligationOf(run.id));
          assert.strictEqual(owner.state, "open");
          assert.strictEqual(preparation.worktrees.length, worktreesBefore + 1);
          const launches = yield* ThreadLaunchService.ThreadLaunchService;
          // A client resends the recovery's accepted retry: its receipt replays before any guard.
          const replayedId = CommandId.make(`factory-recovery:${run.id}:${owner.ownerId}`);
          const replayed = yield* launches.retryPreparation({
            commandId: replayedId,
            threadId: execution.threadId,
            runId: run.id,
          });
          assert.isTrue(replayed.replayed);
          const bareId = CommandId.make(`command:prepare:${run.id}`);
          yield* launches.prepareRun({
            commandId: bareId,
            threadId: execution.threadId,
            runId: run.id,
          });
          // An owned preparation is refused only when one is already scheduled under its command,
          // so these probes read, without waiting on a fiber, that neither call scheduled one.
          for (const commandId of [replayedId, bareId]) {
            const probe = yield* launches.prepareRunOwned({
              commandId,
              threadId: execution.threadId,
              runId: run.id,
              ownerId: PreparationOwnerId.make(`owner:probe:${commandId}`),
            });
            assert.isTrue(Option.isSome(probe), commandId);
          }
        }),
      ),
    ),
);

/** A later stage interrupted by the user before it started, as alpha #69's rework c1448112 was. */
const interruptedStage = (issueNumber: number) =>
  Effect.gen(function* () {
    const stage = yield* reviewInWorktree(issueNumber, true);
    yield* runEffects;
    yield* (yield* Orchestrator.OrchestratorV2).dispatch({
      type: "run.interrupt",
      commandId: CommandId.make(`command:interrupt:${issueNumber}`),
      threadId: stage.execution.threadId,
      runId: stage.run.id,
    });
    assert.deepStrictEqual(yield* runStatuses(stage.execution.threadId), ["interrupted"]);
    return {
      ...stage,
      reservationId: FactoryReservationId.make(`reservation:${stage.execution.commandId}`),
    };
  });

const messagesOf = (threadId: ThreadId) =>
  Effect.map(
    Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.getThreadProjection(threadId),
    ),
    (projection) => projection.messages.map((message) => message.id),
  );

it.effect(
  "Stages/W1: the owner's explicit recovery resumes an interrupted stage on its own run, attempt and prompt, once",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, worktreesBefore, reservationId } = yield* interruptedStage(7404);
        const messagesBefore = yield* messagesOf(execution.threadId);
        const startedBefore = (yield* startedTurns).length;
        const reservationsOf = Effect.map(
          Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
            factory.readState({ factoryId }),
          ),
          (state) => state.reservations.map((reservation) => reservation.reservationId),
        );
        const reservationsBefore = yield* reservationsOf;
        const occupiedBefore = yield* occupied;
        const claims = yield* FactoryClaimService.FactoryClaimService;
        const recovered = yield* Effect.scoped(
          Effect.gen(function* () {
            const running = yield* awaitRunningTurn(execution.threadId);
            const result = yield* claims.recoverInterruptedRun({
              factoryId,
              reservationId,
              runId: run.id,
            });
            yield* runEffects;
            yield* Fiber.join(running);
            return result;
          }),
        );
        assert.deepStrictEqual(recovered, { recovered: true });
        yield* preparedAndStarted(execution, run, worktreesBefore);
        assert.strictEqual((yield* startedTurns).length, startedBefore + 1);
        // It runs on the unit its reservation already holds: no reservation or unit is added.
        assert.deepStrictEqual(yield* reservationsOf, reservationsBefore);
        assert.include(reservationsBefore, reservationId);
        assert.strictEqual(yield* occupied, occupiedBefore);
        // No second message: the worker gets its original admitted prompt.
        assert.deepStrictEqual(yield* messagesOf(execution.threadId), messagesBefore);
        // The interruption stays in the run's history.
        const items = (yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(
          execution.threadId,
        )).turnItems.map((item) => item.type);
        assert.include(items, "run_interrupt_request");
        assert.include(items, "run_interrupt_result");
        // Asking again changes nothing: the run is no longer interrupted.
        const again = yield* claims.recoverInterruptedRun({
          factoryId,
          reservationId,
          runId: run.id,
        });
        assert.strictEqual(again.recovered, false);
        assert.strictEqual((yield* startedTurns).length, startedBefore + 1);
      }),
    ),
);

it.effect(
  "Stages/W1: the owner's recovery refuses anything but an interrupted, never-started stage run",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const claims = yield* FactoryClaimService.FactoryClaimService;
        // Still preparing, not interrupted.
        const preparing = yield* reviewInWorktree(7405, true);
        const preparingId = FactoryReservationId.make(
          `reservation:${preparing.execution.commandId}`,
        );
        const notInterrupted = yield* claims.recoverInterruptedRun({
          factoryId,
          reservationId: preparingId,
          runId: preparing.run.id,
        });
        assert.deepStrictEqual(notInterrupted, {
          recovered: false,
          reason: "the run is preparing, not interrupted",
        });
      }),
    ),
);

it.effect(
  "Stages/W1: the owner's recovery of an interrupted stage refuses another run, factory or reservation",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const claims = yield* FactoryClaimService.FactoryClaimService;
        const { run, reservationId } = yield* interruptedStage(7406);
        const startedBefore = (yield* startedTurns).length;
        const refusals = [
          yield* claims.recoverInterruptedRun({
            factoryId,
            reservationId,
            runId: RunId.make("run:none"),
          }),
          yield* claims.recoverInterruptedRun({
            factoryId: FactoryId.make("other"),
            reservationId,
            runId: run.id,
          }),
          yield* claims.recoverInterruptedRun({
            factoryId,
            reservationId: FactoryReservationId.make("reservation:none"),
            runId: run.id,
          }),
        ];
        assert.deepStrictEqual(
          refusals.map((refusal) => refusal.recovered),
          [false, false, false],
        );
        assert.strictEqual((yield* startedTurns).length, startedBefore);
        assert.isTrue(Option.isNone(yield* workspaceObligationOf(run.id)));
      }),
    ),
);

it.effect(
  "Stages/W1: a repeated recovery takes over only its own abandoned obligation, once nothing prepares under it",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, worktreesBefore, reservationId } = yield* interruptedStage(7407);
        const store = yield* FactoryStore.FactoryStore;
        const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
        // What a recovery that committed and then lost its process leaves: the run still interrupted.
        const crashedOwner = PreparationOwnerId.make("owner:crashed-recovery");
        const intent = yield* (yield* SqlClient.SqlClient).withTransaction(
          Effect.gen(function* () {
            yield* store.openWorkspaceObligation({
              runId: run.id,
              reservationId,
              threadId: execution.threadId,
              commandId: FactoryClaimStore.preparationCommandId(run.id),
              ownerId: crashedOwner,
            });
            return yield* generations.openIntent({
              runId: run.id,
              reservationId,
              threadId: execution.threadId,
            });
          }),
        );
        const claims = yield* FactoryClaimService.FactoryClaimService;
        // A container still being created is not proved ended: nothing is taken over.
        assert.deepStrictEqual(
          yield* claims.recoverInterruptedRun({ factoryId, reservationId, runId: run.id }),
          { recovered: false, reason: "the run's execution container is not proved ended" },
        );
        assert.strictEqual(
          Option.getOrThrow(yield* workspaceObligationOf(run.id)).ownerId,
          crashedOwner,
        );
        yield* generations.abandonIntent(intent);
        const recovered = yield* Effect.scoped(
          Effect.gen(function* () {
            const running = yield* awaitRunningTurn(execution.threadId);
            const result = yield* claims.recoverInterruptedRun({
              factoryId,
              reservationId,
              runId: run.id,
            });
            yield* runEffects;
            yield* Fiber.join(running);
            return result;
          }),
        );
        assert.deepStrictEqual(recovered, { recovered: true });
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended", "held"]);
        assert.strictEqual((yield* PreparationFake).worktrees.length, worktreesBefore + 1);
        const obligation = Option.getOrThrow(yield* workspaceObligationOf(run.id));
        assert.strictEqual(obligation.state, "settled");
        assert.deepStrictEqual(
          obligation.priorOwners?.map((prior) => prior.ownerId),
          [crashedOwner],
        );
      }),
    ),
);

it.effect("Custody/A5b: a preparing run the user interrupted is never revived", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution, run, reservationId } = yield* exhaustedPreparation(7321);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* orchestrator.dispatch({
        type: "run.interrupt",
        commandId: CommandId.make("command:interrupt:7321"),
        threadId: execution.threadId,
        runId: run.id,
      });
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["interrupted"]);
      const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
      yield* recovery.reconcile("shutdown");
      (yield* ContainmentFake).failIdentity = false;
      yield* recovery.recover;
      const startedBefore = (yield* startedTurns).length;
      yield* collectIssues([], "restart");
      yield* runEffects;
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["interrupted"]);
      assert.strictEqual((yield* claimStateOf(reservationId)).state, "verified");
      assert.isTrue(Option.isNone(yield* workspaceObligationOf(run.id)));
      assert.deepStrictEqual(yield* generationStatesOf(run.id), []);
      assert.strictEqual((yield* PreparationFake).worktrees.length, 0);
      assert.strictEqual((yield* startedTurns).length, startedBefore);
      assert.deepStrictEqual(
        yield* (yield* EffectOutbox.EffectOutboxV2).listByCommandId(
          CommandId.make(`factory-recovery-check:${run.id}`),
        ),
        [],
      );
      assert.strictEqual(yield* occupied, 1);
    }),
  ),
);

it.effect(
  "Custody/A5b: a run cancelled after its workspace was authorized holds its claim and prepares nothing again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureContainedClaimFactory();
          yield* seedIssue(7322);
          const execution = admittedExecution(
            yield* proposeWithWorkspace(7322, { type: "worktree", baseRef: "main" }),
          );
          yield* settleClaimOnly(execution);
          yield* retireNextEffect("effect:factory-claim.write:");
          yield* retireNextEffect("effect:factory-execution.prepare:");
          const preparation = yield* PreparationFake;
          const reached = yield* Deferred.make<void>();
          preparation.duringWorktreeCreate = Effect.andThen(
            Deferred.succeed(reached, undefined),
            Effect.never,
          );
          const run = yield* claimedRunOf(execution);
          const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
          const claimService = yield* FactoryClaimService.FactoryClaimService;
          yield* Effect.forkScoped(claimService.prepareFirstUse({ reservationId, runId: run.id }));
          yield* Deferred.await(reached);
          assert.strictEqual((yield* claimStateOf(reservationId)).state, "workspace_authorized");
          const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
          yield* recovery.reconcile("shutdown");
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
          const startedBefore = (yield* startedTurns).length;
          const worktrees = preparation.worktrees.length;
          yield* recovery.recover;
          yield* collectIssues([], "restart");
          yield* runEffects;
          // The requeued effect, as the new runtime would run it.
          yield* claimService.prepareFirstUse({ reservationId, runId: run.id });
          assert.deepStrictEqual(yield* claimStateOf(reservationId), {
            state: "stale_after_claim",
            runId: null,
            reason: "workspace_preparation_cancelled",
          });
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
          assert.strictEqual(preparation.worktrees.length, worktrees);
          assert.strictEqual((yield* startedTurns).length, startedBefore);
          assert.isUndefined(Option.getOrThrow(yield* workspaceObligationOf(run.id)).priorOwners);
        }),
      ),
    ),
);

it.effect(
  "Custody/A5b: a restart while the revival's own effect is live keeps the run preparing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, run, reservationId } = yield* exhaustedPreparation(7323);
          const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
          yield* recovery.reconcile("shutdown");
          (yield* ContainmentFake).failIdentity = false;
          yield* recovery.recover;
          yield* collectIssues([], "restart");
          // A worker holds the replay, and its preparation is still running when the server stops.
          const outbox = yield* EffectOutbox.EffectOutboxV2;
          const replay = Option.getOrThrow(yield* outbox.claimNext({ workerId: "worker:test" }));
          assert.isTrue(replay.id.startsWith(`${prepareEffectIdOf(run.id)}:replay:`));
          const preparation = yield* PreparationFake;
          const reached = yield* Deferred.make<void>();
          preparation.duringWorktreeCreate = Effect.andThen(
            Deferred.succeed(reached, undefined),
            Effect.never,
          );
          const claimService = yield* FactoryClaimService.FactoryClaimService;
          yield* Effect.forkScoped(claimService.prepareFirstUse({ reservationId, runId: run.id }));
          yield* Deferred.await(reached);
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
          yield* recovery.reconcile("shutdown");
          // Its own effect still owns the run, so the next runtime decides from durable state.
          assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["preparing"]);
          assert.strictEqual(Option.getOrThrow(yield* outbox.get(replay.id)).status, "pending");
        }),
      ),
    ),
);

// The admission window bounds how long a decision may wait for its first start. It still holds a
// genuine first start that waited too long; it does not stop a resumption of a reservation the
// settle commit made in time, which reads the basis again anyway.

it.effect(
  "Custody/A5b: a revival whose retry is refused abandons its container intent, and later passes recover the same run",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId } = yield* exhaustedPreparation(7326);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
        yield* recovery.reconcile("shutdown");
        yield* TestClock.adjust("2 hours");
        (yield* ContainmentFake).failIdentity = false;
        // The user archived the thread while it was stranded: the authorization commits, but the
        // retry that should follow it is refused.
        yield* orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("command:archive:7326"),
          threadId: execution.threadId,
        });
        yield* recovery.recover;
        yield* collectIssues([], "restart");
        for (let attempt = 0; attempt < 2; attempt++) {
          yield* runEffects;
          yield* TestClock.adjust("1 second");
        }
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const recoveryCommandId = CommandId.make(`factory-recovery-check:${run.id}`);
        assert.deepStrictEqual(
          (yield* outbox.listByCommandId(recoveryCommandId)).map((replay) => [
            replay.status,
            replay.attemptCount,
          ]),
          [["succeeded", 2]],
        );
        // The replay's own retry found the run still cancelled and held the claim; the intent it
        // could not hold is already ended, not left for the next process to find.
        assert.deepStrictEqual(yield* claimStateOf(reservationId), {
          state: "stale_after_claim",
          runId: null,
          reason: "workspace_preparation_cancelled",
        });
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended"]);
        assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
        const startedBefore = (yield* startedTurns).length;
        // Unarchived, the next pass recovers the same run from the held preparation.
        yield* orchestrator.dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("command:unarchive:7326"),
          threadId: execution.threadId,
        });
        yield* collectIssues([], "clock");
        yield* runEffects;
        assert.strictEqual((yield* claimedRunOf(execution)).id, run.id);
        assert.deepStrictEqual(yield* claimStateOf(reservationId), {
          state: "workspace_authorized",
          runId: run.id,
          reason: null,
        });
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended", "held"]);
        assert.strictEqual((yield* PreparationFake).worktrees.length, 1);
        assert.strictEqual((yield* startedTurns).length, startedBefore + 1);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
);

it.effect("Custody/A5b: a replay that failed is tried again after a pause, not on every pass", () =>
  runIsolated(
    Effect.gen(function* () {
      const { execution, run, reservationId } = yield* exhaustedPreparation(7327);
      const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
      yield* recovery.reconcile("shutdown");
      yield* TestClock.adjust("2 hours");
      // The new runtime's host still cannot build its helper: the replay fails as the original did.
      yield* recovery.recover;
      yield* collectIssues([], "restart");
      for (let attempt = 0; attempt < 5; attempt++) {
        yield* runEffects;
        yield* TestClock.adjust("1 second");
      }
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const recoveryCommandId = CommandId.make(`factory-recovery-check:${run.id}`);
      assert.deepStrictEqual(
        (yield* outbox.listByCommandId(recoveryCommandId)).map((replay) => replay.status),
        ["failed"],
      );
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
      assert.strictEqual((yield* claimStateOf(reservationId)).state, "verified");
      // The next pass schedules one more replay, for later; passes in between add nothing.
      yield* collectIssues([], "clock");
      yield* collectIssues([], "clock");
      yield* runEffects;
      assert.deepStrictEqual(
        (yield* outbox.listByCommandId(recoveryCommandId)).map((replay) => replay.status),
        ["failed", "pending"],
      );
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["cancelled"]);
      // The host is fixed by the time the pause ends.
      (yield* ContainmentFake).failIdentity = false;
      yield* TestClock.adjust("30 minutes");
      yield* runEffects;
      assert.deepStrictEqual(
        (yield* outbox.listByCommandId(recoveryCommandId)).map((replay) => replay.status),
        ["failed", "succeeded"],
      );
      assert.deepStrictEqual(yield* claimStateOf(reservationId), {
        state: "workspace_authorized",
        runId: run.id,
        reason: null,
      });
      assert.include(["starting", "running"], (yield* claimedRunOf(execution)).status);
    }),
  ),
);

it.effect(
  "Custody/A5b: a retry under factory recovery's reserved command id is refused on a thread with no claim",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory();
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const threadId = ThreadId.make("thread:plain:reserved-retry");
        yield* createTopLevelThread(threadId, "user");
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:message:plain-deferred"),
          threadId,
          messageId: MessageId.make("message:plain-deferred"),
          text: "Start in a worktree.",
          attachments: [],
          dispatchMode: {
            type: "defer_start",
            workspaceStrategy: { type: "worktree", baseRef: "main" },
          },
        });
        const run = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!;
        assert.strictEqual(run.status, "preparing");
        // The runtime's stop cancels the run, as it does for any preparing run no effect owns.
        yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).reconcile(
          "shutdown",
        );
        assert.deepStrictEqual(yield* runStatuses(threadId), ["cancelled"]);
        for (const commandId of [`factory-recovery:${run.id}:forged`, `command:retry:${run.id}`]) {
          const retried = yield* Effect.exit(
            orchestrator.dispatch({
              type: "prepared-run.retry",
              commandId: CommandId.make(commandId),
              threadId,
              runId: run.id,
            }),
          );
          assert.isTrue(Exit.isFailure(retried), commandId);
        }
        assert.deepStrictEqual(yield* runStatuses(threadId), ["cancelled"]);
      }),
    ),
);

it.effect("Claims/N14: a verified claim's first start after the admission window is held", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory();
      yield* seedIssue(7324);
      const execution = admittedExecution(
        yield* proposeWithWorkspace(7324, { type: "worktree", baseRef: "main" }),
      );
      yield* settleClaimOnly(execution);
      yield* retireNextEffect("effect:factory-claim.write:");
      // The test policy admits for an hour; the host does not get to the start until later.
      yield* TestClock.adjust("2 hours");
      yield* runEffects;
      assert.deepStrictEqual(yield* runStatuses(execution.threadId), ["failed"]);
      assert.deepStrictEqual(
        yield* claimStateOf(FactoryReservationId.make(`reservation:${execution.commandId}`)),
        { state: "stale_after_claim", runId: null, reason: "deadline_expired" },
      );
      assert.strictEqual((yield* PreparationFake).worktrees.length, 0);
      assert.strictEqual((yield* startedTurns).length, 0);
    }),
  ),
);

it.effect(
  "Custody/A5a: a preparation lost after its intent still recovers once the admission window has passed",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureContainedClaimFactory();
        yield* seedIssue(7325);
        const execution = admittedExecution(
          yield* proposeWithWorkspace(7325, { type: "worktree", baseRef: "main" }),
        );
        (yield* ContainmentFake).failNextHold = true;
        yield* runEffects;
        const run = yield* claimedRunOf(execution);
        assert.strictEqual(run.status, "failed");
        const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
        assert.strictEqual((yield* claimStateOf(reservationId)).state, "stale_after_claim");
        const startedBefore = (yield* startedTurns).length;
        // The host comes back long after the decision's window; the item is unchanged.
        yield* TestClock.adjust("2 hours");
        yield* collectIssues([]);
        yield* runEffects;
        assert.strictEqual((yield* claimedRunOf(execution)).id, run.id);
        assert.deepStrictEqual(yield* generationStatesOf(run.id), ["ended", "held"]);
        assert.strictEqual((yield* PreparationFake).worktrees.length, 1);
        assert.strictEqual((yield* startedTurns).length, startedBefore + 1);
        assert.deepStrictEqual(yield* claimStateOf(reservationId), {
          state: "workspace_authorized",
          runId: run.id,
          reason: null,
        });
      }),
    ),
);

// The shared lifecycle end to end: native triggers select an eligible ticket, its stages run
// as separate admitted executions, every outcome is verified by readback and recorded on the
// tracker before the next stage is decided, T3 itself integrates and closes through durable
// operations, and the freed unit selects the next ticket. No coordinator runs in between.

type ProposeInput = Parameters<ProposeFn>[0];

/** A stage brief naming its exact decision, as a project policy writes one; T3's stages proceed. */
const stageRequest = (
  input: ProposeInput,
): Effect.Effect<FactoryLifecycle.FactoryPolicyDecision> =>
  input.stage.type === "integrate" || input.stage.type === "close"
    ? Effect.succeed({ type: "proceed" })
    : Effect.map(inOneHour, (deadline) => {
        const text = `${input.stage.type} ${input.observation.itemKey} as ${input.decisionKey}`;
        return admissionFor(
          input.observation.itemKey,
          { observationId: input.observation.observationId, deadline },
          {
            taskKind: input.stage.type,
            policyRevision: input.configuration.policyRevision,
            title: `${input.stage.type} ${input.observation.itemKey}`,
            packet: {
              text,
              sha256: sha256(text),
              briefSchemaVersion: "brief-v1",
              helperSha256: null,
            },
          },
        );
      });

const usePolicy = (propose: ProposeFn) =>
  Effect.map(PolicyFake, (fake) => {
    fake.propose = propose;
  });

const lifecycleBase = "b0000001";
const factoryIdentity = { name: "T3 Factory", email: "factory@example.invalid" };

const lifecycleConfiguration = (
  overrides: Partial<FactoryLifecycle.FactoryConfigurationInput> = {},
): Partial<FactoryLifecycle.FactoryConfigurationInput> => ({
  pools: pool(1),
  claim: { ...claimConfig, repositories: [claimRepository] },
  execution: {
    modelSelection: rosterSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
  },
  integration: { branch: "main", remote: null, mode: "merge", identity: factoryIdentity },
  ...overrides,
});

const configureLifecycleFactory = Effect.gen(function* () {
  const graph = yield* GitGraphFake;
  graph.parents.set(lifecycleBase, []);
  graph.branches.set("main", lifecycleBase);
  yield* usePolicy(stageRequest);
  return yield* configureFactory(lifecycleConfiguration());
});

const reconcileFactory = (trigger: FactoryLifecycle.FactoryTrigger) =>
  Effect.gen(function* () {
    const factory = yield* FactoryLifecycle.FactoryLifecycle;
    const result = yield* factory.reconcile({ factoryId, trigger });
    if (result.type !== "collected") throw new Error(`Expected a pass, got ${result.type}`);
    return result.admissions;
  });

/**
 * A fixed number of rounds of what the driver and the effect worker do: one collection pass,
 * then every effect it left. Extra rounds are harmless: a settled factory decides nothing new.
 */
const advance = (trigger: FactoryLifecycle.FactoryTrigger, rounds = 6) =>
  Effect.gen(function* () {
    const admissions: Array<FactoryLifecycle.FactoryAdmissionResult> = [];
    for (let round = 0; round < rounds; round++) {
      admissions.push(...(yield* reconcileFactory(round === 0 ? trigger : "operation")));
      yield* runEffects;
    }
    return admissions;
  });

/** The single decision a pass admitted; anything else it decided was a refusal. */
const admittedBy = (admissions: ReadonlyArray<FactoryLifecycle.FactoryAdmissionResult>) => {
  const admitted = admissions.filter((admission) => admission.type === "admitted");
  assert.strictEqual(admitted.length, 1, JSON.stringify(admissions));
  return admitted[0]!;
};

const stageOf = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
  admission.type === "refused" || admission.reservation.origin !== "admitted"
    ? undefined
    : [admission.reservation.itemKey, admission.reservation.taskKind];

const recordCommit = (sha: string, parents: ReadonlyArray<string>) =>
  Effect.map(GitGraphFake, (graph) => {
    graph.parents.set(sha, parents);
  });

const reportFrom = (threadId: ThreadId, outcome: FactoryReportInput) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    factory.report({ threadId, report: outcome }),
  );

/**
 * Waits until the execution's provider turn is running, whether or not it already started. It
 * reads the stored events from a sequence taken before it looks, so no start can slip between.
 */
const startStage = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
  Effect.gen(function* () {
    const execution = admittedExecution(admission);
    const sink = yield* EventSink.EventSinkV2;
    const after = yield* sink.latestSequence({ threadId: execution.threadId });
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(execution.threadId);
    if (!projection.providerTurns.some((turn) => turn.status === "running")) {
      const running = yield* sink
        .stream({ threadId: execution.threadId, afterSequence: after })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "provider-turn.updated" &&
              stored.event.payload.status === "running",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped,
        );
      yield* runEffects;
      yield* Fiber.join(running);
    }
    return execution;
  });

/** One stage's worker: its turn runs, it reports its outcome (if any), and its run ends. */
const workStage = (
  admission: FactoryLifecycle.FactoryAdmissionResult,
  outcome: FactoryReportInput | undefined,
) =>
  Effect.gen(function* () {
    const execution = yield* startStage(admission);
    if (outcome !== undefined) {
      const reported = yield* reportFrom(execution.threadId, outcome);
      assert.strictEqual(reported.state, "reported");
    }
    yield* completeLatestRun(execution.threadId);
    return execution;
  });

const subjectFor = (headCommit: string, baseCommit?: string) => ({
  repository: claimRepository,
  headCommit,
  ...(baseCommit === undefined ? {} : { baseCommit }),
});

const commentsWith = (issueNumber: number, marker: string) =>
  Effect.map(GitHubFake, (fake) =>
    (fake.issues.get(issueKey(claimRepository, issueNumber))?.comments ?? []).filter((comment) =>
      comment.body.includes(marker),
    ),
  );
const reportComments = (issueNumber: number) => commentsWith(issueNumber, "t3-factory-report");

const itemKeyFor = (issueNumber: number) => itemKeyOf(`github:${claimRepository}#${issueNumber}`);

const itemHistory = (issueNumber: number) =>
  Effect.gen(function* () {
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    const events = yield* outcomes.itemEvents({ factoryId, itemKey: itemKeyFor(issueNumber) });
    return events.map((event) =>
      event.type === "admitted" ? event.stage : event.type === "outcome" ? event.kind : event.type,
    );
  });

const dispositionOf = (issueNumber: number) =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    return state.lastCollection.find((record) => record.itemKey === itemKeyFor(issueNumber))
      ?.disposition;
  });

const closeRequests = Effect.map(
  GitHubFake,
  (fake) => fake.requests.filter((request) => request.method === "PATCH").length,
);

/** The verified outcome T3 recorded for its own integration of the item. */
const integrationOf = (issueNumber: number) =>
  Effect.gen(function* () {
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    const integrations = (yield* operations.forItem({
      factoryId,
      itemKey: itemKeyFor(issueNumber),
    })).filter(
      (operation) =>
        operation.intent.kind === "git_integrate" || operation.intent.kind === "pull_request_merge",
    );
    const found: Array<FactoryOutcomeStore.FactoryOutcome> = [];
    for (const operation of integrations) {
      const outcome = yield* outcomes.get(`native:${operation.operationId}`);
      if (Option.isSome(outcome)) found.push(outcome.value);
    }
    return { operations: integrations, outcomes: found };
  });

it.effect(
  "Lifecycle/beta: one ticket runs review, correction, rework, integration and closure, then the next",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7001);
          yield* seedIssue(7002);
          const item = `github:${claimRepository}#7001`;

          // A tracker event selects the first eligible ticket; the second waits for the unit.
          const selected = yield* advance("tracker_event", 1);
          assert.deepStrictEqual(stageOf(admittedBy(selected)), [item, "implement"]);
          assert.strictEqual(yield* dispositionOf(7002), "refused:capacity_exhausted");

          yield* recordCommit("c0000001", [lifecycleBase]);
          yield* workStage(admittedBy(selected), {
            outcome: "implemented",
            subject: { ...subjectFor("c0000001", lifecycleBase), branch: "t3-factory/7001" },
            summary: "Implemented 7001.",
          });
          const review = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(review), [item, "review"]);

          yield* workStage(review, {
            outcome: "review_failed",
            subject: subjectFor("c0000001"),
            failure: "test_settlement fails: expected 2 got 3",
            summary: "One failing check.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);

          yield* workStage(correct, {
            outcome: "correction_spec",
            summary: "Round the settlement total before comparing.",
          });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);

          yield* recordCommit("c0000002", ["c0000001"]);
          yield* workStage(rework, {
            outcome: "implemented",
            subject: subjectFor("c0000002", lifecycleBase),
            summary: "Reworked 7001.",
          });
          const secondReview = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(secondReview), [item, "review"]);

          yield* workStage(secondReview, {
            outcome: "review_passed",
            subject: subjectFor("c0000002"),
            summary: "Passes.",
          });
          // The passing review frees the builder unit for the next ticket while T3 itself lands
          // the reviewed head and closes the issue, each read back before the next step.
          const next = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(next), [`github:${claimRepository}#7002`, "implement"]);
          assert.strictEqual(yield* dispositionOf(7001), "done");
          const graph = yield* GitGraphFake;
          assert.strictEqual(graph.writes.length, 1);
          const merge = graph.branches.get("main")!;
          assert.deepStrictEqual(graph.parents.get(merge), [lifecycleBase, "c0000002"]);
          assert.strictEqual(
            (yield* GitHubFake).issues.get(issueKey(claimRepository, 7001))!.state,
            "closed",
          );
          const { outcomes } = yield* integrationOf(7001);
          assert.deepStrictEqual(
            outcomes.map((outcome) => [outcome.state, outcome.report.integration]),
            [
              [
                "verified",
                {
                  targetBranch: "main",
                  mergeCommit: merge,
                  parents: [lifecycleBase, "c0000002"],
                  tree: `tree-${merge}`,
                  attribution: "operation",
                },
              ],
            ],
          );

          assert.deepStrictEqual(yield* itemHistory(7001), [
            "implement",
            "implemented",
            "review",
            "review_failed",
            "correct",
            "correction_spec",
            "rework",
            "implemented",
            "review",
            "review_passed",
            "integrated",
            "closed",
          ]);
          // One claim for the whole item, one verified record per worker and integration outcome,
          // and one closing record.
          assert.strictEqual((yield* claimComments(7001)).length, 1);
          assert.strictEqual((yield* reportComments(7001)).length, 6);
          assert.strictEqual((yield* commentsWith(7001, "t3-factory-close")).length, 1);
          assert.strictEqual(yield* closeRequests, 1);

          // Repeated triggers decide nothing new and write nothing again.
          for (const trigger of ["clock", "restart", "tracker_event", "outcome"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 1), []);
          }
          assert.strictEqual(yield* dispositionOf(7002), "in_progress");
          assert.strictEqual(graph.writes.length, 1);
          assert.strictEqual((yield* reportComments(7001)).length, 6);
          assert.strictEqual(yield* closeRequests, 1);
          assert.strictEqual(yield* occupied, 1);

          // The owner reopens an issue T3 closed: a new version of the item. Its history and its
          // one claim stay; its next stage is a new build, which waits here only for capacity.
          // Nothing is closed again, and the reopen is recorded once however often it is read.
          (yield* GitHubFake).issues.get(issueKey(claimRepository, 7001))!.state = "open";
          for (const trigger of ["tracker_event", "clock", "tracker_event"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 1)), []);
          }
          const reopened = (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
            factoryId,
          })).lastCollection.find((record) => record.itemKey === itemKeyFor(7001));
          assert.deepStrictEqual(
            [reopened?.stage, reopened?.disposition],
            ["implement", "refused:capacity_exhausted"],
          );
          const history = yield* itemHistory(7001);
          assert.deepStrictEqual(history.slice(-2), ["closed", "reopened"]);
          assert.strictEqual(history.filter((event) => event === "reopened").length, 1);
          assert.strictEqual((yield* claimComments(7001)).length, 1);
          assert.strictEqual(yield* closeRequests, 1);
          assert.strictEqual(graph.writes.length, 1);
        }),
      ),
    ),
);

/** beta lands reviewed work only through a pull request that GitHub's protection lets merge. */
const pullRequestIntegration = {
  mode: "pull_request",
  repository: claimRepository,
  remote: "origin",
  branch: "main",
  method: "merge",
} as const;

const configurePullRequestFactory = Effect.gen(function* () {
  yield* configureLifecycleFactory;
  return yield* configureFactory(lifecycleConfiguration({ integration: pullRequestIntegration }));
});

/**
 * A historical stage's shape: it ran on the deployed build, reported a
 * verified outcome, and holds its item because its provider never joined its container. The
 * serving process that admitted it is gone, so its record names an earlier one.
 */
const historicalStage = (issueNumber: number, overrides: Partial<FakeIssue> = {}) =>
  Effect.gen(function* () {
    yield* configureLifecycleFactory;
    yield* seedIssue(issueNumber, overrides);
    yield* seedIssue(issueNumber + 1);
    // The deployed build's provider starts outside the container it was given.
    const target = yield* ScriptedJoinTarget;
    target.skip = true;
    const admitted = admittedBy(yield* advance("tracker_event", 1));
    assert.strictEqual(yield* dispositionOf(issueNumber + 1), "refused:capacity_exhausted");
    yield* recordCommit(`c${String(issueNumber).padStart(7, "0")}`, [lifecycleBase]);
    const execution = yield* workStage(admitted, {
      outcome: "implemented",
      subject: {
        ...subjectFor(`c${String(issueNumber).padStart(7, "0")}`, lifecycleBase),
        branch: `t3-factory/${issueNumber}`,
      },
      summary: `Implemented ${issueNumber}.`,
    });
    target.skip = false;
    // Its later stage never starts while the held stage owns the item, nor does the next ticket.
    assert.deepStrictEqual(
      (yield* advance("outcome")).filter((admission) => admission.type === "admitted"),
      [],
    );
    const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE factory_reservations SET record_json = json_set(record_json, '$.admittedIn', 'serving:deployed') WHERE reservation_id = ${reservationId}`;
    const held = yield* reservationOf(reservationId);
    assert.deepStrictEqual(
      [held?.state, held?.custody],
      ["held", { state: "unknown", reasons: ["process_containment_unsupported"] }],
    );
    return { execution, reservationId };
  });

const quarantine = (
  reservationId: FactoryReservationId,
  action: "enter" | "leave",
  expectDigest?: string,
) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    factory.quarantine({
      factoryId,
      reservationId,
      action,
      by: "owner",
      reason: "historical execution; no provider join was recorded",
      ...(expectDigest === undefined ? {} : { expectDigest }),
    }),
  );

const occupiedNow = Effect.map(
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) => factory.readState({ factoryId })),
  (state) => state.pools.map((pool) => pool.occupiedUnits),
);

it.effect(
  "Quarantine/Q1: a historical stage frees its unit for disjoint work but keeps its item, thread and outcome",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, reservationId } = yield* historicalStage(7801);
          const historyBefore = yield* itemHistory(7801);
          assert.deepStrictEqual(historyBefore, ["implement", "implemented"]);

          // A read changes nothing; a stale digest refuses; the exact one quarantines once.
          const read = yield* quarantine(reservationId, "enter");
          assert.deepStrictEqual([read.applied, read.refusals], [false, []]);
          assert.deepStrictEqual(yield* occupiedNow, [1]);
          const stale = yield* quarantine(reservationId, "enter", "0".repeat(64));
          assert.deepStrictEqual(stale.refusals, ["evidence_changed"]);
          // Two owners confirming at once record one quarantine.
          const [first, second] = yield* Effect.all(
            [
              quarantine(reservationId, "enter", read.evidenceDigest),
              quarantine(reservationId, "enter", read.evidenceDigest),
            ],
            { concurrency: 2 },
          );
          assert.deepStrictEqual([first.applied, second.applied].toSorted(), [false, true]);
          assert.include((first.applied ? second : first).refusals, "already_quarantined");

          // Still held and unknown: it proves nothing, and owns its item and thread.
          const held = yield* reservationOf(reservationId);
          assert.strictEqual(held?.state, "held");
          assert.deepStrictEqual(held?.custody, {
            state: "unknown",
            reasons: ["process_containment_unsupported"],
          });
          assert.deepStrictEqual(yield* occupiedNow, [0]);
          const view = factoryStateView(
            yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId }),
          ).reservations.find((reservation) => reservation.reservationId === reservationId);
          assert.strictEqual(view?.quarantine?.evidenceDigest, read.evidenceDigest);
          assert.include(view?.quarantine?.nextAction, "t3_factory_quarantine");

          // The disjoint ticket advances within the pool's one unit; the held item does not.
          const next = (yield* advance("owner_decision")).filter(
            (admission) => admission.type === "admitted",
          );
          assert.deepStrictEqual(next.map(stageOf), [[itemKeyFor(7802), "implement"]]);
          assert.strictEqual(yield* dispositionOf(7801), "quarantined");
          // The policy still weighs it as a native writer on its item.
          assert.strictEqual(
            (yield* PolicyFake).active.at(-1)?.find((entry) => entry.itemKey === itemKeyFor(7801))
              ?.custody,
            "native",
          );
          assert.deepStrictEqual(yield* occupiedNow, [1]);

          // Unchanged passes, and a restart, keep one quarantine and decide nothing new for it.
          const runsBefore = yield* runCount(execution.threadId);
          const startsOn = Effect.map(
            startedTurns,
            (turns) => turns.filter((turn) => turn.threadId === execution.threadId).length,
          );
          const startsBefore = yield* startsOn;
          const recordsBefore =
            (yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).itemRecords({
              factoryId,
              itemKey: itemKeyFor(7801),
            })).length;
          yield* advance("clock");
          yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
          yield* advance("restart");
          assert.strictEqual(yield* dispositionOf(7801), "quarantined");
          assert.strictEqual(yield* runCount(execution.threadId), runsBefore);
          assert.strictEqual(yield* startsOn, startsBefore);
          assert.strictEqual(
            (yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).itemRecords({
              factoryId,
              itemKey: itemKeyFor(7801),
            })).length,
            recordsBefore,
          );
          const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
          assert.deepStrictEqual(state.reservedDecisions, []);
          assert.deepStrictEqual(yield* itemHistory(7801), historyBefore);
          assert.strictEqual(
            state.reservations.filter(
              (reservation) =>
                reservation.itemKey === itemKeyFor(7801) && reservation.state === "held",
            ).length,
            1,
          );

          // The held item cannot be admitted again, by entry or by a pass.
          const entered = yield* (yield* FactoryLifecycle.FactoryLifecycle).enter({
            factoryId,
            repository: claimRepository,
            issueNumber: 7801,
          });
          assert.strictEqual(entered.threadId, execution.threadId);
          assert.strictEqual(yield* runCount(execution.threadId), runsBefore);
        }),
      ),
    ),
);

it.effect(
  "Quarantine/Q2: ending a quarantine charges the stage again, only on fresh evidence, and keeps its history",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { reservationId } = yield* historicalStage(7811);
          // Nothing to end yet.
          assert.deepStrictEqual((yield* quarantine(reservationId, "leave")).refusals, [
            "not_quarantined",
          ]);
          const entered = yield* quarantine(reservationId, "enter");
          assert.isTrue(
            (yield* quarantine(reservationId, "enter", entered.evidenceDigest)).applied,
          );
          // The evidence it entered on is stale for ending it.
          const leaveRead = yield* quarantine(reservationId, "leave");
          assert.deepStrictEqual(leaveRead.refusals, []);
          assert.deepStrictEqual(
            (yield* quarantine(reservationId, "leave", entered.evidenceDigest)).refusals,
            ["evidence_changed"],
          );
          assert.isTrue(
            (yield* quarantine(reservationId, "leave", leaveRead.evidenceDigest)).applied,
          );
          assert.deepStrictEqual(yield* occupiedNow, [1]);
          const held = yield* reservationOf(reservationId);
          assert.strictEqual(held?.state, "held");
          assert.isTrue(held?.origin === "admitted" && held.quarantine === undefined);
          assert.deepStrictEqual(
            held?.origin === "admitted"
              ? held.quarantineHistory?.map((ended) => [
                  ended.evidenceDigest,
                  ended.left.evidenceDigest,
                ])
              : undefined,
            [[entered.evidenceDigest, leaveRead.evidenceDigest]],
          );
          assert.strictEqual(yield* dispositionOf(7811), "in_progress");
        }),
      ),
    ),
);

it.effect("Quarantine/Q3: live, joined, current or unreported stages are never quarantined", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7821);
        const admitted = admittedBy(yield* advance("tracker_event", 1));
        const running = yield* startStage(admitted);
        const reservationId = FactoryReservationId.make(`reservation:${running.commandId}`);
        // Running now, under the process that admitted it.
        const live = yield* quarantine(reservationId, "enter");
        assert.includeMembers(
          [...live.refusals],
          ["run_not_terminal", "custody_not_unproved", "admitted_by_this_process"],
        );
        // Ended without a report: an ambiguous writer, still charged.
        (yield* ScriptedJoinTarget).skip = true;
        yield* completeLatestRun(running.threadId);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE factory_reservations SET record_json = json_set(record_json, '$.admittedIn', 'serving:deployed') WHERE reservation_id = ${reservationId}`;
        const unreported = yield* quarantine(reservationId, "enter");
        assert.include(unreported.refusals, "no_verified_report");
        assert.isFalse(
          (yield* quarantine(reservationId, "enter", unreported.evidenceDigest)).applied,
        );
        assert.deepStrictEqual(yield* occupiedNow, [1]);
        // A reservation of another factory or of nothing is not this owner's to quarantine.
        assert.deepStrictEqual(
          (yield* quarantine(FactoryReservationId.make("reservation:missing"), "enter")).refusals,
          ["unknown_reservation"],
        );
      }),
    ),
  ),
);

it.effect(
  "Quarantine/Q5: work overlapping a quarantined stage's files waits; disjoint work takes its freed unit",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { reservationId } = yield* historicalStage(7851, owning("src/shared.py"));
          const read = yield* quarantine(reservationId, "enter");
          assert.isTrue((yield* quarantine(reservationId, "enter", read.evidenceDigest)).applied);
          yield* keepClearOfLineages;
          yield* seedIssue(7853, owning("src/shared.py"));
          yield* seedIssue(7854, owning("src/disjoint.py"));
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7853, 7854])), [
            itemKeyFor(7854),
          ]);
          assert.strictEqual(yield* dispositionOf(7853), "nothing_proposed");
          assert.strictEqual(yield* dispositionOf(7851), "quarantined");
        }),
      ),
    ),
);

it.effect(
  "Quarantine/Q4: a closed item's quarantined stage stays closed, unrelaunched, with its review kept",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, reservationId } = yield* historicalStage(7831);
          // The owner closed the issue; T3 did not.
          (yield* GitHubFake).issues.get(issueKey(claimRepository, 7831))!.state = "closed";
          const read = yield* quarantine(reservationId, "enter");
          assert.isTrue((yield* quarantine(reservationId, "enter", read.evidenceDigest)).applied);
          const patchesBefore = yield* closeRequests;
          const runsBefore = yield* runCount(execution.threadId);
          yield* advance("clock");
          yield* advance("clock");
          assert.strictEqual(
            (yield* GitHubFake).issues.get(issueKey(claimRepository, 7831))!.state,
            "closed",
          );
          assert.strictEqual(yield* closeRequests, patchesBefore);
          assert.strictEqual(yield* runCount(execution.threadId), runsBefore);
          assert.deepStrictEqual(yield* itemHistory(7831), ["implement", "implemented"]);
          assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        }),
      ),
    ),
);

/**
 * A historical stage at `stage` of its item: the stages before it ran contained and settled; this
 * one ran on the deployed build outside its container, reported, and is held unknown. BTC145 was an
 * implement stage, BTC142 a passing review and HSA137 a correction.
 */
const historicalAt = (issueNumber: number, stage: "implement" | "review" | "correct") =>
  Effect.gen(function* () {
    yield* configureLifecycleFactory;
    yield* seedIssue(issueNumber);
    const target = yield* ScriptedJoinTarget;
    const commit = `c${String(issueNumber).padStart(7, "0")}`;
    yield* recordCommit(commit, [lifecycleBase]);
    target.skip = stage === "implement";
    let execution = yield* workStage(admittedBy(yield* advance("tracker_event", 1)), {
      outcome: "implemented",
      subject: { ...subjectFor(commit, lifecycleBase), branch: `t3-factory/${issueNumber}` },
      summary: `Implemented ${issueNumber}.`,
    });
    if (stage !== "implement") {
      target.skip = stage === "review";
      execution = yield* workStage(
        admittedBy(yield* advance("outcome")),
        stage === "review"
          ? { outcome: "review_passed", subject: subjectFor(commit), summary: "Passes." }
          : {
              outcome: "review_failed",
              subject: subjectFor(commit),
              failure: "test_settlement fails",
              summary: "One failing check.",
            },
      );
    }
    if (stage === "correct") {
      target.skip = true;
      execution = yield* workStage(admittedBy(yield* advance("outcome")), {
        outcome: "correction_spec",
        summary: "Round the settlement total before comparing.",
      });
    }
    target.skip = false;
    assert.deepStrictEqual(
      (yield* advance("outcome")).filter((admission) => admission.type === "admitted"),
      [],
    );
    const reservationId = FactoryReservationId.make(`reservation:${execution.commandId}`);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE factory_reservations SET record_json = json_set(record_json, '$.admittedIn', 'serving:deployed') WHERE reservation_id = ${reservationId}`;
    const held = yield* reservationOf(reservationId);
    assert.deepStrictEqual(
      [held?.state, held?.custody],
      ["held", { state: "unknown", reasons: ["process_containment_unsupported"] }],
    );
    return { execution, reservationId };
  });

// The OS facts the server reads before and after Root's planned full restart. Synthetic: no test
// restarts anything; the fake OS is what that boundary would look like.
const hostBoot = (bootId: string, uptimeMs: number): HostBoot => ({
  platform: "win32",
  machineId: "machine:test-host",
  bootId,
  uptimeMs,
});
const beforeRestart = hostBoot("20", 276_517_000);
const afterRestart = hostBoot("21", 120_000);
const operationRef = "restart:historical-recovery";

/**
 * TEST-ONLY trusted provenance: what a producer would have retained for this execution, read from
 * its own records, on the test host, with one local executor. Synthetic; it stands for no real
 * reservation. `change` alters it the way a foreign, delegated or incomplete record would.
 */
const syntheticProvenance = (
  reservationId: FactoryReservationId,
  change: Partial<HistoricalProvenance>,
) =>
  Effect.gen(function* () {
    const found = yield* (yield* FactoryStore.FactoryStore).getReservation(reservationId);
    if (Option.isNone(found) || found.value.origin !== "admitted") return Option.none();
    const { threadId } = found.value.execution;
    const projection = yield* (yield* ProjectionStore.ProjectionStoreV2).getThreadProjection(
      threadId,
    );
    const launches = (yield* (yield* EffectOutbox.EffectOutboxV2).listLaunchesForThread(
      threadId,
    )).flatMap((effect) =>
      effect.request.type === "provider-turn.start" ||
      effect.request.type === "provider-turn.restart"
        ? [
            {
              runId: effect.request.runId,
              status: effect.status,
              attemptCount: effect.attemptCount,
            },
          ]
        : [],
    );
    const provenance: HistoricalProvenance = {
      reservationId,
      operationRef,
      source: "synthetic-test-producer",
      host: { platform: "win32", machineId: "machine:test-host" },
      runs: projection.runs.map((run) => run.id),
      attempts: projection.attempts.map((attempt) => attempt.id),
      launches,
      providerSessions: projection.providerThreads.flatMap((providerThread) =>
        providerThread.providerSessionId === null ? [] : [providerThread.providerSessionId],
      ),
      executors: [{ kind: "local_process", machineId: "machine:test-host" }],
      ...change,
    };
    return Option.some<unknown>(provenance);
  });

const terminate = (
  reservationId: FactoryReservationId,
  action: "capture" | "verify",
  host: HostBoot | null,
  expectDigest?: string,
  ref = operationRef,
  // "none": the production source, which retained nothing.
  retained: "none" | Partial<HistoricalProvenance> = {},
) =>
  Effect.gen(function* () {
    const provenance =
      retained === "none" ? Option.none() : yield* syntheticProvenance(reservationId, retained);
    return yield* Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
      factory.historicalTermination({
        factoryId,
        reservationId,
        action,
        operationRef: ref,
        by: "owner",
        reason: "planned full host restart",
        ...(expectDigest === undefined ? {} : { expectDigest }),
      }),
    ).pipe(
      Effect.provideService(HostBootReader, {
        read:
          host === null
            ? Effect.fail(new HostBootUnreadable({ reason: "registry unreadable" }))
            : Effect.succeed(host),
      }),
      Effect.provideService(
        HistoricalProvenanceSource,
        retained === "none"
          ? HistoricalProvenanceSource.defaultValue()
          : { read: () => Effect.succeed(provenance) },
      ),
    );
  });

const captureTermination = (reservationId: FactoryReservationId) =>
  Effect.gen(function* () {
    const read = yield* terminate(reservationId, "capture", beforeRestart);
    assert.deepStrictEqual(read.refusals, []);
    assert.isTrue(
      (yield* terminate(reservationId, "capture", beforeRestart, read.evidenceDigest)).applied,
    );
  });

/** The host's full restart: every container ends with the OS, and T3 starts again. */
const restartHost = Effect.gen(function* () {
  (yield* ContainmentFake).members.clear();
  yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
});

const proveTermination = (reservationId: FactoryReservationId) =>
  Effect.gen(function* () {
    const read = yield* terminate(reservationId, "verify", afterRestart);
    assert.deepStrictEqual(read.refusals, []);
    assert.isTrue(
      (yield* terminate(reservationId, "verify", afterRestart, read.evidenceDigest)).applied,
    );
  });

const admissionsOnly = (admissions: ReadonlyArray<FactoryLifecycle.FactoryAdmissionResult>) =>
  admissions.filter((admission) => admission.type === "admitted");

it.effect(
  "Termination/T1: an implement stage proved ended by a later boot settles once and goes to its independent review",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, reservationId } = yield* historicalAt(7861, "implement");

          // Before the restart: a read binds nothing, a stale digest refuses, and two owners
          // confirming at once record one capture.
          const read = yield* terminate(reservationId, "capture", beforeRestart);
          assert.deepStrictEqual([read.applied, read.refusals], [false, []]);
          assert.deepStrictEqual(
            (yield* terminate(reservationId, "capture", beforeRestart, "0".repeat(64))).refusals,
            ["evidence_changed"],
          );
          const [first, second] = yield* Effect.all(
            [
              terminate(reservationId, "capture", beforeRestart, read.evidenceDigest),
              terminate(reservationId, "capture", beforeRestart, read.evidenceDigest),
            ],
            { concurrency: 2 },
          );
          assert.deepStrictEqual([first.applied, second.applied].toSorted(), [false, true]);
          assert.include((first.applied ? second : first).refusals, "already_captured");

          // A capture proves nothing: the stage stays held and unknown, owning its item.
          assert.deepStrictEqual(admissionsOnly(yield* advance("clock")), []);
          const captured = yield* reservationOf(reservationId);
          assert.deepStrictEqual(
            [captured?.state, captured?.custody],
            ["held", { state: "unknown", reasons: ["process_containment_unsupported"] }],
          );
          // Its own boot read later, as after a resume or a T3 restart alone, proves nothing.
          yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
          const sameBoot = yield* terminate(
            reservationId,
            "verify",
            hostBoot("20", beforeRestart.uptimeMs + 3_600_000),
          );
          assert.includeMembers(
            [...sameBoot.refusals],
            ["same_boot", "uptime_not_reset", "container_not_ended"],
          );
          assert.isFalse(
            (yield* terminate(reservationId, "verify", afterRestart, sameBoot.evidenceDigest))
              .applied,
          );
          // Nor does another host, or a proof named for another operation.
          yield* restartHost;
          assert.include(
            (yield* terminate(reservationId, "verify", {
              ...afterRestart,
              machineId: "machine:copy",
            })).refusals,
            "foreign_host",
          );
          assert.include(
            (yield* terminate(reservationId, "verify", afterRestart, undefined, "restart:other"))
              .refusals,
            "operation_mismatch",
          );

          // A later boot of the same host: the proof is recorded once, however often confirmed.
          const runsBefore = yield* runCount(execution.threadId);
          const proof = yield* terminate(reservationId, "verify", afterRestart);
          assert.deepStrictEqual(proof.refusals, []);
          const [left, right] = yield* Effect.all(
            [
              terminate(reservationId, "verify", afterRestart, proof.evidenceDigest),
              terminate(reservationId, "verify", afterRestart, proof.evidenceDigest),
            ],
            { concurrency: 2 },
          );
          assert.deepStrictEqual([left.applied, right.applied].toSorted(), [false, true]);
          assert.include((left.applied ? right : left).refusals, "already_proved");
          assert.deepStrictEqual((yield* reservationOf(reservationId))?.custody, {
            state: "quiescent",
            reasons: ["descendants_ended", "host_restarted"],
          });

          // Normal settlement releases it and admits its next stage: an independent review, never
          // a claim that it was reviewed, and no relaunch of the implement stage.
          const review = admittedBy(yield* advance("owner_decision"));
          assert.deepStrictEqual(stageOf(review), [itemKeyFor(7861), "review"]);
          const released = yield* reservationOf(reservationId);
          assert.deepStrictEqual(
            [released?.state, released?.releasedReason],
            ["released", "outcome_verified"],
          );
          assert.deepStrictEqual(yield* itemHistory(7861), ["implement", "implemented", "review"]);
          assert.strictEqual(yield* runCount(execution.threadId), runsBefore);

          // Later passes and a restart never relaunch the implement stage or its thread.
          yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
          for (const trigger of ["restart", "clock", "owner_decision"] as const) {
            assert.deepStrictEqual(
              admissionsOnly(yield* advance(trigger))
                .map(stageOf)
                .filter((stage) => stage?.[1] !== "review"),
              [],
            );
          }
          const history = yield* itemHistory(7861);
          assert.deepStrictEqual(history.slice(0, 2), ["implement", "implemented"]);
          assert.notInclude(history.slice(2), "implement");
          assert.notInclude(history, "review_passed");
          assert.strictEqual(yield* runCount(execution.threadId), runsBefore);
          assert.deepStrictEqual(
            (yield* terminate(reservationId, "verify", afterRestart, proof.evidenceDigest))
              .refusals,
            ["not_held_admitted"],
          );
        }),
      ),
    ),
);

it.effect("Termination/T2: a passing review proved ended is integrated and closed, once", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { reservationId } = yield* historicalAt(7871, "review");
        const graph = yield* GitGraphFake;
        // Its accepted review is not integrated while its writer is unproved.
        assert.strictEqual(graph.writes.length, 0);
        yield* captureTermination(reservationId);
        yield* restartHost;
        yield* proveTermination(reservationId);
        yield* advance("owner_decision");
        assert.strictEqual(graph.writes.length, 1);
        assert.strictEqual(yield* dispositionOf(7871), "done");
        assert.deepStrictEqual((yield* itemHistory(7871)).slice(-4), [
          "review",
          "review_passed",
          "integrated",
          "closed",
        ]);
        yield* advance("clock");
        assert.strictEqual(graph.writes.length, 1);
      }),
    ),
  ),
);

it.effect("Termination/T3: a correction proved ended goes on to its rework", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { reservationId } = yield* historicalAt(7881, "correct");
        yield* captureTermination(reservationId);
        yield* restartHost;
        yield* proveTermination(reservationId);
        const rework = admittedBy(yield* advance("owner_decision"));
        assert.deepStrictEqual(stageOf(rework), [itemKeyFor(7881), "rework"]);
        assert.deepStrictEqual((yield* itemHistory(7881)).slice(-3), [
          "correct",
          "correction_spec",
          "rework",
        ]);
      }),
    ),
  ),
);

it.effect(
  "Termination/T4: a later launch, an unread host, or live and unreported work is never covered",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, reservationId } = yield* historicalAt(7891, "implement");
          assert.include(
            (yield* terminate(reservationId, "capture", null)).refusals,
            "host_boot_unreadable",
          );
          yield* captureTermination(reservationId);
          // A wake after the capture: the fence refuses it, but its launch was claimed after the
          // capture, so that capture covers nothing now.
          yield* dispatchProviderContinuation(execution.threadId, "after-capture");
          yield* runEffects;
          yield* restartHost;
          const stale = yield* terminate(reservationId, "verify", afterRestart);
          assert.include(stale.refusals, "execution_changed");
          assert.isFalse(
            (yield* terminate(reservationId, "verify", afterRestart, stale.evidenceDigest)).applied,
          );
          assert.deepStrictEqual((yield* reservationOf(reservationId))?.custody, {
            state: "unknown",
            reasons: ["process_containment_unsupported"],
          });

          // A stage running now, under the process that admitted it, has nothing to capture.
          yield* seedIssue(7893);
          const quarantined = yield* quarantine(reservationId, "enter");
          assert.isTrue(
            (yield* quarantine(reservationId, "enter", quarantined.evidenceDigest)).applied,
          );
          const running = yield* startStage(admittedBy(yield* advance("clock")));
          const live = FactoryReservationId.make(`reservation:${running.commandId}`);
          assert.includeMembers(
            [...(yield* terminate(live, "capture", beforeRestart)).refusals],
            ["run_not_terminal", "custody_not_unproved", "admitted_by_this_process"],
          );
          // Ended without a report, under an earlier process: an ambiguous writer.
          (yield* ScriptedJoinTarget).skip = true;
          yield* completeLatestRun(running.threadId);
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE factory_reservations SET record_json = json_set(record_json, '$.admittedIn', 'serving:deployed') WHERE reservation_id = ${live}`;
          const unreported = yield* terminate(live, "capture", beforeRestart);
          assert.include(unreported.refusals, "no_verified_report");
          assert.isFalse(
            (yield* terminate(live, "capture", beforeRestart, unreported.evidenceDigest)).applied,
          );
          assert.deepStrictEqual(
            (yield* terminate(
              FactoryReservationId.make("reservation:missing"),
              "capture",
              beforeRestart,
            )).refusals,
            ["unknown_reservation"],
          );
        }),
      ),
    ),
);

it.effect(
  "Termination/T5: a local restart never proves a historical writer no retained provenance places on that host",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { execution, reservationId } = yield* historicalAt(7901, "implement");
          const unknown = { state: "unknown", reasons: ["process_containment_unsupported"] };
          // The reviewer's R1 order on the production source: a local driver, capture on boot 20
          // and verify on boot 21 of one host, any operationRef. Nothing retained says where its
          // writers ran, so neither binds, whatever the caller writes in its own strings.
          const forged = JSON.stringify({ host: { machineId: "machine:test-host" } });
          for (const ref of [operationRef, forged]) {
            const read = yield* terminate(
              reservationId,
              "capture",
              beforeRestart,
              undefined,
              ref,
              "none",
            );
            assert.include(read.refusals, "historical_provenance_missing");
            assert.isFalse(
              (yield* terminate(
                reservationId,
                "capture",
                beforeRestart,
                read.evidenceDigest,
                ref,
                "none",
              )).applied,
            );
          }
          // A database copied from another host, a delegated or persistent writer, or a record
          // missing a provider session: capture and verify on this host agree, and still refuse.
          for (const [change, refusal] of [
            [
              { host: { platform: "win32", machineId: "machine:origin" } },
              "historical_host_foreign",
            ],
            [
              { executors: [{ kind: "delegated", machineId: "machine:test-host" }] },
              "executor_not_local",
            ],
            [
              { executors: [{ kind: "persistent", machineId: "machine:test-host" }] },
              "executor_not_local",
            ],
            [{ providerSessions: ["session:unlisted"] }, "provenance_sessions_incomplete"],
            [{ operationRef: "restart:other" }, "provenance_operation_mismatch"],
          ] as const) {
            const read = yield* terminate(
              reservationId,
              "capture",
              beforeRestart,
              undefined,
              operationRef,
              change,
            );
            assert.include(read.refusals, refusal);
            assert.isFalse(
              (yield* terminate(
                reservationId,
                "capture",
                beforeRestart,
                read.evidenceDigest,
                operationRef,
                change,
              )).applied,
            );
          }
          const refused = yield* reservationOf(reservationId);
          assert.isFalse(refused !== undefined && "historicalTermination" in refused);

          // A capture and proof an earlier build recorded with no provenance cover nothing: the
          // stage stays held and unknown, and its item does not move on.
          const sql = yield* SqlClient.SqlClient;
          const unbound = {
            capture: {
              by: "owner",
              reason: "earlier build",
              operationRef,
              evidenceDigest: "e",
              evidence: "{}",
              executionDigest: "x",
              servingId: "serving:deployed",
              host: beforeRestart,
              covers: {
                attempts: (yield* (yield* ProjectionStore.ProjectionStoreV2).getThreadProjection(
                  execution.threadId,
                )).attempts.map((attempt) => attempt.id),
                launches: [],
                generations: [],
              },
              capturedAt: "2026-10-30T03:00:00Z",
            },
            proof: {
              by: "owner",
              reason: "earlier build",
              evidenceDigest: "v",
              evidence: "{}",
              servingId: "serving:deployed",
              host: afterRestart,
              provedAt: "2026-10-30T04:00:00Z",
            },
          };
          yield* sql`UPDATE factory_reservations SET record_json = json_set(record_json, '$.historicalTermination', json(${JSON.stringify(unbound)})) WHERE reservation_id = ${reservationId}`;
          yield* restartHost;
          const runsBefore = yield* runCount(execution.threadId);
          assert.deepStrictEqual(admissionsOnly(yield* advance("owner_decision")), []);
          const held = yield* reservationOf(reservationId);
          assert.deepStrictEqual([held?.state, held?.custody], ["held", unknown]);
          assert.deepStrictEqual(yield* itemHistory(7901), ["implement", "implemented"]);
          assert.strictEqual(yield* runCount(execution.threadId), runsBefore);
        }),
      ),
    ),
);

it.effect("Termination/T6: provenance read at verify must be the one its capture bound", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { reservationId } = yield* historicalAt(7911, "implement");
        yield* captureTermination(reservationId);
        yield* restartHost;
        const moved = yield* terminate(
          reservationId,
          "verify",
          afterRestart,
          undefined,
          operationRef,
          { source: "another-producer" },
        );
        assert.include(moved.refusals, "provenance_changed");
        const missing = yield* terminate(
          reservationId,
          "verify",
          afterRestart,
          undefined,
          operationRef,
          "none",
        );
        assert.includeMembers(
          [...missing.refusals],
          ["historical_provenance_missing", "provenance_changed"],
        );
        assert.deepStrictEqual((yield* reservationOf(reservationId))?.custody, {
          state: "unknown",
          reasons: ["process_containment_unsupported"],
        });
        // The bound provenance, unchanged: proved once, as T1 shows.
        yield* proveTermination(reservationId);
      }),
    ),
  ),
);

/** What the latest pass recorded for an item: its disposition, reason class and detail. */
const recordOf = (issueNumber: number) =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    return state.lastCollection.find((record) => record.itemKey === itemKeyFor(issueNumber));
  });

/** Lands `issueNumber` through T3's own build, independent review, integration and closure. */
const landThroughT3 = (
  issueNumber: number,
  commit: string,
  admitted?: FactoryLifecycle.FactoryAdmissionResult,
) =>
  Effect.gen(function* () {
    yield* recordCommit(commit, [lifecycleBase]);
    yield* workStage(admitted ?? admittedBy(yield* advance("tracker_event", 1)), {
      outcome: "implemented",
      subject: { ...subjectFor(commit, lifecycleBase), branch: `t3-factory/${issueNumber}` },
      summary: `Implemented ${issueNumber}.`,
    });
    yield* workStage(admittedBy(yield* advance("outcome")), {
      outcome: "review_passed",
      subject: subjectFor(commit),
      summary: "Passes.",
    });
    yield* advance("outcome");
    assert.deepStrictEqual((yield* itemHistory(issueNumber)).slice(-2), ["integrated", "closed"]);
    const [integrated] = (yield* integrationOf(issueNumber)).outcomes;
    return integrated!.report.integration!;
  });

const verifierExecution = {
  modelSelection: rosterSelection,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};

/**
 * A proof item whose prerequisite landed through T3, which failed and was corrected, with the
 * template Root adopted for it and a policy that proposes its rerun with that pointer only.
 */
const setUpBoundProof = (
  issue: number,
  prerequisite: number,
  commit: string,
  // The issue's own scope declaration and the files the adopted template binds to it.
  scope: { readonly body: string; readonly owned: ReadonlyArray<string> } = {
    body: `Rerun the settlement proof.\n\n## Owned files\n\nNone\n`,
    owned: [],
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* configureLifecycleFactory;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const templates = path.join(root, "templates");
    const outputs = path.join(root, "outputs");
    yield* fs.makeDirectory(path.join(templates, "inputs"), { recursive: true });
    yield* fs.makeDirectory(outputs, { recursive: true });
    const input = path.join(templates, "inputs", "fixture.json");
    yield* fs.writeFileString(input, '{"settlement":"fixture"}');
    // Root adopts stable semantics once; it names no landing, failure or output.
    const writeTemplate = (name: string, change: Record<string, unknown> = {}) =>
      Effect.gen(function* () {
        const text = JSON.stringify({
          schema: "factory-verification-template/1",
          issue,
          prerequisite,
          worker: { execution: "verifier" },
          auth: { identity: "verifier@example.invalid" },
          inputs: [{ path: "inputs/fixture.json", sha256: sha256('{"settlement":"fixture"}') }],
          consumer: { contract: "settlement-proof", version: "1" },
          policyIdentity: "policy-r1",
          ownership: { owned: scope.owned },
          ...change,
        });
        yield* fs.writeFileString(path.join(templates, name), text);
        return { root: templates, path: name, sha256: sha256(text) };
      });
    const template = yield* writeTemplate(`${issue}.json`);
    const authority = {
      templateRoot: templates,
      outputBase: outputs,
      consumers: [{ contract: "settlement-proof", version: "1" }],
      identities: {
        verifier: {
          identity: "verifier@example.invalid",
          observe: { email: "verifier@example.invalid" },
        },
      } as Record<
        string,
        { readonly identity: string; readonly observe: { readonly email?: string } }
      >,
    };
    const reconfigure = (verification: Partial<typeof authority> = {}) =>
      configureFactory(
        lifecycleConfiguration({
          executionChoices: { verifier: verifierExecution },
          verification: { ...authority, ...verification },
        }),
      );
    yield* reconfigure();

    // The correction lands through T3; the proof item then fails and is corrected.
    yield* seedIssue(prerequisite);
    const landed = yield* landThroughT3(prerequisite, commit);
    yield* seedIssue(prerequisite + 1, { state: "closed" });
    // A verification-only unit declares that it owns no file, as HSA writes it.
    yield* seedIssue(issue, { blockerNumbers: [prerequisite, prerequisite + 1], body: scope.body });
    yield* workStage(admittedBy(yield* advance("tracker_event", 1)), {
      outcome: "failed",
      failure: "settlement check failed",
      summary: "Verification failed.",
    });

    // The policy proposes the rerun on the landed commit with its template pointer only.
    const proposal: {
      pointer: typeof template;
      execution: string;
      baseRef: string;
      grant?: { readonly reason: string; readonly evidenceDigest: string };
    } = {
      pointer: template,
      execution: "verifier",
      baseRef: landed.mergeCommit,
    };
    yield* usePolicy((input) =>
      input.observation.itemKey === itemKeyFor(issue) && input.stage.type === "rework"
        ? Effect.map(stageRequest(input), (request) =>
            request !== undefined && "taskKind" in request
              ? {
                  ...request,
                  execution: proposal.execution,
                  workspaceStrategy: {
                    type: "worktree" as const,
                    baseRef: proposal.baseRef,
                    startFromOrigin: false,
                  },
                  verificationBinding: proposal.pointer,
                  ...(proposal.grant === undefined ? {} : { requiresGrant: proposal.grant }),
                }
              : request,
          )
        : stageRequest(input),
    );
    yield* workStage(admittedBy(yield* advance("outcome")), {
      outcome: "correction_spec",
      summary: "Rerun the settlement proof on the landed correction.",
    });
    const failedId = (yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).itemEvents({
      factoryId,
      itemKey: itemKeyFor(issue),
    })).findLast((event) => event.type === "outcome" && event.kind === "failed")!;
    const failedOutcomeId = failedId.type === "outcome" ? failedId.outcomeId : "";

    return {
      fs,
      path,
      input,
      outputs,
      template,
      writeTemplate,
      reconfigure,
      landed,
      proposal,
      failedOutcomeId,
    };
  });

it.effect(
  "Binding/B1: a landed correction binds its proof from the adopted template once; any changed identity, input, consumer, policy or base waits before launch",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const {
            fs,
            path,
            input,
            outputs,
            template,
            writeTemplate,
            reconfigure,
            landed,
            proposal,
            failedOutcomeId,
          } = yield* setUpBoundProof(7501, 7502, "c0007502");
          const refusedWith = (detail: string, reasonClass = "needs_routing") =>
            Effect.gen(function* () {
              assert.deepStrictEqual(admissionsOnly(yield* advance("clock")), []);
              const record = yield* recordOf(7501);
              assert.deepStrictEqual(
                [record?.disposition, record?.reasonClass],
                ["nothing_proposed", reasonClass],
              );
              assert.include(record?.detail ?? "", detail);
              assert.match(
                record?.detail ?? "",
                /^#7501 waits \[[0-9a-f]{12}\]: .* Actor: .* Resume: /,
              );
            });

          // Tracker closure alone is no landing: this blocker was closed outside T3.
          proposal.pointer = yield* writeTemplate("7503.json", { prerequisite: 7503 });
          yield* refusedWith(
            "#7503 has not landed: it has no verified implemented head",
            "waiting",
          );
          proposal.pointer = template;
          // Configured authority, not the template, decides identity and consumer meaning.
          yield* reconfigure({
            identities: {
              verifier: {
                identity: "other@example.invalid",
                observe: { email: "other@example.invalid" },
              },
            },
          });
          yield* refusedWith("configured as other@example.invalid");
          yield* reconfigure({ identities: {} });
          yield* refusedWith("declares no account identity for execution verifier");
          yield* reconfigure({ consumers: [] });
          yield* refusedWith("is not one Root declared", "held");
          yield* reconfigure();
          // The worker the template names, not one the policy prefers.
          proposal.execution = "builder";
          yield* refusedWith("binding names execution verifier");
          proposal.execution = "verifier";
          // Inputs are rehashed, not trusted.
          yield* fs.writeFileString(input, '{"settlement":"changed"}');
          yield* refusedWith("input inputs/fixture.json is unreadable");
          yield* fs.writeFileString(input, '{"settlement":"fixture"}');
          proposal.pointer = yield* writeTemplate("stale-policy.json", {
            policyIdentity: "policy-r0",
          });
          yield* refusedWith("binding names policy policy-r0");
          proposal.pointer = { ...template, sha256: "0".repeat(64) };
          yield* refusedWith("not sha256 0000");
          proposal.pointer = template;
          proposal.baseRef = lifecycleBase;
          yield* refusedWith(`would not start at landed commit ${landed.mergeCommit}`);
          proposal.baseRef = landed.mergeCommit;
          // The scope is the issue's own declaration: one that owns more, or one T3 cannot read,
          // waits; the binding never widens it.
          const proofIssue = (yield* GitHubFake).issues.get(issueKey(claimRepository, 7501))!;
          const declared = proofIssue.body;
          proofIssue.body = "Rerun the proof.\n\n## Owned files\n\n- `src/app.py`\n";
          yield* refusedWith("which is not exactly what #7501 declares");
          proofIssue.body = "<!-- connector-unit writes=src/ effort=high -->\nRerun the proof.";
          yield* refusedWith("which is not exactly what #7501 declares");
          proofIssue.body = `<!-- connector-unit writes=src/ -->\n${declared}`;
          yield* refusedWith("declares no owned files in a notation T3 reads");
          proofIssue.body = declared;
          // Earlier output in the derived directory is never written over.
          const outputRoot = path.join(
            outputs,
            outputRootName({
              issue: 7501,
              itemKey: itemKeyFor(7501),
              failedOutcomeId,
              commit: landed.mergeCommit,
              templateSha256: template.sha256,
            }),
          );
          yield* fs.makeDirectory(outputRoot);
          yield* fs.writeFileString(path.join(outputRoot, "earlier.json"), "{}");
          yield* refusedWith("is not a new empty directory");
          yield* fs.remove(outputRoot, { recursive: true });

          // Everything holds: the proof is admitted once, on its derived binding and output root,
          // and starts once its provider reports the adopted account and its worktree the landing.
          const launch = yield* LaunchFake;
          launch.head = { commit: landed.mergeCommit, tree: landed.tree };
          const startsBefore = (yield* startedTurns).length;
          const admitted = admittedBy(yield* advance("clock"));
          assert.deepStrictEqual(stageOf(admitted), [itemKeyFor(7501), "rework"]);
          const basis =
            admitted.reservation.origin === "admitted"
              ? admitted.reservation.stageBasis
              : undefined;
          assert.match(basis ?? "", /^rework:.+\|vb:[0-9a-f]{32}\|out:[0-9a-f]{32}$/);
          for (const trigger of ["clock", "restart", "owner_decision"] as const) {
            assert.deepStrictEqual(admissionsOnly(yield* advance(trigger)), []);
          }
          assert.strictEqual(
            (yield* itemHistory(7501)).filter((entry) => entry === "rework").length,
            1,
          );
          assert.strictEqual((yield* startedTurns).length - startsBefore, 1);
          assert.isAbove(launch.refreshes, 0);
          void input;
        }),
      ),
    ),
);

/** The reason T3 gave for a run of this admission that never reached its provider. */
const startRefusalOf = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
  Effect.gen(function* () {
    const { threadId } = admittedExecution(admission);
    const projection = yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(threadId);
    return projection.turnItems.flatMap((item) =>
      item.type === "error" && item.failure !== undefined ? [item.failure.message] : [],
    );
  });

type LaunchFault = (
  proof: Effect.Success<ReturnType<typeof setUpBoundProof>>,
) => Effect.Effect<void, never, LaunchFake | PreparationFake | GitHubFake>;

/**
 * Between admission and first use, one thing a bound verification rests on changes, or what the
 * provider and worktree report does not match. Each refuses before any provider starts.
 */
const launchFaults: ReadonlyArray<readonly [string, number, LaunchFault, string]> = [
  [
    "an unauthenticated account",
    7520,
    () => Effect.map(LaunchFake, (launch) => void (launch.auth = { status: "unauthenticated" })),
    "provider_not_authenticated",
  ],
  [
    "another account",
    7523,
    () =>
      Effect.map(
        LaunchFake,
        (launch) =>
          void (launch.auth = { status: "authenticated", email: "someone@example.invalid" }),
      ),
    "provider_identity_mismatch",
  ],
  [
    "an endpoint that reports no account",
    7526,
    () => Effect.map(LaunchFake, (launch) => void (launch.auth = { status: "authenticated" })),
    "provider_identity_mismatch",
  ],
  [
    "a worktree at another commit",
    7529,
    () =>
      Effect.map(
        LaunchFake,
        (launch) => void (launch.head = { ...launch.head!, commit: "c0000000" }),
      ),
    "binding_worktree_mismatch",
  ],
  [
    "an input changed while preparing",
    7532,
    (proof) =>
      Effect.map(PreparationFake, (preparation) => {
        preparation.beforeRelease = proof.fs
          .writeFileString(proof.input, '{"settlement":"changed"}')
          .pipe(Effect.orDie);
      }),
    "binding_refused",
  ],
  [
    "a template replaced while preparing",
    7535,
    (proof) =>
      Effect.map(PreparationFake, (preparation) => {
        preparation.beforeRelease = proof.fs
          .writeFileString(proof.path.join(proof.template.root, proof.template.path), "{}")
          .pipe(Effect.orDie);
      }),
    "binding_refused",
  ],
  [
    "an issue edited while preparing",
    7538,
    () =>
      Effect.gen(function* () {
        const github = yield* GitHubFake;
        const preparation = yield* PreparationFake;
        preparation.beforeRelease = Effect.sync(() => {
          github.issues.get(issueKey(claimRepository, 7538))!.body = "Edited scope.";
        });
      }),
    "binding_scope_changed",
  ],
];

it.effect.each(launchFaults)("Binding/B2: %s starts no provider", ([, issue, fault, reason]) =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const proof = yield* setUpBoundProof(issue, issue + 1, `c000${issue}`);
        const launch = yield* LaunchFake;
        launch.head = { commit: proof.landed.mergeCommit, tree: proof.landed.tree };
        yield* fault(proof);
        const startsBefore = (yield* startedTurns).length;
        const admitted = admittedBy(yield* advance("clock", 2));
        assert.deepStrictEqual(stageOf(admitted), [itemKeyFor(issue), "rework"]);
        assert.strictEqual((yield* startedTurns).length - startsBefore, 0);
        assert.isTrue(
          (yield* startRefusalOf(admitted)).some((message) => message.includes(reason)),
          JSON.stringify(yield* startRefusalOf(admitted)),
        );
      }),
    ),
  ),
);

const connectorScope = {
  body: "Rerun the send-path proof.\n\n<!-- connector-unit writes=tests/proof/ edits=tests/proof/check.py effort=medium -->\n",
  owned: ["tests/proof/"],
};

it.effect(
  "Binding/B4: a connector unit's writes reservation is the bound scope; its edits, a mixed or duplicated declaration never are",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const proof = yield* setUpBoundProof(7580, 7581, "c0007580", connectorScope);
          const launch = yield* LaunchFake;
          launch.head = { commit: proof.landed.mergeCommit, tree: proof.landed.tree };
          const waitsOn = (detail: string) =>
            Effect.gen(function* () {
              const startsBefore = (yield* startedTurns).length;
              assert.deepStrictEqual(admissionsOnly(yield* advance("clock")), []);
              assert.include((yield* recordOf(7580))?.detail ?? "", detail);
              assert.strictEqual((yield* startedTurns).length, startsBefore);
            });
          // The narrower edit authority is not the reservation the binding must name.
          const template = proof.proposal.pointer;
          proof.proposal.pointer = yield* proof.writeTemplate("7580-edits.json", {
            ownership: { owned: ["tests/proof/check.py"] },
          });
          yield* waitsOn("which is not exactly what #7580 declares");
          proof.proposal.pointer = template;
          // A declaration with a field twice, or beside another notation, is no scope at all.
          const proofIssue = (yield* GitHubFake).issues.get(issueKey(claimRepository, 7580))!;
          proofIssue.body =
            "<!-- connector-unit writes=tests/proof/ writes=src/ effort=medium -->\nRerun the proof.";
          yield* waitsOn("declares no owned files in a notation T3 reads");
          proofIssue.body = `${connectorScope.body}\n## Owned files\n\n- \`tests/proof/check.py\`\n`;
          yield* waitsOn("declares no owned files in a notation T3 reads");
          proofIssue.body = connectorScope.body;
          // Exactly the reservation: admitted once, and its provider starts once.
          const startsBefore = (yield* startedTurns).length;
          const admitted = admittedBy(yield* advance("clock"));
          assert.deepStrictEqual(stageOf(admitted), [itemKeyFor(7580), "rework"]);
          assert.strictEqual((yield* startedTurns).length - startsBefore, 1);
          assert.deepStrictEqual(admissionsOnly(yield* advance("restart")), []);
        }),
      ),
    ),
);

it.effect("Binding/B5: a connector reservation narrowed while preparing starts no provider", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const proof = yield* setUpBoundProof(7590, 7591, "c0007590", connectorScope);
        const launch = yield* LaunchFake;
        launch.head = { commit: proof.landed.mergeCommit, tree: proof.landed.tree };
        const github = yield* GitHubFake;
        const preparation = yield* PreparationFake;
        preparation.beforeRelease = Effect.sync(() => {
          github.issues.get(issueKey(claimRepository, 7590))!.body =
            "<!-- connector-unit writes=tests/proof/check.py effort=medium -->\nRerun the proof.";
        });
        const startsBefore = (yield* startedTurns).length;
        const admitted = admittedBy(yield* advance("clock", 2));
        assert.deepStrictEqual(stageOf(admitted), [itemKeyFor(7590), "rework"]);
        assert.strictEqual((yield* startedTurns).length - startsBefore, 0);
        assert.isTrue(
          (yield* startRefusalOf(admitted)).some((message) =>
            message.includes("binding_scope_changed"),
          ),
        );
      }),
    ),
  ),
);

it.effect(
  "Binding/B3: a supervised proof spends its own binding's grant once; a changed binding cannot spend it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const proof = yield* setUpBoundProof(7550, 7551, "c0007550");
          const launch = yield* LaunchFake;
          launch.head = { commit: proof.landed.mergeCommit, tree: proof.landed.tree };
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const store = yield* FactoryStore.FactoryStore;
          const grantRequests = Effect.map(outcomes.reservedDecisions(factoryId), (decisions) =>
            decisions.filter(
              (decision) => decision.itemKey === itemKeyFor(7550) && decision.kind === "grant",
            ),
          );
          proof.proposal.grant = {
            reason: "Run the supervised proof",
            evidenceDigest: "grant-evidence",
          };
          assert.deepStrictEqual(admissionsOnly(yield* advance("clock")), []);
          // Unchanged passes ask nothing again.
          yield* advance("clock");
          const [request, ...more] = yield* grantRequests;
          assert.deepStrictEqual(more, []);
          assert.include(request!.reason, "verification binding");
          assert.isTrue(
            yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: request!.decisionId,
              answer: "grant",
              by: "owner",
              grantUnits: 2,
            }),
          );
          // The same evidence text for another binding is another request; the grant stays whole.
          const original = proof.proposal.pointer;
          proof.proposal.pointer = yield* proof.writeTemplate("7550-copy.json");
          assert.deepStrictEqual(admissionsOnly(yield* advance("clock")), []);
          assert.strictEqual(yield* dispositionOf(7550), "awaiting_grant");
          const requests = yield* grantRequests;
          const pending = requests.filter((decision) => decision.state === "pending");
          assert.strictEqual(pending.length, 1);
          assert.notStrictEqual(pending[0]!.evidenceDigest, request!.evidenceDigest);
          const grantOf = Effect.map(store.listGrants(factoryId), (grants) =>
            grants.find((grant) => grant.decisionId === request!.decisionId)!,
          );
          assert.strictEqual((yield* grantOf).remaining, 2);
          // Its own binding spends one unit, once, however passes race or the server restarts.
          proof.proposal.pointer = original;
          // Two collections at once: one runs, the other coalesces into it.
          const raced = yield* Effect.all(
            [
              factory.reconcile({ factoryId, trigger: "clock" }),
              factory.reconcile({ factoryId, trigger: "owner_decision" }),
            ],
            { concurrency: 2 },
          );
          yield* runEffects;
          assert.strictEqual(
            raced
              .flatMap((result) => (result.type === "collected" ? result.admissions : []))
              .filter((admission) => admission.type === "admitted").length,
            1,
          );
          for (const trigger of ["restart", "clock"] as const) yield* advance(trigger);
          const spent = yield* grantOf;
          assert.deepStrictEqual([spent.remaining, spent.spentBy.length], [1, 1]);
          assert.strictEqual(
            (yield* itemHistory(7550)).filter((entry) => entry === "rework").length,
            1,
          );
        }),
      ),
    ),
);

it.effect(
  "Waits/W1: a wait persists once across passes and restart, is superseded on change, and ends on progress",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const proof = yield* setUpBoundProof(7560, 7561, "c0007560");
          const launch = yield* LaunchFake;
          launch.head = { commit: proof.landed.mergeCommit, tree: proof.landed.tree };
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const waitsOf = Effect.map(factory.readState({ factoryId }), (state) =>
            state.waits.filter((wait) => wait.itemKey === itemKeyFor(7560)),
          );
          const waitRecords = Effect.map(
            outcomes.itemRecords({ factoryId, itemKey: itemKeyFor(7560) }),
            (records) => records.filter(({ record }) => record.type === "waiting"),
          );
          yield* proof.reconfigure({ identities: {} });
          assert.deepStrictEqual(admissionsOnly(yield* advance("clock")), []);
          const [first] = yield* waitsOf;
          assert.include(first!.detail, "declares no account identity");
          assert.strictEqual(first!.reasonClass, "needs_routing");
          // Unchanged: later passes, a restart and time passing keep the one record and its first-seen.
          yield* TestClock.adjust("1 hour");
          for (const trigger of ["clock", "restart", "owner_decision"] as const) {
            yield* advance(trigger);
          }
          assert.strictEqual((yield* waitRecords).length, 1);
          assert.deepStrictEqual(yield* waitsOf, [first]);
          // Another reason is another wait; the first stays in history.
          yield* proof.reconfigure({ consumers: [] });
          yield* advance("clock");
          const [changed] = yield* waitsOf;
          assert.include(changed!.detail, "is not one Root declared");
          assert.strictEqual(changed!.supersedes, first!.basis);
          assert.notStrictEqual(changed!.firstSeenAt, first!.firstSeenAt);
          assert.strictEqual((yield* waitRecords).length, 2);
          // Resolved: the proof is admitted once and no stale wait hides that progress.
          yield* proof.reconfigure();
          admittedBy(yield* advance("clock"));
          assert.deepStrictEqual(yield* waitsOf, []);
          yield* advance("restart");
          assert.deepStrictEqual(yield* waitsOf, []);
          assert.strictEqual((yield* waitRecords).length, 2);
        }),
      ),
    ),
);

it.effect(
  "Parent/P1: a parent closes once under project authority when its own records prove every required clause, never on membership",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* configureLifecycleFactory;
          const criteriaRoot = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
          const reconfigure = (close: "project" | "owner") =>
            configureFactory(lifecycleConfiguration({ parents: { close, criteriaRoot } }));
          yield* reconfigure("project");
          const parent = yield* seedIssue(7601, { body: "Export settlements.\n\n## Acceptance" });
          const text = JSON.stringify({
            schema: "factory-parent-criteria/1",
            issue: 7601,
            version: "v1",
            bodySha256: sha256(parent.body),
            clauses: [
              {
                id: "C1",
                required: true,
                source: { kind: "issue-body", ref: "## Acceptance 1" },
                evidence: [
                  { itemKey: `github:${claimRepository}#7602`, scope: "settlement export" },
                ],
              },
              { id: "C2", required: true, source: { kind: "issue-body", ref: "## Acceptance 2" } },
              { id: "C3", required: false, source: { kind: "comment", ref: "nice to have" } },
              {
                id: "C4",
                required: true,
                source: { kind: "issue-body", ref: "## Acceptance 4" },
                state: "revised",
              },
            ],
          });
          yield* fs.writeFileString(path.join(criteriaRoot, "7601.json"), text);
          const criteria = { root: criteriaRoot, path: "7601.json", sha256: sha256(text) };
          const token = criterionToken(7601, "C2");
          // The parent is never built: its policy asks only for closure, or for one clause child.
          const parentAsks = { spawn: false };
          yield* usePolicy((input) =>
            input.observation.itemKey !== itemKeyFor(7601)
              ? stageRequest(input)
              : Effect.succeed(
                  parentAsks.spawn
                    ? {
                        type: "spawn" as const,
                        reason: "clause C2 is the smallest authorized missing criterion",
                        ticket: {
                          title: `#7601 ${token} Add the settlement export check`,
                          body: "Bounded child for clause C2.",
                          labels: ["ready"],
                          parentIssueNumber: 7601,
                          blocks: [],
                        },
                      }
                    : { type: "proceed" as const, parentClosure: { criteria } },
                ),
          );
          const waitsOn = (detail: string) =>
            Effect.gen(function* () {
              const record = yield* recordOf(7601);
              assert.deepStrictEqual(
                [record?.disposition, record?.reasonClass],
                ["nothing_proposed", "parent"],
                `${detail} / ${record?.detail}`,
              );
              assert.include(record?.detail ?? "", detail);
              assert.strictEqual(
                (yield* GitHubFake).issues.get(issueKey(claimRepository, 7601))!.state,
                "open",
              );
            });

          // C1's child is a sub-issue that lands through T3; C2 has no evidence yet.
          yield* seedIssue(7602, { parentNumber: 7601 });
          yield* landThroughT3(7602, "c0007602");
          yield* advance("clock");
          yield* waitsOn(
            "clause C2 is missing: no evidence item (C1=satisfied, C2=missing, C3=missing, C4=revised)",
          );

          // The one bounded child for C2 opens through the existing ticket path, under the parent.
          parentAsks.spawn = true;
          // The child is ordinary work: once opened it is admitted, while the parent only waits.
          const childBuild = admittedBy(yield* advance("clock"));
          parentAsks.spawn = false;
          const github = yield* GitHubFake;
          const child = [...github.issues.values()].find((issue) => issue.title.includes(token))!;
          assert.strictEqual(child.parentNumber, 7601);
          assert.deepStrictEqual(stageOf(childBuild), [itemKeyFor(child.number), "implement"]);
          yield* advance("clock");
          yield* waitsOn(
            `clause C2 is missing: github:${claimRepository}#${child.number}: it has no verified implemented head`,
          );

          // The child lands while the membership cannot be read whole: that closes nothing.
          const unlisted = new Set([7601]);
          github.unlistedSubIssues = unlisted;
          const patchesBefore = yield* closeRequests;
          yield* landThroughT3(child.number, "c0007603", childBuild);
          yield* advance("clock");
          yield* waitsOn("its children are unread");
          // Under owner authority, the parent waits for the owner's own approval.
          unlisted.clear();
          yield* reconfigure("owner");
          yield* advance("clock");
          yield* waitsOn("the owner has not approved closing this parent");
          assert.strictEqual((yield* closeRequests) - patchesBefore, 1);
          yield* reconfigure("project");

          // Every required clause proved: T3 closes it once, its record naming each landing.
          yield* advance("clock");
          const closed = github.issues.get(issueKey(claimRepository, 7601))!;
          assert.strictEqual(closed.state, "closed");
          const record = closed.comments.find((comment) => comment.body.includes(sha256(text)))!;
          assert.include(
            record.body,
            `Clause C1 (settlement export): github:${claimRepository}#7602 landed`,
          );
          assert.include(
            record.body,
            `Clause C2 (criterion C2 child): github:${claimRepository}#${child.number} landed`,
          );
          assert.strictEqual((yield* closeRequests) - patchesBefore, 2);
          for (const trigger of ["restart", "clock", "owner_decision"] as const)
            yield* advance(trigger);
          assert.strictEqual((yield* closeRequests) - patchesBefore, 2);
          assert.notInclude(yield* itemHistory(7601), "implement");
          // Its closure is the parent's end: done, with no integration made up for it.
          assert.strictEqual(yield* dispositionOf(7601), "done");
          assert.notInclude(yield* itemHistory(7601), "integrated");

          // Reopened, that closure no longer stands: the parent is judged again on its records and,
          // all clauses still proved, closed once more by a new operation, never the old receipt.
          closed.state = "open";
          yield* advance("clock");
          const reopened = yield* itemHistory(7601);
          assert.include(reopened, "reopened");
          assert.strictEqual(reopened.filter((entry) => entry === "closed").length, 2);
          assert.strictEqual(closed.state, "closed");
          assert.strictEqual((yield* closeRequests) - patchesBefore, 3);
          yield* advance("restart");
          assert.strictEqual((yield* closeRequests) - patchesBefore, 3);
          assert.strictEqual(yield* dispositionOf(7601), "done");
        }),
      ),
    ),
);

const pullsFor = (branch: string) =>
  Effect.map(GitHubFake, (fake) => [...fake.pulls.values()].filter((pull) => pull.head === branch));

it.effect(
  "Lifecycle/beta-PR: the reviewed head merges through its pull request after its checks pass, read back once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configurePullRequestFactory;
          yield* seedIssue(7201);
          const branch = "beta/7201-parse-dates";
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("c0007201", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: { ...subjectFor("c0007201", lifecycleBase), branch },
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("c0007201"),
            summary: "Passes.",
          });
          yield* advance("outcome", 2);
          // T3 publishes the reviewed head and opens one pull request that refers to the issue
          // without closing it. CI is still running, so nothing merges.
          const github = yield* GitHubFake;
          const graph = yield* GitGraphFake;
          assert.strictEqual(github.remoteBranches.get(branch), "c0007201");
          const [pull, ...others] = yield* pullsFor(branch);
          assert.deepStrictEqual(others, []);
          assert.include(pull!.body, "Refs #7201");
          assert.notMatch(pull!.body, /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?) #\d/i);
          assert.strictEqual(yield* dispositionOf(7201), "integrating");
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 2);
          assert.strictEqual(graph.branches.get("main"), lifecycleBase);
          assert.strictEqual((yield* pullsFor(branch)).length, 1);
          // The wait is visible on the item: what the pull request is waiting for.
          const waiting = (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
            factoryId,
          })).lastCollection.find((record) => record.itemKey === itemKeyFor(7201));
          assert.strictEqual(waiting?.disposition, "integrating");
          assert.match(waiting?.detail ?? "", /^waiting: .*awaits checks/);

          // The checks pass. The merge applies, but its answer is lost; the readback records it.
          github.checks.set("c0007201", "success");
          github.loseNextMerge = true;
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 2);
          const merge = graph.branches.get("main")!;
          assert.deepStrictEqual(graph.parents.get(merge), [lifecycleBase, "c0007201"]);
          assert.strictEqual(yield* dispositionOf(7201), "integrating");
          yield* TestClock.adjust("1 minute");
          yield* advance("operation");
          assert.strictEqual(graph.branches.get("main"), merge);
          assert.strictEqual(
            github.requests.filter((request) => request.method === "PUT").length,
            1,
          );
          const { outcomes } = yield* integrationOf(7201);
          assert.deepStrictEqual(
            outcomes.map((outcome) => [outcome.state, outcome.report.integration]),
            [
              [
                "verified",
                {
                  targetBranch: "main",
                  mergeCommit: merge,
                  parents: [lifecycleBase, "c0007201"],
                  tree: `tree-${merge}`,
                  attribution: "operation",
                  pullRequest: { repository: claimRepository, number: pull!.number },
                },
              ],
            ],
          );
          assert.strictEqual(yield* dispositionOf(7201), "done");
          assert.strictEqual(github.issues.get(issueKey(claimRepository, 7201))!.state, "closed");
          assert.strictEqual(yield* closeRequests, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: a draft pull request a worker opened at the reviewed head is made ready and merged",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configurePullRequestFactory;
          yield* seedIssue(7205);
          const branch = "beta/7205-parse-dates";
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("c0007205", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: { ...subjectFor("c0007205", lifecycleBase), branch },
            summary: "Implemented.",
          });
          // The worker pushed its head and opened a draft PR for hosted checks.
          const github = yield* GitHubFake;
          const graph = yield* GitGraphFake;
          github.remoteBranches.set(branch, "c0007205");
          github.pulls.set(github.nextPullNumber, {
            number: github.nextPullNumber,
            repository: claimRepository,
            head: branch,
            base: "main",
            title: "Draft by the worker",
            body: "Refs #7205",
            state: "open",
            merged: undefined,
            draft: true,
          });
          const number = github.nextPullNumber++;
          github.checks.set("c0007205", "success");
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("c0007205"),
            summary: "Passes.",
          });
          yield* advance("outcome", 2);
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 2);
          const [pull, ...others] = yield* pullsFor(branch);
          assert.deepStrictEqual(others, []);
          assert.strictEqual(pull!.number, number);
          assert.strictEqual(pull!.draft, false);
          const merge = graph.branches.get("main")!;
          assert.deepStrictEqual(graph.parents.get(merge), [lifecycleBase, "c0007205"]);
          yield* TestClock.adjust("1 minute");
          yield* advance("operation");
          assert.strictEqual(yield* dispositionOf(7205), "done");
          assert.strictEqual(github.issues.get(issueKey(claimRepository, 7205))!.state, "closed");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: failing checks are the work's to correct, and the rework lands through the same pull request",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configurePullRequestFactory;
          yield* seedIssue(7202);
          const item = `github:${claimRepository}#7202`;
          const branch = "beta/7202-settlement";
          const github = yield* GitHubFake;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("c0007202", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: { ...subjectFor("c0007202", lifecycleBase), branch },
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          github.checks.set("c0007202", "failure");
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("c0007202"),
            summary: "Passes.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          yield* workStage(correct, {
            outcome: "correction_spec",
            summary: "Fix the failing settlement test.",
          });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
          yield* recordCommit("c0007203", ["c0007202"]);
          github.checks.set("c0007203", "success");
          yield* workStage(rework, {
            outcome: "implemented",
            subject: { ...subjectFor("c0007203", lifecycleBase), branch },
            summary: "Reworked.",
          });
          const secondReview = admittedBy(yield* advance("outcome"));
          yield* workStage(secondReview, {
            outcome: "review_passed",
            subject: subjectFor("c0007203"),
            summary: "Passes.",
          });
          yield* advance("outcome");
          const pulls = yield* pullsFor(branch);
          assert.strictEqual(pulls.length, 1);
          assert.strictEqual(pulls[0]!.merged?.head, "c0007203");
          assert.strictEqual(yield* dispositionOf(7202), "done");
          assert.deepStrictEqual(yield* itemHistory(7202), [
            "implement",
            "implemented",
            "review",
            "review_passed",
            "failed",
            "correct",
            "correction_spec",
            "rework",
            "implemented",
            "review",
            "review_passed",
            "integrated",
            "closed",
          ]);
        }),
      ),
    ),
);

/** Verified evidence a rework reports for a head it left unchanged: it earns the head a new review. */
const sameHeadEvidence = (root: string, issueNumber: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(root, String(issueNumber), "checks.txt");
    const text = "The failing check was the base's; it passes at the same head.";
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, text);
    return [{ path: file, sha256: sha256(text) }];
  });

/**
 * The first passing review's merge fails its checks; the correction finds the failure outside the
 * head, so the rework reports the same head with verified evidence, and that head passes review
 * again.
 */
const reviewAgainAfterFailedMerge = (
  root: string,
  issueNumber: number,
  head: string,
  checksAfterRework: "success" | "failure",
) =>
  Effect.gen(function* () {
    const item = `github:${claimRepository}#${issueNumber}`;
    const branch = `beta/${issueNumber}-same-head`;
    const github = yield* GitHubFake;
    yield* configureLifecycleFactory;
    yield* configureFactory(
      lifecycleConfiguration({ integration: pullRequestIntegration, artifactRoot: root }),
    );
    yield* seedIssue(issueNumber);
    const implement = admittedBy(yield* advance("tracker_event", 1));
    yield* recordCommit(head, [lifecycleBase]);
    yield* workStage(implement, {
      outcome: "implemented",
      subject: { ...subjectFor(head, lifecycleBase), branch },
      summary: "Implemented.",
    });
    const review = admittedBy(yield* advance("outcome"));
    github.checks.set(head, "failure");
    yield* workStage(review, {
      outcome: "review_passed",
      subject: subjectFor(head),
      summary: "Passes.",
    });
    const correct = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
    yield* workStage(correct, {
      outcome: "correction_spec",
      summary: "The failing check is the base's; fix it there and report the same head.",
    });
    const rework = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
    github.checks.set(head, checksAfterRework);
    yield* workStage(rework, {
      outcome: "implemented",
      subject: { ...subjectFor(head, lifecycleBase), branch },
      summary: "The head needs no change.",
      artifacts: yield* sameHeadEvidence(root, issueNumber),
    });
    const secondReview = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(secondReview), [item, "review"]);
    yield* workStage(secondReview, {
      outcome: "review_passed",
      subject: subjectFor(head),
      summary: "Passes again.",
    });
    return branch;
  });

it.effect(
  "Lifecycle/beta-PR: a later passing review of a head whose merge failed gets its own attempt, once",
  () =>
    runIsolated(
      withScratch((root) =>
        Effect.gen(function* () {
          const github = yield* GitHubFake;
          const branch = yield* reviewAgainAfterFailedMerge(root, 7206, "c0007206", "success");
          yield* advance("outcome");
          const pulls = yield* pullsFor(branch);
          assert.strictEqual(pulls.length, 1);
          assert.strictEqual(pulls[0]!.merged?.head, "c0007206");
          assert.strictEqual(yield* dispositionOf(7206), "done");
          // Further passes start nothing: each review had exactly one attempt.
          assert.deepStrictEqual(yield* advance("operation", 3), []);
          const { operations } = yield* integrationOf(7206);
          assert.deepStrictEqual(
            operations.map((operation) => operation.state),
            ["failed", "applied"],
          );
          const [failed] = operations;
          assert.match(failed?.state === "failed" ? failed.reason : "", /^checks_failed:/);
          assert.strictEqual(
            github.requests.filter((request) => request.method === "PUT").length,
            1,
          );
          assert.deepStrictEqual(yield* itemHistory(7206), [
            "implement",
            "implemented",
            "review",
            "review_passed",
            "failed",
            "correct",
            "correction_spec",
            "rework",
            "implemented",
            "review",
            "review_passed",
            "integrated",
            "closed",
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: a later review's own failed merge is not retried for that review",
  () =>
    runIsolated(
      withScratch((root) =>
        Effect.gen(function* () {
          const branch = yield* reviewAgainAfterFailedMerge(root, 7208, "c0007208", "failure");
          yield* advance("outcome");
          yield* advance("operation", 3);
          const { operations } = yield* integrationOf(7208);
          assert.deepStrictEqual(
            operations.map((operation) => operation.state),
            ["failed", "failed"],
          );
          assert.strictEqual((yield* pullsFor(branch))[0]?.merged, undefined);
          assert.notStrictEqual(yield* dispositionOf(7208), "integrating");
          assert.deepStrictEqual((yield* itemHistory(7208)).slice(-2), ["review_passed", "failed"]);
        }),
      ),
    ),
);

/**
 * A merge waits on its checks when the owner rejects the review it was for, and the same head
 * passes review again: the item now integrates on the second review while the first's merge is
 * still under way.
 */
const reviewAgainDuringMerge = (issueNumber: number, head: string) =>
  Effect.gen(function* () {
    const item = `github:${claimRepository}#${issueNumber}`;
    const branch = `beta/${issueNumber}-under-way`;
    const implement = admittedBy(yield* advance("tracker_event", 1));
    yield* recordCommit(head, [lifecycleBase]);
    yield* workStage(implement, {
      outcome: "implemented",
      subject: { ...subjectFor(head, lifecycleBase), branch },
      summary: "Implemented.",
    });
    const review = admittedBy(yield* advance("outcome"));
    yield* workStage(review, {
      outcome: "review_passed",
      subject: subjectFor(head),
      summary: "Passes.",
    });
    yield* advance("outcome", 2);
    assert.strictEqual(yield* dispositionOf(issueNumber), "integrating");
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    const passed = (yield* outcomes.listForOrigin(review.reservation.reservationId)).find(
      (outcome) => outcome.report.outcome === "review_passed",
    );
    assert.isTrue(
      yield* (yield* FactoryLifecycle.FactoryLifecycle).rejectOutcome({
        factoryId,
        outcomeId: passed!.outcomeId,
        reason: "Reviewed against the wrong acceptance criteria.",
        by: "owner",
      }),
    );
    const again = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(again), [item, "review"]);
    yield* workStage(again, {
      outcome: "review_passed",
      subject: subjectFor(head),
      summary: "Passes against the right criteria.",
    });
    // The review's tracker record waits its turn behind the merge's next check poll.
    yield* TestClock.adjust("1 minute");
    yield* advance("outcome", 2);
    return branch;
  });

it.effect(
  "Lifecycle/beta-PR: a merge still under way for an earlier review of the same head is the only one",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configurePullRequestFactory;
          yield* seedIssue(7207);
          const github = yield* GitHubFake;
          const branch = yield* reviewAgainDuringMerge(7207, "c0007207");
          yield* advance("outcome", 3);
          assert.strictEqual((yield* integrationOf(7207)).operations.length, 1);
          assert.strictEqual(yield* dispositionOf(7207), "integrating");
          github.checks.set("c0007207", "success");
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 2);
          assert.strictEqual((yield* pullsFor(branch))[0]?.merged?.head, "c0007207");
          const { operations } = yield* integrationOf(7207);
          assert.deepStrictEqual(
            operations.map((operation) => operation.state),
            ["applied"],
          );
          assert.strictEqual(
            github.requests.filter((request) => request.method === "PUT").length,
            1,
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: an earlier review's merge failing mid-pass is recorded before a later review's attempt",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configurePullRequestFactory;
          yield* seedIssue(7209);
          const item = `github:${claimRepository}#7209`;
          const github = yield* GitHubFake;
          yield* reviewAgainDuringMerge(7209, "c0007209");
          const [attempt] = (yield* integrationOf(7209)).operations;
          assert.strictEqual(attempt?.state, "intended");
          // The effect worker ends the first merge after this pass recorded its outcomes, so the
          // pass plans the second review with that failure not yet on record.
          const operations = yield* FactoryOperationStore.FactoryOperationStore;
          github.beforeIssueRead = Effect.suspend(() => {
            github.beforeIssueRead = undefined;
            return operations.complete({
              operationId: attempt!.operationId,
              completion: { state: "failed", reason: "checks_failed: ci" },
            });
          }).pipe(Effect.asVoid, Effect.orDie);
          yield* reconcileFactory("operation");
          assert.isUndefined(github.beforeIssueRead);
          assert.strictEqual((yield* integrationOf(7209)).operations.length, 1);
          // Recorded, its failure waits on its tracker record behind the merge's check poll: still
          // unverified, it has not reached the item's stages, so the second review still waits.
          yield* advance("outcome", 2);
          assert.deepStrictEqual(
            (yield* integrationOf(7209)).outcomes.map((outcome) => outcome.state),
            ["reported"],
          );
          assert.strictEqual((yield* integrationOf(7209)).operations.length, 1);
          // Verified, the failure is the work's to correct: no attempt for the second review.
          yield* TestClock.adjust("1 minute");
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          assert.deepStrictEqual(
            (yield* integrationOf(7209)).operations.map((operation) => operation.state),
            ["failed"],
          );
        }),
      ),
    ),
);

/**
 * T3 opens the pull request at the reviewed head and waits on its checks. Meanwhile someone else
 * pushes a sibling head off the same base to its branch and merges it by hand: the content may
 * match, but nobody reviewed that head for this item.
 */
const mergeElsewhereWhileWaiting = (issueNumber: number, reviewed: string, merged: string) =>
  Effect.gen(function* () {
    const github = yield* GitHubFake;
    const graph = yield* GitGraphFake;
    const branch = `beta/${issueNumber}-merged-elsewhere`;
    yield* configurePullRequestFactory;
    yield* seedIssue(issueNumber);
    const implement = admittedBy(yield* advance("tracker_event", 1));
    yield* recordCommit(reviewed, [lifecycleBase]);
    yield* workStage(implement, {
      outcome: "implemented",
      subject: { ...subjectFor(reviewed, lifecycleBase), branch },
      summary: "Implemented.",
    });
    const review = admittedBy(yield* advance("outcome"));
    yield* workStage(review, {
      outcome: "review_passed",
      subject: subjectFor(reviewed),
      summary: "Passes.",
    });
    yield* advance("outcome", 2);
    const [pull, ...others] = yield* pullsFor(branch);
    assert.deepStrictEqual(others, []);
    assert.strictEqual(pull?.state, "open");
    assert.strictEqual(yield* dispositionOf(issueNumber), "integrating");
    yield* recordCommit(merged, [lifecycleBase]);
    const mergeCommit = `m${merged}`;
    graph.parents.set(mergeCommit, [lifecycleBase, merged]);
    graph.messages.set(mergeCommit, `Merge pull request #${pull!.number} by hand`);
    graph.branches.set("main", mergeCommit);
    github.remoteBranches.set(branch, merged);
    pull!.merged = { head: merged, commit: mergeCommit };
    pull!.state = "closed";
    return { branch, pull: pull!, mergeCommit };
  });

/** The correction names the merged head; the rework adopts `head` on the pull request's branch. */
const adoptAndReview = (issueNumber: number, branch: string, head: string) =>
  Effect.gen(function* () {
    const item = `github:${claimRepository}#${issueNumber}`;
    const correct = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
    yield* workStage(correct, {
      outcome: "correction_spec",
      summary: "The pull request merged another head; adopt it on the same branch.",
    });
    const rework = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
    yield* recordCommit(head, [lifecycleBase]);
    yield* workStage(rework, {
      outcome: "implemented",
      subject: { ...subjectFor(head, lifecycleBase), branch },
      summary: "Adopted the merged head.",
    });
    const review = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(review), [item, "review"]);
    // Reported but not yet reviewed, the merged head is not this item's integration.
    assert.deepStrictEqual(
      (yield* integrationOf(issueNumber)).operations.map((operation) => operation.state),
      ["failed"],
    );
    assert.notStrictEqual(yield* dispositionOf(issueNumber), "done");
    yield* workStage(review, {
      outcome: "review_passed",
      subject: subjectFor(head),
      summary: "Passes at exactly the merged head.",
    });
    yield* advance("outcome");
  });

const mergeRequests = Effect.map(
  GitHubFake,
  (fake) => fake.requests.filter((request) => request.method === "PUT").length,
);

it.effect(
  "Lifecycle/beta-PR: a pull request merged at another head lands only after a review of exactly that head",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const reviewed = "c0007261";
          const merged = "d0007261";
          const { branch, pull, mergeCommit } = yield* mergeElsewhereWhileWaiting(
            7261,
            reviewed,
            merged,
          );
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 2);
          const [failed] = (yield* integrationOf(7261)).operations;
          assert.strictEqual(failed?.state, "failed");
          const reason = failed?.state === "failed" ? failed.reason : "";
          assert.strictEqual(
            reason,
            `merged_elsewhere: pull request #${pull.number} merged at ${merged} as ${mergeCommit}, not the reviewed head ${reviewed}`,
          );
          assert.notStrictEqual(yield* dispositionOf(7261), "done");

          yield* adoptAndReview(7261, branch, merged);
          const { operations, outcomes } = yield* integrationOf(7261);
          assert.deepStrictEqual(
            operations.map((operation) => operation.state),
            ["failed", "applied"],
          );
          // The first review's failure stays on record, unchanged.
          assert.deepStrictEqual(operations[0], failed);
          assert.deepStrictEqual(
            outcomes.map((outcome) => [outcome.report.outcome, outcome.report.integration]),
            [
              ["failed", undefined],
              [
                "integrated",
                {
                  targetBranch: "main",
                  mergeCommit,
                  parents: [lifecycleBase, merged],
                  tree: `tree-${mergeCommit}`,
                  attribution: "external",
                  pullRequest: { repository: claimRepository, number: pull.number },
                },
              ],
            ],
          );
          assert.strictEqual(yield* mergeRequests, 0);
          assert.strictEqual((yield* pullsFor(branch)).length, 1);
          assert.strictEqual(yield* dispositionOf(7261), "done");
          const history = [
            "implement",
            "implemented",
            "review",
            "review_passed",
            "failed",
            "correct",
            "correction_spec",
            "rework",
            "implemented",
            "review",
            "review_passed",
            "integrated",
            "closed",
          ];
          assert.deepStrictEqual(yield* itemHistory(7261), history);

          // Later collections and restarts of the effect worker add nothing.
          assert.deepStrictEqual(yield* advance("operation", 3), []);
          assert.deepStrictEqual((yield* integrationOf(7261)).operations, operations);
          assert.deepStrictEqual(yield* itemHistory(7261), history);
          assert.strictEqual(yield* mergeRequests, 0);
          assert.strictEqual(yield* closeRequests, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: a retained merged-elsewhere record from before its own reason class is corrected",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const reviewed = "a".repeat(39) + "1";
          const merged = "b".repeat(39) + "1";
          const { branch, pull, mergeCommit } = yield* mergeElsewhereWhileWaiting(
            7262,
            reviewed,
            merged,
          );
          // The runtime before this reason class ended the attempt with the old wording.
          const legacy = `configuration: pull request #${pull.number} merged at ${merged}, not the reviewed head ${reviewed}`;
          const [attempt] = (yield* integrationOf(7262)).operations;
          const operations = yield* FactoryOperationStore.FactoryOperationStore;
          assert.isTrue(
            yield* operations.complete({
              operationId: attempt!.operationId,
              completion: { state: "failed", reason: legacy },
            }),
          );
          yield* TestClock.adjust("1 minute");
          yield* adoptAndReview(7262, branch, merged);
          const after = yield* integrationOf(7262);
          assert.deepStrictEqual(
            after.operations.map((operation) =>
              operation.state === "failed" ? operation.reason : operation.state,
            ),
            [legacy, "applied"],
          );
          assert.strictEqual(after.outcomes.at(-1)?.report.integration?.mergeCommit, mergeCommit);
          assert.strictEqual(after.outcomes.at(-1)?.report.integration?.attribution, "external");
          assert.strictEqual(yield* mergeRequests, 0);
          assert.strictEqual(yield* dispositionOf(7262), "done");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: a rework that does not adopt the merged head never lands that merge",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const reviewed = "c0007263";
          const merged = "d0007263";
          const other = "e0007263";
          const github = yield* GitHubFake;
          const { branch, pull } = yield* mergeElsewhereWhileWaiting(7263, reviewed, merged);
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 2);
          yield* adoptAndReview(7263, branch, other);
          yield* advance("operation", 3);
          const { operations, outcomes } = yield* integrationOf(7263);
          assert.deepStrictEqual(
            operations.map((operation) =>
              operation.state === "failed" ? operation.reason.split(" ")[0] : operation.state,
            ),
            ["merged_elsewhere:", "merged_elsewhere:"],
          );
          assert.isTrue(outcomes.every((outcome) => outcome.report.integration === undefined));
          // Nothing was pushed over the merged branch, merged or closed for the other head.
          assert.strictEqual(github.remoteBranches.get(branch), merged);
          assert.strictEqual(pull.merged?.head, merged);
          assert.strictEqual(yield* mergeRequests, 0);
          assert.strictEqual(yield* closeRequests, 0);
          assert.notStrictEqual(yield* dispositionOf(7263), "done");
          // The second failure goes back to the work again, as any merged-elsewhere failure does.
          assert.deepStrictEqual((yield* itemHistory(7263)).slice(-3), [
            "review_passed",
            "failed",
            "correct",
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N17: a conflicting head corrected without a new commit integrates on its next passing review",
  () =>
    runIsolated(
      withScratch((root) =>
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ artifactRoot: root }));
          yield* seedIssue(7562);
          const item = `github:${claimRepository}#7562`;
          const graph = yield* GitGraphFake;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("a0000563", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("a0000563", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* recordCommit("b0000564", [lifecycleBase]);
          graph.branches.set("main", "b0000564");
          graph.conflicts.add("b0000564:a0000563");
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("a0000563"),
            summary: "Passes.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          yield* workStage(correct, {
            outcome: "correction_spec",
            summary: "Main's conflicting change is being reverted; report the same head.",
          });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
          yield* recordCommit("b0000565", ["b0000564"]);
          graph.branches.set("main", "b0000565");
          yield* workStage(rework, {
            outcome: "implemented",
            subject: subjectFor("a0000563", lifecycleBase),
            summary: "The head needs no change.",
            artifacts: yield* sameHeadEvidence(root, 7562),
          });
          const secondReview = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(secondReview), [item, "review"]);
          yield* workStage(secondReview, {
            outcome: "review_passed",
            subject: subjectFor("a0000563"),
            summary: "Passes again.",
          });
          yield* advance("outcome");
          assert.strictEqual(graph.writes.length, 1);
          assert.deepStrictEqual(graph.parents.get(graph.branches.get("main")!), [
            "b0000565",
            "a0000563",
          ]);
          assert.deepStrictEqual(yield* advance("operation", 3), []);
          assert.strictEqual(graph.writes.length, 1);
          assert.deepStrictEqual(
            (yield* integrationOf(7562)).operations.map((operation) => operation.state),
            ["failed", "applied"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/independent review: a stage configured apart runs on its own model, beside the work under way",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const reviewer = {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-6.1-sol",
          } satisfies ModelSelection;
          yield* configureFactory(
            lifecycleConfiguration({
              pools: pool(2),
              stageExecution: {
                review: {
                  modelSelection: reviewer,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                },
              },
            }),
          );
          yield* seedIssue(7621);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("d0007621", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("d0007621", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.deepStrictEqual(
            (yield* factory.readState({ factoryId })).reservations.flatMap((reservation) =>
              reservation.origin === "admitted"
                ? [[reservation.taskKind, reservation.modelSelection]]
                : [],
            ),
            [
              ["implement", rosterSelection],
              ["review", reviewer],
            ],
          );
          // The next ticket is decided with the review under way in view.
          yield* seedIssue(7622);
          assert.deepStrictEqual(stageOf(admittedBy(yield* advance("tracker_event", 1))), [
            itemKeyFor(7622),
            "implement",
          ]);
          const policy = yield* PolicyFake;
          assert.deepStrictEqual(
            policy.active.at(-1)?.map((entry) => [entry.itemKey, entry.stage, entry.custody]),
            [[itemKeyFor(7621), "review", "native"]],
          );
          assert.isDefined(review);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/policy execution: a policy picks a configured execution by name, never another",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const medium = {
            ...rosterSelection,
            options: [{ id: "effort", value: "medium" }],
          } satisfies ModelSelection;
          yield* configureFactory(
            lifecycleConfiguration({
              pools: pool(2),
              executionChoices: {
                "builder-medium": {
                  modelSelection: medium,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                },
              },
            }),
          );
          yield* usePolicy((input) =>
            Effect.map(stageRequest(input), (request) =>
              request === undefined || "type" in request
                ? request
                : {
                    ...request,
                    execution: input.issue.labels.includes("effort:medium")
                      ? "builder-medium"
                      : "builder-unknown",
                  },
            ),
          );
          yield* seedIssue(7631, { labels: ["ready", "effort:medium"] });
          yield* seedIssue(7632, { labels: ["ready", "effort:low"] });
          const admitted = admittedBy(yield* advance("tracker_event", 1));
          assert.deepStrictEqual(stageOf(admitted), [itemKeyFor(7631), "implement"]);
          assert.deepStrictEqual(
            admitted.reservation.origin !== "admitted"
              ? undefined
              : admitted.reservation.modelSelection,
            medium,
          );
          assert.strictEqual(yield* dispositionOf(7632), "refused:unknown_execution");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/gate failure: a product gate that refuses integration sends the work to correction once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const finding =
            "Synthetic check: privacy scan finds 1 new finding against base (fixtures/raw.csv:3)";
          yield* usePolicy((input) =>
            input.stage.type === "integrate"
              ? Effect.succeed({ type: "gate_failed", failure: finding })
              : stageRequest(input),
          );
          yield* seedIssue(7641);
          const item = itemKeyFor(7641);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("e0007641", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("e0007641", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("e0007641"),
            summary: "Passes.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          assert.deepStrictEqual(yield* itemHistory(7641), [
            "implement",
            "implemented",
            "review",
            "review_passed",
            "failed",
            "correct",
          ]);
          // Nothing landed, and asking again records nothing more.
          assert.strictEqual((yield* GitGraphFake).writes.length, 0);
          assert.deepStrictEqual(yield* advance("clock", 2), []);
          assert.strictEqual(
            (yield* itemHistory(7641)).filter((event) => event === "failed").length,
            1,
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/beta-PR: T3 records its independent acceptance on the exact head the protection requires",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(
            lifecycleConfiguration({
              integration: {
                ...pullRequestIntegration,
                acceptanceStatus: { context: "beta/independent-acceptance" },
              },
            }),
          );
          const github = yield* GitHubFake;
          github.requiredContexts.add("beta/independent-acceptance");
          yield* seedIssue(7203);
          const branch = "beta/7203-fees";
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("c0007203", [lifecycleBase]);
          github.checks.set("c0007203", "success");
          yield* workStage(implement, {
            outcome: "implemented",
            subject: { ...subjectFor("c0007203", lifecycleBase), branch },
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          // Nothing is accepted before the independent review passes on this head.
          assert.isUndefined(github.statuses.get("c0007203"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("c0007203"),
            summary: "Passes.",
          });
          yield* advance("outcome");
          assert.strictEqual(
            github.statuses.get("c0007203")?.get("beta/independent-acceptance"),
            "success",
          );
          const [pull] = yield* pullsFor(branch);
          assert.strictEqual(pull?.merged?.head, "c0007203");
          assert.strictEqual(yield* dispositionOf(7203), "done");
          assert.strictEqual(
            github.requests.filter(
              (request) => request.method === "POST" && request.path.includes("/statuses/"),
            ).length,
            1,
          );
        }),
      ),
    ),
);

/** An owner gate: integration waits for the owner's answer on the exact reviewed head. */
const proposeWithOwnerGate: ProposeFn = (input) => {
  if (input.stage.type !== "integrate") return stageRequest(input);
  const evidence = `Synthetic owner decision for ${input.stage.head}`;
  const answered = input.reserved.some(
    (decision) =>
      decision.evidenceDigest === sha256(evidence) &&
      decision.state === "resolved" &&
      decision.resolution?.answer === "approve",
  );
  return answered
    ? Effect.succeed({ type: "proceed" })
    : Effect.succeed({
        type: "reserve",
        reason: "Releasing this needs the owner's owner approval record answer.",
        evidenceDigest: sha256(evidence),
      });
};

it.effect(
  "Lifecycle/alpha: a commit-less failure is corrected, and integration waits for the owner's gate",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeWithOwnerGate);
          yield* seedIssue(7101);
          const item = `github:${claimRepository}#7101`;

          const implement = admittedBy(yield* advance("restart", 1));
          // A failed verify produced no commit: a typed failure, bound to its run, is enough.
          const failure: FactoryReportInput = {
            outcome: "failed",
            failure: "pytest tests/test_intake.py::test_dates FAILED",
            summary: "Verify failed before any commit.",
          };
          const worker = yield* workStage(implement, failure);
          // The same report again is the same outcome.
          assert.strictEqual(
            (yield* reportFrom(worker.threadId, failure)).state,
            "already_reported",
          );
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          yield* workStage(correct, { outcome: "correction_spec", summary: "Parse ISO dates." });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
          yield* recordCommit("e0000001", [lifecycleBase]);
          yield* workStage(rework, {
            outcome: "implemented",
            subject: subjectFor("e0000001", lifecycleBase),
            summary: "Fixed.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("e0000001"),
            summary: "Passes.",
          });

          // The gate: one durable reserved decision and one tracker record, however often the
          // factory reconciles, with nothing written to Git and no agent started.
          for (const trigger of ["outcome", "clock", "restart"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 2), []);
          }
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const gated = yield* factory.readState({ factoryId });
          assert.deepStrictEqual(
            gated.reservedDecisions.map((decision) => [decision.itemKey, decision.state]),
            [[item, "pending"]],
          );
          assert.strictEqual(yield* dispositionOf(7101), "reserved_decision");
          assert.strictEqual((yield* commentsWith(7101, "t3-factory-decision")).length, 1);
          assert.strictEqual((yield* GitGraphFake).writes.length, 0);
          const startedBeforeAnswer = (yield* startedTurns).length;

          // The owner's answer starts the next reconciliation; nothing waited in a turn for it.
          assert.isTrue(
            yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: gated.reservedDecisions[0]!.decisionId,
              answer: "approve",
              by: "owner",
            }),
          );
          assert.deepStrictEqual(yield* advance("owner_decision"), []);
          assert.strictEqual((yield* startedTurns).length, startedBeforeAnswer);
          assert.deepStrictEqual(yield* itemHistory(7101), [
            "implement",
            "failed",
            "correct",
            "correction_spec",
            "rework",
            "implemented",
            "review",
            "review_passed",
            "integrated",
            "closed",
          ]);
          assert.strictEqual(yield* dispositionOf(7101), "done");
          assert.strictEqual((yield* GitGraphFake).writes.length, 1);
          assert.strictEqual(yield* occupied, 0);
        }),
      ),
    ),
);

/** An owner gate before work starts: the issue's first stage waits for the owner. */
const reserveBeforeStart: ProposeFn = () =>
  Effect.succeed({
    type: "reserve",
    reason: "The owner decides whether to start.",
    evidenceDigest: sha256("start"),
  });

/** Reserves the start of issue 7105 on a server host of `platform`; its decision comments. */
const reservedDecisionComment = (platform: NodeJS.Platform) =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* usePolicy(reserveBeforeStart);
        yield* seedIssue(7105);
        for (const trigger of ["restart", "clock"] as const) {
          assert.deepStrictEqual(yield* advance(trigger, 2), []);
        }
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const [decision] = (yield* factory.readState({ factoryId })).reservedDecisions;
        const comments = yield* commentsWith(7105, "t3-factory-decision");
        return { id: decision!.decisionId, bodies: comments.map((comment) => comment.body) };
      }),
    ),
  ).pipe(Effect.provideService(HostProcess.Platform, platform));

it.effect(
  "Lifecycle/alpha: a reserved decision's tracker record names every route that answers it, the host CLI included",
  () =>
    Effect.gen(function* () {
      const { id, bodies } = yield* reservedDecisionComment("linux");
      assert.deepStrictEqual(bodies, [
        [
          `<!-- t3-factory-decision:${id} -->`,
          "T3 factory beta is waiting for the owner before the implement stage.",
          "The owner decides whether to start.",
          `Decision ${id}: only the owner can answer it; agents in threads cannot. Answer it in Settings → Factories in a T3 app that has it, with t3_factory_decide from the owner's own MCP session, or on the server host with the installed T3 CLI:`,
          `    t3 factory decide --factory beta --decision ${id} --item 'github:example-org/beta#7105' --stage implement --answer approve`,
          "--answer takes approve or decline.",
        ].join("\n\n"),
      ]);
    }),
);

it.effect(
  "Lifecycle/alpha: a reserved decision's host CLI command is written for PowerShell on a Windows host",
  () =>
    Effect.gen(function* () {
      const { id, bodies } = yield* reservedDecisionComment("win32");
      assert.strictEqual(bodies.length, 1);
      assert.include(
        bodies[0]!,
        ", or on the server host in PowerShell with the installed T3 CLI:\n\n",
      );
      assert.include(
        bodies[0]!,
        `\n    t3 factory decide --factory "beta" --decision "${id}" --item "github:example-org/beta#7105" --stage "implement" --answer approve\n`,
      );
    }),
);

it.effect(
  "Lifecycle/alpha: a decision already recorded keeps the tracker body it was recorded with",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(reserveBeforeStart);
          yield* seedIssue(7106);
          // A server before this guidance recorded the decision's intent, then stopped.
          const operations = yield* FactoryOperationStore.FactoryOperationStore;
          const lookups = yield* AdmissionLookups;
          let recorded = "";
          lookups.beforeIntent = (intent) =>
            intent.kind !== "tracker_comment" || intent.purpose !== "decision"
              ? Effect.void
              : Effect.gen(function* () {
                  lookups.beforeIntent = undefined;
                  recorded = [
                    intent.marker,
                    "T3 factory beta is waiting for the owner before the implement stage.",
                    "The owner decides whether to start.",
                    `Decision ${intent.ref}: answer it in T3 (Settings, Factories) or with t3_factory_decide.`,
                  ].join("\n\n");
                  yield* operations.intend({
                    operationId: `decision:${intent.ref}`,
                    factoryId,
                    itemKey: itemKeyFor(7106),
                    intent: { ...intent, body: recorded },
                  });
                }).pipe(Effect.orDie);
          for (const trigger of ["restart", "clock"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 2), []);
          }
          assert.notStrictEqual(recorded, "");
          assert.deepStrictEqual(
            (yield* commentsWith(7106, "t3-factory-decision")).map((comment) => comment.body),
            [recorded],
          );
        }),
      ),
    ),
);

it.effect("Lifecycle/N25: idle triggers start no agent and say why", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        // Claimed by someone else, and unlabelled: neither is this factory's to start.
        yield* seedIssue(7201, { labels: ["ready", "claimed"] });
        yield* seedIssue(7202, { labels: [] });
        for (const trigger of ["tracker_event", "clock", "restart"] as const) {
          assert.deepStrictEqual(yield* advance(trigger, 1), []);
        }
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.strictEqual(yield* commentPosts, 0);
        assert.strictEqual(yield* dispositionOf(7201), "not_eligible");
        assert.isUndefined(yield* dispositionOf(7202));
        const { threads } = yield* (yield* ProjectionStore.ProjectionStoreV2).getShellSnapshot();
        assert.deepStrictEqual(threads, []);
      }),
    ),
  ),
);

const awaitThreadTitled = (title: string) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.streamDomainEvents.pipe(
      Stream.filter((event) => event.type === "thread.created" && event.payload.title === title),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    ),
  );

it.effect("Lifecycle/driver: restart, a report and the run's end move the item on their own", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7301);
        const item = `github:${claimRepository}#7301`;
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        // The effect worker's daemon: it runs whatever the outbox signals, as the server's does.
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* Effect.forkScoped(
          Effect.forever(Effect.andThen(outbox.awaitAvailable, worker.drain())),
        );
        const implemented = yield* awaitThreadTitled(`implement ${item}`);
        yield* Effect.forkScoped(factory.drive);
        yield* Fiber.join(implemented);
        const [implement] = (yield* factory.readState({ factoryId })).reservations;
        const execution = executionOf(implement!)!;
        const running = yield* awaitRunningTurn(execution.threadId);
        yield* runEffects;
        yield* Fiber.join(running);
        yield* recordCommit("a0000001", [lifecycleBase]);
        const reviewed = yield* awaitThreadTitled(`review ${item}`);
        yield* reportFrom(execution.threadId, {
          outcome: "implemented",
          subject: subjectFor("a0000001", lifecycleBase),
          summary: "Implemented.",
        });
        yield* completeLatestRun(execution.threadId);
        // The report's tracker record is written by the effect worker, whose finished write wakes
        // the driver again; no test call reconciles.
        yield* Fiber.join(reviewed);
        assert.deepStrictEqual(yield* itemHistory(7301), ["implement", "implemented", "review"]);
      }),
    ),
  ),
);

it.effect(
  "Lifecycle/#70: a front naming an owned issue is not its stage; the admitted stage carries it once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7701);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const execution = yield* startStage(implement);
          yield* recordCommit("a0007701", [lifecycleBase]);

          // A coordination front launched over MCP and pointed at the same issue by its URL.
          const front = ThreadId.make("thread:front:7701");
          yield* createTopLevelThread(front, "agent");
          const frontRunning = yield* awaitRunningTurn(front);
          yield* sendUserMessage(front, `https://github.com/${claimRepository}/issues/7701`);
          yield* runEffects;
          yield* Fiber.join(frontRunning);
          const refused = yield* reportFrom(front, {
            outcome: "implemented",
            subject: subjectFor("a0007701", lifecycleBase),
            summary: "Implemented by the front.",
          }).pipe(Effect.flip);
          assert.strictEqual(refused.code, "not_a_factory_execution");
          assert.deepStrictEqual(yield* advance("outcome", 2), []);
          assert.deepStrictEqual(yield* itemHistory(7701), ["implement"]);
          assert.strictEqual((yield* reportComments(7701)).length, 0);

          yield* reportFrom(execution.threadId, {
            outcome: "implemented",
            subject: subjectFor("a0007701", lifecycleBase),
            summary: "Implemented.",
          });
          yield* completeLatestRun(execution.threadId);
          // A restart pass and repeated collection decide the next stage once, from native facts.
          const review = admittedBy([
            ...(yield* advance("restart")),
            ...(yield* advance("restart")),
            ...(yield* advance("clock")),
          ]);
          assert.deepStrictEqual(stageOf(review), [`github:${claimRepository}#7701`, "review"]);
          assert.deepStrictEqual(yield* itemHistory(7701), ["implement", "implemented", "review"]);
          assert.strictEqual((yield* reportComments(7701)).length, 1);
          assert.strictEqual(yield* runCount(front), 1);
        }),
      ),
    ),
);

const enterIssue = (
  issueNumber: number,
  factory?: FactoryLifecycle.FactoryLifecycle["Service"],
  repository: string = claimRepository,
) =>
  Effect.gen(function* () {
    const lifecycle = factory ?? (yield* FactoryLifecycle.FactoryLifecycle);
    return yield* lifecycle.enter({ factoryId, repository, issueNumber });
  });

const nativeReservations = (issueNumber: number) =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    return state.reservations.filter(
      (reservation) =>
        reservation.itemKey === itemKeyFor(issueNumber) && reservation.origin === "admitted",
    );
  });

it.effect(
  "Entry/#70: concurrent entries and one after a restart start one worker under one claim",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7711);
          const entries = yield* Effect.all([enterIssue(7711), enterIssue(7711)], {
            concurrency: "unbounded",
          });
          assert.deepStrictEqual(
            entries.map((entry) => entry.status).toSorted(),
            entries.some((entry) => entry.status === "waiting")
              ? ["started", "waiting"]
              : ["active", "started"],
          );
          const started = entries.find((entry) => entry.status === "started")!;
          assert.strictEqual(started.stage, "implement");
          yield* runEffects;

          // A restarted server: a new lifecycle over the same stores, with nothing in memory.
          const restartedScope = yield* Scope.make();
          const restarted = Context.get(
            yield* Layer.build(Layer.fresh(FactoryLifecycle.layer)).pipe(
              Effect.provideService(Scope.Scope, restartedScope),
            ),
            FactoryLifecycle.FactoryLifecycle,
          );
          const again = yield* enterIssue(7711, restarted);
          yield* Scope.close(restartedScope, Exit.void);
          assert.deepStrictEqual(
            [again.status, again.stage, again.threadId],
            ["active", "implement", started.threadId],
          );
          yield* runEffects;
          assert.strictEqual((yield* nativeReservations(7711)).length, 1);
          assert.strictEqual((yield* claimComments(7711)).length, 1);
          assert.strictEqual((yield* startedTurns).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Entry/#70: entering a running item reuses its stage, and its own report moves it to review",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7721);
          const entered = yield* enterIssue(7721);
          assert.deepStrictEqual([entered.status, entered.stage], ["started", "implement"]);
          const [implement] = yield* nativeReservations(7721);
          const execution = yield* startStage({ type: "admitted", reservation: implement! });
          assert.strictEqual(execution.threadId, entered.threadId);

          const reused = yield* enterIssue(7721);
          assert.deepStrictEqual([reused.status, reused.threadId], ["active", entered.threadId]);
          yield* recordCommit("a0007721", [lifecycleBase]);
          yield* reportFrom(execution.threadId, {
            outcome: "implemented",
            subject: subjectFor("a0007721", lifecycleBase),
            summary: "Implemented.",
          });
          yield* completeLatestRun(execution.threadId);
          const review = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(review), [`github:${claimRepository}#7721`, "review"]);
          const reviewing = yield* enterIssue(7721);
          assert.deepStrictEqual([reviewing.status, reviewing.stage], ["active", "review"]);
          assert.deepStrictEqual(yield* itemHistory(7721), ["implement", "implemented", "review"]);
          assert.strictEqual((yield* nativeReservations(7721)).length, 2);
        }),
      ),
    ),
);

it.effect("Entry/#70: an unready or uncollected issue is refused by name and starts nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7731, { labels: [] });
        const unlabelled = yield* enterIssue(7731);
        assert.deepStrictEqual(
          [unlabelled.status, unlabelled.reason],
          ["not_ready", "The factory does not take it: it lacks the readiness label ready."],
        );
        assert.include(unlabelled.nextAction, "This route does not change readiness.");

        const elsewhere = yield* enterIssue(7731, undefined, "example-org/other");
        assert.deepStrictEqual(
          [elsewhere.status, elsewhere.reason],
          ["refused", `${factoryId} collects ${claimRepository}, not example-org/other.`],
        );
        const unknown = yield* (yield* FactoryLifecycle.FactoryLifecycle).enter({
          factoryId: FactoryId.make("not-configured"),
          repository: claimRepository,
          issueNumber: 7731,
        });
        assert.strictEqual(unknown.status, "refused");

        // A policy-ready project: the policy's own reason is what entry says, and no label helps.
        yield* seedIssue(7732);
        const reason = "#7732 names no owned files";
        yield* usePolicy(() => Effect.succeed({ type: "none", reason }));
        const unproposed = yield* enterIssue(7732);
        assert.deepStrictEqual([unproposed.status, unproposed.reason], ["not_ready", reason]);

        yield* runEffects;
        yield* assertNothingStarted(`github:${claimRepository}#7731`);
        yield* assertNothingStarted(`github:${claimRepository}#7732`);
        assert.strictEqual(yield* commentPosts, 0);
        assert.strictEqual((yield* startedTurns).length, 0);
      }),
    ),
  ),
);

it.effect("Entry/#70: an item at the owner's gate stays held on it, unanswered", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* usePolicy(proposeWithOwnerGate);
        yield* seedIssue(7741);
        const implement = admittedBy(yield* advance("tracker_event", 1));
        yield* recordCommit("a0007741", [lifecycleBase]);
        yield* workStage(implement, {
          outcome: "implemented",
          subject: subjectFor("a0007741", lifecycleBase),
          summary: "Implemented.",
        });
        const review = admittedBy(yield* advance("outcome"));
        yield* workStage(review, {
          outcome: "review_passed",
          subject: subjectFor("a0007741"),
          summary: "Passes.",
        });
        assert.deepStrictEqual(yield* advance("outcome", 2), []);
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const [gate] = (yield* factory.readState({ factoryId })).reservedDecisions;

        const held = yield* enterIssue(7741);
        assert.deepStrictEqual(
          [held.status, held.decisionId, held.reason],
          [
            "held",
            gate!.decisionId,
            "Releasing this needs the owner's owner approval record answer.",
          ],
        );
        assert.include(held.nextAction, "This route never answers it.");
        yield* runEffects;
        assert.deepStrictEqual(
          (yield* factory.readState({ factoryId })).reservedDecisions.map(
            (decision) => decision.state,
          ),
          ["pending"],
        );
        assert.strictEqual((yield* GitGraphFake).writes.length, 0);
        assert.strictEqual((yield* nativeReservations(7741)).length, 2);
      }),
    ),
  ),
);

const pendingSubjects = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly item_key: string }>`
    SELECT item_key FROM factory_collection_subjects WHERE requested > completed ORDER BY item_key
  `;
  return rows.map((row) => row.item_key);
});

const trackerWrites = Effect.map(GitHubFake, (fake) =>
  fake.requests
    .filter((request) => request.method !== "GET")
    .map((request) => `${request.method} ${request.path}`),
);

const freshLifecycle = (scope: Scope.Scope) =>
  Effect.map(
    Layer.build(Layer.fresh(FactoryLifecycle.layer)).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
    (context) => Context.get(context, FactoryLifecycle.FactoryLifecycle),
  );

const reserveEverything = () =>
  Effect.succeed({
    type: "reserve" as const,
    reason: "Owner must approve this new work.",
    evidenceDigest: sha256("entry-paused"),
  });

it.effect("Entry/#70: a paused factory's entry decides nothing new and writes nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7751);
        const running = yield* enterIssue(7751);
        assert.strictEqual(running.status, "started");
        yield* runEffects;
        yield* configureFactory(lifecycleConfiguration({ enabled: false }));
        yield* usePolicy(reserveEverything);
        yield* seedIssue(7752);
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const writesBefore = yield* trackerWrites;

        const entered = yield* enterIssue(7752);
        assert.deepStrictEqual(
          [entered.status, entered.reason],
          ["refused", "The factory is paused: it finishes what it owns and starts nothing new."],
        );
        // What it already owns is still reported as it is, without a pass.
        const owned = yield* enterIssue(7751);
        assert.deepStrictEqual([owned.status, owned.threadId], ["active", running.threadId]);
        yield* runEffects;
        assert.deepStrictEqual((yield* factory.readState({ factoryId })).reservedDecisions, []);
        assert.deepStrictEqual((yield* trackerWrites).slice(writesBefore.length), []);
        assert.deepStrictEqual(yield* pendingSubjects, []);
        assert.strictEqual((yield* nativeReservations(7752)).length, 0);
      }),
    ),
  ),
);

it.effect("Entry/#70: an entry a pass reads after the factory paused decides nothing new", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* usePolicy(reserveEverything);
        yield* seedIssue(7753, { labels: [] });
        yield* seedIssue(7754);
        const fake = yield* GitHubFake;
        const reading = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const owner = yield* Effect.forkScoped(collectIssues([7753], "clock"));
        yield* Deferred.await(reading);
        const entered = yield* enterIssue(7754);
        assert.strictEqual(entered.status, "waiting");
        // The owner pauses the factory before the running pass reaches the entered issue.
        yield* configureFactory(lifecycleConfiguration({ enabled: false }));
        const writesBefore = yield* trackerWrites;
        fake.beforeIssueRead = undefined;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(owner);
        yield* runEffects;
        assert.deepStrictEqual((yield* factory.readState({ factoryId })).reservedDecisions, []);
        assert.deepStrictEqual((yield* trackerWrites).slice(writesBefore.length), []);
        assert.strictEqual(yield* dispositionOf(7754), "refused:factory_paused");
        assert.strictEqual((yield* enterIssue(7754)).status, "refused");
      }),
    ),
  ),
);

it.effect("Entry/#70: a pull request's number is not an issue the factory takes", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7761, { pullRequest: true });
        assert.deepStrictEqual(yield* advance("clock", 2), []);
        const entered = yield* enterIssue(7761);
        yield* runEffects;
        assert.deepStrictEqual(
          [entered.status, entered.reason],
          ["refused", `${claimRepository}#7761 is a pull request, not an issue.`],
        );
        assert.deepStrictEqual(yield* trackerWrites, []);
        assert.strictEqual((yield* nativeReservations(7761)).length, 0);
        assert.strictEqual((yield* startedTurns).length, 0);
        assert.deepStrictEqual(yield* pendingSubjects, []);
      }),
    ),
  ),
);

it.effect(
  "Entry/#70: a missing issue is refused for good; an unread one stays pending until a pass reads it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const missing = yield* enterIssue(7771);
          assert.deepStrictEqual(
            [missing.status, missing.reason],
            [
              "refused",
              `GitHub answers that ${claimRepository}#7771 does not exist, or the factory's tracker account cannot read it.`,
            ],
          );
          assert.include(missing.nextAction, "read access");
          assert.deepStrictEqual(yield* pendingSubjects, []);

          // A read that fails in transit is a pass's to retry: the request stays pending, and the
          // next pass reads it with no new entry and no listing naming it.
          yield* seedIssue(7772);
          (yield* GitHubFake).failNextIssueRead.add(7772);
          const unread = yield* enterIssue(7772);
          assert.strictEqual(unread.status, "waiting");
          assert.deepStrictEqual(yield* pendingSubjects, [itemKeyFor(7772)]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const retried = yield* factory.collect({ factoryId, trigger: "operation", subjects: [] });
          assert.deepStrictEqual(
            retried.type === "collected"
              ? retried.admissions.map((admission) => admission.type)
              : retried.type,
            ["admitted"],
          );
          assert.deepStrictEqual(yield* pendingSubjects, []);
          yield* runEffects;
          assert.strictEqual((yield* enterIssue(7772)).status, "active");
          assert.strictEqual((yield* claimComments(7772)).length, 1);
        }),
      ),
    ),
);

it.effect("Entry/#70: an entry coalesced into a running pass is taken by that pass's owner", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7781, { labels: [] });
        yield* seedIssue(7782);
        const fake = yield* GitHubFake;
        const reading = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        const owner = yield* Effect.forkScoped(collectIssues([7781], "clock"));
        yield* Deferred.await(reading);
        const entered = yield* enterIssue(7782);
        assert.strictEqual(entered.status, "waiting");
        assert.include(yield* pendingSubjects, itemKeyFor(7782));
        fake.beforeIssueRead = undefined;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(owner);
        yield* runEffects;
        const again = yield* enterIssue(7782);
        const reservations = yield* nativeReservations(7782);
        assert.strictEqual(reservations.length, 1);
        assert.deepStrictEqual(
          [again.status, again.threadId],
          ["active", executionOf(reservations[0]!)?.threadId],
        );
        assert.strictEqual((yield* claimComments(7782)).length, 1);
      }),
    ),
  ),
);

it.effect(
  "Entry/#70: an entry accepted while a pass runs survives a stop; the next start takes it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7791, { labels: [] });
          yield* seedIssue(7792);
          const fake = yield* GitHubFake;
          const reading = yield* Deferred.make<void>();
          fake.beforeIssueRead = Deferred.succeed(reading, undefined).pipe(
            Effect.andThen(Effect.never),
          );
          const firstScope = yield* Scope.make();
          const first = yield* freshLifecycle(firstScope);
          yield* first
            .collect({
              factoryId,
              trigger: "clock",
              subjects: [{ repository: claimRepository, issueNumber: 7791 }],
            })
            .pipe(Effect.forkIn(firstScope));
          yield* Deferred.await(reading);
          const entered = yield* enterIssue(7792, first);
          assert.strictEqual(entered.status, "waiting");
          // The server stops with that pass still reading.
          yield* Scope.close(firstScope, Exit.void);
          fake.beforeIssueRead = undefined;
          assert.include(yield* pendingSubjects, itemKeyFor(7792));
          assert.strictEqual((yield* nativeReservations(7792)).length, 0);

          const secondScope = yield* Scope.make();
          const second = yield* freshLifecycle(secondScope);
          // No listing and no new subject: only the durable request names the entered issue.
          yield* second.collect({ factoryId, trigger: "restart", subjects: [] });
          yield* runEffects;
          const again = yield* enterIssue(7792, second);
          yield* Scope.close(secondScope, Exit.void);
          assert.strictEqual(again.status, "active");
          assert.strictEqual((yield* nativeReservations(7792)).length, 1);
          assert.strictEqual((yield* claimComments(7792)).length, 1);
        }),
      ),
    ),
);

const issueReads = (issueNumber: number) =>
  Effect.map(
    GitHubFake,
    (fake) =>
      fake.requests.filter(
        (request) =>
          request.method === "GET" &&
          request.path === `repos/${claimRepository}/issues/${issueNumber}`,
      ).length,
  );

const listings = Effect.map(
  GitHubFake,
  (fake) =>
    fake.requests.filter(
      (request) => request.method === "GET" && request.path === `repos/${claimRepository}/issues`,
    ).length,
);

const answered = (status: number) =>
  new GitHubRequestPolicy.GitHubApiResponseError({
    host: "github.com",
    operation: "factory.readIssue",
    status,
  });

/** The factory's own driver for whole minutes of test time, with nothing else triggering it. */
const driveMinutes = (minutes: number) =>
  Effect.gen(function* () {
    for (let minute = 0; minute < minutes; minute++) {
      yield* TestClock.adjust("1 minute");
      for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
    }
  });

it.effect(
  "Entry/#70: GitHub's 403, 410 and 451 answers are final; a rate limit or a 5xx stays pending",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const fake = yield* GitHubFake;
          const finals = [
            [7801, 403, "GitHub refuses the factory's tracker account access to"],
            [7802, 410, "GitHub answers that"],
            [7803, 451, "GitHub refuses the factory's tracker account access to"],
          ] as const;
          for (const [issueNumber, status, reason] of finals) {
            // Unlabelled, so no listing names it: only the entry's own request could read it.
            yield* seedIssue(issueNumber, { labels: [] });
            fake.issueReadErrors.set(issueNumber, answered(status));
            const entered = yield* enterIssue(issueNumber);
            assert.strictEqual(entered.status, "refused", `${status}`);
            assert.include(entered.reason, reason);
          }
          assert.deepStrictEqual(yield* pendingSubjects, []);
          // Later passes do not reopen a final refusal.
          yield* advance("operation", 3);
          for (const [issueNumber] of finals) assert.strictEqual(yield* issueReads(issueNumber), 1);

          yield* seedIssue(7804, { labels: [] });
          fake.issueReadErrors.set(
            7804,
            new GitHubRequestPolicy.GitHubApiRateLimitError({
              host: "github.com",
              operation: "factory.readIssue",
            }),
          );
          yield* seedIssue(7805, { labels: [] });
          fake.issueReadErrors.set(7805, answered(502));
          assert.strictEqual((yield* enterIssue(7804)).status, "waiting");
          assert.strictEqual((yield* enterIssue(7805)).status, "waiting");
          assert.deepStrictEqual(yield* pendingSubjects, [itemKeyFor(7804), itemKeyFor(7805)]);
          fake.issueReadErrors.clear();
          yield* (yield* FactoryLifecycle.FactoryLifecycle).collect({
            factoryId,
            trigger: "operation",
            subjects: [],
          });
          assert.deepStrictEqual(yield* pendingSubjects, []);
          assert.deepStrictEqual(yield* trackerWrites, []);
        }),
      ),
    ),
);

it.effect(
  "Entry/#70: a pending entry outlives a listing outage with no factory clock and starts once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const fake = yield* GitHubFake;
          // A final refusal entered before the outage: no retry reads it again.
          yield* seedIssue(7811, { labels: [] });
          fake.issueReadErrors.set(7811, answered(410));
          assert.strictEqual((yield* enterIssue(7811)).status, "refused");
          yield* seedIssue(7812);
          fake.failNextIssueRead.add(7812);
          assert.strictEqual((yield* enterIssue(7812)).status, "waiting");
          assert.deepStrictEqual(yield* pendingSubjects, [itemKeyFor(7812)]);

          // GitHub is unreachable for three minutes, then healthy; only the driver runs.
          fake.listingUnreachable = true;
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          yield* Effect.forkScoped(factory.drive);
          for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
          const listingsBefore = yield* listings;
          yield* driveMinutes(3);
          const listedInOutage = (yield* listings) - listingsBefore;
          // The retry keeps going through the outage at its own one-minute pace, never faster.
          assert.isAtLeast(listedInOutage, 3);
          assert.isAtMost(listedInOutage, 8);
          assert.deepStrictEqual(yield* pendingSubjects, [itemKeyFor(7812)]);
          fake.listingUnreachable = false;
          yield* driveMinutes(30);
          yield* runEffects;

          assert.deepStrictEqual(yield* pendingSubjects, []);
          assert.strictEqual((yield* nativeReservations(7812)).length, 1);
          assert.strictEqual((yield* claimComments(7812)).length, 1);
          assert.strictEqual((yield* enterIssue(7812)).status, "active");
          assert.strictEqual(yield* issueReads(7811), 1);
          assert.strictEqual((yield* enterIssue(7811)).status, "refused");
        }),
      ),
    ),
);

it.effect("Entry/#70: a paused factory reads a pending entry once and does not retry it", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* usePolicy(reserveEverything);
        const fake = yield* GitHubFake;
        yield* seedIssue(7821);
        fake.failNextIssueRead.add(7821);
        assert.strictEqual((yield* enterIssue(7821)).status, "waiting");
        yield* configureFactory(lifecycleConfiguration({ enabled: false }));
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        yield* Effect.forkScoped(factory.drive);
        for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
        yield* driveMinutes(10);
        yield* runEffects;
        assert.deepStrictEqual(yield* pendingSubjects, []);
        // The entry's failed read, then the one the next pass made; nothing after it.
        assert.strictEqual(yield* issueReads(7821), 2);
        assert.deepStrictEqual((yield* factory.readState({ factoryId })).reservedDecisions, []);
        assert.strictEqual((yield* nativeReservations(7821)).length, 0);
        assert.strictEqual((yield* enterIssue(7821)).status, "refused");
      }),
    ),
  ),
);

const identityUnreachable = new GitHubRequestPolicy.GitHubApiRequestError({
  host: "github.com",
  operation: "github.viewer",
  cause: "GitHub is unreachable",
});

/** The tags along an error's cause chain, outermost first. */
const causeTags = (error: unknown): ReadonlyArray<string> =>
  typeof error === "object" && error !== null && "_tag" in error
    ? [String(error._tag), ...causeTags("cause" in error ? error.cause : undefined)]
    : [];

/** The factory's driver, running with its restart pass done, so only its retries read again. */
const runDriver = Effect.gen(function* () {
  yield* Effect.forkScoped((yield* FactoryLifecycle.FactoryLifecycle).drive);
  for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
});

it.effect(
  "Entry/#76: an entry whose identity read failed is retried on the one-minute pace and starts once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const fake = yield* GitHubFake;
          // A final refusal entered before the outage: no retry reads it again.
          yield* seedIssue(7831, { labels: [] });
          fake.issueReadErrors.set(7831, answered(410));
          assert.strictEqual((yield* enterIssue(7831)).status, "refused");
          yield* runDriver;
          // The retry that refusal's pass asked for runs out first, so it cannot cover the entry.
          yield* driveMinutes(3);

          yield* seedIssue(7832);
          fake.identityFailure = identityUnreachable;
          const failed = yield* Effect.all(
            [Effect.exit(enterIssue(7832)), Effect.exit(enterIssue(7832))],
            { concurrency: "unbounded" },
          );
          const errors = failed.flatMap((exit) =>
            Exit.isFailure(exit) ? [Cause.squash(exit.cause)] : [],
          );
          assert.isAtLeast(errors.length, 1);
          for (const error of errors) {
            assert.include(causeTags(error), "GitHubApiRequestError");
          }
          assert.deepStrictEqual(yield* pendingSubjects, [itemKeyFor(7832)]);

          // Still unreachable for three minutes: the retry keeps its one-minute pace, no faster.
          const readsBefore = fake.identityReads;
          yield* driveMinutes(3);
          const readInOutage = fake.identityReads - readsBefore;
          assert.isAtLeast(readInOutage, 2);
          assert.isAtMost(readInOutage, 6);
          assert.strictEqual(yield* issueReads(7832), 0);

          fake.identityFailure = undefined;
          yield* driveMinutes(3);
          yield* runEffects;
          assert.deepStrictEqual(yield* pendingSubjects, []);
          assert.strictEqual((yield* nativeReservations(7832)).length, 1);
          assert.strictEqual((yield* claimComments(7832)).length, 1);
          assert.strictEqual((yield* startedTurns).length, 1);

          // Read to its end, the request asks for nothing more.
          const readsAfter = fake.identityReads;
          yield* driveMinutes(10);
          assert.strictEqual(fake.identityReads, readsAfter);
          assert.strictEqual((yield* enterIssue(7832)).status, "active");
          assert.strictEqual(yield* issueReads(7831), 1);
          assert.strictEqual((yield* enterIssue(7831)).status, "refused");
        }),
      ),
    ),
);

it.effect(
  "Entry/#76: a rate-limit pause on the identity read sends nothing to GitHub until it lifts",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const fake = yield* GitHubFake;
          yield* runDriver;
          yield* seedIssue(7841);
          fake.identityFailure = new SourceControlRateLimit.SourceControlRateLimitPausedError({
            provider: SourceControlProviderKind.make("github"),
            host: "github.com",
            retryAt: 0,
          });
          const requestsBefore = fake.requests.length;
          assert.isTrue(Exit.isFailure(yield* Effect.exit(enterIssue(7841))));
          yield* driveMinutes(5);
          assert.strictEqual(fake.requests.length, requestsBefore);
          assert.deepStrictEqual(yield* pendingSubjects, [itemKeyFor(7841)]);

          fake.identityFailure = undefined;
          yield* driveMinutes(3);
          yield* runEffects;
          assert.deepStrictEqual(yield* pendingSubjects, []);
          assert.strictEqual((yield* nativeReservations(7841)).length, 1);
          assert.strictEqual((yield* claimComments(7841)).length, 1);
        }),
      ),
    ),
);

it.effect("Entry/#76: an entry left pending by an identity outage starts nothing once paused", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* usePolicy(reserveEverything);
        const fake = yield* GitHubFake;
        yield* runDriver;
        yield* seedIssue(7851);
        fake.identityFailure = identityUnreachable;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(enterIssue(7851))));
        yield* configureFactory(lifecycleConfiguration({ enabled: false }));
        fake.identityFailure = undefined;
        const writesBefore = yield* trackerWrites;
        yield* driveMinutes(10);
        yield* runEffects;
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        assert.deepStrictEqual(yield* pendingSubjects, []);
        assert.strictEqual(yield* issueReads(7851), 1);
        assert.deepStrictEqual((yield* factory.readState({ factoryId })).reservedDecisions, []);
        assert.deepStrictEqual((yield* trackerWrites).slice(writesBefore.length), []);
        assert.strictEqual((yield* nativeReservations(7851)).length, 0);
        assert.strictEqual((yield* enterIssue(7851)).status, "refused");
      }),
    ),
  ),
);

it.effect(
  "Entry/#76: an entry left pending by an identity outage starts once after a restart",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const fake = yield* GitHubFake;
          yield* seedIssue(7861);
          fake.identityFailure = identityUnreachable;
          assert.isTrue(Exit.isFailure(yield* Effect.exit(enterIssue(7861))));
          fake.identityFailure = undefined;

          // A restarted server: nothing in memory asks for the retry, only the stored request.
          const restartedScope = yield* Scope.make();
          const restarted = yield* freshLifecycle(restartedScope);
          yield* Effect.forkIn(restarted.drive, restartedScope);
          for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
          yield* driveMinutes(3);
          yield* Scope.close(restartedScope, Exit.void);
          yield* runEffects;
          assert.deepStrictEqual(yield* pendingSubjects, []);
          assert.strictEqual((yield* nativeReservations(7861)).length, 1);
          assert.strictEqual((yield* claimComments(7861)).length, 1);
          assert.strictEqual((yield* startedTurns).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N16: a report record whose response was lost is read back, not written twice",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7401);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("a0000002", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("a0000002", lifecycleBase),
            summary: "Implemented.",
          });
          // GitHub applies the report record, but its response never reaches T3.
          (yield* GitHubFake).outcomes.push({ type: "apply_then_lose" });
          assert.deepStrictEqual(yield* advance("outcome", 3), []);
          assert.strictEqual(yield* dispositionOf(7401), "in_progress");
          assert.deepStrictEqual(yield* itemHistory(7401), ["implement"]);
          // The unconfirmed write is read back by its marker after a wait, never repeated.
          yield* TestClock.adjust("1 minute");
          const review = admittedBy(yield* advance("operation", 3));
          assert.deepStrictEqual(stageOf(review), [`github:${claimRepository}#7401`, "review"]);
          assert.strictEqual((yield* reportComments(7401)).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N15: an outcome its readback contradicts is rejected and advances nothing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7501);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          // The worker names a head the repository does not have. Its run is still live.
          const execution = yield* startStage(implement);
          yield* reportFrom(execution.threadId, {
            outcome: "implemented",
            subject: subjectFor("a0000003", lifecycleBase),
            summary: "Implemented.",
          });
          assert.deepStrictEqual(yield* advance("outcome", 2), []);
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [rejected] = yield* outcomes.listForOrigin(implement.reservation.reservationId);
          assert.deepStrictEqual(
            rejected?.state === "rejected" ? rejected.rejection : rejected?.state,
            "head a0000003 does not exist",
          );
          // Unverified, it is recorded nowhere on the tracker and keeps the execution's custody.
          assert.strictEqual((yield* reportComments(7501)).length, 0);
          assert.strictEqual(yield* dispositionOf(7501), "in_progress");
          assert.deepStrictEqual(yield* itemHistory(7501), ["implement"]);
          assert.strictEqual(yield* occupied, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N17: a landed integration whose answer was lost is read back, kept and closed once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7551);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("a0000551", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("a0000551", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("a0000551"),
            summary: "Passes.",
          });
          // The merge lands on main, then the answer is lost, as a crash after the push would.
          const graph = yield* GitGraphFake;
          graph.loseNextAnswer = true;
          yield* advance("outcome", 2);
          assert.strictEqual(graph.writes.length, 1);
          const landed = graph.writes[0]!;
          assert.strictEqual(yield* dispositionOf(7551), "integrating");
          // The source branch moves on afterwards; the landed receipt does not depend on it.
          yield* recordCommit("a0000552", ["a0000551"]);
          yield* TestClock.adjust("1 minute");
          yield* advance("operation");
          assert.strictEqual(graph.writes.length, 1);
          const { operations, outcomes } = yield* integrationOf(7551);
          assert.deepStrictEqual(
            operations.map((operation) => operation.state),
            ["applied"],
          );
          assert.deepStrictEqual(
            outcomes.map((outcome) => outcome.report.integration?.mergeCommit),
            [landed],
          );
          assert.strictEqual(yield* dispositionOf(7551), "done");
          assert.strictEqual(yield* closeRequests, 1);
        }),
      ),
    ),
);

it.effect("Lifecycle/N17: a conflicting integration is the work's to correct, not a retry", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7561);
        const implement = admittedBy(yield* advance("tracker_event", 1));
        yield* recordCommit("a0000561", [lifecycleBase]);
        yield* workStage(implement, {
          outcome: "implemented",
          subject: subjectFor("a0000561", lifecycleBase),
          summary: "Implemented.",
        });
        const review = admittedBy(yield* advance("outcome"));
        // Main moves on with a change that conflicts with the reviewed head.
        const graph = yield* GitGraphFake;
        yield* recordCommit("b0000562", [lifecycleBase]);
        graph.branches.set("main", "b0000562");
        graph.conflicts.add("b0000562:a0000561");
        yield* workStage(review, {
          outcome: "review_passed",
          subject: subjectFor("a0000561"),
          summary: "Passes.",
        });
        const correct = admittedBy(yield* advance("outcome"));
        assert.deepStrictEqual(stageOf(correct), [`github:${claimRepository}#7561`, "correct"]);
        assert.deepStrictEqual(graph.writes, []);
        assert.strictEqual(graph.branches.get("main"), "b0000562");
      }),
    ),
  ),
);

it.effect(
  "Lifecycle/N09: a late result is bound to its own attempt and reviewed, despite a newer release",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7601);
          const item = `github:${claimRepository}#7601`;
          const first = admittedBy(yield* advance("tracker_event", 1));
          // The first attempt ends without a result; once it is quiet, that fact is recorded and
          // corrected, with no timer.
          const firstWorker = yield* workStage(first, undefined);
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          yield* workStage(correct, { outcome: "correction_spec", summary: "Report the head." });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
          yield* startStage(rework);
          // The first attempt's success arrives late, after the rework was claimed.
          yield* recordCommit("a0000601", [lifecycleBase]);
          yield* reportFrom(firstWorker.threadId, {
            outcome: "implemented",
            subject: subjectFor("a0000601", lifecycleBase),
            summary: "Implemented, late.",
          });
          assert.deepStrictEqual(yield* advance("outcome", 3), []);
          assert.strictEqual(yield* dispositionOf(7601), "in_progress");
          // The rework, claimed before that success landed, then ends without a result.
          yield* completeLatestRun(admittedExecution(rework).threadId);
          const review = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(review), [item, "review"]);
          assert.strictEqual(
            review.reservation.origin !== "admitted" ? undefined : review.reservation.stageBasis,
            "review:a0000601",
          );
          assert.deepStrictEqual(yield* itemHistory(7601), [
            "implement",
            "failed",
            "correct",
            "correction_spec",
            "rework",
            "implemented",
            "failed",
            "review",
          ]);
        }),
      ),
    ),
);

it.effect("Lifecycle/N32: an owner-rejected result is never resurrected by a later review", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7651);
        const item = `github:${claimRepository}#7651`;
        const implement = admittedBy(yield* advance("tracker_event", 1));
        yield* recordCommit("a0000651", [lifecycleBase]);
        yield* workStage(implement, {
          outcome: "implemented",
          subject: subjectFor("a0000651", lifecycleBase),
          summary: "Implemented.",
        });
        const review = admittedBy(yield* advance("outcome"));
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
        const [implemented] = yield* outcomes.listForOrigin(implement.reservation.reservationId);
        assert.isTrue(
          yield* factory.rejectOutcome({
            factoryId,
            outcomeId: implemented!.outcomeId,
            reason: "Out of scope: touches the ledger schema.",
            by: "owner",
          }),
        );
        // Rejected once; asking again changes nothing.
        assert.isFalse(
          yield* factory.rejectOutcome({
            factoryId,
            outcomeId: implemented!.outcomeId,
            reason: "Again.",
            by: "owner",
          }),
        );
        // The review that was already running passes the rejected head: it resurrects nothing.
        yield* workStage(review, {
          outcome: "review_passed",
          subject: subjectFor("a0000651"),
          summary: "Passes.",
        });
        const correct = admittedBy(yield* advance("outcome"));
        assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
        assert.deepStrictEqual((yield* GitGraphFake).writes, []);
      }),
    ),
  ),
);

/** A supervised policy: every start needs the owner's grant for its exact request. */
const proposeSupervised: ProposeFn = (input) =>
  Effect.map(stageRequest(input), (decision) =>
    decision !== undefined && !("type" in decision)
      ? {
          ...decision,
          requiresGrant: {
            reason: "Supervised ticket: the owner grants each start.",
            evidenceDigest: sha256(`${input.observation.itemKey}\n${input.issue.body}`),
          },
        }
      : decision,
  );

it.effect("Lifecycle/N12: a finite grant is spent once, on its exact subject, or not at all", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* configureFactory(lifecycleConfiguration({ pools: pool(3) }));
        yield* usePolicy(proposeSupervised);
        yield* seedIssue(7701);
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const answer = (issueNumber: number, units: number) =>
          Effect.gen(function* () {
            const pending = (yield* factory.readState({ factoryId })).reservedDecisions.filter(
              (decision) =>
                decision.itemKey === itemKeyFor(issueNumber) && decision.state === "pending",
            );
            assert.strictEqual(pending.length, 1);
            assert.strictEqual(pending[0]!.kind, "grant");
            return yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: pending[0]!.decisionId,
              answer: "grant",
              by: "owner",
              grantUnits: units,
            });
          });
        const grantOf = (issueNumber: number) =>
          Effect.map(factory.readState({ factoryId }), (state) =>
            state.grants
              .filter((grant) => grant.itemKey === itemKeyFor(issueNumber))
              .map((grant) => [grant.state, grant.remaining, grant.spentBy.length]),
          );

        // Without authority it waits, visibly, and starts nothing.
        assert.deepStrictEqual(yield* advance("tracker_event", 2), []);
        assert.strictEqual(yield* dispositionOf(7701), "awaiting_grant");
        assert.isTrue(yield* answer(7701, 1));
        const spent = admittedBy(yield* advance("owner_decision", 1));
        assert.deepStrictEqual(stageOf(spent), [`github:${claimRepository}#7701`, "implement"]);
        assert.deepStrictEqual(yield* grantOf(7701), [["spent", 0, 1]]);

        // The request changes before its grant is spent: nothing is spent on the old answer.
        yield* seedIssue(7702);
        yield* advance("tracker_event", 1);
        assert.isTrue(yield* answer(7702, 1));
        const fake = yield* GitHubFake;
        fake.issues.get(issueKey(claimRepository, 7702))!.body = "Implement 7702, now with export.";
        assert.deepStrictEqual(yield* advance("tracker_event", 1), []);
        assert.strictEqual(yield* dispositionOf(7702), "awaiting_grant");
        assert.deepStrictEqual(yield* grantOf(7702), [["active", 1, 0]]);

        // Its target becomes ineligible: the grant stays unspent and never falls through to
        // another ticket, which waits for its own.
        yield* seedIssue(7703);
        yield* advance("tracker_event", 1);
        assert.isTrue(yield* answer(7703, 1));
        fake.issues.get(issueKey(claimRepository, 7703))!.labels = [];
        yield* seedIssue(7704);
        assert.deepStrictEqual(yield* advance("tracker_event", 1), []);
        assert.deepStrictEqual(yield* grantOf(7703), [["active", 1, 0]]);
        assert.strictEqual(yield* dispositionOf(7704), "awaiting_grant");
        assert.deepStrictEqual(yield* grantOf(7704), []);

        // A revoked grant spends nothing, and the next request is a new one for the owner.
        const grant7703 = (yield* factory.readState({ factoryId })).grants.find(
          (grant) => grant.itemKey === itemKeyFor(7703),
        );
        assert.isTrue(
          yield* factory.revokeGrant({ factoryId, grantId: grant7703!.grantId, by: "owner" }),
        );
        fake.issues.get(issueKey(claimRepository, 7703))!.labels = ["ready"];
        assert.deepStrictEqual(yield* advance("tracker_event", 1), []);
        assert.strictEqual(yield* dispositionOf(7703), "awaiting_grant");
        assert.deepStrictEqual(yield* grantOf(7703), [["revoked", 1, 0]]);
        assert.strictEqual(yield* occupied, 1);
      }),
    ),
  ),
);

it.effect(
  "Lifecycle/N12: only the answer that settles a grant request issues its grant, however the answers race",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeSupervised);
          yield* seedIssue(7711);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.deepStrictEqual(yield* advance("tracker_event", 2), []);
          const [pending] = (yield* factory.readState({ factoryId })).reservedDecisions.filter(
            (decision) => decision.itemKey === itemKeyFor(7711) && decision.state === "pending",
          );
          assert.strictEqual(pending?.kind, "grant");
          // The owner's card grants one start and has read the request as pending when the owner
          // declines it in Settings.
          const hold = yield* DecisionReadHold;
          yield* Ref.set(hold.armed, true);
          const granting = yield* Effect.forkScoped(
            factory.resolveReservedDecision({
              factoryId,
              decisionId: pending!.decisionId,
              answer: "grant",
              grantUnits: 1,
              by: "session:owner:card",
            }),
          );
          yield* Deferred.await(hold.reached);
          assert.isTrue(
            yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: pending!.decisionId,
              answer: "decline",
              by: "session:owner:settings",
            }),
          );
          yield* Deferred.succeed(hold.release, undefined);
          assert.isFalse(yield* Fiber.join(granting));
          const state = yield* factory.readState({ factoryId });
          const answered = state.reservedDecisions.find(
            (decision) => decision.decisionId === pending!.decisionId,
          );
          assert.deepStrictEqual(
            [answered?.state, answered?.resolution?.answer, answered?.resolution?.by],
            ["resolved", "decline", "session:owner:settings"],
          );
          assert.deepStrictEqual(
            state.grants.filter((grant) => grant.itemKey === itemKeyFor(7711)),
            [],
          );
          // The declined request starts nothing.
          assert.deepStrictEqual(admittedOnly(yield* advance("owner_decision", 2)), []);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N12: a grant that settles its request first is issued once, as its giver's, and a later answer changes nothing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeSupervised);
          yield* seedIssue(7712);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.deepStrictEqual(yield* advance("tracker_event", 2), []);
          const [pending] = (yield* factory.readState({ factoryId })).reservedDecisions.filter(
            (decision) => decision.itemKey === itemKeyFor(7712) && decision.state === "pending",
          );
          // This time the decline has read the request as pending when the grant settles it.
          const hold = yield* DecisionReadHold;
          yield* Ref.set(hold.armed, true);
          const declining = yield* Effect.forkScoped(
            factory.resolveReservedDecision({
              factoryId,
              decisionId: pending!.decisionId,
              answer: "decline",
              by: "session:owner:settings",
            }),
          );
          yield* Deferred.await(hold.reached);
          const grant = (units: number) =>
            factory.resolveReservedDecision({
              factoryId,
              decisionId: pending!.decisionId,
              answer: "grant",
              grantUnits: units,
              by: "session:owner:card",
            });
          assert.isTrue(yield* grant(1));
          yield* Deferred.succeed(hold.release, undefined);
          assert.isFalse(yield* Fiber.join(declining));
          assert.isFalse(yield* grant(3));
          const state = yield* factory.readState({ factoryId });
          const answered = state.reservedDecisions.find(
            (decision) => decision.decisionId === pending!.decisionId,
          );
          const grants = state.grants.filter((issued) => issued.itemKey === itemKeyFor(7712));
          assert.deepStrictEqual(
            grants.map((issued) => [issued.issuedBy, issued.units, issued.remaining, issued.state]),
            [["session:owner:card", 1, 1, "active"]],
          );
          assert.deepStrictEqual(
            [answered?.resolution?.answer, answered?.resolution?.by, answered?.resolution?.grantId],
            ["grant", "session:owner:card", grants[0]!.grantId],
          );
          const started = admittedBy(yield* advance("owner_decision", 1));
          assert.deepStrictEqual(stageOf(started), [itemKeyFor(7712), "implement"]);
        }),
      ),
    ),
);

const pendingGrantRequests = (issueNumber: number) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    Effect.map(factory.readState({ factoryId }), (state) =>
      state.reservedDecisions.filter(
        (decision) => decision.itemKey === itemKeyFor(issueNumber) && decision.state === "pending",
      ),
    ),
  );

const grantsOf = (issueNumber: number) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    Effect.map(factory.readState({ factoryId }), (state) =>
      state.grants.filter((grant) => grant.itemKey === itemKeyFor(issueNumber)),
    ),
  );

it.effect(
  "Lifecycle/N12: grant units sent with any answer but a grant settle nothing and issue nothing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeSupervised);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          // A decline sent with units, over RPC or MCP, settles nothing and issues nothing.
          yield* seedIssue(7713);
          assert.deepStrictEqual(yield* advance("tracker_event", 2), []);
          const [asked] = yield* pendingGrantRequests(7713);
          assert.isFalse(
            yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: asked!.decisionId,
              answer: "decline",
              grantUnits: 2,
              by: "session:owner:mcp",
            }),
          );
          assert.deepStrictEqual(yield* grantsOf(7713), []);
          assert.strictEqual((yield* pendingGrantRequests(7713)).length, 1);
          // The owner's grant, as the card and Settings send it, still settles it.
          assert.isTrue(
            yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: asked!.decisionId,
              answer: "grant",
              grantUnits: 1,
              by: "session:owner:settings",
            }),
          );
          assert.strictEqual((yield* grantsOf(7713)).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N12: a grant that fails to be issued leaves its request unanswered, to be answered again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeSupervised);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          yield* seedIssue(7715);
          assert.deepStrictEqual(yield* advance("tracker_event", 2), []);
          const [asked] = yield* pendingGrantRequests(7715);
          const grant = factory.resolveReservedDecision({
            factoryId,
            decisionId: asked!.decisionId,
            answer: "grant",
            grantUnits: 1,
            by: "session:owner:card",
          });
          // The decision was settled first in the same transaction: it rolls back with the grant.
          yield* Ref.set(yield* GrantIssueFault, true);
          assert.strictEqual((yield* Effect.flip(grant))._tag, "FactoryLifecycleError");
          assert.strictEqual((yield* pendingGrantRequests(7715)).length, 1);
          assert.deepStrictEqual(yield* grantsOf(7715), []);
          assert.isTrue(yield* grant);
          assert.deepStrictEqual(
            (yield* grantsOf(7715)).map((issued) => [issued.issuedBy, issued.remaining]),
            [["session:owner:card", 1]],
          );
          assert.deepStrictEqual(stageOf(admittedBy(yield* advance("owner_decision", 1))), [
            itemKeyFor(7715),
            "implement",
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N12: a grant its own request's answer did not issue stays in the record and starts nothing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeSupervised);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          // A grant left by an answer that did not settle its request, as the race before this
          // fix could leave one: it stays in the record but starts nothing.
          yield* seedIssue(7714);
          assert.deepStrictEqual(yield* advance("tracker_event", 2), []);
          const [declined] = yield* pendingGrantRequests(7714);
          assert.isTrue(
            yield* factory.resolveReservedDecision({
              factoryId,
              decisionId: declined!.decisionId,
              answer: "decline",
              by: "session:owner:settings",
            }),
          );
          const store = yield* FactoryStore.FactoryStore;
          const stored = (yield* outcomesDecisions(declined!.decisionId))!;
          yield* store.issueGrant({
            factoryId,
            itemKey: stored.itemKey,
            stage: stored.stage,
            evidenceDigest: stored.evidenceDigest,
            units: 1,
            decisionId: stored.decisionId,
            by: "session:owner:card",
          });
          assert.deepStrictEqual(admittedOnly(yield* advance("owner_decision", 2)), []);
          assert.deepStrictEqual(
            (yield* grantsOf(7714)).map((grant) => [grant.state, grant.remaining]),
            [["active", 1]],
          );
          // Nor does it count as an issued grant: the owner's decline stands, and is not asked again.
          assert.deepStrictEqual(yield* pendingGrantRequests(7714), []);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N12: a grant an earlier build issued on an answer that is not an explicit grant starts nothing",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(10) }));
          yield* usePolicy(proposeSupervised);
          // Earlier builds, the rollback target among them, issued a grant for any answer sent with
          // units, and recorded that answer on the decision with the grant's id.
          const answers = new Map([
            [7721, "declined"],
            [7722, "Rejected."],
            [7723, "denied"],
            [7724, "no"],
            [7725, "yes"],
            [7726, "approved, once the account is back"],
            [7727, "Grant"],
            [7728, " APPROVE "],
          ]);
          for (const issueNumber of answers.keys()) yield* seedIssue(issueNumber);
          assert.deepStrictEqual(admittedOnly(yield* advance("tracker_event", 2)), []);
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const store = yield* FactoryStore.FactoryStore;
          for (const [issueNumber, answer] of answers) {
            const [request] = yield* pendingGrantRequests(issueNumber);
            const stored = (yield* outcomesDecisions(request!.decisionId))!;
            yield* store.issueGrant({
              factoryId,
              itemKey: stored.itemKey,
              stage: stored.stage,
              evidenceDigest: stored.evidenceDigest,
              units: 1,
              decisionId: stored.decisionId,
              by: "session:owner:mcp",
            });
            assert.isTrue(
              yield* outcomes.resolveDecision({
                decisionId: stored.decisionId,
                answer,
                by: "session:owner:mcp",
                grantId: FactoryStore.grantIdOf(stored.decisionId),
              }),
            );
          }
          // Only the explicit grants start their item; every other answer stays as it was recorded,
          // its grant unspent, and is not asked again.
          const started = admittedOnly(yield* advance("owner_decision", 2));
          assert.deepStrictEqual(started.map((admission) => stageOf(admission)).toSorted(), [
            [itemKeyFor(7727), "implement"],
            [itemKeyFor(7728), "implement"],
          ]);
          for (const [issueNumber, answer] of answers) {
            const explicit = issueNumber === 7727 || issueNumber === 7728;
            assert.deepStrictEqual(
              (yield* grantsOf(issueNumber)).map((grant) => [grant.state, grant.remaining]),
              [explicit ? ["spent", 0] : ["active", 1]],
              answer,
            );
            assert.deepStrictEqual(yield* pendingGrantRequests(issueNumber), [], answer);
          }
        }),
      ),
    ),
);

/** A reserved decision as stored, with the evidence its grant must match. */
const outcomesDecisions = (decisionId: string) =>
  Effect.map(
    Effect.flatMap(FactoryOutcomeStore.FactoryOutcomeStore, (outcomes) =>
      outcomes.reservedDecisions(factoryId),
    ),
    (decisions) => decisions.find((decision) => decision.decisionId === decisionId),
  );

it.effect("Lifecycle/N13: a slow read is recorded unread, spends nothing and is read again", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* configureFactory(
          lifecycleConfiguration({ pools: pool(2), readDeadlineSeconds: 30 }),
        );
        yield* seedIssue(7801);
        yield* seedIssue(7802);
        const fake = yield* GitHubFake;
        fake.slowIssues.add(7801);
        const pass = yield* Effect.forkScoped(advance("tracker_event", 1));
        yield* TestClock.adjust("31 seconds");
        const admissions = yield* Fiber.join(pass);
        assert.deepStrictEqual(stageOf(admittedBy(admissions)), [
          `github:${claimRepository}#7802`,
          "implement",
        ]);
        assert.strictEqual(yield* dispositionOf(7801), "read_deadline");
        assert.strictEqual(yield* occupied, 1);
        fake.slowIssues.delete(7801);
        const again = admittedBy(yield* advance("clock", 1));
        assert.deepStrictEqual(stageOf(again), [`github:${claimRepository}#7801`, "implement"]);
      }),
    ),
  ),
);

it.effect(
  "Takeover: the owner installs a paused factory, disposes of exact legacy carriers, then starts it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const graph = yield* GitGraphFake;
          graph.parents.set(lifecycleBase, []);
          graph.branches.set("main", lifecycleBase);
          yield* usePolicy(stageRequest);
          const projects = yield* ProjectService.ProjectService;
          yield* projects.create({
            commandId: CommandId.make("command:factory-takeover-project"),
            projectId,
            title: "alpha",
            workspaceRoot: yield* FactoryWorkspace,
          });
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          // The document the owner installs, exactly as a configuration file holds it.
          const document = (enabled: boolean) =>
            JSON.stringify({
              factoryId,
              projectId,
              policyRevision: "policy-r1",
              enabled,
              packet: { briefSchemaVersion: "brief-v1", helper: null },
              artifactRoot: process.cwd(),
              ...lifecycleConfiguration(),
            });

          // A document that does not decode installs nothing.
          for (const invalid of ["{", JSON.stringify({ factoryId, enabled: false })]) {
            const refused = yield* Effect.flip(factory.installConfiguration(invalid));
            assert.strictEqual(refused._tag, "FactoryConfigurationInvalid");
          }
          assert.isNull((yield* factory.readState({ factoryId })).configuration);

          const installed = yield* factory.installConfiguration(document(false));
          assert.isFalse(installed.enabled);
          assert.isFalse((yield* factory.readState({ factoryId })).configuration?.enabled);

          // Legacy carriers on an issue the paused factory would otherwise start.
          yield* seedIssue(7871);
          const fake = yield* GitHubFake;
          const legacy = fake.issues.get(issueKey(claimRepository, 7871))!;
          for (const attempt of [1, 2]) {
            legacy.comments.push({
              id: fake.nextCommentId++,
              body: `Claimed issue-7871-implement-${attempt}: legacy loop attempt ${attempt}.`,
              user: factoryAccount,
              created_at: "2026-10-24T00:00:00Z",
            });
          }
          // A paused factory reads nothing new by itself.
          for (const trigger of ["tracker_event", "clock", "restart"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 1), []);
          }
          assert.lengthOf(yield* reservationsOf(7871, "observed"), 0);

          // Observing records each carrier as held custody, and decides nothing.
          assert.lengthOf(yield* factory.observeClaims({ factoryId }), 2);
          for (const trigger of ["tracker_event", "clock", "restart"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 1), []);
          }
          assert.strictEqual((yield* startedTurns).length, 0);
          const view = factoryStateView(yield* factory.readState({ factoryId }));
          const carriers = view.reservations.filter((entry) => entry.origin === "observed");
          assert.lengthOf(carriers, 2);
          assert.isTrue(carriers.every((entry) => entry.carrierKey !== undefined));

          // The owner disposes of exactly those carriers; observing again charges nothing new.
          for (const carrier of carriers) {
            assert.isTrue(
              yield* factory.disposeObservedClaim({
                factoryId,
                reservationId: FactoryReservationId.make(carrier.reservationId),
                by: "owner",
                reason: `authorized disposition of ${carrier.carrierKey}`,
              }),
            );
          }
          assert.lengthOf(yield* factory.observeClaims({ factoryId }), 0);

          // Started, the factory takes the item natively.
          assert.isTrue((yield* factory.installConfiguration(document(true))).enabled);
          const admitted = admittedBy(yield* advance("tracker_event", 1));
          assert.deepStrictEqual(stageOf(admitted), [itemKeyFor(7871), "implement"]);
          // Its claim is written on the issue the disposed carriers are still on: a disposed carrier
          // is no one's claim, so the claim's own read does not charge or count it again.
          yield* runEffects;
          assert.lengthOf(yield* claimComments(7871), 1);
          assert.deepStrictEqual(
            (yield* reservationsOf(7871, "observed")).map((held) => held.state),
            ["released", "released"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N20: the policy's reason for starting nothing is what the state reads back",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7853);
          const reason = "#73 waits for #75: its correction owns service.py";
          yield* usePolicy(() => Effect.succeed({ type: "none", reason }));
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          for (const trigger of ["tracker_event", "clock", "restart"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 1), []);
            const state = yield* factory.readState({ factoryId });
            // As the owner's clients and the agents' MCP tool read it.
            for (const view of [state, factoryStateView(state)]) {
              const record = view.lastCollection.find(
                (entry) => entry.itemKey === itemKeyFor(7853),
              );
              assert.deepStrictEqual(
                [record?.stage, record?.disposition, record?.detail],
                ["implement", "nothing_proposed", reason],
              );
            }
          }
          assert.strictEqual(yield* commentPosts, 0);
        }),
      ),
    ),
);

it.effect("Lifecycle/N20: a policy that cannot decide is one visible issue, with no writes", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* seedIssue(7851);
        yield* seedIssue(7852);
        const policy = yield* PolicyFake;
        policy.failAll = "rules pin 97f66dc does not match the adopted revision";
        for (const trigger of ["tracker_event", "clock", "restart"] as const) {
          assert.deepStrictEqual(yield* advance(trigger, 1), []);
        }
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        assert.deepStrictEqual((yield* factory.readState({ factoryId })).issues, [
          { kind: "policy", detail: "rules pin 97f66dc does not match the adopted revision" },
        ]);
        assert.strictEqual(yield* commentPosts, 0);
        assert.strictEqual(yield* dispositionOf(7851), "policy_failed");
        // Adopting a working revision between decisions: new work takes it, nothing is rewritten.
        policy.failAll = undefined;
        yield* configureFactory(
          lifecycleConfiguration({ pools: pool(2), policyRevision: "policy-r2" }),
        );
        const admissions = yield* advance("tracker_event", 1);
        assert.strictEqual(
          admissions.filter((admission) => admission.type === "admitted").length,
          2,
        );
        const state = yield* factory.readState({ factoryId });
        assert.deepStrictEqual(state.issues, []);
        assert.deepStrictEqual(
          state.reservations.map((reservation) =>
            reservation.origin === "admitted" ? reservation.policyRevision : reservation.origin,
          ),
          ["policy-r2", "policy-r2"],
        );
      }),
    ),
  ),
);

it.effect(
  "Lifecycle/N22: settling a worker's thread proves nothing; a quiet run without a result is a failure",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7901);
          const item = `github:${claimRepository}#7901`;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const execution = yield* startStage(implement);
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const settle = (label: string) =>
            orchestrator.dispatch({
              type: "thread.settle",
              commandId: CommandId.make(`command:settle:${label}`),
              threadId: execution.threadId,
            });
          // The inbox guard refuses to settle a thread whose run is live.
          assert.strictEqual(Exit.isFailure(yield* Effect.exit(settle("live"))), true);
          assert.deepStrictEqual(yield* advance("outcome", 2), []);
          assert.strictEqual(yield* occupied, 1);
          assert.strictEqual(yield* dispositionOf(7901), "in_progress");
          // Its run ends without a report, and the thread is settled: settled is not success.
          // Once the execution is quiet, the missing result is recorded as a typed failure, and
          // correction follows in the same pass that recorded it.
          yield* completeLatestRun(execution.threadId);
          yield* settle("ended");
          const correct = admittedBy(yield* advance("outcome", 1));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          assert.deepStrictEqual(yield* itemHistory(7901), ["implement", "failed", "correct"]);
        }),
      ),
    ),
);

/**
 * Implement, a failing review and its correction, each worked to a verified outcome, with the
 * rework they lead to admitted and under way.
 */
const reworkAdmitted = (issueNumber: number, head: string) =>
  Effect.gen(function* () {
    yield* configureLifecycleFactory;
    yield* seedIssue(issueNumber);
    const implement = admittedBy(yield* advance("tracker_event", 1));
    yield* recordCommit(head, [lifecycleBase]);
    yield* workStage(implement, {
      outcome: "implemented",
      subject: subjectFor(head, lifecycleBase),
      summary: "Implemented.",
    });
    const review = admittedBy(yield* advance("outcome"));
    yield* workStage(review, {
      outcome: "review_failed",
      subject: subjectFor(head),
      failure: "test_a fails",
      summary: "One failing check.",
    });
    const correct = admittedBy(yield* advance("outcome"));
    yield* workStage(correct, { outcome: "correction_spec", summary: "Fix test_a." });
    const rework = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(rework), [`github:${claimRepository}#${issueNumber}`, "rework"]);
    return { finished: [implement, review, correct], rework };
  });

const threadOf = (threadId: ThreadId) =>
  Effect.map(
    Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.getThreadProjection(threadId),
    ),
    (projection) => projection.thread,
  );

const settledAtOf = (threadId: ThreadId) =>
  Effect.map(threadOf(threadId), (thread) =>
    thread.settledAt === null ? null : DateTime.toEpochMillis(thread.settledAt),
  );

/** The `thread.settled` events the factory's own settle command for the stage committed. */
const stageSettledEvents = (reservationId: FactoryReservationId) =>
  Effect.flatMap(EventSink.EventSinkV2, (sink) =>
    sink
      .readByCommandId({ commandId: CommandId.make(`factory-stage-settle:${reservationId}`) })
      .pipe(
        Stream.filter((stored) => stored.event.type === "thread.settled"),
        Stream.runCollect,
        Effect.map((events) => Array.from(events).length),
      ),
  );

/** A worker that fails at once without reporting, as one does on an account at its usage limit. */
const failFast = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
  Effect.flatMap(startStage(admission), (execution) =>
    completeLatestRun(execution.threadId, "failed"),
  );

const ownerComment = (issueNumber: number, body: string) =>
  Effect.map(GitHubFake, (fake) => {
    fake.issues.get(issueKey(claimRepository, issueNumber))!.comments.push({
      id: fake.nextCommentId++,
      body,
      user: { id: 42, login: "owner" },
      created_at: "2026-10-27T02:00:00Z",
    });
  });

it.effect(
  "Lifecycle/N22: a correction that keeps ending without a result is retried once, then again only when the item changes (HSA #94)",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7941);
          const item = `github:${claimRepository}#7941`;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(implement, {
            outcome: "failed",
            failure: "Verification failed: the 17/03 row is skipped.",
            summary: "Verification failed.",
          });
          // Each correction's worker fails at once, as one does on an account at its usage limit.
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          yield* failFast(correct);
          const retry = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(retry), [item, "correct"]);
          yield* failFast(retry);
          // The same attempt failing the same way is the same decision: nothing refills.
          const starts = (yield* startedTurns).length;
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
          assert.strictEqual((yield* startedTurns).length, starts);
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const missing = (yield* outcomes.itemRecords({ factoryId, itemKey: itemKeyFor(7941) }))
            .map(({ record }) => record)
            .filter(
              (record) => record.type === "outcome" && record.outcomeId.startsWith("no-result:"),
            );
          assert.strictEqual(missing.length, 2);
          // A person asks for another attempt on the issue: one more correction, no more.
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7941))!.comments.push({
            id: fake.nextCommentId++,
            body: "Owner: the account is back; try the correction again.",
            user: { id: 42, login: "owner" },
            created_at: "2026-10-27T02:00:00Z",
          });
          const again = admittedBy(yield* advance("tracker_event"));
          assert.deepStrictEqual(stageOf(again), [item, "correct"]);
          yield* workStage(again, { outcome: "correction_spec", summary: "Restore the row." });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
          assert.deepStrictEqual(yield* itemHistory(7941), [
            "implement",
            "failed",
            "correct",
            "failed",
            "correct",
            "failed",
            "correct",
            "correction_spec",
            "rework",
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N22: a stalled correction is asked about on the attempt that ended, and each rejection retries it once more",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7942);
          const item = `github:${claimRepository}#7942`;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const ownerThreadId = admittedExecution(implement).threadId;
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* workStage(implement, {
            outcome: "failed",
            failure: "Verification failed: the 17/03 row is skipped.",
            summary: "Verification failed.",
          });
          yield* failFast(admittedBy(yield* advance("outcome")));
          const retried = admittedBy(yield* advance("outcome"));
          yield* failFast(retried);
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 2)), []);
          // Stalled: the owner is asked about the correction attempt that just ended without a result.
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [ended] = yield* outcomes.listForOrigin(retried.reservation.reservationId);
          const [card] = yield* factoryCards(ownerThreadId);
          assert.strictEqual(
            card!.request.id,
            `factory-card:${factoryId}:result:${encodeURIComponent(ended!.outcomeId)}:1`,
          );
          // Its id still names a factory card, so an agent's ordinary answer is refused.
          const refused = yield* Effect.flip(
            (yield* Orchestrator.OrchestratorV2).dispatch({
              type: "runtime-request.respond",
              commandId: CommandId.make("command:agent-answers-stalled-card"),
              threadId: ownerThreadId,
              requestId: card!.request.id,
              answers: { action: "reject", reason: "An agent's answer." },
            }),
          );
          assert.include(String(refused.cause ?? refused.message), "answered only by its owner");
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          yield* factory.answerCard({
            threadId: ownerThreadId,
            requestId: card!.request.id,
            answers: { action: "reject", reason: "The account is back: correct it again." },
            by: "session:owner:1",
          });
          const again = admittedBy(yield* advance("owner_decision"));
          assert.deepStrictEqual(stageOf(again), [item, "correct"]);
          // Each rejection is one more attempt, not a new refill.
          yield* failFast(again);
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          // Stalled again, the owner is asked again, on the attempt that just ended, and can retry once more.
          const open = (yield* factoryCards(ownerThreadId)).filter(
            (pending) => pending.request.status === "pending",
          );
          assert.strictEqual(open.length, 1);
          yield* factory.answerCard({
            threadId: ownerThreadId,
            requestId: open[0]!.request.id,
            answers: { action: "reject", reason: "Once more, the account is back now." },
            by: "session:owner:1",
          });
          const third = admittedBy(yield* advance("owner_decision"));
          assert.deepStrictEqual(stageOf(third), [item, "correct"]);
        }),
      ),
    ),
);

/** An item stalled on a correction that twice ended without a result, before its owner is configured. */
const stalledCorrection = (issueNumber: number) =>
  Effect.gen(function* () {
    yield* configureLifecycleFactory;
    yield* seedIssue(issueNumber);
    const implement = admittedBy(yield* advance("tracker_event", 1));
    yield* workStage(implement, {
      outcome: "failed",
      failure: "Verification failed: the 17/03 row is skipped.",
      summary: "Verification failed.",
    });
    yield* failFast(admittedBy(yield* advance("outcome")));
    const retried = admittedBy(yield* advance("outcome"));
    yield* failFast(retried);
    assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 2)), []);
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    const [ended] = yield* outcomes.listForOrigin(retried.reservation.reservationId);
    return { ownerThreadId: admittedExecution(implement).threadId, ended: ended!.outcomeId };
  });

/** A stalled-result card as a build before encoded card ids raised it (the rollback target does). */
const earlierBuildCard = (ownerThreadId: ThreadId, requestId: string) =>
  Effect.gen(function* () {
    yield* (yield* Orchestrator.OrchestratorV2).dispatch({
      type: "factory_card.record",
      commandId: CommandId.make(`factory-card-record:${requestId}`),
      threadId: ownerThreadId,
      requestId: RuntimeRequestId.make(requestId),
      questions: [
        {
          id: "action",
          header: "Stalled result",
          question: "The item is stalled on this result.",
          options: [
            { label: "Reject result", description: "Send it back to correction.", value: "reject" },
            { label: "Keep it", description: "Leave the result and stop asking.", value: "keep" },
          ],
        },
      ],
    });
  });

it.effect(
  "Lifecycle/N22: a card an earlier build raised on a raw subject is answered by no one, withdrawn and asked again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { ownerThreadId, ended } = yield* stalledCorrection(7944);
          assert.include(ended, ":");
          // What a rollback build leaves in the owner's thread: its unencoded card for this result,
          // and a card id no build can read.
          const legacy = `factory-card:${factoryId}:result:${ended}:1`;
          const malformed = `factory-card:${factoryId}:result:%E0%A4%A:1`;
          yield* earlierBuildCard(ownerThreadId, legacy);
          yield* earlierBuildCard(ownerThreadId, malformed);
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          for (const requestId of [legacy, malformed]) {
            const refused = yield* Effect.flip(
              orchestrator.dispatch({
                type: "runtime-request.respond",
                commandId: CommandId.make(`command:agent-answers:${requestId}`),
                threadId: ownerThreadId,
                requestId: RuntimeRequestId.make(requestId),
                answers: { action: "reject", reason: "An agent's answer." },
              }),
            );
            assert.include(String(refused.cause ?? refused.message), "answered only by its owner");
          }
          // The owner's own answer is refused as well: the card is withdrawn unanswered.
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const owner = yield* Effect.flip(
            factory.answerCard({
              threadId: ownerThreadId,
              requestId: legacy,
              answers: { action: "reject", reason: "The account is back." },
              by: "session:owner:1",
            }),
          );
          assert.include(owner.message, "earlier version");
          const withdrawn = (yield* factoryCards(ownerThreadId)).find(
            (card) => card.request.id === legacy,
          );
          assert.strictEqual(withdrawn?.request.status, "cancelled");
          assert.isUndefined(withdrawn?.request.answers);
          assert.notInclude(yield* itemHistory(7944), "rejected");
          // The next pass withdraws the unreadable card too, and asks about the result again under
          // an id every guard reads.
          yield* advance("clock", 2);
          const asked = `factory-card:${factoryId}:result:${encodeURIComponent(ended)}:2`;
          assert.deepStrictEqual(
            new Map(
              (yield* factoryCards(ownerThreadId)).map((card) => [
                card.request.id,
                card.request.status,
              ]),
            ),
            new Map([
              [legacy, "cancelled"],
              [malformed, "cancelled"],
              [asked, "pending"],
            ]),
          );
          yield* factory.answerCard({
            threadId: ownerThreadId,
            requestId: asked,
            answers: { action: "reject", reason: "The account is back: correct it again." },
            by: "session:owner:1",
          });
          assert.deepStrictEqual(stageOf(admittedBy(yield* advance("owner_decision"))), [
            `github:${claimRepository}#7944`,
            "correct",
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N22: an answer an earlier build took on a raw-subject card never reached the factory, so the result is asked again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { ownerThreadId, ended } = yield* stalledCorrection(7945);
          const legacy = `factory-card:${factoryId}:result:${ended}:1`;
          yield* earlierBuildCard(ownerThreadId, legacy);
          // The earlier build's guards did not read the card, so it took an answer (anyone's) as an
          // ordinary one: recorded on the card, delivered to the thread, never acted on.
          yield* (yield* Orchestrator.OrchestratorV2).dispatch({
            type: "factory_card.resolve",
            commandId: CommandId.make(`factory-card-resolve:${legacy}`),
            threadId: ownerThreadId,
            requestId: RuntimeRequestId.make(legacy),
            status: "resolved",
            answers: { action: "keep" },
          });
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          const starts = (yield* startedTurns).length;
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
          assert.strictEqual((yield* startedTurns).length, starts);
          // That answer stays as it was recorded, and decides nothing: the owner is asked again.
          const cards = new Map(
            (yield* factoryCards(ownerThreadId)).map((card) => [card.request.id, card.request]),
          );
          assert.strictEqual(cards.size, 2);
          assert.strictEqual(cards.get(RuntimeRequestId.make(legacy))?.status, "resolved");
          assert.deepStrictEqual(cards.get(RuntimeRequestId.make(legacy))?.answers, {
            action: "keep",
          });
          const asked = RuntimeRequestId.make(
            `factory-card:${factoryId}:result:${encodeURIComponent(ended)}:2`,
          );
          assert.strictEqual(cards.get(asked)?.status, "pending");
          assert.notInclude(yield* itemHistory(7945), "rejected");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N22: implement and rework that keep ending without a result are corrected once, however many specs; a real failure still is",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7943);
          const item = `github:${claimRepository}#7943`;
          // Corrections succeed, as on another account; every build fails at once.
          yield* failFast(admittedBy(yield* advance("tracker_event", 1)));
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          yield* workStage(correct, { outcome: "correction_spec", summary: "Build it." });
          yield* failFast(admittedBy(yield* advance("outcome")));
          const recorrect = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(recorrect), [item, "correct"]);
          yield* workStage(recorrect, { outcome: "correction_spec", summary: "Report a result." });
          yield* failFast(admittedBy(yield* advance("outcome")));
          // The rework failing the same way again is the same failure: no new correction.
          const starts = (yield* startedTurns).length;
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
          assert.strictEqual((yield* startedTurns).length, starts);
          // A person's comment is new evidence: one more correction, whose rework then reports a
          // real failure, which is corrected as any is.
          yield* ownerComment(7943, "Owner: the builders' account is back.");
          const asked = admittedBy(yield* advance("tracker_event"));
          assert.deepStrictEqual(stageOf(asked), [item, "correct"]);
          yield* workStage(asked, { outcome: "correction_spec", summary: "Build it, now." });
          const rework = admittedBy(yield* advance("outcome"));
          yield* workStage(rework, {
            outcome: "failed",
            failure: "Verification failed: the importer counts a row twice.",
            summary: "Verification failed.",
          });
          assert.deepStrictEqual(stageOf(admittedBy(yield* advance("outcome"))), [item, "correct"]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N22: a reopened item's first build ending without a result is a failure of its new version, corrected",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7944);
          const item = `github:${claimRepository}#7944`;
          // The first version: a build that ended without a result, corrected, then built, reviewed and closed.
          yield* failFast(admittedBy(yield* advance("tracker_event", 1)));
          yield* workStage(admittedBy(yield* advance("outcome")), {
            outcome: "correction_spec",
            summary: "Build it.",
          });
          yield* recordCommit("a0007944", [lifecycleBase]);
          yield* workStage(admittedBy(yield* advance("outcome")), {
            outcome: "implemented",
            subject: subjectFor("a0007944", lifecycleBase),
            summary: "Built.",
          });
          yield* workStage(admittedBy(yield* advance("outcome")), {
            outcome: "review_passed",
            subject: subjectFor("a0007944"),
            summary: "Passes.",
          });
          yield* advance("outcome");
          assert.deepStrictEqual((yield* itemHistory(7944)).slice(-2), ["integrated", "closed"]);
          // Its owner reopens it, and the new version's first build ends the same way.
          (yield* GitHubFake).issues.get(issueKey(claimRepository, 7944))!.state = "open";
          const next = admittedBy(yield* advance("tracker_event", 1));
          assert.deepStrictEqual(stageOf(next), [item, "implement"]);
          yield* failFast(next);
          const corrected = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(corrected), [item, "correct"]);
        }),
      ),
    ),
);

const detachedSessionsOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM orchestration_events
      WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
        AND event_type = 'provider-session.detached'
    `;
    return row?.count ?? 0;
  });

it.effect(
  "Lifecycle/settle: a finished stage's thread is settled once its reservation is released; the stage under way is not",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { finished, rework } = yield* reworkAdmitted(7911, "d0007911");
          for (const stage of finished) {
            const released = yield* reservationOf(stage.reservation.reservationId);
            assert.deepStrictEqual(
              [released?.state, released?.releasedReason],
              ["released", "outcome_verified"],
            );
            const thread = yield* threadOf(admittedExecution(stage).threadId);
            assert.strictEqual(thread.settledOverride, "settled");
            assert.isNotNull(thread.settledAt);
          }
          assert.strictEqual(
            (yield* reservationOf(rework.reservation.reservationId))?.state,
            "held",
          );
          const live = yield* threadOf(admittedExecution(rework).threadId);
          assert.deepStrictEqual([live.settledOverride, live.settledAt], [null, null]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/settle: a later pass settles a stage thread no further: one settled event under its command id",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { finished } = yield* reworkAdmitted(7912, "d0007912");
          const settledAt: Array<number | null> = [];
          for (const stage of finished) {
            settledAt.push(yield* settledAtOf(admittedExecution(stage).threadId));
          }
          yield* TestClock.adjust("1 minute");
          assert.deepStrictEqual(yield* advance("clock", 2), []);
          for (const [index, stage] of finished.entries()) {
            assert.strictEqual(
              yield* settledAtOf(admittedExecution(stage).threadId),
              settledAt[index],
            );
            assert.strictEqual(yield* stageSettledEvents(stage.reservation.reservationId), 1);
          }
        }),
      ),
    ),
);

it.effect("Lifecycle/settle: a person's un-settle of a stage thread wins across later passes", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { finished } = yield* reworkAdmitted(7913, "d0007913");
        const implement = finished[0]!;
        const threadId = admittedExecution(implement).threadId;
        assert.strictEqual((yield* threadOf(threadId)).settledOverride, "settled");
        yield* (yield* Orchestrator.OrchestratorV2).dispatch({
          type: "thread.unsettle",
          commandId: CommandId.make("command:unsettle:7913"),
          threadId,
          reason: "user",
        });
        yield* TestClock.adjust("1 minute");
        assert.deepStrictEqual(yield* advance("clock", 2), []);
        const thread = yield* threadOf(threadId);
        assert.deepStrictEqual([thread.settledOverride, thread.settledAt], ["active", null]);
        assert.strictEqual(yield* stageSettledEvents(implement.reservation.reservationId), 1);
      }),
    ),
  ),
);

it.effect(
  "Lifecycle/settle: a background execution with a verified outcome stays held and unsettled, its session attached",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, reservationId } = yield* backgroundExecution(7914);
        const reported = yield* reportFrom(execution.threadId, {
          outcome: "failed",
          failure: "The focused tests are still running.",
          summary: "No result yet.",
        });
        assert.strictEqual(reported.state, "reported");
        // One pass writes the report's tracker record; the next reads it back and verifies.
        for (let pass = 0; pass < 2; pass++) {
          yield* collectIssues([], "outcome");
          yield* runEffects;
        }
        const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
        assert.deepStrictEqual(
          (yield* outcomes.listForOrigin(reservationId)).map((outcome) => outcome.state),
          ["verified"],
        );
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
        assert.strictEqual((yield* threadOf(execution.threadId)).settledOverride, null);
        assert.strictEqual(yield* stageSettledEvents(reservationId), 0);
        assert.strictEqual(yield* detachedSessionsOf(execution.threadId), 0);
      }),
    ),
);

const watchPullRequest = (threadId: ThreadId, watching: boolean) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "thread.pull-request.watch",
      commandId: CommandId.make(`command:watch:${threadId}:${watching}`),
      threadId,
      host: "github.com",
      repository: claimRepository,
      number: 99,
      watching,
      ...(watching
        ? { link: { url: `https://github.com/${claimRepository}/pull/99`, source: "created" } }
        : {}),
    }),
  );

it.effect(
  "Lifecycle/watch: a stage whose worker ended its turn watching its pull request's checks keeps its stage until it reports",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          // The rework worker pushed, opened its PR, watched it for the hosted run
          // and ended its turn without a report, as T3 tells it to while it waits.
          const { rework } = yield* reworkAdmitted(7915, "d0007915");
          const execution = yield* startStage(rework);
          yield* watchPullRequest(execution.threadId, true);
          yield* completeLatestRun(execution.threadId);
          yield* advance("outcome");
          const { reservationId } = rework.reservation;
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          assert.deepStrictEqual(yield* outcomes.listForOrigin(reservationId), []);
          assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
          const waiting = yield* threadOf(execution.threadId);
          assert.deepStrictEqual([waiting.settledOverride, waiting.settledAt], [null, null]);
          assert.isDefined(waiting.pullRequests?.[0]?.watch);
          // The checks finish: the woken worker stops watching and reports, and the stage moves on.
          yield* watchPullRequest(execution.threadId, false);
          yield* recordCommit("d0017915", ["d0007915"]);
          const reported = yield* reportFrom(execution.threadId, {
            outcome: "implemented",
            subject: subjectFor("d0017915", lifecycleBase),
            summary: "The hosted run passed on the unchanged head.",
          });
          assert.strictEqual(reported.state, "reported");
          const review = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(review), [`github:${claimRepository}#7915`, "review"]);
          const released = yield* reservationOf(reservationId);
          assert.deepStrictEqual(
            [released?.state, released?.releasedReason],
            ["released", "outcome_verified"],
          );
          assert.strictEqual((yield* threadOf(execution.threadId)).settledOverride, "settled");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/watch: a stage that ended with no report and no watch is still recorded as missing its result",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { rework } = yield* reworkAdmitted(7916, "d0007916");
          const execution = yield* startStage(rework);
          yield* watchPullRequest(execution.threadId, true);
          yield* watchPullRequest(execution.threadId, false);
          yield* completeLatestRun(execution.threadId);
          yield* advance("outcome");
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [missing] = yield* outcomes.listForOrigin(rework.reservation.reservationId);
          assert.strictEqual(missing?.report.outcome, "failed");
          assert.strictEqual(missing?.report.summary, "No result was reported.");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/report: a report binds to the run that executed it, not to a queued follow-up the user took back",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7921);
          const item = `github:${claimRepository}#7921`;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const execution = yield* startStage(implement);
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          // The user queues a follow-up behind the running turn, then takes it back.
          yield* queueUserMessage(execution.threadId, "follow-up-7921");
          const queued = (yield* orchestrator.getThreadProjection(execution.threadId)).runs.find(
            (candidate) => candidate.status === "queued",
          )!;
          yield* orchestrator.dispatch({
            type: "queued-run.cancel",
            commandId: CommandId.make("command:cancel-queued:7921"),
            threadId: execution.threadId,
            runId: queued.id,
          });
          const first = (yield* orchestrator.getThreadProjection(execution.threadId)).runs.find(
            (candidate) => candidate.id === execution.runId,
          )!;
          assert.strictEqual(first.status, "running");
          yield* recordCommit("d0007921", [lifecycleBase]);
          const reported = yield* reportFrom(execution.threadId, {
            outcome: "implemented",
            subject: subjectFor("d0007921", lifecycleBase),
            summary: "Implemented.",
          });
          assert.strictEqual(reported.state, "reported");
          yield* completeLatestRun(execution.threadId, "completed", execution.runId);
          const review = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(review), [item, "review"]);
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [outcome] = yield* outcomes.listForOrigin(implement.reservation.reservationId);
          assert.strictEqual(outcome?.state, "verified");
          assert.deepStrictEqual(
            outcome?.origin.type === "execution"
              ? [outcome.origin.runId, outcome.origin.attemptId ?? null]
              : outcome?.origin.type,
            [first.id, first.activeAttemptId],
          );
          const released = yield* reservationOf(implement.reservation.reservationId);
          assert.deepStrictEqual(
            [released?.state, released?.releasedReason],
            ["released", "outcome_verified"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N03: generated records leave a live attempt's basis alone; a person's change is recorded",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeWithOwnerGate);
          yield* seedIssue(7951);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const execution = yield* startStage(implement);
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const basisChanges = Effect.map(
            outcomes.itemRecords({ factoryId, itemKey: itemKeyFor(7951) }),
            (records) => records.filter(({ record }) => record.type === "basis_changed").length,
          );
          // Status and escalation records T3 itself writes are bookkeeping, however many passes.
          const fake = yield* GitHubFake;
          const issue = fake.issues.get(issueKey(claimRepository, 7951))!;
          yield* advance("clock", 3);
          assert.strictEqual(yield* basisChanges, 0);
          // The factory's account posting something T3 never wrote is not bookkeeping.
          issue.comments.push({
            id: fake.nextCommentId++,
            body: "Keep waiting; scope unchanged.",
            user: factoryAccount,
            created_at: "2026-10-24T00:00:00Z",
          });
          yield* advance("clock", 2);
          assert.strictEqual(yield* basisChanges, 1);
          // The owner changes the scope while the attempt is live: recorded once, explicitly.
          issue.comments.push({
            id: fake.nextCommentId++,
            body: "Owner: also export the parsed dates.",
            user: { id: 42, login: "owner" },
            created_at: "2026-10-24T00:00:01Z",
          });
          yield* advance("clock", 2);
          assert.strictEqual(yield* basisChanges, 2);
          assert.strictEqual(yield* dispositionOf(7951), "in_progress");
          // Its result, landing later, is consumed exactly once, and the review is decided on the
          // item as it now reads.
          yield* recordCommit("a0000951", [lifecycleBase]);
          yield* reportFrom(execution.threadId, {
            outcome: "implemented",
            subject: subjectFor("a0000951", lifecycleBase),
            summary: "Implemented.",
          });
          yield* completeLatestRun(execution.threadId);
          const review = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(review), [`github:${claimRepository}#7951`, "review"]);
          assert.deepStrictEqual(yield* itemHistory(7951), ["implement", "implemented", "review"]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N34: an escalation that fresh evidence overtakes is superseded, never repeated or held",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          // A legacy failure cap, translated: after two failed attempts the owner decides, unless
          // the owner has since said how to go on. Its wording changes on every pass.
          let passes = 0;
          yield* usePolicy((input) => {
            const failures = input.outcomes.filter(
              (outcome) => outcome.report.outcome === "failed",
            );
            const guided = input.issue.comments.some((comment) => comment.authorId === "42");
            if (input.stage.type !== "correct" || failures.length < 2 || guided) {
              return stageRequest(input);
            }
            passes += 1;
            return Effect.succeed({
              type: "reserve",
              reason: `Failed ${failures.length} times (pass ${passes}); the owner decides whether to go on.`,
              evidenceDigest: sha256(failures.map((outcome) => outcome.outcomeId).join("\n")),
            });
          });
          yield* seedIssue(7301);
          const item = `github:${claimRepository}#7301`;
          const failed = (failure: string): FactoryReportInput => ({
            outcome: "failed",
            failure,
            summary: "Verify failed.",
          });
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(implement, failed("test_a FAILED"));
          const correct = admittedBy(yield* advance("outcome"));
          yield* workStage(correct, { outcome: "correction_spec", summary: "Fix test_a." });
          const rework = admittedBy(yield* advance("outcome"));
          yield* workStage(rework, failed("test_b FAILED"));

          // Escalated once: one pending decision and one tracker record, however many passes ask.
          assert.deepStrictEqual(yield* advance("outcome"), []);
          for (const trigger of ["clock", "restart", "clock"] as const) {
            assert.deepStrictEqual(yield* advance(trigger, 1), []);
          }
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const decisionStates = Effect.map(factory.readState({ factoryId }), (state) =>
            state.reservedDecisions.map((decision) => decision.state),
          );
          assert.deepStrictEqual(yield* decisionStates, ["pending"]);
          assert.strictEqual((yield* commentsWith(7301, "t3-factory-decision")).length, 1);
          assert.strictEqual(yield* dispositionOf(7301), "reserved_decision");

          // The owner says how to go on, on the issue. The next pass decides on that, and the
          // escalation it overtook no longer waits for anyone; nothing new is escalated.
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7301))!.comments.push({
            id: fake.nextCommentId++,
            body: "Owner: use the vendored date parser.",
            user: { id: 42, login: "owner" },
            created_at: "2026-10-24T00:00:02Z",
          });
          const guided = admittedBy(yield* advance("tracker_event"));
          assert.deepStrictEqual(stageOf(guided), [item, "correct"]);
          assert.deepStrictEqual(yield* decisionStates, ["superseded"]);
          assert.strictEqual((yield* commentsWith(7301, "t3-factory-decision")).length, 1);
        }),
      ),
    ),
);

const legacyJob = "alpha_supervised";
const legacyTask = ScheduledTaskId.make(
  "scheduled-task:command:mcp:45f4b96b:schedule-task:alpha-native-supervised-probe",
);

/** One worker exactly as the legacy job's receipts and T3's projection describe it. */
const legacyWorker = (
  workId: string,
  overrides: Partial<CommandJobs.CommandJobDescription["workers"][number]> = {},
): CommandJobs.CommandJobDescription["workers"][number] => ({
  workId,
  taskId: legacyTask,
  threadId: ThreadId.make(`thread:project:alpha:${workId}`),
  title: workId,
  branch: `factory/alpha-${workId}`,
  model: "builder_high",
  recordedAt: "2026-10-24T10:00:00.000Z",
  promptSha256: sha256(workId),
  resolvedBaseCommit: lifecycleBase,
  recoveryError: null,
  state: "idle",
  terminal: true,
  runs: [{ id: `run:thread:project:alpha:${workId}:ordinal:1`, status: "completed" }],
  ...overrides,
});

const useLegacyJob = (
  workers: ReadonlyArray<CommandJobs.CommandJobDescription["workers"][number]>,
  running = false,
) =>
  Effect.map(CommandJobsFake, (fake) => {
    fake.description = {
      job: legacyJob,
      projectId,
      receiptsSha256: sha256(JSON.stringify(workers.map((worker) => worker.workId))),
      lastPass: { runId: "synthetic-pass-1", status: "succeeded" },
      workers,
    };
    fake.running = running;
    return fake;
  });

const transferHolder = (transferId: string) => `factory:${factoryId}:transfer:${transferId}`;

const reservationsOf = (issueNumber: number, origin: "transferred" | "observed") =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    return state.reservations.filter(
      (reservation) =>
        reservation.origin === origin && reservation.itemKey === itemKeyFor(issueNumber),
    );
  });

it.effect(
  "Lifecycle/N24: a transfer fences the legacy job, keeps its identities and holds custody until the owner disposes of it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          const legacyInputs: Array<NonNullable<FactoryLifecycle.FactoryPolicyItem["legacy"]>> = [];
          yield* usePolicy((input) => {
            if (input.legacy !== undefined) legacyInputs.push(input.legacy);
            return stageRequest(input);
          });
          // The legacy writer relabelled one issue and claims all three; it keeps the third.
          yield* seedIssue(7981, { labels: ["in-progress", "claimed"] });
          yield* seedIssue(7982, { labels: ["ready", "claimed"] });
          yield* seedIssue(7983, { labels: ["ready", "claimed"] });
          const ended = legacyWorker("issue-7981-implement-1");
          const live = legacyWorker("issue-7982-implement-1", {
            state: "running",
            terminal: false,
            runs: [
              {
                id: "run:thread:project:alpha:issue-7982-implement-1:ordinal:1",
                status: "running",
              },
            ],
          });
          const jobs = yield* useLegacyJob(
            [ended, live, legacyWorker("issue-7983-implement-1")],
            true,
          );
          assert.deepStrictEqual(yield* advance("restart", 1), []);
          assert.strictEqual(yield* dispositionOf(7982), "not_eligible");

          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const fence = yield* CommandJobFence.CommandJobFence;
          const request: FactoryTransferInput = {
            factoryId,
            transferId: "transfer-alpha-1",
            job: legacyJob,
            by: "owner",
            items: [
              { itemKey: itemKeyFor(7981), workIds: [ended.workId] },
              {
                itemKey: itemKeyFor(7982),
                workIds: [live.workId],
                uncertain: ["pass synthetic-pass-1: a label write was not read back"],
              },
            ],
          };
          // The job's writer is fenced at once, but its last pass may still be writing: nothing
          // is adopted, and the items stay the job's.
          assert.strictEqual((yield* factory.transferLegacy(request)).type, "draining");
          assert.deepStrictEqual(yield* fence.current(legacyJob), {
            job: legacyJob,
            generation: 1,
            holders: [transferHolder("transfer-alpha-1")],
          });
          assert.deepStrictEqual(yield* advance("clock", 1), []);
          assert.strictEqual(yield* dispositionOf(7982), "legacy_owned");

          jobs.running = false;
          const adopted = yield* factory.transferLegacy(request);
          if (adopted.type !== "adopted") return assert.fail(JSON.stringify(adopted));
          // Every original identity is kept as the job recorded it.
          const record = adopted.transfer.adopted!;
          assert.deepStrictEqual(
            record.items.map((item) => [
              item.itemKey,
              item.workers.map((worker) => [
                worker.workId,
                worker.taskId,
                worker.threadId,
                worker.runs.map((run) => run.id),
                worker.promptSha256,
              ]),
            ]),
            [
              [
                itemKeyFor(7981),
                [
                  [
                    ended.workId,
                    legacyTask,
                    ended.threadId,
                    [ended.runs[0]!.id],
                    ended.promptSha256,
                  ],
                ],
              ],
              [
                itemKeyFor(7982),
                [[live.workId, legacyTask, live.threadId, [live.runs[0]!.id], live.promptSha256]],
              ],
            ],
          );
          assert.deepStrictEqual(
            [record.receiptsSha256, record.lastPass, record.fenceGeneration],
            [jobs.description.receiptsSha256, jobs.description.lastPass, 1],
          );
          assert.deepStrictEqual(adopted.transfer.items[1]!.uncertain, request.items[1]!.uncertain);
          assert.strictEqual((yield* factory.transferLegacy(request)).type, "adopted");

          // A clean last pass and an ended worker prove nothing: both items stay held and charged,
          // and the item the job kept is still its claim.
          assert.deepStrictEqual(yield* advance("owner_decision", 2), []);
          assert.strictEqual(yield* dispositionOf(7981), "legacy_custody");
          assert.strictEqual(yield* dispositionOf(7982), "legacy_custody");
          assert.strictEqual(yield* dispositionOf(7983), "not_eligible");
          const [held7981] = yield* reservationsOf(7981, "transferred");
          assert.deepStrictEqual(
            [held7981?.state, held7981?.custody.reasons],
            ["held", ["legacy_custody_unproven"]],
          );

          // The owner checks 7981's legacy work themselves and disposes of its custody and its
          // legacy claim; only then is it decided natively, with its legacy work in view.
          assert.isTrue(
            yield* factory.disposeObservedClaim({
              factoryId,
              reservationId: held7981!.reservationId,
              by: "owner",
              reason: "legacy worker and its helper checked: nothing running, nothing unwritten",
            }),
          );
          assert.deepStrictEqual(yield* advance("owner_decision", 1), []);
          const claim7981 = (yield* reservationsOf(7981, "observed")).find(
            (reservation) => reservation.state === "held",
          );
          assert.isTrue(
            yield* factory.disposeObservedClaim({
              factoryId,
              reservationId: claim7981!.reservationId,
              by: "owner",
              reason: "the legacy claim label is the transferred job's",
            }),
          );
          // 7982's legacy worker may still write, and T3 cannot tell what: nothing new starts.
          assert.deepStrictEqual(yield* advance("owner_decision", 1), []);
          assert.strictEqual(yield* dispositionOf(7981), "legacy_unscoped");
          const [held7982] = yield* reservationsOf(7982, "transferred");
          assert.isTrue(
            yield* factory.disposeObservedClaim({
              factoryId,
              reservationId: held7982!.reservationId,
              by: "owner",
              reason: "legacy worker checked: it writes only 7982's branch",
            }),
          );
          const native = admittedBy(yield* advance("owner_decision", 1));
          assert.deepStrictEqual(stageOf(native), [itemKeyFor(7981), "implement"]);
          assert.deepStrictEqual(legacyInputs.at(-1), {
            transferId: "transfer-alpha-1",
            job: legacyJob,
            workers: record.items[0]!.workers,
          });
          assert.strictEqual((yield* fence.current(legacyJob)).holders.length, 1);

          // Native work began on 7981, so the transfer can no longer be rolled back.
          assert.deepStrictEqual(
            yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-alpha-1",
              by: "owner",
              reason: "postponed",
            }),
            {
              type: "refused",
              reason: `native work began on ${itemKeyFor(7981)}; it stays the factory's`,
            },
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N24: rolling a transfer back gives its items and writes back to the job, identities intact",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7991, { labels: ["ready", "claimed"] });
          const worker = legacyWorker("issue-7991-implement-1", {
            state: "unreadable",
            terminal: null,
            runs: [],
          });
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const fence = yield* CommandJobFence.CommandJobFence;
          const request: FactoryTransferInput = {
            factoryId,
            transferId: "transfer-alpha-2",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(7991), workIds: [worker.workId] }],
          };
          const adopted = yield* factory.transferLegacy(request);
          assert.strictEqual(adopted.type, "adopted");
          assert.deepStrictEqual(yield* advance("owner_decision", 1), []);
          assert.strictEqual(yield* dispositionOf(7991), "legacy_custody");

          const rolledBack = yield* factory.rollbackTransfer({
            factoryId,
            transferId: "transfer-alpha-2",
            by: "owner",
            reason: "cutover postponed",
          });
          if (rolledBack.type !== "rolled_back") return assert.fail(JSON.stringify(rolledBack));
          // The job's runner writes again, the held custody is released as rolled back, and the
          // item is the job's: the factory decides nothing for it.
          assert.deepStrictEqual(yield* fence.current(legacyJob), {
            job: legacyJob,
            generation: 2,
            holders: [],
          });
          assert.deepStrictEqual(
            (yield* reservationsOf(7991, "transferred")).map((reservation) => [
              reservation.state,
              reservation.releasedReason,
            ]),
            [["released", "rolled_back"]],
          );
          assert.deepStrictEqual(yield* advance("owner_decision", 1), []);
          assert.strictEqual(yield* dispositionOf(7991), "legacy_owned");
          assert.deepStrictEqual(
            rolledBack.transfer.adopted,
            adopted.type === "adopted" ? adopted.transfer.adopted : undefined,
          );
          assert.strictEqual(rolledBack.transfer.rolledBack?.reason, "cutover postponed");

          // Asking again is the same rollback; a transfer id never names other work.
          assert.strictEqual(
            (yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-alpha-2",
              by: "owner",
              reason: "cutover postponed",
            })).type,
            "rolled_back",
          );
          assert.strictEqual((yield* fence.current(legacyJob)).generation, 2);
          assert.deepStrictEqual(yield* factory.transferLegacy({ ...request, items: [] }), {
            type: "refused",
            reason: "a transfer names the items it takes over",
          });
          assert.deepStrictEqual(
            yield* factory.transferLegacy({
              ...request,
              items: [{ itemKey: itemKeyFor(7992), workIds: [worker.workId] }],
            }),
            { type: "refused", reason: "transfer transfer-alpha-2 names other work" },
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N24: every transferred worker is charged, and nothing it starts escapes the factory",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const store = yield* FactoryStore.FactoryStore;
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          // Three legacy workers on one item, as real threads: two whose custody is unknown and
          // one the owner already accounted for.
          const [live, quiet, historical] = [
            yield* startUnrelatedConversation("legacy-live"),
            yield* startUnrelatedConversation("legacy-quiet"),
            yield* startUnrelatedConversation("legacy-historical"),
          ];
          yield* completeLatestRun(quiet);
          yield* completeLatestRun(historical);
          yield* useLegacyJob([
            legacyWorker("issue-7985-implement-1", {
              threadId: live,
              state: "running",
              terminal: false,
            }),
            legacyWorker("issue-7985-review-1", { threadId: quiet }),
            legacyWorker("issue-7985-implement-0", { threadId: historical }),
          ]);
          yield* seedIssue(7985, { labels: ["ready", "claimed"] });
          const adopted = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-alpha-3",
            job: legacyJob,
            by: "owner",
            items: [
              {
                itemKey: itemKeyFor(7985),
                workIds: [
                  "issue-7985-implement-1",
                  "issue-7985-review-1",
                  "issue-7985-implement-0",
                ],
                historical: [
                  {
                    workId: "issue-7985-implement-0",
                    reason: "superseded attempt, accepted 2026-10-23",
                  },
                ],
              },
            ],
          });
          if (adopted.type !== "adopted") return assert.fail(JSON.stringify(adopted));
          assert.deepStrictEqual(
            adopted.transfer.adopted?.items[0]?.custody.map((held) => [
              held.workId,
              held.threadId,
              held.state,
            ]),
            [
              ["issue-7985-implement-1", live, "held"],
              ["issue-7985-review-1", quiet, "held"],
              ["issue-7985-implement-0", historical, "historical"],
            ],
          );
          // Each worker whose custody is unknown is its own unit; the historical one is not.
          assert.strictEqual(yield* occupied, 2);

          // Nothing a transferred worker sources can start: its own follow-up, a fork of it, a
          // thread it launches, a schedule it created, or anything from the historical worker.
          expectRefusal(
            yield* sendUserMessage(live, "legacy-follow-up").pipe(Effect.flip),
            "legacy_custody",
          );
          yield* orchestrator.dispatch({
            type: "thread.fork",
            createdBy: "user",
            creationSource: "web",
            commandId: CommandId.make("command:fork:legacy-quiet"),
            sourceThreadId: quiet,
            targetThreadId: ThreadId.make("thread:fork:legacy-quiet"),
            sourcePoint: {
              type: "run",
              runId: (yield* orchestrator.getThreadProjection(quiet)).runs.at(-1)!.id,
            },
          });
          expectRefusal(
            yield* sendUserMessage(ThreadId.make("thread:fork:legacy-quiet"), "legacy-fork").pipe(
              Effect.flip,
            ),
            "legacy_custody",
          );
          const launched = ThreadId.make("thread:launched-by-legacy");
          yield* createTopLevelThread(launched, "agent");
          expectRefusal(
            yield* sendUserMessage(launched, "legacy-launch", quiet).pipe(Effect.flip),
            "legacy_custody",
          );
          const schedule = ScheduledTaskId.make("schedule:legacy");
          yield* store.recordScheduleOrigin({ scheduledTaskId: schedule, callerThreadId: quiet });
          const scheduled = ThreadId.make("thread:scheduled:legacy");
          yield* createTopLevelThread(scheduled, "agent");
          expectRefusal(
            yield* orchestrator
              .dispatch({
                type: "message.dispatch",
                createdBy: "agent",
                creationSource: "mcp",
                scheduledTaskId: schedule,
                commandId: CommandId.make("command:scheduled:legacy"),
                threadId: scheduled,
                messageId: MessageId.make("message:scheduled:legacy"),
                text: "Scheduled work",
                attachments: [],
                dispatchMode: { type: "start_immediately" },
              })
              .pipe(Effect.flip),
            "legacy_custody",
          );
          expectRefusal(
            yield* sendUserMessage(historical, "historical-follow-up").pipe(Effect.flip),
            "legacy_custody",
          );
          for (const threadId of [launched, scheduled, ThreadId.make("thread:fork:legacy-quiet")]) {
            assert.strictEqual(yield* runCount(threadId), 0);
          }
          assert.strictEqual(yield* occupied, 2);

          // Unrelated work in the same project carries on.
          const unrelated = yield* startUnrelatedConversation("unrelated-after-transfer");
          yield* completeLatestRun(unrelated);
          yield* sendUserMessage(unrelated, "unrelated-follow-up");
          assert.strictEqual(yield* runCount(unrelated), 2);

          // Rolled back, the legacy writer owns its workers again, starts included.
          assert.strictEqual(
            (yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-alpha-3",
              by: "owner",
              reason: "postponed",
            })).type,
            "rolled_back",
          );
          yield* completeLatestRun(live);
          const before = yield* runCount(quiet);
          yield* sendUserMessage(quiet, "legacy-again");
          assert.strictEqual(yield* runCount(quiet), before + 1);
          assert.strictEqual(yield* occupied, 0);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N24: legacy claims transfer as unknown custody, and a rollback drains with identities kept",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(2) }));
          // Copied legacy state: one ticket a legacy worker still claims, one eligible ticket, and
          // one the project policy excludes.
          yield* seedIssue(7971, { labels: ["ready", "claimed"] });
          yield* seedIssue(7972);
          yield* seedIssue(7973, { labels: ["ready", "excluded"] });
          yield* usePolicy((input) =>
            input.issue.labels.includes("excluded") ? Effect.undefined : stageRequest(input),
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;

          const adopted = admittedBy(yield* advance("restart", 1));
          assert.deepStrictEqual(stageOf(adopted), [`github:${claimRepository}#7972`, "implement"]);
          // The legacy claim is unknown custody: charged, never launched, never relabelled.
          const charged = (yield* factory.readState({ factoryId })).reservations.filter(
            (reservation) => reservation.origin === "observed",
          );
          assert.deepStrictEqual(
            charged.map((reservation) => [reservation.itemKey, reservation.state]),
            [[`github:${claimRepository}#7971`, "held"]],
          );
          assert.strictEqual(yield* dispositionOf(7971), "not_eligible");
          assert.strictEqual(yield* dispositionOf(7973), "nothing_proposed");
          assert.deepStrictEqual(yield* advance("restart", 1), []);
          assert.strictEqual(yield* occupied, 2);

          // Rollback: pausing stops new decisions; the running stage finishes and settles.
          const worker = yield* startStage(adopted);
          yield* configureFactory(lifecycleConfiguration({ pools: pool(2), enabled: false }));
          yield* recordCommit("a0000972", [lifecycleBase]);
          yield* reportFrom(worker.threadId, {
            outcome: "implemented",
            subject: subjectFor("a0000972", lifecycleBase),
            summary: "Implemented.",
          });
          yield* completeLatestRun(worker.threadId);
          const paused = yield* advance("outcome", 3);
          assert.deepStrictEqual(
            paused.filter((admission) => admission.type === "admitted"),
            [],
          );
          assert.strictEqual(yield* dispositionOf(7972), "refused:factory_paused");
          assert.strictEqual(yield* occupied, 1);
          const kept = (yield* factory.readState({ factoryId })).reservations.map(
            (reservation) => reservation.reservationId,
          );

          // Rolling forward continues the same item under its first claim.
          yield* configureFactory(lifecycleConfiguration({ pools: pool(2) }));
          const review = admittedBy(yield* advance("restart", 1));
          assert.deepStrictEqual(stageOf(review), [`github:${claimRepository}#7972`, "review"]);
          const state = yield* factory.readState({ factoryId });
          assert.deepStrictEqual(
            state.reservations
              .map((reservation) => reservation.reservationId)
              .filter((reservationId) => kept.includes(reservationId)),
            kept,
          );
          assert.strictEqual((yield* claimComments(7972)).length, 1);

          // Once its writer is fenced and its work is gone, the owner disposes of the legacy
          // claim; that exact claim stops counting, and the ticket is decided natively.
          assert.isTrue(
            yield* factory.disposeObservedClaim({
              factoryId,
              reservationId: charged[0]!.reservationId,
              by: "owner",
              reason: "legacy builder stopped; no work in flight",
            }),
          );
          const transferred = admittedBy(yield* advance("owner_decision", 1));
          assert.deepStrictEqual(stageOf(transferred), [
            `github:${claimRepository}#7971`,
            "implement",
          ]);
          assert.deepStrictEqual(
            (yield* factory.readState({ factoryId })).reservations
              .filter((reservation) => reservation.origin === "observed")
              .map((reservation) => [reservation.state, reservation.releasedReason]),
            [["released", "owner_disposition"]],
          );
          assert.strictEqual(yield* dispositionOf(7973), "nothing_proposed");
          const { threads } = yield* (yield* ProjectionStore.ProjectionStoreV2).getShellSnapshot();
          assert.isFalse(threads.some((shell) => shell.title.includes("#7973")));
        }),
      ),
    ),
);

// Project readiness: proposed for FactoryLifecycle.test.ts, owned by the integration Builder. Append
// after the Claims tests; it uses that file's claim harness (claimConfig, seedIssue, collectIssues).

it.effect("Claims/readiness: an unlabelled factory collects and claims a policy-ready issue", () =>
  runIsolated(
    Effect.gen(function* () {
      const { eligibilityLabel: _ready, ...policyReadiness } = claimConfig;
      yield* configureFactory({ pools: pool(1), claim: policyReadiness });
      // Only an effort label is present; readiness comes from policy.
      yield* seedIssue(6301, { labels: ["effort:medium"] });
      const admission = yield* proposeIssue(6301);
      assert.strictEqual(admission?.type, "admitted");
      yield* runEffects;
      assert.strictEqual((yield* claimComments(6301)).length, 1);
    }),
  ),
);

it.effect("Claims/readiness: a label-ready factory still refuses an unlabelled issue", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(1);
      yield* seedIssue(6302, { labels: ["effort:medium"] });
      assert.isUndefined(yield* proposeIssue(6302));
      assert.strictEqual(yield* commentPosts, 0);
    }),
  ),
);

it.effect("Claims/S03: an issue another claim holds is work under way in the policy's view", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(2);
      yield* seedIssue(6303, { labels: ["ready", "claimed"] });
      yield* seedIssue(6304);
      const result = yield* collectIssues([6303, 6304]);
      assert.strictEqual(result.type, "collected");
      const policy = yield* PolicyFake;
      assert.deepStrictEqual(
        policy.active.at(-1)?.map((entry) => [entry.itemKey, entry.stage, entry.custody]),
        [[itemKeyFor(6303), "implement", "foreign"]],
      );
      // Only the free issue is claimed; the held one is neither claimed nor started.
      yield* runEffects;
      assert.strictEqual((yield* claimComments(6303)).length, 0);
      assert.strictEqual((yield* claimComments(6304)).length, 1);
    }),
  ),
);

/** An issue whose work writes exactly these files, listed the way project issue bodies do. */
const owning = (...files: ReadonlyArray<string>) => ({
  body: ["## Owned files", ...files.map((file) => `- ${file}`)].join("\n"),
});

const ownedFiles = (issue: { readonly body: string }) =>
  issue.body
    .split("\n")
    .flatMap((line) => (line.startsWith("- ") ? [line.slice(2).replaceAll("`", "")] : []));

/**
 * A project policy that keeps writers apart: an item whose owned files overlap work under way, or
 * work it chose earlier in the same pass, waits; any other item gets an implementation.
 */
const keepWritersApart = Effect.map(PolicyFake, (fake) => {
  fake.decide = ({ configuration, items, active }) => {
    const busy = new Set(active.flatMap((entry) => ownedFiles(entry.issue)));
    return Effect.forEach(items, (item) => {
      const owned = ownedFiles(item.issue);
      const overlaps = owned.some((file) => busy.has(file));
      if (!overlaps) for (const file of owned) busy.add(file);
      return Effect.map(
        overlaps
          ? Effect.succeed<FactoryLifecycle.FactoryPolicyDecision>({
              type: "none",
              reason: "owned files overlap work under way",
            })
          : proposeImplementation({ observation: item.observation, configuration }),
        (decision) => ({ itemKey: item.observation.itemKey, decision }),
      );
    });
  };
});

const admittedItems = (result: FactoryLifecycle.FactoryCollectionResult) =>
  result.type === "collected"
    ? result.admissions.flatMap((admission) =>
        admission.type === "admitted" ? [admission.reservation.itemKey] : [],
      )
    : [];

const activeCustody = Effect.map(PolicyFake, (policy) =>
  (policy.active.at(-1) ?? [])
    .map((entry) => [entry.itemKey, entry.custody] as const)
    .toSorted(([left], [right]) => left.localeCompare(right)),
);

// One pass admits a writer; the next reads only the items that changed since, not the writer's.
it.effect(
  "Claims/S03: a pass keeps new writers clear of work under way on items it did not ask for",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(3);
        yield* keepWritersApart;
        yield* seedIssue(6381, owning("src/service.py", "src/a.py"));
        yield* seedIssue(6382, owning("src/service.py", "src/b.py"));
        yield* seedIssue(6383, owning("src/c.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6381, 6382])), [
          itemKeyFor(6381),
        ]);
        // 6381's claim is written, read back and started while the next pass reads, so 6381's
        // newest observations are later than that pass's own.
        const fake = yield* GitHubFake;
        const services = yield* Effect.context<Effect.Services<typeof runEffects>>();
        fake.beforeIssueRead = Effect.gen(function* () {
          fake.beforeIssueRead = undefined;
          yield* runEffects;
        }).pipe(Effect.orDie, Effect.provide(services));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6382, 6383])), [
          itemKeyFor(6383),
        ]);
        assert.strictEqual((yield* claimComments(6381)).length, 1);
        assert.strictEqual((yield* startedTurns).length, 1);
        assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(6381), "native"]]);
        assert.strictEqual(yield* dispositionOf(6382), "nothing_proposed");
      }),
    ),
);

it.effect("Claims/S03: while work under way cannot be read, a pass decides nothing beside it", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(3);
      yield* keepWritersApart;
      yield* seedIssue(6381, owning("src/service.py"));
      yield* seedIssue(6382, owning("src/service.py"));
      yield* seedIssue(6383, owning("src/c.py"));
      assert.deepStrictEqual(admittedItems(yield* collectIssues([6381])), [itemKeyFor(6381)]);
      yield* runEffects;
      (yield* GitHubFake).failNextIssueRead.add(6381);
      assert.deepStrictEqual(admittedItems(yield* collectIssues([6381, 6382, 6383])), []);
      assert.deepStrictEqual(
        [yield* dispositionOf(6381), yield* dispositionOf(6382), yield* dispositionOf(6383)],
        ["read_failed", "custody_unread", "custody_unread"],
      );
      // Read again, the work under way is in view: only the disjoint item starts beside it.
      assert.deepStrictEqual(admittedItems(yield* collectIssues([6382, 6383])), [itemKeyFor(6383)]);
      assert.strictEqual(yield* dispositionOf(6382), "nothing_proposed");
    }),
  ),
);

it.effect(
  "Lifecycle/custody: legacy custody keeps every start out until disposed of, and others' claims keep overlapping work out of passes that do not read them",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7304, { ...owning("src/service.py"), labels: ["ready", "claimed"] });
          yield* seedIssue(7305, owning("src/api.py"));
          const worker = legacyWorker("issue-7305-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transferred = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-custody-1",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(7305), workIds: [worker.workId] }],
          });
          assert.strictEqual(transferred.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7304, 7305])), []);
          assert.deepStrictEqual(
            [
              (yield* reservationsOf(7304, "observed")).map((reservation) => reservation.state),
              (yield* reservationsOf(7305, "transferred")).map((reservation) => reservation.state),
            ],
            [["held"], ["held"]],
          );
          yield* seedIssue(7382, owning("src/service.py"));
          yield* seedIssue(7386, owning("src/api.py"));
          yield* seedIssue(7383, owning("src/c.py"));
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7382, 7386, 7383])), []);
          assert.strictEqual(yield* dispositionOf(7383), "legacy_unscoped");
          const [held7305] = yield* reservationsOf(7305, "transferred");
          assert.isTrue(
            yield* factory.disposeObservedClaim({
              factoryId,
              reservationId: held7305!.reservationId,
              by: "owner",
              reason: "legacy worker checked: nothing running, nothing unwritten",
            }),
          );
          // 7305 is the factory's now and starts natively; its files are taken again.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7382, 7386, 7383])), [
            itemKeyFor(7305),
            itemKeyFor(7383),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(7382), yield* dispositionOf(7386)],
            ["nothing_proposed", "nothing_proposed"],
          );
          assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(7304), "foreign"]]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: a writer whose stage was verified and released no longer keeps overlapping work out",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(2) }));
          yield* keepWritersApart;
          yield* seedIssue(7381, owning("src/service.py"));
          yield* seedIssue(7382, owning("src/service.py"));
          const first = yield* collectIssues([7381, 7382]);
          assert.deepStrictEqual(admittedItems(first), [itemKeyFor(7381)]);
          if (first.type !== "collected") return assert.fail(first.type);
          yield* recordCommit("e0007381", [lifecycleBase]);
          yield* workStage(admittedBy(first.admissions), {
            outcome: "implemented",
            subject: subjectFor("e0007381", lifecycleBase),
            summary: "Implemented.",
          });
          // Passes over 7381 alone record its outcome on the tracker, verify it and release it.
          for (let round = 0; round < 3; round++) {
            yield* collectIssues([7381]);
            yield* runEffects;
          }
          const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
          assert.deepStrictEqual(
            state.reservations.flatMap((reservation) =>
              reservation.origin === "admitted" && reservation.itemKey === itemKeyFor(7381)
                ? [[reservation.taskKind, reservation.state, reservation.releasedReason]]
                : [],
            ),
            [["implement", "released", "outcome_verified"]],
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7382])), [itemKeyFor(7382)]);
          assert.deepStrictEqual(yield* activeCustody, []);
        }),
      ),
    ),
);

const custodyOn = (issueNumber: number) =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    return state.reservations
      .flatMap((reservation) =>
        reservation.itemKey === itemKeyFor(issueNumber)
          ? [`${reservation.origin}:${reservation.state}`]
          : [],
      )
      .toSorted();
  });

it.effect(
  "Lifecycle/custody: custody taken on an item while a pass reads others holds the pass back until it is read",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7405, owning("src/api.py"));
          yield* seedIssue(7486, owning("src/api.py"));
          yield* seedIssue(7483, owning("src/c.py"));
          const worker = legacyWorker("issue-7405-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const fake = yield* GitHubFake;
          // The owner adopts the legacy job's item after the pass listed custody.
          fake.beforeIssueRead = Effect.gen(function* () {
            fake.beforeIssueRead = undefined;
            const transferred = yield* factory.transferLegacy({
              factoryId,
              transferId: "transfer-mid-pass",
              job: legacyJob,
              by: "owner",
              items: [{ itemKey: itemKeyFor(7405), workIds: [worker.workId] }],
            });
            assert.strictEqual(transferred.type, "adopted");
          }).pipe(Effect.orDie);
          const first = yield* collectIssues([7486, 7483]);
          assert.deepStrictEqual(yield* custodyOn(7405), ["transferred:held"]);
          assert.deepStrictEqual(admittedItems(first), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7486), yield* dispositionOf(7483)],
            ["custody_unread", "custody_unread"],
          );
          fake.failNextIssueRead.add(7405);
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7486, 7483])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7405), yield* dispositionOf(7486), yield* dispositionOf(7483)],
            ["read_failed", "custody_unread", "custody_unread"],
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7486, 7483])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7405), yield* dispositionOf(7486), yield* dispositionOf(7483)],
            ["legacy_custody", "legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

// 6391's claim is written while the next pass reads, just after a foreign claim landed on 6391
// behind that pass's read: the claim charges the foreign one and frees 6391's own unit.
it.effect(
  "Claims/S03: custody that changes hands after a pass read its item holds the pass back",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(3);
        yield* keepWritersApart;
        const contested = yield* seedIssue(6391, owning("src/service.py"));
        yield* seedIssue(6392, owning("src/service.py"));
        yield* seedIssue(6393, owning("src/c.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6391])), [itemKeyFor(6391)]);
        const fake = yield* GitHubFake;
        const services = yield* Effect.context<Effect.Services<typeof runEffects>>();
        fake.afterIssueRead = (issueNumber) =>
          issueNumber !== 6391
            ? Effect.void
            : Effect.gen(function* () {
                fake.afterIssueRead = undefined;
                contested.labels.push("claimed");
                yield* runEffects;
              }).pipe(Effect.orDie, Effect.provide(services));
        const second = yield* collectIssues([6392, 6393]);
        assert.deepStrictEqual(yield* custodyOn(6391), ["admitted:released", "observed:held"]);
        assert.deepStrictEqual(admittedItems(second), []);
        assert.deepStrictEqual(
          [yield* dispositionOf(6392), yield* dispositionOf(6393)],
          ["custody_unread", "custody_unread"],
        );
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6392, 6393])), [
          itemKeyFor(6393),
        ]);
        assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(6391), "foreign"]]);
        assert.strictEqual(yield* dispositionOf(6392), "nothing_proposed");
      }),
    ),
);

// As above, but 6391 changed instead: its claim is never written and nothing ran.
it.effect("Claims/S03: a unit freed while a pass reads holds nothing back", () =>
  runIsolated(
    Effect.gen(function* () {
      yield* configureClaimFactory(3);
      yield* keepWritersApart;
      const rescoped = yield* seedIssue(6391, owning("src/service.py"));
      yield* seedIssue(6392, owning("src/service.py"));
      yield* seedIssue(6393, owning("src/c.py"));
      assert.deepStrictEqual(admittedItems(yield* collectIssues([6391])), [itemKeyFor(6391)]);
      const fake = yield* GitHubFake;
      const services = yield* Effect.context<Effect.Services<typeof runEffects>>();
      fake.afterIssueRead = (issueNumber) =>
        issueNumber !== 6391
          ? Effect.void
          : Effect.gen(function* () {
              fake.afterIssueRead = undefined;
              rescoped.title = "Issue 6391, rescoped";
              yield* runEffects;
            }).pipe(Effect.orDie, Effect.provide(services));
      assert.deepStrictEqual(admittedItems(yield* collectIssues([6392, 6393])), [
        itemKeyFor(6392),
        itemKeyFor(6393),
      ]);
      assert.deepStrictEqual(yield* custodyOn(6391), ["admitted:released"]);
      assert.strictEqual((yield* claimComments(6391)).length, 0);
    }),
  ),
);

it.effect(
  "Claims/S03: a task a running writer delegates while a pass reads holds back only what overlaps it",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(3);
        yield* keepWritersApart;
        yield* seedIssue(6391, owning("src/service.py"));
        yield* seedIssue(6392, owning("src/service.py"));
        yield* seedIssue(6393, owning("src/c.py"));
        const first = yield* collectIssues([6391]);
        if (first.type !== "collected") return assert.fail(first.type);
        const worker = admittedExecution(admittedBy(first.admissions));
        yield* runEffects;
        assert.strictEqual((yield* startedTurns).length, 1);
        const fake = yield* GitHubFake;
        const services = yield* Effect.context<Effect.Services<ReturnType<typeof delegateFrom>>>();
        fake.beforeIssueRead = Effect.gen(function* () {
          fake.beforeIssueRead = undefined;
          yield* delegateFrom(worker.threadId, "mid-pass");
        }).pipe(Effect.orDie, Effect.provide(services));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6392, 6393])), [
          itemKeyFor(6393),
        ]);
        assert.deepStrictEqual(yield* custodyOn(6391), ["admitted:held", "inherited:held"]);
        assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(6391), "native"]]);
      }),
    ),
);

it.effect(
  "Claims/S03: custody taken while the policy decides keeps the pass from acting on its answer",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureFactory({
          pools: pool(3),
          claim: { ...claimConfig, repositories: [claimRepository] },
        });
        yield* keepWritersApart;
        const taken = yield* seedIssue(6396, owning("src/service.py"));
        yield* seedIssue(6397, owning("src/service.py"));
        yield* seedIssue(6398, owning("src/c.py"));
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const policy = yield* PolicyFake;
        const decide = policy.decide!;
        // The owner observes claims while the policy weighs the pass; 6396 was just claimed.
        policy.decide = (input) =>
          Effect.gen(function* () {
            policy.decide = decide;
            taken.labels.push("claimed");
            assert.lengthOf(yield* factory.observeClaims({ factoryId }), 1);
          }).pipe(
            Effect.orDie,
            Effect.andThen(() => decide(input)),
          );
        const first = yield* collectIssues([6397, 6398]);
        assert.deepStrictEqual(yield* custodyOn(6396), ["observed:held"]);
        assert.deepStrictEqual(admittedItems(first), []);
        assert.deepStrictEqual(
          [yield* dispositionOf(6397), yield* dispositionOf(6398)],
          ["custody_unread", "custody_unread"],
        );
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6397, 6398])), [
          itemKeyFor(6398),
        ]);
        assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(6396), "foreign"]]);
      }),
    ),
);

// A claim label gone or an issue closed ends no work: its custody holds until the owner disposes
// of it.
it.effect.each(["its claim label is removed", "its issue is closed"] as const)(
  "Claims/S03: observed custody keeps overlapping work out after %s",
  (change) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(3);
        yield* keepWritersApart;
        const claimed = yield* seedIssue(6481, {
          ...owning("src/service.py"),
          labels: ["claimed"],
        });
        yield* seedIssue(6482, owning("src/service.py"));
        yield* seedIssue(6483, owning("src/c.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6481])), []);
        const [observed] = yield* reservationsOf(6481, "observed");
        if (observed === undefined) return assert.fail("6481's claim was not charged");
        if (change === "its claim label is removed") claimed.labels = [];
        else claimed.state = "closed";
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6482, 6483])), [
          itemKeyFor(6483),
        ]);
        assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(6481), "foreign"]]);
        assert.deepStrictEqual(yield* custodyOn(6481), ["observed:held"]);
        assert.strictEqual(yield* dispositionOf(6482), "nothing_proposed");
        assert.isTrue(
          yield* (yield* FactoryLifecycle.FactoryLifecycle).disposeObservedClaim({
            factoryId,
            reservationId: observed.reservationId,
            by: "owner",
            reason: "the claimed work ended",
          }),
        );
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6482])), [itemKeyFor(6482)]);
      }),
    ),
);

// Another reader records 6461 as it is while this pass reads it, and the pass is answered with an
// older version, as a slow tracker answer can be: one listing other files than its work writes.
it.effect.each(["superseded", "conflicting"] as const)(
  "Claims/S03: a %s read of work under way holds the pass back until it is read as it is",
  (relation) =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(3);
        yield* keepWritersApart;
        const writer = yield* seedIssue(6461, owning("src/service.py"));
        yield* seedIssue(6462, owning("src/service.py"));
        yield* seedIssue(6463, owning("src/c.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6461])), [itemKeyFor(6461)]);
        const current = { ...writer, comments: [...writer.comments] };
        writer.body = owning("src/old.py").body;
        const fake = yield* GitHubFake;
        const sql = yield* SqlClient.SqlClient;
        const thisPass = Effect.map(
          sql<{ readonly last_generation: number }>`
              SELECT last_generation FROM factory_read_generations WHERE factory_id = ${factoryId}
            `,
          ([row]) => FactoryReadGeneration.make(row!.last_generation),
        );
        const services =
          yield* Effect.context<Effect.Services<ReturnType<typeof recordLaterRead>>>();
        fake.beforeIssueRead = Effect.gen(function* () {
          fake.beforeIssueRead = undefined;
          yield* recordLaterRead(
            6461,
            current,
            relation === "superseded" ? undefined : yield* thisPass,
          );
        }).pipe(Effect.orDie, Effect.provide(services));
        fake.afterIssueRead = (issueNumber) =>
          issueNumber !== 6461
            ? Effect.void
            : Effect.sync(() => {
                fake.afterIssueRead = undefined;
                writer.body = current.body;
              });
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6462, 6463])), []);
        assert.deepStrictEqual(
          [yield* dispositionOf(6462), yield* dispositionOf(6463)],
          ["custody_unread", "custody_unread"],
        );
        // Read as it is, the work under way keeps the overlap out.
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6462, 6463])), [
          itemKeyFor(6463),
        ]);
        assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(6461), "native"]]);
        assert.strictEqual(yield* dispositionOf(6462), "nothing_proposed");
      }),
    ),
);

it.effect(
  "Lifecycle/custody: a draining transfer keeps every start out, adopted too, until the owner disposes of its custody",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7505, owning("src/api.py"));
          yield* seedIssue(7586, owning("src/api.py"));
          yield* seedIssue(7583, owning("src/c.py"));
          // The job's last pass still runs, so its writer may still write 7505.
          const worker = legacyWorker("issue-7505-implement-1");
          const jobs = yield* useLegacyJob([worker], true);
          const transferred = yield* (yield* FactoryLifecycle.FactoryLifecycle).transferLegacy({
            factoryId,
            transferId: "transfer-draining",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(7505), workIds: [worker.workId] }],
          });
          assert.strictEqual(transferred.type, "draining");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7586, 7583])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7586), yield* dispositionOf(7583)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
          // Its last pass ends and the owner finishes the transfer: the custody is held, not proved.
          jobs.running = false;
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const adopted = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-draining",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(7505), workIds: [worker.workId] }],
          });
          assert.strictEqual(adopted.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7586, 7583])), []);
          assert.strictEqual(yield* dispositionOf(7583), "legacy_unscoped");
          const [held7505] = yield* reservationsOf(7505, "transferred");
          assert.isTrue(
            yield* factory.disposeObservedClaim({
              factoryId,
              reservationId: held7505!.reservationId,
              by: "owner",
              reason: "legacy worker checked: nothing running, nothing unwritten",
            }),
          );
          // 7505 is the factory's now and starts natively; its files are taken again.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7586, 7583])), [
            itemKeyFor(7505),
            itemKeyFor(7583),
          ]);
          assert.strictEqual(yield* dispositionOf(7586), "nothing_proposed");
        }),
      ),
    ),
);

// Disjoint parallelism beside legacy work (#25): the owner attests what a legacy writer may write.
const scopedTransfer = (
  transferId: string,
  workId: string,
  scope?: { readonly body: string; readonly reason: string },
) => ({
  factoryId,
  transferId,
  job: legacyJob,
  by: "owner",
  items: [
    {
      itemKey: itemKeyFor(7605),
      workIds: [workId],
      ...(scope === undefined ? {} : { scope }),
    },
  ],
});

/** A scope body as policies read owned files: a `## Owned files` section of backticked paths. */
const attested = (...files: ReadonlyArray<string>) => ({
  body: ["## Owned files", ...files.map((file) => `- \`${file}\``)].join("\n"),
  reason: `legacy worker writes only ${files.join(", ")}`,
});

const apiOnly = attested("src/api.py");

it.effect(
  "Lifecycle/custody: legacy work the owner scoped keeps out only the starts it overlaps",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          const jobs = yield* useLegacyJob([worker], true);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const draining = yield* factory.transferLegacy(
            scopedTransfer("transfer-scoped", worker.workId, apiOnly),
          );
          assert.strictEqual(draining.type, "draining");
          // The pass reads the scoped item although it asked only for the others.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(7605), yield* dispositionOf(7686)],
            ["legacy_owned", "nothing_proposed"],
          );
          assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(7605), "legacy"]]);
          // Adopted, its custody held, the attested scope still weighs it.
          jobs.running = false;
          const adopted = yield* factory.transferLegacy(
            scopedTransfer("transfer-scoped", worker.workId),
          );
          assert.strictEqual(adopted.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7605), yield* dispositionOf(7686)],
            ["legacy_custody", "nothing_proposed"],
          );
          assert.deepStrictEqual(yield* activeCustody, [
            [itemKeyFor(7605), "legacy"],
            [itemKeyFor(7683), "native"],
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: a scope the owner adds later lifts the hold, and is never replaced",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const adopted = yield* factory.transferLegacy(
            scopedTransfer("transfer-later", worker.workId),
          );
          assert.strictEqual(adopted.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7683)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
          const scoped = yield* factory.transferLegacy(
            scopedTransfer("transfer-later", worker.workId, apiOnly),
          );
          assert.strictEqual(scoped.type, "adopted");
          const widened = yield* factory.transferLegacy(
            scopedTransfer("transfer-later", worker.workId, attested("src/c.py")),
          );
          assert.deepStrictEqual(widened, {
            type: "refused",
            reason: `${itemKeyFor(7605)} already has another attested scope`,
          });
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.strictEqual(yield* dispositionOf(7686), "nothing_proposed");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: a rolled-back scoped worker still writing keeps its own files, and an unscoped transfer of the item holds every start",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1", { terminal: false });
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-back", worker.workId, apiOnly)))
              .type,
            "adopted",
          );
          const rolledBack = yield* factory.rollbackTransfer({
            factoryId,
            transferId: "transfer-back",
            by: "owner",
            reason: "cutover postponed",
          });
          assert.strictEqual(rolledBack.type, "rolled_back");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(7605), yield* dispositionOf(7686)],
            ["legacy_owned", "nothing_proposed"],
          );
          // Taken over again without a scope: what the legacy work writes is unknown once more.
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-again", worker.workId))).type,
            "adopted",
          );
          yield* seedIssue(7684, owning("src/d.py"));
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7684])), []);
          assert.strictEqual(yield* dispositionOf(7684), "legacy_unscoped");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: a scope that names no owned file is refused, and the legacy work still holds every start",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          // A policy reading owned files from this body sees none, so it would keep nothing out.
          const vague = {
            body: "Legacy work on the API module.",
            reason: "it only touches the API",
          };
          assert.deepStrictEqual(
            yield* factory.transferLegacy(scopedTransfer("transfer-vague", worker.workId, vague)),
            {
              type: "refused",
              reason: `${itemKeyFor(7605)}'s scope does not list each owned file under ## Owned files`,
            },
          );
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-vague", worker.workId))).type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7683)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: only transfers whose legacy work may still write weigh an item's scope",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const first = legacyWorker("issue-7605-implement-1");
          const second = legacyWorker("issue-7605-implement-2");
          const jobs = yield* useLegacyJob([first, second]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-old", first.workId, apiOnly)))
              .type,
            "adopted",
          );
          assert.strictEqual(
            (yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-old",
              by: "owner",
              reason: "cutover postponed",
            })).type,
            "rolled_back",
          );
          // The old transfer's worker finished; only the new transfer's worker may still write.
          const wider = attested("src/api.py", "src/api_v2.py");
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-new", second.workId, wider)))
              .type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.strictEqual(yield* dispositionOf(7686), "nothing_proposed");
          // The old worker turns out unfinished: two writers under different scopes hold every start.
          jobs.description = {
            ...jobs.description!,
            workers: [{ ...first, terminal: false }, second],
          };
          yield* seedIssue(7684, owning("src/d.py"));
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7684])), []);
          assert.strictEqual(yield* dispositionOf(7684), "legacy_unscoped");
        }),
      ),
    ),
);

// HSA's Python policy ends lines only at `\n`: under these separators it finds no owned files.
it.effect.each([
  ["a carriage return", "\r"],
  ["a line separator", "\u2028"],
  ["a paragraph separator", "\u2029"],
] as const)("Lifecycle/custody: a scope whose lines end with %s is refused", ([, separator]) =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
        yield* keepWritersApart;
        yield* seedIssue(7605, owning("src/api.py"));
        yield* seedIssue(7686, owning("src/api.py"));
        const worker = legacyWorker("issue-7605-implement-1");
        yield* useLegacyJob([worker]);
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const scope = { ...apiOnly, body: apiOnly.body.replaceAll("\n", separator) };
        assert.deepStrictEqual(
          yield* factory.transferLegacy(scopedTransfer("transfer-lines", worker.workId, scope)),
          {
            type: "refused",
            reason: `${itemKeyFor(7605)}'s scope does not list each owned file under ## Owned files`,
          },
        );
        assert.strictEqual(
          (yield* factory.transferLegacy(scopedTransfer("transfer-lines", worker.workId))).type,
          "adopted",
        );
        assert.deepStrictEqual(admittedItems(yield* collectIssues([7686])), []);
        assert.strictEqual(yield* dispositionOf(7686), "legacy_unscoped");
      }),
    ),
  ),
);

// HSA's Python policy reads only the backticked entries its file pattern takes whole, from the
// first `## Owned files` section alone; it skips anything else there without a word.
const partlyListed = [
  ["a path with a space", ["## Owned files", "- `src/api.py`", "- `src/my file.py`"]],
  ["an unquoted path", ["## Owned files", "- `src/api.py`", "- src/my_file.py"]],
  [
    "a second section",
    ["## Owned files", "- `src/api.py`", "## Owned files", "- `src/my_file.py`"],
  ],
] as const;

it.effect.each(partlyListed)(
  "Lifecycle/custody: a scope listing %s beside a valid path is refused",
  ([, lines]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const scope = { body: lines.join("\n"), reason: "legacy worker writes only these" };
          assert.deepStrictEqual(
            yield* factory.transferLegacy(scopedTransfer("transfer-part", worker.workId, scope)),
            {
              type: "refused",
              reason: `${itemKeyFor(7605)}'s scope does not list each owned file under ## Owned files`,
            },
          );
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-part", worker.workId))).type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7683])), []);
          assert.strictEqual(yield* dispositionOf(7683), "legacy_unscoped");
        }),
      ),
    ),
);

/** What HSA's policy finds a body owns, by its section and file patterns. */
const hsaOwnedFiles = (issue: { readonly body: string }) => {
  const [, section = ""] =
    /^## Owned files\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(issue.body) ?? [];
  return [...section.matchAll(/`([\w./-]+(?:\/[\w.-]+|\.\w+))`/g)].map((match) => match[1]!);
};

/** A project policy that weighs work under way only by what HSA's parser finds in its body. */
const keepClearAsHsaReads = Effect.map(PolicyFake, (fake) => {
  fake.decide = ({ configuration, items, active }) => {
    const busy = new Set(active.flatMap((entry) => hsaOwnedFiles(entry.issue)));
    return Effect.forEach(items, (item) =>
      Effect.map(
        ownedFiles(item.issue).some((file) => busy.has(file))
          ? Effect.succeed<FactoryLifecycle.FactoryPolicyDecision>({
              type: "none",
              reason: "owned files overlap work under way",
            })
          : proposeImplementation({ observation: item.observation, configuration }),
        (decision) => ({ itemKey: item.observation.itemKey, decision }),
      ),
    );
  };
});

it.effect.each(partlyListed)(
  "Lifecycle/custody: a stored scope listing %s holds every start, so no writer of the skipped file starts",
  ([, lines]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepClearAsHsaReads;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/my file.py", "src/my_file.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-stored", worker.workId))).type,
            "adopted",
          );
          // Stored as a build that checked only for one listed file would have kept it.
          const transfers = yield* FactoryTransferStore.FactoryTransferStore;
          const stored = yield* transfers.attestScopes({
            transferId: "transfer-stored",
            scopes: [
              {
                itemKey: itemKeyFor(7605),
                body: lines.join("\n"),
                reason: "legacy worker writes only these",
                by: "owner",
              },
            ],
          });
          assert.strictEqual(stored.type, "attested");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7683)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

it.effect.each([
  ["CRLF lines", "## Owned files\r\n- `src/api.py`\r\n- `src/my_file.py`\r\n"],
  [
    "blank and indented lines before another section",
    "Intro\n## Owned files\n\n  - `src/api.py`\n\t- `src/my_file.py`  \n\n## Notes\n- `src/c.py` is only read\n",
  ],
] as const)(
  "Lifecycle/custody: a scope listing every owned file in %s keeps out only the starts it overlaps",
  ([, body]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepClearAsHsaReads;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/my_file.py"));
          yield* seedIssue(7687, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const scope = { body, reason: "legacy worker writes only these" };
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-full", worker.workId, scope)))
              .type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7687, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7687)],
            ["nothing_proposed", "nothing_proposed"],
          );
        }),
      ),
    ),
);

/** What BTC's policy finds a body writes: its first Builder unit marker's paths, else unknown. */
const btcWrites = (issue: { readonly body: string }) =>
  /<!-- btc-unit:builder(?: writes=([^ ]+))?(?: resources=([a-z;-]+))? -->/
    .exec(issue.body)?.[1]
    ?.split(";")
    .filter((path) => path !== "");

/** A project policy that weighs work under way only by BTC's marker, and unknown work as all. */
const keepClearAsBtcReads = Effect.map(PolicyFake, (fake) => {
  fake.decide = ({ configuration, items, active }) => {
    const lanes = active.map((entry) => btcWrites(entry.issue));
    return Effect.forEach(items, (item) =>
      Effect.map(
        lanes.some(
          (writes) =>
            writes === undefined || ownedFiles(item.issue).some((file) => writes.includes(file)),
        )
          ? Effect.succeed<FactoryLifecycle.FactoryPolicyDecision>({
              type: "none",
              reason: "owned files overlap work under way",
            })
          : proposeImplementation({ observation: item.observation, configuration }),
        (decision) => ({ itemKey: item.observation.itemKey, decision }),
      ),
    );
  };
});

const markedScope = (...markers: ReadonlyArray<string>) =>
  [...markers, "## Owned files", "- `src/api.py`", "- `src/my_file.py`"].join("\n");

// HSA reads both listed files from each body; BTC would weigh only what the marker writes, or
// nothing it can rely on.
const btcMismatched = [
  [
    "writes one listed file",
    markedScope("<!-- btc-unit:builder writes=src/api.py resources=none -->"),
  ],
  [
    "writes more than the listed files",
    markedScope(
      "<!-- btc-unit:builder writes=src/api.py;src/my_file.py;src/c.py resources=none -->",
    ),
  ],
  ["has no writes", markedScope("<!-- btc-unit:builder resources=none -->")],
  ["has no resources", markedScope("<!-- btc-unit:builder writes=src/api.py;src/my_file.py -->")],
  [
    "names an unknown resource",
    markedScope("<!-- btc-unit:builder writes=src/api.py;src/my_file.py resources=gpu;disk -->"),
  ],
  [
    "is malformed",
    markedScope("<!-- btc-unit:builder writes=src/api.py;src/my_file.py resources=none-->"),
  ],
  [
    "comes second after a partial one",
    markedScope(
      "<!-- btc-unit:builder writes=src/api.py resources=none -->",
      "<!-- btc-unit:builder writes=src/api.py;src/my_file.py resources=none -->",
    ),
  ],
] as const;

it.effect.each(btcMismatched)(
  "Lifecycle/custody: a scope whose btc-unit marker %s is refused, and the legacy work still holds every start",
  ([, body]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepClearAsBtcReads;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/my_file.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const scope = { body, reason: "legacy worker writes only these" };
          assert.deepStrictEqual(
            yield* factory.transferLegacy(scopedTransfer("transfer-marker", worker.workId, scope)),
            {
              type: "refused",
              reason: `${itemKeyFor(7605)}'s btc-unit marker does not declare exactly its owned files as writes, with resources`,
            },
          );
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-marker", worker.workId))).type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7683)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

it.effect.each(btcMismatched)(
  "Lifecycle/custody: a stored scope whose btc-unit marker %s holds every start, so no writer of a file BTC skips starts",
  ([, body]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepClearAsBtcReads;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/my_file.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-stored", worker.workId))).type,
            "adopted",
          );
          // Stored as a build that checked only the owned-files section would have kept it.
          const transfers = yield* FactoryTransferStore.FactoryTransferStore;
          const stored = yield* transfers.attestScopes({
            transferId: "transfer-stored",
            scopes: [
              {
                itemKey: itemKeyFor(7605),
                body,
                reason: "legacy worker writes only these",
                by: "owner",
              },
            ],
          });
          assert.strictEqual(stored.type, "attested");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7683)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

it.effect.each([
  [
    "BTC reads a marker writing every listed file",
    keepClearAsBtcReads,
    markedScope("<!-- btc-unit:builder writes=src/my_file.py;src/api.py resources=none -->"),
  ],
  [
    "HSA reads a marker writing every listed file",
    keepClearAsHsaReads,
    markedScope("<!-- btc-unit:builder writes=src/my_file.py;src/api.py resources=none -->"),
  ],
  ["HSA reads a scope without a marker", keepClearAsHsaReads, markedScope()],
] as const)(
  "Lifecycle/custody: when %s, the scope keeps out only the starts it overlaps",
  ([, keepClear, body]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepClear;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/my_file.py"));
          yield* seedIssue(7687, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const scope = { body, reason: "legacy worker writes only these" };
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-marked", worker.workId, scope)))
              .type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7687, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7687)],
            ["nothing_proposed", "nothing_proposed"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: a scoped item whose legacy work ended is not read again, however its reads fail",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(
              scopedTransfer("transfer-ended", worker.workId, apiOnly),
            )).type,
            "adopted",
          );
          assert.strictEqual(
            (yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-ended",
              by: "owner",
              reason: "cutover postponed",
            })).type,
            "rolled_back",
          );
          const fake = yield* GitHubFake;
          fake.failNextIssueRead.add(7605);
          const readsOf7605 = () =>
            fake.requests.filter((request) => /\/issues\/7605$/.test(request.path)).length;
          const before = readsOf7605();
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7683])), [itemKeyFor(7683)]);
          assert.strictEqual(readsOf7605() - before, 0);
          assert.isTrue(fake.failNextIssueRead.has(7605));
        }),
      ),
    ),
);

/** What a runtime without scopes leaves of a transfer it rewrites: everything it knows of. */
const rewriteAsOldRuntime = (transferId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_transfers WHERE transfer_id = ${transferId}
    `;
    const { scopes: _dropped, ...known } = JSON.parse(row!.record_json) as Record<string, unknown>;
    yield* sql`
      UPDATE factory_transfers SET record_json = ${JSON.stringify(known)}
      WHERE transfer_id = ${transferId}
    `;
  });

it.effect(
  "Lifecycle/custody: a scope an older runtime dropped holds every start again until the owner attests it once more",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(
              scopedTransfer("transfer-old-run", worker.workId, apiOnly),
            )).type,
            "adopted",
          );
          yield* rewriteAsOldRuntime("transfer-old-run");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7686), yield* dispositionOf(7683)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
          assert.strictEqual(
            (yield* factory.transferLegacy(
              scopedTransfer("transfer-old-run", worker.workId, apiOnly),
            )).type,
            "adopted",
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7686, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.strictEqual(yield* dispositionOf(7686), "nothing_proposed");
        }),
      ),
    ),
);

// The owner hands a legacy job's item over while the policy weighs a pass: adopted at once when
// the job is idle, draining while its last pass runs.
it.effect.each([
  ["adopted", false],
  ["begun", true],
] as const)(
  "Lifecycle/custody: a legacy transfer %s while the policy decides keeps the pass from acting on its answer",
  ([, running]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7601, owning("src/api.py"));
          yield* seedIssue(7602, owning("src/api.py"));
          yield* seedIssue(7603, owning("src/c.py"));
          const worker = legacyWorker("issue-7601-implement-1");
          yield* useLegacyJob([worker], running);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const policy = yield* PolicyFake;
          const decide = policy.decide!;
          policy.decide = (input) =>
            Effect.gen(function* () {
              policy.decide = decide;
              const transferred = yield* factory.transferLegacy({
                factoryId,
                transferId: "transfer-while-deciding",
                job: legacyJob,
                by: "owner",
                items: [{ itemKey: itemKeyFor(7601), workIds: [worker.workId] }],
              });
              assert.strictEqual(transferred.type, running ? "draining" : "adopted");
            }).pipe(
              Effect.orDie,
              Effect.andThen(() => decide(input)),
            );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7602, 7603])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7602), yield* dispositionOf(7603)],
            ["custody_unread", "custody_unread"],
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7602, 7603])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(7602), yield* dispositionOf(7603)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: an item handed back once its worker finished holds nothing back",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
          yield* keepWritersApart;
          yield* seedIssue(7621, owning("src/api.py"));
          yield* seedIssue(7622, owning("src/api.py"));
          yield* seedIssue(7623, owning("src/c.py"));
          const worker = legacyWorker("issue-7621-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transferred = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-rolled-back",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(7621), workIds: [worker.workId] }],
          });
          assert.strictEqual(transferred.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7622, 7623])), []);
          assert.strictEqual(yield* dispositionOf(7622), "legacy_unscoped");
          const rolledBack = yield* factory.rollbackTransfer({
            factoryId,
            transferId: "transfer-rolled-back",
            by: "owner",
            reason: "the job keeps its item",
          });
          assert.strictEqual(rolledBack.type, "rolled_back");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([7622, 7623])), [
            itemKeyFor(7622),
            itemKeyFor(7623),
          ]);
          assert.deepStrictEqual(yield* custodyOn(7621), ["transferred:released"]);
        }),
      ),
    ),
);

it.effect("Lifecycle/custody: custody taken while a pass admits refuses its later admissions", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* configureFactory(lifecycleConfiguration({ pools: pool(6) }));
        yield* keepWritersApart;
        yield* seedIssue(7701, owning("src/api.py"));
        yield* seedIssue(7702, owning("src/c.py"));
        yield* seedIssue(7703, owning("src/api.py"));
        const worker = legacyWorker("issue-7701-implement-1");
        yield* useLegacyJob([worker]);
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const store = yield* FactoryStore.FactoryStore;
        const lookups = yield* AdmissionLookups;
        // The owner adopts 7701's legacy work once the pass has admitted 7702, before it admits 7703.
        lookups.before = Effect.gen(function* () {
          const reservations = yield* store.listReservations(factoryId);
          if (!reservations.some((reservation) => reservation.itemKey === itemKeyFor(7702))) return;
          lookups.before = undefined;
          const transferred = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-while-admitting",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(7701), workIds: [worker.workId] }],
          });
          assert.strictEqual(transferred.type, "adopted");
        }).pipe(Effect.orDie);
        assert.deepStrictEqual(admittedItems(yield* collectIssues([7702, 7703])), [
          itemKeyFor(7702),
        ]);
        assert.deepStrictEqual(
          [yield* dispositionOf(7702), yield* dispositionOf(7703)],
          ["admitted", "refused:custody_changed"],
        );
        assert.deepStrictEqual(yield* custodyOn(7703), []);
        // The next pass knows the adopted writer, and waits for it.
        assert.deepStrictEqual(admittedItems(yield* collectIssues([7703])), []);
        assert.strictEqual(yield* dispositionOf(7703), "legacy_unscoped");
      }),
    ),
  ),
);

const weighedIssue = (issueNumber: number) =>
  Effect.map(
    PolicyFake,
    (policy) =>
      policy.active.at(-1)?.find((entry) => entry.itemKey === itemKeyFor(issueNumber))?.issue.body,
  );

// Review C25R F1: the edit is read and recorded, so nothing about the read itself holds the pass.
it.effect(
  "Claims/S03: an edit to a running writer's issue frees none of the files it was admitted on",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(5);
        yield* keepWritersApart;
        const writer = yield* seedIssue(8801, owning("src/shared.py"));
        yield* seedIssue(8802, owning("src/shared.py"));
        yield* seedIssue(8803, owning("src/disjoint.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8801])), [itemKeyFor(8801)]);
        yield* runEffects;
        writer.body = owning("src/new-scope.py").body;
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8802, 8803])), [
          itemKeyFor(8803),
        ]);
        assert.deepStrictEqual(yield* custodyOn(8801), ["admitted:held"]);
        assert.deepStrictEqual(
          [yield* dispositionOf(8801), yield* dispositionOf(8802)],
          ["in_progress", "nothing_proposed"],
        );
        assert.strictEqual(yield* weighedIssue(8801), owning("src/shared.py").body);
      }),
    ),
);

it.effect(
  "Claims/S03: a running writer whose admitted text T3 never kept holds a pass back once its issue is edited",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(5);
        yield* keepWritersApart;
        const writer = yield* seedIssue(8806, owning("src/shared.py"));
        yield* seedIssue(8807, owning("src/shared.py"));
        yield* seedIssue(8808, owning("src/disjoint.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8806])), [itemKeyFor(8806)]);
        yield* runEffects;
        // As a writer admitted before T3 kept the text it was admitted on.
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          UPDATE factory_item_events SET record_json = json_remove(record_json, '$.issueText')
          WHERE item_key = ${itemKeyFor(8806)}
        `;
        // Comments change nothing T3 shows of the writer's work.
        yield* ownerComment(8806, "Still on it.");
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8807, 8808])), [
          itemKeyFor(8808),
        ]);
        writer.body = owning("src/new-scope.py").body;
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8807])), []);
        assert.strictEqual(yield* dispositionOf(8807), "custody_unread");
        // Its text back as admitted, the pass weighs it again.
        writer.body = owning("src/shared.py").body;
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8807])), []);
        assert.strictEqual(yield* dispositionOf(8807), "nothing_proposed");
      }),
    ),
);

// Review C25R F2: the transfer begins after the policy answered, before the pass's second admission.
it.effect(
  "Lifecycle/custody: a transfer that begins draining while a pass admits refuses its later admissions",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          yield* seedIssue(8811, owning("src/shared.py"));
          yield* seedIssue(8812, owning("src/disjoint.py"));
          yield* seedIssue(8813, owning("src/shared.py"));
          const worker = legacyWorker("issue-8811-implement-1", {
            state: "running",
            terminal: false,
            runs: [{ id: "run:issue-8811-implement-1", status: "running" }],
          });
          yield* useLegacyJob([worker], true);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const store = yield* FactoryStore.FactoryStore;
          const lookups = yield* AdmissionLookups;
          lookups.before = Effect.gen(function* () {
            const reservations = yield* store.listReservations(factoryId);
            if (!reservations.some((reservation) => reservation.itemKey === itemKeyFor(8812)))
              return;
            lookups.before = undefined;
            const transferred = yield* factory.transferLegacy({
              factoryId,
              transferId: "transfer-draining-while-admitting",
              job: legacyJob,
              by: "owner",
              items: [{ itemKey: itemKeyFor(8811), workIds: [worker.workId] }],
            });
            assert.strictEqual(transferred.type, "draining");
          }).pipe(Effect.orDie);
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8812, 8813])), [
            itemKeyFor(8812),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(8812), yield* dispositionOf(8813)],
            ["admitted", "refused:custody_changed"],
          );
          // The next pass knows the draining writer, and waits for it.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8813])), []);
          assert.strictEqual(yield* dispositionOf(8813), "legacy_unscoped");
        }),
      ),
    ),
);

// Review C25R F3: the owner hands an item back to a job whose worker is still running.
it.effect(
  "Lifecycle/custody: a rolled-back item keeps every start out until its job's worker finishes",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          yield* seedIssue(8821, owning("src/shared.py"));
          yield* seedIssue(8822, owning("src/shared.py"));
          yield* seedIssue(8823, owning("src/disjoint.py"));
          const workId = "issue-8821-implement-1";
          const jobs = yield* useLegacyJob([
            legacyWorker(workId, {
              state: "running",
              terminal: false,
              runs: [{ id: `run:${workId}`, status: "running" }],
            }),
          ]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transferred = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-handed-back",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(8821), workIds: [workId] }],
          });
          assert.strictEqual(transferred.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8822, 8823])), []);
          const rolledBack = yield* factory.rollbackTransfer({
            factoryId,
            transferId: "transfer-handed-back",
            by: "owner",
            reason: "the job keeps its item",
          });
          assert.strictEqual(rolledBack.type, "rolled_back");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8822, 8823])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8822), yield* dispositionOf(8823)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
          // Its worker finished: nothing writes 8821's files any more.
          jobs.description = { ...jobs.description, workers: [legacyWorker(workId)] };
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8822, 8823])), [
            itemKeyFor(8822),
            itemKeyFor(8823),
          ]);
        }),
      ),
    ),
);

// Review C25 (combined) F2: neither step leaves a held reservation or a draining transfer behind.
it.effect.each([
  ["begun draining", "draining", true],
  ["adopted at once", "adopted", false],
] as const)(
  "Lifecycle/custody: a transfer %s, then rolled back, while a pass admits refuses its later admissions",
  ([, begun, running]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          yield* seedIssue(8814, owning("src/shared.py"));
          yield* seedIssue(8815, owning("src/disjoint.py"));
          yield* seedIssue(8816, owning("src/shared.py"));
          const workId = "issue-8814-implement-1";
          yield* useLegacyJob(
            [
              legacyWorker(workId, {
                state: "running",
                terminal: false,
                runs: [{ id: `run:${workId}`, status: "running" }],
              }),
            ],
            running,
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const store = yield* FactoryStore.FactoryStore;
          const lookups = yield* AdmissionLookups;
          lookups.before = Effect.gen(function* () {
            const reservations = yield* store.listReservations(factoryId);
            if (!reservations.some((reservation) => reservation.itemKey === itemKeyFor(8815)))
              return;
            lookups.before = undefined;
            const transferred = yield* factory.transferLegacy({
              factoryId,
              transferId: "transfer-and-back-while-admitting",
              job: legacyJob,
              by: "owner",
              items: [{ itemKey: itemKeyFor(8814), workIds: [workId] }],
            });
            assert.strictEqual(transferred.type, begun);
            const handedBack = yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-and-back-while-admitting",
              by: "owner",
              reason: "the job keeps its item",
            });
            assert.strictEqual(handedBack.type, "rolled_back");
          }).pipe(Effect.orDie);
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8815, 8816])), [
            itemKeyFor(8815),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(8815), yield* dispositionOf(8816)],
            ["admitted", "refused:custody_changed"],
          );
          // The next pass knows the writer handed back, and waits for it.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8816])), []);
          assert.strictEqual(yield* dispositionOf(8816), "legacy_unscoped");
        }),
      ),
    ),
);

// Review R3 F3: a legacy worker started on text T3 never saw, so no later read proves its scope;
// while it may still write, nothing new starts, disjoint work included.
it.effect.each([
  ["adopted", false, false],
  ["draining", true, false],
  ["rolled back", false, true],
] as const)(
  "Lifecycle/custody: a legacy writer, %s, edited before any pass weighs it keeps every new start out",
  ([, running, rolledBack]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          const writer = yield* seedIssue(8861, owning("src/shared.py"));
          yield* seedIssue(8862, owning("src/shared.py"));
          yield* seedIssue(8863, owning("src/disjoint.py"));
          const workId = "issue-8861-implement-1";
          yield* useLegacyJob(
            [
              legacyWorker(workId, {
                state: "running",
                terminal: false,
                runs: [{ id: `run:${workId}`, status: "running" }],
              }),
            ],
            running,
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transferred = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-unseen",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(8861), workIds: [workId] }],
          });
          assert.strictEqual(transferred.type, running ? "draining" : "adopted");
          if (rolledBack) {
            const handedBack = yield* factory.rollbackTransfer({
              factoryId,
              transferId: "transfer-unseen",
              by: "owner",
              reason: "the job keeps its item",
            });
            assert.strictEqual(handedBack.type, "rolled_back");
          }
          writer.body = owning("src/new-scope.py").body;
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8862, 8863])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8862), yield* dispositionOf(8863)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

// Review R3 F1: a second transfer of the same running worker is no new writer.
it.effect(
  "Lifecycle/custody: a retransfer of a running legacy worker keeps every new start out",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          const writer = yield* seedIssue(8871, owning("src/shared.py"));
          yield* seedIssue(8872, owning("src/shared.py"));
          yield* seedIssue(8873, owning("src/disjoint.py"));
          const workId = "issue-8871-implement-1";
          yield* useLegacyJob([
            legacyWorker(workId, {
              state: "running",
              terminal: false,
              runs: [{ id: `run:${workId}`, status: "running" }],
            }),
          ]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transfer = (transferId: string) =>
            factory.transferLegacy({
              factoryId,
              transferId,
              job: legacyJob,
              by: "owner",
              items: [{ itemKey: itemKeyFor(8871), workIds: [workId] }],
            });
          assert.strictEqual((yield* transfer("first-custody")).type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8872])), []);
          const handedBack = yield* factory.rollbackTransfer({
            factoryId,
            transferId: "first-custody",
            by: "owner",
            reason: "the job keeps its item",
          });
          assert.strictEqual(handedBack.type, "rolled_back");
          writer.body = owning("src/new-scope.py").body;
          assert.strictEqual((yield* transfer("second-custody")).type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8872, 8873])), []);
          assert.strictEqual(yield* dispositionOf(8872), "legacy_unscoped");
        }),
      ),
    ),
);

// Review R3 F2: the item is read but shown to nobody, ineligible and unclaimed, so only the
// transfers listed before the policy answered can say whether its writer was weighed.
it.effect.each([
  ["begun draining", "draining", true],
  ["adopted at once", "adopted", false],
] as const)(
  "Lifecycle/custody: a transfer %s, then rolled back, while the policy decides holds the pass back",
  ([, begun, running]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          yield* seedIssue(8881, { ...owning("src/shared.py"), labels: ["in-progress"] });
          yield* seedIssue(8882, owning("src/shared.py"));
          yield* seedIssue(8883, owning("src/disjoint.py"));
          const workId = "issue-8881-implement-1";
          yield* useLegacyJob(
            [
              legacyWorker(workId, {
                state: "running",
                terminal: false,
                runs: [{ id: `run:${workId}`, status: "running" }],
              }),
            ],
            running,
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const policy = yield* PolicyFake;
          const decide = policy.decide!;
          policy.decide = (input) =>
            Effect.gen(function* () {
              policy.decide = decide;
              assert.strictEqual(
                input.active.some((entry) => entry.itemKey === itemKeyFor(8881)),
                false,
              );
              const transferred = yield* factory.transferLegacy({
                factoryId,
                transferId: "transfer-and-back-while-deciding",
                job: legacyJob,
                by: "owner",
                items: [{ itemKey: itemKeyFor(8881), workIds: [workId] }],
              });
              assert.strictEqual(transferred.type, begun);
              const handedBack = yield* factory.rollbackTransfer({
                factoryId,
                transferId: "transfer-and-back-while-deciding",
                by: "owner",
                reason: "the job keeps its item",
              });
              assert.strictEqual(handedBack.type, "rolled_back");
            }).pipe(
              Effect.orDie,
              Effect.andThen(() => decide(input)),
            );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8881, 8882, 8883])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8882), yield* dispositionOf(8883)],
            ["custody_unread", "custody_unread"],
          );
          // The next pass knows the writer, and waits for it.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8882, 8883])), []);
          assert.strictEqual(yield* dispositionOf(8882), "legacy_unscoped");
        }),
      ),
    ),
);

// Review R4 F1: a later transfer of the item names only worker B; worker A, handed back running
// by an earlier rollback, is still a known writer, whatever B's transfer settles.
it.effect.each(["historical", "disposed of", "rolled back finished"] as const)(
  "Lifecycle/custody: a later transfer that accounts for another worker (%s) keeps the earlier running worker's hold",
  (mode) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          yield* seedIssue(8891, { ...owning("src/shared.py"), labels: ["in-progress"] });
          yield* seedIssue(8892, owning("src/shared.py"));
          yield* seedIssue(8893, owning("src/disjoint.py"));
          const a = legacyWorker("issue-8891-implement-1", {
            state: "running",
            terminal: false,
            runs: [{ id: "run:issue-8891-implement-1", status: "running" }],
          });
          const b = legacyWorker("issue-8891-review-1");
          yield* useLegacyJob([a, b]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transfer = (transferId: string, workId: string, historical: boolean) =>
            factory.transferLegacy({
              factoryId,
              transferId,
              job: legacyJob,
              by: "owner",
              items: [
                {
                  itemKey: itemKeyFor(8891),
                  workIds: [workId],
                  ...(historical ? { historical: [{ workId, reason: "B finished" }] } : {}),
                },
              ],
            });
          const handBack = (transferId: string) =>
            factory.rollbackTransfer({
              factoryId,
              transferId,
              by: "owner",
              reason: "it continues",
            });
          assert.strictEqual((yield* transfer("transfer-a", a.workId, false)).type, "adopted");
          assert.strictEqual((yield* handBack("transfer-a")).type, "rolled_back");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8892, 8893])), []);
          assert.strictEqual(
            (yield* transfer("transfer-b", b.workId, mode === "historical")).type,
            "adopted",
          );
          if (mode === "disposed of") {
            const [held] = (yield* reservationsOf(8891, "transferred")).filter(
              (reservation) => reservation.state === "held",
            );
            assert.isTrue(
              yield* factory.disposeObservedClaim({
                factoryId,
                reservationId: held!.reservationId,
                by: "owner",
                reason: "B finished",
              }),
            );
          }
          if (mode === "rolled back finished") {
            assert.strictEqual((yield* handBack("transfer-b")).type, "rolled_back");
          }
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8892, 8893])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8892), yield* dispositionOf(8893)],
            ["legacy_unscoped", "legacy_unscoped"],
          );
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/custody: once the earlier worker finished, a later transfer accounting for the other frees the item",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* keepWritersApart;
          yield* seedIssue(8894, { ...owning("src/shared.py"), labels: ["in-progress"] });
          yield* seedIssue(8895, owning("src/shared.py"));
          const a = legacyWorker("issue-8894-implement-1", {
            state: "running",
            terminal: false,
            runs: [{ id: "run:issue-8894-implement-1", status: "running" }],
          });
          const b = legacyWorker("issue-8894-review-1");
          const jobs = yield* useLegacyJob([a, b]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const transferred = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-a",
            job: legacyJob,
            by: "owner",
            items: [{ itemKey: itemKeyFor(8894), workIds: [a.workId] }],
          });
          assert.strictEqual(transferred.type, "adopted");
          const handedBack = yield* factory.rollbackTransfer({
            factoryId,
            transferId: "transfer-a",
            by: "owner",
            reason: "it continues",
          });
          assert.strictEqual(handedBack.type, "rolled_back");
          jobs.description = { ...jobs.description, workers: [legacyWorker(a.workId), b] };
          const accounted = yield* factory.transferLegacy({
            factoryId,
            transferId: "transfer-b",
            job: legacyJob,
            by: "owner",
            items: [
              {
                itemKey: itemKeyFor(8894),
                workIds: [b.workId],
                historical: [{ workId: b.workId, reason: "B finished" }],
              },
            ],
          });
          assert.strictEqual(accounted.type, "adopted");
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8895])), [itemKeyFor(8895)]);
        }),
      ),
    ),
);

// Review R4 F2: the item has passed review, so the pass's answer for it is T3's own integration
// or closure, not an admission; custody that moves before that operation is recorded refuses it.
const reviewedItem = (issueNumber: number, closing: boolean) =>
  Effect.gen(function* () {
    const issue = yield* seedIssue(issueNumber, owning("src/landing.py"));
    const build = admittedBy(yield* advance("tracker_event", 1));
    const head = `c000${issueNumber}`;
    yield* recordCommit(head, [lifecycleBase]);
    yield* workStage(build, {
      outcome: "implemented",
      subject: { ...subjectFor(head, lifecycleBase), branch: `t3-factory/${issueNumber}` },
      summary: "Implemented.",
    });
    const review = admittedBy(yield* advance("outcome"));
    yield* workStage(review, {
      outcome: "review_passed",
      subject: subjectFor(head),
      summary: "Reviewed.",
    });
    const policy = yield* PolicyFake;
    // Settles the review without deciding the next stage.
    const settle = Effect.gen(function* () {
      policy.available = false;
      yield* advance("outcome", 2);
      policy.available = true;
    });
    yield* settle;
    if (closing) {
      yield* collectIssues([issueNumber]);
      yield* runEffects;
      assert.strictEqual(issue.state, "open");
      yield* settle;
    }
    return issue;
  });

it.effect.each([
  ["integration", false],
  ["closure", true],
] as const)(
  "Lifecycle/custody: custody that moves while a pass acts refuses its later %s",
  ([, closing]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          const issue = yield* reviewedItem(8901, closing);
          yield* seedIssue(8900, owning("src/disjoint.py"));
          yield* seedIssue(8904, { ...owning("src/landing.py"), labels: ["in-progress"] });
          const worker = legacyWorker("issue-8904-implement-1", {
            state: "running",
            terminal: false,
            runs: [{ id: "run:issue-8904-implement-1", status: "running" }],
          });
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const lookups = yield* AdmissionLookups;
          // The owner adopts 8904's running worker as the pass admits 8900, before it acts on 8901.
          lookups.before = Effect.gen(function* () {
            lookups.before = undefined;
            const transferred = yield* factory.transferLegacy({
              factoryId,
              transferId: "transfer-while-acting",
              job: legacyJob,
              by: "owner",
              items: [{ itemKey: itemKeyFor(8904), workIds: [worker.workId] }],
            });
            assert.strictEqual(transferred.type, "adopted");
          }).pipe(Effect.orDie);
          const writes = (yield* GitGraphFake).writes.length;
          yield* collectIssues([8900, 8901]);
          yield* runEffects;
          assert.deepStrictEqual(
            [yield* dispositionOf(8900), yield* dispositionOf(8901)],
            ["refused:custody_changed", "custody_unread"],
          );
          assert.strictEqual((yield* GitGraphFake).writes.length, writes);
          assert.strictEqual(issue.state, "open");
        }),
      ),
    ),
);

it.effect.each([
  ["integration", false, "git_integrate"],
  ["closure", true, "tracker_close"],
] as const)(
  "Lifecycle/custody: custody that moves before a pass records its %s refuses it",
  ([, closing, kind]) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          const issue = yield* reviewedItem(8911, closing);
          yield* seedIssue(8914, { ...owning("src/landing.py"), labels: ["in-progress"] });
          const worker = legacyWorker("issue-8914-implement-1", {
            state: "running",
            terminal: false,
            runs: [{ id: "run:issue-8914-implement-1", status: "running" }],
          });
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const lookups = yield* AdmissionLookups;
          lookups.beforeIntent = (intent) =>
            intent.kind !== kind
              ? Effect.void
              : Effect.gen(function* () {
                  lookups.beforeIntent = undefined;
                  const transferred = yield* factory.transferLegacy({
                    factoryId,
                    transferId: "transfer-before-operation",
                    job: legacyJob,
                    by: "owner",
                    items: [{ itemKey: itemKeyFor(8914), workIds: [worker.workId] }],
                  });
                  assert.strictEqual(transferred.type, "adopted");
                }).pipe(Effect.orDie);
          const writes = (yield* GitGraphFake).writes.length;
          yield* collectIssues([8911]);
          yield* runEffects;
          assert.strictEqual(yield* dispositionOf(8911), "refused:custody_changed");
          assert.strictEqual((yield* GitGraphFake).writes.length, writes);
          assert.strictEqual(issue.state, "open");
          // The next pass knows the adopted writer, and waits for it.
          yield* collectIssues([8911]);
          assert.strictEqual(yield* dispositionOf(8911), "legacy_unscoped");
        }),
      ),
    ),
);

/**
 * A project policy that weighs history as HSA's does: an item that has begun keeps its owned files
 * from new work whether or not anything is running, and decides nothing itself here.
 */
const keepClearOfLineages = Effect.map(PolicyFake, (fake) => {
  fake.decide = ({ configuration, items, active }) => {
    const busy = new Set([
      ...active.flatMap((entry) => ownedFiles(entry.issue)),
      ...items.flatMap((item) => (item.outcomes.length > 0 ? ownedFiles(item.issue) : [])),
    ]);
    return Effect.forEach(items, (item) => {
      const owned = ownedFiles(item.issue);
      const waits = item.outcomes.length > 0 || owned.some((file) => busy.has(file));
      if (!waits) for (const file of owned) busy.add(file);
      return Effect.map(
        waits
          ? Effect.succeed<FactoryLifecycle.FactoryPolicyDecision>({
              type: "none",
              reason: "owned files overlap a started lineage",
            })
          : proposeImplementation({ observation: item.observation, configuration }),
        (decision) => ({ itemKey: item.observation.itemKey, decision }),
      );
    });
  };
});

/** An item whose implement failed: its history is verified, its custody released, nothing runs. */
const startedLineage = (issueNumber: number, ...files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const issue = yield* seedIssue(issueNumber, owning(...files));
    const build = admittedBy(yield* advance("tracker_event", 1));
    yield* workStage(build, {
      outcome: "failed",
      failure: "synthetic verify failure",
      summary: "Failed before any commit.",
    });
    const policy = yield* PolicyFake;
    policy.available = false;
    yield* advance("outcome", 2);
    policy.available = true;
    assert.deepStrictEqual(yield* custodyOn(issueNumber), ["admitted:released"]);
    // A pass with a policy settles its subject: a later pass reads it only if it reads lineages.
    yield* keepClearOfLineages;
    assert.deepStrictEqual(admittedItems(yield* collectIssues([issueNumber])), []);
    return issue;
  });

// Review R1 (#25): a lineage that is not read, or not read as it is, drops out of the pass's items,
// and a policy that weighs history cannot see its files.
it.effect(
  "Lifecycle/lineage: a pass that was not asked for a started lineage still weighs it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* startedLineage(8951, "src/shared.py");
          yield* keepClearOfLineages;
          yield* seedIssue(8952, owning("src/shared.py"));
          yield* seedIssue(8953, owning("src/disjoint.py"));
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8952, 8953])), [
            itemKeyFor(8953),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(8951), yield* dispositionOf(8952)],
            ["nothing_proposed", "nothing_proposed"],
          );
        }),
      ),
    ),
);

it.effect.each(["fails", "is overtaken"] as const)(
  "Lifecycle/lineage: a started lineage whose read %s holds the pass back until it is read",
  (route) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          const lineage = yield* startedLineage(8961, "src/shared.py");
          yield* keepClearOfLineages;
          yield* seedIssue(8962, owning("src/shared.py"));
          yield* seedIssue(8963, owning("src/disjoint.py"));
          const fake = yield* GitHubFake;
          if (route === "fails") {
            fake.failNextIssueRead.add(8961);
          } else {
            // Another reader records 8961 as it is while this pass is answered with other text.
            const current = { ...lineage, comments: [...lineage.comments] };
            lineage.body = owning("src/old.py").body;
            const services =
              yield* Effect.context<Effect.Services<ReturnType<typeof recordLaterRead>>>();
            fake.beforeIssueRead = Effect.gen(function* () {
              fake.beforeIssueRead = undefined;
              yield* recordLaterRead(8961, current);
            }).pipe(Effect.orDie, Effect.provide(services));
            fake.afterIssueRead = (issueNumber) =>
              issueNumber !== 8961
                ? Effect.void
                : Effect.sync(() => {
                    fake.afterIssueRead = undefined;
                    lineage.body = current.body;
                  });
          }
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8961, 8962, 8963])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8961), yield* dispositionOf(8962), yield* dispositionOf(8963)],
            [
              route === "fails" ? "read_failed" : "read_superseded",
              "custody_unread",
              "custody_unread",
            ],
          );
          // Read as it is, the lineage keeps the overlap out and nothing else.
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8961, 8962, 8963])), [
            itemKeyFor(8963),
          ]);
          assert.strictEqual(yield* dispositionOf(8962), "nothing_proposed");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/lineage: a started lineage whose read runs past its deadline holds the pass back",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(
            lifecycleConfiguration({ pools: pool(8), readDeadlineSeconds: 30 }),
          );
          yield* startedLineage(8971, "src/shared.py");
          yield* keepClearOfLineages;
          yield* seedIssue(8972, owning("src/shared.py"));
          yield* seedIssue(8973, owning("src/disjoint.py"));
          const fake = yield* GitHubFake;
          fake.slowIssues.add(8971);
          const pass = yield* Effect.forkScoped(collectIssues([8971, 8972, 8973]));
          yield* TestClock.adjust("31 seconds");
          assert.deepStrictEqual(admittedItems(yield* Fiber.join(pass)), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8971), yield* dispositionOf(8972), yield* dispositionOf(8973)],
            ["read_deadline", "custody_unread", "custody_unread"],
          );
          fake.slowIssues.delete(8971);
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8971, 8972, 8973])), [
            itemKeyFor(8973),
          ]);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/lineage: a started lineage this factory no longer owns holds the pass until it is owned again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* startedLineage(8981, "src/shared.py");
          yield* keepClearOfLineages;
          yield* seedIssue(8982, owning("src/shared.py"));
          yield* seedIssue(8983, owning("src/disjoint.py"));
          // Its own claim comment went missing: the claim no longer proves the factory owns it.
          const sql = yield* SqlClient.SqlClient;
          const [owned] = yield* sql<{
            readonly reservation_id: string;
            readonly record_json: string;
          }>`
            SELECT reservation_id, record_json FROM factory_claims
            WHERE factory_id = ${factoryId}
              AND json_extract(record_json, '$.itemKey') = ${itemKeyFor(8981)}
          `;
          yield* sql`
            UPDATE factory_claims
            SET state = 'stale_after_claim',
              record_json = json_set(record_json, '$.state', 'stale_after_claim', '$.reason', 'own_claim_missing')
            WHERE reservation_id = ${owned!.reservation_id}
          `;
          for (let pass = 0; pass < 2; pass++) {
            assert.deepStrictEqual(admittedItems(yield* collectIssues([8982, 8983])), []);
            assert.deepStrictEqual(
              [yield* dispositionOf(8981), yield* dispositionOf(8982), yield* dispositionOf(8983)],
              ["not_owned", "custody_unread", "custody_unread"],
            );
          }
          yield* sql`
            UPDATE factory_claims SET state = 'verified', record_json = ${owned!.record_json}
            WHERE reservation_id = ${owned!.reservation_id}
          `;
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8982, 8983])), [
            itemKeyFor(8983),
          ]);
        }),
      ),
    ),
);

// Control: a closed lineage holds nothing, whoever asks for what.
it.effect("Lifecycle/lineage: a lineage the factory closed keeps no files from new work", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
        const issue = yield* seedIssue(8991, owning("src/shared.py"));
        const build = admittedBy(yield* advance("tracker_event", 1));
        yield* recordCommit("c0008991", [lifecycleBase]);
        yield* workStage(build, {
          outcome: "implemented",
          subject: { ...subjectFor("c0008991", lifecycleBase), branch: "t3-factory/8991" },
          summary: "Implemented.",
        });
        const review = admittedBy(yield* advance("outcome"));
        yield* workStage(review, {
          outcome: "review_passed",
          subject: subjectFor("c0008991"),
          summary: "Reviewed.",
        });
        assert.strictEqual(
          (yield* advance("outcome")).filter((a) => a.type === "admitted").length,
          0,
        );
        assert.strictEqual(issue.state, "closed");
        yield* keepClearOfLineages;
        yield* seedIssue(8992, owning("src/shared.py"));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([8992])), [itemKeyFor(8992)]);
      }),
    ),
  ),
);

// Independent review of 4a365861 (P1): an item closed, reopened and failed again is a started lineage
// the lifecycle decides anew, so the fence must read and weigh it like any other.
it.effect.each([false, true])(
  "Review R1: a reopened lineage is weighed on a subset pass (readFails=%s)",
  (readFails) =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          const issue = yield* seedIssue(8994, owning("src/shared.py"));
          const first = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit("c0008994", [lifecycleBase]);
          yield* workStage(first, {
            outcome: "implemented",
            subject: { ...subjectFor("c0008994", lifecycleBase), branch: "t3-factory/8994" },
            summary: "First version implemented.",
          });
          yield* workStage(admittedBy(yield* advance("outcome")), {
            outcome: "review_passed",
            subject: subjectFor("c0008994"),
            summary: "Reviewed.",
          });
          yield* advance("outcome");
          assert.strictEqual(issue.state, "closed");
          issue.state = "open";
          const reopened = admittedBy(yield* advance("tracker_event", 1));
          assert.deepStrictEqual(stageOf(reopened), [itemKeyFor(8994), "implement"]);
          yield* workStage(reopened, {
            outcome: "failed",
            failure: "synthetic reopened failure",
            summary: "Failed before a new commit.",
          });
          const policy = yield* PolicyFake;
          policy.available = false;
          yield* advance("outcome", 2);
          policy.available = true;
          assert.deepStrictEqual(yield* custodyOn(8994), [
            "admitted:released",
            "admitted:released",
            "admitted:released",
          ]);
          yield* keepClearOfLineages;
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8994])), []);
          yield* seedIssue(8995, owning("src/shared.py"));
          yield* seedIssue(8996, owning("src/disjoint.py"));
          if (readFails) (yield* GitHubFake).failNextIssueRead.add(8994);
          const result = yield* collectIssues(readFails ? [8994, 8995, 8996] : [8995, 8996]);
          assert.deepStrictEqual(admittedItems(result), readFails ? [] : [itemKeyFor(8996)]);
        }),
      ),
    ),
);

// The store's open lineages agree with the lifecycle: a closure ends a lineage until it is
// reopened, a result rejected before it was verified never started one, and history stays.
it.effect("Lifecycle/lineage: open items follow closure and reopening, whatever was rejected", () =>
  runIsolated(
    Effect.gen(function* () {
      const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
      const file = (
        outcomeId: string,
        issueNumber: number,
        stage: "implement" | "close",
        report: FactoryOutcomeStore.FactoryOutcomeReport,
      ) =>
        outcomes.insertReported({
          outcomeId,
          factoryId,
          itemKey: itemKeyFor(issueNumber),
          origin: { type: "native" },
          stage,
          report,
          reportDigest: sha256(outcomeId),
          reportedAt: "2026-10-28T00:00:00.000Z",
          state: "reported",
        });
      const verify = (outcomeId: string) =>
        outcomes.markVerified({ outcomeId, receipt: { verifiedAt: "2026-10-28T00:00:01.000Z" } });
      const failed = { outcome: "failed" as const, failure: "synthetic", summary: "Failed." };
      const closed = { outcome: "closed" as const, summary: "Closed." };
      const reopen = (issueNumber: number, closureOutcomeId: string) =>
        outcomes.recordReopen({
          factoryId,
          itemKey: itemKeyFor(issueNumber),
          closureOutcomeId,
          observationId: 1,
        });
      // 9001: reported only. 9002: closed. 9003: closed, then reopened.
      yield* file("o-9001", 9001, "implement", failed);
      yield* file("o-9002", 9002, "implement", failed);
      yield* verify("o-9002");
      yield* file("c-9002", 9002, "close", closed);
      yield* verify("c-9002");
      yield* file("o-9003", 9003, "implement", failed);
      yield* verify("o-9003");
      yield* file("c-9003", 9003, "close", closed);
      yield* verify("c-9003");
      assert.isTrue(yield* reopen(9003, "c-9003"));
      // 9004: closed, reopened, closed again. 9005: rejected before verification.
      yield* file("c-9004", 9004, "close", closed);
      yield* verify("c-9004");
      yield* reopen(9004, "c-9004");
      yield* file("c2-9004", 9004, "close", closed);
      yield* verify("c2-9004");
      yield* file("o-9005", 9005, "implement", failed);
      assert.isTrue(yield* outcomes.markRejected({ outcomeId: "o-9005", rejection: "unbound" }));
      // 9006: verified, then rejected by the owner: its history stays.
      yield* file("o-9006", 9006, "implement", failed);
      yield* verify("o-9006");
      assert.isTrue(
        yield* outcomes.rejectVerified({
          outcomeId: "o-9006",
          failureDigest: sha256("o-9006"),
          by: "owner",
          reason: "synthetic",
        }),
      );
      assert.deepStrictEqual(yield* outcomes.openItems(factoryId), [
        itemKeyFor(9001),
        itemKeyFor(9003),
        itemKeyFor(9006),
      ]);
      // Nothing was erased: every closure is still on record.
      for (const outcomeId of ["c-9002", "c-9003", "c-9004", "c2-9004"]) {
        const kept = yield* outcomes.get(outcomeId);
        assert.strictEqual(Option.getOrThrow(kept).state, "verified");
      }
    }),
  ),
);

// The legacy scope and the started-lineage fence (#25 R1) meet in one pass: each keeps out only
// its own files, and a lineage the pass could not read still holds everything.
it.effect(
  "Lifecycle/custody: scoped legacy work beside a started lineage keeps out only the overlapping starts",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* configureFactory(lifecycleConfiguration({ pools: pool(8) }));
          yield* startedLineage(8981, "src/shared.py");
          yield* keepClearOfLineages;
          yield* seedIssue(7605, owning("src/api.py"));
          yield* seedIssue(8982, owning("src/shared.py"));
          yield* seedIssue(7686, owning("src/api.py"));
          yield* seedIssue(7683, owning("src/c.py"));
          const worker = legacyWorker("issue-7605-implement-1");
          yield* useLegacyJob([worker]);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.transferLegacy(scopedTransfer("transfer-both", worker.workId, apiOnly)))
              .type,
            "adopted",
          );
          (yield* GitHubFake).failNextIssueRead.add(8981);
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8982, 7686, 7683])), []);
          assert.deepStrictEqual(
            [yield* dispositionOf(8981), yield* dispositionOf(8982), yield* dispositionOf(7683)],
            ["read_failed", "custody_unread", "custody_unread"],
          );
          assert.deepStrictEqual(admittedItems(yield* collectIssues([8982, 7686, 7683])), [
            itemKeyFor(7683),
          ]);
          assert.deepStrictEqual(
            [yield* dispositionOf(8982), yield* dispositionOf(7686)],
            ["nothing_proposed", "nothing_proposed"],
          );
          assert.deepStrictEqual(yield* activeCustody, [[itemKeyFor(7605), "legacy"]]);
        }),
      ),
    ),
);

it.effect(
  "Claims/S03: a task a running writer delegates while a pass admits refuses none of its admissions",
  () =>
    runIsolated(
      Effect.gen(function* () {
        yield* configureClaimFactory(4);
        yield* keepWritersApart;
        yield* seedIssue(6411, owning("src/service.py"));
        yield* seedIssue(6412, owning("src/c.py"));
        yield* seedIssue(6413, owning("src/d.py"));
        const first = yield* collectIssues([6411]);
        if (first.type !== "collected") return assert.fail(first.type);
        const worker = admittedExecution(admittedBy(first.admissions));
        yield* runEffects;
        const store = yield* FactoryStore.FactoryStore;
        const lookups = yield* AdmissionLookups;
        const services = yield* Effect.context<Effect.Services<ReturnType<typeof delegateFrom>>>();
        lookups.before = Effect.gen(function* () {
          const reservations = yield* store.listReservations(factoryId);
          if (!reservations.some((reservation) => reservation.itemKey === itemKeyFor(6412))) return;
          lookups.before = undefined;
          yield* delegateFrom(worker.threadId, "mid-admission");
        }).pipe(Effect.orDie, Effect.provide(services));
        assert.deepStrictEqual(admittedItems(yield* collectIssues([6412, 6413])), [
          itemKeyFor(6412),
          itemKeyFor(6413),
        ]);
        assert.deepStrictEqual(yield* custodyOn(6411), ["admitted:held", "inherited:held"]);
      }),
    ),
);

/** Synthetic foreign claim bodies; recognition depends on the configured marker. */
const betaBuilderClaim =
  "<!-- example-claim key=example-implement attempt=1 request=example-request-1 target=builder role=builder writes=src/example.ts resources=worker -->";
const betaJudgmentClaim =
  "<!-- example-claim key=example-review attempt=1 request=example-request-2 target=reviewer role=reviewer writes=none resources=worker -->";

it.effect(
  "Claims/S03: a ready-only factory still discovers the work other claims hold, never admits it",
  () =>
    runIsolated(
      Effect.gen(function* () {
        // Each legacy claim is charged a builder unit, so one stays free for the ready issue.
        yield* configureFactory({
          pools: pool(3),
          claim: {
            ...claimConfig,
            foreignClaimCommentPatterns: ["<!-- example-claim "],
            repositories: [claimRepository],
          },
        });
        const legacy = (id: number, body: string) => ({
          id,
          body,
          user: { id: 42, login: "example-user" },
          created_at: "2026-10-24T00:00:00Z",
        });
        // Both synthetic items are unready and held by foreign claims.
        yield* seedIssue(6401, {
          labels: ["effort:high", "needs-owner"],
          comments: [legacy(1, betaBuilderClaim)],
        });
        yield* seedIssue(6402, {
          labels: ["blocked", "effort:high", "needs-owner"],
          comments: [legacy(2, betaJudgmentClaim)],
        });
        yield* seedIssue(6403, { labels: ["effort:high", "needs-owner"] });
        yield* seedIssue(6404);
        const factory = yield* FactoryLifecycle.FactoryLifecycle;
        const result = yield* factory.reconcile({ factoryId, trigger: "tracker_event" });
        assert.strictEqual(result.type, "collected");
        const policy = yield* PolicyFake;
        assert.deepStrictEqual(
          policy.active.at(-1)?.map((entry) => [entry.itemKey, entry.custody]),
          [
            [itemKeyFor(6401), "foreign"],
            [itemKeyFor(6402), "foreign"],
          ],
        );
        // Readiness is still the label: only the ready, unclaimed issue is claimed.
        yield* runEffects;
        assert.deepStrictEqual(
          [
            (yield* claimComments(6401)).length,
            (yield* claimComments(6402)).length,
            (yield* claimComments(6403)).length,
            (yield* claimComments(6404)).length,
          ],
          [0, 0, 0, 1],
        );
        // Unready, with no comment or claim label: never read, as nothing can hold or start it.
        assert.isUndefined(yield* dispositionOf(6403));
        assert.strictEqual(yield* dispositionOf(6401), "not_eligible");
      }),
    ),
);

it.effect(
  "Lifecycle/N84: a rework at the reviewed head is reviewed again only on new verified evidence",
  () =>
    runIsolated(
      withScratch((root) =>
        Effect.gen(function* () {
          const graph = yield* GitGraphFake;
          graph.parents.set(lifecycleBase, []);
          graph.branches.set("main", lifecycleBase);
          yield* usePolicy(stageRequest);
          yield* configureFactory(lifecycleConfiguration({ artifactRoot: root }));
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          yield* seedIssue(7841);
          const head = "a0000841";
          const journey = path.join(root, "rv84", "journey.json");
          const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.json`);
          yield* fs.makeDirectory(path.dirname(journey), { recursive: true });
          yield* fs.writeFileString(journey, "items and total marked");
          yield* fs.writeFileString(outside, "items and total marked");
          yield* Effect.addFinalizer(() => fs.remove(outside).pipe(Effect.ignore));

          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit(head, [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor(head, lifecycleBase),
            summary: "Implemented.",
          });
          const basisOf = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
            admission.type !== "refused" && admission.reservation.origin === "admitted"
              ? admission.reservation.stageBasis
              : undefined;
          const failReview = (review: FactoryLifecycle.FactoryAdmissionResult, finding: string) =>
            workStage(review, {
              outcome: "review_failed",
              subject: subjectFor(head),
              failure: finding,
              summary: "Acceptance unproven.",
            });
          /** Correction asks for verification at the same head; the rework reports that head again. */
          const reworkWith = (artifacts: FactoryReportInput["artifacts"]) =>
            Effect.gen(function* () {
              const correct = admittedBy(yield* advance("outcome"));
              yield* workStage(correct, {
                outcome: "correction_spec",
                summary: "Run the supplementary verification at the same head.",
              });
              const rework = admittedBy(yield* advance("outcome"));
              yield* workStage(rework, {
                outcome: "implemented",
                subject: subjectFor(head, lifecycleBase),
                summary: "Verified at the same head.",
                ...(artifacts === undefined ? {} : { artifacts }),
              });
              const [reported] = yield* outcomes.listForOrigin(rework.reservation.reservationId);
              return { admissions: yield* advance("outcome"), outcomeId: reported!.outcomeId };
            });
          const admitted = (admissions: ReadonlyArray<FactoryLifecycle.FactoryAdmissionResult>) =>
            admissions.filter((admission) => admission.type === "admitted");
          const ownerRejects = (outcomeId: string) =>
            factory.rejectOutcome({
              factoryId,
              outcomeId,
              reason: "The supplementary verification is not proven.",
              by: "owner",
            });

          const firstReview = admittedBy(yield* advance("outcome"));
          assert.strictEqual(basisOf(firstReview), `review:${head}`);
          yield* failReview(
            firstReview,
            "RV84-1: the items-plus-total journey is not demonstrated.",
          );

          // Evidence T3 cannot verify earns nothing: outside the root, a wrong digest, a missing file.
          const unverified: ReadonlyArray<FactoryReportInput["artifacts"]> = [
            undefined,
            [{ path: outside, sha256: sha256("items and total marked") }],
            [{ path: journey, sha256: sha256("something else") }],
            [{ path: path.join(root, "rv84", "absent.json"), sha256: sha256("") }],
          ];
          for (const artifacts of unverified) {
            const rework = yield* reworkWith(artifacts);
            assert.deepStrictEqual(admitted(rework.admissions), [], JSON.stringify(artifacts));
            assert.isTrue(yield* ownerRejects(rework.outcomeId));
          }

          // Verified evidence at the same head is a fresh, independent review of that evidence.
          const evidence = [{ path: journey, sha256: sha256("items and total marked") }];
          const verified = yield* reworkWith(evidence);
          const secondReview = admittedBy(verified.admissions);
          assert.match(
            basisOf(secondReview) ?? "",
            new RegExp(`^review:${head}:evidence:[0-9a-f]{64}$`),
          );
          yield* failReview(secondReview, "RV84-3: transition coverage gaps remain.");

          // The same evidence again is the review already made on it: no duplicate decision.
          const repeated = yield* reworkWith(evidence);
          assert.deepStrictEqual(admitted(repeated.admissions), []);
          assert.isTrue(yield* ownerRejects(repeated.outcomeId));

          // New verified evidence earns a new review, whose pass is accepted for the head it names.
          yield* fs.writeFileString(journey, "items, total and transitions marked");
          const changed = yield* reworkWith([
            { path: journey, sha256: sha256("items, total and transitions marked") },
          ]);
          const thirdReview = admittedBy(changed.admissions);
          assert.notStrictEqual(basisOf(thirdReview), basisOf(secondReview));
          yield* workStage(thirdReview, {
            outcome: "review_passed",
            subject: subjectFor(head),
            summary: "Acceptance demonstrated.",
          });
          yield* advance("outcome");
          const history = yield* itemHistory(7841);
          assert.strictEqual(history.filter((stage) => stage === "review").length, 3);
          assert.include(history, "review_passed");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N85: the owner sees the result a stage is decided on, rejects it once, and correction follows",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7851);
          const item = `github:${claimRepository}#7851`;
          const head = "a0000851";
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* recordCommit(head, [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor(head, lifecycleBase),
            summary: "Implemented without the requested verification.",
          });
          const review = admittedBy(yield* advance("outcome"));
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [implemented] = yield* outcomes.listForOrigin(implement.reservation.reservationId);
          const shown = (yield* factory.readState({ factoryId })).results.filter(
            (result) => result.itemKey === item,
          );
          // The review is decided on this implementation; that is the result its owner may reject.
          assert.deepStrictEqual(
            shown.map((result) => [result.stage, result.outcomeId, result.kind, result.head]),
            [["review", implemented!.outcomeId, "implemented", head]],
          );
          assert.include(shown[0]!.summary, "without the requested verification");
          const reject = (reason: string) =>
            factory.rejectOutcome({
              factoryId,
              outcomeId: implemented!.outcomeId,
              reason,
              by: "owner",
            });
          assert.isTrue(yield* reject("The rework ran none of the requested checks."));
          // A second rejection of the same result is stale: nothing changes.
          assert.isFalse(yield* reject("Again."));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor(head),
            summary: "Passes.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [item, "correct"]);
          // The rejected result is history, never offered again; the native lineage records it.
          const after = (yield* factory.readState({ factoryId })).results.filter(
            (result) => result.itemKey === item,
          );
          assert.notInclude(
            after.map((result) => result.outcomeId),
            implemented!.outcomeId,
          );
          const history = yield* itemHistory(7851);
          assert.deepStrictEqual(history.slice(0, 4), [
            "implement",
            "implemented",
            "review",
            "rejected",
          ]);
          assert.include(history, "correct");
        }),
      ),
    ),
);

/** The factory's cards in a thread, by request id: what the owner's client renders. */
const factoryCards = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    return projection.runtimeRequests
      .filter((request) => request.id.startsWith("factory-card:"))
      .map((request) => ({
        request,
        item: projection.turnItems.find(
          (item) => item.type === "user_input_request" && item.requestId === request.id,
        ),
      }));
  });

it.effect(
  "Lifecycle/N86: a gate is asked in the owner's thread, and only the owner's own answer settles it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeWithOwnerGate);
          yield* seedIssue(7861);
          const item = `github:${claimRepository}#7861`;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          // Any thread with a run can be the owner's; here it is the first execution's.
          const ownerThreadId = admittedExecution(implement).threadId;
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* recordCommit("a0000861", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("a0000861", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("a0000861"),
            summary: "Passes.",
          });
          assert.deepStrictEqual(yield* advance("outcome", 3), []);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const [decision] = (yield* factory.readState({ factoryId })).reservedDecisions;
          assert.strictEqual(decision?.state, "pending");

          // One card, bound to exactly this decision, in the shape current clients render.
          const [card, ...others] = yield* factoryCards(ownerThreadId);
          assert.deepStrictEqual(others, []);
          assert.strictEqual(
            card!.request.id,
            `factory-card:${factoryId}:gate:${decision!.decisionId}:1`,
          );
          assert.deepStrictEqual(
            [card!.request.kind, card!.request.status, card!.request.responseCapability.type],
            ["user_input", "pending", "message"],
          );
          assert.strictEqual(card!.item?.type, "user_input_request");
          const questions = card!.item?.type === "user_input_request" ? card!.item.questions : [];
          assert.deepStrictEqual(
            questions[0]?.options.map((option) => option.value),
            ["approve", "decline"],
          );
          assert.include(questions[0]?.question ?? "", "7861");

          // An answer through the ordinary path, as an agent's tool would send it, is refused
          // before anything is consumed: the card and the decision stay pending.
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const refused = yield* Effect.flip(
            orchestrator.dispatch({
              type: "runtime-request.respond",
              commandId: CommandId.make("command:agent-answers-factory-card"),
              threadId: ownerThreadId,
              requestId: card!.request.id,
              answers: { decision: "approve" },
            }),
          );
          assert.include(String(refused.cause ?? refused.message), "answered only by its owner");
          assert.strictEqual((yield* factoryCards(ownerThreadId))[0]!.request.status, "pending");
          assert.strictEqual(
            (yield* factory.readState({ factoryId })).reservedDecisions[0]!.state,
            "pending",
          );

          // Another thread, or another factory's card id, is not this owner's decision.
          const elsewhere = yield* Effect.flip(
            factory.answerCard({
              threadId: ThreadId.make("thread:somewhere-else"),
              requestId: card!.request.id,
              answers: { decision: "approve" },
              by: "session:owner:1",
            }),
          );
          assert.strictEqual(elsewhere._tag, "FactoryCardRefused");
          const foreign = yield* Effect.flip(
            factory.answerCard({
              threadId: ownerThreadId,
              requestId: `factory-card:another-factory:gate:${decision!.decisionId}:1`,
              answers: { decision: "approve" },
              by: "session:owner:1",
            }),
          );
          assert.strictEqual(foreign._tag, "FactoryCardRefused");

          // The owner's own answer, as an older client sends it (the option's label).
          yield* factory.answerCard({
            threadId: ownerThreadId,
            requestId: card!.request.id,
            answers: { decision: "Approve" },
            by: "session:owner:1",
          });
          const answered = (yield* factory.readState({ factoryId })).reservedDecisions[0]!;
          assert.deepStrictEqual(
            [answered.state, answered.resolution?.answer, answered.resolution?.by],
            ["resolved", "approve", "session:owner:1"],
          );
          assert.strictEqual((yield* factoryCards(ownerThreadId))[0]!.request.status, "resolved");

          // A replay changes nothing and says so.
          const replay = yield* Effect.flip(
            factory.answerCard({
              threadId: ownerThreadId,
              requestId: card!.request.id,
              answers: { decision: "approve" },
              by: "session:owner:1",
            }),
          );
          assert.strictEqual(replay._tag, "FactoryCardRefused");

          const started = (yield* startedTurns).length;
          assert.deepStrictEqual(yield* advance("owner_decision"), []);
          assert.strictEqual((yield* startedTurns).length, started);
          assert.include(yield* itemHistory(7861), "integrated");
          // Settled decisions are never asked again, however often the factory reconciles.
          yield* advance("clock", 3);
          assert.strictEqual((yield* factoryCards(ownerThreadId)).length, 1);
          assert.strictEqual(item, `github:${claimRepository}#7861`);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N86: a card settles only on a choice it offers, never on a name every object has",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeWithOwnerGate);
          yield* seedIssue(7862);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const ownerThreadId = admittedExecution(implement).threadId;
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* recordCommit("a0000862", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("a0000862", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("a0000862"),
            summary: "Passes.",
          });
          assert.deepStrictEqual(yield* advance("outcome", 3), []);
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const [card] = yield* factoryCards(ownerThreadId);
          for (const typed of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
            const refused = yield* Effect.flip(
              factory.answerCard({
                threadId: ownerThreadId,
                requestId: card!.request.id,
                answers: { decision: typed },
                by: "session:owner:1",
              }),
            );
            assert.strictEqual(refused._tag, "FactoryCardRefused", typed);
          }
          assert.strictEqual(
            (yield* factory.readState({ factoryId })).reservedDecisions[0]!.state,
            "pending",
          );
          assert.strictEqual((yield* factoryCards(ownerThreadId))[0]!.request.status, "pending");
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N87: a stalled result is asked about, rejected only with a reason, and settled once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7871);
          const item = `github:${claimRepository}#7871`;
          const head = "a0000871";
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const ownerThreadId = admittedExecution(implement).threadId;
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* recordCommit(head, [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor(head, lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_failed",
            subject: subjectFor(head),
            failure: "RV84-1: the journey is not demonstrated.",
            summary: "Acceptance unproven.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          yield* workStage(correct, {
            outcome: "correction_spec",
            summary: "Verify at the same head.",
          });
          const rework = admittedBy(yield* advance("outcome"));
          yield* workStage(rework, {
            outcome: "implemented",
            subject: subjectFor(head, lifecycleBase),
            summary: "Rebound the record at the unchanged head.",
          });
          // The review of this head already happened: the item is stalled on the rework's result.
          assert.deepStrictEqual(
            (yield* advance("outcome", 2)).filter((admission) => admission.type === "admitted"),
            [],
          );
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [reworked] = yield* outcomes.listForOrigin(rework.reservation.reservationId);
          const [card] = yield* factoryCards(ownerThreadId);
          assert.strictEqual(
            card!.request.id,
            `factory-card:${factoryId}:result:${reworked!.outcomeId}:1`,
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          const answer = (answers: Record<string, string>) =>
            factory.answerCard({
              threadId: ownerThreadId,
              requestId: card!.request.id,
              answers,
              by: "session:owner:1",
            });

          // A rejection needs a reason; without one nothing changes and the card stays open.
          assert.strictEqual(
            (yield* Effect.flip(answer({ action: "reject" })))._tag,
            "FactoryCardRefused",
          );
          assert.strictEqual((yield* factoryCards(ownerThreadId))[0]!.request.status, "pending");
          assert.notInclude(yield* itemHistory(7871), "rejected");

          yield* answer({ action: "reject", reason: "It ran none of the requested checks." });
          assert.strictEqual((yield* factoryCards(ownerThreadId))[0]!.request.status, "resolved");
          const corrected = admittedBy(yield* advance("owner_decision"));
          assert.deepStrictEqual(stageOf(corrected), [item, "correct"]);
          const history = yield* itemHistory(7871);
          assert.strictEqual(history.filter((event) => event === "rejected").length, 1);
          // The rejected result is never asked about again.
          yield* advance("clock", 2);
          assert.strictEqual((yield* factoryCards(ownerThreadId)).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N88: a card whose result was settled elsewhere is closed by the next pass, not answered",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7881);
          const head = "a0000881";
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const ownerThreadId = admittedExecution(implement).threadId;
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* recordCommit(head, [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor(head, lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_failed",
            subject: subjectFor(head),
            failure: "Missing proof.",
            summary: "Unproven.",
          });
          const correct = admittedBy(yield* advance("outcome"));
          yield* workStage(correct, { outcome: "correction_spec", summary: "Verify." });
          const rework = admittedBy(yield* advance("outcome"));
          yield* workStage(rework, {
            outcome: "implemented",
            subject: subjectFor(head, lifecycleBase),
            summary: "Same head.",
          });
          yield* advance("outcome", 2);
          const [card] = yield* factoryCards(ownerThreadId);
          assert.strictEqual(card!.request.status, "pending");
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [reworked] = yield* outcomes.listForOrigin(rework.reservation.reservationId);
          // The owner rejects it in Settings, as if the card's own answer was lost after it.
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.isTrue(
            yield* factory.rejectOutcome({
              factoryId,
              outcomeId: reworked!.outcomeId,
              reason: "Rejected in Settings.",
              by: "session:owner:1",
            }),
          );
          // The card can no longer reject anything: answering it is refused and closes it.
          const late = yield* Effect.flip(
            factory.answerCard({
              threadId: ownerThreadId,
              requestId: card!.request.id,
              answers: { action: "reject", reason: "Again." },
              by: "session:owner:1",
            }),
          );
          assert.strictEqual(late._tag, "FactoryCardRefused");
          assert.notStrictEqual((yield* factoryCards(ownerThreadId))[0]!.request.status, "pending");
          const corrected = admittedBy(yield* advance("owner_decision"));
          assert.deepStrictEqual(stageOf(corrected)?.[1], "correct");
          assert.strictEqual((yield* itemHistory(7881)).filter((e) => e === "rejected").length, 1);
          assert.strictEqual((yield* factoryCards(ownerThreadId)).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/N89: a dismissed or expired card leaves the decision open and is asked again, once",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(proposeWithOwnerGate);
          yield* seedIssue(7891);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          const ownerThreadId = admittedExecution(implement).threadId;
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* recordCommit("a0000891", [lifecycleBase]);
          yield* workStage(implement, {
            outcome: "implemented",
            subject: subjectFor("a0000891", lifecycleBase),
            summary: "Implemented.",
          });
          const review = admittedBy(yield* advance("outcome"));
          yield* workStage(review, {
            outcome: "review_passed",
            subject: subjectFor("a0000891"),
            summary: "Passes.",
          });
          yield* advance("outcome", 3);
          const [first] = yield* factoryCards(ownerThreadId);
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const before = yield* orchestrator.getThreadProjection(ownerThreadId);
          // Settling or interrupting the thread dismisses the card the way it cancels any question.
          yield* orchestrator.dispatch({
            type: "runtime-request.respond",
            commandId: CommandId.make("command:dismiss-factory-card"),
            threadId: ownerThreadId,
            requestId: first!.request.id,
            decision: "cancel",
          });
          const after = yield* orchestrator.getThreadProjection(ownerThreadId);
          assert.strictEqual(
            after.runtimeRequests.find((request) => request.id === first!.request.id)?.status,
            "cancelled",
          );
          // Dismissing it authorizes nothing and changes no node of the run it was shown in.
          assert.deepStrictEqual(
            after.nodes.map((node) => [node.id, node.status]),
            before.nodes.map((node) => [node.id, node.status]),
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          assert.strictEqual(
            (yield* factory.readState({ factoryId })).reservedDecisions[0]!.state,
            "pending",
          );

          // The next pass asks again under a new card, exactly once however often it runs.
          yield* advance("clock", 3);
          const cards = yield* factoryCards(ownerThreadId);
          assert.deepStrictEqual(
            cards.map((card) => [card.request.id.split(":").at(-1), card.request.status]),
            [
              ["1", "cancelled"],
              ["2", "pending"],
            ],
          );
          yield* factory.answerCard({
            threadId: ownerThreadId,
            requestId: cards[1]!.request.id,
            answers: { decision: "approve" },
            by: "session:owner:1",
          });
          const started = (yield* startedTurns).length;
          yield* advance("owner_decision");
          assert.strictEqual((yield* startedTurns).length, started);
          assert.include(yield* itemHistory(7891), "integrated");
          assert.strictEqual((yield* factoryCards(ownerThreadId)).length, 2);
        }),
      ),
    ),
);

/** The exact item version an admitted stage was decided on: a triage proposal must name it. */
const admittedVersion = (admission: FactoryLifecycle.FactoryAdmissionResult) => {
  if (admission.type === "refused" || admission.reservation.origin !== "admitted") {
    throw new Error(`Expected an admitted stage, got ${JSON.stringify(admission)}`);
  }
  return admission.reservation.itemVersion;
};

/**
 * A project policy that decomposes, as the unified policy does: an item at its first build with
 * no owned-files spec and no verified proposal for its current text is triaged; otherwise the
 * ordinary stages go ahead.
 */
const decomposingPolicy: ProposeFn = (input) => {
  if (input.stage.type !== "implement") return stageRequest(input);
  const proposed = input.outcomes.some(
    (outcome) =>
      outcome.state === "verified" &&
      outcome.report.outcome === "unit_proposed" &&
      outcome.report.proposal?.basis === input.observation.itemVersion,
  );
  if (proposed || /^## Owned files/m.test(input.issue.body)) return stageRequest(input);
  return triageRequest(input);
};

const triageRequest = (
  input: ProposeInput,
): Effect.Effect<FactoryLifecycle.FactoryPolicyDecision> =>
  Effect.map(inOneHour, (deadline) => {
    const text = `triage ${input.observation.itemKey} at ${input.observation.itemVersion}`;
    return admissionFor(
      input.observation.itemKey,
      { observationId: input.observation.observationId, deadline },
      {
        taskKind: "triage",
        policyRevision: input.configuration.policyRevision,
        title: `triage ${input.observation.itemKey}`,
        packet: { text, sha256: sha256(text), briefSchemaVersion: "brief-v1", helperSha256: null },
      },
    );
  });

const admittedOnly = (admissions: ReadonlyArray<FactoryLifecycle.FactoryAdmissionResult>) =>
  admissions.filter((admission) => admission.type === "admitted");

it.effect(
  "Decompose/D1: an item without a unit is triaged once, and its verified proposal admits the build",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(decomposingPolicy);
          yield* seedIssue(7901, { body: "Make the CSV import idempotent." });
          const item = itemKeyFor(7901);
          const triage = admittedBy(yield* advance("tracker_event", 1));
          assert.deepStrictEqual(stageOf(triage), [item, "triage"]);
          yield* workStage(triage, {
            outcome: "unit_proposed",
            summary: "One unit: the importer.",
            proposal: {
              basis: admittedVersion(triage),
              unit: "## Owned files\n- src/importer.ts",
              ownedFiles: ["src/importer.ts"],
            },
            subject: { repository: claimRepository, baseCommit: lifecycleBase },
          });
          const implement = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(implement), [item, "implement"]);
          assert.deepStrictEqual(yield* itemHistory(7901), [
            "triage",
            "unit_proposed",
            "implement",
          ]);
          // The proposal is shown on the issue as evidence, and the build runs under the claim the
          // triage made: one claim for the item.
          assert.isTrue(
            (yield* reportComments(7901)).some((comment) =>
              comment.body.includes("src/importer.ts"),
            ),
          );
          assert.strictEqual((yield* claimComments(7901)).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D2: unchanged text is never triaged again; changed text is one new triage",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(decomposingPolicy);
          yield* seedIssue(7902, { body: "Make import and export idempotent." });
          const item = itemKeyFor(7902);
          const triage = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(triage, {
            outcome: "not_actionable",
            summary: "No bounded unit.",
            failure: "Splitting import from export is the owner's choice.",
          });
          const starts = (yield* startedTurns).length;
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
          assert.strictEqual((yield* startedTurns).length, starts);
          // A person narrows the issue: its new text is a new decision, triaged once.
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7902))!.body = "Make the import idempotent.";
          const second = admittedBy(yield* advance("tracker_event"));
          assert.deepStrictEqual(stageOf(second), [item, "triage"]);
          assert.notStrictEqual(admittedVersion(second), admittedVersion(triage));
          assert.strictEqual((yield* claimComments(7902)).length, 1);
        }),
      ),
    ),
);

it.effect("Decompose/D3: a proposal for other text is rejected and builds nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        yield* configureLifecycleFactory;
        yield* usePolicy(decomposingPolicy);
        yield* seedIssue(7903, { body: "Make the CSV import idempotent." });
        const triage = admittedBy(yield* advance("tracker_event", 1));
        const otherText = {
          outcome: "unit_proposed" as const,
          summary: "A unit for some other text.",
          proposal: { basis: "0".repeat(32), unit: "## Owned files\n- x.ts", ownedFiles: ["x.ts"] },
        };
        yield* workStage(triage, otherText);
        // The rejection is the triage's one retry; the same rejection again ends it.
        const retry = admittedBy(yield* advance("outcome", 3));
        assert.deepStrictEqual(stageOf(retry), [itemKeyFor(7903), "triage"]);
        yield* workStage(retry, otherText);
        assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
        const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
        const [proposed] = yield* outcomes.listForOrigin(triage.reservation.reservationId);
        assert.strictEqual(proposed?.state, "rejected");
        assert.notInclude(yield* itemHistory(7903), "implement");
      }),
    ),
  ),
);

/**
 * The unified policy's reading of triage results, from the input its command receives: a result
 * counts only for the item version T3 says its triage read. `not_actionable` for this text waits for
 * a person; other text is triaged.
 */
const textBoundTriagePolicy: ProposeFn = (input) => {
  if (input.stage.type !== "implement") return stageRequest(input);
  const { configuration, ...item } = input;
  const [sent] = FactoryCommandPolicy.policyInput({
    configuration,
    items: [item],
    active: [],
  }).items;
  const result = sent!.outcomes.findLast(
    (outcome) =>
      outcome.state === "verified" &&
      outcome.stage === "triage" &&
      outcome.itemVersion === sent!.itemVersion,
  );
  return result?.report.outcome === "not_actionable"
    ? Effect.succeed({ type: "none", reason: result.report.failure!, class: "not_actionable" })
    : decomposingPolicy(input);
};

it.effect(
  "Decompose/D6: a triage result names the text it read, so not_actionable waits only until the text changes",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(textBoundTriagePolicy);
          yield* seedIssue(7930, { body: "Make import and export idempotent." });
          const item = itemKeyFor(7930);
          const triage = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(triage, {
            outcome: "not_actionable",
            summary: "No bounded unit.",
            failure: "Splitting import from export is the owner's choice.",
          });
          // The policy can tell the result is for this text: it waits for a person, and says so.
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          const waiting = (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
            factoryId,
          })).lastCollection.find((record) => record.itemKey === item);
          assert.deepStrictEqual(
            [waiting?.disposition, waiting?.reasonClass],
            ["nothing_proposed", "not_actionable"],
          );
          // A person narrows the issue: that result is for older text, so the new text is triaged once.
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7930))!.body = "Make the import idempotent.";
          const second = admittedBy(yield* advance("tracker_event"));
          assert.deepStrictEqual(stageOf(second), [item, "triage"]);
          assert.notStrictEqual(admittedVersion(second), admittedVersion(triage));
        }),
      ),
    ),
);

/**
 * A policy that adopts a preparation only under the policy revision it was made for, from the
 * input its command receives: after a new revision is adopted, the item is prepared again.
 */
const revisionBoundPreparationPolicy: ProposeFn = (input) => {
  if (input.stage.type !== "implement") return stageRequest(input);
  const { configuration, ...item } = input;
  const [sent] = FactoryCommandPolicy.policyInput({
    configuration,
    items: [item],
    active: [],
  }).items;
  const latest = sent!.outcomes.findLast(
    (outcome) => outcome.stage === "triage" && outcome.itemVersion === sent!.itemVersion,
  );
  if (latest?.policyRevision !== configuration.policyRevision) return triageRequest(input);
  return latest.state === "verified" && latest.report.outcome === "unit_proposed"
    ? stageRequest(input)
    : Effect.succeed({ type: "none", reason: "preparation pending", class: "triage_pending" });
};

it.effect(
  "Decompose/D8: a preparation is adopted only under its policy revision and from a base T3 reads",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(revisionBoundPreparationPolicy);
          yield* seedIssue(7932, { body: "Make the CSV import idempotent." });
          const item = itemKeyFor(7932);
          const proposal = (basis: string, baseCommit: string) => ({
            outcome: "unit_proposed" as const,
            summary: "One unit: the importer.",
            proposal: {
              basis,
              unit: "## Owned files\n- src/importer.ts",
              ownedFiles: ["src/importer.ts"],
            },
            subject: { repository: claimRepository, baseCommit },
          });
          // An invented base is no preparation: nothing is built.
          const first = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(first, proposal(admittedVersion(first), "b0000099"));
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
          const [invented] = yield* outcomes.listForOrigin(first.reservation.reservationId);
          assert.strictEqual(
            invented?.state === "rejected" ? invented.rejection : invented?.state,
            "base b0000099 does not exist",
          );

          // A new policy revision prepares the item again, once; its own verified proposal is built.
          yield* configureFactory(lifecycleConfiguration({ policyRevision: "policy-r2" }));
          const second = admittedBy(yield* advance("clock", 1));
          assert.deepStrictEqual(stageOf(second), [item, "triage"]);
          assert.strictEqual(
            second.type === "admitted" && second.reservation.origin === "admitted"
              ? second.reservation.policyRevision
              : undefined,
            "policy-r2",
          );
          yield* workStage(second, proposal(admittedVersion(second), lifecycleBase));
          const implement = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(implement), [item, "implement"]);
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 2)), []);
        }),
      ),
    ),
);

/**
 * A policy that adopts its preparation as the candidate project policies do, from the input its
 * command receives: a triage result counts only for the triage decision T3 keyed on, and the build
 * names that result and starts at `launchAt` of its base.
 */
const preparedPolicy =
  (launchAt: (base: string) => string = (base) => base): ProposeFn =>
  (input) => {
    if (input.stage.type !== "implement") return stageRequest(input);
    const { configuration, ...item } = input;
    const [sent] = FactoryCommandPolicy.policyInput({
      configuration,
      items: [item],
      active: [],
    }).items;
    const current = sent!.outcomes.findLast(
      (outcome) => outcome.stage === "triage" && outcome.decisionKey === sent!.triageDecisionKey,
    );
    if (current === undefined) return triageRequest(input);
    if (current.state !== "verified" || current.report.outcome !== "unit_proposed") {
      return Effect.succeed({
        type: "none",
        reason: current.report.failure ?? current.report.summary,
        class: "not_actionable",
      });
    }
    const base = current.report.subject?.baseCommit ?? lifecycleBase;
    return Effect.map(stageRequest(input), (request) =>
      request === undefined || "type" in request
        ? request
        : {
            ...request,
            prepared: current.outcomeId,
            workspaceStrategy: {
              type: "worktree",
              baseRef: launchAt(base),
              startFromOrigin: false,
            },
          },
    );
  };

const lastDisposition = (issueNumber: number) =>
  Effect.gen(function* () {
    const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
    const record = state.lastCollection.find((entry) => entry.itemKey === itemKeyFor(issueNumber));
    return [record?.disposition, record?.reasonClass, record?.detail];
  });

const preparedUnit = (basis: string, baseCommit?: string) => ({
  outcome: "unit_proposed" as const,
  summary: "One unit: the importer.",
  proposal: { basis, unit: "## Owned files\n- src/importer.ts", ownedFiles: ["src/importer.ts"] },
  ...(baseCommit === undefined ? {} : { subject: { repository: claimRepository, baseCommit } }),
});

it.effect(
  "Decompose/D9: a prepared build starts only at its verified base, as read back at admission",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* recordCommit("b0000002", [lifecycleBase]);
          yield* recordCommit("c0000001", []);
          // The policy adopts the preparation but would launch the build somewhere else.
          yield* usePolicy(preparedPolicy(() => "b0000002"));
          yield* seedIssue(7933, { body: "Make the CSV import idempotent." });
          const item = itemKeyFor(7933);
          const triage = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(triage, preparedUnit(admittedVersion(triage), lifecycleBase));
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 3)), []);
          const [disposition, reasonClass, detail] = yield* lastDisposition(7933);
          assert.deepStrictEqual(
            [disposition, reasonClass],
            ["nothing_proposed", "prepared_stale"],
          );
          assert.match(
            `${detail}`,
            new RegExp(
              `^#7933 waits \\[[0-9a-f]{12}\\]: prepared unit is stale: the build would not start at \\S+'s prepared base ${lifecycleBase}\\. Actor: project policy\\. Action: start the build's worktree exactly at ${lifecycleBase}, not from origin\\..* Resume: `,
            ),
          );
          // Kept once from when it was first seen, however often it is decided again.
          const waitsOf = Effect.map(
            (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId }),
            (state) => state.waits.filter((wait) => wait.itemKey === item),
          );
          const [first] = yield* waitsOf;
          assert.strictEqual(first!.detail, detail);
          yield* TestClock.adjust("1 hour");
          for (const trigger of ["clock", "restart"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
          }
          assert.deepStrictEqual(yield* waitsOf, [first]);
          assert.deepStrictEqual(
            (yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).reservedDecisions(
              factoryId,
            )).filter((decision) => decision.itemKey === item),
            [],
          );

          // Launched at its base, but the integration line was moved off it since it was verified.
          yield* usePolicy(preparedPolicy());
          const graph = yield* GitGraphFake;
          graph.branches.set("main", "c0000001");
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
          const [, , moved] = yield* lastDisposition(7933);
          assert.include(
            `${moved}`,
            `prepared base ${lifecycleBase} no longer holds: base ${lifecycleBase} is not on the integration line refs/heads/main. Actor: T3 (preparation). Action: prepare the unit again on the item's current text, evidence and policy.`,
          );
          // The changed fact is another wait, superseding the first.
          const [second] = yield* waitsOf;
          assert.deepStrictEqual([second!.detail, second!.supersedes], [moved, first!.basis]);

          // Back on the line, the build starts at that exact base, once.
          graph.branches.set("main", "b0000002");
          const implement = admittedBy(yield* advance("clock", 1));
          assert.deepStrictEqual(stageOf(implement), [item, "implement"]);
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
          assert.deepStrictEqual(yield* waitsOf, []);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D9b: a failed preparation T3 cannot read back waits precisely, once, until it reads",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(preparedPolicy());
          // A candidate base off the integration line: T3 rejects the proposal at verification.
          yield* recordCommit("c0000009", []);
          yield* seedIssue(7937, { body: "Make the CSV import idempotent." });
          const item = itemKeyFor(7937);
          const triage = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(triage, preparedUnit(admittedVersion(triage), "c0000009"));
          yield* advance("outcome", 1);
          // The repository cannot be read when the failure is weighed: what it named cannot be.
          const graph = yield* GitGraphFake;
          graph.unreadable = true;
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome", 2)), []);
          const failed = (yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).itemEvents({
            factoryId,
            itemKey: item,
          })).findLast((event) => event.type === "outcome" && event.kind === "failed");
          assert.isDefined(failed);
          const failedId = failed!.type === "outcome" ? failed!.outcomeId : "";

          const [, reasonClass, detail] = yield* lastDisposition(7937);
          assert.strictEqual(reasonClass, "waiting");
          assert.include(`${detail}`, `its last preparation ${failedId} (failure `);
          assert.include(
            `${detail}`,
            "T3 could not read its candidate base c0000009 against refs/heads/main. Actor: T3 (git readback of the project repository). Action: read c0000009 and refs/heads/main back again; restore the project repository or that line if it is missing.",
          );
          const waitsOf = Effect.map(
            (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId }),
            (state) => state.waits.filter((wait) => wait.itemKey === item),
          );
          const [first] = yield* waitsOf;
          assert.strictEqual(first!.detail, detail);
          // Unchanged across time and a restart: one wait, first seen once, no question, no run.
          yield* TestClock.adjust("1 hour");
          for (const trigger of ["clock", "restart"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
          }
          assert.deepStrictEqual(yield* waitsOf, [first]);
          assert.deepStrictEqual(
            (yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).reservedDecisions(
              factoryId,
            )).filter((decision) => decision.itemKey === item),
            [],
          );
          // It reads again: the preparation is retried and the wait no longer stands.
          graph.unreadable = false;
          const retry = admittedBy(yield* advance("clock", 1));
          assert.deepStrictEqual(stageOf(retry), [item, "triage"]);
          assert.deepStrictEqual(yield* waitsOf, []);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D10: a rejected preparation is retried once, and new evidence prepares it once more",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(preparedPolicy());
          yield* seedIssue(7934, { body: "Make the CSV import idempotent." });
          const first = admittedBy(yield* advance("tracker_event", 1));
          const version = admittedVersion(first);
          // A proposal that names no base is no preparation: it is rejected.
          yield* workStage(first, preparedUnit(version));
          const retry = admittedBy(yield* advance("outcome", 3));
          const basisOf = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
            admission.type === "refused" || admission.reservation.origin !== "admitted"
              ? undefined
              : admission.reservation.stageBasis;
          assert.strictEqual(basisOf(first), `triage:${version}`);
          assert.isTrue(basisOf(retry)?.startsWith(`triage:${version}:retry:`));
          // The retry fails the same way: that is not retried again, however often a pass runs.
          yield* workStage(retry, preparedUnit(version));
          const starts = (yield* startedTurns).length;
          for (const trigger of ["outcome", "clock", "restart"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
          }
          assert.strictEqual((yield* startedTurns).length, starts);

          // A person supplies the missing evidence in a comment: a new decision, prepared once.
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7934))!.comments.push({
            id: fake.nextCommentId++,
            body: `Start the unit from ${lifecycleBase}, the integration head.`,
            user: { id: 42, login: "owner" },
            created_at: "2026-10-29T00:00:00Z",
          });
          const again = admittedBy(yield* advance("tracker_event", 1));
          assert.strictEqual(basisOf(again), `triage:${version}`);
          yield* workStage(again, preparedUnit(version, lifecycleBase));
          const implement = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(implement), [itemKeyFor(7934), "implement"]);
          assert.deepStrictEqual(admittedOnly(yield* advance("clock", 3)), []);
        }),
      ),
    ),
);

const admittedBasis = (admission: FactoryLifecycle.FactoryAdmissionResult) =>
  admission.type === "refused" || admission.reservation.origin !== "admitted"
    ? undefined
    : admission.reservation.stageBasis;

/** A preparation that names `base` fails twice while it is unavailable; nothing more runs after that. */
const exhaustPreparation = (issueNumber: number, base: string) =>
  Effect.gen(function* () {
    const first = admittedBy(yield* advance("tracker_event", 1));
    const version = admittedVersion(first);
    yield* workStage(first, preparedUnit(version, base));
    const retry = admittedBy(yield* advance("outcome", 3));
    assert.isTrue(admittedBasis(retry)?.startsWith(`triage:${version}:retry:`));
    yield* workStage(retry, preparedUnit(version, base));
    const starts = (yield* startedTurns).length;
    for (const trigger of ["outcome", "clock", "restart", "clock"] as const) {
      assert.deepStrictEqual(
        admittedOnly(yield* advance(trigger, 2)),
        [],
        `#${issueNumber} ${trigger}`,
      );
    }
    assert.strictEqual((yield* startedTurns).length, starts);
    return version;
  });

it.effect(
  "Decompose/D11: once its retry failed, a preparation is decided again exactly once when its candidate lands",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(preparedPolicy());
          yield* seedIssue(7935, { body: "Make the CSV import idempotent." });
          const version = yield* exhaustPreparation(7935, "b0000077");
          // The candidate lands on the integration line, with no edit to the issue or the policy.
          yield* recordCommit("b0000077", [lifecycleBase]);
          (yield* GitGraphFake).branches.set("main", "b0000077");
          const again = admittedBy(yield* advance("clock", 1));
          assert.isTrue(admittedBasis(again)?.includes(":after:"), admittedBasis(again));
          yield* workStage(again, preparedUnit(version, "b0000077"));
          const implement = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(implement), [itemKeyFor(7935), "implement"]);
          for (const trigger of ["clock", "restart"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
          }
        }),
      ),
    ),
);

it.effect(
  "Decompose/D12: once its retry failed, a preparation is decided again exactly once when its blocker closes",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(preparedPolicy());
          yield* seedIssue(7937, { labels: [], body: "The importer's schema." });
          yield* seedIssue(7936, {
            body: "Make the CSV import idempotent.",
            blockerNumbers: [7937],
          });
          yield* exhaustPreparation(7936, "b0000078");
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7937))!.state = "closed";
          const again = admittedBy(yield* advance("tracker_event", 1));
          assert.deepStrictEqual(stageOf(again), [itemKeyFor(7936), "triage"]);
          assert.isTrue(admittedBasis(again)?.includes(":after:"), admittedBasis(again));
          for (const trigger of ["clock", "restart"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
          }
        }),
      ),
    ),
);

/**
 * The first preparation names `first` (or ends without any result), and its retry names another
 * candidate `later` that exists off the integration line: both fail, and nothing more runs.
 */
const retryNamesLater = (issueNumber: number, first: string | undefined, later: string) =>
  Effect.gen(function* () {
    const triage = admittedBy(yield* advance("tracker_event", 1));
    const version = admittedVersion(triage);
    yield* workStage(triage, first === undefined ? undefined : preparedUnit(version, first));
    const retry = admittedBy(yield* advance("outcome", 3));
    assert.isTrue(admittedBasis(retry)?.startsWith(`triage:${version}:retry:`));
    yield* recordCommit(later, [lifecycleBase]);
    yield* workStage(retry, preparedUnit(version, later));
    const starts = (yield* startedTurns).length;
    for (const trigger of ["outcome", "clock", "restart", "clock"] as const) {
      assert.deepStrictEqual(
        admittedOnly(yield* advance(trigger, 2)),
        [],
        `#${issueNumber} ${trigger}`,
      );
    }
    assert.strictEqual((yield* startedTurns).length, starts);
    return version;
  });

/** `later` lands: one preparation at it and one build from it, then nothing more runs. */
const landsOnce = (issueNumber: number, version: string, later: string) =>
  Effect.gen(function* () {
    (yield* GitGraphFake).branches.set("main", later);
    const starts = (yield* startedTurns).length;
    const again = admittedBy(yield* advance("clock", 1));
    assert.deepStrictEqual(stageOf(again), [itemKeyFor(issueNumber), "triage"]);
    assert.isTrue(admittedBasis(again)?.includes(":after:"), admittedBasis(again));
    yield* workStage(again, preparedUnit(version, later));
    const implement = admittedBy(yield* advance("outcome"));
    assert.deepStrictEqual(stageOf(implement), [itemKeyFor(issueNumber), "implement"]);
    yield* startStage(implement);
    for (const trigger of ["clock", "restart", "clock"] as const) {
      assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
    }
    // One preparation and one build, the build at the landed candidate.
    assert.strictEqual((yield* startedTurns).length, starts + 2);
    if (again.type !== "admitted") throw new Error("Expected the preparation admitted");
    const prepared = yield* (yield* FactoryOutcomeStore.FactoryOutcomeStore).listForOrigin(
      again.reservation.reservationId,
    );
    assert.deepStrictEqual(
      prepared.map((outcome) => [outcome.state, outcome.report.subject?.baseCommit]),
      [["verified", later]],
    );
  });

it.effect(
  "Decompose/D13: a candidate first named by the retry of a preparation without a result is prepared once when it lands",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(preparedPolicy());
          yield* seedIssue(7938, { body: "Make the CSV import idempotent." });
          const version = yield* retryNamesLater(7938, undefined, "b0000079");
          yield* landsOnce(7938, version, "b0000079");
        }),
      ),
    ),
);

it.effect(
  "Decompose/D14: a candidate named by the retry instead of the first one is prepared once when it lands",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(preparedPolicy());
          yield* seedIssue(7939, { body: "Make the CSV import idempotent." });
          // The first names a candidate that never appears; only the retry's lands.
          const version = yield* retryNamesLater(7939, "b00000a1", "b0000080");
          yield* landsOnce(7939, version, "b0000080");
        }),
      ),
    ),
);

/**
 * The HSA policy's hold (connector #50), from the input its command receives: a build that
 * committed nothing and names something outside its worker, after a correction written on the same
 * text whose build did the same, waits for the owner or for the text to change.
 */
const prerequisitePolicy: ProposeFn = (input) => {
  if (input.stage.type !== "correct") return stageRequest(input);
  const { configuration, ...item } = input;
  const [sent] = FactoryCommandPolicy.policyInput({
    configuration,
    items: [item],
    active: [],
  }).items;
  const current = (outcome: NonNullable<typeof sent>["outcomes"][number] | undefined) =>
    outcome?.state === "verified" && outcome.itemVersion === sent!.itemVersion;
  const stoodStill = (outcome: NonNullable<typeof sent>["outcomes"][number] | undefined) =>
    current(outcome) &&
    outcome!.report.outcome === "failed" &&
    outcome!.report.failure?.startsWith("needs-owner:") === true;
  const [previous, failure] = sent!.outcomes
    .filter((outcome) => outcome.stage === "implement" || outcome.stage === "rework")
    .slice(-2);
  const spec = sent!.outcomes.findLast((outcome) => outcome.stage === "correct");
  return failure?.outcomeId === input.stage.outcomeId &&
    stoodStill(previous) &&
    stoodStill(failure) &&
    current(spec)
    ? Effect.succeed({
        type: "reserve",
        reason: "Another correction would repeat this failure.",
        evidenceDigest: sha256(failure!.report.failure!),
      })
    : stageRequest(input);
};

it.effect(
  "Decompose/D7: a failure that repeats on unchanged text waits, and an edit resumes its correction",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy(prerequisitePolicy);
          yield* seedIssue(7931, { body: "Flag statements end to end." });
          const item = itemKeyFor(7931);
          const blocked = (round: number) => ({
            outcome: "failed" as const,
            // Worded anew every round, as workers do: the failure's basis never repeats.
            failure: `needs-owner: the difference is not filed under #11 (round ${round})`,
            summary: "Nothing changed.",
          });
          yield* workStage(admittedBy(yield* advance("tracker_event", 1)), blocked(1));
          const correct = admittedBy(yield* advance("outcome"));
          yield* workStage(correct, { outcome: "correction_spec", summary: "File it under #11." });
          const rework = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(rework), [item, "rework"]);
          yield* workStage(rework, blocked(2));

          // Every result names the text it was admitted on, so the policy holds the third round.
          const starts = (yield* startedTurns).length;
          for (const trigger of ["outcome", "clock", "restart"] as const) {
            assert.deepStrictEqual(admittedOnly(yield* advance(trigger, 2)), []);
          }
          assert.strictEqual((yield* startedTurns).length, starts);
          const held = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
          assert.deepStrictEqual(
            held.reservedDecisions.map((decision) => [decision.itemKey, decision.state]),
            [[item, "pending"]],
          );

          // The prerequisite lands in the issue: new text, so the same failure is corrected again.
          const fake = yield* GitHubFake;
          fake.issues.get(issueKey(claimRepository, 7931))!.body =
            "Flag statements end to end. The difference is filed under #11.";
          const resumed = admittedBy(yield* advance("tracker_event"));
          assert.deepStrictEqual(stageOf(resumed), [item, "correct"]);
          assert.notStrictEqual(admittedVersion(resumed), admittedVersion(rework));
        }),
      ),
    ),
);

/**
 * A policy that answers a verified failure with a correction ticket, rewording it on every ask,
 * and never stops asking: the ticket's identity, not the policy, keeps it to one.
 */
const spawningPolicy =
  (issueNumber: number, wording: { count: number }): ProposeFn =>
  (input) => {
    if (input.stage.type !== "correct") return stageRequest(input);
    wording.count++;
    return Effect.succeed({
      type: "spawn",
      reason: "the verification found a product defect",
      ticket: {
        title: `Correct #${issueNumber}`,
        body: `Fix the importer's double count (wording ${wording.count}).`,
        labels: ["effort:medium"],
        parentIssueNumber: null,
        blocks: [issueNumber],
      },
    });
  };

it.effect(
  "Decompose/D4: a verified failure opens one correction ticket, however often or however worded",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          const wording = { count: 0 };
          yield* usePolicy(spawningPolicy(7904, wording));
          yield* seedIssue(7904);
          const github = yield* GitHubFake;
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(implement, {
            outcome: "failed",
            failure: "Verification failed: the importer counts a row twice.",
            summary: "Verification failed.",
          });
          // The create applies, but its answer is lost: the next attempt finds it by its marker.
          github.loseNextIssueCreate = true;
          yield* advance("outcome", 3);
          yield* TestClock.adjust("1 minute");
          yield* advance("operation", 3);
          yield* TestClock.adjust("1 minute");
          yield* advance("clock", 3);
          const tickets = [...github.issues.values()].filter(
            (issue) => issue.created !== undefined,
          );
          assert.strictEqual(tickets.length, 1);
          const [ticket] = tickets;
          assert.include(ticket!.body, "<!-- t3-factory-ticket:ticket:");
          assert.deepStrictEqual(ticket!.labels, ["effort:medium"]);
          assert.deepStrictEqual(
            github.issues.get(issueKey(claimRepository, 7904))!.blockerNumbers,
            [ticket!.number],
          );
          assert.include(yield* itemHistory(7904), "ticket_opened");
          assert.isAbove(wording.count, 1);
          assert.strictEqual(
            github.requests.filter(
              (request) => request.method === "POST" && request.path.endsWith("/issues"),
            ).length,
            1,
          );
        }),
      ),
    ),
);

/** A verified failure on a fresh item, then three passes a minute apart, as the operation retries. */
const failAndSpawn = (issueNumber: number, arrange: (github: GitHubFakeState) => void) =>
  Effect.gen(function* () {
    yield* configureLifecycleFactory;
    yield* usePolicy(spawningPolicy(issueNumber, { count: 0 }));
    yield* seedIssue(issueNumber);
    const github = yield* GitHubFake;
    const implement = admittedBy(yield* advance("tracker_event", 1));
    yield* workStage(implement, {
      outcome: "failed",
      failure: "Verification failed: the importer counts a row twice.",
      summary: "Verification failed.",
    });
    arrange(github);
    yield* advance("outcome", 3);
    yield* TestClock.adjust("1 minute");
    yield* advance("operation", 3);
    yield* TestClock.adjust("1 minute");
    yield* advance("clock", 3);
    const posts = (suffix: string) =>
      github.requests.filter(
        (request) => request.method === "POST" && request.path.endsWith(suffix),
      ).length;
    /** Issues GitHub created through the API, whatever happened to the answers. */
    const created = () => [...github.issues.values()].filter((issue) => issue.created).length;
    /** Searches for a ticket's marker: what a held create costs while it is looked for. */
    const listings = () =>
      github.requests.filter(
        (request) => request.method === "GET" && (request.query ?? "").includes("since="),
      ).length;
    return {
      github,
      posts,
      created,
      listings,
      ownerThreadId: admittedExecution(implement).threadId,
    };
  });

it.effect("Decompose/D4: a created ticket the listing does not show yet is not opened again", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        // The create answers, but the issue list lags it past the next attempt.
        const { posts } = yield* failAndSpawn(7908, (github) => {
          github.listingLags = true;
        });
        assert.strictEqual(posts("/issues"), 1);
        assert.include(yield* itemHistory(7908), "ticket_opened");
      }),
    ),
  ),
);

it.effect("Decompose/D4: a lost create is found though this host's clock runs ahead", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { posts } = yield* failAndSpawn(7909, (github) => {
          github.loseNextIssueCreate = true;
          github.clockBehindMs = 2 * 60_000;
        });
        assert.strictEqual(posts("/issues"), 1);
        assert.include(yield* itemHistory(7909), "ticket_opened");
      }),
    ),
  ),
);

it.effect("Decompose/D4: a relation GitHub refuses blocks the item with its answer, once", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { posts } = yield* failAndSpawn(7910, (github) => {
          github.refuseBlockedBy.add(7910);
        });
        assert.strictEqual(posts("/issues"), 1);
        assert.strictEqual(posts("/dependencies/blocked_by"), 1);
        assert.notInclude(yield* itemHistory(7910), "ticket_opened");
        const record = (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
          factoryId,
        })).lastCollection.find((entry) => entry.itemKey === itemKeyFor(7910));
        assert.strictEqual(record?.disposition, "blocked");
        assert.include(record?.detail ?? "", "as blocking #7910");
        assert.include(record?.detail ?? "", "synthetic validation refusal");
      }),
    ),
  ),
);

/** The item's native questions about a create that may have been sent. */
const ticketDecisions = (issueNumber: number) =>
  Effect.map(
    Effect.flatMap(FactoryOutcomeStore.FactoryOutcomeStore, (outcomes) =>
      outcomes.reservedDecisions(factoryId),
    ),
    (decisions) =>
      decisions.filter(
        (decision) => decision.itemKey === itemKeyFor(issueNumber) && decision.stage === "ticket",
      ),
  );

const passesAfter = (minutes: number) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(`${minutes} minutes`);
    yield* advance("clock", 3);
  });

it.effect(
  "Decompose/D4: a process lost after GitHub created the ticket never creates another; the owner is asked until it is found",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { github, created } = yield* failAndSpawn(7913, (github) => {
            github.listingLags = true;
            github.processLossAtNextIssueCreate = "after";
          });
          // Retried at once, as after a restart, and again each minute: the listing still lags.
          assert.strictEqual(created(), 1);
          const [asked] = yield* ticketDecisions(7913);
          assert.strictEqual(asked?.state, "pending");
          assert.include(asked?.reason ?? "", "<!-- t3-factory-ticket:ticket:");
          assert.strictEqual(yield* dispositionOf(7913), "blocked");
          // Once GitHub lists it, it is the ticket, and the question is moot.
          github.unlistedIssues.clear();
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(created(), 1);
          assert.include(yield* itemHistory(7913), "ticket_opened");
          assert.strictEqual((yield* ticketDecisions(7913))[0]?.state, "superseded");
        }),
      ),
    ),
);

const answerTicket = (decisionId: string, answer: string) =>
  Effect.flatMap(FactoryLifecycle.FactoryLifecycle, (factory) =>
    factory.resolveReservedDecision({ factoryId, decisionId, answer, by: "owner" }),
  );

const pendingTicketDecisions = (issueNumber: number) =>
  Effect.map(ticketDecisions(issueNumber), (decisions) =>
    decisions.filter((decision) => decision.state === "pending"),
  );

it.effect(
  "Decompose/D4: a process lost before the create was sent creates again only on the owner's approval; any other answer asks again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { created } = yield* failAndSpawn(7914, (github) => {
            github.processLossAtNextIssueCreate = "before";
          });
          // T3 cannot tell this from a create GitHub applied: it asks rather than create again.
          assert.strictEqual(created(), 0);
          const [asked] = yield* pendingTicketDecisions(7914);
          assert.isTrue(yield* answerTicket(asked!.decisionId, "not sure yet"));
          yield* advance("owner_decision", 3);
          yield* passesAfter(1);
          // Only "approve" sends it; any other answer leaves it held and asks again.
          assert.strictEqual(created(), 0);
          const again = yield* pendingTicketDecisions(7914);
          assert.strictEqual(again.length, 1);
          assert.notStrictEqual(again[0]!.decisionId, asked!.decisionId);
          assert.include(again[0]!.reason, "not sure yet");
          assert.isTrue(yield* answerTicket(again[0]!.decisionId, "approve"));
          yield* advance("owner_decision", 3);
          yield* passesAfter(1);
          assert.strictEqual(created(), 1);
          assert.include(yield* itemHistory(7914), "ticket_opened");
          assert.deepStrictEqual(yield* pendingTicketDecisions(7914), []);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D4: a create whose answer is lost is not sent again; a declined question is asked again until the issue is found",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { github, created } = yield* failAndSpawn(7915, (github) => {
            github.listingLags = true;
            github.loseNextIssueCreate = true;
          });
          assert.strictEqual(created(), 1);
          const [asked] = yield* pendingTicketDecisions(7915);
          yield* answerTicket(asked!.decisionId, "decline");
          yield* advance("owner_decision", 3);
          yield* passesAfter(1);
          assert.strictEqual(created(), 1);
          assert.strictEqual(yield* dispositionOf(7915), "blocked");
          assert.strictEqual((yield* pendingTicketDecisions(7915)).length, 1);
          // GitHub lists it at last: it is the ticket, and nothing is left to answer.
          github.unlistedIssues.clear();
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(created(), 1);
          assert.include(yield* itemHistory(7915), "ticket_opened");
          assert.deepStrictEqual(yield* pendingTicketDecisions(7915), []);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D4: a transient error while a create is held keeps its question answerable",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { github, created } = yield* failAndSpawn(7916, (github) => {
            github.listingLags = true;
            github.processLossAtNextIssueCreate = "after";
          });
          const [asked] = yield* pendingTicketDecisions(7916);
          github.failNextMarkerListing = true;
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(created(), 1);
          assert.deepStrictEqual(
            (yield* pendingTicketDecisions(7916)).map((decision) => decision.decisionId),
            [asked!.decisionId],
          );
        }),
      ),
    ),
);

it.effect("Decompose/D4: an approved create in flight raises no question of its own", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { github, created } = yield* failAndSpawn(7917, (github) => {
          github.processLossAtNextIssueCreate = "before";
        });
        const [asked] = yield* pendingTicketDecisions(7917);
        const reached = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        github.beforeIssueCreate = Deferred.succeed(reached, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        yield* answerTicket(asked!.decisionId, "approve");
        const sending = yield* Effect.forkScoped(
          Effect.andThen(advance("owner_decision", 1), passesAfter(1)),
        );
        yield* Deferred.await(reached);
        // A pass while the approved create is in flight has nothing to ask about it yet.
        yield* reconcileFactory("operation");
        assert.deepStrictEqual(yield* pendingTicketDecisions(7917), []);
        github.beforeIssueCreate = undefined;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(sending);
        yield* passesAfter(1);
        assert.strictEqual(created(), 1);
        assert.include(yield* itemHistory(7917), "ticket_opened");
      }),
    ),
  ),
);

const stopAskingForTickets = usePolicy((input) =>
  input.stage.type === "correct"
    ? Effect.succeed({ type: "none", reason: "held by the owner", class: "held" })
    : stageRequest(input),
);

const ticketOperation = (issueNumber: number) =>
  Effect.gen(function* () {
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    return (yield* operations.forItem({ factoryId, itemKey: itemKeyFor(issueNumber) })).find(
      (operation) => operation.intent.kind === "tracker_create_issue",
    );
  });

it.effect(
  "Decompose/D4: a declined create is no longer looked for once the policy stops asking for it",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { created, listings } = yield* failAndSpawn(7919, (github) => {
            github.listingLags = true;
            github.processLossAtNextIssueCreate = "after";
          });
          const [asked] = yield* pendingTicketDecisions(7919);
          yield* answerTicket(asked!.decisionId, "decline");
          yield* stopAskingForTickets;
          yield* passesAfter(1);
          const searched = listings();
          yield* passesAfter(1);
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(listings(), searched);
          assert.strictEqual(created(), 1);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D4: the owner abandons a create nobody can find from its card; nothing is sent or looked for again",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { created, listings, ownerThreadId } = yield* failAndSpawn(7920, (github) => {
            github.listingLags = true;
            github.processLossAtNextIssueCreate = "after";
          });
          yield* configureFactory(lifecycleConfiguration({ ownerThreadId }));
          yield* passesAfter(1);
          const [asked] = yield* pendingTicketDecisions(7920);
          const card = (yield* factoryCards(ownerThreadId)).find((candidate) =>
            candidate.request.id.includes(asked!.decisionId),
          );
          const questions = card?.item?.type === "user_input_request" ? card.item.questions : [];
          assert.deepStrictEqual(
            questions[0]?.options.map((option) => option.value),
            ["approve", "abandon"],
          );
          const factory = yield* FactoryLifecycle.FactoryLifecycle;
          yield* factory.answerCard({
            threadId: ownerThreadId,
            requestId: card!.request.id,
            answers: { decision: "Abandon" },
            by: "session:owner:1",
          });
          yield* passesAfter(1);
          const searched = listings();
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(listings(), searched);
          assert.strictEqual(created(), 1);
          const ticket = yield* ticketOperation(7920);
          assert.strictEqual(ticket?.state, "failed");
          assert.include(ticket?.state === "failed" ? ticket.reason : "", "abandoned");
          assert.strictEqual(yield* dispositionOf(7920), "blocked");
          assert.deepStrictEqual(yield* pendingTicketDecisions(7920), []);
        }),
      ),
    ),
);

it.effect(
  'Decompose/D4: over MCP only "abandon" abandons a held create, and other text is neither that nor permission',
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { created } = yield* failAndSpawn(7921, (github) => {
            github.processLossAtNextIssueCreate = "before";
          });
          const [asked] = yield* pendingTicketDecisions(7921);
          yield* answerTicket(asked!.decisionId, "maybe abandon it later");
          yield* passesAfter(1);
          const [again] = yield* pendingTicketDecisions(7921);
          assert.notStrictEqual(again?.decisionId, asked!.decisionId);
          assert.strictEqual((yield* ticketOperation(7921))?.state, "intended");
          yield* answerTicket(again!.decisionId, "abandon");
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(created(), 0);
          assert.strictEqual((yield* ticketOperation(7921))?.state, "failed");
          assert.deepStrictEqual(yield* pendingTicketDecisions(7921), []);
        }),
      ),
    ),
);

it.effect("Decompose/D4: an approval given after the item's issue closed sends nothing", () =>
  runIsolated(
    Effect.scoped(
      Effect.gen(function* () {
        const { github, created, listings } = yield* failAndSpawn(7922, (github) => {
          github.processLossAtNextIssueCreate = "before";
        });
        const [asked] = yield* pendingTicketDecisions(7922);
        github.issues.get(issueKey(claimRepository, 7922))!.state = "closed";
        yield* passesAfter(1);
        yield* answerTicket(asked!.decisionId, "approve");
        yield* advance("owner_decision", 3);
        yield* passesAfter(1);
        const searched = listings();
        yield* passesAfter(1);
        yield* passesAfter(1);
        assert.strictEqual(created(), 0);
        assert.strictEqual(listings(), searched);
      }),
    ),
  ),
);

it.effect(
  "Decompose/D4: after a restart a held create is neither looked for nor sent until its ticket is asked for",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { created, listings } = yield* failAndSpawn(7923, (github) => {
            github.listingLags = true;
            github.processLossAtNextIssueCreate = "after";
          });
          yield* stopAskingForTickets;
          yield* passesAfter(1);
          yield* (yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService).recover;
          const searched = listings();
          yield* advance("restart", 3);
          yield* passesAfter(1);
          yield* passesAfter(1);
          assert.strictEqual(listings(), searched);
          assert.strictEqual(created(), 1);
          assert.strictEqual((yield* pendingTicketDecisions(7923)).length, 1);
        }),
      ),
    ),
);

it.effect(
  "Decompose/D4: a question about a create ends with its operation, whatever the policy asks",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { github } = yield* failAndSpawn(7918, (github) => {
            github.listingLags = true;
            github.processLossAtNextIssueCreate = "after";
            github.refuseBlockedBy.add(7918);
          });
          const [asked] = yield* pendingTicketDecisions(7918);
          // The policy stops asking for the ticket; the issue is then found and its relation refused.
          yield* usePolicy((input) =>
            input.stage.type === "correct"
              ? Effect.succeed({ type: "none", reason: "held by the owner", class: "held" })
              : stageRequest(input),
          );
          github.unlistedIssues.clear();
          yield* passesAfter(1);
          yield* passesAfter(1);
          const operations = yield* FactoryOperationStore.FactoryOperationStore;
          const ticket = (yield* operations.forItem({ factoryId, itemKey: itemKeyFor(7918) })).find(
            (operation) => operation.intent.kind === "tracker_create_issue",
          );
          assert.strictEqual(ticket?.state, "failed");
          assert.strictEqual(
            (yield* ticketDecisions(7918)).find((d) => d.decisionId === asked!.decisionId)?.state,
            "superseded",
          );
        }),
      ),
    ),
);

it.effect(
  "Decompose/D4: a create whose confirmation read fails is continued, not repeated, while the listing lags",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { github, posts } = yield* failAndSpawn(7911, (github) => {
            github.listingLags = true;
            github.failNextIssueRead.add(github.nextIssueNumber);
          });
          assert.strictEqual(posts("/issues"), 1);
          const operations = yield* FactoryOperationStore.FactoryOperationStore;
          const ticket = (yield* operations.forItem({ factoryId, itemKey: itemKeyFor(7911) })).find(
            (operation) => operation.intent.kind === "tracker_create_issue",
          );
          assert.strictEqual(ticket?.state, "applied");
          assert.strictEqual(ticket?.createdIssue?.number, 8000);
          assert.deepStrictEqual(
            github.issues.get(issueKey(claimRepository, 7911))!.blockerNumbers,
            [8000],
          );
          assert.include(yield* itemHistory(7911), "ticket_opened");
        }),
      ),
    ),
);

it.effect(
  "Decompose/D4: a create whose relation answer is lost is continued, not repeated, while the listing lags",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          const { github, posts } = yield* failAndSpawn(7912, (github) => {
            github.listingLags = true;
            github.loseNextBlockedBy = true;
          });
          assert.strictEqual(posts("/issues"), 1);
          assert.deepStrictEqual(
            github.issues.get(issueKey(claimRepository, 7912))!.blockerNumbers,
            [8000],
          );
          assert.include(yield* itemHistory(7912), "ticket_opened");
        }),
      ),
    ),
);

it.effect(
  "Decompose/D5: the pass metric counts the policy's own reasons, and nothing is started for them",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* usePolicy((input) =>
            Effect.succeed(
              input.issue.title === "Issue 7905"
                ? { type: "none", reason: "no unit spec yet", class: "needs_routing" }
                : { type: "none", reason: "held by the owner", class: "held" },
            ),
          );
          yield* seedIssue(7905);
          yield* seedIssue(7906);
          assert.deepStrictEqual(admittedOnly(yield* advance("tracker_event", 1)), []);
          const state = yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({ factoryId });
          assert.deepStrictEqual(
            state.lastCollection
              .filter(
                (record) =>
                  record.itemKey === itemKeyFor(7905) || record.itemKey === itemKeyFor(7906),
              )
              .map((record) => [record.itemKey, record.disposition, record.reasonClass]),
            [
              [itemKeyFor(7905), "nothing_proposed", "needs_routing"],
              [itemKeyFor(7906), "nothing_proposed", "held"],
            ],
          );
          assert.deepStrictEqual(state.lastPassMetrics?.byReasonClass, {
            needs_routing: 1,
            held: 1,
          });
          assert.strictEqual(state.lastPassMetrics?.admitted, 0);
          assert.strictEqual((yield* startedTurns).length, 0);
        }),
      ),
    ),
);

it.effect(
  "Lifecycle/R5: a correction that fails the same way again is not decided again, and says why",
  () =>
    runIsolated(
      Effect.scoped(
        Effect.gen(function* () {
          yield* configureLifecycleFactory;
          yield* seedIssue(7907);
          const implement = admittedBy(yield* advance("tracker_event", 1));
          yield* workStage(implement, {
            outcome: "failed",
            failure: "Verification failed: the export drops a row.",
            summary: "Verification failed.",
          });
          const blocked = "needs-owner: publication. The protected merge has not landed.";
          const correct = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(correct), [itemKeyFor(7907), "correct"]);
          yield* workStage(correct, {
            outcome: "failed",
            failure: blocked,
            summary: "Cannot correct.",
          });
          // The first such failure is retried once, on its own basis.
          const retry = admittedBy(yield* advance("outcome"));
          assert.deepStrictEqual(stageOf(retry), [itemKeyFor(7907), "correct"]);
          yield* workStage(retry, {
            outcome: "failed",
            failure: blocked,
            summary: "Cannot correct.",
          });
          // The same failure again is the same basis: nothing new starts, and the item says why.
          assert.deepStrictEqual(admittedOnly(yield* advance("outcome")), []);
          const record = (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
            factoryId,
          })).lastCollection.find((entry) => entry.itemKey === itemKeyFor(7907));
          assert.strictEqual(record?.disposition, "existing");
          assert.include(record?.detail ?? "", "its last correct failed: needs-owner: publication");
        }),
      ),
    ),
);

// A collection pass can land between a background command's end and the run of the wake it
// starts. The wake is then known only to the provider's runtime, which the probe asks.

const sessionLiveOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projection = yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(threadId);
    const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
    return yield* sessions.isLive(projection.providerThreads[0]!.providerSessionId!);
  });

const noResultsOf = (reservationId: FactoryReservationId) =>
  Effect.map(
    Effect.flatMap(FactoryOutcomeStore.FactoryOutcomeStore, (outcomes) =>
      outcomes.listForOrigin(reservationId),
    ),
    (filed) => filed.filter((outcome) => outcome.outcomeId.startsWith("no-result:")),
  );

/** The wake's continuation dispatched, and its provider turn started if the fence admits it. */
const deliverWake = (threadId: ThreadId, label: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const startedBefore = (yield* startedTurns).length;
      const running = yield* awaitRunningTurn(threadId);
      yield* dispatchProviderContinuation(threadId, label);
      yield* runEffects;
      const starts = (yield* startedTurns).length - startedBefore;
      // A refused wake starts nothing, so nothing will report running.
      if (starts > 0) yield* Fiber.join(running);
      const wake = yield* runOrdinal(threadId, 2);
      return {
        status: wake.status,
        starts,
        signals: yield* signalItemsOf(threadId, wake.id),
        ownContainers: yield* generationFactsOf(wake.id),
      };
    }),
  );

/**
 * The session's CLI process, joined to the execution's container: `onExit` runs once, when a pass
 * awaits its exit, which it does only after closing the session.
 */
const joinSessionProcess = (
  run: { readonly id: RunId },
  sessionId: string,
  onExit: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    let exited = false;
    const ticket = yield* generations.joinFor(run.id, { providerSessionId: sessionId })(
      "scripted-provider",
      [],
      "provider",
    );
    yield* ticket.admit(
      2,
      Effect.suspend(() => {
        if (exited) return Effect.void;
        exited = true;
        return onExit;
      }),
    );
  });

/** Its processes leave the run's container, as the closed CLI's do when they exit. */
const emptyContainer = (runId: RunId) =>
  Effect.gen(function* () {
    const fake = yield* ContainmentFake;
    const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    const names = (yield* generations.generations(runId)).map((generation) => generation.name);
    return Effect.sync(() => {
      for (const name of names) fake.members.set(name, 0);
    });
  });

it.effect(
  "Custody/EXP58b: a pass between a background command's end and its wake's run leaves the session to deliver it",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId, sessionId } = yield* backgroundExecution(7398);
        const [own] = yield* generationFactsOf(run.id);
        // The command finishes: the CLI empties its roster and begins the wake no run records yet.
        (yield* ScriptedPendingWork).answer = "pending";
        yield* setRoster(execution.threadId, []);
        assert.deepStrictEqual(yield* custodyOfReservation(execution), {
          state: "live",
          reasons: ["contained_processes"],
        });
        assert.isTrue(yield* sessionLiveOf(execution.threadId));
        yield* collectIssues([], "clock");
        const liveAfterPass = yield* sessionLiveOf(execution.threadId);
        const wake = yield* deliverWake(execution.threadId, "wake-7398");
        assert.deepStrictEqual(
          { liveAfterPass, ...wake },
          { liveAfterPass: true, status: "running", starts: 1, signals: [], ownContainers: [] },
        );
        // It runs in the session's process, inside the execution's container.
        assert.deepStrictEqual(own?.providerSessions, [sessionId]);
        assert.deepStrictEqual(yield* generationFactsOf(run.id), [own]);
        yield* collectIssues([], "clock");
        assert.deepStrictEqual(yield* noResultsOf(reservationId), []);
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
      }),
    ),
);

it.effect(
  "Custody/EXP58: a wake dispatched with no pass after the roster empties starts once in its session",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run } = yield* backgroundExecution(7399);
        const [own] = yield* generationFactsOf(run.id);
        yield* setRoster(execution.threadId, []);
        assert.deepStrictEqual(yield* deliverWake(execution.threadId, "wake-7399"), {
          status: "running",
          starts: 1,
          signals: [],
          ownContainers: [],
        });
        assert.deepStrictEqual(yield* generationFactsOf(run.id), [own]);
      }),
    ),
);

it.effect(
  "Custody/EXP58: a genuinely idle session is closed, its exit awaited, and one missing result filed",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId, sessionId } = yield* backgroundExecution(7581);
        const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
        const empty = yield* emptyContainer(run.id);
        const liveAtExit: Array<boolean> = [];
        yield* joinSessionProcess(
          run,
          sessionId,
          Effect.flatMap(sessions.isLive(sessionId), (live) =>
            Effect.andThen(
              Effect.sync(() => liveAtExit.push(live)),
              empty,
            ),
          ),
        );
        yield* setRoster(execution.threadId, []);
        yield* collectIssues([], "clock");
        assert.deepStrictEqual(liveAtExit, [false]);
        assert.isFalse(yield* sessionLiveOf(execution.threadId));
        const [missing, ...more] = yield* noResultsOf(reservationId);
        assert.deepStrictEqual(more, []);
        assert.include(
          missing?.report.failure ?? "",
          "execution ended (completed) without a verified result",
        );
        yield* collectIssues([], "clock");
        assert.lengthOf(yield* noResultsOf(reservationId), 1);
      }),
    ),
);

it.effect.each(["pending", "fails"] as const)(
  "Custody/EXP58: a session whose probe answers %s is not closed and nothing is filed",
  (answer) =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId, sessionId } = yield* backgroundExecution(7582);
        const exits: Array<string> = [];
        yield* joinSessionProcess(
          run,
          sessionId,
          Effect.sync(() => exits.push("exited")),
        );
        (yield* ScriptedPendingWork).answer = answer;
        yield* setRoster(execution.threadId, []);
        for (let pass = 0; pass < 2; pass++) {
          yield* collectIssues([], "clock");
          yield* runEffects;
        }
        assert.isTrue(yield* sessionLiveOf(execution.threadId));
        assert.deepStrictEqual(exits, []);
        assert.deepStrictEqual(yield* noResultsOf(reservationId), []);
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
      }),
    ),
);

it.effect(
  "Custody/EXP58: a wake recorded while the pass closes its session is owed, not a missing result",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId, sessionId } = yield* backgroundExecution(7584);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const empty = yield* emptyContainer(run.id);
        // The probe saw nothing. While the closed CLI exits, its wake is recorded and refused,
        // then its processes leave the container.
        yield* joinSessionProcess(
          run,
          sessionId,
          Effect.gen(function* () {
            yield* dispatchProviderContinuation(execution.threadId, "wake-7584").pipe(
              Effect.provideService(Orchestrator.OrchestratorV2, orchestrator),
              Effect.orDie,
            );
            yield* worker.drain().pipe(Effect.orDie);
            yield* empty;
          }),
        );
        yield* setRoster(execution.threadId, []);
        yield* collectIssues([], "clock");
        assert.deepStrictEqual(yield* noResultsOf(reservationId), []);
        const refused = yield* runOrdinal(execution.threadId, 2);
        assert.deepStrictEqual(yield* signalItemsOf(execution.threadId, refused.id), [
          `turn-item:run:${encodeURIComponent(refused.id)}:signal:factory-custody-unknown`,
        ]);
        // The execution is quiet: the refused wake is delivered again, once.
        yield* collectIssues([], "clock");
        yield* runEffects;
        assert.deepStrictEqual(yield* noResultsOf(reservationId), []);
        assert.strictEqual(yield* runCount(execution.threadId), 3);
        assert.include(["starting", "running"], (yield* runOrdinal(execution.threadId, 3)).status);
      }),
    ),
);

it.effect(
  "Custody/EXP58: a verified outcome does not release its stage by closing a session mid-wake",
  () =>
    runIsolated(
      Effect.gen(function* () {
        const { execution, run, reservationId, sessionId } = yield* backgroundExecution(7585);
        const exits: Array<string> = [];
        yield* joinSessionProcess(
          run,
          sessionId,
          Effect.sync(() => exits.push("exited")),
        );
        (yield* ScriptedPendingWork).answer = "pending";
        yield* setRoster(execution.threadId, []);
        yield* reportFrom(execution.threadId, {
          outcome: "failed",
          failure: "The focused tests failed.",
          summary: "Tests failed.",
        });
        // One pass writes the report's tracker record; the next reads it back and verifies.
        for (let pass = 0; pass < 2; pass++) {
          yield* collectIssues([], "outcome");
          yield* runEffects;
        }
        const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
        assert.deepStrictEqual(
          (yield* outcomes.listForOrigin(reservationId)).map((outcome) => outcome.state),
          ["verified"],
        );
        assert.isTrue(yield* sessionLiveOf(execution.threadId));
        assert.deepStrictEqual(exits, []);
        assert.strictEqual((yield* reservationOf(reservationId))?.state, "held");
      }),
    ),
);
