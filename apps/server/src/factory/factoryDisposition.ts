import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { START_REFUSAL_SIGNALS, type FactoryCustody } from "./factoryCustody.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import {
  bootBoundaryRefusals,
  type HistoricalProvenance,
  type HostBoot,
  LOCAL_PROCESS_DRIVERS,
  RESIDUAL_UNCERTAINTIES,
  type ResidualScope,
} from "./factoryHistoricalTermination.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

const SESSION_OPEN_FAILURE = "provider-session-open-failure";

/**
 * The runtime's own records that a run ended before any provider turn could be sent: a start-fence
 * refusal, or the provider session open that failed on its last try.
 */
const BEFORE_TURN_SIGNALS: ReadonlyArray<string> = [
  ...Object.values(START_REFUSAL_SIGNALS),
  SESSION_OPEN_FAILURE,
];

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

export type AdmittedReservation = Extract<
  FactoryStore.FactoryReservation,
  { readonly origin: "admitted" }
>;

/** Custody that is unknown only because nothing proves the stage's preparation history. */
const unprovedOnly = (custody: FactoryCustody) =>
  custody.state === "unknown" &&
  custody.reasons.length === 1 &&
  custody.reasons[0] === "process_containment_unsupported";

/**
 * Every fact an owner's never-started attestation rests on. The digest of its canonical form is
 * what the owner agrees to, so any change after they read it refuses the attestation.
 */
export const readNeverStartedEvidence = Effect.fn("factoryDisposition.readNeverStartedEvidence")(
  function* (reservation: AdmittedReservation, custody: FactoryCustody) {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const store = yield* FactoryStore.FactoryStore;
    const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    const { threadId } = reservation.execution;
    const projection = yield* projections.getThreadProjection(threadId);
    const launches = (yield* outbox.listLaunchesForThread(threadId)).flatMap((effect) =>
      effect.request.type === "provider-turn.start" ||
      effect.request.type === "provider-turn.restart"
        ? [{ runId: effect.request.runId, status: effect.status, attempts: effect.attemptCount }]
        : [],
    );
    const runs = [];
    for (const run of projection.runs) {
      const obligation =
        run.workspacePreparation === undefined
          ? undefined
          : Option.getOrUndefined(yield* store.workspaceObligation(run.id));
      const signals = new Map(
        BEFORE_TURN_SIGNALS.map((signal) => [
          IdAllocator.derive.runSignalTurnItem({ runId: run.id, signal }),
          signal,
        ]),
      );
      const beforeTurn = projection.turnItems.find(
        (item) => item.runId === run.id && item.type === "error" && signals.has(item.id),
      );
      runs.push({
        runId: run.id,
        status: run.status,
        started: run.startedAt !== null,
        beforeTurn: beforeTurn === undefined ? null : (signals.get(beforeTurn.id) ?? null),
        driver:
          projection.providerThreads.find(
            (providerThread) => providerThread.providerInstanceId === run.providerInstanceId,
          )?.driver ?? null,
        obligation:
          run.workspacePreparation === undefined
            ? ("none" as const)
            : obligation === undefined
              ? ("missing" as const)
              : {
                  state: obligation.state,
                  ownerId: obligation.ownerId,
                  openedIn: obligation.openedIn ?? null,
                },
        generations: (yield* generations.generations(run.id)).map((generation) => ({
          generationId: generation.generationId,
          state: generation.state,
          providerJoins: generation.providerJoins ?? 0,
        })),
      });
    }
    return {
      reservation: {
        reservationId: reservation.reservationId,
        factoryId: reservation.factoryId,
        itemKey: reservation.itemKey,
        taskKind: reservation.taskKind,
        execution: reservation.execution,
        admittedIn: reservation.admittedIn ?? null,
      },
      runs,
      attempts: projection.attempts.map((attempt) => ({
        attemptId: attempt.id,
        runId: attempt.runId,
        status: attempt.status,
        started: attempt.startedAt !== null,
        providerTurnId: attempt.providerTurnId,
      })),
      providerTurns: projection.providerTurns.length,
      launches,
      custody,
    };
  },
);
export type NeverStartedEvidence = Effect.Success<ReturnType<typeof readNeverStartedEvidence>>;

