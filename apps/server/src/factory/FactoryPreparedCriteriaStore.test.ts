import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { FactoryId, FactoryItemKey } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as Prepared from "./FactoryPreparedCriteriaStore.ts";

const reservation = {
  factoryId: FactoryId.make("factory"),
  itemKey: FactoryItemKey.make("github:example/repo#1"),
  issue: 1,
  root: "/criteria",
  path: "/criteria/parent-1.json",
  digest: "a".repeat(64),
  basis: {
    configurationRevision: 1,
    policyRevision: "policy-1",
    itemVersion: "item-1",
    bodySha256: "b".repeat(64),
    proposalOutcomeId: "proposal-1",
  },
  creationId: "creation-1",
  anchorPath: "/criteria/.creation-1.anchor",
} satisfies Prepared.Reservation;
const identity = { device: "1", inode: "2" };
const layer = Prepared.layer.pipe(
  Layer.provideMerge(Layer.fresh(Sqlite.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("reserves the exact preparation once and refuses every changed binding", () =>
  Effect.gen(function* () {
    const store = yield* Prepared.FactoryPreparedCriteriaStore;
    const first = Option.getOrThrow(yield* store.reserve(reservation));
    assert.strictEqual(first.state, "reserved");
    assert.deepStrictEqual(Option.getOrThrow(yield* store.reserve(reservation)), first);
    const changes: ReadonlyArray<Partial<Prepared.Reservation>> = [
      { factoryId: FactoryId.make("other") },
      { itemKey: FactoryItemKey.make("github:example/repo#2") },
      { issue: 2 },
      { root: "/other" },
      { digest: "c".repeat(64) },
      { creationId: "creation-2" },
      { anchorPath: "/criteria/.other.anchor" },
      ...Object.keys(reservation.basis).map((key) => ({
        basis: {
          ...reservation.basis,
          [key]:
            key === "configurationRevision" ? 2 : key === "bodySha256" ? "d".repeat(64) : "changed",
        },
      })),
    ];
    for (const change of changes) {
      assert.isTrue(Option.isNone(yield* store.reserve({ ...reservation, ...change })));
    }
    assert.isTrue(Option.isNone(yield* store.reserve({ ...reservation, path: "/other-target" })));
    assert.deepStrictEqual(Option.getOrThrow(yield* store.get(reservation.path)), first);
    assert.isTrue(
      Option.isNone(
        yield* store.reserve({
          ...reservation,
          creationId: "new",
          anchorPath: "/anchor-new",
          path: reservation.anchorPath,
        }),
      ),
    );
    assert.isTrue(
      Option.isNone(
        yield* store.reserve({
          ...reservation,
          creationId: "new",
          anchorPath: reservation.path,
          path: "/target-new",
        }),
      ),
    );
    assert.isTrue(
      Option.isNone(
        yield* store.reserve({
          ...reservation,
          creationId: "new",
          anchorPath: "/same",
          path: "/same",
        }),
      ),
    );
    const independent = {
      ...reservation,
      itemKey: FactoryItemKey.make("github:example/repo#2"),
      issue: 2,
      creationId: "independent",
      anchorPath: "/criteria/.independent.anchor",
      path: "/criteria/parent-2.json",
    };
    assert.deepStrictEqual(
      Option.getOrThrow(yield* store.reserve(independent)).reservation,
      independent,
    );
    assert.deepStrictEqual(Option.getOrThrow(yield* store.get(reservation.path)), first);
  }).pipe(Effect.provide(layer)),
);

it.effect("retains provenance when the SQLite connection and store are closed and reopened", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const filename = path.join(directory, "state.sqlite");
      const connect = Prepared.layer.pipe(Layer.provideMerge(Sqlite.layerFromPath(filename)));
      const published = yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* Prepared.FactoryPreparedCriteriaStore;
          yield* store.reserve(reservation);
          yield* store.identify({ reservation, identity });
          return Option.getOrThrow(yield* store.publish({ reservation, identity }));
        }).pipe(Effect.provide(Layer.fresh(connect))),
      );
      const reopened = yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* Prepared.FactoryPreparedCriteriaStore;
          assert.deepStrictEqual(Option.getOrThrow(yield* store.reserve(reservation)), published);
          assert.isTrue(
            Option.isNone(
              yield* store.publish({ reservation, identity: { ...identity, inode: "99" } }),
            ),
          );
          return Option.getOrThrow(yield* store.get(reservation.path));
        }).pipe(Effect.provide(Layer.fresh(connect))),
      );
      assert.deepStrictEqual(reopened, published);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "publishes only the recorded creation identity and never regresses a terminal record",
  () =>
    Effect.gen(function* () {
      const store = yield* Prepared.FactoryPreparedCriteriaStore;
      assert.isTrue(Option.isNone(yield* store.identify({ reservation, identity })));
      yield* store.reserve(reservation);
      assert.isTrue(Option.isNone(yield* store.publish({ reservation, identity })));
      for (const unsupported of [
        { device: "", inode: "2" },
        { device: "1", inode: "0" },
        { device: "1", inode: "-1" },
      ]) {
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(store.identify({ reservation, identity: unsupported })),
          ),
        );
      }
      assert.strictEqual(Option.getOrThrow(yield* store.get(reservation.path)).state, "reserved");
      assert.isTrue(
        Option.isNone(
          yield* store.identify({
            reservation: { ...reservation, digest: "d".repeat(64) },
            identity,
          }),
        ),
      );
      const identified = Option.getOrThrow(yield* store.identify({ reservation, identity }));
      assert.strictEqual(identified.state, "identified");
      const wrong = { ...identity, inode: "3" };
      assert.isTrue(Option.isNone(yield* store.identify({ reservation, identity: wrong })));
      assert.isTrue(Option.isNone(yield* store.publish({ reservation, identity: wrong })));
      const published = Option.getOrThrow(yield* store.publish({ reservation, identity }));
      assert.strictEqual(published.state, "published");
      assert.deepStrictEqual(
        Option.getOrThrow(yield* store.publish({ reservation, identity })),
        published,
      );
      assert.deepStrictEqual(
        Option.getOrThrow(yield* store.identify({ reservation, identity })),
        published,
      );
      assert.deepStrictEqual(Option.getOrThrow(yield* store.reserve(reservation)), published);
      const restarted = yield* Effect.gen(function* () {
        return yield* (yield* Prepared.FactoryPreparedCriteriaStore).get(reservation.path);
      }).pipe(Effect.provide(Layer.fresh(Prepared.layer)));
      assert.deepStrictEqual(Option.getOrThrow(restarted), published);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "concurrent reservations and identity amendments retain one creation and one identity",
  () =>
    Effect.gen(function* () {
      const store = yield* Prepared.FactoryPreparedCriteriaStore;
      const requests = [
        reservation,
        { ...reservation, creationId: "second", anchorPath: "/criteria/.second" },
      ];
      const reserved = yield* Effect.forEach(requests, (input) => store.reserve(input), {
        concurrency: "unbounded",
      });
      assert.strictEqual(reserved.filter(Option.isSome).length, 1);
      const winner = Option.getOrThrow(yield* store.get(reservation.path)).reservation;
      const amendments = yield* Effect.forEach(
        [identity, { ...identity, inode: "4" }],
        (input) => store.identify({ reservation: winner, identity: input }),
        { concurrency: "unbounded" },
      );
      assert.strictEqual(amendments.filter(Option.isSome).length, 1);
      const stored = Option.getOrThrow(yield* store.get(reservation.path));
      assert.strictEqual(stored.state, "identified");
      assert.deepStrictEqual(
        stored,
        Option.getOrThrow(amendments.find(Option.isSome) ?? Option.none()),
      );
    }).pipe(Effect.provide(layer)),
);

