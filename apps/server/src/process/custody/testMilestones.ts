// @effect-diagnostics nodeBuiltinImport:off - disposable test processes report over a loopback socket.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

/**
 * Loopback milestones for disposable test processes. A process reports `<role> <pid>` once; its
 * connection then closes only when the OS ends that process (see `member.fixture.ts`).
 */
export interface Milestones {
  readonly port: number;
  readonly arrived: (role: string) => Effect.Effect<number>;
  readonly ended: (role: string) => Effect.Effect<void>;
  /** Whether `role` has reported yet, without waiting. */
  readonly hasArrived: (role: string) => Effect.Effect<boolean>;
}

export const memberFixture = NodePath.join(import.meta.dirname, "member.fixture.ts");

/** Shared across runs so tests compile the helper once per source and compiler. */
export const testHelperCache = NodePath.join(NodeOS.tmpdir(), "t3-custody-test-cache");
export const windowsDir = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";

export const makeMilestones = Effect.gen(function* () {
  const roles = new Map<
    string,
    { readonly arrived: Deferred.Deferred<number>; readonly ended: Deferred.Deferred<void> }
  >();
  const entry = (role: string) => {
    let found = roles.get(role);
    if (found === undefined) {
      found = { arrived: Deferred.makeUnsafe<number>(), ended: Deferred.makeUnsafe<void>() };
      roles.set(role, found);
    }
    return found;
  };
  const server = NodeNet.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.once("data", (line: string) => {
      const [role, pid] = line.trim().split(" ");
      const found = entry(role!);
      socket.once("close", () => Deferred.doneUnsafe(found.ended, Effect.void));
      Deferred.doneUnsafe(found.arrived, Effect.succeed(Number(pid)));
    });
  });
  const port = yield* Effect.acquireRelease(
    Effect.callback<number>((resume) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resume(Effect.succeed(typeof address === "object" && address !== null ? address.port : 0));
      });
    }),
    () => Effect.sync(() => server.close()),
  );
  return {
    port,
    arrived: (role) => Deferred.await(entry(role).arrived),
    ended: (role) => Deferred.await(entry(role).ended),
    hasArrived: (role) => Deferred.isDone(entry(role).arrived),
  } satisfies Milestones;
});

/**
 * Spawns a disposable process this test owns. Its cleanup is registered before anything waits on
 * it, signals only its own captured pid, and awaits its exit.
 */
export const spawnOwned = (command: string, args: ReadonlyArray<string>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const child = NodeChildProcess.spawn(command, [...args], {
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      });
      child.stdin.on("error", () => {});
      const exited = Deferred.makeUnsafe<number | null>();
      child.once("close", (code) => Deferred.doneUnsafe(exited, Effect.succeed(code)));
      child.once("error", () => Deferred.doneUnsafe(exited, Effect.succeed(null)));
      return { child, exited: Deferred.await(exited) };
    }),
    ({ child, exited }) =>
      Effect.gen(function* () {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        yield* exited;
      }),
  );

export type OwnedProcess = Effect.Success<ReturnType<typeof spawnOwned>>;
