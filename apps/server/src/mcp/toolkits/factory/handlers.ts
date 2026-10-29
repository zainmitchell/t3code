import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as FactoryLifecycle from "../../../factory/FactoryLifecycle.ts";
import { factoryStateView, transferView } from "../../../factory/factoryStateView.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { FactoryToolkit } from "./tools.ts";

/**
 * Owner decisions come from the owner's own client. An agent thread, or another environment's
 * link relaying for its agents, could otherwise answer the gate it is waiting on.
 */
const ownerClient = Effect.flatMap(McpInvocationContext.McpInvocationContext, (scope) =>
  scope.thread === undefined &&
  scope.client !== undefined &&
  scope.client.linked !== true &&
  scope.client.narrowedTo === undefined
    ? Effect.succeed(`mcp-client:${scope.client.label}`)
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Only the factory owner answers this, from their own client, not an agent.",
        }),
      ),
);

const noFactories = new OrchestratorMcpFailure({
  code: "orchestration_error",
  message: "This environment runs no factories.",
});

// Optional so a composition without factories, such as a tool-list measurement, builds; its
// factory tools then refuse every call.
export const layer = McpToolAccess.toLayer(
  FactoryToolkit,
  Effect.gen(function* () {
    const provided = yield* Effect.serviceOption(FactoryLifecycle.FactoryLifecycle);
    const lifecycle = Effect.fromOption(provided).pipe(Effect.mapError(() => noFactories));
    return {
      t3_factory_report: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const caller = yield* McpInvocationContext.requireThreadScope(scope, "t3_factory_report");
          return yield* (yield* lifecycle).report({
            threadId: caller.thread.threadId,
            report: input,
          });
        }),
      ),
      // An agent may ask: entry only triggers the collection a tracker event would, and the
      // factory's own readiness, policy and claim still decide whether any work starts.
      t3_factory_enter: McpToolAccess.writesWithCapability((input) =>
        Effect.flatMap(lifecycle, (factories) =>
          factories.enter(input).pipe(Effect.mapError(unavailable)),
        ),
      ),
      t3_factory_state: McpToolAccess.reads((input) =>
        Effect.flatMap(lifecycle, (factories) =>
          factories
            .readState({ factoryId: input.factoryId })
            .pipe(Effect.map(factoryStateView), Effect.mapError(unavailable)),
        ),
      ),
      t3_factory_decide: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const by = yield* ownerClient;
          const resolved = yield* (yield* lifecycle)
            .resolveReservedDecision({ ...input, by })
            .pipe(Effect.mapError(unavailable));
          return { resolved };
        }),
      ),
      t3_factory_dispose_claim: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const by = yield* ownerClient;
          const disposed = yield* (yield* lifecycle)
            .disposeObservedClaim({ ...input, by })
            .pipe(Effect.mapError(unavailable));
          return { disposed };
        }),
      ),
      t3_factory_reject_outcome: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const by = yield* ownerClient;
          const rejected = yield* (yield* lifecycle)
            .rejectOutcome({ ...input, by })
            .pipe(Effect.mapError(unavailable));
          return { rejected };
        }),
      ),
      t3_factory_revoke_grant: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const by = yield* ownerClient;
          const revoked = yield* (yield* lifecycle)
            .revokeGrant({ ...input, by })
            .pipe(Effect.mapError(unavailable));
          return { revoked };
        }),
      ),
      t3_factory_transfer: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const by = yield* ownerClient;
          const result = yield* (yield* lifecycle)
            .transferLegacy({ ...input, by })
            .pipe(Effect.mapError(unavailable));
          return transferView(input.transferId, result);
        }),
      ),
      t3_factory_rollback_transfer: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const by = yield* ownerClient;
          const result = yield* (yield* lifecycle)
            .rollbackTransfer({ ...input, by })
            .pipe(Effect.mapError(unavailable));
          return transferView(input.transferId, result);
        }),
      ),
    } satisfies McpToolAccess.Handlers<typeof FactoryToolkit.tools>;
  }),
);
