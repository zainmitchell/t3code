import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { FactoryId, FactoryItemKey } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import type { TrackerIssue } from "./factoryClaimPolicy.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

const repository = "example-org/alpha";
const factoryId = FactoryId.make("alpha");
const otherFactoryId = FactoryId.make("beta");
const keyOf = (issueNumber: number, from = repository) =>
  FactoryItemKey.make(`github:${from}#${issueNumber}`);
const head = "105a105a";
const reportedAt = "2026-10-28T00:00:00.000Z";

const stores = Layer.merge(FactoryOutcomeStore.layer, FactoryStore.layer);
const layerTest = stores.pipe(
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

type Report = FactoryOutcomeStore.FactoryOutcome["report"];

const report = (
  outcomeId: string,
  itemKey: FactoryItemKey,
  stage: FactoryOutcomeStore.FactoryOutcome["stage"],
  body: Report,
  owner = factoryId,
) =>
  Effect.flatMap(FactoryOutcomeStore.FactoryOutcomeStore, (outcomes) =>
    outcomes.insertReported({
      outcomeId,
      factoryId: owner,
      itemKey,
      origin: { type: "native" },
      stage,
      report: body,
      reportDigest: outcomeId,
      reportedAt,
      state: "reported",
    }),
  );

const verify = (outcomeId: string) =>
  Effect.flatMap(FactoryOutcomeStore.FactoryOutcomeStore, (outcomes) =>
    outcomes.markVerified({ outcomeId, receipt: { verifiedAt: reportedAt } }),
  );

const verified = (
  outcomeId: string,
  itemKey: FactoryItemKey,
  stage: FactoryOutcomeStore.FactoryOutcome["stage"],
  body: Report,
  owner = factoryId,
) =>
  Effect.andThen(report(outcomeId, itemKey, stage, body, owner), verify(outcomeId)).pipe(
    Effect.asVoid,
  );

const implemented: Report = {
  outcome: "implemented",
  subject: { repository, baseCommit: "ba5e105a", headCommit: head },
  summary: "No-edit correction.",
};
const reviewPassed: Report = {
  outcome: "review_passed",
  subject: { repository, headCommit: head },
  summary: "Reviewed.",
};
const reviewFailed: Report = {
  outcome: "review_failed",
  subject: { repository, headCommit: head },
  failure: "RV-1: acceptance unproven.",
  summary: "Failed.",
};
const integrated: Report = {
  outcome: "integrated",
  summary: "Landed.",
  integration: {
    targetBranch: "main",
    mergeCommit: "3e105a01",
    parents: ["ba5e105a", head],
    tree: "7e105a01",
    attribution: "operation",
  },
};
const closed: Report = { outcome: "closed", summary: "Closed." };

const issueBlockedBy = (blockedBy: TrackerIssue["blockedBy"]): TrackerIssue => ({
  state: "open",
  title: "Use the correction",
  body: "",
  labels: [],
  comments: [],
  ...(blockedBy === undefined ? {} : { blockedBy }),
});

type BlockerReads = Parameters<typeof FactoryLifecycle.policyBlockers>[1]["read"];

const blockersOf = (issue: TrackerIssue, read: BlockerReads = new Map()) =>
  Effect.gen(function* () {
    const reads = {
      outcomeStore: yield* FactoryOutcomeStore.FactoryOutcomeStore,
      store: yield* FactoryStore.FactoryStore,
    };
    return yield* FactoryLifecycle.policyBlockers(reads, {
      factoryId,
      repository,
      issue,
      read,
    });
  });

const facts = (blockers: Effect.Success<ReturnType<typeof blockersOf>>) =>
  ("blockers" in blockers ? blockers.blockers : []).map((blocker) => ({
    itemKey: blocker.itemKey,
    outcomes: blocker.outcomes.map(({ outcomeId, stage, state, report }) => ({
      outcomeId,
      stage,
      state,
      report,
    })),
    ...(blocker.events === undefined ? {} : { events: blocker.events }),
  }));

const ownerRejection = {
  type: "rejected" as const,
  outcomeId: "140-review",
  failureDigest: "owner-refused",
};

/** A closed blocker whose verified review the owner then rejected. */
const refusedBlocker = Effect.gen(function* () {
  const correction = keyOf(140);
  const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
  yield* verified("140-review", correction, "review", reviewPassed);
  yield* verified("140-close", correction, "close", closed);
  const issue = issueBlockedBy([{ repository, number: 140, state: "closed" }]);
  const before = yield* blockersOf(issue);
  assert.isTrue(
    yield* outcomes.rejectVerified({
      outcomeId: "140-review",
      failureDigest: "owner-refused",
      by: "owner",
      reason: "Acceptance invalid.",
    }),
  );
  return { correction, issue, before };
});

it.effect("Blockers: a closed correction's verified outcomes reach policy exactly", () =>
  Effect.gen(function* () {
    const correction = keyOf(105);
    yield* verified("105-implement", correction, "implement", implemented);
    yield* verified("105-review", correction, "review", reviewPassed);
    yield* verified("105-integrate", correction, "integrate", integrated);
    yield* verified("105-close", correction, "close", closed);

    const blockers = yield* blockersOf(
      issueBlockedBy([{ repository, number: 105, state: "closed" }]),
    );
    assert.deepStrictEqual(facts(blockers), [
      {
        itemKey: correction,
        outcomes: [
          {
            outcomeId: "105-implement",
            stage: "implement",
            state: "verified",
            report: implemented,
          },
          { outcomeId: "105-review", stage: "review", state: "verified", report: reviewPassed },
          { outcomeId: "105-integrate", stage: "integrate", state: "verified", report: integrated },
          { outcomeId: "105-close", stage: "close", state: "verified", report: closed },
        ],
      },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: failures, unverified and rejected results and a reopen stay as recorded", () =>
  Effect.gen(function* () {
    const correction = keyOf(113);
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    yield* verified("113-implement", correction, "implement", implemented);
    yield* verified("113-review-failed", correction, "review", reviewFailed);
    // Never verified, and rejected before verification: neither is in the item's order.
    yield* report("113-review-unverified", correction, "review", reviewPassed);
    yield* report("113-review-rejected", correction, "review", reviewPassed);
    assert.isTrue(
      yield* outcomes.markRejected({ outcomeId: "113-review-rejected", rejection: "unreadable" }),
    );
    yield* verified("113-close", correction, "close", closed);
    yield* outcomes.recordReopen({
      factoryId,
      itemKey: correction,
      closureOutcomeId: "113-close",
      observationId: 1,
    });
    yield* verified("113-close-again", correction, "close", closed);

    const blockers = yield* blockersOf(
      issueBlockedBy([{ repository, number: 113, state: "closed" }]),
    );
    assert.deepStrictEqual(
      facts(blockers)[0]?.outcomes.map((outcome) => [
        outcome.outcomeId,
        outcome.state,
        outcome.report.outcome,
      ]),
      [
        ["113-implement", "verified", "implemented"],
        ["113-review-failed", "verified", "review_failed"],
        ["113-close", "verified", "closed"],
        ["113-close-again", "verified", "closed"],
      ],
    );
    assert.deepStrictEqual(facts(blockers)[0]?.outcomes[1]?.report, reviewFailed);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: an owner's rejection of a verified result reaches policy as recorded", () =>
  Effect.gen(function* () {
    const { correction, issue, before } = yield* refusedBlocker;
    const rejected = yield* blockersOf(issue);

    assert.notDeepEqual(rejected, before);
    // The outcomes stay exactly as verified; the rejection is a fact beside them.
    assert.deepStrictEqual(
      "blockers" in rejected ? rejected.blockers[0]?.outcomes : undefined,
      "blockers" in before ? before.blockers[0]?.outcomes : undefined,
    );
    assert.deepStrictEqual(facts(rejected), [
      {
        itemKey: correction,
        outcomes: [
          { outcomeId: "140-review", stage: "review", state: "verified", report: reviewPassed },
          { outcomeId: "140-close", stage: "close", state: "verified", report: closed },
        ],
        events: [ownerRejection],
      },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: a reopen names only the closure it invalidated", () =>
  Effect.gen(function* () {
    const { correction, issue } = yield* refusedBlocker;
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    assert.isTrue(
      yield* outcomes.recordReopen({
        factoryId,
        itemKey: correction,
        closureOutcomeId: "140-close",
        observationId: 1,
      }),
    );
    yield* verified("140-close-again", correction, "close", closed);

    const [blocker] = facts(yield* blockersOf(issue));
    assert.deepStrictEqual(
      blocker?.outcomes.map((outcome) => [outcome.outcomeId, outcome.state]),
      [
        ["140-review", "verified"],
        ["140-close", "verified"],
        ["140-close-again", "verified"],
      ],
    );
    assert.deepStrictEqual(blocker?.events, [
      ownerRejection,
      { type: "reopened", closureOutcomeId: "140-close" },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: another factory's rejection and reopen of the same item stay out", () =>
  Effect.gen(function* () {
    const correction = keyOf(150);
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    yield* verified("150-review", correction, "review", reviewPassed, otherFactoryId);
    yield* verified("150-close", correction, "close", closed, otherFactoryId);
    assert.isTrue(
      yield* outcomes.rejectVerified({
        outcomeId: "150-review",
        failureDigest: "owner-refused",
        by: "owner",
        reason: "Acceptance invalid.",
      }),
    );
    assert.isTrue(
      yield* outcomes.recordReopen({
        factoryId: otherFactoryId,
        itemKey: correction,
        closureOutcomeId: "150-close",
        observationId: 1,
      }),
    );

    assert.deepStrictEqual(
      yield* blockersOf(issueBlockedBy([{ repository, number: 150, state: "closed" }])),
      { blockers: [{ itemKey: correction, outcomes: [] }] },
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: an item's own rejected outcome leaves its own outcomes as they were", () =>
  Effect.gen(function* () {
    const itemKey = keyOf(160);
    const reads = {
      outcomeStore: yield* FactoryOutcomeStore.FactoryOutcomeStore,
      store: yield* FactoryStore.FactoryStore,
    };
    const own = Effect.flatMap(reads.outcomeStore.itemEvents({ factoryId, itemKey }), (events) =>
      FactoryLifecycle.policyOutcomes(reads, events),
    );
    yield* verified("160-review", itemKey, "review", reviewPassed);
    const before = yield* own;
    assert.isTrue(
      yield* reads.outcomeStore.rejectVerified({
        outcomeId: "160-review",
        failureDigest: "owner-refused",
        by: "owner",
        reason: "Acceptance invalid.",
      }),
    );

    const after = yield* own;
    assert.deepStrictEqual(after, before);
    assert.deepStrictEqual(
      after.map((outcome) => [outcome.outcomeId, outcome.state]),
      [["160-review", "verified"]],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: open, foreign-repository and other-factory blockers prove nothing", () =>
  Effect.gen(function* () {
    yield* verified("120-integrate", keyOf(120), "integrate", integrated);
    yield* verified("foreign-integrate", keyOf(5, "example-org/beta"), "integrate", integrated);
    yield* verified("130-integrate", keyOf(130), "integrate", integrated, otherFactoryId);

    const blockers = yield* blockersOf(
      issueBlockedBy([
        { repository, number: 120, state: "open" },
        { repository: "example-org/beta", number: 5, state: "closed" },
        { repository, number: 130, state: "closed" },
        { repository, number: 131, state: "closed" },
      ]),
    );
    assert.deepStrictEqual(facts(blockers), [
      { itemKey: keyOf(130), outcomes: [] },
      { itemKey: keyOf(131), outcomes: [] },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: an item with no closed blocker here gains no key", () =>
  Effect.gen(function* () {
    yield* verified("120-integrate", keyOf(120), "integrate", integrated);
    for (const blockedBy of [
      undefined,
      null,
      [],
      [
        { repository, number: 120, state: "open" as const },
        { repository: "example-org/beta", number: 5, state: "closed" as const },
      ],
    ]) {
      assert.deepStrictEqual(yield* blockersOf(issueBlockedBy(blockedBy)), {});
    }
  }).pipe(Effect.provide(layerTest)),
);

it.effect("Blockers: repeated passes and a fresh read of the same store agree", () =>
  Effect.gen(function* () {
    const correction = keyOf(105);
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    yield* verified("105-implement", correction, "implement", implemented);
    yield* verified("105-review", correction, "review", reviewPassed);
    yield* verified("105-integrate", correction, "integrate", integrated);
    yield* verified("105-close", correction, "close", closed);
    yield* outcomes.rejectVerified({
      outcomeId: "105-review",
      failureDigest: "owner-refused",
      by: "owner",
      reason: "Acceptance invalid.",
    });
    yield* outcomes.recordReopen({
      factoryId,
      itemKey: correction,
      closureOutcomeId: "105-close",
      observationId: 1,
    });
    const issue = issueBlockedBy([
      { repository, number: 105, state: "closed" },
      { repository, number: 131, state: "closed" },
    ]);

    const first = yield* blockersOf(issue);
    assert.deepStrictEqual(yield* blockersOf(issue), first);
    // New store services over the same database, as a restarted server would build.
    assert.deepStrictEqual(
      yield* blockersOf(issue).pipe(Effect.provide(Layer.fresh(stores))),
      first,
    );
    // Two items sharing a blocker in one pass see the same facts.
    const read: BlockerReads = new Map();
    assert.deepStrictEqual(yield* blockersOf(issue, read), first);
    assert.deepStrictEqual(
      yield* blockersOf(issueBlockedBy([{ repository, number: 105, state: "closed" }]), read),
      { blockers: "blockers" in first ? first.blockers.slice(0, 1) : [] },
    );
    assert.strictEqual(facts(first)[0]?.outcomes.length, 4);
    assert.deepStrictEqual(facts(first)[0]?.events, [
      { type: "rejected", outcomeId: "105-review", failureDigest: "owner-refused" },
      { type: "reopened", closureOutcomeId: "105-close" },
    ]);
  }).pipe(Effect.provide(layerTest)),
);
