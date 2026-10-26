// @effect-diagnostics nodeBuiltinImport:off - pins the real policy fixture on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryObservationId,
  FactoryPoolId,
  FactoryReadGeneration,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProcessRunner from "../processRunner.ts";
import * as FactoryCommandPolicy from "./FactoryCommandPolicy.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const fixturePath = NodePath.join(import.meta.dirname, "factoryPolicy.fixture.ts");
const fixtureSha256 = sha256(NodeFS.readFileSync(fixturePath));
const factoryId = FactoryId.make("alpha");
const itemKey = FactoryItemKey.make("github:example-org/alpha#12");

const configuration = (
  policy: FactoryStore.FactoryConfiguration["policy"] | null = {
    executable: process.execPath,
    script: fixturePath,
    sha256: fixtureSha256,
  },
): FactoryStore.FactoryConfiguration => ({
  factoryId,
  projectId: ProjectId.make("project:alpha"),
  policyRevision: "policy-r1",
  enabled: true,
  pools: [{ poolId: FactoryPoolId.make("builders"), capacityUnits: 1 }],
  execution: {
    modelSelection: { instanceId: ProviderInstanceId.make("alpha_claude"), model: "claude-test" },
    runtimeMode: "full-access",
    interactionMode: "default",
  },
  packet: { briefSchemaVersion: "brief-v1", helper: null },
  artifactRoot: process.cwd(),
  ...(policy === null ? {} : { policy }),
  revision: 1,
  createdAt: "2026-10-24T00:00:00.000Z",
});

const observationOf = (key: string, id: number): FactoryStore.ItemObservation => ({
  factoryId,
  itemKey: FactoryItemKey.make(key),
  itemVersion: "v1",
  generation: FactoryReadGeneration.make(1),
  complete: true,
  evidence: [],
  sources: [],
  claims: [],
  observationId: FactoryObservationId.make(id),
  basisDigest: "basis",
  observedAt: "2026-10-24T00:00:00.000Z",
});

const decisionKey = FactoryDecisionKey.make("d".repeat(64));
const reviewedHead = "abc1234";
const ownerEvidence = `Synthetic owner decision for ${reviewedHead}`;

interface ItemInput {
  readonly key?: string;
  readonly labels: ReadonlyArray<string>;
  readonly stage?: FactoryLifecycle.FactoryPolicyItem["stage"];
  readonly reserved?: ReadonlyArray<FactoryOutcomeStore.ReservedDecision>;
  readonly outcomes?: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>;
}

const decide = (items: ReadonlyArray<ItemInput>, config = configuration()) =>
  Effect.gen(function* () {
    const policy = yield* FactoryLifecycle.FactoryAdmissionPolicy;
    const proposer = policy.forFactory({
      factoryId,
      policyRevision: config.policyRevision,
      configuration: config,
    });
    assert.isTrue(Option.isSome(proposer));
    return yield* Option.getOrThrow(proposer).decide({
      configuration: config,
      items: items.map((item, index) => ({
        observation: observationOf(item.key ?? itemKey, index + 1),
        issue: { state: "open", title: "Issue", body: "", labels: item.labels, comments: [] },
        stage: item.stage ?? { type: "implement" },
        reserved: item.reserved ?? [],
        grants: [],
        outcomes: item.outcomes ?? [],
        decisionKey,
      })),
      active: [],
    });
  });

const only = (answer: Effect.Success<ReturnType<typeof decide>>) => {
  if (!Array.isArray(answer))
    return assert.fail(`expected decisions, got ${JSON.stringify(answer)}`);
  assert.strictEqual(answer.length, 1);
  return answer[0]!.decision;
};

