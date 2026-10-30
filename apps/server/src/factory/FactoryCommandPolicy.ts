// @effect-diagnostics nodeBuiltinImport:off - pins and packets are sha256 digests.
import * as NodeCrypto from "node:crypto";

import {
  FactoryItemKey,
  FactoryPoolId,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  PositiveInt,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import type { TrackerIssue } from "./factoryClaimPolicy.ts";
import { subjectOf } from "./factoryOutcomes.ts";
import { expectedOutcomes, type FactoryStageType } from "./factoryStages.ts";

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const Bounded = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));

/** One item's decision from the project's policy; it chooses content and gates, never a stage. */
const PolicyDecision = Schema.Union([
  Schema.Struct({
    decision: Schema.Literal("admit"),
    title: Bounded(200),
    brief: Bounded(200_000),
    poolId: FactoryPoolId,
    units: PositiveInt,
    workspace: Schema.optional(OrchestrationV2ThreadLaunchWorkspaceStrategy),
    /** A supervised decision: it starts only by spending the owner's grant for this request. */
    grant: Schema.optional(Schema.Struct({ reason: Bounded(2_000), evidence: Bounded(200_000) })),
    /** One of the configuration's named executions, such as a builder effort. */
    execution: Schema.optional(Bounded(200)),
    /**
     * The triage outcome whose proposal this first build adopts. T3 starts it only while that
     * proposal is the item's current preparation and the build starts exactly at its base.
     */
    prepared: Schema.optional(Bounded(64)),
  }),
  /**
   * Decomposition for an item at its first stage that has no unit spec yet: a worker proposes
   * one, bound to the item version it read. Its result is evidence for the policy, never a build.
   */
  Schema.Struct({
    decision: Schema.Literal("triage"),
    title: Bounded(200),
    brief: Bounded(200_000),
    poolId: FactoryPoolId,
    units: PositiveInt,
    execution: Schema.optional(Bounded(200)),
  }),
  /**
   * A new tracker issue the item's own evidence calls for, such as the bounded correction ticket a
   * verification-only item's spec names. T3 opens it once, by durable intent and readback.
   */
  Schema.Struct({
    decision: Schema.Literal("spawn"),
    reason: Bounded(2_000),
    ticket: Schema.Struct({
      title: Bounded(200),
      body: Bounded(60_000),
      labels: Schema.Array(Bounded(100)),
      parentIssueNumber: Schema.NullOr(PositiveInt),
      /** Issues the new one blocks; normally the item itself, so it waits for its correction. */
      blocks: Schema.Array(PositiveInt),
    }),
  }),
  /** T3's own stage (integration, closure) may go ahead: the product's gates for it hold. */
  Schema.Struct({ decision: Schema.Literal("proceed") }),
  Schema.Struct({
    decision: Schema.Literal("reserve"),
    reason: Bounded(2_000),
    /** The exact evidence the owner decides on; changed evidence is another decision. */
    evidence: Bounded(200_000),
  }),
  Schema.Struct({
    decision: Schema.Literal("none"),
    reason: Bounded(2_000),
    /**
     * Why nothing starts, as a class the owner can count: `needs_routing` (no unit spec, no
     * triage yet), `triage_pending`, `not_actionable`, `proposal_pending_owner`, `waiting`,
     * `held`, `excluded` or `other`. T3 itself records `prepared_stale`.
     */
    class: Schema.optional(Bounded(64)),
  }),
  /** A product gate on integration found the work at fault; it goes back to correction. */
  Schema.Struct({ decision: Schema.Literal("fail"), failure: Bounded(20_000) }),
]);
type PolicyDecision = typeof PolicyDecision.Type;

/** The policy's answer for a pass: decisions in the order it wants them carried out. */
export const PolicyAnswer = Schema.Struct({
  decisions: Schema.Array(Schema.Struct({ itemKey: FactoryItemKey, decision: PolicyDecision })),
});
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(PolicyAnswer));
const encodeFacts = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const POLICY_TIMEOUT = "2 minutes";
/** How long an admitted decision may wait for its start before its basis must be read again. */
const ADMISSION_WINDOW = { minutes: 10 } as const;

const REPORT_REQUIREMENTS: Record<string, string> = {
  implemented: "implemented with subject.repository, subject.baseCommit and subject.headCommit",
  failed: "failed with the exact failure output",
  review_passed: "review_passed with the exact subject.headCommit you reviewed",
  review_failed:
    "review_failed with the exact subject.headCommit you reviewed and the findings as failure",
  correction_spec: "correction_spec with the specification as summary",
  unit_proposed:
    "unit_proposed with proposal.basis = the item version named above, proposal.unit = the exact unit spec text for the issue with its checks and any dependency, proposal.ownedFiles, proposal.resources and proposal.effort, subject.repository and subject.baseCommit = the commit the unit starts from, and the evidence you relied on as summary",
  not_actionable:
    "not_actionable only for what a person must settle, with failure led by its kind: `decision:` (the one question, its consequence and the exact action that answers it), `permission:`, `private_data:`, `ownership:` or `hold:`, then what is missing",
};

