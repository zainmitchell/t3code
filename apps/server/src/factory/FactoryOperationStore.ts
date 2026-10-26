import { FactoryId, FactoryItemKey, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const IssueTarget = { repository: Schema.String, issueNumber: Schema.Int };

/**
 * What T3 intends to write outside itself for an item. Each carries the stable identity a
 * readback finds it by: a marker in the record it writes, or the exact target state it expects.
 */
export const FactoryOperationIntent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("tracker_comment"),
    ...IssueTarget,
    /** What the record is for, and the outcome or decision it records. */
    purpose: Schema.Literals(["report", "decision"]),
    ref: Schema.String,
    marker: Schema.String,
    body: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("tracker_close"),
    ...IssueTarget,
    /** The closing record, written before the issue is closed. */
    marker: Schema.String,
    body: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("git_integrate"),
    projectId: ProjectId,
    branch: Schema.String,
    /** The remote whose branch is the target; null integrates into the local branch. */
    remote: Schema.NullOr(Schema.String),
    /** The target's tip the integration was decided on; a moved target is not overwritten. */
    expected: Schema.String,
    reviewedHead: Schema.String,
    mode: Schema.Literals(["merge", "fast_forward"]),
    marker: Schema.String,
    message: Schema.String,
    identity: Schema.Struct({ name: Schema.String, email: Schema.String }),
  }),
  Schema.Struct({
    kind: Schema.Literal("pull_request_merge"),
    projectId: ProjectId,
    /** The code repository on the tracker's host, and the remote its branches are pushed to. */
    repository: Schema.String,
    remote: Schema.String,
    base: Schema.String,
    /** The branch the reviewed head is published to; its open pull request is this merge's. */
    head: Schema.String,
    reviewedHead: Schema.String,
    method: Schema.Literals(["merge", "squash", "rebase"]),
    /** Carried by the merge commit's message, so a lost answer is read back as ours. */
    marker: Schema.String,
    title: Schema.String,
    body: Schema.String,
    /** The acceptance status the merge needs on the reviewed head, posted before it. */
    acceptanceStatus: Schema.optional(
      Schema.Struct({ context: Schema.String, description: Schema.String }),
    ),
  }),
]);
export type FactoryOperationIntent = typeof FactoryOperationIntent.Type;

export const FactoryOperationReceipt = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("tracker_comment"),
    commentId: Schema.Int,
    bodyDigest: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("tracker_close"),
    commentId: Schema.Int,
    bodyDigest: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("git_integrate"),
    branch: Schema.String,
    commit: Schema.String,
    parents: Schema.Array(Schema.String),
    tree: Schema.String,
    /** `external`: the reviewed head was already in the target, landed by someone else. */
    attribution: Schema.Literals(["operation", "external"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("pull_request_merge"),
    repository: Schema.String,
    number: Schema.Int,
    branch: Schema.String,
    commit: Schema.String,
    parents: Schema.Array(Schema.String),
    tree: Schema.String,
    /** `external`: someone else merged the pull request at the reviewed head. */
    attribution: Schema.Literals(["operation", "external"]),
  }),
]);
export type FactoryOperationReceipt = typeof FactoryOperationReceipt.Type;

const Fields = {
  operationId: Schema.String,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  intent: FactoryOperationIntent,
  createdAt: Schema.String,
  /** The last attempt that could not tell whether the write applied, kept for the readback. */
  lastError: Schema.optional(Schema.String),
};

export const FactoryOperation = Schema.Union([
  Schema.Struct({ ...Fields, state: Schema.Literal("intended") }),
  Schema.Struct({
    ...Fields,
    state: Schema.Literal("applied"),
    receipt: FactoryOperationReceipt,
    completedAt: Schema.String,
  }),
  /** Its precondition no longer holds and nothing was written; a fresh decision replaces it. */
  Schema.Struct({
    ...Fields,
    state: Schema.Literal("stale"),
    reason: Schema.String,
    completedAt: Schema.String,
  }),
  /** Proved not applied and not applicable, such as a merge conflict. */
  Schema.Struct({
    ...Fields,
    state: Schema.Literal("failed"),
    reason: Schema.String,
    completedAt: Schema.String,
  }),
]);
export type FactoryOperation = typeof FactoryOperation.Type;
export type IntendedOperation = Extract<FactoryOperation, { readonly state: "intended" }>;

export type FactoryOperationCompletion =
  | { readonly state: "applied"; readonly receipt: FactoryOperationReceipt }
  | { readonly state: "stale" | "failed"; readonly reason: string };

export class FactoryOperationStoreError extends Schema.TaggedError<FactoryOperationStoreError>()(
  "FactoryOperationStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory operation store ${this.operation} failed.`;
  }
}

