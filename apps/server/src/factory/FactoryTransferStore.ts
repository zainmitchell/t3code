import {
  FactoryClaimCarrierKey,
  FactoryId,
  FactoryItemKey,
  FactoryReservationId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * One legacy worker as its writer recorded it, with its thread as T3 saw it at adoption. The
 * thread's state is an observation, never proof its work ended: nothing contained it.
 */
export const LegacyWorker = Schema.Struct({
  workId: Schema.String,
  taskId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  title: Schema.String,
  branch: Schema.String,
  model: Schema.String,
  recordedAt: Schema.String,
  promptSha256: Schema.NullOr(Schema.String),
  resolvedBaseCommit: Schema.NullOr(Schema.String),
  recoveryError: Schema.NullOr(Schema.String),
  state: Schema.String,
  terminal: Schema.NullOr(Schema.Boolean),
  runs: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
});
export type LegacyWorker = typeof LegacyWorker.Type;

const RequestedItem = Schema.Struct({
  itemKey: FactoryItemKey,
  workIds: Schema.Array(Schema.String),
  /** Workers the owner already accounted for, with why: recorded, bound, never charged. */
  historical: Schema.optional(
    Schema.Array(Schema.Struct({ workId: Schema.String, reason: Schema.String })),
  ),
  /** Effects the legacy writer may have made outside T3 that nobody read back. */
  uncertain: Schema.Array(Schema.String),
});

/**
 * A legacy command job's work on chosen items, handed to a factory. While `draining` the job's
 * writer is fenced but its last pass may still run; `adopted` the items are the factory's, their
 * legacy custody held until the owner disposes of it; `rolled_back` they are the job's again.
 */
export const FactoryTransfer = Schema.Struct({
  transferId: Schema.String,
  factoryId: FactoryId,
  job: Schema.String,
  /** Who the transfer holds the job's writer fence as. */
  holder: Schema.String,
  state: Schema.Literals(["draining", "adopted", "rolled_back"]),
  by: Schema.String,
  createdAt: Schema.String,
  items: Schema.Array(RequestedItem),
  adopted: Schema.optional(
    Schema.Struct({
      at: Schema.String,
      fenceGeneration: Schema.Int,
      receiptsSha256: Schema.NullOr(Schema.String),
      /** The job's last pass as it recorded itself; a clean end says nothing of its descendants. */
      lastPass: Schema.NullOr(Schema.Struct({ runId: Schema.String, status: Schema.String })),
      items: Schema.Array(
        Schema.Struct({
          itemKey: FactoryItemKey,
          workers: Schema.Array(LegacyWorker),
          /** The legacy claim carriers whose observed reservations hold the item's custody. */
          carriers: Schema.Array(FactoryClaimCarrierKey),
          /** One reservation per legacy worker, bound to its thread; one for the item if none. */
          custody: Schema.Array(
            Schema.Struct({
              reservationId: FactoryReservationId,
              workId: Schema.NullOr(Schema.String),
              threadId: Schema.NullOr(Schema.String),
              state: Schema.Literals(["held", "historical"]),
            }),
          ),
        }),
      ),
    }),
  ),
  rolledBack: Schema.optional(
    Schema.Struct({ by: Schema.String, reason: Schema.String, at: Schema.String }),
  ),
});
export type FactoryTransfer = typeof FactoryTransfer.Type;

export class FactoryTransferStoreError extends Schema.TaggedError<FactoryTransferStoreError>()(
  "FactoryTransferStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory transfer store ${this.operation} failed.`;
  }
}