/** The last preparation's failure, so a retry on it can correct what it names. */
const previousPreparation = (item: FactoryLifecycle.FactoryPolicyItem) => {
  const last = item.outcomes.findLast((outcome) => outcome.stage === "triage");
  return last?.state === "verified" && last.report.outcome === "failed"
    ? [
        "The last preparation of this item ended without a usable result; correct what it names:",
        last.report.failure ?? last.report.summary,
      ]
    : [];
};

/**
 * Where verification output has to be for T3 to count it: a head already reviewed is reviewed
 * again only on artifacts T3 reads back inside the artifact root (`factoryOutcomes.ts`).
 */
const evidenceInstructions = (
  item: FactoryLifecycle.FactoryPolicyItem,
  artifactRoot: string,
  taskKind: FactoryStageType,
) => {
  if (taskKind === "triage") {
    return [
      `Item version: ${item.observation.itemVersion}. Report it as proposal.basis; a proposal for any other version is rejected.`,
      "Prepare from what you can verify: the issue, its blockers and parent, its verified outcomes, the project's rules and the repository at its integration base. Change no file and no tracker record. Settle routine gaps yourself from that evidence; a missing permission, product decision or owner hold is never yours to settle.",
      "Name subject.baseCommit: the build starts exactly there. T3 reads it back now and again when the build is admitted: it must exist and lie on the branch T3 integrates onto, as T3 reads that branch, so a proposal without a base, or with one T3 cannot read there, is rejected. The proposal is evidence for the policy, not a start or a grant.",
      ...previousPreparation(item),
    ];
  }
  const stage = item.stage;
  switch (stage.type) {
    case "implement":
    case "rework":
      return [
        `Verification output is evidence only when written under ${artifactRoot} and listed in the report's artifacts with each file's path and sha256. T3 reads every listed file back; output anywhere else is not evidence.`,
      ];
    case "correct":
      return [
        `If the correction asks for verification of the same head, it must direct that output under ${artifactRoot}, reported as artifacts: a reviewed head is reviewed again only on output T3 verifies there.`,
      ];
    case "review": {
      if (stage.evidence === undefined) return [];
      const implementation = item.outcomes.find((outcome) => outcome.outcomeId === stage.outcomeId);
      const failed = item.outcomes.findLast(
        (outcome) =>
          outcome.report.outcome === "review_failed" &&
          outcome.report.subject?.headCommit === stage.head,
      );
      return [
        `Head ${stage.head} was reviewed before and failed. This review judges the new evidence T3 verified for it:`,
        ...(implementation?.report.artifacts ?? []).map(
          (artifact) => `- ${artifact.path} (sha256 ${artifact.sha256})`,
        ),
        "Pass only if that evidence settles every finding of the failed review; the files existing is not a pass.",
        ...(failed?.report.failure === undefined
          ? []
          : ["The failed review's findings:", failed.report.failure]),
      ];
    }
    case "integrate":
    case "close":
      return [];
  }
};

/**
 * Executables the server host already runs for this factory, so a worker need not search for one.
 * Paths are JSON strings: operator-configured, they may hold spaces or quotes.
 */
const hostTooling = (policyExecutable: string) => [
  "Host tooling on the T3 server host (local paths, not available on other machines; naming them grants nothing beyond this stage's authority):",
  `- The factory's configured policy executable: ${JSON.stringify(policyExecutable)} (it ran this item's policy)`,
  `- The T3 server's Node executable: ${JSON.stringify(process.execPath)}`,
];

/** The footer T3 owns on every packet: how this stage's worker reports, whatever the brief. */
const reportFooter = (
  item: FactoryLifecycle.FactoryPolicyItem,
  artifactRoot: string,
  policyExecutable: string,
  taskKind: FactoryStageType = item.stage.type,
) =>
  [
    "---",
    ...hostTooling(policyExecutable),
    `This is a ${taskKind} stage of a T3 factory item. When its work is done, make your final action one call to the t3_factory_report tool reporting one of:`,
    ...expectedOutcomes[taskKind].map((outcome) => `- ${REPORT_REQUIREMENTS[outcome] ?? outcome}`),
    ...evidenceInstructions(item, artifactRoot, taskKind),
    "T3 reads the repository and tracker back to verify the report before any later stage starts. Settling or ending the thread is not a report.",
  ].join("\n");

