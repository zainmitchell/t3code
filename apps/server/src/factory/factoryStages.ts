/**
 * An item's lifecycle, derived from native facts alone: implement, then an independent review of
 * the exact head, then integrate and close; a failed review or a typed failure gets one correction
 * spec per exact failure, then rework and review again. There is no counter: the loop runs as long
 * as reviews fail with new evidence, and an unchanged basis never yields a second decision.
 */

import * as Schema from "effect/Schema";

/**
 * `triage` is decomposition: a cheap worker proposes the unit spec an item lacks (owned files,
 * resources, one-screen contract), bound to the exact item version it read. Its result is evidence
 * the policy reads on a later pass, never a build start, and it leaves the lifecycle where it was.
 */
export const FactoryStageSchema = Schema.Literals([
  "implement",
  "review",
  "correct",
  "rework",
  "integrate",
  "close",
  "triage",
]);
export type FactoryStageType = typeof FactoryStageSchema.Type;
export const isFactoryStage = Schema.is(FactoryStageSchema);

/** Stages a worker runs. Integration and closure are T3's own effects, never a worker's. */
export const AGENT_STAGES: ReadonlySet<FactoryStageType> = new Set([
  "implement",
  "review",
  "correct",
  "rework",
  "triage",
]);

export type FactoryOutcomeKind =
  | "implemented"
  | "failed"
  | "review_passed"
  | "review_failed"
  | "correction_spec"
  | "integrated"
  | "closed"
  /** Triage proposed a unit spec for the item version it read. */
  | "unit_proposed"
  /** A parent's triage quoted its current acceptance as criteria clauses. */
  | "criteria_proposed"
  /** Triage found no bounded unit to propose; the reason needs a person. */
  | "not_actionable"
  /** T3 opened a correction ticket a verification-only item's spec asked for. */
  | "ticket_opened";

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
      /**
       * For T3's own missing result of an attempt that failed in its provider environment: the
       * identity of the execution it ran on, when T3 could read it. No verdict on the work.
       */
      readonly environment?: { readonly execution?: string };
    }
  | {
      /** The owner explicitly rejected an outcome; it is never consumed again. */
      readonly type: "rejected";
      readonly seq: number;
      readonly outcomeId: string;
      readonly failureDigest: string;
    }
  | {
      /** The issue was open again after this closure: a new version of the item starts from it. */
      readonly type: "reopened";
      readonly seq: number;
      readonly closureOutcomeId: string;
    };

export type FactoryStage =
  /** `reopenOf`: the closure a reopened item builds on; its earlier history stays as evidence. */
  | { readonly type: "implement"; readonly reopenOf?: string }
  | {
      readonly type: "review";
      readonly outcomeId: string;
      readonly head: string;
      /** New verified evidence for a head already reviewed: a review of that evidence, not the head again. */
      readonly evidence?: string;
      /** A review of this head that ended without a verdict, retried on its own basis. */
      readonly retry?: string;
      /** The attempt that set `retry`: a stalled retry is asked about on it, and its rejection retries once more. */
      readonly retryOutcomeId?: string;
      /** The review result its owner rejected: the head is reviewed again on that rejection. */
      readonly again?: string;
    }
  | {
      readonly type: "correct";
      readonly outcomeId: string;
      readonly failureDigest: string;
      /** A correction of this failure that ended without a spec, retried on its own basis. */
      readonly retry?: string;
      /** The attempt that set `retry`: a stalled retry is asked about on it, and its rejection retries once more. */
      readonly retryOutcomeId?: string;
    }
  | {
      readonly type: "rework";
      readonly specOutcomeId: string;
      readonly failureDigest: string;
    }
  | { readonly type: "integrate"; readonly reviewOutcomeId: string; readonly head: string }
  | { readonly type: "close"; readonly integrationOutcomeId: string }
  | { readonly type: "done"; readonly closureOutcomeId: string };

/** The outcome id prefix of a parent's closure on its adopted criteria. */
export const PARENT_CLOSURE = "native:close:parent:";

