import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as FactoryIntegrator from "./FactoryIntegrator.ts";
import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import type * as FactoryTracker from "./FactoryTracker.ts";

export type PullRequestFacts = FactoryTracker.TrackerPullRequest;

export type PullRequestStep =
  | { readonly type: "landed"; readonly commit: string }
  | { readonly type: "merge" }
  /** Nothing is decided yet; the next attempt reads the pull request again. */
  | { readonly type: "wait"; readonly reason: string }
  | { readonly type: "fail"; readonly reason: string };

export const REVIEW_CHANGES_REQUESTED = "review_changes_requested:";

export const MERGED_ELSEWHERE = "merged_elsewhere:";

export const PULL_REQUEST_NOT_CREATED = "refused: the pull request was not created";

/** Starts the marker of an attempt that may only acknowledge a head the base already holds. */
export const ACKNOWLEDGEMENT_MARKER = "T3-Factory-Acknowledgement: ";

const LEGACY_MERGED_ELSEWHERE =
  /^configuration: pull request #\d+ merged at ([0-9a-f]{40}), not the reviewed head ([0-9a-f]{40})$/;

/**
 * A pull request merged at a head other than the reviewed one. Records written before
 * MERGED_ELSEWHERE existed carry the same facts as a `configuration:` failure, matched exactly;
 * the same wording with equal heads was a merge GitHub reported without its commit, which is not.
 */
export const isMergedElsewhere = (reason: string) => {
  if (reason.startsWith(MERGED_ELSEWHERE)) return true;
  const legacy = LEGACY_MERGED_ELSEWHERE.exec(reason);
  return legacy !== null && legacy[1] !== legacy[2];
};

const excerpt = (text: string, limit: number) => {
  // Collapsed blocks hold a reviewer's tooling logs; the finding is the text around them.
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<details>[\s\S]*?<\/details>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
};

/**
 * The failure a reviewer's request for changes on exactly the reviewed head is, with the open
 * conversations still on that head as its evidence. A request on an earlier head, or a block with
 * no request at all (a missing approval, a question), is not one: those wait for people.
 */
const reviewChangesRequested = (
  pull: PullRequestFacts,
  findings: FactoryTracker.TrackerReviewFindings,
  reviewedHead: string,
): string | undefined => {
  if (findings.headSha !== reviewedHead || pull.headSha !== reviewedHead) return undefined;
  const requests = findings.changesRequested
    .filter((review) => review.commit === reviewedHead)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  if (requests.length === 0) return undefined;
  const threads = findings.unresolvedThreads
    .filter((thread) => !thread.outdated)
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .slice(0, 20);
  return [
    `${REVIEW_CHANGES_REQUESTED} pull request #${pull.number} at ${reviewedHead}: changes requested by ${requests
      .map((review) => `${review.author} (${review.url})`)
      .join(", ")}`,
    ...requests
      .filter((review) => review.body.trim() !== "")
      .map((review) => `- review ${review.id}: ${excerpt(review.body, 800)}`),
    ...threads.map(
      (thread) =>
        `- ${thread.path}${thread.line === null ? "" : `:${thread.line}`} (${thread.id}, ${thread.author}, ${thread.url}): ${excerpt(thread.body, 1200)}`,
    ),
  ].join("\n");
};

/**
 * What the reviewed head's pull request allows now. GitHub's own protection decides whether it
 * may merge (required checks, an up-to-date base, approvals, resolved conversations); T3 only
 * reads that verdict, merges at exactly the reviewed head, and sends a failed check, a conflict
 * or a reviewer's request for changes on that head back to the work.
 */
