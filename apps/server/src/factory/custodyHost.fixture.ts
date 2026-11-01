// @effect-diagnostics nodeBuiltinImport:off - a disposable host process for the custody controls.
/**
 * A disposable host owning a run's container: the real generations service and Windows containment
 * over a shared database; prints milestones, reads commands on stdin. `hold` holds a generation,
 * starts a contained member (with a detached child), prints `held <id>`, and waits (`exit` ends it;
 * a kill is the host loss). `pause` prints `intent <id>`, waits for `go`, then `fenced` or `held`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { FactoryReservationId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import { memberFixture, testHelperCache, windowsDir } from "../process/custody/testMilestones.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";

interface Job {
  readonly mode: "hold" | "pause";
  readonly runId: string;
  readonly reservationId: string;
  readonly threadId: string;
  readonly port: number;
}

const [dbPath, encodedJob] = process.argv.slice(2);
const job = JSON.parse(encodedJob!) as Job;
const lines = NodeReadline.createInterface({ input: process.stdin });
const nextLine = () =>
  Effect.callback<string | null>((resume) => {
    const onLine = (line: string) => {
      lines.off("close", onClose);
      resume(Effect.succeed(line.trim()));
    };
    const onClose = () => {
      lines.off("line", onLine);
      resume(Effect.succeed(null));
    };
    lines.once("line", onLine);
    lines.once("close", onClose);
  });
const say = (line: string) => Effect.sync(() => process.stdout.write(`${line}\n`));

const run = {
  runId: RunId.make(job.runId),
  reservationId: FactoryReservationId.make(job.reservationId),
  threadId: ThreadId.make(job.threadId),
};

const startMember = Effect.fn("custodyHost.startMember")(function* (
  generations: FactoryExecutionGenerations.FactoryExecutionGenerations["Service"],
) {
  const ticket = yield* generations.joinFor(run.runId)(
    process.execPath,
    [memberFixture, String(job.port), "member", "--spawn", "child"],
    "provider",
  );
  const child = NodeChildProcess.spawn(ticket.command, [...ticket.args], {
    stdio: "ignore",
    windowsHide: true,
  });
  yield* ticket.admit(child.pid!);
});

const program = Effect.gen(function* () {
  const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
  const sql = yield* SqlClient.SqlClient;
  if (job.mode === "hold") {
    yield* generations.ensureHeld(run);
    const [stored] = yield* generations.generations(run.runId);
    yield* startMember(generations);
    yield* say(`held ${stored!.generationId}`);
  } else {
    const intent = yield* sql.withTransaction(generations.openIntent(run));
    yield* say(`intent ${intent.generationId}`);
    if ((yield* nextLine()) !== "go") return;
    const held = yield* Effect.exit(generations.hold(intent));
    if (Exit.isFailure(held)) {
      yield* say("fenced");
    } else {
      yield* startMember(generations);
      yield* say(`held ${intent.generationId}`);
    }
  }
  for (;;) {
    const line = yield* nextLine();
    if (line === null || line === "exit") return;
  }
});

await Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.provide(
      FactoryExecutionGenerations.layer.pipe(
        Layer.provideMerge(
          ExecutionContainment.layerWindows({ cacheDir: testHelperCache, windowsDir }),
        ),
        Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath!)),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
).catch((error: unknown) => {
  process.stdout.write(`failed ${String(error)}\n`);
});
process.exit(0);
