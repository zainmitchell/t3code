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
  type PullRequestAttempt,
  type PullRequestCreateLedger,
  pullRequestStep,
  type PullRequestFacts,
  type PullRequestStep,
} from "./factoryPullRequests.ts";
import { renderWait, waitBasis } from "./factoryOperationWait.ts";
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

/** A wait as the factory's state shows it, without its basis facts. */
const shown = (step: PullRequestStep | PullRequestAttempt) => {
  const waiting =
    "type" in step
      ? step.type === "wait"
        ? step
        : undefined
      : step.state === "waiting"
        ? step
        : undefined;
  if (waiting === undefined) return assert.fail(`not a wait: ${JSON.stringify(step)}`);
  const { reason, wait } = waiting;
  return { reason, kind: wait.kind, actor: wait.actor, resume: wait.resume };
};

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
    shown(
      pullRequestStep(open({ mergeableState: "blocked" }), reviewed, {
        pending: ["ci / test"],
        failed: [],
      }),
    ),
    {
      reason: "pull request #41 awaits checks: ci / test",
      kind: "dependency",
      actor: "the required checks",
      resume: `the checks on ${reviewed} finish; a failure goes back to the work`,
    },
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

it("PR integration: a wait's basis is the facts it stands on, never their order or wording", () => {
  const blocked = open({ mergeableState: "blocked" });
  const basis = (step: PullRequestStep) => {
    assert.strictEqual(step.type, "wait");
    return step.type === "wait" ? waitBasis(step.wait) : "";
  };
  const checks = basis(pullRequestStep(blocked, reviewed, { pending: ["a", "b"], failed: [] }));
  assert.strictEqual(
    basis(pullRequestStep(blocked, reviewed, { pending: ["b", "a"], failed: [] })),
    checks,
  );
  // One check finished: a new wait. Approvals then wait on their own basis.
  assert.notStrictEqual(
    basis(pullRequestStep(blocked, reviewed, { pending: ["b"], failed: [] })),
    checks,
  );
  const approvals = basis(pullRequestStep(blocked, reviewed, noChecks));
  assert.notStrictEqual(approvals, checks);
  assert.strictEqual(basis(pullRequestStep(blocked, reviewed, noChecks)), approvals);
  // The same block on a successor head is a different wait; the old head's never stands for it.
  assert.notStrictEqual(
    basis(pullRequestStep({ ...blocked, headSha: "c0000003" }, "c0000003", noChecks)),
    approvals,
  );
  // A draft made ready at the same head and merge state now waits on someone else.
  const draft = basis(pullRequestStep({ ...blocked, draft: true }, reviewed, noChecks));
  assert.notStrictEqual(draft, approvals);
  assert.strictEqual(
    basis(pullRequestStep({ ...blocked, draft: true }, reviewed, noChecks)),
    draft,
  );
});

it("PR integration: a long list of checks never pushes who acts or the resume out of view", () => {
  const head = "a".repeat(40);
  const pending = Array.from({ length: 8 }, (_, i) => `required-ci-build-linux-x86_64-${i}`);
  const step = pullRequestStep(
    open({ number: 143, headSha: head, mergeableState: "blocked" }),
    head,
    { pending, failed: [] },
  );
  assert.strictEqual(step.type, "wait");
  if (step.type !== "wait") return;
  // FactoryLifecycle shows the first 500 characters of a waiting operation.
  const shown = renderWait(step.reason, step.wait).slice(0, 500);
  assert.include(shown, "who acts: the required checks");
  assert.match(shown, new RegExp(`action: finish 8 checks on ${head}`));
  assert.match(shown, new RegExp(`resumes when: the checks on ${head} finish`));
});

const credentialRemote = "https://x-access-token:SYNTHETIC_ONLY@example.invalid/repo.git";

