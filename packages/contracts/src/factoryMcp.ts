import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  PositiveInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { FactoryId, FactoryItemKey, FactoryReservationId } from "./orchestrationV2.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const FactoryKey = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

const Commit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/));
const Bounded = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));

/**
 * What a factory worker reports at the end of its task. T3 binds it to the calling thread's own
 * execution; nothing here names a run, reservation or decision. Integration and closure are T3's
 * own effects, so no worker reports them.
 */
/**
 * A triage stage's proposal: the unit spec the item lacks, bound to the exact item version the
 * worker read. T3 accepts it only for that version; the policy reads it as evidence on a later
 * pass and never starts a build from it alone.
 */
export const FactoryUnitProposal = Schema.Struct({
  /** The item version named in the triage brief; a proposal for another version is rejected. */
  basis: FactoryKey,
  /** The unit spec text to carry in the issue: a Builder unit marker or an `## Owned files` block. */
  unit: Bounded(8_000),
  ownedFiles: Schema.Array(Bounded(1_024)),
  resources: Schema.optional(Schema.Array(Bounded(64))),
  effort: Schema.optional(Schema.Literals(["high", "medium"])),
  /** When the issue is too large for one unit: the bounded children it should be split into. */
  splits: Schema.optional(Schema.Array(Bounded(2_000))),
});
export type FactoryUnitProposal = typeof FactoryUnitProposal.Type;

const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
/** An exact slice of a text: Unicode code point offsets, end exclusive, and the slice itself. */
const Quote = { start: NonNegativeInt, end: NonNegativeInt, excerpt: Bounded(8_000) };
const isSpan = Schema.makeFilter(
  (quote: { readonly start: number; readonly end: number; readonly excerpt: string }) =>
    quote.end > quote.start && [...quote.excerpt].length === quote.end - quote.start,
  { expected: "end after start, and an excerpt exactly end - start code points long" },
);

const FactoryCriteriaClause = Schema.Struct({
  id: FactoryKey,
  /** The acceptance list item, quoted exactly from the body the brief named. */
  source: Schema.Struct({ ...Quote, sha256: Sha256Hex }).check(isSpan),
  /** Each comment the item cites by complete receipt; sha256 is of the whole comment. */
  comments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/)),
        ...Quote,
        sha256: Sha256Hex,
      }).check(isSpan),
    ).check(Schema.isMaxLength(20)),
  ),
  /** Only ever stricter: reserves the clause for the person who must settle it. */
  needs: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(["product_meaning", "qualification"]),
      what: TrimmedNonEmptyString.check(Schema.isMaxLength(300)),
    }),
  ),
});

const quotedLength = (clauses: ReadonlyArray<typeof FactoryCriteriaClause.Type>) =>
  clauses.reduce(
    (total, clause) =>
      total +
      clause.source.excerpt.length +
      (clause.comments ?? []).reduce((sum, comment) => sum + comment.excerpt.length, 0),
    0,
  );

/**
 * A parent triage's proposal: one clause per acceptance list item of the exact body the brief
 * named. Untrusted: T3 checks every quote against its own read, and nothing here is evidence.
 */
export const FactoryCriteriaProposal = Schema.Struct({
  schema: Schema.Literal("factory-parent-criteria-proposal/1"),
  issue: PositiveInt,
  basis: Schema.Struct({ bodySha256: Sha256Hex, itemVersion: FactoryKey }),
  clauses: Schema.Array(FactoryCriteriaClause).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
    Schema.makeFilter((clauses) => quotedLength(clauses) <= 65_536, {
      expected: "at most 65536 quoted characters in all",
    }),
  ),
});
export type FactoryCriteriaProposal = typeof FactoryCriteriaProposal.Type;

