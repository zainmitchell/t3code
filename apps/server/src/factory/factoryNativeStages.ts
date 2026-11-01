// @effect-diagnostics nodeBuiltinImport:off - operation identities are sha256 digests.
import * as NodeCrypto from "node:crypto";

import {
  FACTORY_TICKET_DECISION_STAGE,
  type FactoryId,
  type FactoryItemKey,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as ProjectService from "../project/ProjectService.ts";
import type * as FactoryIntegrator from "./FactoryIntegrator.ts";
import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { canonical, type EnsureOperationError, subjectOf } from "./factoryOutcomes.ts";
import {
  ACKNOWLEDGEMENT_MARKER,
  isMergedElsewhere,
  PULL_REQUEST_NOT_CREATED,
  REVIEW_CHANGES_REQUESTED,
  reviewedHeadInBase,
} from "./factoryPullRequests.ts";
import { type FactoryStage, stageBasis } from "./factoryStages.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** The closing record's marker, found before any write. */
const closeMarker = (operationId: string) => `<!-- t3-factory-close:${operationId} -->`;

/** The stage of T3's own question about a ticket create; no policy asks or answers it. */
export const TICKET_DECISION_STAGE = FACTORY_TICKET_DECISION_STAGE;

/** Failures that are the work's to correct; any other failure is the configuration's. */
export const isCorrectable = (reason: string) =>
  reason.startsWith("conflict:") ||
  reason.startsWith("not_fast_forward:") ||
  reason.startsWith("checks_failed:") ||
  reason.startsWith(REVIEW_CHANGES_REQUESTED) ||
  // Only the work can adopt the merged head and have exactly it reviewed.
  isMergedElsewhere(reason);

const isIntegration = (intent: FactoryOperationStore.FactoryOperationIntent) =>
  intent.kind === "git_integrate" || intent.kind === "pull_request_merge";

/** The one after-integration command operation an integration outcome gets. */
export const landedOperationId = (factoryId: FactoryId, outcomeId: string) =>
  `landed:${sha256(canonical([factoryId, outcomeId])).slice(0, 40)}`;

/** What an after-integration command reads on stdin: native facts only, never tracker text. */
export const LANDED_INPUT_SCHEMA = "t3-factory-landed/1";
const encodeLandedInput = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export type NativeStagePlan =
  | { readonly type: "in_flight"; readonly operationId: string }
  | { readonly type: "issue"; readonly issue: string }
  /** Custody moved since the pass weighed it, so the new operation was not recorded. */
  | { readonly type: "custody_changed" };

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
  /** As `ensureOperation` for a new operation, recorded only beside the custody its pass weighed. */
  readonly ensureFencedOperation: (
    input: {
      readonly operationId: string;
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly intent: FactoryOperationStore.FactoryOperationIntent;
    },
    fence: FactoryStore.CustodyFence,
  ) => Effect.Effect<Option.Option<FactoryOperationStore.FactoryOperation>, EnsureOperationError>;
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

  /**
   * The owner's question about a ticket create a later search could not find, settled each pass.
   * "abandon" ends the create; "approve" waits for planTicket to spend it; any other answer, or a
   * question superseded from outside, is followed by the next round.
   */
  const settleTicketCreate = Effect.fnUntraced(function* (
    operation: FactoryOperationStore.FactoryOperation,
    decisions: ReadonlyArray<FactoryOutcomeStore.ReservedDecision>,
  ) {
    const { intent } = operation;
    const pending = operation.createPending;
    if (intent.kind !== "tracker_create_issue" || pending === undefined) return undefined;
    const digestOf = (attempt: number, round: number) =>
      sha256(`${operation.operationId}\n${attempt}\n${round}`);
    const asked = new Map(
      decisions
        .filter((decision) => decision.stage === TICKET_DECISION_STAGE)
        .map((decision) => [decision.evidenceDigest, decision]),
    );
    const roundsOf = (attempt: number) => {
      const rounds: Array<FactoryOutcomeStore.ReservedDecision> = [];
      for (let question = asked.get(digestOf(attempt, 1)); question !== undefined;) {
        rounds.push(question);
        question = asked.get(digestOf(attempt, rounds.length + 1));
      }
      return rounds;
    };
    const held =
      operation.state === "intended" &&
      operation.createdIssue === undefined &&
      pending.cleared === undefined &&
      pending.unconfirmedAt !== undefined;
    // Questions about creates no longer held are moot.
    for (let attempt = 1; attempt <= pending.attempt; attempt++) {
      if (held && attempt === pending.attempt) continue;
      for (const question of roundsOf(attempt)) {
        if (question.state !== "pending") continue;
        yield* outcomes.supersedeDecision({
          decisionId: question.decisionId,
          reason: "the ticket's issue was found, or its create settled",
        });
      }
    }
    if (!held) return undefined;
    const rounds = roundsOf(pending.attempt);
    for (const question of rounds) {
      if (question.state === "pending") return question;
      const answer = question.resolution?.answer.trim().toLowerCase();
      // Only the planning that still asks for this ticket spends an approval: see planTicket.
      if (answer === "approve") return question;
      if (answer === "abandon") {
        yield* operations.complete({
          operationId: operation.operationId,
          completion: {
            state: "failed",
            reason: `abandoned: the owner abandoned this ticket's create in decision ${question.decisionId}; T3 sends no create and stops looking for ${intent.marker}, and an issue carrying it may exist`,
          },
        });
        return undefined;
      }
    }
    const previous = rounds.at(-1);
    const evidenceDigest = digestOf(pending.attempt, rounds.length + 1);
    return yield* outcomes.reserveDecision({
      decisionId: sha256(
        [
          operation.factoryId,
          operation.itemKey,
          TICKET_DECISION_STAGE,
          "gate",
          evidenceDigest,
        ].join("\n"),
      ).slice(0, 40),
      factoryId: operation.factoryId,
      itemKey: operation.itemKey,
      stage: TICKET_DECISION_STAGE,
      reason: [
        ...(previous?.resolution === undefined
          ? []
          : [
              `Decision ${previous.decisionId} was answered "${previous.resolution.answer}", not "approve": still held.`,
            ]),
        `Ticket "${intent.title}" may already exist: a create was sent at ${pending.at} and no issue in ${intent.repository} carries ${intent.marker} yet. Search the repository for that marker. If an issue carries it, T3 continues on it once GitHub lists it while the ticket is still asked for. Answer "approve" only if none does, and T3 sends the create once more when the ticket is next asked for; answer "abandon" to send nothing and stop looking.`,
      ].join(" "),
      evidenceDigest,
      kind: "gate",
    });
  });

  /** Every ticket create's owner question, settled once per pass. */
  const settleTicketCreates = Effect.fn("FactoryLifecycle.settleTicketCreates")(function* (
    factoryId: FactoryId,
  ) {
    const decisions = yield* outcomes.reservedDecisions(factoryId);
    const open = decisions.some(
      (decision) => decision.stage === TICKET_DECISION_STAGE && decision.state === "pending",
    );
    // Ended operations matter only while a question about one may still be open.
    const operationsToSettle = [
      ...(yield* operations.listIntended(factoryId)),
      ...(open ? yield* operations.listEnded(factoryId) : []),
    ].filter((operation) => operation.createPending !== undefined);
    for (const operation of operationsToSettle) {
      yield* settleTicketCreate(operation, decisions);
    }
  });

  /**
   * A pull request GitHub refused to open because the base already held the reviewed head. Only
   * a fresh read of the base containing exactly that head lets a new attempt acknowledge it; an
   * unreadable base keeps the refusal.
   */
  const refusedCreateSinceLanded = Effect.fnUntraced(function* (
    operation: FactoryOperationStore.FactoryOperation,
    integration: NonNullable<FactoryStore.FactoryConfiguration["integration"]>,
  ) {
    const { intent } = operation;
    if (
      operation.state !== "failed" ||
      !operation.reason.startsWith(PULL_REQUEST_NOT_CREATED) ||
      intent.kind !== "pull_request_merge" ||
      integration.mode !== "pull_request"
    ) {
      return false;
    }
    const project = yield* deps.projects.getById(intent.projectId);
    if (Option.isNone(project)) return false;
    const contained = yield* reviewedHeadInBase(deps.integrator, {
      cwd: project.value.workspaceRoot,
      intent: {
        base: integration.branch,
        remote: integration.remote,
        marker: intent.marker,
        reviewedHead: intent.reviewedHead,
      },
    }).pipe(Effect.orElseSucceed(() => Option.none()));
    return Option.isSome(contained);
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
    readonly fence: FactoryStore.CustodyFence;
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
    const acknowledging =
      latest !== undefined && (yield* refusedCreateSinceLanded(latest, integration));
    if (latest !== undefined && latest.state !== "stale" && !acknowledging) {
      if (latest.state === "failed" && !isCorrectable(latest.reason)) {
        return { type: "issue", issue: latest.reason };
      }
      // A correctable failure holds the item until its stages have read its outcome, which sends
      // the work to correction: it is never retried for its own review. Once read, an item that
      // integrates this head again does so on a later review, which gets its own attempt.
      const failure =
        latest.state === "failed"
          ? yield* outcomes.get(`native:${latest.operationId}`)
          : Option.none<FactoryOutcomeStore.FactoryOutcome>();
      if (Option.isNone(failure) || failure.value.state === "reported") {
        yield* keepLive(latest);
        return { type: "in_flight", operationId: latest.operationId };
      }
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
      const merging = yield* deps.ensureFencedOperation(
        {
          operationId,
          factoryId: configuration.factoryId,
          itemKey,
          intent: {
            kind: "pull_request_merge",
            projectId: configuration.projectId,
            repository: integration.repository,
            remote: integration.remote,
            base: integration.branch,
            // T3's own branch: one a worker reports is never a push target (main, say).
            head: `t3-factory/${configuration.factoryId}/${issue.issueNumber}`,
            reviewedHead: stage.head,
            reviewOutcomeId: stage.reviewOutcomeId,
            method: integration.method,
            // The stored marker keeps a recovery from a refused create read-only across restarts.
            marker: `${acknowledging ? ACKNOWLEDGEMENT_MARKER : "T3-Factory-Operation: "}${operationId}`,
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
        },
        input.fence,
      );
      return Option.isNone(merging)
        ? { type: "custody_changed" }
        : { type: "in_flight", operationId };
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
    const integrating = yield* deps.ensureFencedOperation(
      {
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
          reviewOutcomeId: stage.reviewOutcomeId,
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
      },
      input.fence,
    );
    return Option.isNone(integrating)
      ? { type: "custody_changed" }
      : { type: "in_flight", operationId };
  });

  const planClosure = Effect.fnUntraced(function* (input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
    readonly itemKey: FactoryItemKey;
    readonly stage: Extract<FactoryStage, { readonly type: "close" }>;
    readonly fence: FactoryStore.CustodyFence;
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
    const closing = yield* deps.ensureFencedOperation(
      {
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
      },
      input.fence,
    );
    return Option.isNone(closing)
      ? { type: "custody_changed" }
      : { type: "in_flight", operationId };
  });

  /**
   * A parent whose adopted criteria T3 found proved, clause by clause, from its own records: closed
   * once per criteria document by the existing closing operation, its record naming every landing.
   * A parent is never built or integrated itself, so this is its only closure.
   */
  const planParentClosure = Effect.fnUntraced(function* (input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
    readonly itemKey: FactoryItemKey;
    readonly criteriaSha256: string;
    /** The closure a reopen ended, so a parent reopened on the same criteria can close again. */
    readonly reopenOf: string | undefined;
    readonly evidence: ReadonlyArray<string>;
    readonly fence: FactoryStore.CustodyFence;
  }): Effect.fn.Return<NativeStagePlan, NativeStageError> {
    const { configuration, itemKey } = input;
    const subject = subjectOf(itemKey);
    if (configuration.claim === undefined || subject === undefined) {
      return { type: "issue", issue: "the parent has no tracker to close" };
    }
    const operationId = `close:parent:${sha256(canonical([configuration.factoryId, itemKey, input.criteriaSha256, input.reopenOf ?? null])).slice(0, 40)}`;
    const existing = yield* operations.get(operationId);
    if (Option.isSome(existing)) {
      if (existing.value.state === "failed") return { type: "issue", issue: existing.value.reason };
      yield* keepLive(existing.value);
      return { type: "in_flight", operationId };
    }
    const marker = closeMarker(operationId);
    const closing = yield* deps.ensureFencedOperation(
      {
        operationId,
        factoryId: configuration.factoryId,
        itemKey,
        intent: {
          kind: "tracker_close",
          ...subject,
          marker,
          body: [
            marker,
            `T3 factory ${configuration.factoryId} closes this parent: every required clause of its adopted criteria (sha256 ${input.criteriaSha256}) is proved by landed work.`,
            ...input.evidence,
          ].join("\n\n"),
        },
      },
      input.fence,
    );
    return Option.isNone(closing)
      ? { type: "custody_changed" }
      : { type: "in_flight", operationId };
  });

  /**
   * A tracker issue the policy asked for on the item's evidence (a verification-only item's
   * correction ticket): one intent per item and stage basis. The text is not part of its identity,
   * so a reworded ask for the same failure joins the first ticket instead of opening another. Its
   * readback becomes the item's `ticket_opened` outcome.
   */
  const planTicket = Effect.fnUntraced(function* (input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
    readonly itemKey: FactoryItemKey;
    readonly stage: Extract<
      FactoryStage,
      { readonly type: "implement" | "review" | "correct" | "rework" }
    >;
    readonly subject: { readonly repository: string; readonly issueNumber: number };
    /** Whether the item's issue is open as just read; a closed one's held create waits. */
    readonly issueOpen: boolean;
    readonly ticket: {
      readonly title: string;
      readonly body: string;
      readonly labels: ReadonlyArray<string>;
      readonly parentIssueNumber: number | null;
      readonly blocks: ReadonlyArray<number>;
    };
    readonly fence: FactoryStore.CustodyFence;
  }): Effect.fn.Return<NativeStagePlan, NativeStageError> {
    const { configuration, itemKey, stage, subject, ticket } = input;
    const basis = stageBasis(stage);
    const operationId = `ticket:${sha256(canonical([configuration.factoryId, itemKey, basis])).slice(0, 40)}`;
    const existing = yield* operations.get(operationId);
    if (Option.isSome(existing)) {
      const operation = existing.value;
      const question = yield* settleTicketCreate(
        operation,
        yield* outcomes.reservedDecisions(configuration.factoryId),
      );
      // Settling may have ended it (an abandoned create).
      const current = Option.getOrElse(yield* operations.get(operationId), () => operation);
      if (current.state === "failed") return { type: "issue", issue: current.reason };
      // A held create is looked for, or sent on its approval, only while its ticket is asked for
      // on an open issue: a later ask is what makes an old approval current.
      const held = current.createPending !== undefined && current.createdIssue === undefined;
      if (held && !input.issueOpen) {
        return {
          type: "issue",
          issue: `the item's issue is closed; its ticket create waits${question === undefined ? "" : `. ${question.reason}`}`,
        };
      }
      if (question?.state === "resolved" && current.createPending !== undefined) {
        yield* operations.clearCreatePending({
          operationId,
          attempt: current.createPending.attempt,
          by: `owner decision ${question.decisionId}`,
        });
        yield* keepLive(current);
        return { type: "in_flight", operationId };
      }
      yield* keepLive(current);
      return question === undefined
        ? { type: "in_flight", operationId }
        : { type: "issue", issue: question.reason };
    }
    const marker = `<!-- t3-factory-ticket:${operationId} -->`;
    const creating = yield* deps.ensureFencedOperation(
      {
        operationId,
        factoryId: configuration.factoryId,
        itemKey,
        intent: {
          kind: "tracker_create_issue",
          repository: subject.repository,
          issueNumber: subject.issueNumber,
          marker,
          title: ticket.title,
          body: `${ticket.body.trimEnd()}\n\n${marker}\n`,
          labels: ticket.labels,
          parentIssueNumber: ticket.parentIssueNumber,
          blocks: ticket.blocks,
          since: DateTime.formatIso(yield* DateTime.now),
          stage: stage.type,
        },
      },
      input.fence,
    );
    return Option.isNone(creating)
      ? { type: "custody_changed" }
      : { type: "in_flight", operationId };
  });

  /**
   * The configured after-integration command for an integration T3 proved landed: one intent per
   * outcome, recorded before that outcome so a crash between the two still runs it. It gets no
   * outbox effect; each pass hands every intended one to FactoryLandedCommands instead, so a long
   * build never holds an effect worker.
   */
  const intendLanded = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration | undefined,
    operation: FactoryOperationStore.FactoryOperation,
    outcomeId: string,
    integration: NonNullable<FactoryOutcomeStore.FactoryOutcomeReport["integration"]>,
  ) {
    const command = configuration?.afterIntegration;
    const { intent } = operation;
    if (
      command === undefined ||
      (intent.kind !== "git_integrate" && intent.kind !== "pull_request_merge")
    ) {
      return;
    }
    const operationId = landedOperationId(operation.factoryId, outcomeId);
    const input = encodeLandedInput({
      schema: LANDED_INPUT_SCHEMA,
      factoryId: operation.factoryId,
      itemKey: operation.itemKey,
      outcomeId,
      operationId,
      subject: subjectOf(operation.itemKey) ?? null,
      configurationRevision: configuration?.revision ?? null,
      policyRevision: configuration?.policyRevision ?? null,
      review: { outcomeId: intent.reviewOutcomeId ?? null, head: intent.reviewedHead },
      integration: {
        targetBranch: integration.targetBranch,
        remote: intent.remote,
        mergeCommit: integration.mergeCommit,
        parents: integration.parents,
        tree: integration.tree,
        attribution: integration.attribution,
        ...(integration.pullRequest === undefined ? {} : { pullRequest: integration.pullRequest }),
      },
    });
    yield* operations.intend({
      operationId,
      factoryId: operation.factoryId,
      itemKey: operation.itemKey,
      intent: {
        kind: "landed_command",
        outcomeId,
        command: {
          executable: command.executable,
          script: command.script,
          sha256: command.sha256,
          timeoutSeconds: command.timeoutSeconds,
        },
        input,
      },
    });
  });

  /** Ended integrations, closures and ticket creations become the outcomes their readback proved. */
  const recordOutcomes = Effect.fn("FactoryLifecycle.recordNativeOutcomes")(function* (
    factoryId: FactoryId,
    configuration?: FactoryStore.FactoryConfiguration,
  ) {
    for (const operation of yield* operations.listEnded(factoryId)) {
      const { intent } = operation;
      if (intent.kind === "tracker_comment" || intent.kind === "landed_command") continue;
      const outcomeId = `native:${operation.operationId}`;
      if (Option.isSome(yield* outcomes.get(outcomeId))) continue;
      if (intent.kind === "tracker_create_issue") {
        if (operation.state !== "applied" || operation.receipt.kind !== "tracker_create_issue") {
          continue;
        }
        const receipt = operation.receipt;
        const report: FactoryOutcomeStore.FactoryOutcomeReport = {
          outcome: "ticket_opened",
          summary: `Opened ${receipt.repository}#${receipt.number} (${intent.title}) for this item; it blocks ${intent.blocks.map((number) => `#${number}`).join(", ") || "nothing"}.`,
          ticket: { repository: receipt.repository, number: receipt.number },
        };
        yield* outcomes.insertReported({
          outcomeId,
          factoryId,
          itemKey: operation.itemKey,
          origin: { type: "native", operationId: operation.operationId },
          stage: intent.stage,
          report,
          reportDigest: sha256(canonical(report)),
          reportedAt: DateTime.formatIso(yield* DateTime.now),
          state: "reported",
        });
        continue;
      }
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
      if (report.integration !== undefined) {
        yield* intendLanded(configuration, operation, outcomeId, report.integration);
      }
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

  return {
    planIntegration,
    planClosure,
    planParentClosure,
    planTicket,
    recordOutcomes,
    settleTicketCreates,
  };
};