it.effect(
  "PR integration: a credential in the remote's URL never reaches a recorded or shown wait",
  () =>
    Effect.gen(function* () {
      for (const tip of [null, "b".repeat(40)]) {
        const session = {
          findPullRequest: () => Effect.succeedNone,
        } as unknown as FactoryTracker.TrackerSession;
        const integrator = {
          landed: () => Effect.succeedNone,
          tip: () => Effect.succeed(tip),
          publish: () =>
            Effect.succeed({ type: "refused" as const, tip: null, detail: "remote: forbidden" }),
        } as unknown as FactoryIntegrator.FactoryIntegratorShape;
        const completion = yield* attemptPullRequestMerge(session, integrator, {
          cwd: "/unused",
          intent: { ...intent("a".repeat(40)), remote: credentialRemote },
          creates: ledger(),
        });
        assert.strictEqual(completion.state, "waiting");
        if (completion.state !== "waiting") return;
        const recorded = JSON.stringify(completion);
        const shown = renderWait(completion.reason, completion.wait);
        for (const text of [recorded, shown]) {
          assert.notInclude(text, "SYNTHETIC_ONLY");
          assert.include(text, "https://***@example.invalid/repo.git");
        }
      }
    }),
);

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
  assert.strictEqual(
    shown(
      pullRequestStep(
        examplePr,
        exampleHead,
        { pending: ["focused-checks"], failed: [] },
        exampleFindings,
      ),
    ).reason,
    "pull request #41 awaits checks: focused-checks",
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

/** An operation's create record kept in memory, as FactoryOperationStore keeps it on the record. */
const ledger = (unresolved = false): PullRequestCreateLedger => {
  let pending: { attempt: number; cleared?: string } | undefined;
  return {
    unresolved,
    record: Effect.sync(() => {
      if (pending !== undefined && pending.cleared === undefined) return Option.none();
      pending = { attempt: (pending?.attempt ?? 0) + 1 };
      return Option.some({ attempt: pending.attempt });
    }),
    clear: (attempt, by) =>
      Effect.sync(() => {
        if (pending?.attempt !== attempt || pending.cleared !== undefined) return false;
        pending.cleared = by;
        return true;
      }),
  };
};
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
          creates: ledger(),
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
        creates: ledger(),
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
          creates: ledger(),
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
  readonly checks?: { readonly pending: ReadonlyArray<string>; readonly failed: [] };
  /** `lost`: GitHub merges, and its answer never arrives. */
  readonly merge?: "refused" | "lost";
}) => {
  const writes: Array<string> = [];
  let pull = state.pull;
  let merged = "";
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
    readCommit: ({ sha }) =>
      sha === mergeCommit
        ? Effect.succeed({ parents: [state.tip!, reviewed], tree: "f".repeat(40), message: merged })
        : Effect.die("no pull request here was merged"),
    createPullRequest: () =>
      Effect.sync(() => {
        writes.push("create");
        pull = open({ mergeableState: "blocked" });
        return { type: "written" as const, number: pull.number };
      }),
    markReadyForReview: () => Effect.sync(() => void writes.push("ready")),
    mergePullRequest: ({ message }) =>
      Effect.sync((): FactoryTracker.MergeOutcome => {
        writes.push("merge");
        if (state.merge !== "lost") return { type: "refused", status: 405 };
        merged = message;
        pull = { ...pull!, state: "closed", merged: true, mergeCommit };
        return { type: "ambiguous", cause: "GitHubApiRequestError" };
      }),
    ensureSuccessStatus: () =>
      Effect.sync(() => {
        writes.push("status");
        return true;
      }),
    readChecks: () => Effect.succeed(state.checks ?? { pending: ["ci / test"], failed: [] }),
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
  const attempt = (marker: string, creates = ledger()) =>
    attemptPullRequestMerge(
      session as FactoryTracker.TrackerSession,
      integrator as FactoryIntegrator.FactoryIntegratorShape,
      { cwd: "/unused", intent: { ...intent(reviewed), marker }, creates },
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
      assert.deepStrictEqual(shown(yield* remote.attempt(ordinary)), {
        reason: "integration target main does not exist on origin; nothing was published",
        kind: "dependency",
        actor: `the owner of ${repository}`,
        resume: "main exists on origin",
      });
      assert.deepStrictEqual(remote.writes, []);
    }),
);

it.effect("PR integration: an acknowledgement attempt only reads, whatever it finds", () =>
  Effect.gen(function* () {
    const waiting = {
      reason: `main on origin does not contain the reviewed head ${reviewed}; nothing was published`,
      kind: "dependency",
      actor: "the maintainers of main on origin",
      resume: `main on origin contains ${reviewed}`,
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
      assert.deepStrictEqual(shown(yield* remote.attempt(acknowledgement)), waiting);
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
      assert.strictEqual(
        shown(yield* remote.attempt(ordinary)).reason,
        "pull request #41 awaits checks: ci / test",
      );
      assert.deepStrictEqual(remote.writes, ["publish", "create", "status"]);
    }),
);

it.effect(
  "PR integration: a refused merge waits on who can allow it; a lost answer is read back, never resent",
  () =>
    Effect.gen(function* () {
      const mergeable = open({ mergeableState: "clean" });
      const refused = recordingRemote({ pull: mergeable, contains: false, tip: "b".repeat(40) });
      assert.deepStrictEqual(shown(yield* refused.attempt(ordinary)), {
        reason: "GitHub refused the merge of pull request #41 (405)",
        kind: "dependency",
        actor: `the administrators of ${repository} and its protection on main`,
        resume: "GitHub accepts the merge; each attempt reads pull request #41 first",
      });
      const lost = recordingRemote({
        pull: mergeable,
        contains: false,
        tip: "b".repeat(40),
        merge: "lost",
      });
      // The readback right after the lost answer already shows the merge: it lands, once.
      const landed = yield* lost.attempt(ordinary);
      assert.deepStrictEqual(landed, {
        state: "applied",
        receipt: {
          kind: "pull_request_merge",
          repository,
          number: 41,
          branch: "main",
          commit: mergeCommit,
          parents: ["b".repeat(40), reviewed],
          tree: "f".repeat(40),
          attribution: "operation",
        },
      });
      assert.deepStrictEqual(yield* lost.attempt(ordinary), landed);
      assert.deepStrictEqual(lost.writes, ["publish", "status", "merge"]);
    }),
);

it.effect(
  "PR integration: an unresolved earlier create only reads back, whatever a later answer would say",
  () =>
    Effect.gen(function* () {
      const remote = recordingRemote({ contains: false, tip: "b".repeat(40) });
      const waiting = yield* remote.attempt(ordinary, ledger(true));
      assert.deepStrictEqual(shown(waiting), {
        reason:
          "a create of the pull request from factory/41-example into main may have applied, and GitHub lists none yet; no other create is sent",
        kind: "uncertain",
        actor: `GitHub's pull request listing, or the owner of ${repository}`,
        resume: "GitHub lists a pull request from factory/41-example into main",
      });
      assert.deepStrictEqual(remote.writes, ["publish"]);
      // Once the pull request is listed, the unresolved create is moot and the attempt goes on.
      const listed = recordingRemote({
        pull: open({ mergeableState: "blocked" }),
        contains: false,
        tip: "b".repeat(40),
      });
      assert.strictEqual(
        shown(yield* listed.attempt(ordinary, ledger(true))).reason,
        "pull request #41 awaits checks: ci / test",
      );
      assert.deepStrictEqual(listed.writes, ["publish", "status"]);
    }),
);
