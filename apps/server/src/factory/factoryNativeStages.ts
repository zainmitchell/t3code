// @effect-diagnostics nodeBuiltinImport:off - operation identities are sha256 digests.
import * as NodeCrypto from "node:crypto";

import type { FactoryId, FactoryItemKey } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProjectService from "../project/ProjectService.ts";
import type * as FactoryIntegrator from "./FactoryIntegrator.ts";
import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { canonical, type EnsureOperationError, subjectOf } from "./factoryOutcomes.ts";
import { REVIEW_CHANGES_REQUESTED } from "./factoryPullRequests.ts";
import type { FactoryStage } from "./factoryStages.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** The closing record's marker, found before any write. */
const closeMarker = (operationId: string) => `<!-- t3-factory-close:${operationId} -->`;

/** Failures that are the work's to correct; any other failure is the configuration's. */
export const isCorrectable = (reason: string) =>
  reason.startsWith("conflict:") ||
  reason.startsWith("not_fast_forward:") ||
  reason.startsWith("checks_failed:") ||
  reason.startsWith(REVIEW_CHANGES_REQUESTED);

const isIntegration = (intent: FactoryOperationStore.FactoryOperationIntent) =>
  intent.kind === "git_integrate" || intent.kind === "pull_request_merge";

export type NativeStagePlan =
  | { readonly type: "in_flight"; readonly operationId: string }
  | { readonly type: "issue"; readonly issue: string };

type NativeStageError =
  | EnsureOperationError
  | FactoryOutcomeStore.FactoryOutcomeStoreError
  | FactoryIntegrator.FactoryIntegratorError
  | ProjectService.ProjectOperationError;

export interface NativeStageDependencies {
  readonly operations: FactoryOperationStore.FactoryOperationStore["Service"];
  readonly outcomes: FactoryOutcomeStore.FactoryOutcomeStore["Service"];
  readonly integrator: FactoryIntegrator.FactoryIntegratorShape;
  readonly projects: ProjectService.ProjectService["Service"];
  readonly ensureOperation: (input: {
    readonly operationId: string;
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryItemKey;
    readonly intent: FactoryOperationStore.FactoryOperationIntent;
  }) => Effect.Effect<FactoryOperationStore.FactoryOperation, EnsureOperationError>;
}

/**
 * Integration and closure are T3's own effects. Each is decided on a fresh read of what it would
 * change (the target's tip, the issue), recorded as an operation intent with a live effect, and
 * becomes an outcome only once the effect read its write back.
 */
