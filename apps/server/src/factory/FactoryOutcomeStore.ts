import {
  FactoryId,
  FactoryItemKey,
  FactoryReportInput,
  FactoryReservationId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import {
  decodeItemEvent,
  encodeItemEvent,
  type FactoryItemEventRecord,
} from "./factoryItemEvents.ts";
import type { FactoryStageType, ItemEvent } from "./factoryStages.ts";

const Stage = Schema.Literals(["implement", "review", "correct", "rework", "integrate", "close"]);

/**
 * An outcome as T3 holds it: a worker's report, or a record of T3's own effect in the same
 * shape. Only T3 writes `integrated` and `closed`.
 */
export const FactoryOutcomeReport = Schema.Struct({
  ...FactoryReportInput.fields,
  outcome: Schema.Literals([
    "implemented",
    "failed",
    "review_passed",
    "review_failed",
    "correction_spec",
    "integrated",
    "closed",
  ]),
  integration: Schema.optional(
    Schema.Struct({
      targetBranch: Schema.String,
      mergeCommit: Schema.String,
      parents: Schema.Array(Schema.String),
      tree: Schema.String,
      attribution: Schema.Literals(["operation", "external"]),
      pullRequest: Schema.optional(
        Schema.Struct({ repository: Schema.String, number: Schema.Int }),
      ),
    }),
  ),
});
export type FactoryOutcomeReport = typeof FactoryOutcomeReport.Type;

/**
 * Who produced the outcome. An execution's own report is bound to its reservation, thread and
 * run; T3's own records name the operation or the reservation they dispose of.
 */
export const FactoryOutcomeOrigin = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("execution"),
    reservationId: FactoryReservationId,
    threadId: ThreadId,
    runId: RunId,
    attemptId: Schema.optional(RunAttemptId),
  }),
  Schema.Struct({
    type: Schema.Literal("native"),
    /** The integration or closure operation it records. */
    operationId: Schema.optional(Schema.String),
    /** The stage execution whose missing result it records, once that execution is quiet. */
    reservationId: Schema.optional(FactoryReservationId),
  }),
]);
export type FactoryOutcomeOrigin = typeof FactoryOutcomeOrigin.Type;

const OutcomeFields = {
  outcomeId: Schema.String,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  origin: FactoryOutcomeOrigin,
  stage: Stage,
  report: FactoryOutcomeReport,
  /** The digest of the report as received, which its tracker record carries. */
  reportDigest: Schema.String,
  failureDigest: Schema.optional(Schema.String),
  /** For a correction spec, the failure digest its decision was admitted to correct. */
  corrects: Schema.optional(Schema.String),
  reportedAt: Schema.String,
};

/** What T3 read back before it accepted an outcome. */
const Receipt = Schema.Struct({
  verifiedAt: Schema.String,
  trackerCommentId: Schema.optional(Schema.Number),
});

export const FactoryOutcome = Schema.Union([
  Schema.Struct({ ...OutcomeFields, state: Schema.Literal("reported") }),
  Schema.Struct({ ...OutcomeFields, state: Schema.Literal("verified"), receipt: Receipt }),
  Schema.Struct({
    ...OutcomeFields,
    state: Schema.Literal("rejected"),
    rejection: Schema.String,
    rejectedAt: Schema.String,
  }),
]);
export type FactoryOutcome = typeof FactoryOutcome.Type;
export type ReportedOutcome = Extract<FactoryOutcome, { readonly state: "reported" }>;

/** The id an outcome is filed under: the execution's reservation, or T3's own operation. */
const originIdOf = (origin: FactoryOutcomeOrigin) =>
  origin.type === "execution"
    ? origin.reservationId
    : (origin.operationId ?? origin.reservationId ?? "");

/**
 * A decision only its owner can make. It stays visible until that authority resolves it, or
 * until fresh facts overtake it: an escalation derived before them is not left waiting.
 */
