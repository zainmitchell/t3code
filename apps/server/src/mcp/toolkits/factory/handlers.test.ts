import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  FactoryId,
  FactoryItemKey,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as FactoryLifecycle from "../../../factory/FactoryLifecycle.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as FactoryHandlers from "./handlers.ts";
import { FactoryToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:factory-owner");
const agentThread = ThreadId.make("thread:factory-agent");
const factoryId = FactoryId.make("alpha");

type Caller = "agent" | "owner" | "relay";

const scope = (caller: Caller): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  requestNamespace: "factory",
  issuedAt: 0,
  capabilities: new Set(["orchestration" as const]),
  thread:
    caller === "agent"
      ? {
          threadId: agentThread,
          providerSessionId: "provider:factory-agent",
          providerInstanceId: ProviderInstanceId.make("codex"),
        }
      : undefined,
  client:
    caller === "agent"
      ? undefined
      : {
          sessionId: "owner",
          label: "Owner laptop",
          access: "auto",
          // A linked environment calling for its own agent passes that agent's limits on.
          ...(caller === "relay"
            ? { narrowedTo: { runtimeMode: "auto" as const, interactionMode: "default" as const } }
            : {}),
        },
});

const call = (caller: Caller, tool: "t3_factory_decide" | "t3_factory_transfer") =>
  Effect.gen(function* () {
    const answers: Array<unknown> = [];
    const result = yield* Effect.gen(function* () {
      const toolkit = yield* FactoryToolkit;
      const results =
        tool === "t3_factory_decide"
          ? yield* toolkit
              .handle("t3_factory_decide", { factoryId, decisionId: "d1", answer: "approve" })
              .pipe(Stream.unwrap, Stream.runCollect)
          : yield* toolkit
              .handle("t3_factory_transfer", {
                factoryId,
                transferId: "transfer-1",
                job: "alpha_supervised",
                items: [{ itemKey: FactoryItemKey.make("github:acme/alpha#69"), workIds: ["w1"] }],
              })
              .pipe(Stream.unwrap, Stream.runCollect);
      return results.at(-1)?.result;
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(FactoryHandlers.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.succeed(McpInvocationContext.McpInvocationContext, scope(caller)),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getThreadShell: () => Effect.succeed(liveThreadShell(agentThread)),
              }),
              Layer.mock(FactoryLifecycle.FactoryLifecycle)({
                resolveReservedDecision: (input) =>
                  Effect.sync(() => answers.push(input)).pipe(Effect.as(true)),
                transferLegacy: (input) =>
                  Effect.sync(() => answers.push(input)).pipe(
                    Effect.as({ type: "refused", reason: "test" } as const),
                  ),
              }),
            ),
          ),
        ),
      ),
    );
    return { result, answers };
  });

it.effect("N23: only the owner's own client answers a factory decision or transfers work", () =>
  Effect.gen(function* () {
    for (const tool of ["t3_factory_decide", "t3_factory_transfer"] as const) {
      // An agent thread could answer the gate it waits on; a relay passes on an agent's call.
      for (const caller of ["agent", "relay"] as const) {
        const refused = yield* call(caller, tool);
        expect(refused.result).toMatchObject({ code: "capability_denied" });
        expect(refused.answers).toEqual([]);
      }
      const answered = yield* call("owner", tool);
      expect(answered.answers).toMatchObject([{ factoryId, by: "mcp-client:Owner laptop" }]);
    }
  }),
);
