// @effect-diagnostics nodeBuiltinImport:off - sha256 of test fixtures.
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
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
  ScheduledTaskId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
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
import * as ProviderTurnStartServiceTestkit from "../orchestration-v2/ProviderTurnStartService.testkit.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import {
  GitHubPullRequestApi,
  GitHubRequestPolicy,
  GitHubRest,
} from "@t3tools/source-control-github/server/api";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import * as ExecutionJoin from "@t3tools/shared/ExecutionJoin";
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
 * session is recorded; `skip` not at all, for a process that started outside every container.
 */
class ScriptedJoinTarget extends Context.Service<
  ScriptedJoinTarget,
  { legacy: boolean; skip: boolean }
>()("t3/factory/FactoryLifecycle.test/ScriptedJoinTarget") {}
const layerScriptedJoinTarget = Layer.sync(ScriptedJoinTarget, () => ({
  legacy: false,
  skip: false,
}));

const scriptedSession = (
  instanceId: ProviderInstanceId,
  capabilities: OrchestrationV2ProviderCapabilities,
  starts: ProviderStarts["Service"],
  steers: ProviderSteers["Service"],
  sessionDriver: ProviderDriverKind,
  executionJoin: ExecutionJoin.ExecutionJoinShape | undefined,
  joinTarget: ScriptedJoinTarget["Service"] | undefined,
): ProviderAdapter.ProviderAdapterV2["Service"]["openSession"] =>
  Effect.fnUntraced(function* (input) {
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
    return {
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
}

/**
 * An in-memory GitHub issue tracker behind the real `GitHubRest` interface. Every create makes a
 * new comment, as GitHub does; there is no compare-and-set or idempotency key.
 */
interface GitHubFakeState {
  readonly issues: Map<string, FakeIssue>;
  readonly requests: Array<{ readonly method: string; readonly path: string }>;
  readonly outcomes: Array<CreateOutcome>;
  /** Runs inside a create before it applies, so a test can land a foreign claim first. */
  beforeCreate: Effect.Effect<void> | undefined;
  /** Runs before a comment is read by id, so a test can stop the reader there. */
  beforeCommentRead: Effect.Effect<void> | undefined;
  /** Runs before an issue is read, so a test can hold a collection pass there. */
  beforeIssueRead: Effect.Effect<void> | undefined;
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
  /** Status contexts branch protection requires before a pull request is clean. */
  readonly requiredContexts: Set<string>;
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
  /** Set to make the policy fail a whole pass, as a broken pin or rules adoption would. */
  failAll: string | undefined;
  /** The work under way each pass showed the policy, latest last. */
  readonly active: Array<ReadonlyArray<FactoryLifecycle.FactoryPolicyActive>>;
}

type ProposeFn = Parameters<typeof FactoryLifecycle.perItemPolicy>[0];

class PolicyFake extends Context.Service<PolicyFake, PolicyFakeState>()(
  "t3/factory/FactoryLifecycle.test/PolicyFake",
) {}

const layerPolicyFake = Layer.effect(
  PolicyFake,
  Effect.sync((): PolicyFakeState => ({
    available: true,
    revisions: [],
    propose: (input) => proposeImplementation(input),
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
      const perItem = FactoryLifecycle.perItemPolicy((input) => fake.propose(input));
      return Option.some<FactoryLifecycle.FactoryAdmissionProposer>({
        decide: (input) => {
          fake.active.push(input.active);
          return fake.failAll === undefined
            ? perItem.decide(input)
            : Effect.succeed({ type: "policy_failed", reason: fake.failAll });
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
    slowIssues: new Set(),
    nextCommentId: 1000,
    pulls: new Map(),
    remoteBranches: new Map(),
    checks: new Map(),
    loseNextMerge: false,
    nextPullNumber: 9000,
    statuses: new Map(),
    requiredContexts: new Set(),
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
    const refused = (operation: string, status: number) =>
      new GitHubRequestPolicy.GitHubApiResponseError({ host: "github.com", operation, status });
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
      rest: (input) =>
        Effect.gen(function* () {
          const method = input.method ?? "GET";
          const path = input.path.split("?")[0]!;
          fake.requests.push({ method, path });
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
          if (issueMatch[3] === "/labels") return ok(issue.labels.map((name) => ({ name })));
          if (issueMatch[3] === undefined && method === "PATCH") {
            const patch = input.body as { readonly state?: "open" | "closed" };
            if (patch.state !== undefined) issue.state = patch.state;
            return ok({ number: issue.number, state: issue.state });
          }
          if (issueMatch[3] === undefined) {
            if (fake.slowIssues.has(issue.number)) return yield* Effect.never;
            if (fake.beforeIssueRead !== undefined) yield* fake.beforeIssueRead;
            return ok({
              number: issue.number,
              state: issue.state,
              title: issue.title,
              body: issue.body,
              labels: issue.labels.map((name) => ({ name })),
            });
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
const layerGitHubPullRequestApiFake = Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({
  withVerifiedCredential: (_input, use) =>
    use({
      accountId: String(factoryAccount.id),
      viewer: factoryAccount.login,
      credentialFingerprint: "fingerprint:t3-factory",
    }),
});

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

const makeLayerRuntime = (continueAfterRestart: boolean) =>
  Layer.mergeAll(RuntimeLayer.layer, RuntimeLayer.layerEventSink).pipe(
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
    const resolve = (ref: string) => graph.branches.get(ref) ?? ref;
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
    return FactoryGitReadback.FactoryGitReadback.of({
      commitExists: (input) => Effect.succeed(graph.parents.has(input.commit)),
      isAncestor: (input) => Effect.succeed(ancestors(input.descendant).has(input.ancestor)),
      parentsOf: (input) => Effect.succeed(graph.parents.get(input.commit) ?? []),
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

// One in-memory database backs the runtime, the factory and the rows this test reads back.
const makeLayerTest = (options: TestRuntimeOptions = {}) => {
  const layerContainmentFake = makeLayerContainmentFake(options.contained ?? true);
  return FactoryLifecycle.layer
    .pipe(
      Layer.provideMerge(layerAdmissionPolicy),
      Layer.provideMerge(layerPolicyFake),
      Layer.provideMerge(
        Layer.mergeAll(
          FactoryClaimStore.layer.pipe(Layer.provideMerge(FactoryStore.layer)),
          FactoryOutcomeStore.layer,
          FactoryOperationStore.layer,
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
    const claimed = yield* outbox.claimNext({ workerId: "worker:test", leaseDurationMs: 60_000 });
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
          leaseDurationMs: 60_000,
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
// thread it selects as context. These call the real MCP t3_thread_fork tool.

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

/** An agent in `callerThreadId` forks `sourceThreadId` at `runId` through t3_thread_fork. */
const forkThroughTool = (callerThreadId: ThreadId, sourceThreadId: ThreadId, runId: RunId) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({
      name: "t3_thread_fork",
      arguments: { threadId: sourceThreadId, sourcePoint: { type: "run", runId } },
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
      const decisionKey = Option.getOrThrow(
        yield* factory.decisionKeyFor({
          factoryId,
          itemKey: itemKeyOf(itemKey),
          taskKind: "implement",
          policyRevision: "policy-r1",
          basis,
        }),
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
    const next = yield* outbox.claimNext({ workerId: "test:retired", leaseDurationMs: 60_000 });
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
          leaseDurationMs: 60_000,
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

/** A collection pass under a later generation reads the issue as it is now and records it. */
const recordLaterRead = (issueNumber: number, issue: FakeIssue) =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const generation = yield* store.beginCollection(factoryId);
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
          const replay = Option.getOrThrow(
            yield* outbox.claimNext({ workerId: "worker:test", leaseDurationMs: 60_000 }),
          );
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
      event.type === "admitted" ? event.stage : event.type === "rejected" ? "rejected" : event.kind,
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

          // The owner reopens an issue T3 closed. The item says so, never "done", and T3
          // neither closes it again nor starts its lineage over; its history stays as it was.
          (yield* GitHubFake).issues.get(issueKey(claimRepository, 7001))!.state = "open";
          assert.deepStrictEqual(yield* advance("tracker_event", 1), []);
          assert.strictEqual(yield* dispositionOf(7001), "reopened");
          const reopened = (yield* (yield* FactoryLifecycle.FactoryLifecycle).readState({
            factoryId,
          })).lastCollection.find((record) => record.itemKey === itemKeyFor(7001));
          assert.include(reopened?.detail ?? "", "open after T3 closed it");
          assert.strictEqual(yield* closeRequests, 1);
          assert.strictEqual((yield* itemHistory(7001)).at(-1), "closed");
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

const detachedSessionsOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const throughSequence = yield* sink.latestSequence({ threadId });
    return yield* sink
      .read({ threadId, throughSequence, eventType: "provider-session.detached" })
      .pipe(
        Stream.runCollect,
        Effect.map((events) => Array.from(events).length),
      );
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
          const native = admittedBy(yield* advance("owner_decision", 1));
          assert.deepStrictEqual(stageOf(native), [itemKeyFor(7981), "implement"]);
          assert.deepStrictEqual(legacyInputs.at(-1), {
            transferId: "transfer-alpha-1",
            job: legacyJob,
            workers: record.items[0]!.workers,
          });
          assert.strictEqual(yield* dispositionOf(7982), "legacy_custody");
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
          const journey = path.join(root, "review-failure-a", "journey.json");
          const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.json`);
          yield* fs.makeDirectory(path.dirname(journey), { recursive: true });
          yield* fs.writeFileString(journey, "synthetic scenario verified");
          yield* fs.writeFileString(outside, "synthetic scenario verified");
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
            "Synthetic required scenario is not demonstrated.",
          );

          // Evidence T3 cannot verify earns nothing: outside the root, a wrong digest, a missing file.
          const unverified: ReadonlyArray<FactoryReportInput["artifacts"]> = [
            undefined,
            [{ path: outside, sha256: sha256("synthetic scenario verified") }],
            [{ path: journey, sha256: sha256("something else") }],
            [{ path: path.join(root, "review-failure-a", "absent.json"), sha256: sha256("") }],
          ];
          for (const artifacts of unverified) {
            const rework = yield* reworkWith(artifacts);
            assert.deepStrictEqual(admitted(rework.admissions), [], JSON.stringify(artifacts));
            assert.isTrue(yield* ownerRejects(rework.outcomeId));
          }

          // Verified evidence at the same head is a fresh, independent review of that evidence.
          const evidence = [{ path: journey, sha256: sha256("synthetic scenario verified") }];
          const verified = yield* reworkWith(evidence);
          const secondReview = admittedBy(verified.admissions);
          assert.match(
            basisOf(secondReview) ?? "",
            new RegExp(`^review:${head}:evidence:[0-9a-f]{64}$`),
          );
          yield* failReview(secondReview, "Synthetic transition coverage gaps remain.");

          // The same evidence again is the review already made on it: no duplicate decision.
          const repeated = yield* reworkWith(evidence);
          assert.deepStrictEqual(admitted(repeated.admissions), []);
          assert.isTrue(yield* ownerRejects(repeated.outcomeId));

          // New verified evidence earns a new review, whose pass is accepted for the head it names.
          yield* fs.writeFileString(journey, "synthetic scenario and transitions verified");
          const changed = yield* reworkWith([
            { path: journey, sha256: sha256("synthetic scenario and transitions verified") },
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
            failure: "Synthetic scenario is not demonstrated.",
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