export class FactoryOperationStore extends Context.Service<
  FactoryOperationStore,
  {
    /** Records the intent once; an intent already recorded under the id is returned as it is. */
    readonly intend: (input: {
      readonly operationId: string;
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly intent: FactoryOperationIntent;
    }) => Effect.Effect<FactoryOperation, FactoryOperationStoreError>;
    readonly get: (
      operationId: string,
    ) => Effect.Effect<Option.Option<FactoryOperation>, FactoryOperationStoreError>;
    readonly listIntended: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<IntendedOperation>, FactoryOperationStoreError>;
    /** Operations that ended (applied or failed), oldest first. */
    readonly listEnded: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<FactoryOperation>, FactoryOperationStoreError>;
    readonly forItem: (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
    }) => Effect.Effect<ReadonlyArray<FactoryOperation>, FactoryOperationStoreError>;
    /** Records how an intended operation ended; false when it already ended. */
    readonly complete: (input: {
      readonly operationId: string;
      readonly completion: FactoryOperationCompletion;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    /** Keeps an intended operation intended, with why its last attempt could not be known. */
    readonly noteUncertain: (input: {
      readonly operationId: string;
      readonly error: string;
    }) => Effect.Effect<void, FactoryOperationStoreError>;
  }
>()("t3/factory/FactoryOperationStore") {}

const OperationJson = Schema.fromJsonString(FactoryOperation);
const encodeOperation = Schema.encodeEffect(OperationJson, { onExcessProperty: "error" });
const decodeOperation = Schema.decodeUnknownEffect(OperationJson);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) =>
    new FactoryOperationStoreError({ operation, cause });

  const read = (operationId: string) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_operations WHERE operation_id = ${operationId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryOperation>())
          : Effect.asSome(decodeOperation(rows[0].record_json)),
      ),
    );

  const list = (rows: ReadonlyArray<{ readonly record_json: string }>) =>
    Effect.forEach(rows, (row) => decodeOperation(row.record_json));

  return FactoryOperationStore.of({
    intend: Effect.fn("FactoryOperationStore.intend")(
      function* (input: {
        readonly operationId: string;
        readonly factoryId: FactoryId;
        readonly itemKey: FactoryItemKey;
        readonly intent: FactoryOperationIntent;
      }) {
        const operation: FactoryOperation = {
          ...input,
          state: "intended",
          createdAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* sql`
          INSERT INTO factory_operations (operation_id, factory_id, item_key, state, record_json)
          VALUES (
            ${operation.operationId}, ${operation.factoryId}, ${operation.itemKey}, 'intended',
            ${yield* encodeOperation(operation)}
          )
          ON CONFLICT(operation_id) DO NOTHING
        `;
        return Option.getOrThrow(yield* read(input.operationId));
      },
      Effect.mapError(fail("intend")),
    ),
    get: Effect.fn("FactoryOperationStore.get")(read, Effect.mapError(fail("get"))),
    listIntended: Effect.fn("FactoryOperationStore.listIntended")(
      function* (factoryId: FactoryId) {
        const operations = yield* list(
          yield* sql<{ readonly record_json: string }>`
            SELECT record_json FROM factory_operations
            WHERE factory_id = ${factoryId} AND state = 'intended' ORDER BY rowid
          `,
        );
        return operations.filter(
          (operation): operation is IntendedOperation => operation.state === "intended",
        );
      },
      Effect.mapError(fail("list-intended")),
    ),
    listEnded: Effect.fn("FactoryOperationStore.listEnded")(
      function* (factoryId: FactoryId) {
        return yield* list(
          yield* sql<{ readonly record_json: string }>`
            SELECT record_json FROM factory_operations
            WHERE factory_id = ${factoryId} AND state IN ('applied', 'failed') ORDER BY rowid
          `,
        );
      },
      Effect.mapError(fail("list-ended")),
    ),
    forItem: Effect.fn("FactoryOperationStore.forItem")(
      function* (input: { readonly factoryId: FactoryId; readonly itemKey: FactoryItemKey }) {
        return yield* list(
          yield* sql<{ readonly record_json: string }>`
            SELECT record_json FROM factory_operations
            WHERE factory_id = ${input.factoryId} AND item_key = ${input.itemKey} ORDER BY rowid
          `,
        );
      },
      Effect.mapError(fail("for-item")),
    ),
    complete: Effect.fn("FactoryOperationStore.complete")(
      function* (input: {
        readonly operationId: string;
        readonly completion: FactoryOperationCompletion;
      }) {
        const current = yield* read(input.operationId);
        if (Option.isNone(current) || current.value.state !== "intended") return false;
        const { state: _state, lastError: _lastError, ...fields } = current.value;
        const completedAt = DateTime.formatIso(yield* DateTime.now);
        const completed: FactoryOperation =
          input.completion.state === "applied"
            ? { ...fields, state: "applied", receipt: input.completion.receipt, completedAt }
            : {
                ...fields,
                state: input.completion.state,
                reason: input.completion.reason,
                completedAt,
              };
        const rows = yield* sql`
          UPDATE factory_operations
          SET state = ${completed.state}, record_json = ${yield* encodeOperation(completed)}
          WHERE operation_id = ${input.operationId} AND state = 'intended'
          RETURNING operation_id
        `;
        return rows.length === 1;
      },
      Effect.mapError(fail("complete")),
    ),
    noteUncertain: Effect.fn("FactoryOperationStore.noteUncertain")(
      function* (input: { readonly operationId: string; readonly error: string }) {
        const current = yield* read(input.operationId);
        if (Option.isNone(current) || current.value.state !== "intended") return;
        yield* sql`
          UPDATE factory_operations
          SET record_json = ${yield* encodeOperation({ ...current.value, lastError: input.error })}
          WHERE operation_id = ${input.operationId} AND state = 'intended'
        `;
      },
      Effect.mapError(fail("note-uncertain")),
    ),
  });
});

export const layer = Layer.effect(FactoryOperationStore, make);
