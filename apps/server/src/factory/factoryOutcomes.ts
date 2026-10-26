// @effect-diagnostics nodeBuiltinImport:off - report digests need a stable sha256.
import * as NodeCrypto from "node:crypto";

import {
  type FactoryId,
  FactoryReportFailure,
  type FactoryReportInput,
  type FactoryReportResult,
  type ThreadId,
} from "@t3tools/contracts";
import { runRanAfter } from "@t3tools/shared/orchestrationV2ThreadError";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import type * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import { awaitsPullRequestChecks, type FactoryCustody, owedWakes } from "./factoryCustody.ts";
import type * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import type * as FactoryGitReadback from "./FactoryGitReadback.ts";
import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { AGENT_STAGES, expectedOutcomes, type FactoryStageType } from "./factoryStages.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** Keys sorted at every level, so equal reports have equal digests whatever their key order. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).toSorted(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : inner,
  );

/** The marker an outcome's tracker record carries, found before any write. */
const reportMarker = (outcomeId: string) => `<!-- t3-factory-report:${outcomeId} -->`;

export const subjectOf = (itemKey: string) => {
  const match = /^github:(.+)#(\d+)$/.exec(itemKey);
  return match === null ? undefined : { repository: match[1]!, issueNumber: Number(match[2]) };
};

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

const isReportFailure = Schema.is(FactoryReportFailure);

const reportFailure = (code: FactoryReportFailure["code"], message: string) =>
  new FactoryReportFailure({ code, message });

export type EnsureOperationError =
  | FactoryOperationStore.FactoryOperationStoreError
  | EffectOutbox.EffectOutboxError;

export interface FactoryOutcomeDependencies {
  readonly store: FactoryStore.FactoryStore["Service"];
  readonly outcomes: FactoryOutcomeStore.FactoryOutcomeStore["Service"];
  readonly projections: ProjectionStore.ProjectionStoreV2["Service"];
  readonly git: FactoryGitReadback.FactoryGitReadbackShape;
  readonly sessions: ProviderSessionManager.ProviderSessionManagerV2Shape;
  readonly generations: FactoryExecutionGenerations.FactoryExecutionGenerations["Service"];
  /** Read failures already read as unknown custody. */
  readonly custodyOf: (
    reservation: FactoryStore.FactoryReservation,
  ) => Effect.Effect<FactoryCustody>;
  /** Settles the stage's thread in the inbox under a command id stable across passes. */
  readonly settleThread: (
    reservation: FactoryStore.NativeReservation & { readonly origin: "admitted" },
  ) => Effect.Effect<unknown, Orchestrator.OrchestratorV2Error>;
  /** Asks for the pass that verifies a new report; a lost request leaves it for the next pass. */
  readonly onReported: (item: {
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryStore.FactoryReservation["itemKey"];
  }) => Effect.Effect<void>;
  /**
   * Records the operation's intent and gives it a live effect, in one commit; returns it as it
   * stands, so an applied write is never asked for again.
   */
  readonly ensureOperation: (input: {
    readonly operationId: string;
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryStore.FactoryReservation["itemKey"];
    readonly intent: FactoryOperationStore.FactoryOperationIntent;
  }) => Effect.Effect<FactoryOperationStore.FactoryOperation, EnsureOperationError>;
  readonly getOperation: (
    operationId: string,
  ) => Effect.Effect<
    Option.Option<FactoryOperationStore.FactoryOperation>,
    FactoryOperationStore.FactoryOperationStoreError
  >;
}

/**
 * An item's outcomes: reported by a stage's worker through the agent transport and bound to the
 * calling thread's own execution, or recorded by T3 for its own effects. Each is verified by
 * reading back what it claims and recorded on the tracker before anything depends on it.
 */