export const makeNativeStages = (deps: NativeStageDependencies) => {
  const { operations, outcomes } = deps;

  /** Keeps an in-flight operation's effect live; true when one is in flight. */
  const keepLive = Effect.fnUntraced(function* (
    operation: FactoryOperationStore.FactoryOperation | undefined,
  ) {
    if (operation === undefined || operation.state !== "intended") return false;
    yield* deps.ensureOperation(operation);
    return true;
  });

  const planIntegration = Effect.fnUntraced(function* (input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
    readonly itemKey: FactoryItemKey;
    readonly stage: Extract<FactoryStage, { readonly type: "integrate" }>;
    /** The issue the item is, which a pull request refers to without closing it. */
    readonly issue: {
      readonly repository: string;
      readonly issueNumber: number;
      readonly title: string;
    };
    /** The branch the reviewed head was reported on, if its worker named one. */
    readonly branch: string | undefined;
  }): Effect.fn.Return<NativeStagePlan, NativeStageError> {
    const { configuration, itemKey, stage } = input;
    const integration = configuration.integration;
    if (integration === undefined) return { type: "issue", issue: "integration is not configured" };
    const attempts = (yield* operations.forItem({
      factoryId: configuration.factoryId,
      itemKey,
    })).filter(
      ({ intent }) =>
        (intent.kind === "git_integrate" || intent.kind === "pull_request_merge") &&
        intent.reviewedHead === stage.head,
    );
    const latest = attempts.at(-1);
    if (latest !== undefined && latest.state !== "stale") {
      if (latest.state === "failed" && !isCorrectable(latest.reason)) {
        return { type: "issue", issue: latest.reason };
      }
      yield* keepLive(latest);
      return { type: "in_flight", operationId: latest.operationId };
    }
    if (integration.mode === "pull_request") {
      if (configuration.claim === undefined) {
        return { type: "issue", issue: "pull request integration needs the factory's tracker" };
      }
      const operationId = `integrate:${sha256(
        canonical([
          configuration.factoryId,
          itemKey,
          stage.reviewOutcomeId,
          "pull_request",
          String(attempts.length),
        ]),
      ).slice(0, 40)}`;
      const { issue } = input;
      const reference =
        issue.repository === integration.repository
          ? `#${issue.issueNumber}`
          : `${issue.repository}#${issue.issueNumber}`;
      yield* deps.ensureOperation({
        operationId,
        factoryId: configuration.factoryId,
        itemKey,
        intent: {
          kind: "pull_request_merge",
          projectId: configuration.projectId,
          repository: integration.repository,
          remote: integration.remote,
          base: integration.branch,
          head: input.branch ?? `t3-factory/${configuration.factoryId}/${issue.issueNumber}`,
          reviewedHead: stage.head,
          method: integration.method,
          marker: `T3-Factory-Operation: ${operationId}`,
          title: issue.title,
          ...(integration.acceptanceStatus === undefined
            ? {}
            : {
                acceptanceStatus: {
                  context: integration.acceptanceStatus.context,
                  description: `T3 factory ${configuration.factoryId} review ${stage.reviewOutcomeId} accepted ${stage.head.slice(0, 12)}`,
                },
              }),
          // T3 closes the issue itself after reading the merge back, so this only refers to it.
          body: [
            `Refs ${reference}`,
            "",
            `T3 factory ${configuration.factoryId} merges this at the reviewed head ${stage.head} once its checks and protection allow it.`,
            "",
            `T3-Factory-Item: ${itemKey}`,
            `T3-Factory-Review: ${stage.reviewOutcomeId}`,
          ].join("\n"),
        },
      });
      return { type: "in_flight", operationId };
    }
    const project = yield* deps.projects.getById(configuration.projectId);
    if (Option.isNone(project)) return { type: "issue", issue: "the project no longer exists" };
    const target = { branch: integration.branch, remote: integration.remote };
    const expected = yield* deps.integrator.tip({ cwd: project.value.workspaceRoot, target });
    if (expected === null) {
      return { type: "issue", issue: `integration target ${integration.branch} does not exist` };
    }
    const operationId = `integrate:${sha256(
      canonical([configuration.factoryId, itemKey, stage.reviewOutcomeId, expected]),
    ).slice(0, 40)}`;
    const marker = `T3-Factory-Operation: ${operationId}`;
    yield* deps.ensureOperation({
      operationId,
      factoryId: configuration.factoryId,
      itemKey,
      intent: {
        kind: "git_integrate",
        projectId: configuration.projectId,
        branch: integration.branch,
        remote: integration.remote,
        expected,
        reviewedHead: stage.head,
        mode: integration.mode,
        marker,
        message: [
          `Integrate ${itemKey} (reviewed ${stage.head})`,
          "",
          `T3-Factory-Item: ${itemKey}`,
          `T3-Factory-Review: ${stage.reviewOutcomeId}`,
          marker,
          "",
        ].join("\n"),
        identity: integration.identity,
      },
    });
    return { type: "in_flight", operationId };
  });

  const planClosure = Effect.fnUntraced(function* (input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
    readonly itemKey: FactoryItemKey;
    readonly stage: Extract<FactoryStage, { readonly type: "close" }>;
  }): Effect.fn.Return<NativeStagePlan, NativeStageError> {
    const { configuration, itemKey, stage } = input;
    const subject = subjectOf(itemKey);
    if (configuration.claim === undefined || subject === undefined) {
      return { type: "issue", issue: "the item has no tracker to close" };
    }
    const operationId = `close:${stage.integrationOutcomeId}`;
    const existing = yield* operations.get(operationId);
    if (Option.isSome(existing)) {
      if (existing.value.state === "failed") return { type: "issue", issue: existing.value.reason };
      yield* keepLive(existing.value);
      return { type: "in_flight", operationId };
    }
    const integrated = yield* outcomes.get(stage.integrationOutcomeId);
    const landed = Option.isSome(integrated) ? integrated.value.report.integration : undefined;
    const through =
      landed?.pullRequest === undefined
        ? ""
        : ` through pull request #${landed.pullRequest.number}`;
    const marker = closeMarker(operationId);
    yield* deps.ensureOperation({
      operationId,
      factoryId: configuration.factoryId,
      itemKey,
      intent: {
        kind: "tracker_close",
        ...subject,
        marker,
        body: [
          marker,
          `T3 factory ${configuration.factoryId} closes this item after its verified integration.`,
          ...(landed === undefined
            ? []
            : [`Landed ${landed.mergeCommit} on ${landed.targetBranch}${through}.`]),
        ].join("\n\n"),
      },
    });
    return { type: "in_flight", operationId };
  });

  /** Ended integrations and closures become the outcomes their readback proved, once each. */
  const recordOutcomes = Effect.fn("FactoryLifecycle.recordNativeOutcomes")(function* (
    factoryId: FactoryId,
  ) {
    for (const operation of yield* operations.listEnded(factoryId)) {
      const { intent } = operation;
      if (intent.kind === "tracker_comment") continue;
      const outcomeId = `native:${operation.operationId}`;
      if (Option.isSome(yield* outcomes.get(outcomeId))) continue;
      let report: FactoryOutcomeStore.FactoryOutcomeReport | undefined;
      if (operation.state === "applied") {
        const receipt = operation.receipt;
        report =
          receipt.kind === "git_integrate" || receipt.kind === "pull_request_merge"
            ? {
                outcome: "integrated",
                summary:
                  receipt.attribution === "external"
                    ? `The reviewed head was already on ${receipt.branch}.`
                    : `Integrated into ${receipt.branch} as ${receipt.commit}.`,
                integration: {
                  targetBranch: receipt.branch,
                  mergeCommit: receipt.commit,
                  parents: receipt.parents,
                  tree: receipt.tree,
                  attribution: receipt.attribution,
                  ...(receipt.kind === "pull_request_merge"
                    ? { pullRequest: { repository: receipt.repository, number: receipt.number } }
                    : {}),
                },
              }
            : { outcome: "closed", summary: "Closed after verified integration." };
      } else if (
        operation.state === "failed" &&
        isIntegration(intent) &&
        isCorrectable(operation.reason)
      ) {
        report = { outcome: "failed", failure: operation.reason, summary: "Integration failed." };
      }
      if (report === undefined) continue;
      yield* outcomes.insertReported({
        outcomeId,
        factoryId,
        itemKey: operation.itemKey,
        origin: { type: "native", operationId: operation.operationId },
        stage: isIntegration(intent) ? "integrate" : "close",
        report,
        reportDigest: sha256(canonical(report)),
        ...(report.failure === undefined ? {} : { failureDigest: sha256(report.failure) }),
        reportedAt: DateTime.formatIso(yield* DateTime.now),
        state: "reported",
      });
    }
  });

  return { planIntegration, planClosure, recordOutcomes };
};
