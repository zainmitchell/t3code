import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE factory_configurations (
    factory_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (factory_id, revision)
  )`;
  yield* sql`CREATE TABLE factory_reservations (
    reservation_id TEXT PRIMARY KEY,
    factory_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    state TEXT NOT NULL,
    decision_key TEXT,
    item_key TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    units INTEGER NOT NULL,
    execution_thread_id TEXT,
    parent_reservation_id TEXT,
    carrier_key TEXT,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE UNIQUE INDEX factory_reservations_decision_idx
    ON factory_reservations(factory_id, decision_key) WHERE origin = 'admitted'`;
  yield* sql`CREATE UNIQUE INDEX factory_reservations_carrier_idx
    ON factory_reservations(factory_id, carrier_key) WHERE origin = 'observed'`;
  yield* sql`CREATE INDEX factory_reservations_pool_idx
    ON factory_reservations(factory_id, pool_id, state)`;
  yield* sql`CREATE INDEX factory_reservations_item_idx
    ON factory_reservations(factory_id, item_key, state)`;
  yield* sql`CREATE TABLE factory_item_observations (
    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    generation INTEGER NOT NULL,
    complete INTEGER NOT NULL,
    basis_digest TEXT NOT NULL,
    record_json TEXT NOT NULL,
    observed_at TEXT NOT NULL
  )`;
  // One immutable observation per collection generation of an item.
  yield* sql`CREATE UNIQUE INDEX factory_item_observations_generation_idx
    ON factory_item_observations(factory_id, item_key, generation)`;
  // A different read of an item under a generation that already holds one. The recorded
  // observation stays immutable; these fence it until a later generation reads the item again.
  yield* sql`CREATE TABLE factory_item_conflicts (
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    generation INTEGER NOT NULL,
    basis_digest TEXT NOT NULL,
    record_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (factory_id, item_key, generation, basis_digest)
  )`;
  yield* sql`CREATE TABLE factory_read_generations (
    factory_id TEXT PRIMARY KEY,
    last_generation INTEGER NOT NULL
  )`;
  yield* sql`CREATE TABLE factory_claim_operations (
    factory_id TEXT NOT NULL,
    carrier_key TEXT NOT NULL,
    reservation_id TEXT NOT NULL REFERENCES factory_reservations(reservation_id),
    PRIMARY KEY (factory_id, carrier_key)
  )`;
  // The factory execution a not-yet-started thread was created for. Not a reservation: its first
  // start is charged through this row like any other descendant.
  yield* sql`CREATE TABLE factory_thread_origins (
    thread_id TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL REFERENCES factory_reservations(reservation_id),
    recorded_at TEXT NOT NULL
  )`;
  // One tracker claim per admitted decision. `launch_json` holds the first message, sent only in
  // the commit that verifies the claim.
  yield* sql`CREATE TABLE factory_claims (
    reservation_id TEXT PRIMARY KEY REFERENCES factory_reservations(reservation_id),
    operation_id TEXT NOT NULL UNIQUE,
    factory_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  // Each POST a claim made or may have made. A row exists before its request leaves.
  yield* sql`CREATE TABLE factory_claim_attempts (
    reservation_id TEXT NOT NULL REFERENCES factory_claims(reservation_id),
    attempt INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    phase TEXT NOT NULL,
    PRIMARY KEY (reservation_id, attempt)
  )`;
  // Collection triggers coalesce here: each trigger asks for a pass and marks its subjects with
  // its sequence; a pass completes only the subjects it read, up to the sequence it read them at.
  // No holder is recorded, so no process ever judges another dead.
  yield* sql`CREATE TABLE factory_collection_requests (
    factory_id TEXT PRIMARY KEY,
    requested INTEGER NOT NULL,
    completed INTEGER NOT NULL,
    deferred_reason TEXT
  )`;
  // A claimed run's workspace work, open from before its first I/O until a settlement proves
  // what it left running; one row per run, bound to the owner that prepared it.
  yield* sql`CREATE TABLE factory_workspace_obligations (
    run_id TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    state TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE factory_collection_subjects (
    factory_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    repository TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    requested INTEGER NOT NULL,
    completed INTEGER NOT NULL,
    PRIMARY KEY (factory_id, item_key)
  )`;
  yield* sql`CREATE TABLE factory_schedule_origins (
    scheduled_task_id TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL REFERENCES factory_reservations(reservation_id)
  )`;
  yield* sql`CREATE TABLE factory_thread_bindings (
    thread_id TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL REFERENCES factory_reservations(reservation_id)
  )`;
});
