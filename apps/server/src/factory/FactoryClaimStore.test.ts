import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  FactoryClaimCarrierKey,
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  FactoryReservationId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  NodeId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

const factoryId = FactoryId.make("beta");
const poolId = FactoryPoolId.make("builders");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const reservationId = FactoryReservationId.make("reservation:command:claim");

const layerTest = FactoryClaimStore.layer.pipe(
  Layer.provideMerge(FactoryStore.layer),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

// The store decodes its rows totally; the raw-row control below shows it does.
const total = { onExcessProperty: "error" } as const;
const decodeAttempt = Schema.decodeUnknownExit(FactoryClaimStore.FactoryClaimAttempt, total);
const decodeClaim = Schema.decodeUnknownExit(FactoryClaimStore.FactoryClaimRecord, total);

const attemptBase = { reservationId, attempt: 1, nonce: "nonce", accountId: "9001" };

it("Claims/C1-S01: an attempt cannot be represented without the receipt its phase requires", () => {
  assert.isTrue(
    Exit.isFailure(decodeAttempt({ ...attemptBase, phase: "written", commentId: null })),
  );
  assert.isTrue(
    Exit.isFailure(decodeAttempt({ ...attemptBase, phase: "verified", commentId: null })),
  );
  assert.isTrue(
    Exit.isFailure(decodeAttempt({ ...attemptBase, phase: "verified", commentId: 7 })),
    "a verified attempt names the digest of the comment it verified",
  );
  assert.isTrue(Exit.isFailure(decodeAttempt({ ...attemptBase, phase: "prepared", commentId: 7 })));
});

const claimBase = {
  reservationId,
  operationId: `factory-claim:${reservationId}`,
  factoryId,
  itemKey: "github:example-org/beta#1",
  threadId: "thread:claim",
  target: { host: "github.com", repository: "example-org/beta", issueNumber: 1 },
  launch: { messageCommandId: "command:claim", prompt: "Implement it.", modelSelection },
  admitted: {
    observationId: 1,
    generation: 1,
    basisDigest: "basis",
    configRevision: 1,
    deadline: "2099-01-01T00:00:00.000Z",
  },
  updatedAt: "2026-10-24T00:00:00.000Z",
};

const carrierKey = FactoryClaimCarrierKey.make("github:example-org/beta#1:comment:7:digest");

it.each([
  ["a verified claim", { state: "verified" }, { state: "verified", carrierKey }],
  [
    "a stale claim",
    { state: "stale_after_claim", reason: "factory_paused" },
    { state: "stale_after_claim", reason: "factory_paused", carrierKey },
  ],
  [
    "a claim conflicted by a foreign claim",
    { state: "conflicted", reason: "foreign_claim" },
    { state: "conflicted", reason: "foreign_claim", carrierKey },
  ],
  [
    "a claim conflicted by our changed comment",
    { state: "conflicted", reason: "own_comment_changed" },
    { state: "conflicted", reason: "own_comment_changed", commentId: 7 },
  ],
  ["a released claim", { state: "released" }, { state: "released", reason: "create_rejected" }],
] as const)(
  "Claims/C1-S01: %s cannot be represented without the receipt that put it there",
  (_name, missing, complete) => {
    assert.isTrue(Exit.isFailure(decodeClaim({ ...claimBase, ...missing })));
    assert.isTrue(Exit.isSuccess(decodeClaim({ ...claimBase, ...complete })));
  },
);

/** One admitted, claim-requiring reservation, with its pending claim, as admission records it. */
const admitPendingClaim = Effect.gen(function* () {
  const store = yield* FactoryStore.FactoryStore;
  const claims = yield* FactoryClaimStore.FactoryClaimStore;
  const sql = yield* SqlClient.SqlClient;
  const configuration = yield* store.configure({
    factoryId,
    projectId: ProjectId.make("project:beta"),
    policyRevision: "policy-r1",
    enabled: true,
    pools: [{ poolId, capacityUnits: 1 }],
    execution: { modelSelection, runtimeMode: "full-access", interactionMode: "default" },
    packet: { briefSchemaVersion: "brief-v1", helper: null },
    artifactRoot: process.cwd(),
  });
  const itemKey = FactoryItemKey.make("github:example-org/beta#1");
  const recorded = yield* store.recordItemObservation({
    factoryId,
    itemKey,
    itemVersion: "v1",
    generation: yield* store.beginCollection(factoryId),
    complete: true,
    evidence: [],
    sources: [],
    claims: [],
  });
  if (recorded.type !== "recorded") return yield* Effect.die("unrecorded");
  const admission = {
    factoryId,
    configRevision: configuration.revision,
    decisionKey: FactoryDecisionKey.make("decision:claim"),
    itemKey,
    itemVersion: "v1",
    taskKind: "implement",
    policyRevision: "policy-r1",
    poolId,
    units: 1,
    packetDigest: "packet",
    observationId: recorded.observation.observationId,
    basisDigest: recorded.observation.basisDigest,
    deadline: DateTime.makeUnsafe("2099-01-01T00:00:00.000Z"),
  };
  const commandId = CommandId.make("command:claim");
  const threadId = ThreadId.make("thread:claim");
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const reserved = yield* store.reserveExecution({
        commandId,
        executionThreadId: threadId,
        runId: RunId.make("run:claim"),
        taskNodeId: NodeId.make("node:claim"),
        modelSelection,
        origin: { type: "admission", admission },
      });
      assert.strictEqual(reserved.type, "reserved");
      yield* claims.registerAdmission({
        commandId,
        threadId,
        admission,
        claim: { host: "github.com", repository: "example-org/beta", issueNumber: 1 },
        launch: { messageCommandId: commandId, prompt: "Implement it.", modelSelection },
      });
    }),
  );
  const prepared = yield* claims.prepareAttempt({
    reservationId,
    nonce: "nonce",
    accountId: "9001",
  });
  assert.strictEqual(prepared.type, "prepared");
  return claims;
});

