import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as ServerConfig from "./config.ts";
import * as FactoryExecutionGenerations from "./factory/FactoryExecutionGenerations.ts";
import * as FactoryLifecycle from "./factory/FactoryLifecycle.ts";
import * as ProjectionStoreV2 from "./orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import { ServerActivation } from "./serverActivation.ts";

/**
 * The factory pieces `server.ts` composes around the runtime: the lifecycle's driver, run with
 * the server, and the execution custody every consumer shares.
 */

it.effect("the factory driver waits for activation, runs with the server and stops with it", () =>
  Effect.gen(function* () {
    const activation = yield* Deferred.make<void>();
    const driving = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      FactoryLifecycle.layerDriver.pipe(
        Layer.provide(
          Layer.mock(FactoryLifecycle.FactoryLifecycle)({
            drive: Deferred.succeed(driving, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
            ),
          }),
        ),
        Layer.provide(Layer.succeed(ServerActivation, Deferred.await(activation))),
      ),
      scope,
    );
    // Built means parked: no factory reconciles before the server activates.
    assert.isFalse(yield* Deferred.isDone(driving));
    yield* Deferred.succeed(activation, undefined);
    yield* Deferred.await(driving);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(yield* Deferred.isDone(stopped));
  }),
);

class RuntimeGenerations extends Context.Service<
  RuntimeGenerations,
  FactoryExecutionGenerations.FactoryExecutionGenerations["Service"]
>()("t3/factoryAccess.integration.test/RuntimeGenerations") {}

it.effect("the server's execution custody is the runtime's one set of containers", () =>
  Effect.gen(function* () {
    const served = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
    // As the runtime's turn starts and claims build it: the same layer value, provided apart.
    const runtime = yield* RuntimeGenerations;
    assert.strictEqual(runtime, served);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        FactoryExecutionGenerations.layerExecutionCustody,
        Layer.effect(
          RuntimeGenerations,
          FactoryExecutionGenerations.FactoryExecutionGenerations,
        ).pipe(Layer.provide(FactoryExecutionGenerations.layer)),
      ).pipe(
        Layer.provide(ProjectionStoreV2.layer),
        Layer.provideMerge(SqlitePersistence.layerMemory),
        // No containment mechanism, so building custody touches nothing on the host.
        Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-factory-access-" })),
        Layer.provide(NodeServices.layer),
      ),
    ),
  ),
);
