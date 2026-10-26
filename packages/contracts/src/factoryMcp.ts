import * as Schema from "effect/Schema";

import { PositiveInt, RunId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { FactoryId, FactoryItemKey, FactoryReservationId } from "./orchestrationV2.ts";

const FactoryKey = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

const Commit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/));
const Bounded = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));

/**
 * What a factory worker reports at the end of its task. T3 binds it to the calling thread's own
 * execution; nothing here names a run, reservation or decision. Integration and closure are T3's
 * own effects, so no worker reports them.
 */
export const FactoryReportInput = Schema.Struct({
  outcome: Schema.Literals([
    "implemented",
    "failed",
    "review_passed",
    "review_failed",
    "correction_spec",
  ]),
  /** What the work produced or examined. A review names the exact head it reviewed. */
  subject: Schema.optional(
    Schema.Struct({
      repository: FactoryKey,
      baseCommit: Schema.optional(Commit),
      headCommit: Schema.optional(Commit),
      branch: Schema.optional(Bounded(255)),
    }),
  ),
  /** The exact failure: a failed build or verify, or a failed review's findings. */
  failure: Schema.optional(Bounded(20_000)),
  summary: Bounded(4_000),
  artifacts: Schema.optional(
    Schema.Array(Schema.Struct({ path: Bounded(1_024), sha256: Schema.String })),
  ),
});
export type FactoryReportInput = typeof FactoryReportInput.Type;

export const FactoryReportResult = Schema.Struct({
  outcomeId: Schema.String,
  state: Schema.Literals(["reported", "already_reported"]),
});
export type FactoryReportResult = typeof FactoryReportResult.Type;

export class FactoryReportFailure extends Schema.TaggedError<FactoryReportFailure>()(
  "FactoryReportFailure",
  {
    code: Schema.Literals([
      "not_a_factory_execution",
      "outcome_not_expected",
      "subject_missing",
      "unavailable",
    ]),
    message: Schema.String,
  },
) {}

/** What a factory holds and why it is idle or blocked, as its owner and agents read it. */
export const FactoryStateInput = Schema.Struct({ factoryId: FactoryId });

export const FactoryStateResult = Schema.Struct({
  configured: Schema.Boolean,
  enabled: Schema.optional(Schema.Boolean),
  configurationRevision: Schema.optional(Schema.Number),
  policyRevision: Schema.optional(Schema.String),
  pools: Schema.Array(
    Schema.Struct({
      poolId: Schema.String,
      capacityUnits: Schema.Number,
      occupiedUnits: Schema.Number,
    }),
  ),
  /** Problems that stop the factory as a whole, from its latest pass. */
  issues: Schema.Array(Schema.Struct({ kind: Schema.String, detail: Schema.String })),
  reservations: Schema.Array(
    Schema.Struct({
      reservationId: Schema.String,
      itemKey: Schema.String,
      origin: Schema.String,
      state: Schema.String,
      stage: Schema.optional(Schema.String),
      threadId: Schema.optional(Schema.String),
      custody: Schema.Struct({ state: Schema.String, reasons: Schema.Array(Schema.String) }),
      claimState: Schema.optional(Schema.String),
      /** An observed claim's tracker carrier, which the owner disposes of exactly. */
      carrierKey: Schema.optional(Schema.String),
      /** A transferred legacy worker's original job and work id. */
      job: Schema.optional(Schema.String),
      workId: Schema.optional(Schema.String),
    }),
  ),
  reservedDecisions: Schema.Array(
    Schema.Struct({
      decisionId: Schema.String,
      itemKey: Schema.String,
      stage: Schema.String,
      /** `grant`: answering may issue finite authority for exactly this request. */
      kind: Schema.Literals(["gate", "grant"]),
      reason: Schema.String,
      state: Schema.String,
      createdAt: Schema.String,
      answer: Schema.optional(Schema.String),
      answeredBy: Schema.optional(Schema.String),
      grantId: Schema.optional(Schema.String),
    }),
  ),
  grants: Schema.Array(
    Schema.Struct({
      grantId: Schema.String,
      itemKey: Schema.String,
      stage: Schema.String,
      state: Schema.String,
      units: Schema.Number,
      remaining: Schema.Number,
    }),
  ),
  lastCollection: Schema.Array(
    Schema.Struct({
      itemKey: Schema.String,
      stage: Schema.NullOr(Schema.String),
      disposition: Schema.String,
      detail: Schema.optional(Schema.String),
      at: Schema.String,
    }),
  ),
});
export type FactoryStateResult = typeof FactoryStateResult.Type;

/**
 * The owner's answer to a reserved decision. Only the owner's own client may give it. A grant
 * request answered with units issues that much finite authority for exactly that request.
 */
