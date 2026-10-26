import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as FactoryLifecycle from "../../../factory/FactoryLifecycle.ts";
import { factoryStateView, transferView } from "../../../factory/factoryStateView.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { FactoryToolkit } from "./tools.ts";

/**
 * Owner decisions come from the owner's own client. An agent thread, or a client relaying for an
 * agent in a linked environment, could otherwise answer the gate it is waiting on.
 */
const ownerClient = Effect.flatMap(McpInvocationContext.McpInvocationContext, (scope) =>
  scope.thread === undefined && scope.client !== undefined && scope.client.narrowedTo === undefined
    ? Effect.succeed(`mcp-client:${scope.client.label}`)
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Only the factory owner answers this, from their own client, not an agent.",
        }),
      ),
);

const handlers = {
  t3_factory_report: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const caller = yield* McpInvocationContext.requireThreadScope(scope, "t3_factory_report");
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      return yield* lifecycle.report({ threadId: caller.thread.threadId, report: input });
    }),
  ),
  t3_factory_state: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const state = yield* lifecycle
        .readState({ factoryId: input.factoryId })
        .pipe(Effect.mapError(unavailable));
      return factoryStateView(state);
    }),
  ),
  t3_factory_decide: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const by = yield* ownerClient;
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const resolved = yield* lifecycle
        .resolveReservedDecision({ ...input, by })
        .pipe(Effect.mapError(unavailable));
      return { resolved };
    }),
  ),
  t3_factory_dispose_claim: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const by = yield* ownerClient;
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const disposed = yield* lifecycle
        .disposeObservedClaim({ ...input, by })
        .pipe(Effect.mapError(unavailable));
      return { disposed };
    }),
  ),
  t3_factory_reject_outcome: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const by = yield* ownerClient;
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const rejected = yield* lifecycle
        .rejectOutcome({ ...input, by })
        .pipe(Effect.mapError(unavailable));
      return { rejected };
    }),
  ),
  t3_factory_revoke_grant: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const by = yield* ownerClient;
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const revoked = yield* lifecycle
        .revokeGrant({ ...input, by })
        .pipe(Effect.mapError(unavailable));
      return { revoked };
    }),
  ),
  t3_factory_transfer: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const by = yield* ownerClient;
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const result = yield* lifecycle
        .transferLegacy({ ...input, by })
        .pipe(Effect.mapError(unavailable));
      return transferView(input.transferId, result);
    }),
  ),
  t3_factory_rollback_transfer: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const by = yield* ownerClient;
      const lifecycle = yield* FactoryLifecycle.FactoryLifecycle;
      const result = yield* lifecycle
        .rollbackTransfer({ ...input, by })
        .pipe(Effect.mapError(unavailable));
      return transferView(input.transferId, result);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof FactoryToolkit.tools>;

export const layer = McpToolAccess.toLayer(FactoryToolkit, handlers);
