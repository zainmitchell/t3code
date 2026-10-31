import { FactoryId, FactoryItemKey } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Text = Schema.String.check(Schema.isMinLength(1));

export const CreationIdentity = Schema.Struct({
  device: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)),
  inode: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
});
export type CreationIdentity = typeof CreationIdentity.Type;

export const Reservation = Schema.Struct({
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  issue: Schema.Int,
  root: Text,
  rootIdentity: Schema.optional(CreationIdentity),
  path: Text,
  digest: Digest,
  basis: Schema.Struct({
    configurationRevision: Schema.Int,
    policyRevision: Text,
    itemVersion: Text,
    bodySha256: Digest,
    proposalOutcomeId: Text,
  }),
  creationId: Text,
  anchorPath: Text,
});
export type Reservation = typeof Reservation.Type;

export const PreparedCriteria = Schema.Union([
  Schema.Struct({ reservation: Reservation, state: Schema.Literal("reserved") }),
  Schema.Struct({
    reservation: Reservation,
    state: Schema.Literals(["identified", "published"]),
    identity: CreationIdentity,
  }),
]);
export type PreparedCriteria = typeof PreparedCriteria.Type;

type Creation = { readonly reservation: Reservation; readonly identity: CreationIdentity };

export class FactoryPreparedCriteriaStoreError extends Schema.TaggedError<FactoryPreparedCriteriaStoreError>()(
  "FactoryPreparedCriteriaStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Prepared criteria store ${this.operation} failed.`;
  }
}

export class FactoryPreparedCriteriaStore extends Context.Service<
  FactoryPreparedCriteriaStore,
  {
    /** Paths are canonical absolute paths supplied by the publication service. */
    readonly reserve: (
      input: Reservation,
    ) => Effect.Effect<Option.Option<PreparedCriteria>, FactoryPreparedCriteriaStoreError>;
    readonly get: (
      path: string,
    ) => Effect.Effect<Option.Option<PreparedCriteria>, FactoryPreparedCriteriaStoreError>;
    /** The publisher records identity only after exclusive creation; this store performs no filesystem proof. */
    readonly identify: (
      input: Creation,
    ) => Effect.Effect<Option.Option<PreparedCriteria>, FactoryPreparedCriteriaStoreError>;
    readonly publish: (
      input: Creation,
    ) => Effect.Effect<Option.Option<PreparedCriteria>, FactoryPreparedCriteriaStoreError>;
  }
>()("t3/factory/FactoryPreparedCriteriaStore") {}

const encodeReservation = Schema.encodeEffect(Schema.fromJsonString(Reservation), {
  onExcessProperty: "error",
});
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(PreparedCriteria), {
  onExcessProperty: "error",
});
const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(PreparedCriteria));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) =>
    new FactoryPreparedCriteriaStoreError({ operation, cause });

  const read = Effect.fnUntraced(function* (path: string) {
    const rows = yield* sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_prepared_criteria WHERE target_path = ${path}
    `;
    return rows[0] === undefined
      ? Option.none<PreparedCriteria>()
      : Option.some(yield* decodeRecord(rows[0].record_json));
  });

  const matching = Effect.fnUntraced(function* (reservation: Reservation, encoded: string) {
    const found = yield* read(reservation.path);
    if (Option.isNone(found)) return found;
    return (yield* encodeReservation(found.value.reservation)) === encoded
      ? found
      : Option.none<PreparedCriteria>();
  });

  const transition = Effect.fnUntraced(function* (
    input: Creation,
    state: "identified" | "published",
  ) {
    const reservation = yield* encodeReservation(input.reservation);
    const next = yield* encodeRecord({ ...input, state });
    const before = yield* encodeRecord(
      state === "identified"
        ? { reservation: input.reservation, state: "reserved" }
        : { ...input, state: "identified" },
    );
    yield* sql`
      UPDATE factory_prepared_criteria SET record_json = ${next}
      WHERE target_path = ${input.reservation.path} AND reservation_json = ${reservation}
        AND record_json = ${before}
    `;
    const found = yield* matching(input.reservation, reservation);
    if (Option.isNone(found) || found.value.state === "reserved")
      return Option.none<PreparedCriteria>();
    const current = found.value;
    return current.identity.device === input.identity.device &&
      current.identity.inode === input.identity.inode &&
      (state === "identified" || current.state === "published")
      ? found
      : Option.none<PreparedCriteria>();
  });

  return FactoryPreparedCriteriaStore.of({
    reserve: Effect.fn("FactoryPreparedCriteriaStore.reserve")(
      function* (input: Reservation) {
        const reservation = yield* encodeReservation(input);
        const record = yield* encodeRecord({ reservation: input, state: "reserved" });
        if (input.path === input.anchorPath) return Option.none<PreparedCriteria>();
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const overlap = yield* sql`
          SELECT target_path FROM factory_prepared_criteria
          WHERE target_path = ${input.anchorPath} OR anchor_path = ${input.path}
        `;
            if (overlap.length > 0) return Option.none<PreparedCriteria>();
            yield* sql`
          INSERT INTO factory_prepared_criteria
            (target_path, creation_id, anchor_path, reservation_json, record_json)
          VALUES (${input.path}, ${input.creationId}, ${input.anchorPath}, ${reservation}, ${record})
          ON CONFLICT DO NOTHING
        `;
            return yield* matching(input, reservation);
          }),
        );
      },
      Effect.mapError(fail("reserve")),
    ),
    get: Effect.fn("FactoryPreparedCriteriaStore.get")(read, Effect.mapError(fail("get"))),
    identify: Effect.fn("FactoryPreparedCriteriaStore.identify")(
      (input: Creation) => transition(input, "identified"),
      Effect.mapError(fail("identify")),
    ),
    publish: Effect.fn("FactoryPreparedCriteriaStore.publish")(
      (input: Creation) => transition(input, "published"),
      Effect.mapError(fail("publish")),
    ),
  });
});

export const layer = Layer.effect(FactoryPreparedCriteriaStore, make);
