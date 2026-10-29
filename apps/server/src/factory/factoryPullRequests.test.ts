import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as FactoryIntegrator from "./FactoryIntegrator.ts";
import { isCorrectable } from "./factoryNativeStages.ts";
import {
  ACKNOWLEDGEMENT_MARKER,
  attemptPullRequestMerge,
  isMergedElsewhere,
  MERGED_ELSEWHERE,
  pullRequestStep,
  type PullRequestFacts,
} from "./factoryPullRequests.ts";
import type * as FactoryTracker from "./FactoryTracker.ts";

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

// Sibling heads off one parent: the pull request merged one, the review passed the other.
const mergedHead = "b".repeat(40);
const siblingHead = "a".repeat(40);
const mergeCommit = "e".repeat(40);
const mergedElsewhere = open({
  state: "closed",
  merged: true,
  mergeCommit,
  headSha: mergedHead,
});

it("PR integration: a pull request merged at another head is its own failure, never a landing", () => {
  const step = pullRequestStep(mergedElsewhere, siblingHead, undefined);
  assert.deepStrictEqual(step, {
    type: "fail",
    reason: `${MERGED_ELSEWHERE} pull request #41 merged at ${mergedHead} as ${mergeCommit}, not the reviewed head ${siblingHead}`,
  });
  assert.isTrue(isMergedElsewhere((step as { readonly reason: string }).reason));
  // The same facts read again are the same failure.
  assert.deepStrictEqual(pullRequestStep(mergedElsewhere, siblingHead, undefined), step);
  // Only a review of exactly the merged head records it, as that review's landing.
  assert.deepStrictEqual(pullRequestStep(mergedElsewhere, mergedHead, undefined), {
    type: "landed",
    commit: mergeCommit,
  });
});

it("PR integration: a retained merged-elsewhere record is recognized exactly", () => {
  assert.isTrue(
    isMergedElsewhere(
      `configuration: pull request #41 merged at ${mergedHead}, not the reviewed head ${siblingHead}`,
    ),
  );
  for (const other of [
    "configuration: the project no longer exists",
    "configuration: the factory has no tracker",
    `configuration: pull request #41 merged at ${mergedHead.slice(0, 12)}, not the reviewed head ${siblingHead}`,
    `configuration: pull request #41 merged at ${mergedHead}, not the reviewed head ${siblingHead} (edited)`,
    `refused: pull request #41 was closed without merging`,
    // Equal heads in the old wording: a merge GitHub reported without its commit.
    `configuration: pull request #41 merged at ${mergedHead}, not the reviewed head ${mergedHead}`,
  ]) {
    assert.isFalse(isMergedElsewhere(other), other);
    assert.isFalse(isCorrectable(other), other);
  }
});

it("PR integration: only the work can answer a merge at another head; a missing merge commit stays refused", () => {
  const elsewhere = pullRequestStep(mergedElsewhere, siblingHead, undefined);
  assert.isTrue(isCorrectable((elsewhere as { readonly reason: string }).reason));
  assert.isTrue(
    isCorrectable(
      `configuration: pull request #41 merged at ${mergedHead}, not the reviewed head ${siblingHead}`,
    ),
  );
  const withoutCommit = pullRequestStep(
    { ...mergedElsewhere, mergeCommit: null },
    mergedHead,
    undefined,
  );
  assert.strictEqual(withoutCommit.type, "fail");
  const reason = (withoutCommit as { readonly reason: string }).reason;
  assert.isTrue(reason.startsWith("configuration:"));
  assert.isFalse(isCorrectable(reason));
});

const repository = "example-org/example-project";
const intent = (reviewedHead: string) =>
  ({
    kind: "pull_request_merge",
    projectId: "project-example",
    repository,
    remote: "origin",
    base: "main",
    head: "factory/41-example",
    reviewedHead,
    method: "merge",
    marker: "T3-Factory-Operation: integrate:example",
    title: "Example",
    body: "Refs #41",
    acceptanceStatus: { context: "example/acceptance", description: "accepted" },
  }) as Parameters<typeof attemptPullRequestMerge>[2]["intent"];

