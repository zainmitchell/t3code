// @effect-diagnostics nodeBuiltinImport:off - the controls run disposable host processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { FactoryReservationId, RunId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import { makeMilestones, testHelperCache, windowsDir } from "../process/custody/testMilestones.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";

const hostFixture = NodePath.join(import.meta.dirname, "custodyHost.fixture.ts");

/** A fresh database file shared by this test process and its disposable host. */
const freshDatabase = Effect.acquireRelease(
  Effect.sync(() => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-custody-host-"));
    return { directory, dbPath: NodePath.join(directory, "state.sqlite") };
  }),
  ({ directory }) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
);

const generationsOver = (dbPath: string) =>
  FactoryExecutionGenerations.layer.pipe(
    Layer.provideMerge(
      ExecutionContainment.layerWindows({ cacheDir: testHelperCache, windowsDir }),
    ),
    Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provideMerge(NodeServices.layer),
  );

/**
 * Starts a disposable custody host and returns its captured process and output lines. Cleanup is
 * registered before anything waits on it, signals only its own pid, and awaits its exit.
 */
const spawnHost = (dbPath: string, job: Record<string, unknown>) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const lines = yield* Queue.unbounded<string>();
      const exited = yield* Deferred.make<void>();
      const child = NodeChildProcess.spawn(
        process.execPath,
        [hostFixture, dbPath, JSON.stringify(job)],
        { stdio: ["pipe", "pipe", "inherit"], windowsHide: true },
      );
      child.stdin.on("error", () => {});
      let partial = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        partial += chunk;
        for (let index = partial.indexOf("\n"); index >= 0; index = partial.indexOf("\n")) {
          Queue.offerUnsafe(lines, partial.slice(0, index).trim());
          partial = partial.slice(index + 1);
        }
      });
      child.once("close", () => Deferred.doneUnsafe(exited, Effect.void));
      return { child, next: Queue.take(lines), exited: Deferred.await(exited) };
    }),
    ({ child, exited }) =>
      Effect.gen(function* () {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        yield* exited;
      }),
  );

const runFor = (label: string) => ({
  runId: RunId.make(`run:custody-host:${label}:${NodeCrypto.randomUUID()}`),
  reservationId: FactoryReservationId.make(`reservation:custody-host:${label}`),
  threadId: ThreadId.make(`thread:custody-host:${label}`),
});

const observeRun = (runId: RunId) =>
  Effect.flatMap(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) =>
    Effect.map(generations.observe([runId]), (facts) => facts.get(runId)),
  );

const storedStates = (runId: RunId) =>
  Effect.flatMap(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) =>
    Effect.map(generations.generations(runId), (rows) => rows.map((row) => row.state)),
  );

// Job objects are the Windows mechanism; elsewhere containment is unavailable by design.
describe.runIf(HostProcess.Platform.defaultValue() === "win32")("custody host processes", () => {
  it.live("Custody/A4: host loss ends its run's processes, and another host proves it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { dbPath } = yield* freshDatabase;
        const milestones = yield* makeMilestones;
        const run = runFor("loss");
        const observer = yield* Layer.build(generationsOver(dbPath));
        const host = yield* spawnHost(dbPath, { mode: "hold", port: milestones.port, ...run });
        assert.match(yield* host.next, /^held /);
        yield* milestones.arrived("member");
        yield* milestones.arrived("child");
        assert.deepStrictEqual(yield* observeRun(run.runId).pipe(Effect.provide(observer)), {
          type: "unknown",
          reason: "container_unverified",
        });

        // The disposable host itself is lost, by its own captured pid.
        host.child.kill();
        yield* host.exited;
        yield* milestones.ended("member");
        yield* milestones.ended("child");
        assert.deepStrictEqual(yield* observeRun(run.runId).pipe(Effect.provide(observer)), {
          type: "ended",
          providerJoined: true,
        });
        assert.deepStrictEqual(yield* storedStates(run.runId).pipe(Effect.provide(observer)), [
          "ended",
        ]);
      }),
    ),
  );

  it.live("Custody/X1: a creator delayed after intent is fenced before anything joins", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { dbPath } = yield* freshDatabase;
        const milestones = yield* makeMilestones;
        const run = runFor("delayed");
        const observer = yield* Layer.build(generationsOver(dbPath));
        const host = yield* spawnHost(dbPath, { mode: "pause", port: milestones.port, ...run });
        assert.match(yield* host.next, /^intent /);
        // Nothing exists yet: this host proves the intent's container absent and ends it.
        assert.deepStrictEqual(yield* observeRun(run.runId).pipe(Effect.provide(observer)), {
          type: "ended",
          providerJoined: false,
        });
        host.child.stdin.write("go\n");
        assert.strictEqual(yield* host.next, "fenced");
        host.child.stdin.end();
        yield* host.exited;
        assert.isFalse(yield* milestones.hasArrived("member"));
        assert.deepStrictEqual(yield* storedStates(run.runId).pipe(Effect.provide(observer)), [
          "ended",
        ]);
      }),
    ),
  );

  it.live("Custody/A7: a live other host keeps its run unknown until it ends normally", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { dbPath } = yield* freshDatabase;
        const milestones = yield* makeMilestones;
        const run = runFor("other-writer");
        const observer = yield* Layer.build(generationsOver(dbPath));
        const host = yield* spawnHost(dbPath, { mode: "hold", port: milestones.port, ...run });
        assert.match(yield* host.next, /^held /);
        yield* milestones.arrived("child");
        for (const _reconcile of [1, 2, 3]) {
          assert.deepStrictEqual(yield* observeRun(run.runId).pipe(Effect.provide(observer)), {
            type: "unknown",
            reason: "container_unverified",
          });
        }
        // Its own end closes its container, and with it everything it held.
        host.child.stdin.write("exit\n");
        yield* host.exited;
        yield* milestones.ended("child");
        assert.deepStrictEqual(yield* observeRun(run.runId).pipe(Effect.provide(observer)), {
          type: "ended",
          providerJoined: true,
        });
      }),
    ),
  );

  it.live("Custody/X3: an ended generation admits no later join from another host", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { dbPath } = yield* freshDatabase;
        const milestones = yield* makeMilestones;
        const run = runFor("after-end");
        const observer = yield* Layer.build(generationsOver(dbPath));
        const host = yield* spawnHost(dbPath, { mode: "hold", port: milestones.port, ...run });
        assert.match(yield* host.next, /^held /);
        yield* milestones.arrived("child");
        host.child.kill();
        yield* host.exited;
        yield* milestones.ended("child");
        assert.strictEqual(
          (yield* observeRun(run.runId).pipe(Effect.provide(observer)))?.type,
          "ended",
        );
        const joined = yield* Effect.exit(
          Effect.flatMap(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) =>
            generations.joinFor(run.runId)(process.execPath, ["--version"]),
          ).pipe(Effect.provide(observer)),
        );
        assert.isTrue(Exit.isFailure(joined));
      }),
    ),
  );
});
