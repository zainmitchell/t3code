import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";

/** The integration operation T3 recorded and read back for an outcome; policy may rely on it. */
export interface LandingOrigin {
  readonly type: "native";
  readonly operationId: string;
}

const sameList = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * The operation an integrated outcome lands by, when its own applied receipt says exactly what the
 * outcome reports (commit, tree, parents, branch, attribution) and it merged a head this item's
 * independent review passed. Anything less is no landing: the outcome's report alone proves none.
 */
export const landingOrigin = (
  outcome: FactoryOutcomeStore.FactoryOutcome,
  operation: FactoryOperationStore.FactoryOperation | undefined,
  reviewedHeads: ReadonlySet<string>,
): LandingOrigin | undefined => {
  const integration = outcome.report.integration;
  if (
    outcome.state !== "verified" ||
    outcome.stage !== "integrate" ||
    outcome.report.outcome !== "integrated" ||
    integration === undefined ||
    outcome.origin.type !== "native" ||
    operation === undefined ||
    operation.operationId !== outcome.origin.operationId ||
    operation.factoryId !== outcome.factoryId ||
    operation.itemKey !== outcome.itemKey ||
    operation.state !== "applied"
  ) {
    return undefined;
  }
  const { intent, receipt } = operation;
  if (
    (intent.kind !== "git_integrate" && intent.kind !== "pull_request_merge") ||
    (receipt.kind !== "git_integrate" && receipt.kind !== "pull_request_merge") ||
    receipt.kind !== intent.kind ||
    receipt.commit !== integration.mergeCommit ||
    receipt.tree !== integration.tree ||
    receipt.branch !== integration.targetBranch ||
    receipt.attribution !== integration.attribution ||
    !sameList(receipt.parents, integration.parents) ||
    !reviewedHeads.has(intent.reviewedHead)
  ) {
    return undefined;
  }
  return { type: "native", operationId: operation.operationId };
};

/** The heads an item's independent review passed, leaving out any review its owner rejected. */
export const reviewedHeadsOf = (
  outcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>,
  rejected: ReadonlySet<string>,
): ReadonlySet<string> =>
  new Set(
    outcomes.flatMap((outcome) =>
      outcome.state === "verified" &&
      outcome.report.outcome === "review_passed" &&
      !rejected.has(outcome.outcomeId) &&
      outcome.report.subject?.headCommit !== undefined
        ? [outcome.report.subject.headCommit]
        : [],
    ),
  );
