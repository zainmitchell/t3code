import {
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
  type ProviderDriverKind,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import * as FactoryRunPreparation from "./FactoryRunPreparation.ts";
import * as FactoryStore from "./FactoryStore.ts";
import { type FactoryReservation, samePinnedSelection } from "./FactoryStore.ts";

export type FactoryCustody =
  | {
      readonly state: "live";
      readonly reasons: ReadonlyArray<
        | "run_active"
        | "run_queued"
        | "pending_request"
        | "launch_pending"
        | "background_work"
        | "workspace_preparation"
        | "contained_processes"
      >;
    }
  | {
      readonly state: "quiescent";
      readonly reasons: ReadonlyArray<"descendants_ended" | "contained_quiet" | "never_started">;
    }
  | {
      readonly state: "unknown";
      readonly reasons: ReadonlyArray<
        | "execution_unreadable"
        | "process_containment_unsupported"
        | "container_unverified"
        | "container_namespace_mismatch"
        | "container_unreadable"
        | "provider_unavailable"
        | "selection_mismatch"
        | "external_claim_unattributed"
        | "legacy_custody_unproven"
        | "workspace_obligation_unresolved"
      >;
    };

/** A factory execution may not start another turn while its earlier work is not proven quiet. */
export class FactoryExecutionSelectionPinnedError extends Schema.TaggedError<FactoryExecutionSelectionPinnedError>()(
  "FactoryExecutionSelectionPinnedError",
  {
    threadId: ThreadId,
    runId: RunId,
  },
) {
  override get message(): string {
    return "This factory execution is pinned to the provider, model and options it was admitted with, so T3 will not start a turn here on another selection.";
  }
}

export class FactoryExecutionCustodyUnknownError extends Schema.TaggedError<FactoryExecutionCustodyUnknownError>()(
  "FactoryExecutionCustodyUnknownError",
  {
    threadId: ThreadId,
    runId: RunId,
    custody: Schema.Literals(["live", "unknown"]),
  },
) {
  override get message(): string {
    return "Factory execution custody is unknown: earlier work on this thread is not proven stopped, so T3 will not start another provider turn here.";
  }
}

/** What the native runtime records about the executions it judges. */
type ExecutionFacts =
  | { readonly type: "unreadable" }
  | {
      readonly type: "readable";
      readonly pinnedSelection: ModelSelection;
      readonly runs: OrchestrationV2ThreadProjection["runs"];
      /** Every run attempt except one that is about to start: each is one provider execution. */
      readonly attempts: OrchestrationV2ThreadProjection["attempts"];
      readonly providerTurns: OrchestrationV2ThreadProjection["providerTurns"];
      /** The attempt being started, whose own run is active because of it. */
      readonly excludedAttemptId: RunAttemptId | undefined;
      /** Read-state custody holds queued intent; a start judges executions only. */
      readonly countQueuedIntent: boolean;
      readonly pendingRequest: boolean;
      /** Raw provider rosters, so a run that is only now starting cannot hide earlier work. */
      readonly backgroundTasks: number;
      /** Every launch effect the outbox still holds for the thread, by run. */
      readonly launches: ReadonlyArray<
        Pick<EffectOutbox.OrchestrationEffectV2, "status" | "attemptCount"> & {
          readonly runId: RunId;
        }
      >;
      /** The driver each attempt's provider instance runs, when the thread records it. */
      readonly drivers: ReadonlyMap<string, ProviderDriverKind>;
      /** What each judged run's process work may be concluded to be, from its containers. */
      readonly processes: ReadonlyMap<RunId, FactoryExecutionGenerations.RunProcessFacts>;
      /**
       * The execution's other containers (same reservation and thread, not a judged run's own),
       * each as observed. A provider may bind to a sibling; its work is this
       * execution's, and every one of them must be gone before the execution is.
       */
      readonly siblings: ReadonlyArray<FactoryExecutionGenerations.RunProcessFacts>;
      /** What the execution's containers that a provider session's process joined add up to. */
      readonly sessionProcesses: ReadonlyMap<string, FactoryExecutionGenerations.RunProcessFacts>;
      /** The provider session each provider thread runs on. */
      readonly sessions: ReadonlyMap<string, string | null>;
      /**
       * The execution's one provider join, when its container names no session: that process is
       * the only one any of the execution's turns could have run in.
       */
      readonly soleJoin:
        | {
            readonly runId: RunId;
            readonly facts: FactoryExecutionGenerations.RunProcessFacts;
            readonly openedAt: DateTime.Utc;
            readonly endedAt: DateTime.Utc | undefined;
          }
        | undefined;
      /** Runs whose start the runtime refused before any provider work, by its own record. */
      readonly refusedBeforeStart: ReadonlySet<RunId>;
      /**
       * Workspace work of judged runs that asked for a workspace: `live` while this process
       * prepares it under the obligation's own owner, `unresolved` while any obligation is open
       * otherwise or cannot be read, `accounted` when every one is settled, its run's processes
       * are proved gone, or none was asked for.
       */
      readonly workspace: "accounted" | "live" | "unresolved";
    };

const ACTIVE_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);
const LIVE_EXECUTION_STATUSES = new Set(["pending", "running"]);

