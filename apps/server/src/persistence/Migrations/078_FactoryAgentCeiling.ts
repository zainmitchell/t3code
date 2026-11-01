import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // One row for the environment: the ceiling every factory's admissions share. NULL is none.
  yield* sql`CREATE TABLE factory_environment (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    agent_ceiling INTEGER CHECK (agent_ceiling IS NULL OR agent_ceiling > 0),
    revision INTEGER NOT NULL,
    set_by TEXT NOT NULL,
    set_at TEXT NOT NULL
  )`;
});