/**
 * A claimed launch whose run the runtime itself recorded ending before any provider turn, on a
 * driver whose provider process starts only inside the run's container, with every container of
 * the run ended and never joined: no provider process ran for it. A failed session open happens
 * inside a container the fence opened, so that record needs one.
 */
const endedBeforeTurn = (evidence: NeverStartedEvidence, runId: string) => {
  const run = evidence.runs.find((candidate) => candidate.runId === runId);
  return (
    run !== undefined &&
    run.beforeTurn !== null &&
    run.driver !== null &&
    FactoryExecutionGenerations.CONTAINED_DRIVERS.has(run.driver) &&
    (run.beforeTurn !== SESSION_OPEN_FAILURE || run.generations.length > 0) &&
    run.generations.every(
      (generation) => generation.state === "ended" && generation.providerJoins === 0,
    )
  );
};

/** Why the evidence cannot carry an owner's never-started attestation; empty when it can. */
export const neverStartedRefusals = (evidence: NeverStartedEvidence): ReadonlyArray<string> => [
  ...(evidence.runs.length === 0 ||
  !evidence.runs.some((run) => run.runId === evidence.reservation.execution.runId)
    ? ["no_run"]
    : []),
  ...(evidence.runs.some((run) => !TERMINAL_RUN_STATUSES.has(run.status))
    ? ["run_not_terminal"]
    : []),
  ...(evidence.runs.some((run) => run.started) ||
  evidence.providerTurns > 0 ||
  evidence.attempts.some((attempt) => attempt.started || attempt.providerTurnId !== null)
    ? ["provider_started"]
    : []),
  ...(evidence.launches.some(
    (launch) =>
      launch.status === "pending" ||
      launch.status === "running" ||
      (launch.attempts > 0 && !endedBeforeTurn(evidence, launch.runId)),
  )
    ? ["launch_claimed"]
    : []),
  ...(evidence.runs.some(
    (run) =>
      run.obligation !== "none" &&
      (run.obligation === "missing" || run.obligation.state !== "settled"),
  )
    ? ["workspace_obligation_open"]
    : []),
  ...(evidence.runs.some((run) =>
    run.generations.some((generation) => generation.state !== "ended"),
  )
    ? ["container_not_ended"]
    : []),
  ...(unprovedOnly(evidence.custody) ? [] : ["custody_not_unproved"]),
];

/**
 * Every fact an owner's quarantine of a historical stage rests on: the never-started read of its
 * execution, the stage's own reported outcomes, and the quarantine it is under, if any.
 */
export const readQuarantineEvidence = Effect.fn("factoryDisposition.readQuarantineEvidence")(
  function* (
    reservation: AdmittedReservation,
    custody: FactoryCustody,
    outcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>,
  ) {
    const execution = yield* readNeverStartedEvidence(reservation, custody);
    return {
      ...execution,
      outcomes: outcomes.map((outcome) => ({
        outcomeId: outcome.outcomeId,
        state: outcome.state,
        kind: outcome.report.outcome,
        fromExecution: outcome.origin.type === "execution",
      })),
      quarantine:
        reservation.quarantine === undefined
          ? null
          : {
              by: reservation.quarantine.by,
              evidenceDigest: reservation.quarantine.evidenceDigest,
              quarantinedAt: reservation.quarantine.quarantinedAt,
            },
    };
  },
);
export type QuarantineEvidence = Effect.Success<ReturnType<typeof readQuarantineEvidence>>;

const FENCE_REFUSALS: ReadonlySet<string> = new Set(Object.values(START_REFUSAL_SIGNALS));

/**
 * A claimed launch whose provider outcome its own run records: the run started, so its work is
 * judged as a started run, or the start fence refused it before any provider session opened.
 */
const launchOutcomeProved = (evidence: QuarantineEvidence, runId: string) => {
  const run = evidence.runs.find((candidate) => candidate.runId === runId);
  return (
    run !== undefined &&
    (run.started || (run.beforeTurn !== null && FENCE_REFUSALS.has(run.beforeTurn)))
  );
};