type LiveReason = Extract<FactoryCustody, { state: "live" }>["reasons"][number];
type UnknownReason = Extract<FactoryCustody, { state: "unknown" }>["reasons"][number];

const provedGone = (
  facts: FactoryExecutionGenerations.RunProcessFacts | undefined,
): facts is Extract<FactoryExecutionGenerations.RunProcessFacts, { type: "ended" | "quiet" }> =>
  facts?.type === "ended" || facts?.type === "quiet";

/**
 * The start fence's own refusals. Each is written before any provider session is opened for the
 * run, so a run's signal item for one of them is the runtime's record that no provider ran.
 */
export const START_REFUSAL_SIGNALS = {
  legacyCustody: "factory-legacy-custody",
  claimNotReady: "factory-claim-not-ready",
  firstStartPrecondition: "factory-first-start-precondition",
  selectionPinned: "factory-selection-pinned",
  custodyUnknown: "factory-custody-unknown",
  containmentUnavailable: "factory-containment-unavailable",
} as const;

/**
 * Provider-native wakes the fence refused that are still owed to the execution: the adapter
 * offers each wake once and the message it dispatched is the only record of it, so a refused one
 * is undelivered until a run starts after it. While one is owed, the execution's result is not
 * missing, and the wake is what the runtime delivers again once the execution is proved quiet.
 */
/**
 * A worker that ended its turn watching a pull request is waiting for its checks: T3 wakes it
 * when they finish, so its result is not missing yet, and settling would end the watch.
 */
export const awaitsPullRequestChecks = (
  thread: Pick<OrchestrationV2ThreadProjection["thread"], "pullRequests">,
) => (thread.pullRequests ?? []).some((link) => link.watch !== undefined);

export const owedWakes = (
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages" | "turnItems">,
): ReadonlyArray<OrchestrationV2ThreadProjection["runs"][number]> => {
  const refused = refusedBeforeStartRuns(projection);
  return projection.runs.filter((run) => {
    if (run.status !== "failed" || run.startedAt !== null || !refused.has(run.id)) return false;
    if (projection.runs.some((later) => later.ordinal > run.ordinal && later.startedAt !== null)) {
      return false;
    }
    const wake = projection.messages.find((message) => message.id === run.userMessageId);
    return wake?.createdBy === "agent" && wake.creationSource === "provider";
  });
};

/**
 * The refusals that say something about the execution alone: another execution not proven
 * quiet, a selection other than the pinned one, no container to start in. A refusal about the
 * claim's standing (not verified, conflicted, legacy) leaves the stage's fate to the claim
 * machinery, which charges a conflict against its unit; custody does not decide it.
 */