export const makeFactoryOutcomes = (deps: FactoryOutcomeDependencies) => {
  const { store, outcomes, projections, git, sessions, generations } = deps;

  /**
   * The run and attempt the calling thread is executing now: the run under way, else the latest
   * that started. A queued follow-up the user took back is cancelled without ever running.
   */
  const currentExecution = Effect.fnUntraced(function* (threadId: ThreadId) {
    const projection = yield* projections.getThreadProjection(threadId);
    let run = projection.runs.find((candidate) => ACTIVE_RUN_STATUSES.has(candidate.status));
    for (const candidate of run === undefined ? projection.runs : []) {
      if (candidate.startedAt !== null && (run === undefined || runRanAfter(candidate, run))) {
        run = candidate;
      }
    }
    if (run === undefined) return undefined;
    const attempt =
      projection.attempts.find((candidate) => candidate.id === run.activeAttemptId) ??
      projection.attempts.findLast((candidate) => candidate.runId === run.id);
    return { runId: run.id, attemptId: attempt?.id };
  });

  const report = Effect.fn("FactoryLifecycle.report")(
    function* (input: { readonly threadId: ThreadId; readonly report: FactoryReportInput }) {
      const binding = yield* store.bindingForThread(input.threadId);
      // Only a decision's own execution reports for it: never a descendant, never by name.
      if (
        Option.isNone(binding) ||
        binding.value.origin !== "admitted" ||
        binding.value.execution.threadId !== input.threadId ||
        !AGENT_STAGES.has(binding.value.taskKind as FactoryStageType)
      ) {
        return yield* reportFailure(
          "not_a_factory_execution",
          "This thread does not run a factory lifecycle stage.",
        );
      }
      const reservation = binding.value;
      const stage = reservation.taskKind as FactoryStageType;
      const kind = input.report.outcome;
      if (!expectedOutcomes[stage].includes(kind)) {
        return yield* reportFailure(
          "outcome_not_expected",
          `A ${stage} stage reports one of: ${expectedOutcomes[stage].join(", ")}.`,
        );
      }
      const subject = input.report.subject;
      const missing =
        (kind === "implemented" &&
          (subject?.headCommit === undefined || subject.baseCommit === undefined)) ||
        ((kind === "review_passed" || kind === "review_failed") &&
          subject?.headCommit === undefined) ||
        ((kind === "failed" || kind === "review_failed") && input.report.failure === undefined);
      if (missing) {
        return yield* reportFailure(
          "subject_missing",
          `A ${kind} report names exactly what it produced or examined.`,
        );
      }
      const execution = yield* currentExecution(input.threadId);
      if (execution === undefined) {
        return yield* reportFailure("unavailable", "This thread has no run to bind the report to.");
      }
      const reportDigest = sha256(canonical(input.report));
      const outcomeId = sha256(
        canonical([reservation.reservationId, execution.runId, reportDigest]),
      ).slice(0, 40);
      const corrects =
        stage === "correct" && reservation.stageBasis?.startsWith("correct:") === true
          ? reservation.stageBasis.slice("correct:".length).split(":retry:")[0]
          : undefined;
      const inserted = yield* outcomes.insertReported({
        outcomeId,
        factoryId: reservation.factoryId,
        itemKey: reservation.itemKey,
        origin: {
          type: "execution",
          reservationId: reservation.reservationId,
          threadId: input.threadId,
          runId: execution.runId,
          ...(execution.attemptId === undefined ? {} : { attemptId: execution.attemptId }),
        },
        stage,
        report: input.report,
        reportDigest,
        ...(input.report.failure === undefined
          ? {}
          : { failureDigest: sha256(input.report.failure) }),
        ...(corrects === undefined ? {} : { corrects }),
        reportedAt: DateTime.formatIso(yield* DateTime.now),
        state: "reported",
      });
      // Verified by the factory's next collection pass, which alone verifies its outcomes.
      yield* deps.onReported({ factoryId: reservation.factoryId, itemKey: reservation.itemKey });
      return {
        outcomeId,
        state: inserted === "inserted" ? "reported" : "already_reported",
      } satisfies FactoryReportResult;
    },
    (effect) =>
      effect.pipe(
        Effect.mapError((error) =>
          isReportFailure(error) ? error : reportFailure("unavailable", String(error)),
        ),
      ),
  );

  /** What an execution's outcome claims, read back; a reason when it is not so. */
  const check = Effect.fnUntraced(function* (
    outcome: FactoryOutcomeStore.ReportedOutcome,
    configuration: FactoryStore.FactoryConfiguration,
  ) {
    if (outcome.origin.type === "native") return { accepted: true } as const;
    const reservation = yield* store.getReservation(outcome.origin.reservationId);
    if (Option.isNone(reservation) || reservation.value.origin !== "admitted") {
      return { rejected: "its execution is not an admitted stage" } as const;
    }
    const projectId = configuration.projectId;
    const { report } = outcome;
    const basis = reservation.value.stageBasis ?? "";
    switch (report.outcome) {
      case "implemented": {
        const head = report.subject!.headCommit!;
        if (!(yield* git.commitExists({ projectId, commit: head }))) {
          return { rejected: `head ${head} does not exist` } as const;
        }
        const base = report.subject!.baseCommit!;
        if (!(yield* git.isAncestor({ projectId, ancestor: base, descendant: head }))) {
          return { rejected: `base ${base} is not an ancestor of head ${head}` } as const;
        }
        return { accepted: true } as const;
      }
      case "review_passed":
      case "review_failed": {
        // An independent review counts only for the exact head its decision was admitted for.
        const head = report.subject!.headCommit!;
        return basis === `review:${head}` || basis.startsWith(`review:${head}:retry:`)
          ? ({ accepted: true } as const)
          : ({ rejected: `the review names ${head}, not the head it was admitted for` } as const);
      }
      case "failed":
      case "correction_spec":
        // Bound to its execution and report digest; it authorizes no integration by itself.
        return { accepted: true } as const;
      case "integrated":
      case "closed":
        return { rejected: "only T3 records integration and closure" } as const;
    }
  });

  /**
   * Its tracker record, written once through an operation whose intent commits first. Undefined
   * while the write is not yet read back.
   */
  const record = Effect.fnUntraced(function* (
    outcome: FactoryOutcomeStore.ReportedOutcome,
    configuration: FactoryStore.FactoryConfiguration,
  ) {
    const subject = subjectOf(outcome.itemKey);
    if (configuration.claim === undefined || subject === undefined) {
      return { trackerCommentId: undefined };
    }
    // A closure's own closing record is its tracker record.
    if (outcome.report.outcome === "closed" && outcome.origin.type === "native") {
      const closing =
        outcome.origin.operationId === undefined
          ? Option.none()
          : yield* deps.getOperation(outcome.origin.operationId);
      if (Option.isSome(closing) && closing.value.state === "applied") {
        const receipt = closing.value.receipt;
        return { trackerCommentId: "commentId" in receipt ? receipt.commentId : undefined };
      }
    }
    const marker = reportMarker(outcome.outcomeId);
    const operation = yield* deps.ensureOperation({
      operationId: `report:${outcome.outcomeId}`,
      factoryId: outcome.factoryId,
      itemKey: outcome.itemKey,
      intent: {
        kind: "tracker_comment",
        ...subject,
        purpose: "report",
        ref: outcome.outcomeId,
        marker,
        body: [
          marker,
          `Factory ${outcome.stage} outcome: ${outcome.report.outcome}.`,
          outcome.report.summary,
          ...(outcome.report.integration === undefined
            ? []
            : [
                `Landed ${outcome.report.integration.mergeCommit} on ${outcome.report.integration.targetBranch} (parents ${outcome.report.integration.parents.join(", ")}).`,
              ]),
          `report sha256: ${outcome.reportDigest}`,
        ].join("\n\n"),
      },
    });
    if (operation.state === "applied") {
      const receipt = operation.receipt;
      return { trackerCommentId: "commentId" in receipt ? receipt.commentId : undefined };
    }
    // T3's own record of a missing result is native fact, not a worker's claim awaiting proof:
    // its tracker record is written, but recovery does not wait an extra pass for it.
    const recovery =
      outcome.origin.type === "native" &&
      outcome.origin.reservationId !== undefined &&
      outcome.report.outcome === "failed";
    return recovery ? { trackerCommentId: undefined } : undefined;
  });

  const verify = Effect.fn("FactoryLifecycle.verifyOutcome")(function* (outcomeId: string) {
    const stored = yield* outcomes.get(outcomeId);
    if (Option.isNone(stored) || stored.value.state !== "reported") return;
    const outcome = stored.value;
    const configuration = yield* store.getConfiguration(outcome.factoryId);
    if (Option.isNone(configuration)) return;
    const checked = yield* check(outcome, configuration.value);
    if ("rejected" in checked) {
      yield* outcomes.markRejected({ outcomeId, rejection: checked.rejected });
      return;
    }
    const recorded = yield* record(outcome, configuration.value);
    // Not known yet whether the record landed: it stays reported, and is read back next time.
    if (recorded === undefined) return;
    yield* outcomes.markVerified({
      outcomeId,
      receipt: {
        verifiedAt: DateTime.formatIso(yield* DateTime.now),
        ...(recorded.trackerCommentId === undefined
          ? {}
          : { trackerCommentId: recorded.trackerCommentId }),
      },
    });
    const reservationId = outcome.origin.reservationId;
    if (reservationId !== undefined) {
      const reservation = yield* store.getReservation(reservationId);
      if (Option.isSome(reservation)) yield* settle(reservation.value);
    }
  });

  /**
   * Closes an idle provider session the stage left and awaits its actual exit, so a quiet
   * execution is not held only by its cached session. Anything still running stays live.
   */
  const quietCustody = Effect.fnUntraced(function* (
    reservation: FactoryStore.NativeReservation & { readonly origin: "admitted" },
  ) {
    let custody = yield* deps.custodyOf(reservation);
    if (
      custody.state === "live" &&
      custody.reasons.every((reason) => reason === "contained_processes")
    ) {
      const projection = yield* projections.getThreadProjection(reservation.execution.threadId);
      for (const providerThread of projection.providerThreads) {
        const sessionId = providerThread.providerSessionId;
        if (sessionId !== null && (yield* sessions.isLive(sessionId))) {
          yield* sessions.close(sessionId).pipe(Effect.ignore);
        }
      }
      for (const run of projection.runs) {
        yield* generations.awaitProviderExits(run.id);
        yield* generations.closeIfQuiet(run.id);
      }
      custody = yield* deps.custodyOf(reservation);
    }
    return custody;
  });

  /**
   * Releases a stage's reservation once an outcome of it is verified and its execution is
   * proved quiet. Settling a thread in the inbox proves neither.
   */
  const settle = Effect.fnUntraced(function* (reservation: FactoryStore.FactoryReservation) {
    if (reservation.origin !== "admitted" || reservation.state !== "held") return false;
    const verified = (yield* outcomes.listForOrigin(reservation.reservationId)).some(
      (outcome) => outcome.state === "verified",
    );
    if (!verified) return false;
    const custody = yield* quietCustody(reservation);
    if (custody.state !== "quiescent") return false;
    return yield* store.releaseReservation(reservation.reservationId, "outcome_verified");
  });

  /**
   * Settles a released stage's thread once nothing on it is owed; a person's un-settle or any
   * owed work leaves it for a later pass. One command id per stage: a replay is a no-op.
   */
  const settleStageThread = Effect.fnUntraced(function* (
    reservation: FactoryStore.NativeReservation & { readonly origin: "admitted" },
  ) {
    const projection = yield* projections.getThreadProjection(reservation.execution.threadId);
    const { thread } = projection;
    if (
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.settledOverride !== null ||
      !projection.runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status)) ||
      projection.runtimeRequests.some((request) => request.status === "pending") ||
      owedWakes(projection).length > 0 ||
      awaitsPullRequestChecks(thread) ||
      projection.providerThreads.some(
        (candidate) => (candidate.pendingBackgroundTasks?.length ?? 0) > 0,
      )
    ) {
      return;
    }
    yield* deps
      .settleThread(reservation)
      .pipe(Effect.catchTags({ OrchestratorCommandPreviouslyRejectedError: () => Effect.void }));
  });

  /**
   * A stage whose execution ended and is proved quiet, with no result it reported, gets that
   * fact recorded as its typed failure, so correction or a retry follows. Unknown custody keeps
   * it held, however long it waits.
   */
  const disposeMissingResult = Effect.fnUntraced(function* (
    reservation: FactoryStore.FactoryReservation,
  ) {
    if (
      reservation.origin !== "admitted" ||
      reservation.state !== "held" ||
      !AGENT_STAGES.has(reservation.taskKind as FactoryStageType)
    ) {
      return;
    }
    const filed = yield* outcomes.listForOrigin(reservation.reservationId);
    if (filed.some((outcome) => outcome.state === "reported" || outcome.state === "verified")) {
      return;
    }
    const projection = yield* projections.getThreadProjection(reservation.execution.threadId);
    const runs = projection.runs;
    if (runs.length === 0 || !runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status))) return;
    // A background completion the fence refused to deliver is still owed to this execution: its
    // result is not missing, and the wake is delivered again once the execution is proved quiet.
    if (owedWakes(projection).length > 0 || awaitsPullRequestChecks(projection.thread)) return;
    const custody = yield* quietCustody(reservation);
    if (custody.state !== "quiescent") return;
    const rejected = filed.flatMap((outcome) =>
      outcome.state === "rejected" ? [outcome.rejection] : [],
    );
    const failure = [
      `The ${reservation.taskKind} execution ended (${runs.map((run) => run.status).join(", ")}) without a verified result.`,
      ...rejected.map((reason) => `Its report was rejected: ${reason}`),
    ].join(" ");
    const outcomeReport: FactoryOutcomeStore.FactoryOutcomeReport = {
      outcome: "failed",
      failure,
      summary: "No result was reported.",
    };
    yield* outcomes.insertReported({
      outcomeId: `no-result:${reservation.reservationId}`,
      factoryId: reservation.factoryId,
      itemKey: reservation.itemKey,
      origin: { type: "native", reservationId: reservation.reservationId },
      stage: reservation.taskKind as FactoryStageType,
      report: outcomeReport,
      reportDigest: sha256(canonical(outcomeReport)),
      failureDigest: sha256(`${reservation.reservationId}\n${failure}`),
      reportedAt: DateTime.formatIso(yield* DateTime.now),
      state: "reported",
    });
  });

  /**
   * Missing results recorded, every reported outcome verified, and every verified stage settled
   * with its thread; at the start of each collection pass.
   */
  const reconcile = Effect.fn("FactoryLifecycle.reconcileOutcomes")(function* (
    factoryId: FactoryId,
  ) {
    const logged = (what: string) => (cause: Cause.Cause<unknown>) =>
      Effect.logWarning(`Factory ${what} will resume on the next pass`, {
        factoryId,
        cause: Cause.pretty(cause),
      });
    for (const reservation of yield* store.listReservations(factoryId)) {
      yield* disposeMissingResult(reservation).pipe(Effect.catchCause(logged("result recovery")));
    }
    for (const outcome of yield* outcomes.listReported(factoryId)) {
      yield* verify(outcome.outcomeId).pipe(Effect.catchCause(logged("outcome verification")));
    }
    for (const reservation of yield* store.listReservations(factoryId)) {
      const released = yield* settle(reservation).pipe(
        Effect.catchCause(() => Effect.succeed(false)),
      );
      // The thread settles on the pass that released its stage, or on any later one.
      if (
        reservation.origin === "admitted" &&
        (released ||
          (reservation.state === "released" && reservation.releasedReason === "outcome_verified"))
      ) {
        yield* settleStageThread(reservation).pipe(
          Effect.catchCause(logged("stage thread settlement")),
        );
      }
    }
  });

  return { report, verify, settle, reconcile };
};
