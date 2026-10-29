import { assert, it } from "@effect/vitest";
import { FactoryPoolId } from "@t3tools/contracts";

import {
  isEligible,
  issueObservation,
  mayBeReadyOrClaimed,
  type TrackerIssue,
} from "./factoryClaimPolicy.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const claim: FactoryStore.FactoryClaimConfig = {
  host: "github.com",
  accountId: "9001",
  eligibilityLabel: "ready",
  foreignClaimLabels: ["claimed"],
  foreignClaimCommentPatterns: ["^Claimed issue-"],
  observedClaimPool: { poolId: FactoryPoolId.make("builders"), units: 1 },
};
const subject = { tracker: "github", repository: "example-org/alpha", issueNumber: 74 } as const;
const issue: TrackerIssue = {
  state: "open",
  title: "Intake dates",
  body: "Parse intake dates.",
  labels: ["ready"],
  comments: [],
};

const evidenceOf = (
  comments: TrackerIssue["comments"],
  isBookkeeping?: (comment: TrackerIssue["comments"][number]) => boolean,
) =>
  issueObservation({
    issue: { ...issue, comments },
    subject,
    claim,
    ...(isBookkeeping === undefined ? {} : { isBookkeeping }),
  }).evidence;

it("N03: only records native writes prove are T3's leave the basis alone", () => {
  const base = evidenceOf([]);
  const report = {
    id: 1,
    body: "<!-- t3-factory-report:abc --> Review outcome.",
    authorId: "9001",
  };
  const decision = { id: 2, body: "<!-- t3-factory-decision:def --> Waiting.", authorId: "9001" };
  // Records T3's own write receipts name are bookkeeping.
  const written = new Set([report.id, decision.id]);
  const native = (comment: { readonly id: number }) => written.has(comment.id);
  assert.deepStrictEqual(evidenceOf([report, decision], native), base);
  // The factory's account alone is not proof: the same account's other comment is evidence.
  const sameAccount = { id: 3, body: "Scope now includes exports.", authorId: "9001" };
  assert.notDeepEqual(evidenceOf([report, sameAccount], native), evidenceOf([report], native));
  // A marker in someone else's comment does not make it bookkeeping either.
  const owner = evidenceOf([{ id: 4, body: report.body, authorId: "42" }], native);
  assert.notDeepEqual(owner, base);
  const edited = evidenceOf(
    [{ id: 4, body: `${report.body} Use ISO dates.`, authorId: "42" }],
    native,
  );
  assert.notDeepEqual(edited, owner);
});

it("alpha readiness: without an eligibility label, an open unclaimed issue goes to its policy", () => {
  const { eligibilityLabel: _ready, ...alphaClaim } = claim;
  const eligible = (candidate: TrackerIssue, config: FactoryStore.FactoryClaimConfig) =>
    isEligible(issueObservation({ issue: candidate, subject, claim: config }), candidate, config);
  // Readiness comes from policy when no eligibility label is configured.
  const correction: TrackerIssue = { ...issue, labels: ["effort:medium"] };
  assert.isTrue(eligible(correction, alphaClaim));
  // A project whose readiness is a label keeps requiring it.
  assert.isFalse(eligible(correction, claim));
  // Occupancy and closure still refuse without a label.
  const legacyClaim = {
    id: 9,
    body: "Claimed issue-75-rework-4: rework attempt 4 from synthetic commit 1111111.",
    authorId: "42",
  };
  assert.isFalse(eligible({ ...correction, comments: [legacyClaim] }, alphaClaim));
  assert.isFalse(eligible({ ...correction, labels: ["effort:medium", "claimed"] }, alphaClaim));
  assert.isFalse(eligible({ ...correction, state: "closed" }, alphaClaim));
});

it("beta readiness: an unready issue's legacy claim is still a claim, and only ready is eligible", () => {
  const betaClaim = { ...claim, foreignClaimCommentPatterns: ["<!-- example-claim "] };
  const observe = (candidate: TrackerIssue) =>
    issueObservation({ issue: candidate, subject, claim: betaClaim });
  // The synthetic foreign claim holds an item that is not ready.
  const held: TrackerIssue = {
    ...issue,
    labels: ["effort:high", "needs-owner"],
    comments: [
      {
        id: 901,
        body: "<!-- example-claim key=example-implement attempt=1 request=example-request-1 target=builder role=builder writes=src/example.ts resources=worker -->",
        authorId: "42",
      },
    ],
  };
  assert.strictEqual(observe(held).claims.length, 1);
  assert.isFalse(isEligible(observe(held), held, betaClaim));
  const unready: TrackerIssue = { ...issue, labels: ["effort:high", "needs-owner"] };
  assert.isFalse(isEligible(observe(unready), unready, betaClaim));
  assert.isTrue(isEligible(observe(issue), issue, betaClaim));
});

it("collection reads every listed issue that may be ready or claimed, and skips only the rest", () => {
  const betaClaim = { ...claim, foreignClaimCommentPatterns: ["<!-- example-claim "] };
  const { eligibilityLabel: _ready, ...alphaClaim } = claim;
  const read = (labels: ReadonlyArray<string> | undefined, comments: number | undefined) =>
    mayBeReadyOrClaimed({ labels, comments }, betaClaim);
  // Unready items can still carry foreign claims.
  assert.isTrue(read(["effort:high", "needs-owner"], 6));
  assert.isTrue(read(["blocked", "effort:high", "needs-owner"], 9));
  assert.isTrue(read(["effort:high", "claimed"], 0));
  assert.isTrue(read(["ready"], 0));
  assert.isTrue(read(undefined, 0));
  assert.isTrue(read(["needs-owner"], undefined));
  // Unready, with no comment and no claim label: nothing can hold it and it cannot start.
  assert.isFalse(read(["effort:high", "needs-owner"], 0));
  // A project whose policy decides readiness reads everything open.
  assert.isTrue(mayBeReadyOrClaimed({ labels: [], comments: 0 }, alphaClaim));
});