it.effect("separate SQLite connections cannot reserve the same publication target twice", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const filename = path.join(directory, "concurrent.sqlite");
      const connect = Prepared.layer.pipe(Layer.provideMerge(Sqlite.layerFromPath(filename)));
      yield* Effect.scoped(
        Effect.flatMap(Prepared.FactoryPreparedCriteriaStore, (store) =>
          store.get(reservation.path),
        ).pipe(Effect.provide(Layer.fresh(connect))),
      );
      const attempts = yield* Effect.forEach(
        [
          reservation,
          {
            ...reservation,
            creationId: "other-connection",
            anchorPath: "/criteria/.other-connection",
          },
        ],
        (input) =>
          Effect.scoped(
            Effect.flatMap(Prepared.FactoryPreparedCriteriaStore, (store) =>
              store.reserve(input),
            ).pipe(Effect.provide(Layer.fresh(connect))),
          ),
        { concurrency: "unbounded" },
      );
      assert.strictEqual(attempts.filter(Option.isSome).length, 1);
      const stored = yield* Effect.scoped(
        Effect.flatMap(Prepared.FactoryPreparedCriteriaStore, (store) =>
          store.get(reservation.path),
        ).pipe(Effect.provide(Layer.fresh(connect))),
      );
      assert.deepStrictEqual(stored, attempts.find(Option.isSome));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
