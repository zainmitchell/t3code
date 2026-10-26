import { assert, it } from "@effect/vitest";

import { isCorrectable } from "./factoryNativeStages.ts";
import { pullRequestStep, type PullRequestFacts } from "./factoryPullRequests.ts";

const reviewed = "c0000002";
const open = (overrides: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
  number: 41,
  state: "open",
  merged: false,
  mergeCommit: null,
  headSha: reviewed,
  draft: false,
  nodeId: null,
  mergeableState: "clean",
  ...overrides,
});
const noChecks = { pending: [], failed: [] };

it("PR integration: GitHub's own gates decide between merging, waiting and correcting", () => {
  assert.deepStrictEqual(pullRequestStep(open(), reviewed, undefined), { type: "merge" });
  // Failing checks GitHub does not require leave the pull request mergeable.
  assert.deepStrictEqual(
    pullRequestStep(open({ mergeableState: "unstable" }), reviewed, undefined),
    {
      type: "merge",
    },
  );
  assert.deepStrictEqual(
    pullRequestStep(open({ mergeableState: "blocked" }), reviewed, {
      pending: ["ci / test"],
      failed: [],
    }),
    { type: "wait", reason: "pull request #41 awaits checks: ci / test" },
  );
  assert.deepStrictEqual(
    pullRequestStep(open({ mergeableState: "blocked" }), reviewed, {
      pending: ["ci / lint"],
      failed: ["ci / test"],
    }),
    { type: "fail", reason: "checks_failed: ci / test" },
  );
  assert.strictEqual(
    pullRequestStep(open({ mergeableState: "blocked" }), reviewed, noChecks).type,
    "wait",
  );
  assert.strictEqual(
    pullRequestStep(open({ mergeableState: "dirty" }), reviewed, undefined).type,
    "fail",
  );
  assert.isTrue(
    (
      pullRequestStep(open({ mergeableState: "behind" }), reviewed, undefined) as {
        readonly reason: string;
      }
    ).reason.startsWith("not_fast_forward:"),
  );
  // GitHub has not computed it yet, or someone drafted it: nothing is decided either way.
  for (const pending of [open({ mergeableState: null }), open({ draft: true })]) {
    assert.strictEqual(pullRequestStep(pending, reviewed, undefined).type, "wait");
  }
});

it("PR integration: only the reviewed head merged by its pull request counts as landed", () => {
  assert.deepStrictEqual(
    pullRequestStep(
      open({ state: "closed", merged: true, mergeCommit: "m0000001" }),
      reviewed,
      undefined,
    ),
    { type: "landed", commit: "m0000001" },
  );
  // Merged at a head nobody reviewed: never recorded as this review's integration.
  assert.strictEqual(
    pullRequestStep(
      open({ state: "closed", merged: true, mergeCommit: "m0000002", headSha: "c0000009" }),
      reviewed,
      undefined,
    ).type,
    "fail",
  );
  assert.strictEqual(pullRequestStep(open({ state: "closed" }), reviewed, undefined).type, "fail");
  // A head GitHub has not caught up with yet is never merged on the reviewed sha's behalf.
  assert.strictEqual(
    pullRequestStep(open({ headSha: "c0000001" }), reviewed, undefined).type,
    "wait",
  );
});

const exampleHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const examplePr = open({ number: 41, headSha: exampleHead, mergeableState: "blocked" });
const reviewerRequest = {
  id: "review-example-1",
  author: "example-reviewer",
  commit: exampleHead,
  body: "**Actionable comments posted: 1**",
  url: "https://github.com/example-org/example-project/pull/41#pullrequestreview-1",
};
const retryThread = {
  id: "thread-example-1",
  outdated: false,
  path: "tests/review-fixture.test.ts",
  line: 27,
  author: "example-reviewer",
  body: "<!-- synthetic-review -->\n\n<details>\n<summary>Tool output</summary>\nScript executed: inspect synthetic fixture\n</details>\n\n**Compare complete fixture values.**\n\nMatching identifiers alone do not detect changed values.",
  url: "https://github.com/example-org/example-project/pull/41#discussion_r1",
};
const exampleFindings = {
  headSha: exampleHead,
  changesRequested: [reviewerRequest],
  unresolvedThreads: [retryThread],
};

it("PR integration: changes requested on exactly the reviewed head go back to the work", () => {
  const step = pullRequestStep(examplePr, exampleHead, noChecks, exampleFindings);
  assert.strictEqual(step.type, "fail");
  const { reason } = step as { readonly reason: string };
  assert.isTrue(isCorrectable(reason));
  assert.isTrue(reason.startsWith(`review_changes_requested: pull request #41 at ${exampleHead}`));
  // The finding itself, not GitHub's markup, is what the correction reads.
  assert.include(reason, "thread-example-1");
  assert.include(reason, "review-fixture.test.ts:27");
  assert.include(reason, "Compare complete fixture values.");
  assert.notInclude(reason, "synthetic-review");
  assert.notInclude(reason, "Script executed");
  // The same facts in any order are the same failure, so its correction is decided once.
  const reordered = pullRequestStep(examplePr, exampleHead, noChecks, {
    ...exampleFindings,
    unresolvedThreads: [{ ...retryThread, id: "thread-obsolete", outdated: true }, retryThread],
  });
  assert.deepStrictEqual(reordered, step);
});

it("PR integration: a block without a current request for changes keeps waiting for people", () => {
  const step = (findings: Parameters<typeof pullRequestStep>[3], pull = examplePr) =>
    pullRequestStep(pull, exampleHead, noChecks, findings).type;
  // A request on an earlier head is stale: the rework answered it, or a person must.
  assert.strictEqual(
    step({ ...exampleFindings, changesRequested: [{ ...reviewerRequest, commit: "c0000001" }] }),
    "wait",
  );
  assert.strictEqual(
    step({ ...exampleFindings, changesRequested: [{ ...reviewerRequest, commit: null }] }),
    "wait",
  );
  // An open conversation or a missing approval alone is no verdict on the work.
  assert.strictEqual(step({ ...exampleFindings, changesRequested: [] }), "wait");
  // A review answer about another head than the one this integration merges.
  assert.strictEqual(step({ ...exampleFindings, headSha: "c0000009" }), "wait");
  // Unreadable or partial review facts decide nothing.
  assert.strictEqual(step(undefined), "wait");
  // Checks still explain a block first.
  assert.deepStrictEqual(
    pullRequestStep(
      examplePr,
      exampleHead,
      { pending: ["focused-checks"], failed: [] },
      exampleFindings,
    ),
    { type: "wait", reason: "pull request #41 awaits checks: focused-checks" },
  );
  // A pull request GitHub would merge is merged, whatever was said on it.
  assert.strictEqual(step(exampleFindings, { ...examplePr, mergeableState: "clean" }), "merge");
});
