import { assert, it } from "@effect/vitest";
import { CodexSettings, ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { ProviderEventLoggers } from "@t3tools/provider-core/server/ProviderEventLoggers";
import { ExecutionJoin, type JoinRole } from "@t3tools/shared/ExecutionJoin";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

import { CodexAppServerClientFactory, layerAppServerClientFactory } from "./CodexAdapterV2.ts";

/**
 * Where the Codex app server starts. The join and the spawner record what they were asked and the
 * spawn then fails, so nothing runs; the real container is exercised for the Claude CLI and by
 * the actual-process evidence for Codex.
 */
const contained = ThreadId.make("thread:contained-review");
const binary = "C:\\fixture\\codex\\codex.exe";
const defaultCodexSettings = Schema.decodeSync(CodexSettings)({});

const recorded = () => {
  const joins: Array<{ command: string; args: ReadonlyArray<string>; role: JoinRole | undefined }> =
    [];
  const spawned: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const cancels: Array<string> = [];
  const layer = layerAppServerClientFactory.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ExecutionJoin, {
          forThread: (threadId) =>
            Effect.succeed(
              threadId === contained
                ? Option.some((command: string, args: ReadonlyArray<string>, role?: JoinRole) =>
                    Effect.sync(() => {
                      joins.push({ command, args, role });
                      return {
                        command: "t3-custody",
                        args: ["join", "generation", "--", command, ...args],
                        admit: () => Effect.void,
                        cancel: Effect.sync(() => void cancels.push(threadId)),
                      };
                    }),
                  )
                : Option.none(),
            ),
          heldForThread: () => Effect.succeedNone,
        }),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) =>
            Effect.sync(() => {
              if (command._tag === "StandardCommand") {
                spawned.push({ command: command.command, args: command.args });
              }
            }).pipe(
              Effect.andThen(
                PlatformError.badArgument({
                  module: "ChildProcessSpawner",
                  method: "spawn",
                  description: "The fixture stops after recording the launch",
                }),
              ),
            ),
          ),
        ),
        Layer.succeed(ProviderEventLoggers, { native: undefined, canonical: undefined }),
      ),
    ),
  );
  return { joins, spawned, cancels, layer };
};

const open = (threadId: ThreadId, exclusive: boolean) =>
  Effect.flatMap(CodexAppServerClientFactory, (factory) =>
    factory.open({
      instanceId: ProviderInstanceId.make("codex_cli"),
      threadId,
      providerSessionId: ProviderSessionId.make(`session:${threadId}:${exclusive}`),
      exclusive,
      runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: null },
      settings: { ...defaultCodexSettings, binaryPath: binary },
      environment: {},
    }),
  ).pipe(Effect.scoped, Effect.exit);

it.effect("N26/N27: a contained thread's own Codex session starts inside its container", () =>
  Effect.gen(function* () {
    const fixture = recorded();
    const opened = yield* open(contained, true).pipe(Effect.provide(fixture.layer));
    assert.isTrue(Exit.isFailure(opened));
    // The app server itself is the provider process the run's container admits.
    assert.deepStrictEqual(fixture.joins, [
      { command: binary, args: ["app-server"], role: "provider" },
    ]);
    assert.deepStrictEqual(fixture.spawned, [
      { command: "t3-custody", args: ["join", "generation", "--", binary, "app-server"] },
    ]);
    // A join that never started is released rather than left pending.
    assert.deepStrictEqual(fixture.cancels, [contained]);
  }),
);

it.effect("N26/N27: a shared Codex session, or an uncontained thread, never joins one", () =>
  Effect.gen(function* () {
    // A shared session carries every thread's work on its instance, so it never enters one
    // execution's container, even when a contained thread opens it.
    const shared = recorded();
    yield* open(contained, false).pipe(Effect.provide(shared.layer));
    assert.deepStrictEqual(shared.joins, []);
    assert.deepStrictEqual(shared.spawned, [{ command: binary, args: ["app-server"] }]);

    const plain = recorded();
    yield* open(ThreadId.make("thread:plain"), true).pipe(Effect.provide(plain.layer));
    assert.deepStrictEqual(plain.joins, []);
    assert.deepStrictEqual(plain.spawned, [{ command: binary, args: ["app-server"] }]);
  }),
);
