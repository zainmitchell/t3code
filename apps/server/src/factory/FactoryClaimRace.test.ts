// @effect-diagnostics nodeBuiltinImport:off - spawns the disposable writer processes it races.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  FactoryReservationId,
  NodeId,
  PositiveInt,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

const factoryId = FactoryId.make("beta");
const poolId = FactoryPoolId.make("builders");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const fixture = NodePath.join(import.meta.dirname, "claimRace.fixture.ts");

const layerStores = (dbPath: string) =>
  FactoryClaimStore.layer.pipe(
    Layer.provideMerge(FactoryStore.layer),
    Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provideMerge(NodeServices.layer),
  );

/** What a writer reports: one native answer, or the whole failure it caught. */
const RaceResult = Schema.Union([
  Schema.Struct({
    pid: PositiveInt,
    outcome: Schema.Literals(["reserved", "none", "prepared", "busy", "settled"]),
  }),
  Schema.Struct({
    pid: PositiveInt,
    outcome: Schema.Literal("refused"),
    refusal: FactoryStore.FactoryReservationRefusal,
  }),
  Schema.Struct({ pid: PositiveInt, outcome: Schema.Literal("failed"), cause: Schema.String }),
]);
type RaceResult = typeof RaceResult.Type;

const decodeJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const decodeResult = Schema.decodeUnknownExit(RaceResult, { onExcessProperty: "error" });

/** The native answer a result gives, as one comparable value. */
const answerOf = (result: RaceResult) =>
  result.outcome === "refused" ? `refused:${result.refusal}` : result.outcome;

class RaceChildFailed extends Schema.TaggedError<RaceChildFailed>()("RaceChildFailed", {
  reason: Schema.Literals([
    "spawn_failed",
    "exited_before_ready",
    "missing_result",
    "malformed_result",
    "wrong_shape",
    "nonzero_exit",
    "pid_mismatch",
  ]),
  pid: Schema.NullOr(Schema.Number),
  code: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  /** The decode failure or the tail of the child's output, for the reader of a failed run. */
  detail: Schema.String,
}) {}

const isRaceChildFailed = Schema.is(RaceChildFailed);

/**
 * Decides what a closed child reported. Pure, so a malformed report is a failed result rather
 * than an exception in the close callback.
 */
const decodeChildClose = (closed: {
  readonly pid: number | undefined;
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}): Exit.Exit<RaceResult, RaceChildFailed> => {
  const lines = closed.stdout.split("\n").filter((line) => line.length > 0);
  const failed = (reason: RaceChildFailed["reason"], detail: string) =>
    Exit.fail(
      new RaceChildFailed({
        reason,
        pid: closed.pid ?? null,
        code: closed.code,
        signal: closed.signal,
        detail: `${detail}\n${closed.stderr.slice(-600)}`,
      }),
    );
  if (!lines.includes("ready")) return failed("exited_before_ready", closed.stdout.slice(-600));
  if (closed.code !== 0 || closed.signal !== null) {
    return failed("nonzero_exit", closed.stdout.slice(-600));
  }
  const last = lines.at(-1);
  if (last === undefined || last === "ready") return failed("missing_result", "");
  const json = decodeJson(last);
  if (Exit.isFailure(json)) return failed("malformed_result", last);
  const result = decodeResult(json.value);
  if (Exit.isFailure(result)) return failed("wrong_shape", last);
  if (result.value.pid !== closed.pid) return failed("pid_mismatch", last);
  return Exit.succeed(result.value);
};

interface RaceChild {
  readonly child: NodeChildProcess.ChildProcess;
  readonly spawned: Deferred.Deferred<void, RaceChildFailed>;
  readonly ready: Deferred.Deferred<void, RaceChildFailed>;
  readonly result: Deferred.Deferred<RaceResult, RaceChildFailed>;
  /** Resolved by the child's own `close` event, whatever it reported. */
  readonly closed: Deferred.Deferred<void>;
  /** The order the result and the close settled in, as the events delivered them. */
  readonly milestones: ReadonlyArray<string>;
}

/**
 * Spawns one disposable writer and wires its milestones; its cleanup (stop it, then wait for it
 * to close) is registered as soon as it exists, before anything waits on it.
 */
