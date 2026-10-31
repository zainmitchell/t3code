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
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { Command } from "effect/cli";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { cli } from "../binCli.ts";
import {
  authorizedByReceipt,
  decisionAnswerPlan,
  FactoryCliError,
  hostAdminDestination,
  pendingDecisions,
  refusedHistoricalTermination,
  remoteDestination,
  retirementPlan,
  runAudited,
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
    { factoryId: "typo", outcome: "no_match" },
    { factoryId: "signed-out", outcome: "refused" },
  ] as const;
  assert.deepStrictEqual(unfinishedSwitches(batch, true), [
    "connector: switched (read back differently)",
    "delta: conflict",
    "other: failed",
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
      const run = (use: Effect.Effect<string, FactoryCliError>) =>
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
      assert.deepStrictEqual(
        (yield* auditLines(stateDir)).map((line) => [
          line.operation,
          line.outcome,
          (line.actor as { readonly kind: string }).kind,
        ]),
        [
          ["state", "succeeded", "host-admin-cli"],
          ["state", "failed", "host-admin-cli"],
        ],
      );
      assert.notInclude(yield* auditText(stateDir), SESSION_TOKEN);

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
