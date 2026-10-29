import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { START_REFUSAL_SIGNALS, type FactoryCustody } from "./factoryCustody.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
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

/**
 * Why the evidence cannot carry an owner's quarantine of a historical stage; empty when it can.
 * Only a stage that ran to a verified report, whose runs are all over, under a build that admitted
 * it before this serving process and whose provider never joined any container, qualifies: its
 * custody is unknown only for want of that join, never because anything is live or unread.
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
