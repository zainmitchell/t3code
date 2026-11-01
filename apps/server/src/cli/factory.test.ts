// @effect-diagnostics nodeBuiltinImport:off - request files are pinned by their sha256.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  type AuthEnvironmentScope,
  FactoryId,
  ProviderInstanceId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import { Rpc, RpcClient, RpcClientError, RpcGroup, RpcSerialization } from "effect/rpc";
import * as Socket from "effect/socket/Socket";
import * as TestClock from "effect/testing/TestClock";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { cli } from "../binCli.ts";
import {
  authorizedByReceipt,
  decisionAnswerPlan,
  FACTORY_RPC_TRANSPORT,
  FactoryCliError,
  FactoryDeliveryUnknown,
  hostAdminDestination,
  installAtRevision,
  makeClient,
  pendingDecisions,
  refusedHistoricalTermination,
  remoteDestination,
  retirementPlan,
  runAudited,
  switchAuditOutcome,
  switchProviders,
  unfinishedSwitches,
} from "./factory.ts";

// Shaped like the owner's takeover receipt: authorized ids, and evidence entries for each.
const body = (text: string) => text.repeat(64).slice(0, 64);
const receipt = {
  owner_exact_reply: "Authorize takeover",
  hsa_carrier_ids: [101, 102],
  btc_carrier_ids: [201],
  excluded: ["manual hold 999"],
  sources: {
    hsa: {
      evidence: {
        carriers: [
          {
            job: "hsa_supervised",
            work_id: "issue-75-implement-1",
            tracker_comment_id: 101,
            tracker_body_sha256: body("a"),
          },
          {
            job: "hsa_supervised",
            work_id: "issue-75-implement-2",
            tracker_comment_id: 102,
            tracker_body_sha256: body("b"),
          },
          // Evidence for a carrier the owner did not authorize authorizes nothing.
          {
            job: "hsa_supervised",
            work_id: "issue-85-implement-1",
            tracker_comment_id: 103,
            tracker_body_sha256: body("c"),
          },
        ],
      },
    },
    btc: { evidence: { carriers: [{ issue: 30, carrier: 201, body_sha256: body("d") }] } },
  },
};

const observed = (id: number, digest: string, reservationId = `reservation:observed:${id}`) => ({
  reservationId,
  itemKey: "github:acme/hsa#75",
  origin: "observed",
  state: "held",
  carrierKey: `github:acme/hsa#75:comment:${id}:${digest}`,
});

it("Takeover: a receipt retires exactly its carriers and workers, by full key", () => {
  const authorized = authorizedByReceipt(receipt);
  const plan = retirementPlan(
    [
      observed(101, body("a").slice(0, 32)),
      observed(201, body("d").slice(0, 32)),
      // The body changed after the owner saw it: a different carrier, so it stays held.
      observed(102, body("e").slice(0, 32)),
      observed(103, body("c").slice(0, 32)),
      observed(999, body("f").slice(0, 32)),
      {
        reservationId: "reservation:transferred:1",
        itemKey: "github:acme/hsa#75",
        origin: "transferred",
        state: "held",
        job: "hsa_supervised",
        workId: "issue-75-implement-1",
      },
      {
        reservationId: "reservation:transferred:2",
        itemKey: "github:acme/hsa#85",
        origin: "transferred",
        state: "held",
        job: "hsa_supervised",
        workId: "issue-85-implement-1",
      },
      {
        reservationId: "reservation:transferred:3",
        itemKey: "github:acme/hsa#75",
        origin: "transferred",
        state: "held",
        job: "hsa_auto_accept",
        workId: "issue-75-implement-1",
      },
      // Already released: nothing to retire again.
      { ...observed(101, body("a").slice(0, 32), "reservation:observed:old"), state: "released" },
    ],
    authorized,
  );
  assert.deepStrictEqual(
    plan.retire.map((unit) => unit.reservationId),
    ["reservation:observed:101", "reservation:observed:201", "reservation:transferred:1"],
  );
  assert.deepStrictEqual(
    plan.held.map((unit) => [unit.reservationId, unit.reason.split(" ").slice(-3).join(" ")]),
    [
      ["reservation:observed:102", "it was authorized"],
      ["reservation:observed:103", "is not authorized"],
      ["reservation:observed:999", "is not authorized"],
      ["reservation:transferred:2", "is not authorized"],
      ["reservation:transferred:3", "is not authorized"],
    ],
  );
});

// BTC rows carry the transferred tick's worker in its original task's record, with the job as
// that task's prompt, `command-job:<name>`. The manual #30 chain has no command job.
const btcRow = (issue: number, carrier: number, original: object, digest?: string) => ({
  issue,
  carrier,
  author: "owner",
  ...(digest === undefined ? {} : { body_sha256: digest }),
  historical_body_matches: true,
  classification: "unknown",
  original,
  processes: [{ job: { kill_on_close: true, breakaway_ok: false } }],
});
const tick = (workId: string) => ({
  key: "close:25@466b0ea0",
  attempt: 1,
  request: workId,
  native_command_job: "command-job:btc_supervised",
  native_scheduled_task: "scheduled-task:command:btc-native-probe",
  workId,
  native_execution_id: null,
});
const btcReceipt = {
  owner_exact_reply: "Authorize takeover",
  hsa_carrier_ids: [101, 304],
  btc_carrier_ids: [301, 302, 305],
  sources: {
    hsa: { evidence: { carriers: [receipt.sources.hsa.evidence.carriers[0]] } },
    btc: {
      evidence: {
        carriers: [
          {
            ...btcRow(25, 301, tick("btc-tick-1"), body("1")),
            // Work recorded below the row's own original task is not the row's worker.
            subagent: { original: tick("btc-tick-nested") },
          },
          btcRow(
            30,
            302,
            {
              key: "30-app-attention",
              request: "btc-manual-30",
              native_execution_id: null,
              original_and_followup_tasks: [{ taskId: "delegated-task:btc-manual-30" }],
            },
            body("2"),
          ),
          btcRow(25, 303, tick("btc-tick-unlisted"), body("3")),
          // Listed for HSA only: a BTC row cannot authorize it.
          btcRow(25, 304, tick("btc-tick-other-source"), body("4")),
          btcRow(25, 305, tick("btc-tick-no-digest")),
        ],
      },
    },
  },
};