export const ReservedDecision = Schema.Struct({
  decisionId: Schema.String,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  stage: Schema.String,
  reason: Schema.String,
  /** The exact evidence the decision is about; changed evidence is a different decision. */
  evidenceDigest: Schema.String,
  /** `grant`: the owner may answer with finite authority for this exact subject. */
  kind: Schema.optional(Schema.Literals(["gate", "grant"])),
  state: Schema.Literals(["pending", "resolved", "superseded"]),
  createdAt: Schema.String,
  resolution: Schema.optional(
    Schema.Struct({
      answer: Schema.String,
      by: Schema.String,
      resolvedAt: Schema.String,
      grantId: Schema.optional(Schema.String),
    }),
  ),
  superseded: Schema.optional(Schema.Struct({ reason: Schema.String, at: Schema.String })),
});
export type ReservedDecision = typeof ReservedDecision.Type;

/** An item event as the stage order reads it, with the reservation an admission made. */
export type StoredItemEvent = ItemEvent & { readonly reservationId?: string };

export class FactoryOutcomeStoreError extends Schema.TaggedError<FactoryOutcomeStoreError>()(
  "FactoryOutcomeStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory outcome store ${this.operation} failed.`;
  }
}

export class FactoryOutcomeStore extends Context.Service<
  FactoryOutcomeStore,
  {
    /** Records a report; a report already recorded under the same id is left as it is. */
    readonly insertReported: (
      outcome: ReportedOutcome,
    ) => Effect.Effect<"inserted" | "existing", FactoryOutcomeStoreError>;
    readonly get: (
      outcomeId: string,
    ) => Effect.Effect<Option.Option<FactoryOutcome>, FactoryOutcomeStoreError>;
    readonly listReported: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<ReportedOutcome>, FactoryOutcomeStoreError>;
    /** Items with a verified outcome and no verified closure: their lifecycle is under way. */
    readonly openItems: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<FactoryItemKey>, FactoryOutcomeStoreError>;
    /** Every outcome filed under a reservation or operation id, in report order. */
    readonly listForOrigin: (
      originId: string,
    ) => Effect.Effect<ReadonlyArray<FactoryOutcome>, FactoryOutcomeStoreError>;
    /**
     * Accepts a reported outcome with what was read back, and records it in its item's order in
     * the same commit; false when it is no longer reported.
     */
    readonly markVerified: (input: {
      readonly outcomeId: string;
      readonly receipt: typeof Receipt.Type;
    }) => Effect.Effect<boolean, FactoryOutcomeStoreError>;
    readonly markRejected: (input: {
      readonly outcomeId: string;
      readonly rejection: string;
    }) => Effect.Effect<boolean, FactoryOutcomeStoreError>;
    /**
     * Records the owner's explicit rejection of a verified result, once: from then on it is
     * never consumed, however often it is reported again.
     */
    readonly rejectVerified: (input: {
      readonly outcomeId: string;
      readonly failureDigest: string;
      readonly by: string;
      readonly reason: string;
    }) => Effect.Effect<boolean, FactoryOutcomeStoreError>;
    /** Records that an in-progress stage's item changed under it, once per new evidence. */
    readonly recordBasisChange: (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly reservationId: string;
      readonly basisDigest: string;
      readonly observationId: number;
    }) => Effect.Effect<boolean, FactoryOutcomeStoreError>;
    /** The item's lifecycle facts in native order. */
    readonly itemEvents: (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
    }) => Effect.Effect<ReadonlyArray<StoredItemEvent>, FactoryOutcomeStoreError>;
    /** The item's raw records, including basis changes, for readback. */
    readonly itemRecords: (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
    }) => Effect.Effect<
      ReadonlyArray<{ readonly seq: number; readonly record: FactoryItemEventRecord }>,
      FactoryOutcomeStoreError
    >;
    /** Records a reserved decision once per identity; an existing one is returned unchanged. */
    readonly reserveDecision: (
      decision: Omit<ReservedDecision, "state" | "createdAt" | "resolution">,
    ) => Effect.Effect<ReservedDecision, FactoryOutcomeStoreError>;
    readonly reservedDecisions: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<ReservedDecision>, FactoryOutcomeStoreError>;
    readonly resolveDecision: (input: {
      readonly decisionId: string;
      readonly answer: string;
      readonly by: string;
      readonly grantId?: string;
    }) => Effect.Effect<boolean, FactoryOutcomeStoreError>;
    /** Takes a pending decision fresh facts overtook out of the owner's queue, once. */
    readonly supersedeDecision: (input: {
      readonly decisionId: string;
      readonly reason: string;
    }) => Effect.Effect<boolean, FactoryOutcomeStoreError>;
  }