export const pullRequestStep = (
  pull: PullRequestFacts,
  reviewedHead: string,
  checks:
    | { readonly pending: ReadonlyArray<string>; readonly failed: ReadonlyArray<string> }
    | undefined,
  findings?: FactoryTracker.TrackerReviewFindings,
): PullRequestStep => {
  const name = `pull request #${pull.number}`;
  if (pull.merged) {
    // Equal content is not equal acceptance: only a review of exactly the merged head lands it.
    if (pull.headSha !== reviewedHead) {
      return {
        type: "fail",
        reason: `${MERGED_ELSEWHERE} ${name} merged at ${pull.headSha}${pull.mergeCommit === null ? "" : ` as ${pull.mergeCommit}`}, not the reviewed head ${reviewedHead}`,
      };
    }
    return pull.mergeCommit !== null
      ? { type: "landed", commit: pull.mergeCommit }
      : {
          type: "fail",
          reason: `configuration: ${name} merged at ${pull.headSha}, not the reviewed head ${reviewedHead}`,
        };
  }
  if (pull.state === "closed") {
    return { type: "fail", reason: `refused: ${name} was closed without merging` };
  }
  if (pull.headSha !== reviewedHead) {
    return { type: "wait", reason: `${name} is at ${pull.headSha}, not yet the reviewed head` };
  }
  if (pull.draft) return { type: "wait", reason: `${name} is a draft` };
  switch (pull.mergeableState) {
    case "clean":
    case "unstable":
    case "has_hooks":
      return { type: "merge" };
    case "dirty":
      return { type: "fail", reason: `conflict: ${name} conflicts with its base` };
    case "behind":
      return {
        type: "fail",
        reason: `not_fast_forward: the base moved on; the reviewed head must be brought up to date and reviewed again`,
      };
    case "blocked":
      if (checks !== undefined && checks.failed.length > 0) {
        return { type: "fail", reason: `checks_failed: ${checks.failed.join(", ")}` };
      }
      if (checks !== undefined && checks.pending.length > 0) {
        return { type: "wait", reason: `${name} awaits checks: ${checks.pending.join(", ")}` };
      }
      if (findings !== undefined) {
        const requested = reviewChangesRequested(pull, findings, reviewedHead);
        if (requested !== undefined) return { type: "fail", reason: requested };
      }
      return { type: "wait", reason: `${name} awaits its required approvals or conversations` };
    default:
      return {
        type: "wait",
        reason: `GitHub has not decided whether ${name} can merge (${pull.mergeableState ?? "unknown"})`,
      };
  }
};

export type PullRequestAttempt =
  | FactoryOperationStore.FactoryOperationCompletion
  | { readonly state: "waiting"; readonly reason: string };

type Intent = Extract<
  FactoryOperationStore.FactoryOperationIntent,
  { readonly kind: "pull_request_merge" }
>;

/**
 * The reviewed head itself, when the base's freshly fetched history already contains it. Only
 * ancestry counts: an equal tree, a refused create or another pull request proves nothing.
 */
export const reviewedHeadInBase = Effect.fnUntraced(function* (
  integrator: FactoryIntegrator.FactoryIntegratorShape,
  input: {
    readonly cwd: string;
    readonly intent: Pick<Intent, "base" | "remote" | "marker" | "reviewedHead">;
  },
) {
  const { intent } = input;
  const landed = yield* integrator.landed({
    cwd: input.cwd,
    target: { branch: intent.base, remote: intent.remote },
    marker: intent.marker,
    reviewedHead: intent.reviewedHead,
  });
  // This integration writes the base only by merging a pull request, which names its number.
  return Option.filter(landed, (found) => found.commit === intent.reviewedHead).pipe(
    Option.map((found) => ({ ...found, attribution: "external" as const })),
  );
});

/**
 * One attempt at a pull request integration. It reads the pull request back first, so a merge
 * that applied before a lost answer or a crash is recorded, never repeated; it publishes the
 * reviewed head and opens the pull request only when neither exists yet and an existing base lacks
 * the head. An acknowledgement attempt only reads: it lands a contained head or waits.
 */
