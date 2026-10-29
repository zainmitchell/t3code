import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One execution container per row, created once by one host. `state` moves only forward:
  // opened (intent), held (the kernel object exists under its creator), ended (proved gone).
  yield* sql`CREATE TABLE factory_execution_generations (
    generation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    reservation_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    state TEXT NOT NULL,
    record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX factory_execution_generations_run ON factory_execution_generations (run_id)`;
  yield* sql`CREATE INDEX factory_execution_generations_thread
    ON factory_execution_generations (thread_id)`;
});