const issueFacts = (itemKey: FactoryItemKey, issue: TrackerIssue) => {
  const subject = subjectOf(itemKey);
  return {
    itemKey,
    ...(subject === undefined ? {} : subject),
    state: issue.state,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    comments: issue.comments,
    ...(issue.author === undefined ? {} : { author: issue.author }),
    // Null: the tracker could not say what blocks it, which is not "nothing".
    blockedBy: issue.blockedBy ?? null,
    parent: issue.parent ?? null,
    ...(issue.subIssueCount === undefined ? {} : { subIssueCount: issue.subIssueCount }),
  };
};

const outcomeFacts = (outcome: FactoryLifecycle.FactoryPolicyOutcome) => ({
  outcomeId: outcome.outcomeId,
  stage: outcome.stage,
  state: outcome.state,
  report: outcome.report,
  ...(outcome.itemVersion === undefined ? {} : { itemVersion: outcome.itemVersion }),
  ...(outcome.policyRevision === undefined ? {} : { policyRevision: outcome.policyRevision }),
  ...(outcome.decisionKey === undefined ? {} : { decisionKey: outcome.decisionKey }),
});

/** What the policy command reads on stdin: every decidable item, and the work under way. */
export const policyInput = (
  input: Parameters<FactoryLifecycle.FactoryAdmissionProposer["decide"]>[0],
) => ({
  schema: "t3-factory-policy-input/2",
  factoryId: input.configuration.factoryId,
  policyRevision: input.configuration.policyRevision,
  items: input.items.map((item) => ({
    decisionKey: item.decisionKey,
    ...(item.triageDecisionKey === undefined ? {} : { triageDecisionKey: item.triageDecisionKey }),
    stage: item.stage,
    /** The exact text version a triage proposal must name to count for this item. */
    itemVersion: item.observation.itemVersion,
    item: issueFacts(item.observation.itemKey, item.issue),
    outcomes: item.outcomes.map(outcomeFacts),
    ...(item.blockers === undefined
      ? {}
      : {
          blockers: item.blockers.map((blocker) => ({
            itemKey: blocker.itemKey,
            outcomes: blocker.outcomes.map(outcomeFacts),
            ...(blocker.events === undefined
              ? {}
              : {
                  events: blocker.events.map((event) =>
                    event.type === "rejected"
                      ? {
                          type: event.type,
                          outcomeId: event.outcomeId,
                          failureDigest: event.failureDigest,
                        }
                      : { type: event.type, closureOutcomeId: event.closureOutcomeId },
                  ),
                }),
          })),
        }),
    reserved: item.reserved,
    grants: item.grants,
    ...(item.legacy === undefined ? {} : { legacy: item.legacy }),
  })),
  active: input.active.map((entry) => ({
    stage: entry.stage,
    custody: entry.custody,
    item: issueFacts(entry.itemKey, entry.issue),
  })),
});

const policyFailure = (reason: string): FactoryLifecycle.FactoryPolicyFailure => ({
  type: "policy_failed",
  reason,
});

/**
 * The factory's project policy as a one-shot command pinned by content. Each pass sends every
 * item it can decide, with their immutable facts, as JSON on stdin; the command answers with its
 * decisions in priority order on stdout. It holds no state, starts nothing and chooses no
 * transition: the lifecycle names each item's stage and acts on the answer itself.
 */
