// @effect-diagnostics nodeBuiltinImport:off - report digests need a stable sha256.
import * as NodeCrypto from "node:crypto";

import {
  type FactoryId,
  FactoryReportFailure,
  type FactoryReportInput,
  type FactoryReportResult,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ThreadProjection,
  type ProviderSessionId,
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
import {
  awaitsPullRequestChecks,
  type FactoryCustody,
  owedWakes,
  preparationFailures,
} from "./factoryCustody.ts";
import type * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import type * as FactoryGitReadback from "./FactoryGitReadback.ts";
import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { AGENT_STAGES, expectedOutcomes, type FactoryStageType } from "./factoryStages.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** The outcome id prefix of a stage's recorded missing result. */
const MISSING_RESULT = "no-result:";

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

/** The branch T3 lands work on in the project's own repository; a remote's copy may be stale. */
const localIntegrationBranch = (configuration: FactoryStore.FactoryConfiguration) => {
  const integration = configuration.integration;
  return integration !== undefined &&
    integration.mode !== "pull_request" &&
    integration.remote === null
    ? integration.branch
    : undefined;
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

/**
 * Every run ended and nothing is owed. A background completion the fence refused to deliver is
 * still owed to its execution: its result is not missing, and the wake is delivered again once
 * the execution is proved quiet.
 */
const endedWithNothingOwed = (projection: OrchestrationV2ThreadProjection) =>
  projection.runs.length > 0 &&
  projection.runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status)) &&
  owedWakes(projection).length === 0 &&
  !awaitsPullRequestChecks(projection.thread);

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
  /**
   * The digest of the reported artifacts when every one is inside the artifact root and its bytes
   * match its reported sha256; undefined when there are none or any cannot be verified.
   */
  readonly verifyEvidence: (
    artifactRoot: string,
    artifacts: ReadonlyArray<{ readonly path: string; readonly sha256: string }>,
  ) => Effect.Effect<string | undefined>;
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
        ((kind === "failed" || kind === "review_failed" || kind === "not_actionable") &&
          input.report.failure === undefined) ||
        (kind === "unit_proposed" &&
          (input.report.proposal === undefined || input.report.proposal.unit.trim() === ""));
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
        // Ancestry of an unknown object is a read failure, so a missing base would never settle.
        if (!(yield* git.commitExists({ projectId, commit: base }))) {
          return { rejected: `base ${base} does not exist` } as const;
        }
        if (!(yield* git.isAncestor({ projectId, ancestor: base, descendant: head }))) {
          return { rejected: `base ${base} is not an ancestor of head ${head}` } as const;
        }
        // Unverifiable evidence is not refused, it is simply not evidence: it earns no new review.
        const evidenceDigest =
          report.artifacts === undefined || report.artifacts.length === 0
            ? undefined
            : yield* deps.verifyEvidence(configuration.artifactRoot, report.artifacts);
        return { accepted: true, evidenceDigest } as const;
      }
      case "review_passed":
      case "review_failed": {
        // An independent review counts only for the exact head its decision was admitted for.
        const head = report.subject!.headCommit!;
        return basis === `review:${head}` || basis.startsWith(`review:${head}:`)
          ? ({ accepted: true } as const)
          : ({ rejected: `the review names ${head}, not the head it was admitted for` } as const);
      }
      case "failed":
      case "correction_spec":
      case "not_actionable":
        // Bound to its execution and report digest; it authorizes no integration by itself.
        return { accepted: true } as const;
      case "unit_proposed": {
        // A proposal counts only for the exact item text the triage read.
        const proposed = report.proposal?.basis;
        if (proposed !== reservation.value.itemVersion) {
          return {
            rejected: `the proposal names item version ${proposed ?? "none"}, not ${reservation.value.itemVersion}`,
          } as const;
        }
        // A named candidate base is a claim like any other: the work starts from it only if T3 reads it.
        const base = report.subject?.baseCommit;
        if (base === undefined) return { accepted: true } as const;
        if (!(yield* git.commitExists({ projectId, commit: base }))) {
          return { rejected: `base ${base} does not exist` } as const;
        }
        const branch = localIntegrationBranch(configuration);
        if (branch === undefined || !(yield* git.branchExists({ projectId, branch }))) {
          return { accepted: true } as const;
        }
        return (yield* git.isAncestor({
          projectId,
          ancestor: base,
          descendant: `refs/heads/${branch}`,
        }))
          ? ({ accepted: true } as const)
          : ({ rejected: `base ${base} is not on the integration branch ${branch}` } as const);
      }
      case "integrated":
      case "closed":
      case "ticket_opened":
        return { rejected: "only T3 records integration, closure and opened tickets" } as const;
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
          // The proposed unit spec is shown where its people read the issue; it is evidence, not
          // a change to the issue's own text.
          ...(outcome.report.proposal === undefined
            ? []
            : [
                `Proposed unit for item version ${outcome.report.proposal.basis} (owned files: ${outcome.report.proposal.ownedFiles.join(", ") || "none"}; resources: ${outcome.report.proposal.resources?.join(", ") || "none"}${outcome.report.proposal.effort === undefined ? "" : `; effort: ${outcome.report.proposal.effort}`}):\n\n${outcome.report.proposal.unit}`,
                ...(outcome.report.proposal.splits === undefined ||
                outcome.report.proposal.splits.length === 0
                  ? []
                  : [
                      `Proposed split:\n${outcome.report.proposal.splits.map((split) => `- ${split}`).join("\n")}`,
                    ]),
              ]),
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
      ...("evidenceDigest" in checked ? { evidenceDigest: checked.evidenceDigest } : {}),
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

  /** Whether a live session's runtime may still deliver work; an unanswered probe says it may. */
  const mayStillDeliver = (
    providerThread: OrchestrationV2ProviderThread,
    sessionId: ProviderSessionId,
  ) =>
    sessions.get(sessionId).pipe(
      Effect.flatMap((runtime) => {
        if (Option.isNone(runtime)) return Effect.succeed(false);
        const { hasPendingBackgroundWork, hasPendingBackgroundWorkForThread } = runtime.value;
        return hasPendingBackgroundWorkForThread !== undefined
          ? hasPendingBackgroundWorkForThread(providerThread)
          : (hasPendingBackgroundWork ?? Effect.succeed(false));
      }),
      Effect.catchCause(() => Effect.succeed(true)),
    );

  /**
   * Closes an idle provider session the stage left and awaits its actual exit, so a quiet
   * execution is not held only by its cached session. Anything still running stays live,
   * including a wake whose run is not yet recorded.
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
      if (
        !projection.runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status)) ||
        owedWakes(projection).length > 0
      ) {
        return custody;
      }
      const idle: Array<ProviderSessionId> = [];
      for (const providerThread of projection.providerThreads) {
        const sessionId = providerThread.providerSessionId;
        if (sessionId === null || !(yield* sessions.isLive(sessionId))) continue;
        if (yield* mayStillDeliver(providerThread, sessionId)) return custody;
        idle.push(sessionId);
      }
      for (const sessionId of idle) {
        yield* sessions.close(sessionId).pipe(Effect.ignore);
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
    if (custody.state === "quiescent") {
      return yield* store.releaseReservation(reservation.reservationId, "outcome_verified");
    }
    return false;
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
    const before = yield* projections.getThreadProjection(reservation.execution.threadId);
    if (!endedWithNothingOwed(before)) return;
    const custody = yield* quietCustody(reservation);
    if (custody.state !== "quiescent") return;
    // A wake recorded while its session closed is owed, not a missing result.
    const projection = yield* projections.getThreadProjection(reservation.execution.threadId);
    const runs = projection.runs;
    if (
      !endedWithNothingOwed(projection) ||
      runs.map((run) => run.id).join("\n") !== before.runs.map((run) => run.id).join("\n")
    ) {
      return;
    }
    const rejected = filed.flatMap((outcome) =>
      outcome.state === "rejected" ? [outcome.rejection] : [],
    );
    const failure = [
      `The ${reservation.taskKind} execution ended (${runs.map((run) => run.status).join(", ")}) without a verified result.`,
      ...[...preparationFailures(projection).values()].map(
        (message) => `It never started: ${message}`,
      ),
      ...rejected.map((reason) => `Its report was rejected: ${reason}`),
    ].join(" ");
    const outcomeReport: FactoryOutcomeStore.FactoryOutcomeReport = {
      outcome: "failed",
      failure,
      summary: "No result was reported.",
    };
    // The same stage ending without a result on the same footing is the same failure, however
    // often it repeats, so a fast-failing worker cannot refill it (HSA #94). A review or
    // correction stands on its basis, without its retry. A build stands on the last real failure
    // it answers: each correction of its missing result is a new spec, not new evidence.
    const basis =
      reservation.stageBasis === undefined
        ? undefined
        : reservation.taskKind === "implement" || reservation.taskKind === "rework"
          ? `${reservation.taskKind}:${yield* answeredFailure(reservation)}`
          : reservation.stageBasis.replace(/:retry:[^:]+/, "");
    yield* outcomes.insertReported({
      outcomeId: `${MISSING_RESULT}${reservation.reservationId}`,
      factoryId: reservation.factoryId,
      itemKey: reservation.itemKey,
      origin: { type: "native", reservationId: reservation.reservationId },
      stage: reservation.taskKind as FactoryStageType,
      report: outcomeReport,
      reportDigest: sha256(canonical(outcomeReport)),
      failureDigest:
        basis === undefined
          ? sha256(`${reservation.reservationId}\n${failure}`)
          : sha256(`no-result\n${basis}`),
      reportedAt: DateTime.formatIso(yield* DateTime.now),
      state: "reported",
    });
  });

  /** The last real failure of the item's current version: never a missing result itself. */
  const answeredFailure = Effect.fnUntraced(function* (
    reservation: FactoryStore.FactoryReservation,
  ) {
    const events = yield* outcomes.itemEvents({
      factoryId: reservation.factoryId,
      itemKey: reservation.itemKey,
    });
    for (const event of events.toReversed()) {
      // With no real failure yet, a reopened item's version is its own footing, never the last one's.
      if (event.type === "reopened") return `reopen:${event.closureOutcomeId}`;
      if (event.type === "rejected") return event.failureDigest;
      if (
        event.type === "outcome" &&
        (event.kind === "failed" || event.kind === "review_failed") &&
        event.failureDigest !== undefined &&
        !event.outcomeId.startsWith(MISSING_RESULT)
      ) {
        return event.failureDigest;
      }
    }
    return "none";
  });

  const disposeAttested = Effect.fn("FactoryLifecycle.disposeAttestedOutcome")(function* (
    reservation: FactoryStore.NativeReservation & { readonly origin: "admitted" },
    attestation: { readonly by: string; readonly reason: string; readonly evidenceDigest: string },
  ) {
    if (!AGENT_STAGES.has(reservation.taskKind as FactoryStageType)) return false;
    const filed = yield* outcomes.listForOrigin(reservation.reservationId);
    if (filed.some((outcome) => outcome.state === "reported" || outcome.state === "verified"))
      return false;
    const projection = yield* projections.getThreadProjection(reservation.execution.threadId);
    if (owedWakes(projection).length > 0 || awaitsPullRequestChecks(projection.thread))
      return false;
    const failure = [
      `The ${reservation.taskKind} execution ended (${projection.runs.map((run) => run.status).join(", ")}) without a verified result.`,
      ...[...preparationFailures(projection).values()].map(
        (message) => `It never started: ${message}`,
      ),
      `The owner attested that it never started (${attestation.by}: ${attestation.reason}; evidence ${attestation.evidenceDigest}); nothing proves its preparation history.`,
      ...filed.flatMap((outcome) =>
        outcome.state === "rejected" ? [`Its report was rejected: ${outcome.rejection}`] : [],
      ),
    ].join(" ");
    const report: FactoryOutcomeStore.FactoryOutcomeReport = {
      outcome: "failed",
      failure,
      summary: "No result was reported.",
    };
    const basis =
      reservation.stageBasis === undefined
        ? undefined
        : reservation.taskKind === "implement" || reservation.taskKind === "rework"
          ? `${reservation.taskKind}:${yield* answeredFailure(reservation)}`
          : reservation.stageBasis.replace(/:retry:[^:]+/, "");
    const outcomeId = `${MISSING_RESULT}${reservation.reservationId}`;
    const inserted = yield* outcomes.insertReported({
      outcomeId,
      factoryId: reservation.factoryId,
      itemKey: reservation.itemKey,
      origin: { type: "native", reservationId: reservation.reservationId },
      stage: reservation.taskKind as FactoryStageType,
      report,
      reportDigest: sha256(canonical(report)),
      failureDigest:
        basis === undefined
          ? sha256(`${reservation.reservationId}\n${failure}`)
          : sha256(`no-result\n${basis}`),
      reportedAt: DateTime.formatIso(yield* DateTime.now),
      state: "reported",
    });
    if (inserted !== "inserted") return false;
    const stored = yield* outcomes.get(outcomeId);
    const configuration = yield* store.getConfiguration(reservation.factoryId);
    if (
      Option.isNone(stored) ||
      stored.value.state !== "reported" ||
      Option.isNone(configuration)
    ) {
      return yield* Effect.die(new Error("Disposition outcome or configuration disappeared"));
    }
    yield* record(stored.value, configuration.value);
    if (
      !(yield* outcomes.markVerified({
        outcomeId,
        receipt: { verifiedAt: DateTime.formatIso(yield* DateTime.now) },
      }))
    ) {
      return yield* Effect.die(new Error("Disposition outcome could not be verified"));
    }
    return true;
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
          (reservation.state === "released" &&
            (reservation.releasedReason === "outcome_verified" ||
              reservation.releasedReason === "owner_disposition")))
      ) {
        yield* settleStageThread(reservation).pipe(
          Effect.catchCause(logged("stage thread settlement")),
        );
      }
    }
  });

  return { report, verify, settle, reconcile, disposeAttested };
};
