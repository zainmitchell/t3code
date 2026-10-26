import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Who may write for a command job: its own runner, or the native owners that took its work over.
  yield* sql`CREATE TABLE command_job_fences (
    job_name TEXT PRIMARY KEY,
    generation INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`;
  // A legacy writer's work handed to a factory: its original identities and custody, as adopted.
  yield* sql`CREATE TABLE factory_transfers (
    transfer_id TEXT PRIMARY KEY,
    factory_id TEXT NOT NULL,
    job_name TEXT NOT NULL,
    state TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX factory_transfers_factory ON factory_transfers (factory_id, state)`;
});
