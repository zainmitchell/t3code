import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { FactoryId, FactoryItemKey, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import type { TrackerIssue } from "./factoryClaimPolicy.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

const repository = "example-org/btc";
const factoryId = FactoryId.make("btc");
const keyOf = (issueNumber: number, from = repository) =>
  FactoryItemKey.make(`github:${from}#${issueNumber}`);
const reportedAt = "2026-10-30T00:00:00.000Z";
const base = "ba5e000000000000000000000000000000000145";
const head = "4ead000000000000000000000000000000000145";
const merge = "3e70000000000000000000000000000000000145";
const tree = "7ee0000000000000000000000000000000000145";

const layerTest = Layer.mergeAll(
  FactoryOutcomeStore.layer,
  FactoryStore.layer,
  FactoryOperationStore.layer,
).pipe(
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

type Report = FactoryOutcomeStore.FactoryOutcome["report"];

const verified = (
  outcomeId: string,
  itemKey: FactoryItemKey,
  stage: FactoryOutcomeStore.FactoryOutcome["stage"],
  report: Report,
  origin: FactoryOutcomeStore.FactoryOutcome["origin"] = { type: "native" },
) =>
  Effect.gen(function* () {
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    yield* outcomes.insertReported({
      outcomeId,
      factoryId,
      itemKey,
      origin,
      stage,
      report,
      reportDigest: outcomeId,
      reportedAt,
      state: "reported",
    });
    yield* outcomes.markVerified({ outcomeId, receipt: { verifiedAt: reportedAt } });
  });

const integration = { targetBranch: "main", mergeCommit: merge, parents: [base, head], tree };

/** T3's own integration operation for `itemKey`, ended with `receipt` as its readback proved. */
const integrationOperation = (
  operationId: string,
  itemKey: FactoryItemKey,
  receipt: Partial<{ commit: string; tree: string; parents: ReadonlyArray<string> }> = {},
  reviewedHead = head,
) =>
  Effect.gen(function* () {
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    yield* operations.intend({
      operationId,
      factoryId,
      itemKey,
      intent: {
        kind: "git_integrate",
        projectId: ProjectId.make("project-btc"),
        branch: "main",
        remote: null,
        expected: base,
        reviewedHead,
        mode: "merge",
        marker: `T3-Factory-Operation: ${operationId}`,
        message: "Integrate",
        identity: { name: "T3", email: "t3@example.invalid" },
      },
    });
    yield* operations.complete({
      operationId,
      completion: {
        state: "applied",
        receipt: {
          kind: "git_integrate",
          branch: "main",
          commit: receipt.commit ?? merge,
          parents: receipt.parents ?? [base, head],
          tree: receipt.tree ?? tree,
          attribution: "operation",
        },
      },
    });
  });

/** A correction child that was built, independently reviewed and landed by `operationId`. */
const landedChild = (issueNumber: number, operationId: string) =>
  Effect.gen(function* () {
    const child = keyOf(issueNumber);
    yield* verified(`${issueNumber}-implement`, child, "implement", {
      outcome: "implemented",
      subject: { repository, baseCommit: base, headCommit: head },
      summary: "Built.",
    });
    yield* verified(`${issueNumber}-review`, child, "review", {
      outcome: "review_passed",
      subject: { repository, headCommit: head },
      summary: "Reviewed.",
    });
    yield* verified(
      `native:${operationId}`,
      child,
      "integrate",
      {
        outcome: "integrated",
        summary: "Landed.",
        integration: { ...integration, attribution: "operation" },
      },
      { type: "native", operationId },
    );
    return child;
  });

const reads = Effect.gen(function* () {
  return {
    outcomeStore: yield* FactoryOutcomeStore.FactoryOutcomeStore,
    store: yield* FactoryStore.FactoryStore,
    operations: yield* FactoryOperationStore.FactoryOperationStore,
  };
});

const blockedBy = (numbers: ReadonlyArray<number>): TrackerIssue => ({
  state: "open",
  title: "Rerun the verification",
  body: "",
  labels: [],
  comments: [],
  blockedBy: numbers.map((number) => ({ repository, number, state: "closed" as const })),
});

const originsOf = (blockers: {
  readonly blockers?: ReadonlyArray<FactoryLifecycle.FactoryPolicyItemFacts>;
}) =>
  (blockers.blockers ?? []).map((blocker) =>
    blocker.outcomes.flatMap((outcome) =>
      outcome.landingOrigin === undefined ? [] : [outcome.landingOrigin.operationId],
    ),
  );

it.effect(
  "Coordination/landing: only an integration its own applied receipt and an accepted review back carries an origin",
  () =>
    Effect.gen(function* () {
      // A real landing: receipt equals the report, and it merged the independently reviewed head.
      yield* landedChild(145, "integrate:145");
      yield* integrationOperation("integrate:145", keyOf(145));
      // The report claims a tree the receipt did not record: a stale or remote readback.
      yield* landedChild(146, "integrate:146");
      yield* integrationOperation("integrate:146", keyOf(146), {
        tree: "7ee0000000000000000000000000000000000999",
      });
      // The operation merged a head no review of this item passed.
      yield* landedChild(147, "integrate:147");
      yield* integrationOperation(
        "integrate:147",
        keyOf(147),
        {},
        "4ead000000000000000000000000000000000999",
      );
      // An operation recorded for another item.
      yield* landedChild(148, "integrate:148");
      yield* integrationOperation("integrate:148", keyOf(999));
      // Integrated as reported, but no operation was ever recorded.
      yield* landedChild(149, "integrate:149");
      // Reviewed only: accepted but not landed.
      yield* verified("150-implement", keyOf(150), "implement", {
        outcome: "implemented",
        subject: { repository, baseCommit: base, headCommit: head },
        summary: "Built.",
      });
      yield* verified("150-review", keyOf(150), "review", {
        outcome: "review_passed",
        subject: { repository, headCommit: head },
        summary: "Reviewed.",
      });

      const facts = yield* FactoryLifecycle.policyBlockers(yield* reads, {
        factoryId,
        repository,
        issue: blockedBy([145, 146, 147, 148, 149, 150]),
        read: new Map(),
      });
      assert.deepStrictEqual(originsOf(facts), [["integrate:145"], [], [], [], [], []]);

      // The owner rejects the review the landing rests on: it no longer carries an origin.
      const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
      assert.isTrue(
        yield* outcomes.rejectVerified({
          outcomeId: "145-review",
          failureDigest: "owner-refused",
          by: "owner",
          reason: "Acceptance invalid.",
        }),
      );
      const after = yield* FactoryLifecycle.policyBlockers(yield* reads, {
        factoryId,
        repository,
        issue: blockedBy([145]),
        read: new Map(),
      });
      assert.deepStrictEqual(originsOf(after), [[]]);
      // The rejection stays visible as recorded.
      assert.deepStrictEqual(after.blockers?.[0]?.events, [
        { type: "rejected", outcomeId: "145-review", failureDigest: "owner-refused" },
      ]);

      // Without the operation store, nothing carries an origin (blocker reads elsewhere).
      const { outcomeStore, store } = yield* reads;
      const bare = yield* FactoryLifecycle.policyBlockers(
        { outcomeStore, store },
        { factoryId, repository, issue: blockedBy([145]), read: new Map() },
      );
      assert.deepStrictEqual(originsOf(bare), [[]]);
    }).pipe(Effect.provide(layerTest)),
);

const parentIssue = (subIssueCount: number | undefined): TrackerIssue => ({
  state: "open",
  title: "Parent",
  body: "criteria",
  labels: [],
  comments: [],
  blockedBy: [],
  ...(subIssueCount === undefined ? {} : { subIssueCount }),
});

it.effect(
  "Coordination/children: a parent's whole membership carries each child's outcomes; anything less is unread",
  () =>
    Effect.gen(function* () {
      yield* landedChild(160, "integrate:160");
      yield* integrationOperation("integrate:160", keyOf(160));
      // A child closed after a reopen of its closure, open children and a child never started.
      yield* verified("161-close", keyOf(161), "close", { outcome: "closed", summary: "Closed." });
      const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
      const childrenOf = (
        membership: Parameters<typeof FactoryLifecycle.policyChildren>[1]["membership"],
        count: number | "absent" = 3,
      ) =>
        Effect.flatMap(reads, (stores) =>
          FactoryLifecycle.policyChildren(stores, {
            factoryId,
            repository,
            issue: parentIssue(count === "absent" ? undefined : count),
            membership,
            read: new Map(),
          }),
        );
      const whole = [
        { repository, number: 160, state: "closed" as const },
        { repository, number: 161, state: "open" as const },
        { repository, number: 162, state: "open" as const },
      ];
      const complete = yield* childrenOf(whole);
      assert.isUndefined(complete.childrenUnread);
      assert.deepStrictEqual(
        complete.children?.map((child) => [
          child.itemKey,
          child.state,
          child.outcomes.map((outcome) => [outcome.outcomeId, outcome.landingOrigin?.operationId]),
        ]),
        [
          [
            keyOf(160),
            "closed",
            [
              ["160-implement", undefined],
              ["160-review", undefined],
              ["native:integrate:160", "integrate:160"],
            ],
          ],
          [keyOf(161), "open", [["161-close", undefined]]],
          [keyOf(162), "open", []],
        ],
      );

      // A reopen of a child's closure reaches the parent as recorded.
      yield* outcomes.recordReopen({
        factoryId,
        itemKey: keyOf(161),
        closureOutcomeId: "161-close",
        observationId: 1,
      });
      const reopened = yield* childrenOf(whole);
      assert.deepStrictEqual(reopened.children?.[1]?.events, [
        { type: "reopened", closureOutcomeId: "161-close" },
      ]);

      // Lost or partial membership is never an empty or complete list.
      assert.deepStrictEqual(yield* childrenOf({ unread: "tracker read failed" }), {
        childrenUnread: { reason: "tracker read failed", foreign: [] },
      });
      const partial = yield* childrenOf(whole.slice(0, 2));
      assert.isUndefined(partial.children);
      assert.include(partial.childrenUnread?.reason ?? "", "counts 3");
      const foreign = yield* childrenOf([
        ...whole.slice(0, 2),
        { repository: "example-org/other", number: 7, state: "closed" },
      ]);
      assert.isUndefined(foreign.children);
      assert.deepStrictEqual(foreign.childrenUnread?.foreign, [keyOf(7, "example-org/other")]);
      // Not a parent: nothing is said.
      assert.deepStrictEqual(yield* childrenOf([], 0), {});
      assert.deepStrictEqual(yield* childrenOf([], "absent"), {});
    }).pipe(Effect.provide(layerTest)),
);
