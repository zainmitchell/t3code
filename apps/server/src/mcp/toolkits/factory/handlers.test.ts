import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  FactoryId,
  FactoryItemKey,
  FactoryReservationId,
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

type Caller = "agent" | "owner" | "relay" | "linked";

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
          access: "full-access",
          // A linked environment calling for its own agent passes that agent's limits on.
          ...(caller === "relay"
            ? { narrowedTo: { runtimeMode: "auto" as const, interactionMode: "default" as const } }
            : {}),
          // Another environment's link, whatever access it was approved with.
          ...(caller === "linked" ? { linked: true } : {}),
        },
});

const transferred = { type: "refused", reason: "test" } as const;

type Toolkit = Effect.Success<typeof FactoryToolkit>;

/** The last result a tool call streams. */
const lastResult = <A extends { readonly result: unknown }, E, R>(stream: Stream.Stream<A, E, R>) =>
  Stream.runCollect(stream).pipe(Effect.map((results) => results.at(-1)?.result));

const handle = <E, R>(
  caller: McpInvocationContext.McpInvocationScope,
  call: (toolkit: Toolkit) => Effect.Effect<unknown, E, R>,
  withFactories = true,
) =>
  Effect.gen(function* () {
    const asked: Array<unknown> = [];
    const factories = !withFactories
      ? Layer.empty
      : Layer.mock(FactoryLifecycle.FactoryLifecycle)({
          report: (input) =>
            Effect.sync(() => asked.push(input)).pipe(
              Effect.as({ outcomeId: "outcome-1", state: "reported" as const }),
            ),
          enter: (input) =>
            Effect.sync(() => asked.push(input)).pipe(
              Effect.as({
                itemKey: FactoryItemKey.make("github:acme/alpha#70"),
                status: "active" as const,
                reason: "A native implement stage holds the item under the factory's claim.",
                nextAction: "None.",
              }),
            ),
          resolveReservedDecision: (input) =>
            Effect.sync(() => asked.push(input)).pipe(Effect.as(true)),
          disposeObservedClaim: (input) =>
            Effect.sync(() => asked.push(input)).pipe(Effect.as(true)),
          quarantine: (input) =>
            Effect.sync(() => asked.push(input)).pipe(
              Effect.as({ applied: false, refusals: [], evidenceDigest: "digest" }),
            ),
          historicalTermination: (input) =>
            Effect.sync(() => asked.push(input)).pipe(
              Effect.as({ applied: false, refusals: [], evidenceDigest: "digest" }),
            ),
          rejectOutcome: (input) => Effect.sync(() => asked.push(input)).pipe(Effect.as(true)),
          revokeGrant: (input) => Effect.sync(() => asked.push(input)).pipe(Effect.as(true)),
          transferLegacy: (input) =>
            Effect.sync(() => asked.push(input)).pipe(Effect.as(transferred)),
          rollbackTransfer: (input) =>
            Effect.sync(() => asked.push(input)).pipe(Effect.as(transferred)),
        });
    const result = yield* Effect.flatMap(FactoryToolkit, call).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(FactoryHandlers.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.succeed(McpInvocationContext.McpInvocationContext, caller),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getThreadShell: () => Effect.succeed(liveThreadShell(agentThread)),
              }),
              factories,
            ),
          ),
        ),
      ),
    );
    return { result, asked };
  });

const ownerTools = {
  t3_factory_decide: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_decide", { factoryId, decisionId: "d1", answer: "approve" })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_dispose_claim: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_dispose_claim", {
        factoryId,
        reservationId: FactoryReservationId.make("reservation-1"),
        reason: "writer stopped",
      })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_quarantine: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_quarantine", {
        factoryId,
        reservationId: FactoryReservationId.make("reservation-1"),
        action: "enter",
        reason: "historical execution",
      })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_historical_termination: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_historical_termination", {
        factoryId,
        reservationId: FactoryReservationId.make("reservation-1"),
        action: "capture",
        operationRef: "restart:1",
        reason: "planned full host restart",
      })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_reject_outcome: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_reject_outcome", { factoryId, outcomeId: "o1", reason: "wrong" })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_revoke_grant: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_revoke_grant", { factoryId, grantId: "g1" })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_transfer: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_transfer", {
        factoryId,
        transferId: "transfer-1",
        job: "alpha_supervised",
        items: [{ itemKey: FactoryItemKey.make("github:acme/alpha#69"), workIds: ["w1"] }],
      })
      .pipe(Stream.unwrap, lastResult),
  t3_factory_rollback_transfer: (toolkit: Toolkit) =>
    toolkit
      .handle("t3_factory_rollback_transfer", {
        factoryId,
        transferId: "transfer-1",
        reason: "native work never began",
      })
      .pipe(Stream.unwrap, lastResult),
};

const enter = (toolkit: Toolkit) =>
  toolkit
    .handle("t3_factory_enter", { factoryId, repository: "acme/alpha", issueNumber: 70 })
    .pipe(Stream.unwrap, lastResult);

it.effect("#70: an agent in a chat may enter an issue; a read-only client may not", () =>
  Effect.gen(function* () {
    // Entry asks only what a tracker event would, so the agent itself may ask it.
    const fromChat = yield* handle(scope("agent"), enter);
    expect(fromChat.result).toMatchObject({ status: "active" });
    expect(fromChat.asked).toEqual([{ factoryId, repository: "acme/alpha", issueNumber: 70 }]);
    const owner = scope("owner");
    const readOnly = yield* handle(
      { ...owner, client: { ...owner.client!, access: "read-only" } },
      enter,
    );
    expect(readOnly.result).toMatchObject({ code: "capability_denied" });
    expect(readOnly.asked).toEqual([]);
  }),
);

it.effect("N23: only the owner's own client answers, disposes, rejects, revokes or transfers", () =>
  Effect.gen(function* () {
    for (const [tool, call] of Object.entries(ownerTools)) {
      // An agent thread could answer the gate it waits on; a relay or link passes on another's.
      for (const caller of ["agent", "relay", "linked"] as const) {
        const refused = yield* handle(scope(caller), call);
        expect(refused.result, `${tool} from ${caller}`).toMatchObject({
          code: "capability_denied",
        });
        expect(refused.asked).toEqual([]);
      }
      const answered = yield* handle(scope("owner"), call);
      expect(answered.asked, tool).toMatchObject([{ factoryId, by: "mcp-client:Owner laptop" }]);
    }
  }),
);

it.effect("a report is bound to the calling thread's own execution", () =>
  Effect.gen(function* () {
    const report = (toolkit: Toolkit) =>
      toolkit
        .handle("t3_factory_report", { outcome: "failed", failure: "boom", summary: "failed" })
        .pipe(Stream.unwrap, lastResult);
    const fromStage = yield* handle(scope("agent"), report);
    expect(fromStage.asked).toMatchObject([
      { threadId: agentThread, report: { outcome: "failed" } },
    ]);
    // A client is no stage, so it has nothing to report for.
    const fromOwner = yield* handle(scope("owner"), report);
    expect(fromOwner.result).toMatchObject({ code: "thread_credential_required" });
    expect(fromOwner.asked).toEqual([]);
  }),
);

it.effect("refuses every factory tool where no factory runs", () =>
  Effect.gen(function* () {
    const missing = yield* handle(scope("owner"), ownerTools.t3_factory_decide, false);
    expect(missing.result).toMatchObject({
      code: "orchestration_error",
      message: "This environment runs no factories.",
    });
  }),
);
