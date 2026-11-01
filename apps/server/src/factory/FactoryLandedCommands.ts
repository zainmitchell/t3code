// @effect-diagnostics nodeBuiltinImport:off - pins and receipts are sha256 digests.
import * as NodeCrypto from "node:crypto";

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";

import * as ProcessRunner from "../processRunner.ts";
import { FactoryWakes } from "./FactoryEffects.ts";
import { dependency, redact, renderWait, waitBasis } from "./factoryOperationWait.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

/** The command asks to be run again later, such as while its own build lock is held. */
export const LANDED_RETRY_EXIT = 75;
export const RETRY_AFTER_MILLIS = 60_000;
const RESULT_LIMIT_BYTES = 4_096;

type LandedOperation = FactoryOperationStore.IntendedOperation & {
  readonly intent: Extract<
    FactoryOperationStore.FactoryOperationIntent,
    { readonly kind: "landed_command" }
  >;
};

const isLanded = (
  operation: FactoryOperationStore.IntendedOperation,
): operation is LandedOperation => operation.intent.kind === "landed_command";

/**
 * Unsets the server's Git, T3 and Python variables, which would steer the child. The runner always
 * extends the server's environment, so each is overridden with undefined, which spawn leaves out.
 */
export const landedEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.keys(env)
      .filter((name) => /^(GIT_|T3CODE_|PYTHON)/i.test(name))
      .map((name) => [name, undefined]),
  );

/** The command's last stdout line, kept only when it is one small JSON object. */
export const landedResult = (stdout: string): string | undefined => {
  const last = stdout.trimEnd().split(/\r?\n/).at(-1)?.trim();
  if (last === undefined || last === "" || Buffer.byteLength(last) > RESULT_LIMIT_BYTES) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(last);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? last
      : undefined;
  } catch {
    return undefined;
  }
};

export interface FactoryLandedCommandsShape {
  /**
   * Starts the operation's command unless it already runs here; one not yet due gets a wake at its
   * retry deadline instead. Returns the run it started, if any.
   */
  readonly ensure: (
    operation: FactoryOperationStore.IntendedOperation,
  ) => Effect.Effect<Option.Option<Fiber.Fiber<void>>>;
}

/**
 * Runs after-integration commands in their own fibers, never an effect worker. Exit 75 keeps a
 * deadline on the operation and a scoped wake reruns it then, with no factory pass; startup reoffers
 * every intended one. Shutdown kills a running command's process tree and leaves it intended.
 */
