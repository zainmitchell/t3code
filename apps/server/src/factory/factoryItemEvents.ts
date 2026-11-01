import * as Schema from "effect/Schema";

import { FactoryStageSchema } from "./factoryStages.ts";

const OutcomeKind = Schema.Literals([
  "implemented",
  "failed",
  "review_passed",
  "review_failed",
  "correction_spec",
  "integrated",
  "closed",
  "unit_proposed",
  "criteria_proposed",
  "not_actionable",
  "ticket_opened",
]);

/** One stored fact in an item's lifecycle order. */
export const FactoryItemEventRecord = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("admitted"),
    /** The admitted decision's task kind; only lifecycle stages take part in stage order. */
    stage: Schema.String,
    reservationId: Schema.String,
    stageBasis: Schema.optional(Schema.String),
    /** The issue's text the decision read; its work is weighed by it while it runs. */
    issueText: Schema.optional(Schema.Struct({ title: Schema.String, body: Schema.String })),
  }),
  Schema.Struct({
    type: Schema.Literal("outcome"),
    outcomeId: Schema.String,
    stage: FactoryStageSchema,
    kind: OutcomeKind,
    /** The admitted stage execution that produced it; absent for T3's own effects. */
    reservationId: Schema.optional(Schema.String),
    head: Schema.optional(Schema.String),
    evidenceDigest: Schema.optional(Schema.String),
    failureDigest: Schema.optional(Schema.String),
    corrects: Schema.optional(Schema.String),
    /** T3's own missing result of an attempt that failed in its environment, on this execution. */
    environment: Schema.optional(Schema.Struct({ execution: Schema.optional(Schema.String) })),
  }),
  Schema.Struct({
    type: Schema.Literal("rejected"),
    outcomeId: Schema.String,
    failureDigest: Schema.String,
    by: Schema.String,
    reason: Schema.String,
  }),
  /**
   * A stage's item changed substantively while its execution was still running: its result is
   * judged against the new evidence by the next stage's decision, never silently on the old.
   */
  Schema.Struct({
    type: Schema.Literal("basis_changed"),
    reservationId: Schema.String,
    /** The evidence it changed to; recorded once per reservation and evidence. */
    basisDigest: Schema.String,
    observationId: Schema.Number,
  }),
  /** The tracker showed the issue open after T3's verified closure; recorded once per closure. */
  Schema.Struct({
    type: Schema.Literal("reopened"),
    closureOutcomeId: Schema.String,
    observationId: Schema.Number,
  }),
  /**
   * The item waits: what on, who acts, what they do and what resumes it, as decided. Recorded once
   * per basis, from when it was first seen; a later wait on another basis supersedes it, and any
   * lifecycle fact after it ends it. Never a stage outcome.
   */
  Schema.Struct({
    type: Schema.Literal("waiting"),
    basis: Schema.String,
    stage: Schema.String,
    reasonClass: Schema.optional(Schema.String),
    detail: Schema.String,
    firstSeenAt: Schema.String,
    supersedes: Schema.optional(Schema.String),
  }),
  /** A pass decided the item no longer waits on that basis, and why, without other progress. */
  Schema.Struct({
    type: Schema.Literal("wait_ended"),
    basis: Schema.String,
    reason: Schema.String,
    endedAt: Schema.String,
  }),
]);
export type FactoryItemEventRecord = typeof FactoryItemEventRecord.Type;

export const FactoryItemEventJson = Schema.fromJsonString(FactoryItemEventRecord);
export const encodeItemEvent = Schema.encodeEffect(FactoryItemEventJson, {
  onExcessProperty: "error",
});
export const decodeItemEvent = Schema.decodeUnknownEffect(FactoryItemEventJson);