const transferred = (workId: string, job = "btc_supervised") => ({
  reservationId: `reservation:transferred:${job}:${workId}`,
  itemKey: "github:acme/btc#25",
  origin: "transferred",
  state: "held",
  job,
  workId,
});

it("Takeover: a BTC carrier authorizes the worker its own original task names, and only that", () => {
  const plan = retirementPlan(
    [
      observed(101, body("a").slice(0, 32)),
      observed(301, body("1").slice(0, 32)),
      observed(302, body("2").slice(0, 32)),
      observed(303, body("3").slice(0, 32)),
      observed(304, body("4").slice(0, 32)),
      observed(305, body("5").slice(0, 32)),
      transferred("issue-75-implement-1", "hsa_supervised"),
      transferred("btc-tick-1"),
      transferred("btc-tick-1", "btc_auto"),
      transferred("btc-tick-nested"),
      transferred("btc-manual-30"),
      transferred("btc-tick-unlisted"),
      transferred("btc-tick-other-source"),
      transferred("btc-tick-no-digest"),
    ],
    authorizedByReceipt(btcReceipt),
  );
  assert.deepStrictEqual(
    plan.retire.map((unit) => unit.unit.split(":").slice(-2).join(":")),
    [
      "101:" + body("a").slice(0, 32),
      "301:" + body("1").slice(0, 32),
      "302:" + body("2").slice(0, 32),
      "hsa_supervised:issue-75-implement-1",
      "btc_supervised:btc-tick-1",
    ],
  );
  assert.deepStrictEqual(
    plan.held.map((unit) => unit.reservationId.replace(/^reservation:\w+:/, "")),
    [
      "303",
      "304",
      "305",
      "btc_auto:btc-tick-1",
      "btc_supervised:btc-tick-nested",
      "btc_supervised:btc-manual-30",
      "btc_supervised:btc-tick-unlisted",
      "btc_supervised:btc-tick-other-source",
      "btc_supervised:btc-tick-no-digest",
    ],
  );
});

it("Takeover: a receipt that names no carriers authorizes nothing", () => {
  const authorized = authorizedByReceipt({ sources: receipt.sources });
  const plan = retirementPlan([observed(101, body("a").slice(0, 32))], authorized);
  assert.deepStrictEqual([plan.retire.length, plan.held.length], [0, 1]);
});

const btc = FactoryId.make("btc-native-pilot");
const gate = {
  decisionId: "f1258068",
  itemKey: "github:acme/btc#14",
  stage: "correct",
  kind: "gate" as const,
  reason: "#14 needs the owner: review scope",
  state: "pending",
  createdAt: "2026-10-28T00:40:29.969Z",
};
const grantRequest = {
  ...gate,
  decisionId: "g1",
  itemKey: "github:acme/btc#20",
  stage: "implement",
  kind: "grant" as const,
  createdAt: "2026-10-27T10:00:00.000Z",
};
const ticket = {
  ...gate,
  decisionId: "t1",
  itemKey: "github:acme/btc#21",
  stage: "ticket",
  createdAt: "2026-10-27T11:00:00.000Z",
};
const answered = { ...gate, decisionId: "old", state: "resolved", answer: "approve" };
const ask = {
  factoryId: btc,
  decisionId: gate.decisionId,
  itemKey: gate.itemKey,
  stage: "correct",
};

it("Decisions: lists only pending ones, oldest first, with the answers each takes", () => {
  const listed = pendingDecisions([
    { factoryId: "btc", state: { reservedDecisions: [gate, answered, grantRequest] } },
    { factoryId: "hsa", state: { reservedDecisions: [ticket] } },
  ]);
  assert.deepStrictEqual(
    listed.map((entry) => [
      entry.factoryId,
      entry.decisionId,
      entry.itemKey,
      entry.stage,
      entry.answers.map((choice) => choice.answer),
    ]),
    [
      ["btc", "g1", "github:acme/btc#20", "implement", ["approve", "decline"]],
      ["hsa", "t1", "github:acme/btc#21", "ticket", ["approve", "abandon"]],
      ["btc", "f1258068", "github:acme/btc#14", "correct", ["approve", "decline"]],
    ],
  );
  assert.strictEqual(listed[2]!.reason, gate.reason);
});

it("Decide: sends exactly the answer Settings would record", () => {
  assert.deepStrictEqual(decisionAnswerPlan([gate], { ...ask, answer: "approve" }), {
    type: "send",
    input: { factoryId: btc, decisionId: "f1258068", answer: "approve" },
  });
  assert.deepStrictEqual(
    decisionAnswerPlan([gate], { ...ask, answer: "decline", reason: " not yet " }),
    { type: "send", input: { factoryId: btc, decisionId: "f1258068", answer: "decline: not yet" } },
  );
  const grantAsk = { ...ask, decisionId: "g1", itemKey: grantRequest.itemKey, stage: "implement" };
  assert.deepStrictEqual(decisionAnswerPlan([grantRequest], { ...grantAsk, answer: "approve" }), {
    type: "send",
    input: { factoryId: btc, decisionId: "g1", answer: "grant", grantUnits: 1 },
  });
  assert.deepStrictEqual(
    decisionAnswerPlan([grantRequest], { ...grantAsk, answer: "approve", units: 3 }),
    { type: "send", input: { factoryId: btc, decisionId: "g1", answer: "grant", grantUnits: 3 } },
  );
  const ticketAsk = { ...ask, decisionId: "t1", itemKey: ticket.itemKey, stage: "ticket" };
  assert.deepStrictEqual(decisionAnswerPlan([ticket], { ...ticketAsk, answer: "abandon" }), {
    type: "send",
    input: { factoryId: btc, decisionId: "t1", answer: "abandon" },
  });
});

