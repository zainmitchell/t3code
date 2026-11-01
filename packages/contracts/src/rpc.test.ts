import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { AuthSettingsWriteScope } from "./auth.ts";
import { clientRpcRequiredScopes } from "./clientRpcPermissions.ts";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

describe("WebSocket RPC contracts", () => {
  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("guards the owner's historical termination behind settings:write, with no actor in its payload", () => {
    const method = WsRpcGroup.requests.get(WS_METHODS.factoryHistoricalTermination);
    if (method === undefined) throw new Error("factory.historicalTermination is not registered");
    expect(clientRpcRequiredScopes(WS_METHODS.factoryHistoricalTermination, {})).toEqual([
      AuthSettingsWriteScope,
    ]);
    const decode = Schema.decodeUnknownExit(method.payloadSchema);
    const request = {
      factoryId: "beta-native-pilot-20000101",
      reservationId: "reservation:1",
      action: "capture",
      operationRef: "restart:1",
      reason: "owner read",
    };
    // The actor is the authenticated session's; a payload naming one is decoded without it.
    const forged = decode({ ...request, by: "someone-else" });
    expect(Exit.isSuccess(forged) && "by" in forged.value).toBe(false);
    expect(
      Exit.isSuccess(
        decode({
          ...request,
          acceptResidual: [
            "provider_executor_locality_unrecorded",
            "non_t3_side_effects_unrecordable",
          ],
        }),
      ),
    ).toBe(true);
    expect(Exit.isFailure(decode({ ...request, acceptResidual: ["provenance_proved"] }))).toBe(
      true,
    );
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });
});
