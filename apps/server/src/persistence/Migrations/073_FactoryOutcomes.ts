import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // An item's outcome, bound to the execution or native operation that produced it: reported,
  // then verified or rejected.
  yield* sql`CREATE TABLE factory_outcomes (
    outcome_id TEXT PRIMARY KEY,
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    origin_id TEXT NOT NULL,
    state TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX factory_outcomes_item ON factory_outcomes (factory_id, item_key)`;
  yield* sql`CREATE INDEX factory_outcomes_origin ON factory_outcomes (origin_id)`;
  // An item's lifecycle facts in one native order: stage admissions, verified outcomes and the
  // owner's dispositions of them.
  yield* sql`CREATE TABLE factory_item_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX factory_item_events_item ON factory_item_events (factory_id, item_key)`;
  // The owner's disposition of a claim carrier nobody could attribute: once recorded, that exact
  // carrier is neither charged nor counted as a claim again.
  yield* sql`CREATE TABLE factory_carrier_dispositions (
    factory_id TEXT NOT NULL,
    carrier_key TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (factory_id, carrier_key)
  )`;
  // A decision only its owner can make, visible until that authority resolves it.
  yield* sql`CREATE TABLE factory_reserved_decisions (
    decision_id TEXT PRIMARY KEY,
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    state TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  // An external write T3 itself makes for an item (a tracker record, an integration, a closure):
  // its intent is committed before the write, and its receipt only after the write is read back.
  yield* sql`CREATE TABLE factory_operations (
    operation_id TEXT PRIMARY KEY,
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    state TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX factory_operations_item ON factory_operations (factory_id, item_key)`;
  // Finite owner authority for one exact supervised subject, spent in the admission commit.
  yield* sql`CREATE TABLE factory_grants (
    grant_id TEXT PRIMARY KEY,
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    state TEXT NOT NULL,
    remaining INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX factory_grants_item ON factory_grants (factory_id, item_key)`;
});