it("Decide: refuses anything but the exact pending decision and an answer it takes", () => {
  const refused = (
    decisions: ReadonlyArray<typeof gate | typeof answered>,
    request: Parameters<typeof decisionAnswerPlan>[1],
  ) => {
    const plan = decisionAnswerPlan(decisions, request);
    return plan.type === "refused" ? plan.reason : `not refused: ${plan.type}`;
  };
  assert.match(
    refused([gate], { ...ask, decisionId: "missing", answer: "approve" }),
    /has no decision missing/,
  );
  // An id copied against the wrong item or stage answers nothing.
  assert.match(
    refused([gate], { ...ask, itemKey: "github:acme/btc#15", answer: "approve" }),
    /is for github:acme\/btc#14 at correct/,
  );
  assert.match(
    refused([gate], { ...ask, stage: "review", answer: "approve" }),
    /not github:acme\/btc#14 at review/,
  );
  assert.match(refused([gate], { ...ask, answer: "abandon" }), /takes approve or decline/);
  assert.match(refused([gate], { ...ask, answer: "yes" }), /is not an answer/);
  assert.match(refused([gate], { ...ask, answer: "approve", units: 2 }), /--units goes only/);
  assert.match(
    refused([gate], { ...ask, answer: "approve", reason: "fine" }),
    /--reason goes only/,
  );
  assert.match(
    refused([{ ...gate, state: "superseded" }], { ...ask, answer: "approve" }),
    /is superseded, not pending/,
  );
});

it("Decide: repeating the recorded answer changes nothing, and a different one is refused", () => {
  const settled = { ...gate, state: "resolved", answer: "approve", answeredBy: "session:owner:1" };
  assert.deepStrictEqual(decisionAnswerPlan([settled], { ...ask, answer: "approve" }), {
    type: "recorded",
    answer: "approve",
    answeredBy: "session:owner:1",
  });
  const plan = decisionAnswerPlan([settled], { ...ask, answer: "decline" });
  assert.deepStrictEqual(plan, {
    type: "refused",
    reason: 'decision f1258068 was already answered "approve" by session:owner:1; nothing changed',
  });
});

it("Decide: grant replay confirms original units, not remaining starts", () => {
  const grantAsk = {
    ...ask,
    decisionId: grantRequest.decisionId,
    itemKey: grantRequest.itemKey,
    stage: grantRequest.stage,
  };
  const decision = { ...grantRequest, state: "resolved", answer: "grant", grantId: "g1" };
  const recorded = {
    grantId: "g1",
    itemKey: grantAsk.itemKey,
    stage: grantAsk.stage,
    units: 1,
    remaining: 0,
    state: "active" as const,
  };
  const changed = decisionAnswerPlan([decision], { ...grantAsk, answer: "approve", units: 3 }, [
    recorded,
  ]);
  assert.strictEqual(changed.type, "refused");
  const same = decisionAnswerPlan([decision], { ...grantAsk, answer: "approve", units: 1 }, [
    recorded,
  ]);
  assert.strictEqual(same.type, "recorded");
  if (same.type === "recorded") {
    assert.deepStrictEqual(same.grant, { grantId: "g1", units: 1, remaining: 0, state: "active" });
  }
  assert.strictEqual(
    decisionAnswerPlan([decision], { ...grantAsk, answer: "approve" }, []).type,
    "refused",
  );
  assert.strictEqual(
    decisionAnswerPlan([decision], { ...grantAsk, answer: "approve" }, [
      { ...recorded, itemKey: "other" },
    ]).type,
    "refused",
  );
});

it("Switching providers: the batch fails unless every named factory ends on the target, read back", () => {
  const verified = { verified: true };
  const batch = [
    { factoryId: "alpha", outcome: "switched", readback: verified },
    { factoryId: "beta", outcome: "already_switched" },
    // Written, but a later install is now current: not proven switched.
    { factoryId: "connector", outcome: "switched", readback: { verified: false } },
    { factoryId: "delta", outcome: "conflict" },
    { factoryId: "other", outcome: "failed" },
    // Its write may have applied: not proven switched either.
    { factoryId: "lost", outcome: "unknown" },
    { factoryId: "typo", outcome: "no_match" },
    { factoryId: "signed-out", outcome: "refused" },
  ] as const;
  assert.deepStrictEqual(unfinishedSwitches(batch, true), [
    "connector: switched (read back differently)",
    "delta: conflict",
    "other: failed",
    "lost: unknown",
    "typo: no_match",
    "signed-out: refused",
  ]);
  // A plan succeeds when every factory would switch or already has.
  assert.deepStrictEqual(
    unfinishedSwitches(
      [
        { factoryId: "alpha", outcome: "planned" },
        { factoryId: "beta", outcome: "already_switched" },
      ],
      false,
    ),
    [],
  );
});

const SESSION_TOKEN = "issued-session-token-never-audited";
// Text a transport or a peer chose: kept in the cause, never shown or audited.
const TRANSPORT_TEXT = "transport-text-never-shown";

