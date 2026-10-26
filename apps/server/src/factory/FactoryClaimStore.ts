import {
  CommandId,
  type OrchestrationV2FactoryAdmission,
  FactoryClaimCarrierKey,
  FactoryId,
  FactoryItemKey,
  FactoryObservationId,
  FactoryReadGeneration,
  FactoryReservationId,
  ModelSelection,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  PositiveInt,
  ProviderDriverKind,
  RunAttemptId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { commentCarrierKeyOf } from "./factoryClaimPolicy.ts";
import type { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import * as FactoryStore from "./FactoryStore.ts";

export class FactoryClaimStoreError extends Schema.TaggedError<FactoryClaimStoreError>()(
  "FactoryClaimStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory claim store ${this.operation} failed.`;
  }
}

const Bounded = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const FactoryClaimTarget = Schema.Struct({
  host: Bounded,
  repository: Bounded,
  issueNumber: PositiveInt,
});
export type FactoryClaimTarget = typeof FactoryClaimTarget.Type;

/** Why a first start may not happen now; checked natively at prepare, settle and start. */
export const FirstStartFenceFailure = Schema.Literals([
  "reservation_not_held",
  "configuration_changed",
  "factory_paused",
  "deadline_expired",
  "source_changed",
]);
export type FirstStartFenceFailure = typeof FirstStartFenceFailure.Type;

/** Why a claim that wrote nothing gave its unit back. */
export const FactoryClaimReleaseReason = Schema.Literals([
  ...FirstStartFenceFailure.literals,
  "claim_account_mismatch",
  "foreign_claim",
  "helper_changed",
  "create_rejected",
]);
export type FactoryClaimReleaseReason = typeof FactoryClaimReleaseReason.Type;

/** Why a claim whose comment is ours may not start the execution. */
export const FactoryClaimStaleReason = Schema.Literals([
  ...FirstStartFenceFailure.literals,
  "first_start_fence",
  "claim_account_mismatch",
  "foreign_claim",
  "helper_changed",
  "own_claim_missing",
  "own_claim_changed",
  "workspace_preparation_unknown",
  "workspace_preparation_failed",
  "workspace_preparation_cancelled",
]);
export type FactoryClaimStaleReason = typeof FactoryClaimStaleReason.Type;

/** The holds a lost, failed or cancelled preparation of the claim's own run leaves behind. */
export const PREPARATION_HOLD_REASONS: ReadonlySet<FactoryClaimStaleReason> = new Set([
  "workspace_preparation_unknown",
  "workspace_preparation_failed",
  "workspace_preparation_cancelled",
]);

const PendingClaim = { state: Schema.Literal("pending") };
const WritingClaim = { state: Schema.Literal("writing") };
const VerifiedClaim = { state: Schema.Literal("verified"), carrierKey: FactoryClaimCarrierKey };
/**
 * Authorized to prepare one run's workspace: the receipt that workspace work may have begun, so
 * it is never begun again from here.
 */
const WorkspaceAuthorizedClaim = {
  state: Schema.Literal("workspace_authorized"),
  carrierKey: FactoryClaimCarrierKey,
  runId: RunId,
};
const StaleClaim = {
  state: Schema.Literal("stale_after_claim"),
  carrierKey: FactoryClaimCarrierKey,
  reason: FactoryClaimStaleReason,
};
const ForeignConflictedClaim = {
  state: Schema.Literal("conflicted"),
  reason: Schema.Literal("foreign_claim"),
  carrierKey: FactoryClaimCarrierKey,
};
/** Our request applied, but the comment read back is not what it sent: nothing is certified. */
const ChangedConflictedClaim = {
  state: Schema.Literal("conflicted"),
  reason: Schema.Literal("own_comment_changed"),
  commentId: PositiveInt,
};
const UnknownClaim = {
  state: Schema.Literal("unknown"),
  reason: Schema.Literal("create_ambiguous"),
};
const ReleasedClaim = { state: Schema.Literal("released"), reason: FactoryClaimReleaseReason };

/** What a claim may do now; each state carries the receipt that put it there. */
export const FactoryClaimDisposition = Schema.Union([
  // Nothing was ever sent.
  Schema.Struct(PendingClaim),
  // One attempt is prepared or written; only a durable response decides it.
  Schema.Struct(WritingClaim),
  // Our own comment was read back; the execution may start.
  Schema.Struct(VerifiedClaim),
  // Verified, and one run's workspace preparation was authorized.
  Schema.Struct(WorkspaceAuthorizedClaim),
  // Our comment exists but the item or a first-start fence changed.
  Schema.Struct(StaleClaim),
  // Our request applied, and a foreign claim exists or our comment changed.
  Schema.Struct(ForeignConflictedClaim),
  Schema.Struct(ChangedConflictedClaim),
  // An attempt may have applied and nothing proves it either way.
  Schema.Struct(UnknownClaim),
  // Nothing was written and nothing ran.
  Schema.Struct(ReleasedClaim),
]);
export type FactoryClaimDisposition = typeof FactoryClaimDisposition.Type;
export type FactoryClaimState = FactoryClaimDisposition["state"];

const ClaimFields = {
  reservationId: FactoryReservationId,
  operationId: Bounded,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  threadId: ThreadId,
  target: FactoryClaimTarget,
  /** The execution's first message, sent only by the commit that verifies the claim. */
  launch: Schema.Struct({
    messageCommandId: CommandId,
    prompt: TrimmedNonEmptyString,
    modelSelection: ModelSelection,
    workspaceStrategy: Schema.optional(OrchestrationV2ThreadLaunchWorkspaceStrategy),
  }),
  admitted: Schema.Struct({
    observationId: FactoryObservationId,
    generation: FactoryReadGeneration,
    basisDigest: Bounded,
    configRevision: PositiveInt,
    deadline: Schema.String,
  }),
  updatedAt: Schema.String,
};

export const FactoryClaimRecord = Schema.Union([
  Schema.Struct({ ...ClaimFields, ...PendingClaim }),
  Schema.Struct({ ...ClaimFields, ...WritingClaim }),
  Schema.Struct({ ...ClaimFields, ...VerifiedClaim }),
  Schema.Struct({ ...ClaimFields, ...WorkspaceAuthorizedClaim }),
  Schema.Struct({ ...ClaimFields, ...StaleClaim }),
  Schema.Struct({ ...ClaimFields, ...ForeignConflictedClaim }),
  Schema.Struct({ ...ClaimFields, ...ChangedConflictedClaim }),
  Schema.Struct({ ...ClaimFields, ...UnknownClaim }),
  Schema.Struct({ ...ClaimFields, ...ReleasedClaim }),
]);
export type FactoryClaimRecord = typeof FactoryClaimRecord.Type;
export type VerifiedFactoryClaim = Extract<
  FactoryClaimRecord,
  { readonly state: "verified" | "workspace_authorized" }
>;

/** The moves a claim may make; the held outcomes have none until an owner disposes of them. */
const claimMoves: Record<FactoryClaimState, ReadonlyArray<FactoryClaimState>> = {
  pending: ["writing", "released"],
  writing: ["pending", "released", "unknown", "verified", "stale_after_claim", "conflicted"],
  verified: ["workspace_authorized", "stale_after_claim", "conflicted"],
  workspace_authorized: ["stale_after_claim", "conflicted"],
  stale_after_claim: [],
  conflicted: [],
  unknown: [],
  released: [],
};

const AttemptFields = {
  reservationId: FactoryReservationId,
  attempt: PositiveInt,
  /** Generated before the request and disclosed only in its body. */
  nonce: Bounded,
  accountId: Bounded,
};
const RejectedOutcome = {
  phase: Schema.Literal("rejected"),
  /** The typed failure that proved the request did not apply, as reported. */
  cause: Schema.String,
  transient: Schema.Boolean,
};
const AmbiguousOutcome = { phase: Schema.Literal("ambiguous"), cause: Schema.String };
const WrittenOutcome = { phase: Schema.Literal("written"), commentId: PositiveInt };
const VerifiedOutcome = {
  phase: Schema.Literal("verified"),
  commentId: PositiveInt,
  commentDigest: Bounded,
};

/** What one request did, as far as durable answers prove; only its preparer records it. */
export const FactoryClaimAttemptOutcome = Schema.Union([
  Schema.Struct(RejectedOutcome),
  Schema.Struct(AmbiguousOutcome),
  Schema.Struct(WrittenOutcome),
  Schema.Struct(VerifiedOutcome),
]);
export type FactoryClaimAttemptOutcome = typeof FactoryClaimAttemptOutcome.Type;

export const FactoryClaimAttempt = Schema.Union([
  Schema.Struct({ ...AttemptFields, phase: Schema.Literal("prepared") }),
  Schema.Struct({ ...AttemptFields, ...RejectedOutcome }),
  Schema.Struct({ ...AttemptFields, ...AmbiguousOutcome }),
  Schema.Struct({ ...AttemptFields, ...WrittenOutcome }),
  Schema.Struct({ ...AttemptFields, ...VerifiedOutcome }),
]);
export type FactoryClaimAttempt = typeof FactoryClaimAttempt.Type;
export type FactoryClaimAttemptPhase = FactoryClaimAttempt["phase"];
export type WrittenFactoryClaimAttempt = Extract<
  FactoryClaimAttempt,
  { readonly phase: "written" }
>;
export type VerifiedFactoryClaimAttempt = Extract<
  FactoryClaimAttempt,
  { readonly phase: "verified" }
>;

export type PreparationPhase = "released" | "failed" | "cancelled" | "unknown";

/** The command the claim's own workspace preparation releases its run with. */
export const preparationCommandId = (runId: RunId) => CommandId.make(`factory-prepare:${runId}`);

/** The native run state a first use was authorized against. */
export type FirstUseStage =
  | {
      readonly type: "workspace";
      readonly runId: RunId;
      /** The owner whose preparation the authorization opens a workspace obligation for. */
      readonly ownerId: PreparationOwnerId;
    }
  | { readonly type: "provider_start"; readonly runId: RunId; readonly attemptId: RunAttemptId }
  | {
      /**
       * A verified claim's run that a runtime's own stop or start cancelled before any workspace
       * work was authorized: the same run is authorized afresh, as `workspace` would have been.
       */
      readonly type: "workspace_revival";
      readonly runId: RunId;
      readonly threadId: ThreadId;
      readonly ownerId: PreparationOwnerId;
    }
  | {
      /**
       * Routine recovery of a held preparation of `runId`, whose processes are proved gone:
       * `priorOwnerId`'s obligation passes to `ownerId`, under every first-use fence.
       */
      readonly type: "workspace_recovery";
      readonly runId: RunId;
      readonly ownerId: PreparationOwnerId;
      readonly priorOwnerId: PreparationOwnerId;
      readonly endedGenerations: ReadonlyArray<string>;
    };

/** The phase each outcome moves from. */
const outcomeSource: Record<FactoryClaimAttemptOutcome["phase"], FactoryClaimAttemptPhase> = {
  rejected: "prepared",
  ambiguous: "prepared",
  written: "prepared",
  verified: "written",
};
/** The phases an attempt reaches once it has left `from`, in either order of recording. */
const phasesAfter: Record<FactoryClaimAttemptPhase, ReadonlyArray<FactoryClaimAttemptPhase>> = {
  prepared: ["rejected", "ambiguous", "written", "verified"],
  written: ["verified"],
  rejected: [],
  ambiguous: [],
  verified: [],
};

export class FactoryClaimStore extends Context.Service<
  FactoryClaimStore,
  {
    /** Records a pending claim. The caller must hold the admission's write transaction. */
    readonly register: (claim: FactoryClaimRecord) => Effect.Effect<void, FactoryClaimStoreError>;
    readonly get: (reservationId: FactoryReservationId) => Effect.Effect<
      Option.Option<{
        readonly claim: FactoryClaimRecord;
        readonly attempts: ReadonlyArray<FactoryClaimAttempt>;
      }>,
      FactoryClaimStoreError
    >;
    readonly list: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<FactoryClaimRecord>, FactoryClaimStoreError>;
    /** The native fences a first start must still pass. The caller holds the transaction. */
    readonly firstStartFences: (
      claim: FactoryClaimRecord,
      ownCarrier: string | undefined,
    ) => Effect.Effect<FirstStartFenceFailure | undefined, FactoryClaimStoreError>;
    /**
     * The sole-writer compare-and-set: one caller in any process sharing the database gets the
     * attempt, everyone else gets `busy` or `settled`. The caller holds the transaction.
     */
    readonly prepareAttempt: (input: {
      readonly reservationId: FactoryReservationId;
      readonly nonce: string;
      readonly accountId: string;
    }) => Effect.Effect<
      | { readonly type: "prepared"; readonly attempt: FactoryClaimAttempt }
      | { readonly type: "busy" }
      | { readonly type: "settled" },
      FactoryClaimStoreError
    >;
    /**
     * Records one attempt's outcome, moving it from the phase that outcome follows. False when
     * another recording already moved it on; a move the attempt cannot make, or a verification
     * of a different comment than the one written, fails.
     */
    readonly advanceAttempt: (input: {
      readonly reservationId: FactoryReservationId;
      readonly attempt: number;
      readonly to: FactoryClaimAttemptOutcome;
    }) => Effect.Effect<boolean, FactoryClaimStoreError>;
    /**
     * Records the pending claim of an admission whose reservation this transaction just made.
     * The caller holds the admission's write transaction.
     */
    readonly registerAdmission: (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly admission: OrchestrationV2FactoryAdmission;
      readonly claim: FactoryClaimTarget;
      readonly launch: FactoryClaimRecord["launch"];
    }) => Effect.Effect<void, FactoryClaimStoreError>;
    /**
     * Verifies a written attempt in the commit that sends the first message: the attempt must
     * still be the written one, and every first-start fence must still pass. False refuses the
     * commit. The caller holds the transaction.
     */
    readonly settleVerified: (input: {
      readonly reservationId: FactoryReservationId;
      readonly attempt: number;
      readonly commentId: number;
      readonly commentDigest: string;
      readonly messageCommandId: CommandId;
    }) => Effect.Effect<boolean, FactoryClaimStoreError>;
    /**
     * Whether the run a first use is authorized for is still where that use found it: preparing
     * for a workspace, or for a provider start the same unstarted attempt, still starting. Read
     * from the committed projection; the caller holds the transaction.
     */
    readonly runIsCurrent: (stage: FirstUseStage) => Effect.Effect<boolean, FactoryClaimStoreError>;
    /**
     * Whether `runId` is cancelled, and by the runtime's own reconciliation of a stop or a start
     * rather than by anyone's command. The event that last moved the run names its command, so a
     * run a person interrupted or took back is never read as the runtime's doing.
     */
    readonly preparationCancelledByRuntime: (
      runId: RunId,
    ) => Effect.Effect<boolean, FactoryClaimStoreError>;
    /**
     * How far the claim's own workspace preparation of `runId` got, from committed native facts;
     * the caller holds the transaction. Released only on the accepted receipt of the release this
     * claim's preparation dispatches, which no later retry can undo. Failed or cancelled only from
     * that run's own preparation item, with no release. Anything else is unknown.
     */
    readonly preparationPhase: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<PreparationPhase, FactoryClaimStoreError>;
    /**
     * Moves the claim to `to` when it is in one of `from`; false when it is not (it already
     * moved). A move the claim cannot make from its current state fails.
     */
    readonly transition: (input: {
      readonly reservationId: FactoryReservationId;
      readonly from: ReadonlyArray<FactoryClaimState>;
      readonly to: FactoryClaimDisposition;
    }) => Effect.Effect<boolean, FactoryClaimStoreError>;
    /**
     * Routine recovery of a held preparation: a claim held only because its own preparation's
     * outcome was lost, failed or cancelled goes back to `workspace_authorized` for the same run
     * and carrier. Any other state or reason is untouched; false when it did not hold. The
     * caller holds the transaction that proved the preparation's processes gone.
     */
    readonly recoverPreparation: (input: {
      readonly reservationId: FactoryReservationId;
      readonly runId: RunId;
      readonly carrierKey: FactoryClaimCarrierKey;
    }) => Effect.Effect<boolean, FactoryClaimStoreError>;
  }
