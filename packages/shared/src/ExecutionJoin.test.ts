import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  CurrentExecutionJoin,
  JoinRefused,
  type JoinFor,
  layerContainedSpawner,
} from "./ExecutionJoin.ts";

/** A spawner that records each launch and can fail it; joins record what they were asked. */
const recorded = (options: { readonly spawnFails?: boolean; readonly admitFails?: boolean }) => {
  const log: Array<string> = [];
  const handle = ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(42),
    exitCode: Effect.never,
    isRunning: Effect.succeed(true),
    kill: () => Effect.sync(() => void log.push("kill 42")),
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
  const base = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag === "StandardCommand") {
          log.push(`spawn ${[command.command, ...command.args].join(" ")}`);
        }
        if (options.spawnFails === true) {
          return yield* PlatformError.badArgument({
            module: "ChildProcess",
            method: "spawn",
            description: "fixture spawn fails",
          });
        }
        return handle;
      }),
    ),
  );
  const join: JoinFor = (command, args, role) =>
    Effect.sync(() => {
      log.push(`join ${role ?? "process"} ${command}`);
      return {
        command: "holder-join",
        args: ["--", command, ...args],
        admit: (pid) =>
          options.admitFails === true
            ? Effect.fail(new JoinRefused({ reason: "fixture refuses admission" }))
            : Effect.sync(() => void log.push(`admit ${pid}`)),
        cancel: Effect.sync(() => void log.push("cancel")),
      };
    });
  const spawn = (command: ChildProcess.Command, contained: Option.Option<JoinFor>) =>
    Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
      spawner.spawn(command),
    ).pipe(
      Effect.scoped,
      Effect.provideService(CurrentExecutionJoin, contained),
      Effect.provide(layerContainedSpawner.pipe(Layer.provide(base))),
      Effect.exit,
    );
  return { log, join, spawn };
};

it.effect("Custody/J1: a contained fiber's process starts through its join and is admitted", () =>
  Effect.gen(function* () {
    const fixture = recorded({});
    const started = yield* fixture.spawn(
      ChildProcess.make("git", ["status"]),
      Option.some(fixture.join),
    );
    assert.isTrue(Exit.isSuccess(started));
    assert.deepStrictEqual(fixture.log, [
      "join process git",
      "spawn holder-join -- git status",
      "admit 42",
    ]);

    // Without a container the spawner is unchanged.
    const plain = recorded({});
    assert.isTrue(Exit.isSuccess(yield* plain.spawn(ChildProcess.make("git", []), Option.none())));
    assert.deepStrictEqual(plain.log, ["spawn git"]);
  }),
);

it.effect("Custody/J2: a contained spawn that cannot be placed inside runs nothing outside", () =>
  Effect.gen(function* () {
    // A shell command cannot be joined as one process, so it is refused before any join.
    const shell = recorded({});
    const refused = yield* shell.spawn(
      ChildProcess.make("git status", [], { shell: true }),
      Option.some(shell.join),
    );
    assert.isTrue(Exit.isFailure(refused));
    assert.deepStrictEqual(shell.log, []);

    // A join the container refuses starts nothing.
    const closed = recorded({});
    const noJoin: JoinFor = () => Effect.fail(new JoinRefused({ reason: "closing" }));
    assert.isTrue(
      Exit.isFailure(yield* closed.spawn(ChildProcess.make("git", []), Option.some(noJoin))),
    );
    assert.deepStrictEqual(closed.log, []);

    // A spawn that fails releases its pending join instead of leaving it to count as a member.
    const crashed = recorded({ spawnFails: true });
    assert.isTrue(
      Exit.isFailure(yield* crashed.spawn(ChildProcess.make("git", []), Option.some(crashed.join))),
    );
    assert.deepStrictEqual(crashed.log, ["join process git", "spawn holder-join -- git", "cancel"]);

    // A started join the holder will not admit is stopped before it runs the command.
    const unadmitted = recorded({ admitFails: true });
    assert.isTrue(
      Exit.isFailure(
        yield* unadmitted.spawn(ChildProcess.make("git", []), Option.some(unadmitted.join)),
      ),
    );
    assert.deepStrictEqual(unadmitted.log, [
      "join process git",
      "spawn holder-join -- git",
      "kill 42",
    ]);
  }),
);