const layer = FactoryCommandPolicy.layer.pipe(
  Layer.provide(ProcessRunner.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.live("Policy: one call decides a pass in the policy's order, with T3's report footer", () =>
  Effect.gen(function* () {
    const answer = yield* decide([
      { key: "github:example-org/alpha#20", labels: ["ready"] },
      { key: "github:example-org/alpha#21", labels: ["ready", "priority:first"] },
    ]);
    if (!Array.isArray(answer)) return assert.fail("expected decisions");
    assert.deepStrictEqual(
      answer.map((entry) => entry.itemKey),
      ["github:example-org/alpha#21", "github:example-org/alpha#20"],
    );
    const request = answer[0]!.decision;
    if (request === undefined || "type" in request) return assert.fail("expected an admission");
    assert.strictEqual(request.taskKind, "implement");
    assert.strictEqual(request.poolId, "builders");
    assert.include(request.packet.text, `work key ${decisionKey}`);
    assert.include(request.packet.text, "t3_factory_report");
    assert.strictEqual(request.packet.sha256, sha256(request.packet.text));
    assert.strictEqual(request.packet.briefSchemaVersion, "brief-v1");
  }).pipe(Effect.provide(layer)),
);

it.live("Policy: an integration waits for the owner's approval of that exact evidence", () =>
  Effect.gen(function* () {
    const stage = { type: "integrate", reviewOutcomeId: "review-1", head: reviewedHead } as const;
    assert.deepStrictEqual(only(yield* decide([{ labels: ["policy:owner"], stage }])), {
      type: "reserve",
      reason: "The owner decides this release.",
      evidenceDigest: sha256(ownerEvidence),
    });
    const decision: FactoryOutcomeStore.ReservedDecision = {
      decisionId: "decision-1",
      factoryId,
      itemKey,
      stage: "integrate",
      reason: "The owner decides this release.",
      evidenceDigest: sha256(ownerEvidence),
      state: "resolved",
      createdAt: "2026-10-24T00:00:00.000Z",
      resolution: { answer: "approve", by: "owner", resolvedAt: "2026-10-24T00:00:00.000Z" },
    };
    assert.deepStrictEqual(
      only(yield* decide([{ labels: ["policy:owner"], stage, reserved: [decision] }])),
      { type: "proceed" },
    );
  }).pipe(Effect.provide(layer)),
);

it.live("Policy/N12: a supervised start asks for a grant on its exact request evidence", () =>
  Effect.gen(function* () {
    const request = only(yield* decide([{ labels: ["policy:supervised"] }]));
    if (request === undefined || "type" in request) return assert.fail("expected an admission");
    assert.deepStrictEqual(request.requiresGrant, {
      reason: "Supervised ticket: the owner grants each start.",
      evidenceDigest: sha256(`supervised start of ${itemKey}`),
    });
  }).pipe(Effect.provide(layer)),
);

it.live("Policy: nothing to do, a broken answer and a changed pin start nothing", () =>
  Effect.gen(function* () {
    // The policy's own reason is kept, so the factory can say why nothing started.
    assert.deepStrictEqual(only(yield* decide([{ labels: ["policy:blocked"] }])), {
      type: "none",
      reason: "blocked by unfinished dependency",
    });
    assert.deepStrictEqual(yield* decide([{ labels: ["policy:garbage"] }]), {
      type: "policy_failed",
      reason: "policy answer is not a decision",
    });
    const exited = yield* decide([{ labels: ["policy:exit"] }]);
    assert.strictEqual("type" in exited && exited.type, "policy_failed");
    assert.include("reason" in exited ? exited.reason : "", "exited 3");
    const repinned = configuration({
      executable: process.execPath,
      script: fixturePath,
      sha256: sha256("another revision"),
    });
    assert.deepStrictEqual(yield* decide([{ labels: ["ready"] }], repinned), {
      type: "policy_failed",
      reason: `policy script ${fixturePath} does not match its pin`,
    });
    const policy = yield* FactoryLifecycle.FactoryAdmissionPolicy;
    const unpinned = configuration(null);
    assert.isTrue(
      Option.isNone(
        policy.forFactory({ factoryId, policyRevision: "policy-r1", configuration: unpinned }),
      ),
    );
  }).pipe(Effect.provide(layer)),
);

it("Policy input: each item's relations and the work under way reach the policy as read", () => {
  const issue = {
    state: "open" as const,
    title: "Parse dates",
    body: "## Owned files\n- `src/dates.py`",
    labels: ["ready", "effort:medium"],
    comments: [],
    author: { id: "42", login: "example-user" },
    blockedBy: [{ repository: "example-org/alpha", number: 11, state: "closed" as const }],
    parent: { repository: "example-org/alpha", number: 6 },
  };
  const input = FactoryCommandPolicy.policyInput({
    configuration: configuration(),
    items: [
      {
        observation: observationOf(itemKey, 1),
        issue,
        stage: { type: "implement" },
        reserved: [],
        grants: [],
        outcomes: [],
        decisionKey,
      },
      {
        observation: observationOf("github:example-org/alpha#13", 2),
        // A tracker that could not say what blocks an item says so; it is not "nothing".
        issue: { ...issue, blockedBy: null, parent: null },
        stage: { type: "implement" },
        reserved: [],
        grants: [],
        outcomes: [],
        decisionKey,
      },
    ],
    active: [
      {
        itemKey: FactoryItemKey.make("github:example-org/alpha#14"),
        stage: "rework",
        custody: "native",
        issue: { ...issue, body: "## Owned files\n- `src/dates.py`\n- `src/io.py`" },
      },
    ],
  });
  assert.deepStrictEqual(
    input.items.map((entry) => [entry.item.author, entry.item.blockedBy, entry.item.parent]),
    [
      [issue.author, issue.blockedBy, issue.parent],
      [issue.author, null, null],
    ],
  );
  assert.deepStrictEqual(
    input.active.map((entry): ReadonlyArray<unknown> => [
      entry.item.itemKey,
      entry.item.issueNumber,
      entry.stage,
      entry.custody,
    ]),
    [["github:example-org/alpha#14", 14, "rework", "native"]],
  );
  assert.include(input.active[0]!.item.body, "src/io.py");
});

it.live(
  "Policy: a failed integration gate and a chosen execution reach the lifecycle as decided",
  () =>
    Effect.gen(function* () {
      const stage = { type: "integrate", reviewOutcomeId: "review-1", head: reviewedHead } as const;
      assert.deepStrictEqual(only(yield* decide([{ labels: ["policy:gate-fail"], stage }])), {
        type: "gate_failed",
        failure: `new privacy finding against base for ${reviewedHead}`,
      });
      const request = only(yield* decide([{ labels: ["policy:medium"] }]));
      if (request === undefined || "type" in request) return assert.fail("expected an admission");
      assert.strictEqual(request.execution, "builder-medium");
    }).pipe(Effect.provide(layer)),
);

it.live("Policy: same-head verification is directed into the exact artifact root and judged", () =>
  Effect.gen(function* () {
    const config = configuration();
    const root = config.artifactRoot;
    const verified = (
      outcomeId: string,
      stage: FactoryOutcomeStore.FactoryOutcome["stage"],
      report: FactoryOutcomeStore.FactoryOutcome["report"],
    ): FactoryOutcomeStore.FactoryOutcome => ({
      outcomeId,
      factoryId,
      itemKey,
      origin: { type: "native" },
      stage,
      report,
      reportDigest: sha256(outcomeId),
      reportedAt: "2026-10-26T00:00:00.000Z",
      state: "verified",
      receipt: { verifiedAt: "2026-10-26T00:00:00.000Z" },
    });
    const subject = { repository: "example-org/example-project", headCommit: reviewedHead };
    const findings = "Synthetic required scenario is not demonstrated.";
    const journey = NodePath.join(root, "review-failure-a", "journey.json");
    const outcomes = [
      verified("review-1", "review", {
        outcome: "review_failed",
        subject,
        failure: findings,
        summary: "Acceptance unproven.",
      }),
      verified("rework-1", "rework", {
        outcome: "implemented",
        subject: { ...subject, baseCommit: "base1" },
        summary: "Verified at the same head.",
        artifacts: [{ path: journey, sha256: "e".repeat(64) }],
      }),
    ];
    const packetFor = (stage: FactoryLifecycle.FactoryPolicyItem["stage"]) =>
      Effect.map(decide([{ labels: ["ready"], stage, outcomes }], config), (answer) => {
        const request = only(answer);
        if (request === undefined || "type" in request) return assert.fail("expected admission");
        return request.packet.text;
      });

    const correction = yield* packetFor({
      type: "correct",
      outcomeId: "review-1",
      failureDigest: "f".repeat(64),
    });
    assert.include(correction, `direct that output under ${root}`);
    const rework = yield* packetFor({
      type: "rework",
      specOutcomeId: "spec-1",
      failureDigest: "f".repeat(64),
    });
    assert.include(rework, `evidence only when written under ${root}`);
    // A first review of a head is the review it always was.
    const first = yield* packetFor({ type: "review", outcomeId: "rework-1", head: reviewedHead });
    assert.notInclude(first, "reviewed before");
    const again = yield* packetFor({
      type: "review",
      outcomeId: "rework-1",
      head: reviewedHead,
      evidence: "d".repeat(64),
    });
    assert.include(again, `- ${journey} (sha256 ${"e".repeat(64)})`);
    assert.include(again, "settles every finding of the failed review");
    assert.include(again, findings);
  }).pipe(Effect.provide(layer)),
);