export const FactoryReportInput = Schema.Struct({
  outcome: Schema.Literals([
    "implemented",
    "failed",
    "review_passed",
    "review_failed",
    "correction_spec",
    "unit_proposed",
    "criteria_proposed",
    "not_actionable",
  ]),
  /** A triage stage's proposed unit; required with `unit_proposed`. */
  proposal: Schema.optional(FactoryUnitProposal),
  /** A parent triage's proposed criteria; required with `criteria_proposed`. */
  criteria: Schema.optional(FactoryCriteriaProposal),
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

/**
 * Asks a factory to take one tracker issue now, as a tracker event would: the factory reads it,
 * its readiness and policy decide, and existing native work on it is returned rather than started
 * again. It never makes an issue ready, answers an owner decision or reports for a stage.
 */
export const FactoryEnterInput = Schema.Struct({
  factoryId: FactoryId,
  /** `owner/name`, one of the repositories the factory collects. */
  repository: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  issueNumber: PositiveInt,
});
export type FactoryEnterInput = typeof FactoryEnterInput.Type;

export const FactoryEnterStatus = Schema.Literals([
  /** This request's pass admitted the item's next native stage. */
  "started",
  /** Native work already holds the item: a running stage, or T3's integration or closure. */
  "active",
  /** It waits on the owner or another writer's claim, as `reason` names. */
  "held",
  /** The factory's readiness or policy does not take this version of the issue. */
  "not_ready",
  "done",
  /** Accepted; a pass reads or retries it, as `reason` says. */
  "waiting",
  /** The factory cannot take this issue at all. */
  "refused",
]);
export type FactoryEnterStatus = typeof FactoryEnterStatus.Type;

export const FactoryEnterResult = Schema.Struct({
  itemKey: FactoryItemKey,
  status: FactoryEnterStatus,
  /** The item's lifecycle stage, when the factory has decided one. */
  stage: Schema.optional(Schema.String),
  /** The native stage's own thread, while one holds the item. */
  threadId: Schema.optional(ThreadId),
  /** The pending owner decision it is held on. */
  decisionId: Schema.optional(Schema.String),
  reason: Schema.String,
  /** Who acts next, and how. */
  nextAction: Schema.String,
});
export type FactoryEnterResult = typeof FactoryEnterResult.Type;

/** What a factory holds and why it is idle or blocked, as its owner and agents read it. */
export const FactoryStateInput = Schema.Struct({ factoryId: FactoryId });

/**
 * The environment's agent ceiling and every execution it counts now, the same for every factory.
 * While a ceiling is set it alone limits starts; pool capacities do not subdivide it.
 */
export const FactoryAgentOccupancy = Schema.Struct({
  ceiling: Schema.NullOr(Schema.Number),
  revision: Schema.Number,
  occupied: Schema.Number,
  counted: Schema.Struct({
    admitted: Schema.Number,
    descendants: Schema.Number,
    observed: Schema.Number,
    transferred: Schema.Number,
    otherRuns: Schema.Number,
  }),
  otherRunThreads: Schema.Array(Schema.String),
});
export type FactoryAgentOccupancy = typeof FactoryAgentOccupancy.Type;

export const FactoryStateResult = Schema.Struct({
  configured: Schema.Boolean,
  agents: Schema.optional(FactoryAgentOccupancy),
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
      /**
       * The owner's quarantine of a historical stage: still held, owning its item, not charged
       * against its pool, and proving nothing about its processes.
       */
      quarantine: Schema.optional(
        Schema.Struct({
          by: Schema.String,
          reason: Schema.String,
          quarantinedAt: Schema.String,
          evidenceDigest: Schema.String,
          nextAction: Schema.String,
        }),
      ),
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
  /**
   * The verified result each open item's current stage is built on: what its owner may reject.
   * Bounded excerpts only; absent from servers that predate it.
   */
  results: Schema.optional(
    Schema.Array(
      Schema.Struct({
        itemKey: Schema.String,
        /** The stage the result feeds now, such as a review of an implementation. */
        stage: Schema.String,
        outcomeId: Schema.String,
        outcomeStage: Schema.String,
        kind: Schema.String,
        head: Schema.optional(Schema.String),
        reportedAt: Schema.String,
        summary: Schema.String,
        failure: Schema.optional(Schema.String),
        artifacts: Schema.Number,
      }),
    ),
  ),
  lastCollection: Schema.Array(
    Schema.Struct({
      itemKey: Schema.String,
      stage: Schema.NullOr(Schema.String),
      disposition: Schema.String,
      detail: Schema.optional(Schema.String),
      /** The policy's own class for a `nothing_proposed` item, such as `needs_routing`. */
      reasonClass: Schema.optional(Schema.String),
      at: Schema.String,
    }),
  ),
  /**
   * Every item that waits now, as recorded durably: what on, who acts, what resumes it, and when
   * it was first seen waiting on that basis. Absent from servers that predate it.
   */
  waits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        itemKey: Schema.String,
        basis: Schema.String,
        stage: Schema.String,
        reasonClass: Schema.optional(Schema.String),
        detail: Schema.String,
        firstSeenAt: Schema.String,
      }),
    ),
  ),
  /**
   * What the latest pass did with the items it read, as counts. `byReasonClass.needs_routing` is
   * the number of eligible items the policy could not start for want of a unit spec: the measure
   * of whether decomposition, not capacity, is the bottleneck. Absent from servers that predate it.
   */
  lastPassMetrics: Schema.optional(
    Schema.Struct({
      at: Schema.String,
      read: Schema.Number,
      admitted: Schema.Number,
      byDisposition: Schema.Record(Schema.String, Schema.Number),
      byReasonClass: Schema.Record(Schema.String, Schema.Number),
    }),
  ),
});
export type FactoryStateResult = typeof FactoryStateResult.Type;

