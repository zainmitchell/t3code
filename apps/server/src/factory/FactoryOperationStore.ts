import { FactoryId, FactoryItemKey, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { OperationWait, redact } from "./factoryOperationWait.ts";
import * as FactoryStore from "./FactoryStore.ts";

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
  /**
   * A new tracker issue T3 opens for an item, such as the correction ticket a verification-only
   * item's spec asks for. `issueNumber` is the item it is opened for; the new issue carries
   * `marker` in its body, which the readback finds it by among this account's issues since
   * `since`.
   */
  Schema.Struct({
    kind: Schema.Literal("tracker_create_issue"),
    ...IssueTarget,
    marker: Schema.String,
    title: Schema.String,
    body: Schema.String,
    labels: Schema.Array(Schema.String),
    /** The issue the new one is a sub-issue of, in the same repository. */
    parentIssueNumber: Schema.NullOr(Schema.Int),
    /** Issues the new one blocks (it is added to their blocked-by relation). */
    blocks: Schema.Array(Schema.Int),
    since: Schema.String,
    /** The item's stage when the ticket was asked for; its outcome is recorded at that stage. */
    stage: Schema.Literals(["implement", "review", "correct", "rework", "triage"]),
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
    kind: Schema.Literal("tracker_create_issue"),
    repository: Schema.String,
    number: Schema.Int,
    bodyDigest: Schema.String,
    /** The relations read back on the new issue: its parent and the issues it blocks. */
    parentLinked: Schema.Boolean,
    blocking: Schema.Array(Schema.Int),
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
  /** Why the last attempt did not end it, as the factory's state shows it: `wait`, rendered. */
  lastError: Schema.optional(Schema.String),
  wait: Schema.optional(OperationWait),
  /**
   * The issue a `tracker_create_issue` created, recorded as soon as it is known: later attempts
   * continue on it, so a lagging marker listing can never cause a second create.
   */
  createdIssue: Schema.optional(Schema.Struct({ number: Schema.Int, id: Schema.Int })),
  /**
   * The create this operation recorded before sending it. Until its issue is identified, no other
   * create is sent unless `cleared` names what showed none stands: GitHub's refusal or the owner.
   * `unconfirmedAt`: a later attempt searched for it and found nothing; only then is the owner asked.
   */
  createPending: Schema.optional(
    Schema.Struct({
      attempt: Schema.Int,
      at: Schema.String,
      cleared: Schema.optional(Schema.String),
      unconfirmedAt: Schema.optional(Schema.String),
    }),
  ),
  /**
   * The pull request create a `pull_request_merge` recorded before sending it. Until a pull request
   * from its head into its base is listed, no other create is sent unless `cleared` names what showed
   * none stands from it: a refusal, or a create that never left.
   */
  pullRequestCreate: Schema.optional(
    Schema.Struct({
      attempt: Schema.Int,
      at: Schema.String,
      cleared: Schema.optional(Schema.String),
    }),
  ),
  /**
   * The head a `pull_request_merge` put on its branch, once the remote accepted it: the only proof
   * that a tip there is T3's own for this item. A commit merely existing locally proves nothing.
   */
  published: Schema.optional(
    Schema.Struct({ branch: Schema.String, commit: Schema.String, at: Schema.String }),
  ),
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
    /**
     * Records a new intent only beside the custody its pass weighed, in one commit: none when that
     * custody moved. An intent already recorded under the id is returned as it is.
     */
    readonly intendBeside: (
      input: {
        readonly operationId: string;
        readonly factoryId: FactoryId;
        readonly itemKey: FactoryItemKey;
        readonly intent: FactoryOperationIntent;
      },
      fence: FactoryStore.CustodyFence,
    ) => Effect.Effect<Option.Option<FactoryOperation>, FactoryOperationStoreError>;
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
    /**
     * Records how an intended operation ended; false when it already ended. With `createAttempt`, the
     * completion is only that pull request create's to give: false when the record names another.
     */
    readonly complete: (input: {
      readonly operationId: string;
      readonly completion: FactoryOperationCompletion;
      readonly createAttempt?: number;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    /**
     * Keeps an intended operation intended, with why its last attempt did not end it. A wait on
     * the same basis keeps its `since`; false when the record already said exactly this.
     */
    readonly noteWait: (input: {
      readonly operationId: string;
      readonly wait: Omit<OperationWait, "since">;
      readonly text: string;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    /**
     * Records the issue an intended operation created; the first one recorded stays. Returns the
     * operation's recorded issue, or none if it has ended.
     */
    /**
     * Records, before it is sent, the create an intended operation is about to send; none when its
     * issue is known, an uncleared create is recorded, or another attempt recorded one first.
     */
    readonly noteCreatePending: (
      operationId: string,
    ) => Effect.Effect<Option.Option<{ readonly attempt: number }>, FactoryOperationStoreError>;
    /**
     * Records, before it is sent, the pull request create an intended operation is about to send;
     * none when an uncleared create is recorded or another attempt recorded one first.
     */
    readonly notePullRequestCreate: (
      operationId: string,
    ) => Effect.Effect<Option.Option<{ readonly attempt: number }>, FactoryOperationStoreError>;
    /** Records the head an intended pull request merge published on its branch. */
    readonly notePublished: (input: {
      readonly operationId: string;
      readonly branch: string;
      readonly commit: string;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    /** Clears that pull request create, naming why none stands from it; false if it changed. */
    readonly clearPullRequestCreate: (input: {
      readonly operationId: string;
      readonly attempt: number;
      readonly by: string;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    /** Records that a search after that create's attempt found nothing; false if it changed. */
    readonly noteCreateUnconfirmed: (input: {
      readonly operationId: string;
      readonly attempt: number;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    /** Clears that create's hold, naming why no create stands from it; false if it changed. */
    readonly clearCreatePending: (input: {
      readonly operationId: string;
      readonly attempt: number;
      readonly by: string;
    }) => Effect.Effect<boolean, FactoryOperationStoreError>;
    readonly noteCreatedIssue: (input: {
      readonly operationId: string;
      readonly issue: { readonly number: number; readonly id: number };
    }) => Effect.Effect<
      Option.Option<{ readonly number: number; readonly id: number }>,
      FactoryOperationStoreError
    >;
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

  /**
   * Rewrites an intended operation's record as `change` says, compared with the record as read so
   * concurrent amendments never erase each other's fields; none when `change` declines or it ended.
   */
  const amend = Effect.fnUntraced(function* (
    operationId: string,
    change: (current: IntendedOperation) => IntendedOperation | undefined,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM factory_operations
        WHERE operation_id = ${operationId} AND state = 'intended'
      `;
      const row = rows[0];
      if (row === undefined) return Option.none<IntendedOperation>();
      const current = yield* decodeOperation(row.record_json);
      if (current.state !== "intended") return Option.none<IntendedOperation>();
      const next = change(current);
      if (next === undefined) return Option.none<IntendedOperation>();
      const written = yield* sql`
        UPDATE factory_operations
        SET record_json = ${yield* encodeOperation(next)}
        WHERE operation_id = ${operationId} AND state = 'intended'
          AND record_json = ${row.record_json}
        RETURNING operation_id
      `;
      if (written.length === 1) return Option.some(next);
    }
    return Option.none<IntendedOperation>();
  });

  const insertIntent = Effect.fnUntraced(function* (input: {
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
  });

  return FactoryOperationStore.of({
    intend: Effect.fn("FactoryOperationStore.intend")(
      insertIntent,
      Effect.mapError(fail("intend")),
    ),
    intendBeside: Effect.fn("FactoryOperationStore.intendBeside")(
      function* (
        input: {
          readonly operationId: string;
          readonly factoryId: FactoryId;
          readonly itemKey: FactoryItemKey;
          readonly intent: FactoryOperationIntent;
        },
        fence: FactoryStore.CustodyFence,
      ) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const existing = yield* read(input.operationId);
            if (Option.isSome(existing)) return existing;
            if (yield* FactoryStore.custodyMoved(sql, fence))
              return Option.none<FactoryOperation>();
            return Option.some(yield* insertIntent(input));
          }),
        );
      },
      Effect.mapError(fail("intend-beside")),
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
        readonly createAttempt?: number;
      }) {
        const completedAt = DateTime.formatIso(yield* DateTime.now);
        // Compared with the record as read, so a create recorded meanwhile is never ended by an
        // answer about an earlier one.
        for (let attempt = 0; attempt < 5; attempt++) {
          const rows = yield* sql<{ readonly record_json: string }>`
            SELECT record_json FROM factory_operations
            WHERE operation_id = ${input.operationId} AND state = 'intended'
          `;
          const row = rows[0];
          if (row === undefined) return false;
          const current = yield* decodeOperation(row.record_json);
          if (current.state !== "intended") return false;
          if (
            input.createAttempt !== undefined &&
            current.pullRequestCreate?.attempt !== input.createAttempt
          ) {
            return false;
          }
          const { state: _state, lastError: _lastError, wait: _wait, ...fields } = current;
          const completed: FactoryOperation =
            input.completion.state === "applied"
              ? { ...fields, state: "applied", receipt: input.completion.receipt, completedAt }
              : {
                  ...fields,
                  state: input.completion.state,
                  reason: input.completion.reason,
                  completedAt,
                };
          const written = yield* sql`
            UPDATE factory_operations
            SET state = ${completed.state}, record_json = ${yield* encodeOperation(completed)}
            WHERE operation_id = ${input.operationId} AND state = 'intended'
              AND record_json = ${row.record_json}
            RETURNING operation_id
          `;
          if (written.length === 1) return true;
        }
        return false;
      },
      Effect.mapError(fail("complete")),
    ),
    noteWait: Effect.fn("FactoryOperationStore.noteWait")(
      function* (input: {
        readonly operationId: string;
        readonly wait: Omit<OperationWait, "since">;
        readonly text: string;
      }) {
        const at = DateTime.formatIso(yield* DateTime.now);
        const text = redact(input.text);
        const wait = {
          ...input.wait,
          actor: redact(input.wait.actor),
          action: redact(input.wait.action),
          resume: redact(input.wait.resume),
        };
        const written = yield* amend(input.operationId, (current) => {
          const previous = current.wait;
          const same = previous?.basis === wait.basis && previous.kind === wait.kind;
          if (same && current.lastError === text) return undefined;
          const since = same ? previous.since : at;
          return { ...current, lastError: text, wait: { ...wait, since } };
        });
        return Option.isSome(written);
      },
      Effect.mapError(fail("note-wait")),
    ),
    noteCreatePending: Effect.fn("FactoryOperationStore.noteCreatePending")(
      function* (operationId: string) {
        const at = DateTime.formatIso(yield* DateTime.now);
        const written = yield* amend(operationId, (current) => {
          const previous = current.createPending;
          if (current.createdIssue !== undefined) return undefined;
          if (previous !== undefined && previous.cleared === undefined) return undefined;
          return { ...current, createPending: { attempt: (previous?.attempt ?? 0) + 1, at } };
        });
        return Option.flatMap(written, (operation) =>
          Option.fromNullishOr(operation.createPending),
        ).pipe(Option.map(({ attempt }) => ({ attempt })));
      },
      Effect.mapError(fail("note-create-pending")),
    ),
    notePullRequestCreate: Effect.fn("FactoryOperationStore.notePullRequestCreate")(
      function* (operationId: string) {
        const at = DateTime.formatIso(yield* DateTime.now);
        const written = yield* amend(operationId, (current) => {
          const previous = current.pullRequestCreate;
          if (previous !== undefined && previous.cleared === undefined) return undefined;
          return { ...current, pullRequestCreate: { attempt: (previous?.attempt ?? 0) + 1, at } };
        });
        return Option.flatMap(written, (operation) =>
          Option.fromNullishOr(operation.pullRequestCreate),
        ).pipe(Option.map(({ attempt }) => ({ attempt })));
      },
      Effect.mapError(fail("note-pull-request-create")),
    ),
    notePublished: Effect.fn("FactoryOperationStore.notePublished")(
      function* (input: {
        readonly operationId: string;
        readonly branch: string;
        readonly commit: string;
      }) {
        const at = DateTime.formatIso(yield* DateTime.now);
        const written = yield* amend(input.operationId, (current) =>
          current.published?.branch === input.branch && current.published.commit === input.commit
            ? undefined
            : { ...current, published: { branch: input.branch, commit: input.commit, at } },
        );
        return Option.isSome(written);
      },
      Effect.mapError(fail("note-published")),
    ),
    clearPullRequestCreate: Effect.fn("FactoryOperationStore.clearPullRequestCreate")(
      function* (input: {
        readonly operationId: string;
        readonly attempt: number;
        readonly by: string;
      }) {
        const written = yield* amend(input.operationId, (current) => {
          const pending = current.pullRequestCreate;
          if (pending?.attempt !== input.attempt || pending.cleared !== undefined) return undefined;
          return { ...current, pullRequestCreate: { ...pending, cleared: input.by } };
        });
        return Option.isSome(written);
      },
      Effect.mapError(fail("clear-pull-request-create")),
    ),
    noteCreateUnconfirmed: Effect.fn("FactoryOperationStore.noteCreateUnconfirmed")(
      function* (input: { readonly operationId: string; readonly attempt: number }) {
        const at = DateTime.formatIso(yield* DateTime.now);
        const written = yield* amend(input.operationId, (current) => {
          const pending = current.createPending;
          if (pending?.attempt !== input.attempt || pending.cleared !== undefined) return undefined;
          if (pending.unconfirmedAt !== undefined || current.createdIssue !== undefined) {
            return undefined;
          }
          return { ...current, createPending: { ...pending, unconfirmedAt: at } };
        });
        return Option.isSome(written);
      },
      Effect.mapError(fail("note-create-unconfirmed")),
    ),
    clearCreatePending: Effect.fn("FactoryOperationStore.clearCreatePending")(
      function* (input: {
        readonly operationId: string;
        readonly attempt: number;
        readonly by: string;
      }) {
        const written = yield* amend(input.operationId, (current) => {
          const pending = current.createPending;
          if (pending?.attempt !== input.attempt || pending.cleared !== undefined) return undefined;
          return { ...current, createPending: { ...pending, cleared: input.by } };
        });
        return Option.isSome(written);
      },
      Effect.mapError(fail("clear-create-pending")),
    ),
    noteCreatedIssue: Effect.fn("FactoryOperationStore.noteCreatedIssue")(
      function* (input: {
        readonly operationId: string;
        readonly issue: { readonly number: number; readonly id: number };
      }) {
        const createdIssue = { number: input.issue.number, id: input.issue.id };
        yield* amend(input.operationId, (current) =>
          current.createdIssue === undefined ? { ...current, createdIssue } : undefined,
        );
        // The first issue recorded stays, whichever attempt recorded it.
        const current = yield* read(input.operationId);
        return Option.flatMap(current, (operation) =>
          operation.state === "intended"
            ? Option.fromNullishOr(operation.createdIssue)
            : Option.none(),
        );
      },
      Effect.mapError(fail("note-created-issue")),
    ),
  });
});

export const layer = Layer.effect(FactoryOperationStore, make);
