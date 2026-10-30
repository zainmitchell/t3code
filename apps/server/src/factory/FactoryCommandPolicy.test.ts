// @effect-diagnostics nodeBuiltinImport:off - pins the real policy fixture on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
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
import * as Schema from "effect/Schema";

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
  readonly subIssueCount?: number;
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
        issue: {
          state: "open",
          title: "Issue",
          body: "",
          labels: item.labels,
          comments: [],
          ...(item.subIssueCount === undefined ? {} : { subIssueCount: item.subIssueCount }),
        },
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

/** A pinned one-shot policy that answers `decision` for the item, whatever it is given. */
const answering = (decision: unknown) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-policy-"));
      const script = NodePath.join(root, "policy.mjs");
      const answer = JSON.stringify({ decisions: [{ itemKey, decision }] });
      NodeFS.writeFileSync(
        script,
        `process.stdin.resume();\nprocess.stdin.on("end", () => process.stdout.write(${JSON.stringify(answer)}));\n`,
      );
      return { root, script, sha256: sha256(NodeFS.readFileSync(script)) };
    }),
    ({ root }) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
  );

const gateWithdrawal = {
  decisionId: "479bf8dc0c9d2c736ef620e93351c01c12cb7fe2",
  evidenceDigest: sha256("evidence of #9"),
  stage: "implement",
  itemVersion: "v1",
  policyRevision: "policy-r1",
  reason: "the owner deferred this optional question",
};

it.live.each([
  [
    "an exact withdrawal is carried as given",
    { withdraws: gateWithdrawal },
    { type: "none", reason: "held", class: "held", withdraws: gateWithdrawal },
  ],
  [
    "a withdrawal with a field T3 does not read fails the item",
    { withdraws: { ...gateWithdrawal, answer: "no" } },
    { type: "policy_failed", reason: "policy withdrawal is not a gate withdrawal" },
  ],
  [
    "a withdrawal missing its evidence fails the item",
    { withdraws: { ...gateWithdrawal, evidenceDigest: undefined } },
    { type: "policy_failed", reason: "policy withdrawal is not a gate withdrawal" },
  ],
  [
    "a withdrawal that is not a record fails the item",
    { withdraws: "479bf8dc0c9d2c736ef620e93351c01c12cb7fe2" },
    { type: "policy_failed", reason: "policy withdrawal is not a gate withdrawal" },
  ],
  [
    "a misspelled withdrawal withdraws nothing",
    { withdraw: gateWithdrawal },
    { type: "none", reason: "held", class: "held" },
  ],
] as const)("Policy/G1: %s", ([, fields, expected]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const pinned = yield* answering({
        decision: "none",
        reason: "held",
        class: "held",
        ...fields,
      });
      const config = configuration({
        executable: process.execPath,
        script: pinned.script,
        sha256: pinned.sha256,
      });
      assert.deepStrictEqual(only(yield* decide([{ labels: [] }], config)), expected);
    }),
  ).pipe(Effect.provide(layer)),
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

