import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { FactoryReservationId, ProviderSessionId, RunId, ThreadId } from "@t3tools/contracts";
import { ProviderEventLoggers } from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as FactoryExecutionGenerations from "../../factory/FactoryExecutionGenerations.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ExecutionContainment from "../../process/custody/ExecutionContainment.ts";
import { ExecutionJoin } from "@t3tools/shared/ExecutionJoin";
import {
  makeMilestones,
  memberFixture,
  testHelperCache,
  windowsDir,
} from "../../process/custody/testMilestones.ts";
import { ClaudeAgentSdkQueryRunner, layerQueryRunner } from "./ClaudeAdapterV2.ts";

/**
 * The real Claude query runner, the real Windows containment and real processes. The "CLI" is a
 * scripted process (`member.fixture.ts` under node), not Claude Code, and the thread's binding is
 * a test resolver that holds one run's container: the factory lookup is covered elsewhere.
 */
const run = {
  runId: RunId.make("run:contained-cli"),
  reservationId: FactoryReservationId.make("reservation:contained-cli"),
  threadId: ThreadId.make("thread:contained-cli"),
};

const layerGenerations = FactoryExecutionGenerations.layer.pipe(
  Layer.provideMerge(ExecutionContainment.layerWindows({ cacheDir: testHelperCache, windowsDir })),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

const layerRunner = layerQueryRunner.pipe(
  Layer.provide(
    Layer.effect(
      ExecutionJoin,
      Effect.map(FactoryExecutionGenerations.FactoryExecutionGenerations, (generations) => ({
        forThread: (threadId: string) =>
          threadId === run.threadId
            ? generations
                .ensureHeld(run)
                .pipe(Effect.as(Option.some(generations.joinFor(run.runId))), Effect.orDie)
            : Effect.succeedNone,
        heldForThread: () => Effect.succeedNone,
      })),
    ),
  ),
  Layer.provide(Layer.succeed(ProviderEventLoggers, { native: undefined, canonical: undefined })),
  Layer.provideMerge(layerGenerations),
);

const openCli = (threadId: ThreadId, binary: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(ClaudeAgentSdkQueryRunner, (runner) =>
    runner.open({
      threadId,
      providerSessionId: ProviderSessionId.make(`session:${threadId}`),
      options: {
        sessionId: `native:${threadId}`,
        model: "claude-sonnet-4-6",
        tools: [],
        permissionMode: "default",
        pathToClaudeCodeExecutable: binary,
        executableArgs: [...args],
      },
    }),
  );

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
          const session = yield* openCli(run.threadId, process.execPath, [
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
      ).pipe(Effect.provide(layerRunner)),
  );

  it.live("Custody/A9: a script-entry CLI is refused rather than run outside the container", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* Effect.exit(openCli(run.threadId, memberFixture, []));
        assert.isTrue(Exit.isFailure(opened));
      }),
    ).pipe(Effect.provide(layerRunner)),
  );
});
