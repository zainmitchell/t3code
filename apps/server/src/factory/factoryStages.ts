/**
 * An item's lifecycle, derived from native facts alone: implement, then an independent review of
 * the exact head, then integrate and close; a failed review or a typed failure gets one correction
 * spec per exact failure, then rework and review again. There is no counter: the loop runs as long
 * as reviews fail with new evidence, and an unchanged basis never yields a second decision.
 */

export type FactoryStageType =
  | "implement"
  | "review"
  | "correct"
  | "rework"
  | "integrate"
  | "close";

/** Stages a worker runs. Integration and closure are T3's own effects, never a worker's. */
export const AGENT_STAGES: ReadonlySet<FactoryStageType> = new Set([
  "implement",
  "review",
  "correct",
  "rework",
]);

export type FactoryOutcomeKind =
  | "implemented"
  | "failed"
  | "review_passed"
  | "review_failed"
  | "correction_spec"
  | "integrated"
  | "closed";

/** One fact about an item, in native commit order. */
export type ItemEvent =
  | {
      /** A stage decision was admitted (its worker was claimed). */
      readonly type: "admitted";
      readonly seq: number;
      readonly stage: FactoryStageType;
    }
  | {
      /** An outcome, verified against its execution or native operation and readbacks. */
      readonly type: "outcome";
      readonly seq: number;
      readonly outcomeId: string;
      readonly stage?: FactoryStageType;
      readonly kind: FactoryOutcomeKind;
      /** The admission of the attempt that produced it; absent for T3's own effects. */
      readonly admittedSeq?: number;
      /** For an implementation, its head; for a review, the exact head it reviewed. */
      readonly head?: string;
      /** For an implementation, the digest of the artifacts T3 itself read and found as reported. */
      readonly evidenceDigest?: string;
      /** For a failure or failed review, the digest of its exact failure. */
      readonly failureDigest?: string;
      /** For a correction spec, the failure digest its decision was admitted to correct. */
      readonly corrects?: string;
    }
  | {
      /** The owner explicitly rejected an outcome; it is never consumed again. */
      readonly type: "rejected";
      readonly seq: number;
      readonly outcomeId: string;
      readonly failureDigest: string;
    };

export type FactoryStage =
  | { readonly type: "implement" }
  | {
      readonly type: "review";
      readonly outcomeId: string;
      readonly head: string;
      /** New verified evidence for a head already reviewed: a review of that evidence, not the head again. */
      readonly evidence?: string;
      /** A review of this head that ended without a verdict, retried on its own basis. */
      readonly retry?: string;
    }
  | {
      readonly type: "correct";
      readonly outcomeId: string;
      readonly failureDigest: string;
      /** A correction of this failure that ended without a spec, retried on its own basis. */
      readonly retry?: string;
    }
  | {
      readonly type: "rework";
      readonly specOutcomeId: string;
      readonly failureDigest: string;
    }
  | { readonly type: "integrate"; readonly reviewOutcomeId: string; readonly head: string }
  | { readonly type: "close"; readonly integrationOutcomeId: string }
  | { readonly type: "done"; readonly closureOutcomeId: string };

/**
 * An implementation is reviewable only if no implement or rework decision was admitted after it
 * landed; a late success reported after the newest such claim is still reviewed, even if that
 * attempt fails or releases. A review counts only for the head it names, and an explicitly
 * rejected result is never consumed again.
 */