export const FactoryDecideInput = Schema.Struct({
  factoryId: FactoryId,
  decisionId: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  answer: Bounded(2_000),
  grantUnits: Schema.optional(PositiveInt),
});

export type FactoryDecideInput = typeof FactoryDecideInput.Type;

export const FactoryDecideResult = Schema.Struct({ resolved: Schema.Boolean });

/** The owner disposes of a claim the factory could not attribute, once its work is gone. */
export const FactoryDisposeClaimInput = Schema.Struct({
  factoryId: FactoryId,
  reservationId: FactoryReservationId,
  reason: Bounded(2_000),
});

export const FactoryDisposeClaimResult = Schema.Struct({ disposed: Schema.Boolean });

/**
 * The owner installs or replaces a factory's configuration, given as its JSON document. It is
 * validated whole; `enabled` in it pauses or starts the factory.
 */
export const FactoryConfigureInput = Schema.Struct({ configuration: Bounded(1_000_000) });
export const FactoryConfigureResult = Schema.Struct({
  factoryId: FactoryId,
  enabled: Schema.Boolean,
  configurationRevision: Schema.Number,
  policyRevision: Schema.String,
});

/**
 * The owner records the claims other writers hold on the factory's tracker, as held
 * reservations, without the factory deciding or starting anything, even while it is paused.
 */
export const FactoryObserveClaimsInput = Schema.Struct({ factoryId: FactoryId });
export const FactoryObserveClaimsResult = Schema.Struct({
  claims: Schema.Array(
    Schema.Struct({
      reservationId: Schema.String,
      itemKey: Schema.String,
      carrierKey: Schema.String,
    }),
  ),
});

/** Every configured factory in this environment, as its owner reads it. */
export const FactoryOverviewInput = Schema.Struct({});
export const FactoryOverview = Schema.Struct({
  factories: Schema.Array(Schema.Struct({ factoryId: FactoryId, state: FactoryStateResult })),
});
export type FactoryOverview = typeof FactoryOverview.Type;

export class FactoryOwnerError extends Schema.TaggedError<FactoryOwnerError>()(
  "FactoryOwnerError",
  { message: Schema.String },
) {}

/** The owner explicitly rejects a verified result, which is then never consumed again. */
export const FactoryRejectOutcomeInput = Schema.Struct({
  factoryId: FactoryId,
  outcomeId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  reason: Bounded(2_000),
});
export const FactoryRejectOutcomeResult = Schema.Struct({ rejected: Schema.Boolean });

/** The owner revokes what remains of a finite grant. */
export const FactoryRevokeGrantInput = Schema.Struct({
  factoryId: FactoryId,
  grantId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export const FactoryRevokeGrantResult = Schema.Struct({ revoked: Schema.Boolean });

/** The owner resumes a stage run that was interrupted before it ever started. */
export const FactoryRecoverRunInput = Schema.Struct({
  factoryId: FactoryId,
  reservationId: FactoryReservationId,
  runId: RunId,
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
});
export const FactoryRecoverRunResult = Schema.Struct({
  recovered: Schema.Boolean,
  reason: Schema.optional(Schema.String),
});

/**
 * The owner hands a legacy command job's work on chosen items to a factory. Asking again with the
 * same transfer id finishes it once the job's last pass has stopped.
 */
export const FactoryTransferInput = Schema.Struct({
  factoryId: FactoryId,
  transferId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  job: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  items: Schema.Array(
    Schema.Struct({
      itemKey: FactoryItemKey,
      workIds: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
      /** Of those, workers you already accounted for: recorded and bound, never charged. */
      historical: Schema.optional(
        Schema.Array(
          Schema.Struct({
            workId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
            reason: Bounded(2_000),
          }),
        ),
      ),
      uncertain: Schema.optional(Schema.Array(Bounded(2_000))),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

/** `draining`: the job is fenced but its last pass still runs; ask again once it stops. */
export const FactoryTransferResult = Schema.Struct({
  state: Schema.Literals(["draining", "adopted", "rolled_back", "refused"]),
  reason: Schema.optional(Schema.String),
  transferId: Schema.String,
  /** The custody each adopted worker holds until the owner disposes of it. */
  custody: Schema.Array(
    Schema.Struct({
      itemKey: Schema.String,
      reservationId: Schema.String,
      workId: Schema.NullOr(Schema.String),
      state: Schema.String,
    }),
  ),
});
export type FactoryTransferResult = typeof FactoryTransferResult.Type;

export const FactoryRollbackTransferInput = Schema.Struct({
  factoryId: FactoryId,
  transferId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  reason: Bounded(2_000),
});