export const attemptPullRequestMerge = Effect.fnUntraced(function* (
  session: FactoryTracker.TrackerSession,
  integrator: FactoryIntegrator.FactoryIntegratorShape,
  input: { readonly cwd: string; readonly intent: Intent },
): Effect.fn.Return<
  PullRequestAttempt,
  FactoryTracker.FactoryTrackerError | FactoryIntegrator.FactoryIntegratorError
> {
  const { cwd, intent } = input;
  const { repository } = intent;
  const landed = Effect.fnUntraced(function* (number: number, commit: string) {
    const merged = yield* session.readCommit({ repository, sha: commit });
    const completion: PullRequestAttempt = {
      state: "applied",
      receipt: {
        kind: "pull_request_merge",
        repository,
        number,
        branch: intent.base,
        commit,
        parents: merged.parents,
        tree: merged.tree,
        attribution: merged.message.includes(intent.marker) ? "operation" : "external",
      },
    };
    return completion;
  });

  let found = yield* session.findPullRequest({
    repository,
    head: intent.head,
    base: intent.base,
  });
  if (Option.isSome(found) && found.value.merged) {
    const pull = yield* session.readPullRequest({ repository, number: found.value.number });
    const step = pullRequestStep(pull, intent.reviewedHead, undefined);
    if (step.type === "landed") return yield* landed(pull.number, step.commit);
    if (step.type === "fail") return { state: "failed", reason: step.reason };
  }
  const inBase = reviewedHeadInBase(integrator, { cwd, intent }).pipe(
    Effect.map(
      Option.map((contained): PullRequestAttempt => ({
        state: "applied",
        receipt: { kind: "git_integrate", branch: intent.base, ...contained },
      })),
    ),
  );
  if (intent.marker.startsWith(ACKNOWLEDGEMENT_MARKER)) {
    return Option.getOrElse(yield* inBase, () => ({
      state: "waiting" as const,
      reason: `${intent.base} on ${intent.remote} does not contain the reviewed head ${intent.reviewedHead}; nothing was published`,
    }));
  }
  if (Option.isNone(found)) {
    // GitHub refuses a pull request with nothing to merge; the base holding the head is the landing.
    const contained = yield* inBase;
    if (Option.isSome(contained)) return contained.value;
    // A missing base contains nothing, yet is no reason to open a pull request against it.
    const tip = yield* integrator.tip({
      cwd,
      target: { branch: intent.base, remote: intent.remote },
    });
    if (tip === null) {
      return {
        state: "waiting",
        reason: `integration target ${intent.base} does not exist on ${intent.remote}; nothing was published`,
      };
    }
  }
  if (Option.isNone(found) || found.value.state === "open") {
    const published = yield* integrator.publish({
      cwd,
      remote: intent.remote,
      branch: intent.head,
      commit: intent.reviewedHead,
    });
    if (published.type === "diverged") {
      return {
        state: "failed",
        reason: `not_fast_forward: ${intent.head} holds ${published.tip}, which the reviewed head does not descend from`,
      };
    }
  }
  if (Option.isNone(found)) {
    const created = yield* session.createPullRequest({
      repository,
      head: intent.head,
      base: intent.base,
      title: intent.title,
      body: intent.body,
    });
    // Whatever the answer said, the pull request that exists now is the one to go on with.
    found = yield* session.findPullRequest({ repository, head: intent.head, base: intent.base });
    if (Option.isNone(found)) {
      return created.type === "rejected" && !created.transient
        ? {
            state: "failed",
            reason: `${PULL_REQUEST_NOT_CREATED} (${created.cause})`,
          }
        : { state: "waiting", reason: "the pull request was not confirmed" };
    }
  }
  // The protection's record of independent acceptance goes on the exact reviewed head first.
  if (intent.acceptanceStatus !== undefined) {
    const accepted = yield* session.ensureSuccessStatus({
      repository,
      sha: intent.reviewedHead,
      context: intent.acceptanceStatus.context,
      description: intent.acceptanceStatus.description,
    });
    if (!accepted) {
      return {
        state: "waiting",
        reason: `the ${intent.acceptanceStatus.context} status on ${intent.reviewedHead} was not confirmed`,
      };
    }
  }
  let pull = yield* session.readPullRequest({ repository, number: found.value.number });
  // A worker's draft at the reviewed head is still the pull request this integration merges.
  if (pull.draft && pull.state === "open" && pull.headSha === intent.reviewedHead) {
    if (pull.nodeId !== null) yield* session.markReadyForReview({ nodeId: pull.nodeId });
    pull = yield* session.readPullRequest({ repository, number: pull.number });
  }
  const checks =
    pull.mergeableState === "blocked"
      ? yield* session.readChecks({ repository, sha: intent.reviewedHead })
      : undefined;
  // Only a block no check explains is asked about reviews; an unreadable answer decides nothing.
  const findings =
    checks !== undefined && checks.failed.length === 0 && checks.pending.length === 0
      ? Option.getOrUndefined(
          yield* session
            .readReviewFindings({ repository, number: pull.number })
            .pipe(Effect.orElseSucceed(() => Option.none())),
        )
      : undefined;
  const step = pullRequestStep(pull, intent.reviewedHead, checks, findings);
  switch (step.type) {
    case "landed":
      return yield* landed(pull.number, step.commit);
    case "wait":
      return { state: "waiting", reason: step.reason };
    case "fail":
      return { state: "failed", reason: step.reason };
    case "merge":
      break;
  }
  const merged = yield* session.mergePullRequest({
    repository,
    number: pull.number,
    sha: intent.reviewedHead,
    method: intent.method,
    title: `${intent.title} (#${pull.number})`,
    message: intent.marker,
  });
  // Merged, refused or unknown: only GitHub's record of the pull request says what happened.
  const after = yield* session.readPullRequest({ repository, number: pull.number });
  const settled = pullRequestStep(after, intent.reviewedHead, undefined);
  if (settled.type === "landed") return yield* landed(after.number, settled.commit);
  return {
    state: "waiting",
    reason:
      merged.type === "refused"
        ? `GitHub refused the merge of pull request #${pull.number} (${merged.status})`
        : `the merge of pull request #${pull.number} was not confirmed`,
  };
});