/** An EnvironmentAuth that records what the CLI issues and revokes, and nothing else. */
const recordingAuth = () => {
  const issued: Array<ReadonlyArray<AuthEnvironmentScope> | undefined> = [];
  const revoked: Array<string> = [];
  const layer = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
    issueSession: (input) =>
      Effect.sync(() => {
        issued.push(input?.scopes);
        return {
          sessionId: AuthSessionId.make("session:host-admin"),
          token: SESSION_TOKEN,
          method: "bearer-access-token" as const,
          scopes: input?.scopes ?? [],
          subject: input?.subject ?? "",
          client: { deviceType: "bot" as const },
          expiresAt: DateTime.makeUnsafe(0),
        };
      }),
    revokeSession: (sessionId) =>
      Effect.sync(() => {
        revoked.push(sessionId);
        return true;
      }),
  });
  return { issued, revoked, layer };
};

const auditText = (stateDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(path.join(stateDir, "factory-admin-audit.jsonl"));
  });

const auditLines = (stateDir: string) =>
  Effect.map(auditText(stateDir), (text) =>
    text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );

const stateCall = { operation: "state", request: {} };

it.effect(
  "Host admin: one scoped session per call, revoked after success and failure, audited without its token",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const runtimeStatePath = path.join(stateDir, "server-runtime.json");
      yield* fs.writeFileString(
        runtimeStatePath,
        JSON.stringify({
          version: 1,
          pid: 1,
          port: 3773,
          origin: "http://127.0.0.1:3773",
          startedAt: "2026-10-29T00:00:00.000Z",
        }),
      );
      const auth = recordingAuth();
      const connected: Array<readonly [string, string]> = [];
      const run = (use: Effect.Effect<string, FactoryCliError | RpcClientError.RpcClientError>) =>
        runAudited(
          {
            stateDir,
            call: stateCall,
            destination: hostAdminDestination("state", runtimeStatePath),
            connect: (origin, token) =>
              Effect.sync(() => {
                connected.push([origin, token]);
                // The session is still live while the client uses it.
                assert.deepStrictEqual(auth.revoked, []);
              }),
          },
          () => use,
        ).pipe(Effect.provide(auth.layer));

      assert.strictEqual(yield* run(Effect.succeed("read")), "read");
      assert.deepStrictEqual(auth.revoked, ["session:host-admin"]);
      auth.revoked.length = 0;
      const failed = yield* Effect.exit(
        run(Effect.fail(new FactoryCliError({ operation: "state", reason: "refused" }))),
      );
      assert.isTrue(Exit.isFailure(failed));
      assert.deepStrictEqual(auth.revoked, ["session:host-admin"]);

      const scopes = [
        AuthOrchestrationReadScope,
        AuthOrchestrationOperateScope,
        AuthSettingsWriteScope,
      ];
      assert.deepStrictEqual(auth.issued, [scopes, scopes]);
      assert.deepStrictEqual(connected, [
        ["http://127.0.0.1:3773", SESSION_TOKEN],
        ["http://127.0.0.1:3773", SESSION_TOKEN],
      ]);

      // A lost connection no write waited on keeps the transport error as its cause, and none of
      // its text. A ping timeout is named with the bound it exceeded.
      for (const [cause, category] of [
        [new Error(TRANSPORT_TEXT), "the connection was lost: SocketReadError"],
        [
          new Error("ping timeout"),
          "the connection was lost: SocketReadError (ping timeout: no frame from the server for 60 seconds)",
        ],
      ] as const) {
        const lost = new RpcClientError.RpcClientError({
          reason: new Socket.SocketReadError({ cause }),
        });
        auth.revoked.length = 0;
        const dropped = yield* Effect.flip(run(Effect.fail(lost)));
        assert.instanceOf(dropped, FactoryCliError);
        assert.strictEqual(dropped.cause, lost);
        assert.strictEqual(dropped.reason, category);
        assert.notInclude(String(dropped), TRANSPORT_TEXT);
        assert.deepStrictEqual(auth.revoked, ["session:host-admin"]);
      }

      assert.deepStrictEqual(
        (yield* auditLines(stateDir)).map((line) => [
          line.operation,
          line.outcome,
          (line.actor as { readonly kind: string }).kind,
        ]),
        [
          ["state", "succeeded", "host-admin-cli"],
          ["state", "failed", "host-admin-cli"],
          ["state", "failed", "host-admin-cli"],
          ["state", "failed", "host-admin-cli"],
        ],
      );
      assert.notInclude(yield* auditText(stateDir), SESSION_TOKEN);
      assert.notInclude(yield* auditText(stateDir), TRANSPORT_TEXT);

      // A request that applied is not reported as failed when its audit line cannot be written.
      const auditPath = path.join(stateDir, "factory-admin-audit.jsonl");
      yield* fs.remove(auditPath);
      yield* fs.makeDirectory(auditPath);
      auth.revoked.length = 0;
      const unaudited = yield* Effect.flip(run(Effect.succeed("applied")));
      assert.include(
        unaudited.message,
        "factory state: applied, but its audit line was not written",
      );
      // What it returned is still shown, as success would print it.
      assert.isTrue(unaudited.message.endsWith('; its result: "applied"'));
      assert.deepStrictEqual(auth.revoked, ["session:host-admin"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

/**
 * A host as the CLI's own transport meets it: a Pong for each Ping while it is answering, the
 * call's reply once released, or its connection dropped.
 */
const transportHost = Effect.gen(function* () {
  const frames = yield* Queue.unbounded<string | Socket.SocketError>();
  const requested = yield* Queue.unbounded<string>();
  const open = yield* Deferred.make<void>();
  const requests: Array<string> = [];
  let connections = 0;
  let answering = true;
  // Like a WebSocket, nothing is written before the connection is open.
  const receive = (chunk: string | Uint8Array | Socket.CloseEvent) =>
    Effect.andThen(Deferred.await(open), () => {
      if (typeof chunk !== "string") return Effect.void;
      const frame = JSON.parse(chunk) as { readonly _tag: string; readonly id?: string };
      if (frame._tag === "Request") {
        requests.push(frame.id!);
        return Queue.offer(requested, frame.id!);
      }
      return frame._tag === "Ping" && answering
        ? Queue.offer(frames, JSON.stringify({ _tag: "Pong" }))
        : Effect.void;
    });
  const socket = Socket.make({
    reader: Effect.andThen(
      Effect.sync(() => connections++),
      Effect.as(Deferred.succeed(open, undefined), {
        pull: Effect.flatMap(Queue.take(frames), (frame) =>
          typeof frame === "string" ? Effect.succeed([frame] as const) : Effect.fail(frame),
        ),
        upgrade: () => Effect.void,
      }),
    ),
    writer: Effect.succeed({
      write: receive,
      writeAll: (chunks) => Effect.forEach(chunks, receive, { discard: true }),
    }),
  });
  const Configure = Rpc.make("Configure", { success: Schema.String });
  // Built into the caller's scope, as the CLI builds its own connection.
  const context = yield* Layer.build(
    Layer.effect(RpcClient.Protocol, RpcClient.makeProtocolSocket(FACTORY_RPC_TRANSPORT)).pipe(
      Layer.provide(
        Layer.mergeAll(Layer.succeed(Socket.Socket, socket), RpcSerialization.layerJson),
      ),
    ),
  );
  const client = yield* RpcClient.make(RpcGroup.make(Configure)).pipe(Effect.provide(context));
  return {
    call: Effect.gen(function* () {
      const fiber = yield* client.Configure().pipe(Effect.forkScoped({ startImmediately: true }));
      yield* Queue.take(requested);
      return fiber;
    }),
    silent: () => {
      answering = false;
    },
    reply: (requestId: string) =>
      Queue.offer(
        frames,
        JSON.stringify({ _tag: "Exit", requestId, exit: { _tag: "Success", value: "applied" } }),
      ),
    drop: (cause: unknown) =>
      Queue.offer(
        frames,
        new Socket.SocketError({ reason: new Socket.SocketReadError({ cause }) }),
      ),
    sent: () => ({ connections, requests: requests.length }),
    lastRequest: () => requests.at(-1)!,
  };
});

const isRpcClientError = Schema.is(RpcClientError.RpcClientError);

const readCause = (exit: Exit.Exit<string, unknown>) => {
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  if (!isRpcClientError(error)) return String(error ?? "succeeded");
  const cause = "cause" in error.reason ? error.reason.cause : undefined;
  return `${error.reason._tag}: ${cause instanceof Error ? cause.message : String(cause)}`;
};

it.effect(
  "Transport: a valid reply after twelve silent seconds arrives; a minute of silence is lost once, never retried",
  () =>
    Effect.gen(function* () {
      // A busy host: no frame for twelve seconds after the request, then its reply.
      const busy = yield* transportHost;
      busy.silent();
      const waiting = yield* busy.call;
      yield* TestClock.adjust("12 seconds");
      yield* busy.reply(busy.lastRequest());
      assert.strictEqual(readCause(yield* Fiber.await(waiting)), "succeeded");
      assert.deepStrictEqual(busy.sent(), { connections: 1, requests: 1 });

      // A host silent past the bound: its connection is given up, not waited on forever.
      const gone = yield* transportHost;
      gone.silent();
      const abandoned = yield* gone.call;
      yield* TestClock.adjust("65 seconds");
      assert.strictEqual(readCause(yield* Fiber.await(abandoned)), "SocketReadError: ping timeout");
      assert.deepStrictEqual(gone.sent(), { connections: 1, requests: 1 });
    }).pipe(Effect.scoped),
);

it.effect("Transport: a dropped connection fails at once with its own cause, never retried", () =>
  Effect.gen(function* () {
    const dropped = yield* transportHost;
    const cut = yield* dropped.call;
    yield* dropped.drop(new Error("connection reset"));
    assert.strictEqual(readCause(yield* Fiber.await(cut)), "SocketReadError: connection reset");
    assert.deepStrictEqual(dropped.sent(), { connections: 1, requests: 1 });
  }).pipe(Effect.scoped),
);

it.effect("Host admin: with no running server nothing is issued", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
    const auth = recordingAuth();
    const exit = yield* Effect.exit(
      Effect.scoped(hostAdminDestination("state", path.join(stateDir, "missing.json"))).pipe(
        Effect.provide(auth.layer),
      ),
    );
    assert.isTrue(Exit.isFailure(exit));
    assert.deepStrictEqual(auth.issued, []);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "Remote: a session issued on the other host, read from a file, used as is and never audited",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const tokenFile = path.join(stateDir, "token");
      yield* fs.writeFileString(tokenFile, `${SESSION_TOKEN}\n`);
      const connected: Array<readonly [string, string]> = [];
      const result = yield* runAudited(
        {
          stateDir,
          call: stateCall,
          destination: remoteDestination("state", "https://box.example:3773/ignored", tokenFile),
          connect: (origin, token) => Effect.sync(() => connected.push([origin, token])),
        },
        () => Effect.succeed("read"),
      );
      assert.strictEqual(result, "read");
      assert.deepStrictEqual(connected, [["https://box.example:3773", SESSION_TOKEN]]);
      const [line] = yield* auditLines(stateDir);
      assert.deepInclude(line?.actor as object, {
        kind: "remote-session",
        origin: "https://box.example:3773",
      });
      assert.notInclude(yield* auditText(stateDir), SESSION_TOKEN);

      const refusal = (server: string, file: string) =>
        Effect.flip(Effect.scoped(remoteDestination("state", server, file))).pipe(
          Effect.map((error) => error.reason),
        );
      assert.include(yield* refusal("box.example", tokenFile), "not an http(s) origin");
      assert.include(yield* refusal("ftp://box.example", tokenFile), "not an http(s) origin");
      assert.include(
        yield* refusal("https://box.example", path.join(stateDir, "absent")),
        "cannot read",
      );
      yield* fs.writeFileString(tokenFile, "  \n");
      assert.include(yield* refusal("https://box.example", tokenFile), "is empty");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("Remote: --server without --token-file, or the reverse, is refused before any call", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
    for (const args of [
      ["--server", "https://box.example"],
      ["--token-file", "token"],
    ]) {
      const exit = yield* Effect.exit(
        Command.runWith(cli, { version: "0.0.0" })([
          "factory",
          "state",
          "--base-dir",
          baseDir,
          ...args,
        ]),
      );
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      assert.instanceOf(error, FactoryCliError);
      assert.include((error as FactoryCliError).reason, "go together");
    }
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer))),
);

it.effect(
  "Historical termination: a request not exactly as pinned, naming an actor, or inventing a residual is refused before any session",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const request = {
        factoryId: "btc-native-pilot-20261024",
        reservationId: "reservation:1",
        action: "capture",
        operationRef: "restart:1",
        reason: "owner read before the restart",
      };
      const reasonFor = (body: unknown, pin?: string) =>
        Effect.gen(function* () {
          const file = path.join(baseDir, "request.json");
          const text = JSON.stringify(body);
          yield* fs.writeFileString(file, text);
          const exit = yield* Effect.exit(
            Command.runWith(cli, { version: "0.0.0" })([
              "factory",
              "historical-termination",
              file,
              "--expect-sha256",
              pin ?? NodeCrypto.createHash("sha256").update(text).digest("hex"),
              "--base-dir",
              baseDir,
            ]),
          );
          const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
          assert.instanceOf(error, FactoryCliError);
          return (error as FactoryCliError).reason;
        });
      // Other bytes than pinned: refused before anything is read further.
      assert.include(yield* reasonFor(request, "0".repeat(64)), "not the expected");
      // The actor is the session's own; a request naming one is not this request.
      assert.include(
        yield* reasonFor({ ...request, by: "someone-else" }),
        "is not a historical termination request",
      );
      assert.include(
        yield* reasonFor({ ...request, acceptResidual: ["provenance_proved"] }),
        "is not a historical termination request",
      );
      // An exact request goes on to its destination: with no server running, nothing is issued.
      assert.include(yield* reasonFor(request), "no running T3 server");
      assert.include(
        yield* reasonFor({
          ...request,
          acceptResidual: [
            "provider_executor_locality_unrecorded",
            "non_t3_side_effects_unrecordable",
          ],
          expectDigest: "a".repeat(64),
        }),
        "no running T3 server",
      );
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer))),
);