const spawnWriter = (dbPath: string, job: unknown, options: { readonly command?: string } = {}) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const spawned = yield* Deferred.make<void, RaceChildFailed>();
      const ready = yield* Deferred.make<void, RaceChildFailed>();
      const result = yield* Deferred.make<RaceResult, RaceChildFailed>();
      const closed = yield* Deferred.make<void>();
      const child = NodeChildProcess.spawn(
        options.command ?? process.execPath,
        [fixture, dbPath, JSON.stringify(job)],
        {
          cwd: NodePath.join(import.meta.dirname, "..", ".."),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      const milestones: Array<string> = [];
      const settle = (outcome: Exit.Exit<RaceResult, RaceChildFailed>) => {
        const failure = Exit.isFailure(outcome) ? outcome : Exit.void;
        Deferred.doneUnsafe(spawned, failure);
        Deferred.doneUnsafe(ready, failure);
        if (Deferred.doneUnsafe(result, outcome)) {
          const error = Exit.isFailure(outcome) ? Cause.squash(outcome.cause) : undefined;
          milestones.push(isRaceChildFailed(error) ? `result:${error.reason}` : "result");
        }
      };
      // A failed spawn still ends in a `close` event, so it fails the result here and leaves the
      // close to that event.
      child.on("error", (error) => {
        if (child.pid !== undefined) return;
        settle(
          Exit.fail(
            new RaceChildFailed({
              reason: "spawn_failed",
              pid: null,
              code: null,
              signal: null,
              detail: error.message,
            }),
          ),
        );
      });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.includes("spawned\n")) Deferred.doneUnsafe(spawned, Exit.void);
        if (stdout.includes("ready\n")) Deferred.doneUnsafe(ready, Exit.void);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      // `close` follows both stream ends and the exit.
      child.on("close", (code, signal) => {
        settle(decodeChildClose({ pid: child.pid, code, signal, stdout, stderr }));
        milestones.push("closed");
        Deferred.doneUnsafe(closed, Exit.void);
      });
      return { child, spawned, ready, result, closed, milestones } satisfies RaceChild;
    }),
    ({ child, closed }) =>
      Effect.gen(function* () {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        yield* Deferred.await(closed);
      }),
  );

/**
 * Runs each job in its own disposable `node` process against the same database file. The
 * processes connect one at a time, so only the native writes race; once all report `ready` they
 * are released together. Only these captured children are ever signalled.
 */
const raceProcesses = (
  dbPath: string,
  jobs: ReadonlyArray<unknown>,
  onSpawned: (child: RaceChild) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const children: Array<RaceChild> = [];
    for (const job of jobs) {
      const writer = yield* spawnWriter(dbPath, job);
      yield* Deferred.await(writer.spawned);
      yield* onSpawned(writer);
      yield* Deferred.await(writer.ready);
      children.push(writer);
    }
    for (const { child } of children) child.stdin?.write("go\n");
    return yield* Effect.forEach(children, ({ result }) => Deferred.await(result));
  });

/**
 * A losing writer either gets the native answer (refused or busy) or loses SQLite's write lock;
 * any other failure is a defect, not contention.
 */
const assertLost = (result: RaceResult, nativeLosses: ReadonlyArray<string>) => {
  if (nativeLosses.includes(answerOf(result))) return;
  assert.strictEqual(result.outcome, "failed", JSON.stringify(result));
  if (result.outcome !== "failed") return;
  assert.match(result.cause, /SQLITE_BUSY|database is locked/, result.cause);
};

const configureAndObserve = (items: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const configuration = yield* store.configure({
      factoryId,
      projectId: ProjectId.make("project:beta"),
      policyRevision: "policy-r1",
      enabled: true,
      pools: [{ poolId, capacityUnits: 1 }],
      execution: { modelSelection, runtimeMode: "full-access", interactionMode: "default" },
      packet: { briefSchemaVersion: "brief-v1", helper: null },
      artifactRoot: process.cwd(),
    });
    return yield* Effect.forEach(items, (item) =>
      Effect.gen(function* () {
        const recorded = yield* store.recordItemObservation({
          factoryId,
          itemKey: FactoryItemKey.make(item),
          itemVersion: "v1",
          generation: yield* store.beginCollection(factoryId),
          complete: true,
          evidence: [{ carrierId: `${item}:body`, bodyDigest: "digest", version: "1" }],
          sources: [],
          claims: [],
        });
        if (recorded.type !== "recorded") return yield* Effect.die("unrecorded");
        const label = item.replace(/[^a-z0-9]/gi, "-");
        const commandId = `command:race:${label}`;
        return {
          commandId,
          executionThreadId: `thread:race:${label}`,
          runId: `run:race:${label}`,
          taskNodeId: `node:race:${label}`,
          modelSelection,
          admission: {
            factoryId,
            configRevision: configuration.revision,
            decisionKey: FactoryDecisionKey.make(`decision:${label}`),
            itemKey: FactoryItemKey.make(item),
            itemVersion: "v1",
            taskKind: "implement",
            policyRevision: "policy-r1",
            poolId,
            units: 1,
            packetDigest: "packet",
            observationId: recorded.observation.observationId,
            basisDigest: recorded.observation.basisDigest,
            deadline: "2099-01-01T00:00:00.000Z",
          },
        };
      }),
    );
  });

