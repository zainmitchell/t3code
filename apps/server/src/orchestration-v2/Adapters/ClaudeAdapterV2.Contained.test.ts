import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { FactoryReservationId, ProviderSessionId, RunId, ThreadId } from "@t3tools/contracts";
import { ProviderEventLoggers } from "@t3tools/provider-core/server/ProviderEventLoggers";
import { ExecutionJoin, type JoinContext, JoinRefused } from "@t3tools/shared/ExecutionJoin";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as FactoryExecutionGenerations from "../../factory/FactoryExecutionGenerations.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as PortScanner from "../../preview/PortScanner.ts";
import * as ExecutionContainment from "../../process/custody/ExecutionContainment.ts";
import {
  makeMilestones,
  memberFixture,
  testHelperCache,
  windowsDir,
} from "../../process/custody/testMilestones.ts";
import { ClaudeAgentSdkQueryRunner, layerQueryRunner } from "./ClaudeAdapterV2.ts";

/**
 * The real Claude query runner. The "CLI" is a scripted process (`member.fixture.ts` under node),
 * not Claude Code, and the thread's binding is a test resolver: the factory lookup is covered
 * by the lifecycle suite, which scripts this same join.
 */
const run = {
  runId: RunId.make("run:contained-cli"),
  reservationId: FactoryReservationId.make("reservation:contained-cli"),
  threadId: ThreadId.make("thread:contained-cli"),
};
const sessionId = ProviderSessionId.make(`session:${run.threadId}`);

const layerRunnerWith = <E, R>(join: Layer.Layer<never, E, R>) =>
  layerQueryRunner.pipe(
    Layer.provide(join),
    Layer.provide(PortScanner.layerTest),
    Layer.provide(Layer.succeed(ProviderEventLoggers, { native: undefined, canonical: undefined })),
  );

const openCli = (binary: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(ClaudeAgentSdkQueryRunner, (runner) =>
    runner.open({
      threadId: run.threadId,
      providerSessionId: sessionId,
      runId: run.runId,
      options: {
        sessionId: `native:${run.threadId}`,
        model: "claude-sonnet-4-6",
        tools: [],
        permissionMode: "default",
        pathToClaudeCodeExecutable: binary,
        executableArgs: [...args],
      },
    }),
  );

it.effect("Custody/A10: a contained thread's CLI is never started when its join is refused", () => {
  const asked: Array<{ threadId: string; context: JoinContext | undefined }> = [];
  return Effect.gen(function* () {
    const opened = yield* Effect.exit(Effect.scoped(openCli(process.execPath, [memberFixture])));
    assert.isTrue(Exit.isFailure(opened));
    // The run that opens the query names the container, and the session it serves is recorded.
    assert.deepStrictEqual(asked, [
      { threadId: run.threadId, context: { runId: run.runId, providerSessionId: sessionId } },
    ]);
  }).pipe(
    Effect.provide(
      layerRunnerWith(
        Layer.succeed(ExecutionJoin, {
          forThread: (threadId, context) =>
            Effect.sync(() => asked.push({ threadId, context })).pipe(
              Effect.andThen(new JoinRefused({ threadId, reason: "fixture refuses" })),
            ),
          heldForThread: () => Effect.succeedNone,
        }),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );
});

const layerGenerations = FactoryExecutionGenerations.layer.pipe(
  Layer.provideMerge(ExecutionContainment.layerWindows({ cacheDir: testHelperCache, windowsDir })),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

const layerContainedRunner = layerRunnerWith(
  Layer.effect(
    ExecutionJoin,
    Effect.map(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) => ({
      forThread: (threadId: string, context?: JoinContext) =>
        threadId === run.threadId && context?.runId === run.runId
          ? generations
              .ensureHeld(run)
              .pipe(
                Effect.as(
                  Option.some(
                    generations.joinFor(
                      run.runId,
                      context.providerSessionId === undefined
                        ? undefined
                        : { providerSessionId: context.providerSessionId },
                    ),
                  ),
                ),
                Effect.orDie,
              )
          : Effect.succeedNone,
      heldForThread: () => Effect.succeedNone,
    })),
  ),
).pipe(Layer.provideMerge(layerGenerations));

const factsOf = Effect.flatMap(
  FactoryExecutionGenerations.FactoryExecutionGenerations,
  (generations) => Effect.map(generations.observe([run.runId]), (facts) => facts.get(run.runId)),
);

// Job objects are the Windows mechanism; elsewhere containment is unavailable by design.
describe.runIf(HostProcess.Platform.defaultValue() === "win32")("contained Claude CLI", () => {
  it.live(
    "Custody/A3: the CLI and the child it leaves behind are its run's until they actually end",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const milestones = yield* makeMilestones;
          const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
          const session = yield* openCli(process.execPath, [
            memberFixture,
            String(milestones.port),
            "cli",
            "--spawn",
            "child",
            "--stdin-exit",
          ]);
          yield* milestones.arrived("cli");
          yield* milestones.arrived("child");
          assert.strictEqual((yield* factsOf)?.type, "live");
          // The provider joined as the session's process, which attributes its later turns.
          const [held] = yield* generations.generations(run.runId);
          assert.deepStrictEqual(
            [held?.state, held?.providerJoins, held?.providerSessions],
            ["held", 1, [sessionId]],
          );

          // While the provider runs, its foreground may be done and its child still working: the
          // run is live, and the container cannot be ended.
          assert.isFalse(yield* generations.closeIfQuiet(run.runId));
          assert.strictEqual((yield* factsOf)?.type, "live");

          // Closing the session ends the CLI; everything it started ends with it, so once the
          // CLI has actually exited the container holds nothing and can be ended.
          yield* session.close;
          yield* generations.awaitProviderExits(run.runId);
          yield* milestones.ended("cli");
          yield* milestones.ended("child");
          assert.deepStrictEqual(yield* factsOf, { type: "quiet", providerJoined: true });
          assert.isTrue(yield* generations.closeIfQuiet(run.runId));
          assert.deepStrictEqual(yield* factsOf, { type: "ended", providerJoined: true });
        }),
      ).pipe(Effect.provide(layerContainedRunner)),
  );

  it.live("Custody/A9: a script-entry CLI is refused rather than run outside the container", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* Effect.exit(openCli(memberFixture, []));
        assert.isTrue(Exit.isFailure(opened));
        // Nothing joined, and no join is left pending.
        assert.deepStrictEqual(yield* factsOf, { type: "quiet", providerJoined: false });
      }),
    ).pipe(Effect.provide(layerContainedRunner)),
  );
});