it("Policy input: closed blockers carry their outcomes as facts; other items are unchanged", () => {
  const blocker = FactoryItemKey.make("github:example-org/alpha#11");
  const integrated: FactoryOutcomeStore.FactoryOutcome = {
    outcomeId: "11-integrate",
    factoryId,
    itemKey: blocker,
    origin: { type: "native", operationId: "operation-11" },
    stage: "integrate",
    report: { outcome: "integrated", summary: "Landed." },
    reportDigest: "digest-11",
    reportedAt: "2026-10-28T00:00:00.000Z",
    state: "verified",
    receipt: { verifiedAt: "2026-10-28T00:00:00.000Z" },
  };
  const item = {
    observation: observationOf(itemKey, 1),
    issue: {
      state: "open" as const,
      title: "Use the correction",
      body: "",
      labels: [],
      comments: [],
      blockedBy: [{ repository: "example-org/alpha", number: 11, state: "closed" as const }],
    },
    stage: { type: "implement" as const },
    reserved: [],
    grants: [],
    outcomes: [],
    decisionKey,
  };
  const refused = FactoryItemKey.make("github:example-org/alpha#12");
  // Extra fields on a recorded event never reach policy.
  const events = [
    { type: "rejected" as const, seq: 3, outcomeId: "12-review", failureDigest: "owner-refused" },
    { type: "reopened" as const, seq: 4, closureOutcomeId: "12-close" },
  ];
  const input = FactoryCommandPolicy.policyInput({
    configuration: configuration(),
    items: [
      {
        ...item,
        blockers: [
          { itemKey: blocker, outcomes: [{ ...integrated, itemVersion: "v3" }] },
          { itemKey: refused, outcomes: [], events },
        ],
      },
      item,
    ],
    active: [],
  });
  assert.strictEqual(input.schema, "t3-factory-policy-input/2");
  assert.deepStrictEqual(input.items[0]!.blockers, [
    {
      itemKey: blocker,
      outcomes: [
        {
          outcomeId: "11-integrate",
          stage: "integrate",
          state: "verified",
          report: integrated.report,
          itemVersion: "v3",
        },
      ],
    },
    {
      itemKey: refused,
      outcomes: [],
      events: [
        { type: "rejected", outcomeId: "12-review", failureDigest: "owner-refused" },
        { type: "reopened", closureOutcomeId: "12-close" },
      ],
    },
  ]);
  // The outcome's own native origin is not forwarded; only one T3 matched to its applied receipt.
  const landing = { type: "native" as const, operationId: "operation-11" };
  const parent = FactoryCommandPolicy.policyInput({
    configuration: configuration(),
    items: [
      {
        ...item,
        blockers: [{ itemKey: blocker, outcomes: [{ ...integrated, landingOrigin: landing }] }],
        children: [
          {
            itemKey: blocker,
            outcomes: [{ ...integrated, landingOrigin: landing }],
            state: "closed",
            body: "## Acceptance\n- B1: carried.",
          },
          { itemKey: refused, outcomes: [], events, state: "open" },
        ],
      },
      { ...item, childrenUnread: { reason: "listed 1 of 2", foreign: [] } },
    ],
    active: [],
  });
  assert.deepStrictEqual(parent.items[0]!.blockers?.[0]?.outcomes[0]?.origin, landing);
  assert.deepStrictEqual(
    parent.items[0]!.children?.map((child) => [
      child.itemKey,
      child.state,
      child.outcomes.map((outcome) => outcome.origin),
      child.events?.length ?? 0,
      // A body the membership read did not carry stays absent: unknown, never empty.
      "body" in child ? child.body : "unread",
    ]),
    [
      [blocker, "closed", [landing], 0, "## Acceptance\n- B1: carried."],
      [refused, "open", [], 2, "unread"],
    ],
  );
  // Unread membership is said, never sent as an empty list.
  assert.isFalse("children" in parent.items[1]!);
  assert.deepStrictEqual(parent.items[1]!.childrenUnread, { reason: "listed 1 of 2", foreign: [] });
  // Evidence an adoption names reaches the policy as recorded facts, like a child, never as an edge.
  const named = FactoryCommandPolicy.policyInput({
    configuration: configuration(),
    items: [{ ...item, criteriaEvidence: [{ itemKey: refused, outcomes: [], events }] }],
    active: [],
  });
  assert.deepStrictEqual(
    named.items[0]!.criteriaEvidence?.map((facts) => [facts.itemKey, facts.events?.length]),
    [[refused, 2]],
  );
  assert.isFalse("criteriaEvidence" in parent.items[0]!);
  // An item without blockers serializes exactly as it did before they existed.
  assert.deepStrictEqual(Object.keys(input.items[1]!), [
    "decisionKey",
    "stage",
    "itemVersion",
    "item",
    "outcomes",
    "reserved",
    "grants",
  ]);
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
    const subject = { repository: "zainmitchell/hsa", headCommit: reviewedHead };
    const findings = "RV84-1: the items-plus-total journey is not demonstrated.";
    const journey = NodePath.join(root, "rv84", "journey.json");
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

it.live(
  "Policy: decomposition, a correction ticket and a classed nothing reach T3 as decided",
  () =>
    Effect.gen(function* () {
      const triage = only(yield* decide([{ labels: ["policy:triage"] }]));
      if (triage === undefined || "type" in triage)
        return assert.fail("expected a triage admission");
      assert.strictEqual(triage.taskKind, "triage");
      // The worker is told the exact item version its proposal must name.
      assert.include(triage.packet.text, "Item version: v1.");
      assert.include(triage.packet.text, "unit_proposed");
      assert.notInclude(triage.packet.text, "criteria_proposed");
      assert.strictEqual(triage.packet.sha256, sha256(triage.packet.text));
      // A parent is prepared as criteria on its exact text, never as a unit.
      const parent = only(yield* decide([{ labels: ["policy:triage"], subIssueCount: 2 }]));
      if (parent === undefined || "type" in parent)
        return assert.fail("expected a triage admission");
      assert.include(parent.packet.text, `Item version: v1. Body sha256: ${sha256("")}.`);
      assert.include(parent.packet.text, "- criteria_proposed with criteria.basis");
      assert.notInclude(parent.packet.text, "unit_proposed");
      assert.notInclude(parent.packet.text, "subject.baseCommit");
      assert.deepStrictEqual(only(yield* decide([{ labels: ["policy:spawn"] }])), {
        type: "spawn",
        reason: "the verification found a product defect",
        ticket: {
          title: `Correct ${itemKey}`,
          body: "Fix the importer's double count.",
          labels: ["effort:medium"],
          parentIssueNumber: null,
          blocks: [12],
        },
      });
      assert.deepStrictEqual(only(yield* decide([{ labels: ["policy:needs-routing"] }])), {
        type: "none",
        reason: "no unit spec yet",
        class: "needs_routing",
      });
    }).pipe(Effect.provide(layer)),
);

it.live("Policy: every worker packet names the factory's configured host tooling once", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "factory-policy-"));
  return Effect.gen(function* () {
    // Another configured runtime, at a path with a space; what it is called is the operator's.
    const bun = NodePath.join(
      directory,
      "policy runtime",
      `bun${NodePath.extname(process.execPath)}`,
    );
    NodeFS.mkdirSync(NodePath.dirname(bun));
    NodeFS.copyFileSync(process.execPath, bun);
    const packetsFor = (executable: string) =>
      Effect.forEach(
        [
          { labels: ["policy:triage"] },
          { labels: ["ready"] },
          { labels: ["ready"], stage: { type: "correct", outcomeId: "r", failureDigest: "f" } },
          { labels: ["ready"], stage: { type: "rework", specOutcomeId: "s", failureDigest: "f" } },
          { labels: ["ready"], stage: { type: "review", outcomeId: "i", head: reviewedHead } },
        ] satisfies ReadonlyArray<ItemInput>,
        (item) =>
          Effect.map(
            decide(
              [item],
              configuration({ executable, script: fixturePath, sha256: fixtureSha256 }),
            ),
            (answer) => {
              const request = only(answer);
              if (request === undefined || "type" in request)
                return assert.fail("expected admission");
              assert.strictEqual(request.packet.sha256, sha256(request.packet.text));
              return { taskKind: request.taskKind, text: request.packet.text };
            },
          ),
      );
    for (const executable of [process.execPath, bun]) {
      const packets = yield* packetsFor(executable);
      assert.deepStrictEqual(
        packets.map((packet) => packet.taskKind),
        ["triage", "implement", "correct", "rework", "review"],
      );
      for (const { text } of packets) {
        assert.strictEqual(text.split("Host tooling on the T3 server host").length, 2);
        assert.include(text, `policy executable: ${JSON.stringify(executable)}`);
        assert.include(text, `Node executable: ${JSON.stringify(process.execPath)}`);
        assert.notMatch(text, /python/i);
        assert.include(text, "t3_factory_report");
        assert.isTrue(text.trimEnd().endsWith("Settling or ending the thread is not a report."));
      }
    }
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
    Effect.provide(layer),
  );
});