it.effect("Claims/C1-S01: the store refuses a written attempt without its comment id", () =>
  Effect.gen(function* () {
    const claims = yield* admitPendingClaim;
    const recorded = yield* Effect.exit(
      claims.advanceAttempt({
        reservationId,
        attempt: 1,
        // @ts-expect-error a written outcome names the comment the create returned
        to: { phase: "written" },
      }),
    );
    assert.isTrue(Exit.isFailure(recorded) || recorded.value === false);
    const entry = Option.getOrThrow(yield* claims.get(reservationId));
    assert.strictEqual(entry.attempts[0]?.phase, "prepared");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Claims/C1-S01: an attempt cannot skip its write or verify another comment", () =>
  Effect.gen(function* () {
    const claims = yield* admitPendingClaim;
    const skipped = yield* Effect.exit(
      claims.advanceAttempt({
        reservationId,
        attempt: 1,
        to: { phase: "verified", commentId: 7, commentDigest: "digest" },
      }),
    );
    assert.isTrue(Exit.isFailure(skipped));
    assert.isTrue(
      yield* claims.advanceAttempt({
        reservationId,
        attempt: 1,
        to: { phase: "written", commentId: 7 },
      }),
    );
    const other = yield* Effect.exit(
      claims.advanceAttempt({
        reservationId,
        attempt: 1,
        to: { phase: "verified", commentId: 8, commentDigest: "digest" },
      }),
    );
    assert.isTrue(Exit.isFailure(other));
    // A second recording of the same outcome lost the race; it is not a new write.
    assert.isFalse(
      yield* claims.advanceAttempt({
        reservationId,
        attempt: 1,
        to: { phase: "written", commentId: 9 },
      }),
    );
    const entry = Option.getOrThrow(yield* claims.get(reservationId));
    assert.deepStrictEqual(entry.attempts[0], { ...attemptBase, phase: "written", commentId: 7 });
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Claims/C1-S01: a claim moves only forward, and a held claim does not move", () =>
  Effect.gen(function* () {
    const claims = yield* admitPendingClaim;
    // The prepared attempt left the claim writing; a written claim may be held stale.
    assert.isTrue(
      yield* claims.transition({
        reservationId,
        from: ["writing"],
        to: { state: "stale_after_claim", carrierKey, reason: "factory_paused" },
      }),
    );
    // A held claim has no way back to sending again.
    const reopened = yield* Effect.exit(
      claims.transition({ reservationId, from: ["stale_after_claim"], to: { state: "pending" } }),
    );
    assert.isTrue(Exit.isFailure(reopened));
    // A lost race is false, never an error, and changes nothing.
    assert.isFalse(
      yield* claims.transition({
        reservationId,
        from: ["verified"],
        to: { state: "conflicted", reason: "foreign_claim", carrierKey },
      }),
    );
    const entry = Option.getOrThrow(yield* claims.get(reservationId));
    assert.deepStrictEqual(
      [entry.claim.state, "carrierKey" in entry.claim ? entry.claim.carrierKey : null],
      ["stale_after_claim", carrierKey],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Claims/C1-S01: a stored row with a field its state does not carry is unreadable", () =>
  Effect.gen(function* () {
    const claims = yield* admitPendingClaim;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE factory_claim_attempts
      SET record_json = json_set(record_json, '$.commentId', 7)
      WHERE reservation_id = ${reservationId}
    `;
    assert.isTrue(Exit.isFailure(yield* Effect.exit(claims.get(reservationId))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "Claims/C1-S01 control: a written receipt settles into a verified claim and attempt",
  () =>
    Effect.gen(function* () {
      const claims = yield* admitPendingClaim;
      assert.isTrue(
        yield* claims.advanceAttempt({
          reservationId,
          attempt: 1,
          to: { phase: "written", commentId: 7 },
        }),
      );
      assert.isTrue(
        yield* claims.settleVerified({
          reservationId,
          attempt: 1,
          commentId: 7,
          commentDigest: "digest",
          messageCommandId: CommandId.make("command:claim"),
        }),
      );
      const entry = Option.getOrThrow(yield* claims.get(reservationId));
      assert.deepStrictEqual(entry.attempts, [
        { ...attemptBase, phase: "verified", commentId: 7, commentDigest: "digest" },
      ]);
      assert.deepStrictEqual(
        [entry.claim.state, "carrierKey" in entry.claim ? entry.claim.carrierKey : null],
        ["verified", "github:example-org/beta#1:comment:7:digest"],
      );
    }).pipe(Effect.provide(layerTest)),
);

it.effect("Claims/C1-S01 control: a rejected attempt frees the claim for a new attempt", () =>
  Effect.gen(function* () {
    const claims = yield* admitPendingClaim;
    assert.isTrue(
      yield* claims.advanceAttempt({
        reservationId,
        attempt: 1,
        to: { phase: "rejected", cause: "GitHubApiRateLimitError", transient: true },
      }),
    );
    assert.isTrue(
      yield* claims.transition({ reservationId, from: ["writing"], to: { state: "pending" } }),
    );
    const again = yield* claims.prepareAttempt({
      reservationId,
      nonce: "nonce-2",
      accountId: "9001",
    });
    assert.strictEqual(again.type, "prepared");
    const entry = Option.getOrThrow(yield* claims.get(reservationId));
    assert.deepStrictEqual(
      entry.attempts.map((attempt) => attempt.phase),
      ["rejected", "prepared"],
    );
  }).pipe(Effect.provide(layerTest)),
);

/**
 * One run's native records as the projection holds them: its provider thread's recorded driver,
 * and a preparation item whose id was derived under `itemDriver`.
 */
const seedPreparationRecords = (input: {
  readonly recordedDriver: string | null;
  readonly itemDriver: string;
  readonly itemStatus: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const threadId = "thread:phase";
    const runId = RunId.make("run:phase");
    const now = "2026-10-24T00:00:00.000Z";
    yield* sql`
      INSERT INTO orchestration_v2_projection_runs (
        run_id, thread_id, ordinal, provider, provider_thread_id, status, requested_at, payload_json
      ) VALUES (
        ${runId}, ${threadId}, 1, 'codex', 'provider-thread:phase', 'failed', ${now},
        ${JSON.stringify({ rootNodeId: "node:phase", providerThreadId: "provider-thread:phase" })}
      )
    `;
    if (input.recordedDriver !== null) {
      yield* sql`
        INSERT INTO orchestration_v2_projection_provider_threads (
          provider_thread_id, thread_id, provider, status, updated_at, payload_json
        ) VALUES (
          'provider-thread:phase', ${threadId}, 'codex', 'idle', ${now},
          ${JSON.stringify({ id: "provider-thread:phase", driver: input.recordedDriver })}
        )
      `;
    }
    const itemId = IdAllocator.derive.turnItemFromProviderItem({
      driver: ProviderDriverKind.make(input.itemDriver),
      nativeItemId: `workspace-preparation:${runId}`,
    });
    yield* sql`
      INSERT INTO orchestration_v2_projection_turn_items (
        turn_item_id, thread_id, run_id, node_id, ordinal, type, status, updated_at, payload_json
      ) VALUES (
        ${itemId}, ${threadId}, ${runId}, 'node:phase', 2, 'command_execution', ${input.itemStatus},
        ${now}, '{}'
      )
    `;
    const claims = yield* FactoryClaimStore.FactoryClaimStore;
    return yield* claims.preparationPhase({ threadId: ThreadId.make(threadId), runId });
  });

it.effect.each([
  ["the run's own recorded driver", "codex", "codex", "failed"],
  ["another driver", "codex", "claude", "unknown"],
  ["no recorded provider thread", null, "codex", "unknown"],
] as const)(
  "Claims/R2-S04: a preparation marker derived under %s decides the phase accordingly",
  ([, recordedDriver, itemDriver, expected]) =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* seedPreparationRecords({ recordedDriver, itemDriver, itemStatus: "failed" }),
        expected,
      );
    }).pipe(Effect.provide(layerTest)),
);