>()("t3/factory/FactoryOutcomeStore") {}

const total = { onExcessProperty: "error" } as const;
const makeItemKey = Schema.decodeSync(FactoryItemKey);
const OutcomeJson = Schema.fromJsonString(FactoryOutcome);
const encodeOutcome = Schema.encodeEffect(OutcomeJson, total);
const decodeOutcome = Schema.decodeUnknownEffect(OutcomeJson);
const DecisionJson = Schema.fromJsonString(ReservedDecision);
const encodeDecision = Schema.encodeEffect(DecisionJson, total);
const decodeDecision = Schema.decodeUnknownEffect(DecisionJson);

const LIFECYCLE_STAGES: ReadonlySet<string> = new Set([
  "implement",
  "review",
  "correct",
  "rework",
  "integrate",
  "close",
]);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) =>
    new FactoryOutcomeStoreError({ operation, cause });

  const readOutcome = (outcomeId: string) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_outcomes WHERE outcome_id = ${outcomeId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryOutcome>())
          : Effect.asSome(decodeOutcome(rows[0].record_json)),
      ),
    );

  const writeOutcome = Effect.fn("FactoryOutcomeStore.writeOutcome")(function* (
    outcome: FactoryOutcome,
    from: "reported",
  ) {
    const rows = yield* sql`
      UPDATE factory_outcomes
      SET state = ${outcome.state}, record_json = ${yield* encodeOutcome(outcome)}
      WHERE outcome_id = ${outcome.outcomeId} AND state = ${from}
      RETURNING outcome_id
    `;
    return rows.length === 1;
  });

  const reportedFields = (outcome: FactoryOutcome) => {
    const { state: _state, ...fields } = outcome;
    if ("receipt" in fields) {
      const { receipt: _receipt, ...rest } = fields;
      return rest;
    }
    if ("rejection" in fields) {
      const { rejection: _rejection, rejectedAt: _rejectedAt, ...rest } = fields;
      return rest;
    }
    return fields;
  };

  const appendEvent = (factoryId: string, itemKey: string, event: FactoryItemEventRecord) =>
    Effect.flatMap(
      encodeItemEvent(event),
      (json) => sql`
        INSERT INTO factory_item_events (factory_id, item_key, record_json)
        VALUES (${factoryId}, ${itemKey}, ${json})
      `,
    );

  const itemRecords = Effect.fn("FactoryOutcomeStore.itemRecords")(
    function* (input: { readonly factoryId: FactoryId; readonly itemKey: FactoryItemKey }) {
      const rows = yield* sql<{ readonly seq: number; readonly record_json: string }>`
        SELECT seq, record_json FROM factory_item_events
        WHERE factory_id = ${input.factoryId} AND item_key = ${input.itemKey} ORDER BY seq
      `;
      return yield* Effect.forEach(rows, (row) =>
        Effect.map(decodeItemEvent(row.record_json), (record) => ({ seq: row.seq, record })),
      );
    },
    Effect.mapError(fail("item-records")),
  );

  return FactoryOutcomeStore.of({
    insertReported: Effect.fn("FactoryOutcomeStore.insertReported")(
      function* (outcome: ReportedOutcome) {
        const rows = yield* sql`
          INSERT INTO factory_outcomes (
            outcome_id, factory_id, item_key, origin_id, state, record_json
          ) VALUES (
            ${outcome.outcomeId}, ${outcome.factoryId}, ${outcome.itemKey},
            ${originIdOf(outcome.origin)}, 'reported', ${yield* encodeOutcome(outcome)}
          )
          ON CONFLICT(outcome_id) DO NOTHING
          RETURNING outcome_id
        `;
        return rows.length === 1 ? ("inserted" as const) : ("existing" as const);
      },
      Effect.mapError(fail("insert-reported")),
    ),
    get: Effect.fn("FactoryOutcomeStore.get")(readOutcome, Effect.mapError(fail("get"))),
    listReported: Effect.fn("FactoryOutcomeStore.listReported")(
      function* (factoryId: FactoryId) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_outcomes
          WHERE factory_id = ${factoryId} AND state = 'reported' ORDER BY rowid
        `;
        const outcomes = yield* Effect.forEach(rows, (row) => decodeOutcome(row.record_json));
        return outcomes.filter(
          (outcome): outcome is ReportedOutcome => outcome.state === "reported",
        );
      },
      Effect.mapError(fail("list-reported")),
    ),
    openItems: Effect.fn("FactoryOutcomeStore.openItems")(
      function* (factoryId: FactoryId) {
        const rows = yield* sql<{ readonly item_key: string }>`
          SELECT DISTINCT item_key FROM factory_outcomes AS outcome
          WHERE factory_id = ${factoryId} AND state IN ('verified', 'reported')
            AND NOT EXISTS (
              SELECT 1 FROM factory_outcomes AS closure
              WHERE closure.factory_id = outcome.factory_id
                AND closure.item_key = outcome.item_key
                AND closure.state = 'verified'
                AND json_extract(closure.record_json, '$.report.outcome') = 'closed'
            )
          ORDER BY item_key
        `;
        return rows.map((row) => makeItemKey(row.item_key));
      },
      Effect.mapError(fail("open-items")),
    ),
    listForOrigin: Effect.fn("FactoryOutcomeStore.listForOrigin")(
      function* (originId: string) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_outcomes WHERE origin_id = ${originId} ORDER BY rowid
        `;
        return yield* Effect.forEach(rows, (row) => decodeOutcome(row.record_json));
      },
      Effect.mapError(fail("list-for-origin")),
    ),
    markVerified: Effect.fn("FactoryOutcomeStore.markVerified")(
      function* (input: {
        readonly outcomeId: string;
        readonly receipt: typeof Receipt.Type;
        /** For an implementation, the artifacts verification read and found as reported. */
        readonly evidenceDigest?: string | undefined;
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const current = yield* readOutcome(input.outcomeId);
            if (Option.isNone(current) || current.value.state !== "reported") return false;
            const outcome = current.value;
            const verified: FactoryOutcome = {
              ...reportedFields(outcome),
              state: "verified",
              receipt: input.receipt,
            };
            if (!(yield* writeOutcome(verified, "reported"))) return false;
            const head =
              outcome.report.outcome === "implemented" ||
              outcome.report.outcome === "review_passed" ||
              outcome.report.outcome === "review_failed"
                ? outcome.report.subject?.headCommit
                : undefined;
            const reservationId =
              outcome.origin.type === "execution"
                ? outcome.origin.reservationId
                : outcome.origin.reservationId;
            yield* appendEvent(outcome.factoryId, outcome.itemKey, {
              type: "outcome",
              outcomeId: outcome.outcomeId,
              stage: outcome.stage,
              kind: outcome.report.outcome,
              ...(reservationId === undefined ? {} : { reservationId }),
              ...(head === undefined ? {} : { head }),
              ...(input.evidenceDigest === undefined
                ? {}
                : { evidenceDigest: input.evidenceDigest }),
              ...(outcome.failureDigest === undefined
                ? {}
                : { failureDigest: outcome.failureDigest }),
              ...(outcome.corrects === undefined ? {} : { corrects: outcome.corrects }),
            });
            return true;
          }),
        );
      },
      Effect.mapError(fail("mark-verified")),
    ),
    markRejected: Effect.fn("FactoryOutcomeStore.markRejected")(
      function* (input: { readonly outcomeId: string; readonly rejection: string }) {
        const current = yield* readOutcome(input.outcomeId);
        if (Option.isNone(current) || current.value.state !== "reported") return false;
        return yield* writeOutcome(
          {
            ...reportedFields(current.value),
            state: "rejected",
            rejection: input.rejection,
            rejectedAt: DateTime.formatIso(yield* DateTime.now),
          },
          "reported",
        );
      },
      Effect.mapError(fail("mark-rejected")),
    ),
    rejectVerified: Effect.fn("FactoryOutcomeStore.rejectVerified")(
      function* (input: {
        readonly outcomeId: string;
        readonly failureDigest: string;
        readonly by: string;
        readonly reason: string;
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const current = yield* readOutcome(input.outcomeId);
            if (Option.isNone(current) || current.value.state !== "verified") return false;
            const records = yield* itemRecords({
              factoryId: current.value.factoryId,
              itemKey: current.value.itemKey,
            });
            if (
              records.some(
                ({ record }) => record.type === "rejected" && record.outcomeId === input.outcomeId,
              )
            ) {
              return false;
            }
            yield* appendEvent(current.value.factoryId, current.value.itemKey, {
              type: "rejected",
              outcomeId: input.outcomeId,
              failureDigest: input.failureDigest,
              by: input.by,
              reason: input.reason,
            });
            return true;
          }),
        );
      },
      Effect.mapError(fail("reject-verified")),
    ),
    recordBasisChange: Effect.fn("FactoryOutcomeStore.recordBasisChange")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly itemKey: FactoryItemKey;
        readonly reservationId: string;
        readonly basisDigest: string;
        readonly observationId: number;
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const records = yield* itemRecords(input);
            if (
              records.some(
                ({ record }) =>
                  record.type === "basis_changed" &&
                  record.reservationId === input.reservationId &&
                  record.basisDigest === input.basisDigest,
              )
            ) {
              return false;
            }
            yield* appendEvent(input.factoryId, input.itemKey, {
              type: "basis_changed",
              reservationId: input.reservationId,
              basisDigest: input.basisDigest,
              observationId: input.observationId,
            });
            return true;
          }),
        );
      },
      Effect.mapError(fail("record-basis-change")),
    ),
    itemEvents: Effect.fn("FactoryOutcomeStore.itemEvents")(
      function* (input: { readonly factoryId: FactoryId; readonly itemKey: FactoryItemKey }) {
        const records = yield* itemRecords(input);
        const admittedAt = new Map<string, number>();
        const events: Array<StoredItemEvent> = [];
        for (const { seq, record } of records) {
          switch (record.type) {
            case "admitted":
              if (!LIFECYCLE_STAGES.has(record.stage)) break;
              admittedAt.set(record.reservationId, seq);
              events.push({
                type: "admitted",
                seq,
                stage: record.stage as FactoryStageType,
                reservationId: record.reservationId,
              });
              break;
            case "outcome": {
              const admittedSeq =
                record.reservationId === undefined
                  ? undefined
                  : admittedAt.get(record.reservationId);
              events.push({
                type: "outcome",
                seq,
                outcomeId: record.outcomeId,
                stage: record.stage,
                kind: record.kind,
                ...(admittedSeq === undefined ? {} : { admittedSeq }),
                ...(record.head === undefined ? {} : { head: record.head }),
                ...(record.evidenceDigest === undefined
                  ? {}
                  : { evidenceDigest: record.evidenceDigest }),
                ...(record.failureDigest === undefined
                  ? {}
                  : { failureDigest: record.failureDigest }),
                ...(record.corrects === undefined ? {} : { corrects: record.corrects }),
              });
              break;
            }
            case "rejected":
              events.push({
                type: "rejected",
                seq,
                outcomeId: record.outcomeId,
                failureDigest: record.failureDigest,
              });
              break;
            case "basis_changed":
              break;
          }
        }
        return events;
      },
      Effect.mapError(fail("item-events")),
    ),
    itemRecords,
    reserveDecision: Effect.fn("FactoryOutcomeStore.reserveDecision")(
      function* (input: Omit<ReservedDecision, "state" | "createdAt" | "resolution">) {
        const decision: ReservedDecision = {
          ...input,
          state: "pending",
          createdAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* sql`
          INSERT INTO factory_reserved_decisions (
            decision_id, factory_id, item_key, state, record_json
          ) VALUES (
            ${decision.decisionId}, ${decision.factoryId}, ${decision.itemKey}, 'pending',
            ${yield* encodeDecision(decision)}
          )
          ON CONFLICT(decision_id) DO NOTHING
        `;
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_reserved_decisions WHERE decision_id = ${decision.decisionId}
        `;
        return yield* decodeDecision(rows[0]!.record_json);
      },
      Effect.mapError(fail("reserve-decision")),
    ),
    reservedDecisions: Effect.fn("FactoryOutcomeStore.reservedDecisions")(
      function* (factoryId: FactoryId) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_reserved_decisions
          WHERE factory_id = ${factoryId} ORDER BY rowid
        `;
        return yield* Effect.forEach(rows, (row) => decodeDecision(row.record_json));
      },
      Effect.mapError(fail("reserved-decisions")),
    ),
    resolveDecision: Effect.fn("FactoryOutcomeStore.resolveDecision")(
      function* (input: {
        readonly decisionId: string;
        readonly answer: string;
        readonly by: string;
        readonly grantId?: string;
      }) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_reserved_decisions
          WHERE decision_id = ${input.decisionId} AND state = 'pending'
        `;
        if (rows[0] === undefined) return false;
        const pending = yield* decodeDecision(rows[0].record_json);
        const resolved: ReservedDecision = {
          ...pending,
          state: "resolved",
          resolution: {
            answer: input.answer,
            by: input.by,
            resolvedAt: DateTime.formatIso(yield* DateTime.now),
            ...(input.grantId === undefined ? {} : { grantId: input.grantId }),
          },
        };
        const updated = yield* sql`
          UPDATE factory_reserved_decisions
          SET state = 'resolved', record_json = ${yield* encodeDecision(resolved)}
          WHERE decision_id = ${input.decisionId} AND state = 'pending'
          RETURNING decision_id
        `;
        return updated.length === 1;
      },
      Effect.mapError(fail("resolve-decision")),
    ),
    supersedeDecision: Effect.fn("FactoryOutcomeStore.supersedeDecision")(
      function* (input: { readonly decisionId: string; readonly reason: string }) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_reserved_decisions
          WHERE decision_id = ${input.decisionId} AND state = 'pending'
        `;
        if (rows[0] === undefined) return false;
        const superseded: ReservedDecision = {
          ...(yield* decodeDecision(rows[0].record_json)),
          state: "superseded",
          superseded: { reason: input.reason, at: DateTime.formatIso(yield* DateTime.now) },
        };
        const updated = yield* sql`
          UPDATE factory_reserved_decisions
          SET state = 'superseded', record_json = ${yield* encodeDecision(superseded)}
          WHERE decision_id = ${input.decisionId} AND state = 'pending'
          RETURNING decision_id
        `;
        return updated.length === 1;
      },
      Effect.mapError(fail("supersede-decision")),
    ),
  });
});

export const layer = Layer.effect(FactoryOutcomeStore, make);