const EXECUTION_REFUSAL_SIGNALS = [
  START_REFUSAL_SIGNALS.custodyUnknown,
  START_REFUSAL_SIGNALS.selectionPinned,
  START_REFUSAL_SIGNALS.containmentUnavailable,
];

/** Runs the fence refused before any provider work, by their own retained signal items. */
const refusedBeforeStartRuns = (
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "turnItems">,
): ReadonlySet<RunId> => {
  const refused = new Set<RunId>();
  for (const run of projection.runs) {
    const signals = new Set<string>(
      EXECUTION_REFUSAL_SIGNALS.map((signal) =>
        IdAllocator.derive.runSignalTurnItem({ runId: run.id, signal }),
      ),
    );
    if (
      projection.turnItems.some(
        (item) => item.runId === run.id && item.type === "error" && signals.has(item.id),
      )
    ) {
      refused.add(run.id);
    }
  }
  return refused;
};

/**
 * Quiescence needs positive proof for every judged execution: its run's processes, every one a
 * descendant of a contained start, are proved gone from their containers. A turn status, a roster
 * or elapsed time names no process, so none of them proves an execution ended.
 */
function classifyCustody(facts: ExecutionFacts): FactoryCustody {
  if (facts.type === "unreadable") return { state: "unknown", reasons: ["execution_unreadable"] };
  const { runs, attempts } = facts;
  if (runs.length === 0 || attempts.length === 0) {
    return { state: "unknown", reasons: ["execution_unreadable"] };
  }
  const turnOf = (attempt: (typeof attempts)[number]) =>
    facts.providerTurns.find((turn) => turn.runAttemptId === attempt.id);
  const judgedRunIds = new Set(attempts.map((attempt) => attempt.runId));
  // Every judged execution must have run on the pinned selection, not only the first.
  if (
    runs.some(
      (run) =>
        judgedRunIds.has(run.id) && !samePinnedSelection(facts.pinnedSelection, run.modelSelection),
    )
  ) {
    return { state: "unknown", reasons: ["selection_mismatch"] };
  }
  const judgedFacts = [...judgedRunIds].map((runId) => facts.processes.get(runId));
  // An execution never started only on its own run's retained records: the fence's own refusal
  // before any provider work, or launch rows none of which was ever claimed and none still
  // pending. Pruned or missing rows prove nothing. Launches carry only a run id, so a claimed
  // launch for a run (a restart's, say) marks all its attempts as possibly started.
  const neverStarted = (attempt: (typeof attempts)[number]) => {
    if (turnOf(attempt) !== undefined || attempt.startedAt !== null) return false;
    if (facts.refusedBeforeStart.has(attempt.runId)) return true;
    const launches = facts.launches.filter((launch) => launch.runId === attempt.runId);
    return (
      launches.length > 0 &&
      launches.every(
        (launch) =>
          launch.attemptCount === 0 && launch.status !== "pending" && launch.status !== "running",
      )
    );
  };
  const sessionProcessesOf = (attempt: (typeof attempts)[number]) => {
    const turn = turnOf(attempt);
    const sessionId = turn === undefined ? null : facts.sessions.get(turn.providerThreadId);
    return sessionId == null ? undefined : facts.sessionProcesses.get(sessionId);
  };
  const siblingsGone = facts.siblings.every(provedGone);
  const siblingJoined = facts.siblings.some((fact) => provedGone(fact) && fact.providerJoined);
  /**
   * Positive proof that the attempt's provider process is gone: it must have joined a container
   * of this execution, since an empty container it never entered proves nothing. Accepted: the
   * run's own container; a sibling container of the same reservation and thread, the own one
   * empty and all gone; or the attempt's session joined this execution's containers, all gone.
   */
  const providerProvedGone = (attempt: (typeof attempts)[number]) => {
    const own = facts.processes.get(attempt.runId);
    const ownGone = provedGone(own);
    if (ownGone && own.providerJoined) return true;
    if (ownGone && siblingsGone && siblingJoined) return true;
    const ownAccounted = own === undefined || own.type === "uncontained" || ownGone;
    const session = sessionProcessesOf(attempt);
    if (ownAccounted && provedGone(session) && session.providerJoined) return true;
    // A later turn on the joined run's provider thread, inside that process's lifetime.
    const sole = facts.soleJoin;
    const turn = turnOf(attempt);
    return (
      ownAccounted &&
      sole !== undefined &&
      sole.runId !== attempt.runId &&
      provedGone(sole.facts) &&
      attempt.providerThreadId !== null &&
      attempts.some(
        (joined) =>
          joined.runId === sole.runId && joined.providerThreadId === attempt.providerThreadId,
      ) &&
      attempt.startedAt !== null &&
      DateTime.isGreaterThanOrEqualTo(attempt.startedAt, sole.openedAt) &&
      turn?.completedAt != null &&
      (sole.endedAt === undefined || DateTime.isLessThanOrEqualTo(turn.completedAt, sole.endedAt))
    );
  };
  const allProvedGone =
    siblingsGone &&
    attempts.every((attempt) => neverStarted(attempt) || providerProvedGone(attempt));

  const live: Array<LiveReason> = [];
  if (
    runs.some(
      (run) =>
        ACTIVE_RUN_STATUSES.has(run.status) &&
        (run.activeAttemptId === null || run.activeAttemptId !== facts.excludedAttemptId),
    ) ||
    attempts.some(
      (attempt) =>
        LIVE_EXECUTION_STATUSES.has(attempt.status) ||
        LIVE_EXECUTION_STATUSES.has(turnOf(attempt)?.status ?? ""),
    )
  ) {
    live.push("run_active");
  }
  if (facts.countQueuedIntent && runs.some((run) => run.status === "queued")) {
    live.push("run_queued");
  }
  if (facts.pendingRequest) live.push("pending_request");
  if (
    facts.launches.some(
      (launch) =>
        judgedRunIds.has(launch.runId) && launch.status === "pending" && launch.attemptCount === 0,
    )
  ) {
    live.push("launch_pending");
  }
  // A roster entry runs inside its run's processes; once those are proved gone, it is stale.
  if (facts.backgroundTasks > 0 && !allProvedGone) live.push("background_work");
  if (
    judgedFacts.some((fact) => fact?.type === "live") ||
    facts.siblings.some((fact) => fact.type === "live")
  ) {
    live.push("contained_processes");
  }
  if (facts.workspace === "live") live.push("workspace_preparation");
  if (live.length > 0) return { state: "live", reasons: live };
  if (facts.workspace === "unresolved") {
    return { state: "unknown", reasons: ["workspace_obligation_unresolved"] };
  }

  const reasons = new Set<UnknownReason>();
  for (const fact of [...judgedFacts, ...facts.siblings]) {
    if (fact?.type === "unknown") reasons.add(fact.reason);
  }
  let allNeverStarted = true;
  for (const attempt of attempts) {
    if (neverStarted(attempt)) continue;
    allNeverStarted = false;
    const driver = facts.drivers.get(attempt.providerInstanceId);
    if (driver === undefined) reasons.add("provider_unavailable");
    else if (
      !FactoryExecutionGenerations.CONTAINED_DRIVERS.has(driver) ||
      !providerProvedGone(attempt)
    ) {
      reasons.add("process_containment_unsupported");
    }
  }
  if (reasons.size > 0) return { state: "unknown", reasons: [...reasons] };
  if (
    allNeverStarted &&
    siblingsGone &&
    judgedFacts.every(
      (fact) => fact === undefined || fact.type === "uncontained" || provedGone(fact),
    )
  ) {
    return { state: "quiescent", reasons: ["never_started"] };
  }
  const quiescent = new Set<"descendants_ended" | "contained_quiet">();
  for (const fact of [...judgedFacts, ...facts.siblings]) {
    if (fact?.type === "ended") quiescent.add("descendants_ended");
    if (fact?.type === "quiet") quiescent.add("contained_quiet");
  }
  return { state: "quiescent", reasons: [...quiescent] };
}

