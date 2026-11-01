import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE factory_prepared_criteria (
    target_path TEXT PRIMARY KEY,
    creation_id TEXT NOT NULL UNIQUE,
    anchor_path TEXT NOT NULL UNIQUE,
    reservation_json TEXT NOT NULL,
    record_json TEXT NOT NULL,
    CHECK (target_path <> anchor_path)
  )`;
});