/**
 * An implementation is reviewable only if no implement or rework decision was admitted after it
 * landed; a late success reported after the newest such claim is still reviewed, even if that
 * attempt fails or releases (HSA D1). A review counts only for the head it names, and an explicitly
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
  let reviewRetry: { readonly digest: string; readonly outcomeId: string } | undefined;
  let correctRetry: { readonly digest: string; readonly outcomeId: string } | undefined;
  let reopenOf: string | undefined;
  let reviewAgain: string | undefined;
  const rejected = new Set<string>();
  for (const event of [...events].toSorted((left, right) => left.seq - right.seq)) {
    if (event.type === "reopened") {
      if (event.closureOutcomeId !== closure) continue;
      reopenOf = closure;
      reviewAgain = undefined;
      implementation = undefined;
      review = undefined;
      failure = undefined;
      spec = undefined;
      integration = undefined;
      closure = undefined;
      reviewRetry = undefined;
      correctRetry = undefined;
      continue;
    }
    if (event.type === "admitted") {
      if (event.stage === "implement" || event.stage === "rework") {
        implementation = undefined;
        review = undefined;
        integration = undefined;
        reviewAgain = undefined;
      }
      continue;
    }
    if (event.type === "rejected") {
      rejected.add(event.outcomeId);
      // A parent's rejected closure is withdrawn: it is judged on its criteria again.
      if (closure === event.outcomeId && closure.startsWith(PARENT_CLOSURE)) {
        closure = undefined;
        continue;
      }
      // A retry its owner rejects, as a stalled stage's card asks, is retried once more on that rejection.
      if (correctRetry?.outcomeId === event.outcomeId) {
        correctRetry = { digest: event.failureDigest, outcomeId: event.outcomeId };
        continue;
      }
      if (reviewRetry?.outcomeId === event.outcomeId) {
        reviewRetry = { digest: event.failureDigest, outcomeId: event.outcomeId };
        continue;
      }
      // A rejected review result is withdrawn: the head is reviewed again, never corrected for it.
      // A landed integration stays landed.
      if (review?.outcomeId === event.outcomeId && integration === undefined) {
        reviewAgain = event.outcomeId;
        review = undefined;
        if (failure?.outcomeId === event.outcomeId) failure = undefined;
        spec = undefined;
        reviewRetry = undefined;
        correctRetry = undefined;
        continue;
      }
      // A rejected failure, as a stalled correction's owner rejects it, is corrected again on the
      // rejection: its retries were of the failure as it stood.
      if (
        implementation?.outcomeId === event.outcomeId ||
        spec?.outcomeId === event.outcomeId ||
        failure?.outcomeId === event.outcomeId
      ) {
        implementation = implementation?.outcomeId === event.outcomeId ? undefined : implementation;
        failure = { outcomeId: event.outcomeId, digest: event.failureDigest };
        review = undefined;
        spec = undefined;
        integration = undefined;
        correctRetry = undefined;
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
        // An attempt that failed in its environment leaves the stage where it was; its retry is
        // the lifecycle's to gate on the execution (`environmentFailures`).
        if (event.failureDigest === undefined || event.environment !== undefined) break;
        // A review or correction that produced nothing is retried; it is no verdict on the work.
        if (event.stage === "review") {
          reviewRetry = { digest: event.failureDigest, outcomeId: event.outcomeId };
          break;
        }
        if (event.stage === "correct") {
          correctRetry = { digest: event.failureDigest, outcomeId: event.outcomeId };
          break;
        }
        // A triage that produced nothing is no failure of the work: nothing to correct.
        if (event.stage === "triage") break;
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
        reviewAgain = undefined;
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
        // A parent is never integrated: its own closure on proved criteria is its end.
        if (integration !== undefined || event.outcomeId.startsWith(PARENT_CLOSURE)) {
          closure = event.outcomeId;
        }
        break;
      // Evidence for the policy, not a lifecycle transition.
      case "unit_proposed":
      case "criteria_proposed":
      case "not_actionable":
      case "ticket_opened":
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
      ...(correctRetry === undefined
        ? {}
        : { retry: correctRetry.digest, retryOutcomeId: correctRetry.outcomeId }),
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
      ...(reviewRetry === undefined
        ? {}
        : { retry: reviewRetry.digest, retryOutcomeId: reviewRetry.outcomeId }),
      ...(reviewAgain === undefined ? {} : { again: reviewAgain }),
    };
  }
  return reopenOf === undefined ? { type: "implement" } : { type: "implement", reopenOf };
};

/** An agent stage whose latest attempt failed in its provider environment, with no verdict since. */
export interface EnvironmentFailure {
  readonly outcomeId: string;
  /** The identity of the execution it failed on; unknown when T3 could not read it. */
  readonly execution?: string;
  /** The owner rejected that failure: one more attempt, whatever the execution. */
  readonly rejected?: string;
}

