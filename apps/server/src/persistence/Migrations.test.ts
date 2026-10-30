import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/sql/Migrator";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import ShellStopRequestIndex from "./Migrations/068_ShellStopRequestIndex.ts";
import ThreadMessageSearch from "./Migrations/069_ThreadMessageSearch.ts";
import PeerLinks from "./Migrations/070_PeerLinks.ts";
import FactoryLifecycle from "./Migrations/070_FactoryLifecycle.ts";
import FactoryExecutionGenerations from "./Migrations/071_FactoryExecutionGenerations.ts";
import PeerLinkFence from "./Migrations/071_PeerLinkFence.ts";
import FactoryOutcomes from "./Migrations/072_FactoryOutcomes.ts";
import WaitingLinkRequestIndex from "./Migrations/072_WaitingLinkRequestIndex.ts";
import FactoryTransfers from "./Migrations/073_FactoryTransfers.ts";

const v2Migrations = migrationManifest.filter(([id]) => id >= 55);
const newerMigrationId = Math.max(...migrationManifest.map(([id]) => id)) + 1;

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

const schema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly type: string;
    readonly name: string;
    readonly tbl_name: string;
    readonly sql: string | null;
  }>`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`;
});

const isFactoryObject = ({ tbl_name }: { readonly tbl_name: string }) =>
  tbl_name.startsWith("factory_") || tbl_name === "command_job_fences";

const inSeparateDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

const migrateAfter67 = (
  migrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>,
) =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 67 });
    yield* Migrator.make({})({ loader: Migrator.fromRecord(migrations) });
  });

// The history patched factory builds wrote, which their databases keep.
const migrateLikePatchedBuild = migrateAfter67({
  "68_PeerLinks": PeerLinks,
  "69_ShellStopRequestIndex": ShellStopRequestIndex,
  "70_FactoryLifecycle": FactoryLifecycle,
  "71_FactoryExecutionGenerations": FactoryExecutionGenerations,
  "72_FactoryOutcomes": FactoryOutcomes,
  "73_FactoryTransfers": FactoryTransfers,
  "74_ThreadMessageSearch": ThreadMessageSearch,
});

const migrateLikeUpstream = migrateAfter67({
  "68_ShellStopRequestIndex": ShellStopRequestIndex,
  "69_ThreadMessageSearch": ThreadMessageSearch,
  "70_PeerLinks": PeerLinks,
  "71_PeerLinkFence": PeerLinkFence,
  "72_WaitingLinkRequestIndex": WaitingLinkRequestIndex,
});

describe("runMigrations", () => {
  it.effect("refuses to start when another migration took a V2 id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'FutureMainMigration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 54 }), []);
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "55_OrchestrationV2 (recorded: FutureMainMigration)");
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when a later id would skip V2 migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'FutureMainMigration')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      for (const [id, name] of v2Migrations) {
        assert.include(String(exit), `${id}_${name} (recorded: nothing)`);
      }
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades a database at exactly 54", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 54 });
      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([30, 54])("still starts with a site-local migration at id %s", (id) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'SiteLocalMigration' WHERE migration_id = ${id}
      `;

      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("only checks V2 migrations within the requested limit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (56, 'SiteLocalMigration'), (${newerMigrationId}, 'NewerV2Migration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 55 }), []);
      const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive: 56 }));
      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        String(exit),
        "56_RemoveRedundantProjectionIndexes (recorded: SiteLocalMigration)",
      );
      assert.notInclude(String(exit), "57_ScheduledTaskWebhooks");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("still starts after a newer build recorded a later V2 migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'NewerV2Migration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades a patched factory database by running only the later migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* migrateLikePatchedBuild;
      yield* sql`
        INSERT INTO factory_configurations
        VALUES ('factory', 1, 'project', '{"policyDigest":"sha256:policy"}', '2026-10-29T00:00:00Z')
      `;
      yield* sql`INSERT INTO factory_grants VALUES ('grant', 'factory', 'issue-1', 'open', 1, '{}')`;
      yield* sql`
        INSERT INTO factory_reserved_decisions VALUES ('decision', 'factory', 'issue-1', 'open', '{}')
      `;
      yield* sql`
        INSERT INTO factory_item_events (factory_id, item_key, record_json)
        VALUES ('factory', 'issue-1', '{"kind":"admitted"}')
      `;
      yield* sql`
        INSERT INTO peer_environment_links
          (environment_id, secret_name, label, urls_json, access, linked_at, expires_at)
        VALUES ('peer', 'peer-secret', 'Peer', '[]', 'standard', '2026-10-29', '2026-11-29')
      `;
      const factoryRows = Effect.all([
        sql`SELECT * FROM factory_configurations`,
        sql`SELECT * FROM factory_grants`,
        sql`SELECT * FROM factory_reserved_decisions`,
        sql`SELECT * FROM factory_item_events`,
      ]);
      const rowsBefore = yield* factoryRows;
      const factorySchemaBefore = (yield* schema).filter(isFactoryObject);

      assert.deepStrictEqual(yield* runMigrations(), [
        [75, "PeerLinkFence"],
        [76, "WaitingLinkRequestIndex"],
        [77, "FactoryPreparedCriteria"],
      ]);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* factoryRows, rowsBefore);
      assert.deepStrictEqual(
        (yield* schema).filter(
          (row) => isFactoryObject(row) && row.tbl_name !== "factory_prepared_criteria",
        ),
        factorySchemaBefore,
      );
      assert.deepStrictEqual(yield* sql`SELECT * FROM factory_prepared_criteria`, []);
      assert.deepStrictEqual(
        yield* sql`SELECT environment_id, fenced FROM peer_environment_links`,
        [{ environment_id: "peer", fenced: 0 }],
      );
      // Patched builds check and run ids up to 74, so they still start on the upgraded database.
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 74 }), []);
      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* factoryRows, rowsBefore);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("gives fresh, upgraded patched and upstream databases the same schema", () =>
    Effect.gen(function* () {
      const fresh = yield* runMigrations().pipe(Effect.andThen(schema), inSeparateDatabase);
      const patched = yield* migrateLikePatchedBuild.pipe(
        Effect.andThen(runMigrations()),
        Effect.andThen(schema),
        inSeparateDatabase,
      );
      const upstream = yield* migrateLikeUpstream.pipe(Effect.andThen(schema), inSeparateDatabase);

      assert.deepStrictEqual(patched, fresh);
      assert.deepStrictEqual(
        upstream,
        fresh.filter((row) => !isFactoryObject(row)),
      );
    }),
  );
});

// Historical patched ledger ids 68-76 keep upstream file prefixes, so only names are compared.
it.effect("registers every migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "Migrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [match[2]] : [];
    });
    assert.deepStrictEqual(files.toSorted(), migrationManifest.map(([, name]) => name).toSorted());
  }).pipe(Effect.provide(NodeServices.layer)),
);