/** A pull request someone else already merged; every write is recorded so none may happen. */
const mergedSession = (writes: Array<string>) => {
  const write = (name: string) => () => {
    writes.push(name);
    return Effect.die(`${name} must not run for a merged pull request`);
  };
  const session: Pick<
    FactoryTracker.TrackerSession,
    | "findPullRequest"
    | "readPullRequest"
    | "readCommit"
    | "createPullRequest"
    | "markReadyForReview"
    | "mergePullRequest"
    | "ensureSuccessStatus"
    | "readChecks"
    | "readReviewFindings"
  > = {
    findPullRequest: () => Effect.succeedSome(mergedElsewhere),
    readPullRequest: () => Effect.succeed(mergedElsewhere),
    readCommit: ({ sha }) =>
      sha === mergeCommit
        ? Effect.succeed({
            parents: ["d".repeat(40), mergedHead],
            tree: "f".repeat(40),
            message: "Merge pull request #41",
          })
        : Effect.die(`no commit ${sha}`),
    createPullRequest: write("createPullRequest"),
    markReadyForReview: write("markReadyForReview"),
    mergePullRequest: write("mergePullRequest"),
    ensureSuccessStatus: write("ensureSuccessStatus"),
    readChecks: write("readChecks"),
    readReviewFindings: write("readReviewFindings"),
  };
  const integrator: Pick<FactoryIntegrator.FactoryIntegratorShape, "publish"> = {
    publish: write("publish"),
  };
  return {
    session: session as FactoryTracker.TrackerSession,
    integrator: integrator as FactoryIntegrator.FactoryIntegratorShape,
  };
};

it.effect(
  "PR integration: repeated attempts on a pull request merged elsewhere write nothing",
  () =>
    Effect.gen(function* () {
      const writes: Array<string> = [];
      const { session, integrator } = mergedSession(writes);
      const attempt = (reviewedHead: string) =>
        attemptPullRequestMerge(session, integrator, {
          cwd: "/unused",
          intent: intent(reviewedHead),
        });
      const sibling = yield* attempt(siblingHead);
      assert.deepStrictEqual(yield* attempt(siblingHead), sibling);
      assert.strictEqual(sibling.state, "failed");
      assert.isTrue(isMergedElsewhere((sibling as { readonly reason: string }).reason));
      // A later review of exactly the merged head reads the existing merge back, as someone else's.
      const exact = yield* attempt(mergedHead);
      assert.deepStrictEqual(yield* attempt(mergedHead), exact);
      assert.deepStrictEqual(exact, {
        state: "applied",
        receipt: {
          kind: "pull_request_merge",
          repository,
          number: 41,
          branch: "main",
          commit: mergeCommit,
          parents: ["d".repeat(40), mergedHead],
          tree: "f".repeat(40),
          attribution: "external",
        },
      });
      assert.deepStrictEqual(writes, []);
    }),
);

it.effect(
  "PR integration: a head already in the base lands without a pull request, never over a merged one",
  () =>
    Effect.gen(function* () {
      const writes: Array<string> = [];
      const merged = mergedSession(writes);
      // The fetched base contains the head, even at exactly its tip; this operation wrote none of it.
      const integrator: FactoryIntegrator.FactoryIntegratorShape = {
        ...merged.integrator,
        landed: ({ reviewedHead }) =>
          Effect.succeedSome({
            commit: reviewedHead,
            parents: ["d".repeat(40)],
            tree: "f".repeat(40),
            attribution: "operation",
          }),
      };
      const elsewhere = yield* attemptPullRequestMerge(merged.session, integrator, {
        cwd: "/unused",
        intent: intent(siblingHead),
      });
      assert.isTrue(elsewhere.state === "failed" && isMergedElsewhere(elsewhere.reason));
      const session = {
        ...merged.session,
        findPullRequest: () => Effect.succeedNone,
      } as FactoryTracker.TrackerSession;
      assert.deepStrictEqual(
        yield* attemptPullRequestMerge(session, integrator, {
          cwd: "/unused",
          intent: intent(siblingHead),
        }),
        {
          state: "applied",
          receipt: {
            kind: "git_integrate",
            branch: "main",
            commit: siblingHead,
            parents: ["d".repeat(40)],
            tree: "f".repeat(40),
            attribution: "external",
          },
        },
      );
      assert.deepStrictEqual(writes, []);
    }),
);