it.live("Claims/N04: two native writers in separate processes race for the final unit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dbPath = NodePath.join(yield* fs.makeTempDirectoryScoped(), "race.sqlite");
      const inputs = yield* Effect.scoped(
        configureAndObserve(["github:beta#6001", "github:beta#6002"]).pipe(
          Effect.provide(layerStores(dbPath)),
        ),
      );
      const results = yield* raceProcesses(
        dbPath,
        inputs.map((input) => ({ mode: "reserve", input })),
      );
      assert.notStrictEqual(results[0]!.pid, results[1]!.pid);
      assert.strictEqual(results.filter((result) => result.outcome === "reserved").length, 1);
      const loserIndex = results.findIndex((result) => result.outcome !== "reserved");
      assertLost(results[loserIndex]!, ["refused:capacity_exhausted"]);
      // Retried once the winner has committed, the loser is refused by native capacity.
      const [retried] = yield* raceProcesses(dbPath, [
        { mode: "reserve", input: inputs[loserIndex] },
      ]);
      assert.strictEqual(answerOf(retried!), "refused:capacity_exhausted", JSON.stringify(retried));
      const held = yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ readonly reservation_id: string }>`
            SELECT reservation_id FROM factory_reservations
            WHERE factory_id = ${factoryId} AND state = 'held'
          `;
        }).pipe(Effect.provide(layerStores(dbPath))),
      );
      assert.strictEqual(held.length, 1);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("Claims/N04: two processes race to prepare one claim's only request", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dbPath = NodePath.join(yield* fs.makeTempDirectoryScoped(), "prepare.sqlite");
      const reservationId = yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const store = yield* FactoryStore.FactoryStore;
          const claims = yield* FactoryClaimStore.FactoryClaimStore;
          const [input] = yield* configureAndObserve(["github:beta#6101"]);
          const reserved = yield* sql.withTransaction(
            store.reserveExecution({
              commandId: CommandId.make(input!.commandId),
              executionThreadId: ThreadId.make(input!.executionThreadId),
              runId: RunId.make(input!.runId),
              taskNodeId: NodeId.make(input!.taskNodeId),
              modelSelection,
              origin: {
                type: "admission",
                admission: {
                  ...input!.admission,
                  deadline: DateTime.makeUnsafe(input!.admission.deadline),
                },
              },
            }),
          );
          assert.strictEqual(reserved.type, "reserved");
          const id = FactoryReservationId.make(`reservation:${input!.commandId}`);
          yield* claims.registerAdmission({
            commandId: CommandId.make(input!.commandId),
            threadId: ThreadId.make(input!.executionThreadId),
            admission: {
              ...input!.admission,
              deadline: DateTime.makeUnsafe(input!.admission.deadline),
            },
            claim: { host: "github.com", repository: "example-org/beta", issueNumber: 6101 },
            launch: {
              messageCommandId: CommandId.make(input!.commandId),
              prompt: "Implement it.",
              modelSelection,
            },
          });
          return id;
        }).pipe(Effect.provide(layerStores(dbPath))),
      );
      const results = yield* raceProcesses(dbPath, [
        { mode: "prepare", reservationId, nonce: "nonce-a" },
        { mode: "prepare", reservationId, nonce: "nonce-b" },
      ]);
      assert.strictEqual(results.filter((result) => result.outcome === "prepared").length, 1);
      assertLost(
        results.find((result) => result.outcome !== "prepared")!,
        ["busy"],
      );
      // Retried after the winner committed, the loser still may not send.
      const [retried] = yield* raceProcesses(dbPath, [
        { mode: "prepare", reservationId, nonce: "nonce-c" },
      ]);
      assert.strictEqual(retried!.outcome, "busy", JSON.stringify(retried));
      const attempts = yield* Effect.scoped(
        Effect.gen(function* () {
          const claims = yield* FactoryClaimStore.FactoryClaimStore;
          const entry = yield* claims.get(reservationId);
          return entry._tag === "Some" ? entry.value.attempts : [];
        }).pipe(Effect.provide(layerStores(dbPath))),
      );
      // One request may be sent; the loser sent nothing and prepared nothing.
      assert.strictEqual(attempts.length, 1);
      assert.strictEqual(attempts[0]!.phase, "prepared");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  "Claims/N04: a race cancelled before a writer is ready stops and waits for that writer",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dbPath = NodePath.join(yield* fs.makeTempDirectoryScoped(), "cancel.sqlite");
        const spawned = yield* Deferred.make<RaceChild>();
        const race = yield* Effect.forkChild(
          Effect.scoped(
            raceProcesses(dbPath, [{ mode: "hold" }], (child) =>
              Deferred.succeed(spawned, child).pipe(Effect.asVoid),
            ),
          ),
        );
        const writer = yield* Deferred.await(spawned);
        assert.strictEqual(writer.child.exitCode, null);
        yield* Fiber.interrupt(race);
        // Cancellation ran the writer's cleanup to completion: it was stopped and has closed.
        assert.isTrue(writer.child.exitCode !== null || writer.child.signalCode !== null);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