it.effect(
  "Historical termination: a response naming refusals exits failed and is audited as failed; a clean read or record succeeds",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const runtimeStatePath = path.join(stateDir, "server-runtime.json");
      yield* fs.writeFileString(
        runtimeStatePath,
        JSON.stringify({
          version: 1,
          pid: 1,
          port: 3773,
          origin: "http://127.0.0.1:3773",
          startedAt: "2026-10-30T00:00:00.000Z",
        }),
      );
      const auth = recordingAuth();
      const printed: Array<string> = [];
      const testConsole = {
        ...globalThis.console,
        log: (...args: ReadonlyArray<unknown>) => {
          printed.push(args.map(String).join(" "));
        },
      } satisfies Console.Console;
      // Each, as the lifecycle returns it over the RPC.
      const call = (result: {
        readonly applied: boolean;
        readonly refusals: ReadonlyArray<string>;
        readonly evidenceDigest?: string;
      }) =>
        Effect.exit(
          runAudited(
            {
              stateDir,
              call: { operation: "historical-termination-capture-read", request: {} },
              destination: hostAdminDestination("historical-termination", runtimeStatePath),
              connect: () => Effect.void,
            },
            () => refusedHistoricalTermination(result),
          ).pipe(Effect.provide(auth.layer), Effect.provideService(Console.Console, testConsole)),
        );

      const refused = yield* call({ applied: false, refusals: ["unknown_reservation"] });
      assert.isTrue(Exit.isFailure(refused));
      const error = Exit.isFailure(refused) ? Cause.squash(refused.cause) : undefined;
      assert.instanceOf(error, FactoryCliError);
      assert.strictEqual((error as FactoryCliError).reason, "refused: unknown_reservation");
      // Its structured result is still printed, once, for the operator to read.
      assert.deepStrictEqual(printed, ['{"applied":false,"refusals":["unknown_reservation"]}']);

      const read = yield* call({ applied: false, refusals: [], evidenceDigest: "d".repeat(64) });
      const recorded = yield* call({ applied: true, refusals: [], evidenceDigest: "d".repeat(64) });
      assert.isTrue(Exit.isSuccess(read) && Exit.isSuccess(recorded));
      // Success prints nothing here: the command prints the returned result itself.
      assert.strictEqual(printed.length, 1);

      assert.deepStrictEqual(
        (yield* auditLines(stateDir)).map((line) => [line.outcome, line.error ?? line.result]),
        [
          [
            "failed",
            "FactoryCliError: factory historical-termination: refused: unknown_reservation",
          ],
          ["succeeded", { applied: false, refusals: [], evidenceDigest: "d".repeat(64) }],
          ["succeeded", { applied: true, refusals: [], evidenceDigest: "d".repeat(64) }],
        ],
      );
      // Every call's session is revoked, refused or not, and no token is written.
      assert.deepStrictEqual(auth.revoked, [
        "session:host-admin",
        "session:host-admin",
        "session:host-admin",
      ]);
      assert.notInclude(yield* auditText(stateDir), SESSION_TOKEN);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

interface Frame {
  readonly _tag: string;
  readonly id?: string;
  readonly tag?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** The server's end of the CLI's one WebSocket: what the CLI sent, and how the server answers. */
class ServerEnd {
  readyState: number;
  readonly frames: Array<Frame> = [];
  readonly url: string;
  private readonly received: Queue.Queue<void>;
  private readonly listeners = new Map<string, Set<(event: object) => void>>();

  constructor(url: string, received: Queue.Queue<void>, readyState: number) {
    this.url = url;
    this.received = received;
    this.readyState = readyState;
  }

  addEventListener(type: string, listener: (event: object) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }

  removeEventListener(type: string, listener: (event: object) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.frames.push(JSON.parse(data) as Frame);
    Queue.offerUnsafe(this.received, undefined);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { type: "close", code, reason });
  }

  reply(request: Frame, value: unknown) {
    const exit = { _tag: "Success", value };
    this.emit("message", {
      type: "message",
      data: JSON.stringify({ _tag: "Exit", requestId: request.id, exit }),
    });
  }

  /** What Node's WebSocket reports when the connection drops: an empty error event, then 1006. */
  drop() {
    this.emit("error", { type: "error", message: "" });
    this.close(1006);
  }

  requests(tag: string) {
    return this.frames.filter((frame) => frame._tag === "Request" && frame.tag === tag);
  }

  private emit(type: string, event: object) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const FACTORY = FactoryId.make("factory-a");
const overviewAt = (revision: number) => ({
  factories: [
    {
      factoryId: FACTORY,
      state: {
        configured: true,
        configurationRevision: revision,
        pools: [],
        issues: [],
        reservations: [],
        reservedDecisions: [],
        grants: [],
        lastCollection: [],
      },
    },
  ],
});
const INSTALLED = {
  factoryId: FACTORY,
  enabled: false,
  configurationRevision: 8,
  policyRevision: "policy:a",
};

/**
 * Runs `use` through the CLI's own client and audit, against a server end the test drives. The
 * ticket fetch and socket are the only fakes; a socket still connecting can fail to open.
 */
const startAudited = Effect.fn("test.startAudited")(function* <A, E>(
  stateDir: string,
  call: { readonly operation: string; readonly request: unknown },
  use: (client: Effect.Success<ReturnType<typeof makeClient>>) => Effect.Effect<A, E>,
  outcome?: (result: A) => "succeeded" | "unknown",
  readyState = 1,
) {
  const received = yield* Queue.unbounded<void>();
  const opened = yield* Queue.unbounded<ServerEnd>();
  const tickets: Array<readonly [string, string | null]> = [];
  const fetchTicket = (input: string | URL | Request, init?: RequestInit) => {
    tickets.push([String(input), new Headers(init?.headers).get("authorization")]);
    return Promise.resolve(
      Response.json({ ticket: "rpc-ticket", expiresAt: "2026-10-31T09:40:00.000Z" }),
    );
  };
  const fiber = yield* runAudited(
    {
      stateDir,
      call,
      outcome,
      destination: Effect.succeed({
        origin: "http://127.0.0.1:3773",
        token: SESSION_TOKEN,
        actor: { kind: "host-admin-cli" },
      }),
      connect: (origin, token) =>
        makeClient(origin, token).pipe(
          Effect.provideService(Socket.WebSocketConstructor, (url) => {
            const socket = new ServerEnd(url, received, readyState);
            Queue.offerUnsafe(opened, socket);
            return socket as unknown as globalThis.WebSocket;
          }),
        ),
    },
    use,
  ).pipe(
    Effect.provideService(FetchHttpClient.Fetch, fetchTicket as typeof globalThis.fetch),
    Effect.forkChild,
  );
  const socket = yield* Queue.take(opened);
  const request = Effect.fn("test.request")(function* (tag: string, index = 0) {
    for (;;) {
      const sent = socket.requests(tag)[index];
      if (sent !== undefined) return sent;
      yield* Queue.take(received);
    }
  });
  return { fiber, socket, tickets, request };
});

/** `factory install --expect-revision 7`. */
const startInstall = (stateDir: string) =>
  startAudited(
    stateDir,
    { operation: "install", request: { factoryId: FACTORY, expectRevision: 7 } },
    installAtRevision(FACTORY, 7, '{"factoryId":"factory-a","enabled":false}'),
  );

const outcomes = (stateDir: string) =>
  Effect.map(auditLines(stateDir), (lines) => lines.map((line) => line.outcome));

it.effect(
  "Transport: a reply after 12 silent seconds is still the install's reply, over the ticketed socket",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const { fiber, socket, tickets, request } = yield* startInstall(stateDir);
      socket.reply(yield* request(WS_METHODS.factoryOverview), overviewAt(7));
      const configure = yield* request(WS_METHODS.factoryConfigure);
      // The server's own revision check travels with the write.
      assert.strictEqual(configure.payload?.expectRevision, 7);
      // A loaded host delivers nothing, not even pongs, for longer than the protocol's 5 s default.
      yield* TestClock.adjust("12 seconds");
      socket.reply(configure, INSTALLED);

      assert.deepStrictEqual(yield* Fiber.join(fiber), INSTALLED);
      assert.deepStrictEqual(tickets, [
        ["http://127.0.0.1:3773/api/auth/websocket-ticket", `Bearer ${SESSION_TOKEN}`],
      ]);
      const url = new URL(socket.url);
      assert.strictEqual(url.searchParams.get("wsTicket"), "rpc-ticket");
      assert.notInclude(socket.url, SESSION_TOKEN);
      assert.deepStrictEqual(yield* outcomes(stateDir), ["succeeded"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([
  {
    name: "the socket drops",
    lose: (socket: ServerEnd) => Effect.sync(() => socket.drop()),
    cause: "socket error",
  },
  {
    name: "the server stays silent past 60 seconds",
    lose: () => TestClock.adjust("65 seconds"),
    cause: "ping timeout: no frame from the server for 60 seconds",
  },
  {
    name: "the server closes with a reason of its own",
    lose: (socket: ServerEnd) => Effect.sync(() => socket.close(1011, TRANSPORT_TEXT)),
    cause: "SocketCloseError (code 1011)",
  },
])(
  "Transport: when $name after configure was sent, the install is reported as delivery unknown",
  ({ lose, cause }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const { fiber, socket, request } = yield* startInstall(stateDir);
      socket.reply(yield* request(WS_METHODS.factoryOverview), overviewAt(7));
      yield* request(WS_METHODS.factoryConfigure);
      yield* lose(socket);

      const exit = yield* Fiber.await(fiber);
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      assert.instanceOf(error, FactoryDeliveryUnknown);
      assert.include(String(error), cause);
      assert.include(String(error), "read the factory back");
      assert.notInclude(String(error), "nothing installed");
      assert.instanceOf(error.cause, RpcClientError.RpcClientError);
      assert.notInclude(String(error), TRANSPORT_TEXT);
      // Sent once; the CLI never resends a write it cannot confirm.
      assert.lengthOf(socket.requests(WS_METHODS.factoryConfigure), 1);
      assert.deepStrictEqual(yield* outcomes(stateDir), ["unknown"]);
      assert.notInclude(yield* auditText(stateDir), TRANSPORT_TEXT);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("Transport: a stale revision, or a drop before configure, fails with no write sent", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const [answer, reason, keepsTransportError] of [
      [
        (socket: ServerEnd, overview: Frame) => socket.reply(overview, overviewAt(8)),
        "is at revision 8, not 7: nothing installed",
        false,
      ],
      [(socket: ServerEnd) => socket.drop(), "socket error", true],
    ] as const) {
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const { fiber, socket, request } = yield* startInstall(stateDir);
      answer(socket, yield* request(WS_METHODS.factoryOverview));

      const exit = yield* Fiber.await(fiber);
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      assert.instanceOf(error, FactoryCliError);
      assert.include((error as FactoryCliError).reason, reason);
      assert.strictEqual(isRpcClientError((error as FactoryCliError).cause), keepsTransportError);
      assert.lengthOf(socket.requests(WS_METHODS.factoryConfigure), 0);
      assert.deepStrictEqual(yield* outcomes(stateDir), ["failed"]);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const FROM = ProviderInstanceId.make("claude_second");
const TO = ProviderInstanceId.make("claudeAgent");
const switchResult = (factoryId: string, outcome: string, revision: number, switched?: number) => ({
  factoryId,
  outcome,
  revision,
  ...(switched === undefined ? {} : { switchedRevision: switched }),
  from: { instanceId: FROM, displayName: null },
  to: { instanceId: TO, displayName: null },
  changes: [],
  alreadyOnTarget: [],
});
const switchRequest = {
  factoryIds: [FactoryId.make("alpha"), FactoryId.make("beta")],
  from: FROM,
  to: TO,
};

it.effect(
  "Transport: a switch whose reply is lost is unknown, sent once and never read back, reported with the rest",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const started = yield* startAudited(
        stateDir,
        { operation: "switch-provider", request: switchRequest },
        switchProviders({ ...switchRequest, apply: true }),
        switchAuditOutcome,
      );
      const { fiber, socket } = started;
      const sent = (index: number) => started.request(WS_METHODS.factorySwitchProvider, index);
      socket.reply(yield* sent(0), switchResult("alpha", "switched", 3, 4));
      socket.reply(yield* sent(1), switchResult("alpha", "already_switched", 4));
      yield* sent(2);
      socket.drop();

      const report = yield* Fiber.join(fiber);
      const [alpha, beta] = report.factories;
      assert.deepInclude(alpha, {
        outcome: "switched",
        readback: { revision: 4, outcome: "already_switched", verified: true },
      });
      assert.deepInclude(beta, { factoryId: FactoryId.make("beta"), outcome: "unknown" });
      assert.include(JSON.stringify(beta), "read the factory back");
      assert.deepStrictEqual(
        socket
          .requests(WS_METHODS.factorySwitchProvider)
          .map(({ payload }) => [payload?.factoryId, payload?.apply]),
        [
          ["alpha", true],
          ["alpha", false],
          ["beta", true],
        ],
      );
      const lines = yield* auditLines(stateDir);
      assert.deepStrictEqual(
        lines.map((line) => line.outcome),
        ["unknown"],
      );
      assert.deepStrictEqual(lines[0]?.result, JSON.parse(JSON.stringify(report)));
      assert.deepStrictEqual(unfinishedSwitches(report.factories, true), ["beta: unknown"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "Transport: a write whose connection never opened carried no request, so it failed, never unknown",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "factory-cli-" });
      const { fiber, socket } = yield* startAudited(
        stateDir,
        { operation: "switch-provider", request: switchRequest },
        switchProviders({ ...switchRequest, factoryIds: [FactoryId.make("alpha")], apply: true }),
        switchAuditOutcome,
        0,
      );
      socket.drop();

      const report = yield* Fiber.join(fiber);
      assert.deepStrictEqual(report.factories, [
        {
          factoryId: FactoryId.make("alpha"),
          outcome: "failed",
          reason: "the connection was lost: SocketOpenError (socket error)",
        },
      ]);
      assert.lengthOf(socket.frames, 0);
      assert.deepStrictEqual(yield* outcomes(stateDir), ["succeeded"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