it("Policy answer: a parent closure names adopted or prepared criteria as its policy sent them", () => {
  const decode = Schema.decodeUnknownOption(FactoryCommandPolicy.PolicyAnswer);
  const pinned = { root: "C:/criteria", path: "adopted/27.json", sha256: "a".repeat(64) };
  const prepared = {
    bytes: '{"schema":"factory-parent-criteria/1"}',
    sha256: "b".repeat(64),
    adopted: pinned,
  };
  const answer = (parentClosure: unknown) => ({
    decisions: [{ itemKey, decision: { decision: "proceed", parentClosure } }],
  });
  const decided: unknown = Option.getOrThrow(decode(answer({ prepared }))).decisions[0]!.decision;
  assert.deepStrictEqual(decided, { decision: "proceed", parentClosure: { prepared } });
  assert.isTrue(Option.isSome(decode(answer({ criteria: pinned }))));
  // A reservation may name its question; the name is bounded like other identities.
  const reserve = (question: string) => ({
    decisions: [
      { itemKey, decision: { decision: "reserve", reason: "r", evidence: "e", question } },
    ],
  });
  assert.isTrue(Option.isSome(decode(reserve("retention-period"))));
  assert.isTrue(Option.isNone(decode(reserve("q".repeat(201)))));
  assert.isTrue(
    Option.isNone(decode(answer({ prepared: { ...prepared, bytes: "x".repeat(1_000_001) } }))),
  );
});