/**
 * Why the evidence cannot carry an owner's quarantine of a historical stage; empty when it can.
 * It qualifies only when its custody is unknown for want of a provider join alone: reported and
 * verified, every run over and every claimed launch accounted for, admitted by an earlier serving
 * process, and never joined. Nothing live, unread or of unproved outcome qualifies.
 */
export const quarantineRefusals = (
  evidence: QuarantineEvidence,
  servingId: string,
): ReadonlyArray<string> => [
  ...(evidence.quarantine === null ? [] : ["already_quarantined"]),
  ...(evidence.runs.length === 0 ? ["no_run"] : []),
  ...(evidence.runs.some((run) => !TERMINAL_RUN_STATUSES.has(run.status))
    ? ["run_not_terminal"]
    : []),
  ...(evidence.runs.some((run) => run.started) ? [] : ["not_started"]),
  ...(evidence.runs.some((run) => run.started && run.status !== "completed")
    ? ["started_run_not_completed"]
    : []),
  ...(evidence.launches.some((launch) => launch.status === "pending" || launch.status === "running")
    ? ["launch_pending"]
    : []),
  ...(evidence.launches.some(
    (launch) => launch.attempts > 0 && !launchOutcomeProved(evidence, launch.runId),
  )
    ? ["launch_outcome_unproved"]
    : []),
  ...(evidence.outcomes.some((outcome) => outcome.fromExecution && outcome.state === "verified")
    ? []
    : ["no_verified_report"]),
  ...(evidence.runs.some((run) =>
    run.generations.some((generation) => generation.providerJoins > 0),
  )
    ? ["provider_joined"]
    : []),
  ...(evidence.reservation.admittedIn === servingId ? ["admitted_by_this_process"] : []),
  ...(evidence.runs.some(
    (run) =>
      run.obligation !== "none" &&
      (run.obligation === "missing" || run.obligation.state !== "settled"),
  )
    ? ["workspace_obligation_open"]
    : []),
  ...(unprovedOnly(evidence.custody) ? [] : ["custody_not_unproved"]),
];

/**
 * Every fact a historical execution's termination by host restart is bound to, read before the
 * restart and again after it: the quarantine read, the stage's outcomes by report digest, and its
 * latest recorded activity. `execution` leaves out what a restart itself changes (custody, the
 * containers' states, any quarantine), so it must read the same on both sides of the restart.
 */
export const readTerminationEvidence = Effect.fn("factoryDisposition.readTerminationEvidence")(
  function* (
    reservation: AdmittedReservation,
    custody: FactoryCustody,
    outcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>,
  ) {
    const facts = yield* readQuarantineEvidence(reservation, custody, outcomes);
    const projection = yield* (yield* ProjectionStore.ProjectionStoreV2).getThreadProjection(
      reservation.execution.threadId,
    );
    const times = [
      ...projection.runs.flatMap((run) => [run.requestedAt, run.startedAt, run.completedAt]),
      ...projection.attempts.flatMap((attempt) => [attempt.startedAt, attempt.completedAt]),
      ...projection.providerTurns.flatMap((turn) => [turn.startedAt, turn.completedAt]),
    ].flatMap((time) => (time === null ? [] : [DateTime.toEpochMillis(time)]));
    return {
      facts,
      execution: {
        reservation: facts.reservation,
        runs: facts.runs.map((run) => ({
          ...run,
          generations: run.generations.map(({ generationId, providerJoins }) => ({
            generationId,
            providerJoins,
          })),
        })),
        attempts: facts.attempts,
        providerTurns: facts.providerTurns,
        providerSessions: [
          ...new Set(
            projection.providerThreads.flatMap((providerThread) =>
              providerThread.providerSessionId === null ? [] : [providerThread.providerSessionId],
            ),
          ),
        ].toSorted(),
        launches: facts.launches,
        outcomes: outcomes.map((outcome) => ({
          outcomeId: outcome.outcomeId,
          state: outcome.state,
          kind: outcome.report.outcome,
          reportDigest: outcome.reportDigest,
          origin: outcome.origin,
        })),
        latestActivityAt:
          times.length === 0 ? null : DateTime.formatIso(DateTime.makeUnsafe(Math.max(...times))),
      },
    };
  },
);