export const FactoryLandedCommands = Context.Reference<FactoryLandedCommandsShape>(
  "t3/factory/FactoryLandedCommands",
  { defaultValue: () => ({ ensure: () => Effect.succeedNone }) },
);

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const operations = yield* FactoryOperationStore.FactoryOperationStore;
  const store = yield* FactoryStore.FactoryStore;
  const wakes = yield* FactoryWakes;
  const scope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const running = new Set<string>();
  const waking = new Set<string>();

  const failed = (reason: string): FactoryOperationStore.FactoryOperationCompletion => ({
    state: "failed",
    reason: `landed_command: ${redact(reason).slice(0, 2_000)}`,
  });

  const warn = (operationId: string) =>
    Effect.catchCause((cause: Cause.Cause<unknown>) =>
      Effect.logWarning("After-integration command stays intended for a later offer", {
        operationId,
        cause: Cause.pretty(cause),
      }),
    );

  /** Offers it again if it is still intended and its factory still runs these commands. */
  const reoffer = Effect.fn("FactoryLandedCommands.reoffer")(function* (
    operationId: string,
  ): Effect.fn.Return<
    void,
    FactoryOperationStore.FactoryOperationStoreError | FactoryStore.FactoryStoreError
  > {
    const current = yield* operations.get(operationId);
    if (Option.isNone(current) || current.value.state !== "intended") return;
    const configuration = yield* store.getConfiguration(current.value.factoryId);
    if (
      Option.isNone(configuration) ||
      !configuration.value.enabled ||
      configuration.value.afterIntegration === undefined
    ) {
      return;
    }
    yield* ensure(current.value);
  });

  /** One wake per operation at its deadline; shutdown cancels it with the scope. */
  const wakeAt = (operationId: string, delayMillis: number) =>
    Effect.suspend(() => {
      if (waking.has(operationId)) return Effect.void;
      waking.add(operationId);
      return Effect.sleep(Duration.millis(Math.max(0, delayMillis))).pipe(
        Effect.andThen(Effect.sync(() => waking.delete(operationId))),
        Effect.andThen(Effect.suspend(() => reoffer(operationId))),
        warn(operationId),
        Effect.ensuring(Effect.sync(() => waking.delete(operationId))),
        Effect.forkIn(scope),
        Effect.asVoid,
      );
    });

  const run = Effect.fn("FactoryLandedCommands.run")(function* (operation: LandedOperation) {
    // A pass may offer one it read before the command ended; only a still intended one runs.
    const current = yield* operations.get(operation.operationId);
    if (Option.isNone(current) || current.value.state !== "intended") return;
    const { command, input } = operation.intent;
    const script = yield* fs.readFile(command.script).pipe(Effect.option);
    let completion: FactoryOperationStore.FactoryOperationCompletion;
    if (Option.isNone(script) || sha256(script.value) !== command.sha256) {
      completion = failed(`${command.script} does not match its pin`);
    } else {
      const output = yield* runner
        .run({
          command: command.executable,
          args: [command.script],
          cwd: path.dirname(command.script),
          stdin: input,
          env: landedEnvironment(process.env),
          timeout: `${command.timeoutSeconds} seconds`,
          timeoutBehavior: "timedOutResult",
          maxOutputBytes: 1024 * 1024,
        })
        .pipe(Effect.result);
      if (Result.isFailure(output)) {
        completion = failed(`the command could not run: ${output.failure._tag}`);
      } else if (output.success.timedOut) {
        completion = failed(`timed out after ${command.timeoutSeconds} seconds`);
      } else if (output.success.code === LANDED_RETRY_EXIT) {
        const due = DateTime.add(yield* DateTime.now, { seconds: RETRY_AFTER_MILLIS / 1_000 });
        const wait = dependency({
          actor: "the project's after-integration command",
          action: "finish what it is busy with (it exited 75)",
          resume: `T3 runs it again at ${DateTime.formatIso(due)}`,
          facts: ["landed_command_retry", operation.operationId],
        });
        const reason = `the command asked to run later: ${output.success.stdout.trim().slice(-300)}`;
        yield* operations.noteWait({
          operationId: operation.operationId,
          wait: {
            kind: wait.kind,
            basis: waitBasis(wait),
            actor: wait.actor,
            action: wait.action,
            resume: wait.resume,
          },
          text: renderWait(reason, wait),
          retryAt: DateTime.formatIso(due),
        });
        yield* wakeAt(operation.operationId, RETRY_AFTER_MILLIS);
        return;
      } else if (output.success.code === 0) {
        const result = landedResult(output.success.stdout);
        completion = {
          state: "applied",
          receipt: {
            kind: "landed_command",
            exitCode: 0,
            stdoutDigest: sha256(output.success.stdout),
            ...(result === undefined ? {} : { result }),
          },
        };
      } else {
        completion = failed(
          `exit ${output.success.code}: ${output.success.stderr.trim().slice(-1_500)}`,
        );
      }
    }
    if (yield* operations.complete({ operationId: operation.operationId, completion })) {
      yield* Queue.offer(wakes, { factoryId: operation.factoryId, trigger: "operation" });
    }
  });

  const ensure = Effect.fn("FactoryLandedCommands.ensure")(function* (
    operation: FactoryOperationStore.IntendedOperation,
  ): Effect.fn.Return<Option.Option<Fiber.Fiber<void>>> {
    const { operationId } = operation;
    if (!isLanded(operation) || running.has(operationId)) return Option.none();
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const due = operation.retryAt === undefined ? now : Date.parse(operation.retryAt);
    if (due > now) {
      yield* wakeAt(operationId, due - now);
      return Option.none();
    }
    running.add(operationId);
    const fiber = yield* run(operation).pipe(
      warn(operationId),
      Effect.ensuring(Effect.sync(() => running.delete(operationId))),
      Effect.forkIn(scope),
    );
    return Option.some(fiber);
  });

  // A restart resumes what the last process left intended, without waiting for a factory pass.
  yield* Effect.gen(function* () {
    for (const configuration of yield* store.listConfigurations()) {
      if (!configuration.enabled || configuration.afterIntegration === undefined) continue;
      for (const operation of yield* operations.listIntended(configuration.factoryId)) {
        yield* ensure(operation);
      }
    }
  }).pipe(warn("startup"), Effect.forkIn(scope));

  return { ensure } satisfies FactoryLandedCommandsShape;
});

export const layer = Layer.effect(FactoryLandedCommands, make);