// A child's report is decoded at its close: a fault fails the result with its reason, and the
// child is closed either way. These are failure milestones, not contention.

const failureReason = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return "succeeded";
  const error = Cause.squash(exit.cause);
  return isRaceChildFailed(error) ? error.reason : String(error);
};

/** Runs one faulty child through readiness and its result; the scope then stops and closes it. */
const runFaulty = (dbPath: string, fault: string, options: { readonly command?: string } = {}) =>
  Effect.gen(function* () {
    const writer = yield* Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* spawnWriter(dbPath, { mode: "fault", fault }, options);
        const ready = yield* Effect.exit(Deferred.await(writer.ready));
        if (Exit.isSuccess(ready)) writer.child.stdin?.write("go\n");
        const result = yield* Effect.exit(Deferred.await(writer.result));
        return { ready, result, closed: writer.closed, milestones: writer.milestones };
      }),
    );
    return {
      ready: failureReason(writer.ready),
      result: failureReason(writer.result),
      closed: yield* Deferred.isDone(writer.closed),
      milestones: [...writer.milestones],
    };
  });

it.live.each([
  ["exits before it is ready", "exit_before_ready", "exited_before_ready", "exited_before_ready"],
  ["reports nothing", "missing_result", "succeeded", "missing_result"],
  ["reports the wrong shape", "wrong_shape", "succeeded", "wrong_shape"],
  ["exits nonzero after a valid report", "nonzero_exit", "succeeded", "nonzero_exit"],
  ["reports another process's pid", "foreign_pid", "succeeded", "pid_mismatch"],
] as const)(
  "Claims/C1-S02: a child that %s fails its result with that reason and is closed",
  ([, fault, ready, result]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dbPath = NodePath.join(yield* fs.makeTempDirectoryScoped(), "fault.sqlite");
        assert.deepStrictEqual(yield* runFaulty(dbPath, fault), {
          ready,
          result,
          closed: true,
          milestones: [`result:${result}`, "closed"],
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

// Post-implementation: the old close callback threw on a malformed report and left its result
// unresolved (Standards probe), so no hanging red was forced for it. A spawn failure needs the
// command override this harness gained.
it.live("Claims/C1-S02: a malformed report fails the result and the child still closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dbPath = NodePath.join(yield* fs.makeTempDirectoryScoped(), "fault.sqlite");
      assert.deepStrictEqual(yield* runFaulty(dbPath, "malformed_result"), {
        ready: "succeeded",
        result: "malformed_result",
        closed: true,
        milestones: ["result:malformed_result", "closed"],
      });
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

// Node reports a failed spawn as `error`, then still emits `close`: the result fails at the first,
// and the writer counts as closed only at the second.
it.live("Claims/C1-S02: a writer that cannot be spawned fails its result, then closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const dbPath = NodePath.join(directory, "fault.sqlite");
      assert.deepStrictEqual(
        yield* runFaulty(dbPath, "missing_result", {
          command: NodePath.join(directory, "no-such-node"),
        }),
        {
          ready: "spawn_failed",
          result: "spawn_failed",
          closed: true,
          milestones: ["result:spawn_failed", "closed"],
        },
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

// Post-implementation (the fix was written first); its negative control runs this same test
// against the pre-fix harness snapshot. A listener placed ahead of the harness's own records,
// at the moment Node emits `close`, whether the writer already counted as closed.
it.live("Claims/C1-S02: a failed spawn's writer is not closed before Node closes it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const closedBeforeNodeClosed = yield* Deferred.make<boolean>();
      const writer = yield* spawnWriter(
        NodePath.join(directory, "fault.sqlite"),
        { mode: "fault", fault: "missing_result" },
        { command: NodePath.join(directory, "no-such-node") },
      );
      writer.child.prependListener("close", () => {
        Deferred.doneUnsafe(
          closedBeforeNodeClosed,
          Exit.succeed(Deferred.isDoneUnsafe(writer.closed)),
        );
      });
      assert.strictEqual(
        failureReason(yield* Effect.exit(Deferred.await(writer.result))),
        "spawn_failed",
      );
      assert.isFalse(yield* Deferred.await(closedBeforeNodeClosed));
      yield* Deferred.await(writer.closed);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