/**
 * The owner's answer to a reserved decision. Only the owner's own client may give it. A grant
 * request answered `grant` (or `approve`) with units issues that much finite authority for exactly
 * that request; units with any other answer settle nothing.
 */
export const FactoryDecideInput = Schema.Struct({
  factoryId: FactoryId,
  decisionId: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  answer: Bounded(2_000),
  grantUnits: Schema.optional(PositiveInt),
});

export type FactoryDecideInput = typeof FactoryDecideInput.Type;

export const FactoryDecideResult = Schema.Struct({ resolved: Schema.Boolean });

/** The stage of the owner's question about a ticket create that may already have been sent. */
export const FACTORY_TICKET_DECISION_STAGE = "ticket";

export interface FactoryDecisionChoice {
  readonly answer: "approve" | "decline" | "abandon";
  readonly label: string;
  readonly description: string;
}

/**
 * What the owner can answer a reserved decision, the same on its card and in Settings. A ticket
 * question is approved or abandoned: declining it would only ask again. Approving a grant request
 * grants one start.
 */
export const factoryDecisionChoices = (decision: {
  readonly stage: string;
  readonly kind?: "gate" | "grant" | undefined;
}): ReadonlyArray<FactoryDecisionChoice> =>
  decision.stage === FACTORY_TICKET_DECISION_STAGE
    ? [
        {
          answer: "approve",
          label: "Approve",
          description: "No issue carries the marker: send the create once more.",
        },
        {
          answer: "abandon",
          label: "Abandon",
          description: "Send no create and stop looking; an issue may still exist.",
        },
      ]
    : [
        decision.kind === "grant"
          ? {
              answer: "approve",
              label: "Grant one start",
              description: "Allow exactly one start of this request.",
            }
          : {
              answer: "approve",
              label: "Approve",
              description: "Let the factory proceed on exactly this decision.",
            },
        { answer: "decline", label: "Decline", description: "Keep it held." },
      ];

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
 * The owner moves a factory's future work from one provider instance to another: every model
 * selection on `from` moves to `to` with its model and options, and nothing else changes. Without
 * `apply` it only plans. Running work keeps the configuration it was admitted under.
 */
export const FactorySwitchProviderInput = Schema.Struct({
  factoryId: FactoryId,
  from: ProviderInstanceId,
  to: ProviderInstanceId,
  apply: Schema.Boolean,
});
export type FactorySwitchProviderInput = typeof FactorySwitchProviderInput.Type;
const SwitchedInstance = Schema.Struct({
  instanceId: ProviderInstanceId,
  displayName: Schema.NullOr(Schema.String),
});
export const FactorySwitchProviderResult = Schema.Struct({
  factoryId: FactoryId,
  /**
   * `planned` and `switched` carry `changes`; `already_switched` means only `to` remains and
   * `no_match` that neither is configured. `refused` and `conflict` changed nothing.
   */
  outcome: Schema.Literals([
    "planned",
    "switched",
    "already_switched",
    "no_match",
    "refused",
    "conflict",
  ]),
  /** The configuration revision the plan was read from; absent when the factory is not configured. */
  revision: Schema.optional(Schema.Number),
  /** The revision written and read back, when switched. */
  switchedRevision: Schema.optional(Schema.Number),
  from: SwitchedInstance,
  to: SwitchedInstance,
  /** JSON pointers to each `instanceId` that moves, with the model it keeps. */
  changes: Schema.Array(Schema.Struct({ path: Schema.String, model: Schema.String })),
  /** JSON pointers to each `instanceId` already on `to`. */
  alreadyOnTarget: Schema.Array(Schema.String),
  reason: Schema.optional(Schema.String),
});
export type FactorySwitchProviderResult = typeof FactorySwitchProviderResult.Type;

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

/**
 * A factory owner decision raised as a chat question: `factory-card:<factoryId>:<gate|result>:
 * <decisionId|outcomeId>:<n>`. Only the owner's own signed-in client answers one.
 */
const FACTORY_CARD_PREFIX = "factory-card:";
const FACTORY_CARD = /^factory-card:(.+?):(gate|result):(.+):(\d+)$/;

// The subject is percent-encoded, so one with colons (`native:…`, `no-result:…`) is still one field;
// hex outcome and decision ids encode to themselves.
export const factoryCardRequestId = (input: {
  readonly factoryId: string;
  readonly kind: "gate" | "result";
  readonly subjectId: string;
  readonly n: number;
}) =>
  `${FACTORY_CARD_PREFIX}${input.factoryId}:${input.kind}:${encodeURIComponent(input.subjectId)}:${input.n}`;