/** A remote that records every write; its base holds the reviewed head only when `contains`. */
const recordingRemote = (state: {
  readonly pull?: PullRequestFacts | undefined;
  readonly contains: boolean;
  readonly tip: string | null;
}) => {
  const writes: Array<string> = [];
  let pull = state.pull;
  const session: Pick<
    FactoryTracker.TrackerSession,
    | "findPullRequest"
    | "readPullRequest"
    | "readCommit"
    | "createPullRequest"
    | "markReadyForReview"
    | "mergePullRequest"
    | "ensureSuccessStatus"
    | "readChecks"
    | "readReviewFindings"
  > = {
    findPullRequest: () => Effect.sync(() => Option.fromNullishOr(pull)),
    readPullRequest: () => Effect.sync(() => pull!),
    readCommit: () => Effect.die("no pull request here was merged"),
    createPullRequest: () =>
      Effect.sync(() => {
        writes.push("create");
        pull = open({ mergeableState: "blocked" });
        return { type: "written" as const, number: pull.number };
      }),
    markReadyForReview: () => Effect.sync(() => void writes.push("ready")),
    mergePullRequest: () =>
      Effect.sync(() => {
        writes.push("merge");
        return { type: "refused" as const, status: 405 };
      }),
    ensureSuccessStatus: () =>
      Effect.sync(() => {
        writes.push("status");
        return true;
      }),
    readChecks: () => Effect.succeed({ pending: ["ci / test"], failed: [] }),
    readReviewFindings: () => Effect.succeedNone,
  };
  const integrator: Pick<FactoryIntegrator.FactoryIntegratorShape, "tip" | "landed" | "publish"> = {
    tip: () => Effect.succeed(state.tip),
    landed: ({ reviewedHead }) =>
      state.contains
        ? Effect.succeedSome({
            commit: reviewedHead,
            parents: ["d".repeat(40)],
            tree: "f".repeat(40),
            attribution: "operation" as const,
          })
        : Effect.succeedNone,
    publish: () =>
      Effect.sync(() => {
        writes.push("publish");
        return { type: "published" as const };
      }),
  };
  const attempt = (marker: string) =>
    attemptPullRequestMerge(
      session as FactoryTracker.TrackerSession,
      integrator as FactoryIntegrator.FactoryIntegratorShape,
      { cwd: "/unused", intent: { ...intent(reviewed), marker } },
    );
  return { writes, attempt };
};
const ordinary = "T3-Factory-Operation: integrate:example";
const acknowledgement = `${ACKNOWLEDGEMENT_MARKER}integrate:example`;

it.effect(
  "PR integration: a missing base holds an ordinary attempt before anything is published",
  () =>
    Effect.gen(function* () {
      const remote = recordingRemote({ contains: false, tip: null });
      assert.deepStrictEqual(yield* remote.attempt(ordinary), {
        state: "waiting",
        reason: "integration target main does not exist on origin; nothing was published",
      });
      assert.deepStrictEqual(remote.writes, []);
    }),
);

it.effect("PR integration: an acknowledgement attempt only reads, whatever it finds", () =>
  Effect.gen(function* () {
    const waiting = {
      state: "waiting" as const,
      reason: `main on origin does not contain the reviewed head ${reviewed}; nothing was published`,
    };
    for (const state of [
      { contains: false, tip: "b".repeat(40) },
      { contains: false, tip: null },
      { pull: open(), contains: false, tip: "b".repeat(40) },
      {
        pull: open({ mergeableState: "blocked", draft: true }),
        contains: false,
        tip: "b".repeat(40),
      },
      { pull: open({ state: "closed" }), contains: false, tip: "b".repeat(40) },
    ]) {
      const remote = recordingRemote(state);
      assert.deepStrictEqual(yield* remote.attempt(acknowledgement), waiting);
      assert.deepStrictEqual(remote.writes, []);
    }
  }),
);

it.effect(
  "PR integration: an acknowledgement attempt lands a contained head as someone else's",
  () =>
    Effect.gen(function* () {
      for (const pull of [undefined, open()]) {
        const remote = recordingRemote({ pull, contains: true, tip: reviewed });
        assert.deepStrictEqual(yield* remote.attempt(acknowledgement), {
          state: "applied",
          receipt: {
            kind: "git_integrate",
            branch: "main",
            commit: reviewed,
            parents: ["d".repeat(40)],
            tree: "f".repeat(40),
            attribution: "external",
          },
        });
        assert.deepStrictEqual(remote.writes, []);
      }
    }),
);

it.effect(
  "PR integration: an ordinary attempt on a base without the head publishes and opens it",
  () =>
    Effect.gen(function* () {
      const remote = recordingRemote({ contains: false, tip: "b".repeat(40) });
      assert.deepStrictEqual(yield* remote.attempt(ordinary), {
        state: "waiting",
        reason: "pull request #41 awaits checks: ci / test",
      });
      assert.deepStrictEqual(remote.writes, ["publish", "create", "status"]);
    }),
);