export class FactoryTransferStore extends Context.Service<
  FactoryTransferStore,
  {
    readonly get: (
      transferId: string,
    ) => Effect.Effect<Option.Option<FactoryTransfer>, FactoryTransferStoreError>;
    /** The factory's transfers, oldest first; an item's latest one says who owns it. */
    readonly list: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<FactoryTransfer>, FactoryTransferStoreError>;
    /** Records a new transfer as draining; an existing one is returned as it is. */
    readonly begin: (
      transfer: Omit<FactoryTransfer, "state" | "createdAt" | "adopted" | "rolledBack">,
    ) => Effect.Effect<FactoryTransfer, FactoryTransferStoreError>;
    /** Draining to adopted, once; false when it was not draining. */
    readonly adopt: (input: {
      readonly transferId: string;
      readonly adopted: NonNullable<FactoryTransfer["adopted"]>;
    }) => Effect.Effect<boolean, FactoryTransferStoreError>;
    /** Draining or adopted to rolled back, once; false when it already was. */
    readonly rollBack: (input: {
      readonly transferId: string;
      readonly by: string;
      readonly reason: string;
    }) => Effect.Effect<boolean, FactoryTransferStoreError>;
  }
>()("t3/factory/FactoryTransferStore") {}

const TransferJson = Schema.fromJsonString(FactoryTransfer);
const encodeTransfer = Schema.encodeEffect(TransferJson, { onExcessProperty: "error" });
const decodeTransfer = Schema.decodeUnknownEffect(TransferJson);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) =>
    new FactoryTransferStoreError({ operation, cause });

  const read = (transferId: string) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_transfers WHERE transfer_id = ${transferId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryTransfer>())
          : Effect.asSome(decodeTransfer(rows[0].record_json)),
      ),
    );

  const transition = (
    transferId: string,
    from: ReadonlyArray<FactoryTransfer["state"]>,
    next: (transfer: FactoryTransfer) => Effect.Effect<FactoryTransfer>,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const current = yield* read(transferId);
        if (Option.isNone(current) || !from.includes(current.value.state)) return false;
        const changed = yield* next(current.value);
        yield* sql`
          UPDATE factory_transfers
          SET state = ${changed.state}, record_json = ${yield* encodeTransfer(changed)}
          WHERE transfer_id = ${transferId} AND state = ${current.value.state}
        `;
        return true;
      }),
    );

  return FactoryTransferStore.of({
    get: Effect.fn("FactoryTransferStore.get")(function (transferId) {
      return read(transferId).pipe(Effect.mapError(fail("get")));
    }),
    list: Effect.fn("FactoryTransferStore.list")(
      function* (factoryId: FactoryId) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_transfers WHERE factory_id = ${factoryId} ORDER BY rowid
        `;
        return yield* Effect.forEach(rows, (row) => decodeTransfer(row.record_json));
      },
      Effect.mapError(fail("list")),
    ),
    begin: Effect.fn("FactoryTransferStore.begin")(
      function* (input: Omit<FactoryTransfer, "state" | "createdAt" | "adopted" | "rolledBack">) {
        const transfer: FactoryTransfer = {
          ...input,
          state: "draining",
          createdAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* sql`
          INSERT INTO factory_transfers (transfer_id, factory_id, job_name, state, record_json)
          VALUES (
            ${transfer.transferId}, ${transfer.factoryId}, ${transfer.job}, 'draining',
            ${yield* encodeTransfer(transfer)}
          )
          ON CONFLICT(transfer_id) DO NOTHING
        `;
        return Option.getOrThrow(yield* read(input.transferId));
      },
      Effect.mapError(fail("begin")),
    ),
    adopt: Effect.fn("FactoryTransferStore.adopt")(function (input) {
      return transition(input.transferId, ["draining"], (transfer) =>
        Effect.succeed({ ...transfer, state: "adopted", adopted: input.adopted }),
      ).pipe(Effect.mapError(fail("adopt")));
    }),
    rollBack: Effect.fn("FactoryTransferStore.rollBack")(function (input) {
      return transition(input.transferId, ["draining", "adopted"], (transfer) =>
        Effect.map(DateTime.now, (now) => ({
          ...transfer,
          state: "rolled_back" as const,
          rolledBack: { by: input.by, reason: input.reason, at: DateTime.formatIso(now) },
        })),
      ).pipe(Effect.mapError(fail("roll-back")));
    }),
  });
});

export const layer = Layer.effect(FactoryTransferStore, make);