export const nextStage = (events: ReadonlyArray<ItemEvent>): FactoryStage => {
  let implementation:
    | {
        readonly outcomeId: string;
        readonly head: string;
        readonly seq: number;
        readonly evidence: string | undefined;
      }
    | undefined;
  // Heads a review has already judged: the same head is reviewed again only on new verified evidence.
  const reviewedHeads = new Set<string>();
  let review: { readonly outcomeId: string; readonly passed: boolean } | undefined;
  let failure: { readonly outcomeId: string; readonly digest: string } | undefined;
  let spec: { readonly outcomeId: string; readonly digest: string } | undefined;
  let integration: string | undefined;
  let closure: string | undefined;
  let reviewRetry: string | undefined;
  let correctRetry: string | undefined;
  const rejected = new Set<string>();
  for (const event of [...events].toSorted((left, right) => left.seq - right.seq)) {
    if (event.type === "admitted") {
      if (event.stage === "implement" || event.stage === "rework") {
        implementation = undefined;
        review = undefined;
        integration = undefined;
      }
      continue;
    }
    if (event.type === "rejected") {
      rejected.add(event.outcomeId);
      if (implementation?.outcomeId === event.outcomeId || spec?.outcomeId === event.outcomeId) {
        implementation = implementation?.outcomeId === event.outcomeId ? undefined : implementation;
        failure = { outcomeId: event.outcomeId, digest: event.failureDigest };
        review = undefined;
        spec = undefined;
        integration = undefined;
      }
      continue;
    }
    if (rejected.has(event.outcomeId)) continue;
    switch (event.kind) {
      case "implemented":
        if (event.head === undefined) break;
        implementation = {
          outcomeId: event.outcomeId,
          head: event.head,
          seq: event.seq,
          evidence: event.evidenceDigest,
        };
        review = undefined;
        failure = undefined;
        spec = undefined;
        integration = undefined;
        reviewRetry = undefined;
        correctRetry = undefined;
        break;
      case "failed":
        if (event.failureDigest === undefined) break;
        // A review or correction that produced nothing is retried; it is no verdict on the work.
        if (event.stage === "review") {
          reviewRetry = event.failureDigest;
          break;
        }
        if (event.stage === "correct") {
          correctRetry = event.failureDigest;
          break;
        }
        // A newer attempt claimed before this success landed cannot dispose of it by failing.
        if (
          implementation !== undefined &&
          (event.stage === "implement" || event.stage === "rework") &&
          event.admittedSeq !== undefined &&
          event.admittedSeq < implementation.seq
        ) {
          break;
        }
        // A typed failure needs no commit; it can be corrected, never integrated.
        failure = { outcomeId: event.outcomeId, digest: event.failureDigest };
        spec = undefined;
        review = undefined;
        integration = undefined;
        correctRetry = undefined;
        break;
      case "review_passed":
      case "review_failed":
        if (event.head !== undefined) reviewedHeads.add(event.head);
        if (implementation === undefined || event.head !== implementation.head) break;
        review = { outcomeId: event.outcomeId, passed: event.kind === "review_passed" };
        integration = undefined;
        reviewRetry = undefined;
        if (event.kind === "review_failed" && event.failureDigest !== undefined) {
          failure = { outcomeId: event.outcomeId, digest: event.failureDigest };
          spec = undefined;
          correctRetry = undefined;
        }
        break;
      case "correction_spec":
        if (failure !== undefined && event.corrects === failure.digest) {
          spec = { outcomeId: event.outcomeId, digest: failure.digest };
        }
        break;
      case "integrated":
        if (review?.passed === true) integration = event.outcomeId;
        break;
      case "closed":
        if (integration !== undefined) closure = event.outcomeId;
        break;
    }
  }
  if (closure !== undefined) return { type: "done", closureOutcomeId: closure };
  if (integration !== undefined) return { type: "close", integrationOutcomeId: integration };
  if (implementation !== undefined && review?.passed === true) {
    return { type: "integrate", reviewOutcomeId: review.outcomeId, head: implementation.head };
  }
  if (spec !== undefined) {
    return { type: "rework", specOutcomeId: spec.outcomeId, failureDigest: spec.digest };
  }
  if (failure !== undefined && (review === undefined || !review.passed)) {
    return {
      type: "correct",
      outcomeId: failure.outcomeId,
      failureDigest: failure.digest,
      ...(correctRetry === undefined ? {} : { retry: correctRetry }),
    };
  }
  if (implementation !== undefined && review === undefined) {
    const evidence =
      implementation.evidence !== undefined && reviewedHeads.has(implementation.head)
        ? implementation.evidence
        : undefined;
    return {
      type: "review",
      outcomeId: implementation.outcomeId,
      head: implementation.head,
      ...(evidence === undefined ? {} : { evidence }),
      ...(reviewRetry === undefined ? {} : { retry: reviewRetry }),
    };
  }
  return { type: "implement" };
};

/**
 * The exact basis a stage decision is made from: the same stage on the same basis is the same
 * decision, however often it is proposed.
 */
export const stageBasis = (stage: Exclude<FactoryStage, { readonly type: "done" }>): string => {
  switch (stage.type) {
    case "implement":
      return "implement";
    case "review":
      return `review:${stage.head}${stage.evidence === undefined ? "" : `:evidence:${stage.evidence}`}${stage.retry === undefined ? "" : `:retry:${stage.retry}`}`;
    case "correct":
      return `correct:${stage.failureDigest}${stage.retry === undefined ? "" : `:retry:${stage.retry}`}`;
    case "rework":
      return `rework:${stage.specOutcomeId}`;
    case "integrate":
      return `integrate:${stage.reviewOutcomeId}`;
    case "close":
      return `close:${stage.integrationOutcomeId}`;
  }
};

/** The outcomes a stage may end in; workers report the agent stages' ones. */
export const expectedOutcomes: Record<FactoryStageType, ReadonlyArray<FactoryOutcomeKind>> = {
  implement: ["implemented", "failed"],
  rework: ["implemented", "failed"],
  review: ["review_passed", "review_failed"],
  correct: ["correction_spec", "failed"],
  integrate: ["integrated", "failed"],
  close: ["closed", "failed"],
};