>()("t3/factory/FactoryClaimStore") {}

// Rows are decoded totally: a field its state does not carry is as invalid as a missing one.
const total = { onExcessProperty: "error" } as const;
const ClaimJson = Schema.fromJsonString(FactoryClaimRecord);
const AttemptJson = Schema.fromJsonString(FactoryClaimAttempt);
const encodeClaim = Schema.encodeEffect(ClaimJson, total);
const decodeClaim = Schema.decodeUnknownEffect(ClaimJson, total);
const encodeAttempt = Schema.encodeEffect(AttemptJson, total);
const decodeAttempt = Schema.decodeUnknownEffect(AttemptJson, total);
// A recorded driver that is missing or not a driver kind proves no identity.
const decodeDriver = Schema.decodeUnknownOption(ProviderDriverKind);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* FactoryStore.FactoryStore;
  const fail = (operation: string) => (cause: unknown) =>
    new FactoryClaimStoreError({ operation, cause });

  const readClaim = (reservationId: FactoryReservationId) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_claims WHERE reservation_id = ${reservationId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryClaimRecord>())
          : Effect.map(decodeClaim(rows[0].record_json), Option.some),
      ),
    );

  const readAttempts = (reservationId: FactoryReservationId) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_claim_attempts
      WHERE reservation_id = ${reservationId}
      ORDER BY attempt ASC
    `.pipe(Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeAttempt(row.record_json))));

  const register = Effect.fn("FactoryClaimStore.register")(
    function* (claim: FactoryClaimRecord) {
      yield* sql`
        INSERT INTO factory_claims (
          reservation_id, operation_id, factory_id, record_json, state, updated_at
        ) VALUES (
          ${claim.reservationId}, ${claim.operationId}, ${claim.factoryId},
          ${yield* encodeClaim(claim)}, ${claim.state}, ${claim.updatedAt}
        )
        ON CONFLICT(reservation_id) DO NOTHING
      `;
    },
    (effect) => effect.pipe(Effect.mapError(fail("register"))),
  );

  const get = Effect.fn("FactoryClaimStore.get")(
    function* (reservationId: FactoryReservationId) {
      const claim = yield* readClaim(reservationId);
      if (Option.isNone(claim)) return Option.none();
      return Option.some({ claim: claim.value, attempts: yield* readAttempts(reservationId) });
    },
    (effect) => effect.pipe(Effect.mapError(fail("get"))),
  );

  const list = Effect.fn("FactoryClaimStore.list")(
    function* (factoryId: FactoryId) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM factory_claims WHERE factory_id = ${factoryId}
        ORDER BY reservation_id
      `;
      return yield* Effect.forEach(rows, (row) => decodeClaim(row.record_json));
    },
    (effect) => effect.pipe(Effect.mapError(fail("list"))),
  );

  const firstStartFences = Effect.fn("FactoryClaimStore.firstStartFences")(
    function* (claim: FactoryClaimRecord, ownCarrier: string | undefined) {
      const reservation = yield* store.getReservation(claim.reservationId);
      if (Option.isNone(reservation) || reservation.value.state !== "held") {
        return "reservation_not_held" as const;
      }
      const configuration = yield* store.getConfiguration(claim.factoryId);
      if (
        Option.isNone(configuration) ||
        configuration.value.revision !== claim.admitted.configRevision
      ) {
        return "configuration_changed" as const;
      }
      if (!configuration.value.enabled) return "factory_paused" as const;
      const deadline = DateTime.makeUnsafe(claim.admitted.deadline);
      if (DateTime.isLessThanOrEqualTo(deadline, yield* DateTime.now)) {
        return "deadline_expired" as const;
      }
      // Every later read must still be the admitted item once our own claim comment is set aside;
      // a change and change-back is a change. Raw observations stay as recorded.
      const later = yield* store.observationsAfter({
        factoryId: claim.factoryId,
        observationId: claim.admitted.observationId,
      });
      if (
        later.some(
          (observation) =>
            !observation.complete ||
            FactoryStore.basisDigestOf(observation, ownCarrier) !== claim.admitted.basisDigest,
        )
      ) {
        return "source_changed" as const;
      }
      const conflicted = yield* sql`
        SELECT 1 FROM factory_item_conflicts
        WHERE factory_id = ${claim.factoryId} AND item_key = ${claim.itemKey}
          AND generation >= ${claim.admitted.generation}
        LIMIT 1
      `;
      return conflicted.length > 0 ? ("source_changed" as const) : undefined;
    },
    (effect) => effect.pipe(Effect.mapError(fail("first-start-fences"))),
  );

  const transition = Effect.fn("FactoryClaimStore.transition")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly from: ReadonlyArray<FactoryClaimState>;
      readonly to: FactoryClaimDisposition;
    }) {
      const claim = yield* readClaim(input.reservationId);
      if (Option.isNone(claim) || !input.from.includes(claim.value.state)) return false;
      if (!claimMoves[claim.value.state].includes(input.to.state)) {
        return yield* Effect.fail(
          `A ${claim.value.state} claim cannot become ${input.to.state}.` as const,
        );
      }
      const { reservationId, operationId, factoryId, itemKey, threadId, target, launch, admitted } =
        claim.value;
      const next: FactoryClaimRecord = {
        reservationId,
        operationId,
        factoryId,
        itemKey,
        threadId,
        target,
        launch,
        admitted,
        ...input.to,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      const updated = yield* sql`
        UPDATE factory_claims
        SET state = ${next.state}, record_json = ${yield* encodeClaim(next)},
          updated_at = ${next.updatedAt}
        WHERE reservation_id = ${input.reservationId} AND state = ${claim.value.state}
        RETURNING reservation_id
      `;
      return updated.length === 1;
    },
    (effect) => effect.pipe(Effect.mapError(fail("transition"))),
  );

  const recoverPreparation = Effect.fn("FactoryClaimStore.recoverPreparation")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly runId: RunId;
      readonly carrierKey: FactoryClaimCarrierKey;
    }) {
      const claim = yield* readClaim(input.reservationId);
      if (
        Option.isNone(claim) ||
        claim.value.state !== "stale_after_claim" ||
        !PREPARATION_HOLD_REASONS.has(claim.value.reason) ||
        claim.value.carrierKey !== input.carrierKey
      ) {
        return false;
      }
      const { reservationId, operationId, factoryId, itemKey, threadId, target, launch, admitted } =
        claim.value;
      const next: FactoryClaimRecord = {
        reservationId,
        operationId,
        factoryId,
        itemKey,
        threadId,
        target,
        launch,
        admitted,
        state: "workspace_authorized",
        carrierKey: input.carrierKey,
        runId: input.runId,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      const updated = yield* sql`
        UPDATE factory_claims
        SET state = ${next.state}, record_json = ${yield* encodeClaim(next)},
          updated_at = ${next.updatedAt}
        WHERE reservation_id = ${input.reservationId} AND state = 'stale_after_claim'
        RETURNING reservation_id
      `;
      return updated.length === 1;
    },
    (effect) => effect.pipe(Effect.mapError(fail("recover-preparation"))),
  );

  const prepareAttempt = Effect.fn("FactoryClaimStore.prepareAttempt")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly nonce: string;
      readonly accountId: string;
    }) {
      const claim = yield* readClaim(input.reservationId);
      if (Option.isNone(claim)) return { type: "settled" } as const;
      if (claim.value.state === "writing") return { type: "busy" } as const;
      if (claim.value.state !== "pending") return { type: "settled" } as const;
      const attempts = yield* readAttempts(input.reservationId);
      // A new request is sent only when every earlier one provably did not apply.
      if (attempts.some((attempt) => attempt.phase !== "rejected"))
        return { type: "busy" } as const;
      if (
        !(yield* transition({
          reservationId: input.reservationId,
          from: ["pending"],
          to: { state: "writing" },
        }))
      ) {
        return { type: "busy" } as const;
      }
      const attempt: FactoryClaimAttempt = {
        reservationId: input.reservationId,
        attempt: attempts.length + 1,
        nonce: input.nonce,
        accountId: input.accountId,
        phase: "prepared",
      };
      yield* sql`
        INSERT INTO factory_claim_attempts (reservation_id, attempt, record_json, phase)
        VALUES (
          ${attempt.reservationId}, ${attempt.attempt}, ${yield* encodeAttempt(attempt)},
          ${attempt.phase}
        )
      `;
      return { type: "prepared", attempt } as const;
    },
    (effect) => effect.pipe(Effect.mapError(fail("prepare-attempt"))),
  );

  const advanceAttempt = Effect.fn("FactoryClaimStore.advanceAttempt")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly attempt: number;
      readonly to: FactoryClaimAttemptOutcome;
    }) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM factory_claim_attempts
        WHERE reservation_id = ${input.reservationId} AND attempt = ${input.attempt}
      `;
      if (rows[0] === undefined) return false;
      const current = yield* decodeAttempt(rows[0].record_json);
      const from = outcomeSource[input.to.phase];
      if (current.phase !== from) {
        if (phasesAfter[from].includes(current.phase)) return false;
        return yield* Effect.fail(
          `A ${current.phase} attempt cannot become ${input.to.phase}.` as const,
        );
      }
      if (
        current.phase === "written" &&
        input.to.phase === "verified" &&
        input.to.commentId !== current.commentId
      ) {
        return yield* Effect.fail(
          "A verification must name the comment that was written." as const,
        );
      }
      const { reservationId, attempt, nonce, accountId } = current;
      const next: FactoryClaimAttempt = { reservationId, attempt, nonce, accountId, ...input.to };
      const updated = yield* sql`
        UPDATE factory_claim_attempts
        SET phase = ${next.phase}, record_json = ${yield* encodeAttempt(next)}
        WHERE reservation_id = ${input.reservationId} AND attempt = ${input.attempt}
          AND phase = ${from}
        RETURNING attempt
      `;
      return updated.length === 1;
    },
    (effect) => effect.pipe(Effect.mapError(fail("advance-attempt"))),
  );

  const registerAdmission = Effect.fn("FactoryClaimStore.registerAdmission")(
    function* (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly admission: OrchestrationV2FactoryAdmission;
      readonly claim: FactoryClaimTarget;
      readonly launch: FactoryClaimRecord["launch"];
    }) {
      const { admission } = input;
      const observation = yield* store.getObservation({
        factoryId: admission.factoryId,
        observationId: admission.observationId,
      });
      if (Option.isNone(observation)) {
        return yield* Effect.die(
          new Error(`Admitted observation ${admission.observationId} is gone.`),
        );
      }
      const reservationId = FactoryReservationId.make(`reservation:${input.commandId}`);
      yield* register({
        reservationId,
        operationId: `factory-claim:${reservationId}`,
        factoryId: admission.factoryId,
        itemKey: admission.itemKey,
        threadId: input.threadId,
        target: input.claim,
        launch: input.launch,
        admitted: {
          observationId: admission.observationId,
          generation: observation.value.generation,
          basisDigest: admission.basisDigest,
          configRevision: admission.configRevision,
          deadline: DateTime.formatIso(admission.deadline),
        },
        state: "pending",
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      });
    },
    (effect) => effect.pipe(Effect.mapError(fail("register-admission"))),
  );

  const settleVerified = Effect.fn("FactoryClaimStore.settleVerified")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly attempt: number;
      readonly commentId: number;
      readonly commentDigest: string;
      readonly messageCommandId: CommandId;
    }) {
      const claim = yield* readClaim(input.reservationId);
      if (Option.isNone(claim) || claim.value.state !== "writing") return false;
      if (claim.value.launch.messageCommandId !== input.messageCommandId) return false;
      const attempt = (yield* readAttempts(input.reservationId)).find(
        (candidate) => candidate.attempt === input.attempt,
      );
      if (attempt?.phase !== "written" || attempt.commentId !== input.commentId) return false;
      const carrierKey = commentCarrierKeyOf(
        claim.value.target,
        input.commentId,
        input.commentDigest,
      );
      if ((yield* firstStartFences(claim.value, carrierKey)) !== undefined) return false;
      // Nothing is written until the claim move succeeds; a lost move after that fails the
      // transaction rather than settling half of it.
      if (
        !(yield* transition({
          reservationId: input.reservationId,
          from: ["writing"],
          to: { state: "verified", carrierKey },
        }))
      ) {
        return false;
      }
      if (
        !(yield* advanceAttempt({
          reservationId: input.reservationId,
          attempt: input.attempt,
          to: { phase: "verified", commentId: input.commentId, commentDigest: input.commentDigest },
        }))
      ) {
        return yield* Effect.fail("The written attempt moved while it was settled." as const);
      }
      yield* store.recordClaimOperation({ reservationId: input.reservationId, carrierKey });
      yield* store.releaseObservedCarrier({ factoryId: claim.value.factoryId, carrierKey });
      return true;
    },
    (effect) => effect.pipe(Effect.mapError(fail("settle-verified"))),
  );

  const preparationCancelledByRuntime = Effect.fn(
    "FactoryClaimStore.preparationCancelledByRuntime",
  )(
    function* (runId: RunId) {
      const runs = yield* sql<{ readonly status: string; readonly thread_id: string }>`
        SELECT status, thread_id FROM orchestration_v2_projection_runs WHERE run_id = ${runId}
      `;
      const run = runs[0];
      if (run?.status !== "cancelled") return false;
      const moves = yield* sql<{
        readonly command_id: string | null;
        readonly status: string | null;
      }>`
        SELECT command_id, json_extract(payload_json, '$.status') AS status
        FROM orchestration_events
        WHERE aggregate_kind = 'thread' AND stream_id = ${run.thread_id}
          AND event_type = 'run.updated' AND json_extract(payload_json, '$.id') = ${runId}
        ORDER BY sequence DESC
        LIMIT 1
      `;
      const last = moves[0];
      return (
        last?.status === "cancelled" &&
        last.command_id !== null &&
        last.command_id.startsWith("command:runtime-reconcile:")
      );
    },
    (effect) => effect.pipe(Effect.mapError(fail("preparation-cancelled-by-runtime"))),
  );

  const runIsCurrent = Effect.fn("FactoryClaimStore.runIsCurrent")(
    function* (stage: FirstUseStage) {
      const runs = yield* sql<{
        readonly status: string;
        readonly active_attempt_id: string | null;
      }>`
        SELECT status, json_extract(payload_json, '$.activeAttemptId') AS active_attempt_id
        FROM orchestration_v2_projection_runs WHERE run_id = ${stage.runId}
      `;
      const run = runs[0];
      if (stage.type === "workspace") return run?.status === "preparing";
      if (stage.type === "workspace_revival") {
        return yield* preparationCancelledByRuntime(stage.runId);
      }
      // A held preparation's run failed with its preparation item, or a runtime's stop cancelled
      // it while it was preparing; a retry can resume either.
      if (stage.type === "workspace_recovery") {
        return run?.status === "failed" || (yield* preparationCancelledByRuntime(stage.runId));
      }
      if (run?.status !== "starting" || run.active_attempt_id !== stage.attemptId) return false;
      const used = yield* sql`
        SELECT 1 FROM orchestration_v2_projection_run_attempts
        WHERE attempt_id = ${stage.attemptId}
          AND json_extract(payload_json, '$.startedAt') IS NOT NULL
        UNION ALL
        SELECT 1 FROM orchestration_v2_projection_provider_turns
        WHERE run_attempt_id = ${stage.attemptId}
        LIMIT 1
      `;
      return used.length === 0;
    },
    (effect) => effect.pipe(Effect.mapError(fail("run-is-current"))),
  );

  const preparationPhase = Effect.fn("FactoryClaimStore.preparationPhase")(
    function* (input: { readonly threadId: ThreadId; readonly runId: RunId }) {
      const receipts = yield* sql<{
        readonly status: string;
        readonly command_type: string;
        readonly aggregate_kind: string;
        readonly aggregate_id: string;
      }>`
        SELECT status, command_type, aggregate_kind, aggregate_id
        FROM orchestration_command_receipts
        WHERE command_id = ${`${preparationCommandId(input.runId)}:release`}
      `;
      const receipt = receipts[0];
      if (receipt !== undefined) {
        // A receipt under that id for anything else proves nothing either way.
        return receipt.status === "accepted" &&
          receipt.command_type === "prepared-run.release" &&
          receipt.aggregate_kind === "thread" &&
          receipt.aggregate_id === input.threadId
          ? ("released" as const)
          : ("unknown" as const);
      }
      // The item's id was derived under the driver the run's own provider thread recorded.
      const runs = yield* sql<{
        readonly root_node_id: string | null;
        readonly driver: string | null;
      }>`
        SELECT json_extract(run.payload_json, '$.rootNodeId') AS root_node_id,
          json_extract(thread.payload_json, '$.driver') AS driver
        FROM orchestration_v2_projection_runs AS run
        JOIN orchestration_v2_projection_provider_threads AS thread
          ON thread.provider_thread_id = json_extract(run.payload_json, '$.providerThreadId')
            AND thread.thread_id = run.thread_id
        WHERE run.run_id = ${input.runId} AND run.thread_id = ${input.threadId}
      `;
      const rootNodeId = runs[0]?.root_node_id;
      const driver = Option.getOrUndefined(decodeDriver(runs[0]?.driver));
      if (rootNodeId === undefined || rootNodeId === null || driver === undefined) {
        return "unknown" as const;
      }
      const items = yield* sql<{ readonly status: string }>`
        SELECT status FROM orchestration_v2_projection_turn_items
        WHERE turn_item_id = ${IdAllocator.derive.turnItemFromProviderItem({
          driver,
          nativeItemId: `workspace-preparation:${input.runId}`,
        })}
          AND thread_id = ${input.threadId} AND run_id = ${input.runId}
          AND node_id = ${rootNodeId} AND type = 'command_execution'
      `;
      if (items.length !== 1) return "unknown" as const;
      const status = items[0]!.status;
      if (status === "failed") return "failed" as const;
      if (status === "interrupted" || status === "cancelled") return "cancelled" as const;
      return "unknown" as const;
    },
    (effect) => effect.pipe(Effect.mapError(fail("preparation-phase"))),
  );

  return FactoryClaimStore.of({
    recoverPreparation,
    preparationPhase,
    preparationCancelledByRuntime,
    runIsCurrent,
    registerAdmission,
    settleVerified,
    register,
    get,
    list,
    firstStartFences,
    prepareAttempt,
    advanceAttempt,
    transition,
  });
});

export const layer = Layer.effect(FactoryClaimStore, make);