export const layer = Layer.effect(
  FactoryLifecycle.FactoryAdmissionPolicy,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const fs = yield* FileSystem.FileSystem;

    const decide = Effect.fn("FactoryCommandPolicy.decide")(
      function* (
        input: Parameters<FactoryLifecycle.FactoryAdmissionProposer["decide"]>[0],
      ): Effect.fn.Return<
        | ReadonlyArray<{
            readonly itemKey: FactoryItemKey;
            readonly decision: FactoryLifecycle.FactoryPolicyDecision;
          }>
        | FactoryLifecycle.FactoryPolicyFailure,
        unknown
      > {
        const { configuration, items } = input;
        const pin = configuration.policy;
        if (pin === undefined) return policyFailure("no policy command is configured");
        const script = yield* fs.readFile(pin.script).pipe(Effect.option);
        if (Option.isNone(script) || sha256(script.value) !== pin.sha256) {
          return policyFailure(`policy script ${pin.script} does not match its pin`);
        }
        const stdin = yield* encodeFacts(policyInput(input));
        const output = yield* runner
          .run({
            command: pin.executable,
            args: [pin.script],
            cwd: configuration.artifactRoot,
            stdin,
            timeout: POLICY_TIMEOUT,
            maxOutputBytes: 4 * 1024 * 1024,
          })
          .pipe(Effect.result);
        if (output._tag === "Failure") {
          return policyFailure(`policy command failed to run: ${output.failure._tag}`);
        }
        if (output.success.code !== 0) {
          return policyFailure(
            `policy command exited ${output.success.code}: ${output.success.stderr.slice(-2_000)}`,
          );
        }
        const decoded = yield* decodeAnswer(output.success.stdout.trim()).pipe(Effect.result);
        if (decoded._tag === "Failure") return policyFailure("policy answer is not a decision");
        const byKey = new Map(items.map((item) => [item.observation.itemKey, item]));
        const decisions: Array<{
          readonly itemKey: FactoryItemKey;
          readonly decision: FactoryLifecycle.FactoryPolicyDecision;
        }> = [];
        for (const { itemKey, decision } of decoded.success.decisions) {
          const item = byKey.get(itemKey);
          if (item === undefined) continue;
          decisions.push({
            itemKey,
            decision: yield* translate(configuration, pin, item, decision),
          });
        }
        return decisions;
      },
      Effect.catchCause(() => Effect.succeed(policyFailure("policy could not decide"))),
    );

    const translate = Effect.fnUntraced(function* (
      configuration: Parameters<
        FactoryLifecycle.FactoryAdmissionProposer["decide"]
      >[0]["configuration"],
      pin: { readonly executable: string },
      item: FactoryLifecycle.FactoryPolicyItem,
      decision: PolicyDecision,
    ): Effect.fn.Return<FactoryLifecycle.FactoryPolicyDecision> {
      switch (decision.decision) {
        case "none": {
          const nothing: FactoryLifecycle.FactoryNothingProposed = {
            type: "none",
            reason: decision.reason,
            ...(decision.class === undefined ? {} : { class: decision.class }),
          };
          return nothing;
        }
        case "spawn": {
          const spawn: FactoryLifecycle.FactorySpawnRequest = {
            type: "spawn",
            reason: decision.reason,
            ticket: decision.ticket,
          };
          return spawn;
        }
        case "triage": {
          const text = `${decision.brief}\n\n${reportFooter(item, configuration.artifactRoot, pin.executable, "triage")}`;
          const request: FactoryLifecycle.FactoryAdmissionRequest = {
            factoryId: configuration.factoryId,
            itemKey: item.observation.itemKey,
            taskKind: "triage",
            policyRevision: configuration.policyRevision,
            basis: {
              observationId: item.observation.observationId,
              deadline: DateTime.add(yield* DateTime.now, ADMISSION_WINDOW),
            },
            poolId: decision.poolId,
            units: decision.units,
            title: decision.title,
            packet: {
              text,
              sha256: sha256(text),
              briefSchemaVersion: configuration.packet.briefSchemaVersion,
              helperSha256: configuration.packet.helper?.sha256 ?? null,
            },
            artifactPaths: [],
            ...(decision.execution === undefined ? {} : { execution: decision.execution }),
          };
          return request;
        }
        case "proceed": {
          const proceed: FactoryLifecycle.FactoryProceed = { type: "proceed" };
          return proceed;
        }
        case "fail": {
          const failed: FactoryLifecycle.FactoryGateFailure = {
            type: "gate_failed",
            failure: decision.failure,
          };
          return failed;
        }
        case "reserve": {
          const reservation: FactoryLifecycle.FactoryReservation = {
            type: "reserve",
            reason: decision.reason,
            evidenceDigest: sha256(decision.evidence),
          };
          return reservation;
        }
        case "admit": {
          const stage = item.stage.type;
          const text = `${decision.brief}\n\n${reportFooter(item, configuration.artifactRoot, pin.executable)}`;
          const request: FactoryLifecycle.FactoryAdmissionRequest = {
            factoryId: configuration.factoryId,
            itemKey: item.observation.itemKey,
            taskKind: stage,
            policyRevision: configuration.policyRevision,
            basis: {
              observationId: item.observation.observationId,
              deadline: DateTime.add(yield* DateTime.now, ADMISSION_WINDOW),
            },
            poolId: decision.poolId,
            units: decision.units,
            title: decision.title,
            packet: {
              text,
              sha256: sha256(text),
              briefSchemaVersion: configuration.packet.briefSchemaVersion,
              helperSha256: configuration.packet.helper?.sha256 ?? null,
            },
            artifactPaths: [],
            ...(decision.workspace === undefined ? {} : { workspaceStrategy: decision.workspace }),
            ...(decision.execution === undefined ? {} : { execution: decision.execution }),
            ...(decision.prepared === undefined ? {} : { prepared: decision.prepared }),
            ...(decision.grant === undefined
              ? {}
              : {
                  requiresGrant: {
                    reason: decision.grant.reason,
                    evidenceDigest: sha256(decision.grant.evidence),
                  },
                }),
          };
          return request;
        }
      }
    });

    return {
      forFactory: ({ configuration }) =>
        configuration.policy === undefined ? Option.none() : Option.some({ decide }),
    };
  }),
);