/**
 * A run is `queued` only from creation and never returns to it, so a queued run's attempt never
 * executed: it is intent, not a predecessor of the start consuming the queue. So is a run cancelled
 * before it left the queue, as its history proves (`ProjectionStore.getNeverDequeuedRunIds`).
 */
export const executionAttempts = (
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "attempts">,
  neverDequeued: ReadonlySet<RunId>,
) => {
  const queued = new Set(
    projection.runs.filter((run) => run.status === "queued").map((run) => run.id),
  );
  return projection.attempts.filter(
    (attempt) => !queued.has(attempt.runId) && !neverDequeued.has(attempt.runId),
  );
};

/**
 * Custody judged per execution (run attempt). `excludingAttemptId` omits exactly an attempt about
 * to start: still `starting`, no provider turn sent, so no execution of its own yet. That start
 * judges executions only; read-state custody also holds queued intent. Read failures become
 * uncertainty, never a missing or ended execution.
 */
export const readExecutionCustody = Effect.fn("factoryCustody.readExecutionCustody")(function* (
  reservation: FactoryReservation,
  options: { readonly excludingAttemptId?: RunAttemptId } = {},
) {
  // Nothing contained a legacy writer's work, so nothing here can prove it ended.
  if (reservation.origin === "transferred") {
    return { state: "unknown", reasons: ["legacy_custody_unproven"] } satisfies FactoryCustody;
  }
  if (!FactoryStore.isNativeReservation(reservation)) {
    return { state: "unknown", reasons: ["external_claim_unattributed"] } satisfies FactoryCustody;
  }
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
  const store = yield* FactoryStore.FactoryStore;
  const preparation = yield* FactoryRunPreparation.FactoryRunPreparation;
  const { execution } = reservation;
  const observed = yield* Effect.gen(function* () {
    const projection = yield* projections.getThreadProjection(execution.threadId);
    if (projection.thread.deletedAt !== null) return Option.none();
    const neverDequeued = yield* projections.getNeverDequeuedRunIds(execution.threadId);
    const launches = (yield* outbox.listLaunchesForThread(execution.threadId)).flatMap((effect) =>
      effect.request.type === "provider-turn.start" ||
      effect.request.type === "provider-turn.restart"
        ? [
            {
              status: effect.status,
              attemptCount: effect.attemptCount,
              runId: effect.request.runId,
            },
          ]
        : [],
    );
    return Option.some({ projection, launches, neverDequeued });
  }).pipe(Effect.orElseSucceed(() => Option.none()));
  if (Option.isNone(observed)) return classifyCustody({ type: "unreadable" });
  const { projection, launches, neverDequeued } = observed.value;
  const attempts = executionAttempts(projection, neverDequeued).filter(
    (attempt) => attempt.id !== options.excludingAttemptId,
  );
  const excludedRootNodeId = projection.attempts.find(
    (attempt) => attempt.id === options.excludingAttemptId,
  )?.rootNodeId;
  const judgedRunIds = new Set(attempts.map((attempt) => attempt.runId));
  const judgedNodes = new Set(
    projection.nodes
      .filter(
        (node) =>
          node.runId !== null &&
          judgedRunIds.has(node.runId) &&
          (excludedRootNodeId === undefined || node.rootNodeId !== excludedRootNodeId),
      )
      .map((node) => node.id),
  );
  const drivers = new Map<string, ProviderDriverKind>(
    projection.providerThreads.map((providerThread) => [
      providerThread.providerInstanceId,
      providerThread.driver,
    ]),
  );
  const processes = yield* generations.observe([...judgedRunIds]);
  // The rest of the execution's containers, and which provider sessions joined which of them.
  const executionGenerations = yield* generations.observeExecution({
    reservationId: reservation.reservationId,
    threadId: execution.threadId,
  });
  const siblings = executionGenerations
    .filter((entry) => !judgedRunIds.has(entry.generation.runId))
    .map((entry) => entry.facts);
  const joinedBySession = new Map<string, Array<FactoryExecutionGenerations.RunProcessFacts>>();
  for (const entry of executionGenerations) {
    for (const sessionId of entry.generation.providerSessions ?? []) {
      joinedBySession.set(sessionId, [...(joinedBySession.get(sessionId) ?? []), entry.facts]);
    }
  }
  // Every provider process of a contained execution is admitted and counted, so with one join in
  // all its containers there was one process. Only a container that names no session needs this.
  const joined = executionGenerations.filter((entry) => (entry.generation.providerJoins ?? 0) > 0);
  const sole =
    joined.length === 1 &&
    joined[0]!.generation.providerJoins === 1 &&
    joined[0]!.generation.providerSessions === undefined
      ? joined[0]!
      : undefined;
  const sessionProcesses = new Map(
    [...joinedBySession].map(
      ([sessionId, facts]) =>
        [sessionId, FactoryExecutionGenerations.combineProcessFacts(facts)] as const,
    ),
  );
  // A run asked for a workspace in its own immutable record; its obligation must then exist,
  // belong to this execution and be settled, or be live under its own owner here.
  const workspace = yield* Effect.gen(function* () {
    let state: "accounted" | "live" | "unresolved" = "accounted";
    for (const run of projection.runs) {
      if (!judgedRunIds.has(run.id) || run.workspacePreparation === undefined) continue;
      const obligation = yield* store.workspaceObligation(run.id);
      if (
        Option.isNone(obligation) ||
        obligation.value.reservationId !== reservation.reservationId ||
        obligation.value.threadId !== execution.threadId
      ) {
        return "unresolved" as const;
      }
      if (obligation.value.state === "settled") continue;
      const owner = yield* preparation.currentOwner(obligation.value.commandId);
      if (Option.exists(owner, (current) => current === obligation.value.ownerId)) {
        state = "live";
        continue;
      }
      // Its owner is gone from here; only its run's processes proved gone account for it.
      if (processes.get(run.id)?.type !== "ended") return "unresolved" as const;
    }
    return state;
  }).pipe(Effect.orElseSucceed(() => "unresolved" as const));
  return classifyCustody({
    type: "readable",
    workspace,
    pinnedSelection: reservation.modelSelection,
    runs: projection.runs,
    attempts,
    providerTurns: projection.providerTurns,
    excludedAttemptId: options.excludingAttemptId,
    countQueuedIntent: options.excludingAttemptId === undefined,
    pendingRequest: projection.runtimeRequests.some(
      (request) => request.status === "pending" && judgedNodes.has(request.nodeId),
    ),
    backgroundTasks: projection.providerThreads.reduce(
      (count, providerThread) => count + (providerThread.pendingBackgroundTasks ?? []).length,
      0,
    ),
    launches,
    drivers,
    processes,
    siblings,
    sessionProcesses,
    sessions: new Map(
      projection.providerThreads.map((providerThread) => [
        providerThread.id,
        providerThread.providerSessionId,
      ]),
    ),
    refusedBeforeStart: refusedBeforeStartRuns(projection),
    soleJoin:
      sole === undefined
        ? undefined
        : {
            runId: sole.generation.runId,
            facts: sole.facts,
            openedAt: DateTime.makeUnsafe(sole.generation.openedAt),
            endedAt:
              sole.generation.state === "ended"
                ? DateTime.makeUnsafe(sole.generation.endedAt)
                : undefined,
          },
  });
});