const sameSet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => {
  const a = left.toSorted();
  const b = right.toSorted();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

type ResidualProjection = Pick<
  OrchestrationV2ThreadProjection,
  | "thread"
  | "runs"
  | "attempts"
  | "providerThreads"
  | "providerSessions"
  | "providerTurns"
  | "subagents"
>;

/**
 * T3's own records a residual decision is scoped by: every container of the execution's runs as
 * its host recorded it, the execution thread's projection, and every recorded descendant thread
 * with its projection (null when it cannot be read).
 */
export const readResidualFacts = Effect.fn("factoryDisposition.readResidualFacts")(function* (
  reservation: AdmittedReservation,
) {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
  const { threadId } = reservation.execution;
  const projection: ResidualProjection = yield* projections.getThreadProjection(threadId);
  const containers = [];
  for (const run of projection.runs) {
    for (const generation of yield* generations.generations(run.id)) {
      containers.push({
        generationId: generation.generationId,
        runId: generation.runId,
        machine: generation.identity.machine,
        session: generation.identity.session,
        ownerHost: generation.ownerHost,
        providerJoins: generation.providerJoins ?? 0,
      });
    }
  }
  const lineage =
    projections.getLineageDescendants === undefined
      ? { threadIds: [], unreadableThreads: 1 }
      : yield* projections.getLineageDescendants([threadId]);
  const descendants = [];
  for (const childId of lineage.threadIds) {
    const child = yield* projections.getThreadProjection(childId).pipe(Effect.option);
    descendants.push({ threadId: childId, projection: Option.getOrNull(child) });
  }
  return {
    containers,
    projection,
    unreadableThreads: lineage.unreadableThreads,
    descendants: descendants as ReadonlyArray<{
      readonly threadId: string;
      readonly projection: ResidualProjection | null;
    }>,
  };
});
export type ResidualFacts = Effect.Success<ReturnType<typeof readResidualFacts>>;

const isLiteralNativeId = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0 && !value.startsWith("pending:");

/**
 * The exact scope an owner's residual decision covers, or why none can be: containers on `host`
 * never joined (T2), one serving process (T3), each started attempt's exact provider binding (T4),
 * and every descendant a provider-native subagent bound to its scoped parent (T5).
 */
export const residualScopeOf = (
  facts: ResidualFacts,
  input: {
    readonly reservationId: string;
    readonly admittedIn: string | null;
    readonly operationRef: string;
    readonly host: Pick<HostBoot, "platform" | "machineId">;
  },
): { readonly scope: ResidualScope | null; readonly refusals: ReadonlyArray<string> } => {
  const refusals = new Set<string>();
  const { projection, containers } = facts;
  // T2: containers on this host, none ever joined (joined work settles through ordinary custody).
  for (const run of projection.runs) {
    if (run.startedAt !== null && !containers.some((container) => container.runId === run.id)) {
      refusals.add("residual_run_uncontained");
    }
  }
  if (containers.some((container) => container.machine !== input.host.machineId)) {
    refusals.add("residual_container_foreign_host");
  }
  if (containers.some((container) => container.providerJoins > 0)) {
    refusals.add("residual_joined_use_custody");
  }
  // T3: the one serving process that admitted the stage and opened its containers.
  const owners = new Set(containers.map((container) => container.ownerHost));
  if (input.admittedIn === null || input.admittedIn === "") {
    refusals.add("residual_admission_unrecorded");
  }
  if (owners.size !== 1) refusals.add("residual_serving_process_split");

  // T4: each started attempt's own provider thread, session, instance, adapter and native id.
  const attempts = [];
  const started = projection.attempts.filter((attempt) => attempt.startedAt !== null);
  if (started.length === 0) refusals.add("residual_no_started_attempt");
  for (const attempt of started) {
    const providerThread = projection.providerThreads.find(
      (candidate) => candidate.id === attempt.providerThreadId,
    );
    const session = projection.providerSessions.find(
      (candidate) => candidate.id === providerThread?.providerSessionId,
    );
    const native = providerThread?.nativeThreadRef;
    if (providerThread === undefined || session === undefined) {
      refusals.add("residual_attempt_unbound");
      continue;
    }
    if (
      providerThread.providerInstanceId !== attempt.providerInstanceId ||
      session.providerInstanceId !== attempt.providerInstanceId ||
      session.driver !== providerThread.driver ||
      !FactoryExecutionGenerations.CONTAINED_DRIVERS.has(session.driver)
    ) {
      refusals.add("residual_attempt_foreign_instance");
      continue;
    }
    if (native?.strength !== "strong" || !isLiteralNativeId(native.nativeId)) {
      refusals.add("residual_native_id_unrecorded");
      continue;
    }
    if (isLiteralNativeId(attempt.nativeThreadId) && attempt.nativeThreadId !== native.nativeId) {
      refusals.add("residual_native_id_conflict");
      continue;
    }
    attempts.push({
      attemptId: attempt.id,
      runId: attempt.runId,
      providerInstanceId: attempt.providerInstanceId,
      providerThreadId: providerThread.id,
      providerSessionId: session.id,
      driver: session.driver,
      nativeThreadId: native.nativeId,
    });
  }

  // T5: every recorded descendant, bound level by level from the execution thread.
  if (facts.unreadableThreads > 0) refusals.add("residual_lineage_unreadable");
  const scoped = new Map<string, ResidualProjection>([[projection.thread.id, projection]]);
  const sessionsOf = (thread: ResidualProjection) =>
    new Set(
      thread.providerThreads.flatMap((p) =>
        p.providerSessionId === null ? [] : [p.providerSessionId],
      ),
    );
  const nativeDescendants = [];
  let pending = facts.descendants;
  for (const scopedThread of scoped.values()) {
    if (scopedThread.subagents.some((subagent) => subagent.remoteChild !== undefined)) {
      refusals.add("residual_descendant_remote");
    }
  }
  // Level by level: a child is judged once its parent is scoped; one never reached stays unbound.
  let progressed = true;
  while (progressed) {
    progressed = false;
    const waiting: Array<(typeof pending)[number]> = [];
    for (const descendant of pending) {
      const child = descendant.projection;
      if (child === null) {
        refusals.add("residual_descendant_unreadable");
        continue;
      }
      const parent = scoped.get(child.thread.lineage.parentThreadId ?? "");
      if (parent === undefined) {
        waiting.push(descendant);
        continue;
      }
      progressed = true;
      const subagent = parent.subagents.find(
        (candidate) => candidate.childThreadId === child.thread.id,
      );
      const providerThread =
        child.providerThreads.find((candidate) => candidate.id === subagent?.providerThreadId) ??
        parent.providerThreads.find((candidate) => candidate.id === subagent?.providerThreadId);
      const fork = providerThread?.forkedFrom ?? null;
      const forkThread = parent.providerThreads.find(
        (candidate) => candidate.id === fork?.providerThreadId,
      );
      const native = providerThread?.nativeThreadRef;
      if (child.thread.delegatedFrom !== undefined || child.thread.linkOrigin !== undefined) {
        refusals.add("residual_descendant_delegated");
      } else if (subagent?.remoteChild !== undefined) {
        refusals.add("residual_descendant_remote");
      } else if (
        child.thread.lineage.relationshipToParent !== "subagent" ||
        child.runs.length > 0 ||
        child.attempts.length > 0 ||
        child.providerSessions.length > 0
      ) {
        refusals.add("residual_descendant_t3_launched");
      } else if (
        subagent === undefined ||
        subagent.origin !== "provider_native" ||
        providerThread === undefined ||
        forkThread === undefined ||
        providerThread.providerInstanceId !== subagent.providerInstanceId ||
        forkThread.providerInstanceId !== subagent.providerInstanceId ||
        providerThread.providerSessionId === null ||
        !sessionsOf(parent).has(providerThread.providerSessionId) ||
        (fork?.providerTurnId !== undefined &&
          !parent.providerTurns.some(
            (turn) => turn.id === fork.providerTurnId && turn.providerThreadId === forkThread.id,
          )) ||
        native?.strength !== "strong" ||
        !isLiteralNativeId(native.nativeId) ||
        // Both Codex producers name the subagent's item `<call>:<child native id>`.
        !(subagent.nativeTaskRef?.nativeId ?? "").endsWith(`:${native.nativeId}`)
      ) {
        refusals.add("residual_descendant_unbound");
      } else {
        scoped.set(child.thread.id, child);
        nativeDescendants.push({
          childThreadId: child.thread.id,
          parentThreadId: parent.thread.id,
          subagentId: subagent.id,
          providerInstanceId: subagent.providerInstanceId,
          providerThreadId: providerThread.id,
          providerSessionId: providerThread.providerSessionId,
          forkedFromProviderThreadId: forkThread.id,
          forkedFromProviderTurnId: fork?.providerTurnId ?? null,
          nativeThreadId: native.nativeId,
        });
        if (child.subagents.some((nested) => nested.remoteChild !== undefined)) {
          refusals.add("residual_descendant_remote");
        }
      }
    }
    pending = waiting;
  }
  if (pending.length > 0) refusals.add("residual_descendant_unbound");
  if (refusals.size > 0) return { scope: null, refusals: [...refusals].toSorted() };
  const [ownerHost] = owners;
  return {
    refusals: [],
    scope: {
      reservationId: input.reservationId,
      operationRef: input.operationRef,
      host: { platform: input.host.platform, machineId: input.host.machineId },
      servingProcess: { admittedIn: input.admittedIn!, ownerHost: ownerHost! },
      generations: containers
        .map(({ generationId, runId, machine, session }) => ({
          generationId,
          runId,
          machine,
          session,
        }))
        .toSorted((a, b) => a.generationId.localeCompare(b.generationId)),
      attempts: attempts.toSorted((a, b) => a.attemptId.localeCompare(b.attemptId)),
      nativeDescendants: nativeDescendants.toSorted((a, b) =>
        a.childThreadId.localeCompare(b.childThreadId),
      ),
    },
  };
};

/**
 * Why an owner's residual decision cannot be recorded: the scope's own refusals, and acceptance
 * that is not exactly the uncertainty no retained record settles.
 */
export const residualRefusals = (residual: {
  readonly accepted: ReadonlyArray<string>;
  readonly refusals: ReadonlyArray<string>;
}): ReadonlyArray<string> => [
  ...residual.refusals,
  ...(new Set(residual.accepted).size === residual.accepted.length &&
  sameSet(residual.accepted, RESIDUAL_UNCERTAINTIES)
    ? []
    : ["residual_mismatch"]),
];

/**
 * Why retained provenance does not show that restarting `host` ends every writer of this exact
 * execution and operation: it must name exactly the recorded runs, attempts, launches and sessions
 * on `host`, with only local processes there as executors. A remote, persistent or delegated writer
 * outlives the restart; absent or undecodable provenance proves nothing.
 */
export const provenanceRefusals = (input: {
  readonly provenance: HistoricalProvenance | "missing" | "malformed";
  readonly reservationId: string;
  readonly operationRef: string;
  readonly facts: Pick<QuarantineEvidence, "runs" | "attempts" | "launches">;
  readonly providerSessions: ReadonlyArray<string>;
  readonly host: Pick<HostBoot, "platform" | "machineId">;
}): ReadonlyArray<string> => {
  const { provenance, facts } = input;
  if (provenance === "missing") return ["historical_provenance_missing"];
  if (provenance === "malformed") return ["historical_provenance_malformed"];
  const launchKey = (runId: string, status: string, attempts: number) =>
    `${runId}\u0000${status}\u0000${attempts}`;
  return [
    ...(provenance.reservationId === input.reservationId ? [] : ["provenance_other_execution"]),
    ...(provenance.operationRef === input.operationRef ? [] : ["provenance_operation_mismatch"]),
    ...(sameSet(
      provenance.runs,
      facts.runs.map((run) => run.runId),
    )
      ? []
      : ["provenance_runs_incomplete"]),
    ...(sameSet(
      provenance.attempts,
      facts.attempts.map((attempt) => attempt.attemptId),
    )
      ? []
      : ["provenance_attempts_incomplete"]),
    ...(sameSet(
      provenance.launches.map((launch) =>
        launchKey(launch.runId, launch.status, launch.attemptCount),
      ),
      facts.launches.map((launch) => launchKey(launch.runId, launch.status, launch.attempts)),
    )
      ? []
      : ["provenance_launches_incomplete"]),
    ...(sameSet(provenance.providerSessions, input.providerSessions)
      ? []
      : ["provenance_sessions_incomplete"]),
    ...(provenance.host.platform === input.host.platform &&
    provenance.host.machineId === input.host.machineId
      ? []
      : ["historical_host_foreign"]),
    ...(provenance.executors.length === 0 ? ["provenance_executors_missing"] : []),
    ...(provenance.executors.some((executor) => executor.kind !== "local_process")
      ? ["executor_not_local"]
      : []),
    ...(provenance.executors.some((executor) => executor.machineId !== provenance.host.machineId)
      ? ["executor_foreign_host"]
      : []),
  ];
};

/**
 * Why a host restart cannot be bound to (`capture`) or proved for (`verify`) this execution. Both
 * need what quarantine needs, readable boot facts, and retained provenance placing every writer of
 * the execution on the captured host for this operation; verifying also needs that same provenance,
 * the captured operation and execution, every container ended, and a later boot of the same host.
 */
export const terminationRefusals = (input: {
  readonly action: "capture" | "verify";
  readonly facts: QuarantineEvidence;
  readonly executionDigest: string;
  readonly evidenceDigest: string;
  readonly operationRef: string;
  readonly servingId: string;
  readonly host: HostBoot | null;
  readonly recorded: FactoryStore.HistoricalTermination | undefined;
  readonly provenance: HistoricalProvenance | "missing" | "malformed";
  readonly provenanceDigest: string | null;
  readonly providerSessions: ReadonlyArray<string>;
  /**
   * The owner's residual decision, when given: what it accepts, the scope's refusals and digest.
   * It stands in for provenance only where none was retained, and never as provenance.
   */
  readonly residual?: {
    readonly accepted: ReadonlyArray<string>;
    readonly refusals: ReadonlyArray<string>;
    readonly scopeDigest: string | null;
  };
}): ReadonlyArray<string> => {
  const { facts, residual } = input;
  // Provenance places the historical writers on the host the capture read, never the one now.
  const boundHost = input.recorded?.capture.host ?? input.host;
  const eligibility = [
    ...quarantineRefusals({ ...facts, quarantine: null }, input.servingId),
    ...(facts.runs.some(
      (run) => run.started && (run.driver === null || !LOCAL_PROCESS_DRIVERS.has(run.driver)),
    )
      ? ["driver_not_local"]
      : []),
    ...(input.host === null ? ["host_boot_unreadable"] : []),
    ...(residual !== undefined && input.provenance !== "missing"
      ? ["residual_with_provenance"]
      : []),
    ...(boundHost === null
      ? []
      : residual !== undefined && input.provenance === "missing"
        ? residualRefusals(residual)
        : provenanceRefusals({
            provenance: input.provenance,
            reservationId: facts.reservation.reservationId,
            operationRef: input.operationRef,
            facts,
            providerSessions: input.providerSessions,
            host: boundHost,
          })),
  ];
  const recorded = input.recorded;
  if (recorded?.proof !== undefined) return ["already_proved", ...eligibility];
  if (input.action === "capture") {
    return recorded?.capture.evidenceDigest === input.evidenceDigest
      ? ["already_captured", ...eligibility]
      : eligibility;
  }
  if (recorded === undefined) return ["not_captured", ...eligibility];
  const { capture } = recorded;
  return [
    ...eligibility,
    ...(capture.operationRef === input.operationRef ? [] : ["operation_mismatch"]),
    ...(capture.executionDigest === input.executionDigest ? [] : ["execution_changed"]),
    // The very provenance, or the very residual scope, the capture bound; one read since may not.
    ...(residual !== undefined
      ? capture.residual !== undefined &&
        capture.residual.scopeDigest === residual.scopeDigest &&
        sameSet(capture.residual.accepted, residual.accepted)
        ? []
        : ["residual_scope_changed"]
      : capture.provenance !== undefined && capture.provenance.digest === input.provenanceDigest
        ? []
        : ["provenance_changed"]),
    ...(facts.runs.some((run) => run.generations.some((generation) => generation.state !== "ended"))
      ? ["container_not_ended"]
      : []),
    ...(input.host === null ? [] : bootBoundaryRefusals(capture.host, input.host)),
  ];
};