/**
 * Each agent stage whose latest attempt failed in its environment. Any later lifecycle result
 * ends the lifecycle stages' failures, a later triage result ends triage's, a reopen ends all.
 */
export const environmentFailures = (
  events: ReadonlyArray<ItemEvent>,
): ReadonlyMap<FactoryStageType, EnvironmentFailure> => {
  const failures = new Map<FactoryStageType, EnvironmentFailure>();
  for (const event of [...events].toSorted((left, right) => left.seq - right.seq)) {
    if (event.type === "reopened") {
      failures.clear();
    } else if (event.type === "rejected") {
      for (const [stage, failure] of failures) {
        if (failure.outcomeId === event.outcomeId) {
          failures.set(stage, { ...failure, rejected: event.failureDigest });
        }
      }
    } else if (event.type === "outcome" && event.stage !== undefined) {
      if (event.stage === "triage") {
        failures.delete("triage");
      } else if (event.kind !== "ticket_opened") {
        for (const stage of failures.keys()) if (stage !== "triage") failures.delete(stage);
      }
      if (event.kind === "failed" && event.environment !== undefined) {
        failures.set(event.stage, {
          outcomeId: event.outcomeId,
          ...(event.environment.execution === undefined
            ? {}
            : { execution: event.environment.execution }),
        });
      }
    }
  }
  return failures;
};

/**
 * The exact basis a stage decision is made from: the same stage on the same basis is the same
 * decision, however often it is proposed.
 */
export const stageBasis = (stage: Exclude<FactoryStage, { readonly type: "done" }>): string => {
  switch (stage.type) {
    case "implement":
      return stage.reopenOf === undefined ? "implement" : `implement:reopen:${stage.reopenOf}`;
    case "review":
      return `review:${stage.head}${stage.evidence === undefined ? "" : `:evidence:${stage.evidence}`}${stage.retry === undefined ? "" : `:retry:${stage.retry}`}${stage.again === undefined ? "" : `:again:${stage.again}`}`;
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

/**
 * The failure digest a `correct:` stage basis corrects, whatever retry, environment or `|`-led
 * binding suffix follows it: the digest is sha256 hex, so it never holds a `:` or `|`.
 */
export const correctedFailure = (basis: string): string | undefined =>
  basis.startsWith("correct:") ? basis.slice("correct:".length).split(/[:|]/)[0] : undefined;

/** The `:env:` suffix the lifecycle puts after a stage basis to run it again after an environment failure. */
const ENVIRONMENT_RETRY = /:env:[0-9a-f]{12}:(?:owner:[0-9a-f]{16}|[0-9a-f]{32})$/;

/** A stage basis's core (before any `|` suffix) without its environment retry. */
export const withoutEnvironmentRetry = (core: string) => core.replace(ENVIRONMENT_RETRY, "");

/** The outcomes a stage may end in; workers report the agent stages' ones. */
export const expectedOutcomes: Record<FactoryStageType, ReadonlyArray<FactoryOutcomeKind>> = {
  implement: ["implemented", "failed"],
  rework: ["implemented", "failed"],
  review: ["review_passed", "review_failed"],
  correct: ["correction_spec", "failed"],
  integrate: ["integrated", "failed"],
  close: ["closed", "failed"],
  triage: ["unit_proposed", "criteria_proposed", "not_actionable"],
};

/**
 * The exact basis of a triage decision: the item version it reads and, after a preparation failed,
 * that failure and the digest of what T3 reads back for it. Unchanged text never triages twice.
 */
export const triageBasis = (itemVersion: string, retry?: string, readback?: string) =>
  `triage:${itemVersion}${retry === undefined ? "" : `:retry:${retry}`}${readback === undefined ? "" : `:after:${readback}`}`;
