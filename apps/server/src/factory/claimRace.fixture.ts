/**
 * One independent native writer for the cross-process race controls. Run as its own process
 * against a shared database file: it prints `ready`, waits for `go` on stdin, makes one native
 * write in its own transaction, prints the outcome as JSON and exits.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  FactoryReservationId,
  type CommandId,
  type NodeId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

type Job =
  | {
      readonly mode: "reserve";
      readonly input: Omit<FactoryStore.ReserveExecutionInput, "origin"> & {
        readonly admission: Omit<
          Extract<
            FactoryStore.ReserveExecutionInput["origin"],
            { readonly type: "admission" }
          >["admission"],
          "deadline"
        > & { readonly deadline: string };
      };
    }
  | { readonly mode: "prepare"; readonly reservationId: string; readonly nonce: string }
  /** Never becomes ready: for the control that cancels a race before its writers connect. */
  | { readonly mode: "hold" }
  /** Misbehaves at the result boundary, for the controls that decode what a child reports. */
  | {
      readonly mode: "fault";
      readonly fault:
        | "exit_before_ready"
        | "missing_result"
        | "malformed_result"
        | "wrong_shape"
        | "nonzero_exit"
        | "foreign_pid";
    };

/** Writes the last line, then exits once it is flushed. */
const finish = (line: string, code: number) => process.stdout.write(line, () => process.exit(code));

const [dbPath, encodedJob] = process.argv.slice(2);
const job = JSON.parse(encodedJob!) as Job;
process.stdout.write("spawned\n");
if (job.mode === "hold") {
  // Stays alive on its open stdin until whoever spawned it stops it.
  process.stdin.resume();
  await new Promise<never>(() => {});
}

if (job.mode === "fault" && job.fault === "exit_before_ready") {
  finish("", 0);
  await new Promise<never>(() => {});
}

const go = new Promise<void>((resolve) => {
  process.stdin.once("data", () => resolve());
});

if (job.mode === "fault") {
  process.stdout.write("ready\n");
  await go;
  if (job.fault === "missing_result") finish("", 0);
  if (job.fault === "malformed_result") finish("{bad\n", 0);
  if (job.fault === "wrong_shape") finish(`${JSON.stringify({ pid: process.pid })}\n`, 0);
  if (job.fault === "nonzero_exit") {
    finish(`${JSON.stringify({ pid: process.pid, outcome: "reserved" })}\n`, 3);
  }
  if (job.fault === "foreign_pid") {
    finish(`${JSON.stringify({ pid: process.pid + 1, outcome: "reserved" })}\n`, 0);
  }
  await new Promise<never>(() => {});
}

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* FactoryStore.FactoryStore;
  const claims = yield* FactoryClaimStore.FactoryClaimStore;
  process.stdout.write("ready\n");
  yield* Effect.promise(() => go);
  const write = Effect.gen(function* () {
    if (job.mode === "hold" || job.mode === "fault") return yield* Effect.die("unreachable");
    if (job.mode === "reserve") {
      const result = yield* store.reserveExecution({
        commandId: job.input.commandId as CommandId,
        executionThreadId: job.input.executionThreadId as ThreadId,
        runId: job.input.runId as RunId,
        taskNodeId: job.input.taskNodeId as NodeId,
        modelSelection: job.input.modelSelection,
        origin: {
          type: "admission",
          admission: {
            ...job.input.admission,
            deadline: DateTime.makeUnsafe(job.input.admission.deadline),
          },
        },
      });
      return result.type === "refused"
        ? ({ outcome: "refused", refusal: result.refusal } as const)
        : ({ outcome: result.type } as const);
    }
    const prepared = yield* claims.prepareAttempt({
      reservationId: FactoryReservationId.make(job.reservationId),
      nonce: job.nonce,
      accountId: "9001",
    });
    return { outcome: prepared.type } as const;
  });
  return yield* sql.withTransaction(write);
}).pipe(
  // The whole cause goes back to the race, which decides whether it was contention.
  Effect.catchCause((cause) => Effect.succeed({ outcome: "failed", cause: Cause.pretty(cause) })),
);

// Whatever happens, the race reads one result line.
const result = await Effect.runPromise(
  program.pipe(
    Effect.provide(
      FactoryClaimStore.layer.pipe(
        Layer.provideMerge(FactoryStore.layer),
        Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath!)),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
).catch((error: unknown) => ({ outcome: "failed", cause: String(error) }));
process.stdout.write(`${JSON.stringify({ pid: process.pid, ...result })}\n`);
process.exit(0);