/**
 * A card id as issued. Builds before encoding (the rollback target among them) wrote a subject
 * with colons as it was: that card is `legacy`, read only for its history and never answered.
 */
export const parseFactoryCardRequestId = (requestId: string) => {
  const match = FACTORY_CARD.exec(requestId);
  if (match === null) return undefined;
  const legacy = match[3]!.includes(":");
  let subjectId = match[3]!;
  if (!legacy) {
    try {
      subjectId = decodeURIComponent(subjectId);
    } catch {
      return undefined;
    }
  }
  return {
    factoryId: match[1]!,
    kind: match[2] as "gate" | "result",
    subjectId,
    n: Number(match[4]),
    legacy,
  };
};

/** Every id a factory issued as a card, readable or not: none is ever an ordinary answer. */
export const isFactoryCardRequestId = (requestId: string) =>
  requestId.startsWith(FACTORY_CARD_PREFIX);

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

/**
 * The owner reads the environment's agent ceiling, or sets it (null clears it) while
 * `expectRevision` is still its revision. One ceiling for every project and role.
 */
export const FactoryAgentCeilingInput = Schema.Struct({
  set: Schema.optional(
    Schema.Struct({ agents: Schema.NullOr(PositiveInt), expectRevision: NonNegativeInt }),
  ),
});
export const FactoryAgentCeilingResult = Schema.Struct({
  applied: Schema.Boolean,
  occupancy: FactoryAgentOccupancy,
});

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
 * The owner attests that an admitted stage never started, when nothing can prove its preparation
 * history. Without `expectDigest` it only reads the evidence; with it, the attestation is recorded
 * only if the evidence is still exactly what that digest names.
 */
export const FactoryDisposeNeverStartedInput = Schema.Struct({
  factoryId: FactoryId,
  reservationId: FactoryReservationId,
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  expectDigest: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export const FactoryDisposeNeverStartedResult = Schema.Struct({
  disposed: Schema.Boolean,
  refusals: Schema.Array(Schema.String),
  /** The canonical evidence the digest is of, when the reservation could be read. */
  evidence: Schema.optional(Schema.String),
  evidenceDigest: Schema.optional(Schema.String),
});

/**
 * The owner quarantines a held stage whose historical execution can never be proved to have
 * ended (`enter`), or ends that quarantine (`leave`). Without `expectDigest` it only reads the
 * evidence; with it, the change is recorded only if the evidence is still exactly that.
 */
export const FactoryQuarantineInput = Schema.Struct({
  factoryId: FactoryId,
  reservationId: FactoryReservationId,
  action: Schema.Literals(["enter", "leave"]),
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  expectDigest: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export const FactoryQuarantineResult = Schema.Struct({
  applied: Schema.Boolean,
  refusals: Schema.Array(Schema.String),
  evidence: Schema.optional(Schema.String),
  evidenceDigest: Schema.optional(Schema.String),
});

/**
 * The owner proves that a full restart of the server's host ended a held historical stage's
 * processes, on one named operation: `capture` before the restart binds the exact execution and
 * this boot; `verify` after it records the proof once T3 reads a later boot of the same host and
 * the same execution. Without `expectDigest` it only reads; with it, only that exact evidence.
 */
export const FactoryHistoricalTerminationInput = Schema.Struct({
  factoryId: FactoryId,
  reservationId: FactoryReservationId,
  action: Schema.Literals(["capture", "verify"]),
  operationRef: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  expectDigest: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  /**
   * Where no provenance placed the stage's writers, the owner's acceptance of exactly the
   * uncertainty T3 cannot settle, over the scope the read shows. A decision, never a proof.
   */
  acceptResidual: Schema.optional(
    Schema.Array(
      Schema.Literals([
        "non_t3_side_effects_unrecordable",
        "provider_executor_locality_unrecorded",
      ]),
    ),
  ),
});
export const FactoryHistoricalTerminationResult = FactoryQuarantineResult;

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
      /**
       * You attest that every legacy write on the item stays within what this issue body declares,
       * so the policy weighs it like native work. It lists each file as a `` - `path` `` line under
       * one `## Owned files` heading, nothing else there; one `btc-unit:builder` marker, if any,
       * writes exactly those, with resources. Set once; asking again with the transferId adds it.
       */
      scope: Schema.optional(
        Schema.Struct({
          body: TrimmedNonEmptyString.check(Schema.isMaxLength(65_536)),
          reason: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
        }),
      ),
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
