// @effect-diagnostics nodeBuiltinImport:off - sha256 of small identity strings.
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  FactoryDecisionKey,
  factoryCardRequestId,
  FactoryId,
  FactoryItemKey,
  type FactoryObservationId,
  type FactoryPoolId,
  type FactoryReadGeneration,
  type FactoryReportFailure,
  type FactoryReportInput,
  type FactoryReportResult,
  type FactoryReservationId,
  MessageId,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type OrchestrationV2UserInputQuestion,
  parseFactoryCardRequestId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, sanitizeBranchFragment } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as CommandJobFence from "../commandJobs/CommandJobFence.ts";
import * as CommandJobs from "../commandJobs/CommandJobs.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import {
  type HelperInvocationRefusal,
  isEligible,
  issueObservation,
  mayBeReadyOrClaimed,
  type TrackerIssue,
  validateHelperInvocations,
} from "./factoryClaimPolicy.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import { type FactoryCustody, owedWakes, readExecutionCustody } from "./factoryCustody.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import * as FactoryTracker from "./FactoryTracker.ts";
import * as FactoryGitReadback from "./FactoryGitReadback.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { canonical, makeFactoryOutcomes, subjectOf } from "./factoryOutcomes.ts";
import { makeNativeStages } from "./factoryNativeStages.ts";
import { makeBookkeeping } from "./factoryBookkeeping.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryTransferStore from "./FactoryTransferStore.ts";
import {
  type FactoryTransferInput,
  type FactoryTransferResult,
  latestTransfers,
  makeTransfers,
} from "./factoryTransfers.ts";
import { forkParked } from "../serverActivation.ts";
import {
  AGENT_STAGES,
  type FactoryStage,
  type FactoryStageType,
  nextStage,
  stageBasis,
} from "./factoryStages.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";

const LIFECYCLE_STAGES: ReadonlySet<string> = new Set([
  "implement",
  "review",
  "correct",
  "rework",
  "integrate",
  "close",
]);
const isLifecycleStage = (taskKind: string): taskKind is FactoryStageType =>
  LIFECYCLE_STAGES.has(taskKind);

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/** The marker a reserved decision's tracker record carries, found before any write. */
const decisionMarker = (decisionId: string) => `<!-- t3-factory-decision:${decisionId} -->`;

type DecidedProposal = Exclude<FactoryPolicyDecision, undefined>;

const isReservationRequest = (proposal: DecidedProposal): proposal is FactoryReservation =>
  "type" in proposal && proposal.type === "reserve";

const isGateFailure = (proposal: DecidedProposal): proposal is FactoryGateFailure =>
  "type" in proposal && proposal.type === "gate_failed";

const isProceed = (proposal: DecidedProposal): proposal is FactoryProceed =>
  "type" in proposal && proposal.type === "proceed";

const isNothingProposed = (proposal: DecidedProposal): proposal is FactoryNothingProposed =>
  "type" in proposal && proposal.type === "none";

const isPolicyFailure = (
  proposal: DecidedProposal | ReadonlyArray<unknown>,
): proposal is FactoryPolicyFailure =>
  !Array.isArray(proposal) && "type" in proposal && proposal.type === "policy_failed";

/**
 * Why a pending owner decision no longer stands once a pass decided its item on fresh facts: the
 * item moved to another stage, or the policy now asks about other evidence or not at all. A pass
 * that could not decide the item overtakes nothing.
 */
const overtakenBy = (
  pending: FactoryOutcomeStore.ReservedDecision,
  stage: FactoryStage,
  decision: FactoryPolicyDecision,
): string | undefined => {
  if (pending.stage !== stage.type) return `the item moved on to its ${stage.type} stage`;
  if (decision === undefined || isPolicyFailure(decision) || isNothingProposed(decision)) {
    return undefined;
  }
  const asks = isReservationRequest(decision)
    ? { kind: "gate", evidenceDigest: decision.evidenceDigest }
    : isProceed(decision) || isGateFailure(decision) || decision.requiresGrant === undefined
      ? undefined
      : { kind: "grant", evidenceDigest: decision.requiresGrant.evidenceDigest };
  if (asks === undefined) return "the policy no longer asks the owner";
  return asks.kind === (pending.kind ?? "gate") && asks.evidenceDigest === pending.evidenceDigest
    ? undefined
    : "the evidence it was asked on changed";
};

/** An answer to a factory card the factory refused, with the reason its owner sees. */
export class FactoryCardRefused extends Schema.TaggedError<FactoryCardRefused>()(
  "FactoryCardRefused",
  { message: Schema.String },
) {}
const isFactoryCardRefused = Schema.is(FactoryCardRefused);

export class FactoryLifecycleError extends Schema.TaggedError<FactoryLifecycleError>()(
  "FactoryLifecycleError",
  {
    operation: Schema.String,
    factoryId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Factory ${this.operation} failed for ${this.factoryId}.`;
  }
}

const isLifecycleError = Schema.is(FactoryLifecycleError);

/** An owner's configuration document that does not decode; nothing was installed. */
export class FactoryConfigurationInvalid extends Schema.TaggedError<FactoryConfigurationInvalid>()(
  "FactoryConfigurationInvalid",
  { reason: Schema.String },
) {
  override get message(): string {
    return `The factory configuration is not valid: ${this.reason}`;
  }
}

const decodeConfigurationDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FactoryStore.FactoryConfigurationInput),
);

export type FactoryConfigurationInput = FactoryStore.FactoryConfigurationInput;
export type ItemObservationInput = FactoryStore.ItemObservationInput;
export type ItemObservationResult = FactoryStore.ItemObservationResult;

export interface FactoryAdmissionRequest {
  readonly factoryId: FactoryId;
  readonly itemKey: FactoryItemKey;
  readonly taskKind: string;
  readonly policyRevision: string;
  /**
   * The recorded observation this decision was made from, and the latest time its execution may
   * still start. The observation's evidence, not timing or actor, is the decision.
   */
  readonly basis: {
    readonly observationId: FactoryObservationId;
    readonly deadline: DateTime.Utc;
  };
  readonly poolId: FactoryPoolId;
  readonly units: number;
  readonly title: string;
  readonly packet: {
    readonly text: string;
    readonly sha256: string;
    readonly briefSchemaVersion: string;
    readonly helperSha256: string | null;
  };
  readonly artifactPaths: ReadonlyArray<string>;
  readonly workspaceStrategy?: OrchestrationV2ThreadLaunchWorkspaceStrategy;
  /**
   * The lifecycle stage this decision is, with its exact basis; set by the lifecycle, not the
   * policy. A later stage also names the reservation whose claim owns the item.
   */
  readonly stage?: { readonly type: FactoryStageType; readonly basis: string };
  readonly continues?: FactoryReservationId;
  /**
   * Set by policy for a supervised decision: it starts only by spending a finite owner grant
   * for this exact item, stage and request evidence.
   */
  readonly requiresGrant?: { readonly reason: string; readonly evidenceDigest: string };
  /** A configured execution the policy chose by name for this decision. */
  readonly execution?: string;
  /** The grant the lifecycle found for it; set by the lifecycle, spent in the admission commit. */
  readonly grant?: {
    readonly grantId: string;
    readonly stage: string;
    readonly evidenceDigest: string;
  };
}

export type FactoryAdmissionRefusal =
  | FactoryStore.FactoryReservationRefusal
  | "factory_not_configured"
  | "unknown_observation"
  | "policy_revision_mismatch"
  | "packet_digest_mismatch"
  | "brief_schema_mismatch"
  | "helper_pin_mismatch"
  | "helper_unavailable"
  | "artifact_path_outside_root"
  | "claim_target_missing"
  | "workspace_branch_temporary"
  | "unknown_execution"
  | HelperInvocationRefusal;

export type FactoryAdmissionResult =
  | { readonly type: "admitted"; readonly reservation: FactoryStore.FactoryReservation }
  | { readonly type: "existing"; readonly reservation: FactoryStore.FactoryReservation }
  | { readonly type: "refused"; readonly reason: FactoryAdmissionRefusal };

export type FactoryTrigger =
  | "tracker_event"
  | "clock"
  | "restart"
  | "outcome"
  | "owner_decision"
  | "operation";

/** Why a pass did or did not start work for an item, so an idle factory explains itself. */
export type FactoryItemDisposition =
  | "admitted"
  | "existing"
  | `refused:${FactoryAdmissionRefusal}`
  | "policy_unavailable"
  | "read_superseded"
  | "done"
  | "reopened"
  | "in_progress"
  | "not_owned"
  | "foreign_claim"
  | "not_eligible"
  | "nothing_proposed"
  | "reserved_decision"
  | "stage_mismatch"
  | "policy_failed"
  | "integrating"
  | "closing"
  | "awaiting_grant"
  | "read_deadline"
  | "read_failed"
  | "blocked"
  /** A transfer of it is draining its legacy writer, or was rolled back to it. */
  | "legacy_owned"
  /** Transferred, with its legacy writer's custody held until the owner disposes of it. */
  | "legacy_custody"
  /** A product gate refused T3's own stage; the failure goes to correction. */
  | "gate_failed";

export interface FactoryItemDispositionRecord {
  readonly itemKey: FactoryItemKey;
  readonly stage: FactoryStage["type"] | null;
  readonly disposition: FactoryItemDisposition;
  readonly detail?: string;
  readonly at: string;
}

export type FactoryReconcileResult =
  | FactoryCollectionResult
  | { readonly type: "idle"; readonly reason: "not_configured" | "no_claim" };

/** How long a stranded claim waits after a failed replay before a pass gives it another. */
const REPLAY_PAUSE = { minutes: 30 } as const;

export interface FactoryCollectionInput {
  readonly factoryId: FactoryId;
  /** What asked for the pass; triggers that arrive while one runs coalesce into one more pass. */
  readonly trigger: FactoryTrigger;
  /** Items to read; they stay pending, across restarts, until a pass with a policy reads them. */
  readonly subjects: ReadonlyArray<{ readonly repository: string; readonly issueNumber: number }>;
}

/** One item a pass could decide, with every native fact policy may need for it. */
export interface FactoryPolicyItem {
  readonly observation: FactoryStore.ItemObservation;
  readonly issue: TrackerIssue;
  /** The item's next lifecycle stage, from its verified outcomes. */
  readonly stage: Exclude<FactoryStage, { readonly type: "done" }>;
  /** The item's reserved decisions, pending and resolved, for the gates that need them. */
  readonly reserved: ReadonlyArray<FactoryOutcomeStore.ReservedDecision>;
  /** The finite owner grants issued for the item. */
  readonly grants: ReadonlyArray<FactoryStore.FactoryGrant>;
  /** The item's verified outcomes in lifecycle order: the heads, failures and receipts so far. */
  readonly outcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>;
  /** The decision a request for this stage would be, so its packet can name its work key. */
  readonly decisionKey: FactoryDecisionKey;
  /**
   * The legacy work a transfer handed over for the item, so a brief can continue from it rather
   * than start again. Its identities as recorded; never proof that work ended.
   */
  readonly legacy?: {
    readonly transferId: string;
    readonly job: string;
    readonly workers: ReadonlyArray<FactoryTransferStore.LegacyWorker>;
  };
}

/**
 * An item whose work is under way, so a policy can keep new work clear of it: a running stage,
 * transferred legacy work whose custody is still held, or an open item someone else's claim holds.
 */
export interface FactoryPolicyActive {
  readonly itemKey: FactoryItemKey;
  readonly stage: FactoryStageType;
  readonly custody: "native" | "legacy" | "foreign";
  readonly issue: TrackerIssue;
}

/** T3's own stage (integration, closure) may go ahead: every product gate for it holds. */
export interface FactoryProceed {
  readonly type: "proceed";
}

/**
 * A product gate on integration found the work at fault, such as a new privacy finding against
 * its base. It is the work's to correct, so it is recorded as the stage's failure.
 */
export interface FactoryGateFailure {
  readonly type: "gate_failed";
  readonly failure: string;
}

/** The policy starts nothing for the item now, and says why, so its state can explain it. */
export interface FactoryNothingProposed {
  readonly type: "none";
  readonly reason: string;
}

/** One item's decision: a worker's admission, a reserved gate, a native go-ahead, or nothing. */
export type FactoryPolicyDecision =
  | FactoryAdmissionRequest
  | FactoryReservation
  | FactoryProceed
  | FactoryGateFailure
  | FactoryPolicyFailure
  | FactoryNothingProposed
  | undefined;

export interface FactoryAdmissionProposer {
  /**
   * Decides every item a pass can decide, in one call. The answer's order is the order the
   * lifecycle acts in, so capacity goes to the policy's first choices; an item left out has
   * nothing to do now.
   */
  readonly decide: (input: {
    readonly configuration: FactoryStore.FactoryConfiguration;
    readonly items: ReadonlyArray<FactoryPolicyItem>;
    readonly active: ReadonlyArray<FactoryPolicyActive>;
  }) => Effect.Effect<
    | ReadonlyArray<{ readonly itemKey: FactoryItemKey; readonly decision: FactoryPolicyDecision }>
    | FactoryPolicyFailure
  >;
}

/** A proposer that decides each item on its own, in the order the pass read them. */
export const perItemPolicy = (
  propose: (
    input: { readonly configuration: FactoryStore.FactoryConfiguration } & FactoryPolicyItem,
  ) => Effect.Effect<FactoryPolicyDecision>,
): FactoryAdmissionProposer => ({
  decide: ({ configuration, items }) =>
    Effect.forEach(items, (item) =>
      Effect.map(propose({ configuration, ...item }), (decision) => ({
        itemKey: item.observation.itemKey,
        decision,
      })),
    ),
});

/** The policy could not decide: its pin, process or answer was not usable. Nothing starts. */
export interface FactoryPolicyFailure {
  readonly type: "policy_failed";
  readonly reason: string;
}

/**
 * A gate only the owner can open: recorded once per exact evidence, visible until resolved, and
 * never cleared by a timer or a generic accept.
 */
export interface FactoryReservation {
  readonly type: "reserve";
  readonly reason: string;
  readonly evidenceDigest: string;
}

/**
 * Product policy belongs to the process, not to whatever triggered a collection: every pass,
 * catch-up passes included, resolves it for the factory's policy revision as configured then.
 * None means no policy is installed for that revision, which is not the same as one that
 * proposes nothing: pending subjects stay pending.
 */
export const FactoryAdmissionPolicy = Context.Reference<{
  readonly forFactory: (input: {
    readonly factoryId: FactoryId;
    readonly policyRevision: string;
    readonly configuration: FactoryStore.FactoryConfiguration;
  }) => Option.Option<FactoryAdmissionProposer>;
}>("t3/factory/FactoryAdmissionPolicy", {
  defaultValue: () => ({ forFactory: () => Option.none() }),
});

export type FactoryCollectionResult =
  | { readonly type: "coalesced" }
  | {
      readonly type: "collected";
      readonly passes: number;
      readonly admissions: ReadonlyArray<FactoryAdmissionResult>;
      /** Set when the last pass read its subjects but could not decide them yet. */
      readonly deferred: {
        readonly reason: "policy_unavailable";
        readonly subjects: number;
      } | null;
    };

export interface FactoryResultView {
  readonly itemKey: FactoryItemKey;
  readonly stage: FactoryStage["type"];
  readonly outcomeId: string;
  readonly outcomeStage: string;
  readonly kind: string;
  readonly head?: string;
  readonly reportedAt: string;
  readonly summary: string;
  readonly failure?: string;
  readonly artifacts: number;
}

/** The result a stage is decided on; an owner's rejection of it sends the item to correction. */
const stageResult = (stage: FactoryStage): string | undefined => {
  switch (stage.type) {
    case "review":
    case "correct":
      return stage.outcomeId;
    case "rework":
      return stage.specOutcomeId;
    case "integrate":
      return stage.reviewOutcomeId;
    default:
      return undefined;
  }
};

const RESULT_EXCERPT = 600;
const excerpt = (text: string) =>
  text.length > RESULT_EXCERPT ? `${text.slice(0, RESULT_EXCERPT)}…` : text;

export interface FactoryState {
  /** Null until the factory is configured. */
  readonly configuration: FactoryStore.FactoryConfiguration | null;
  /** Decisions only the owner can make, pending until that authority resolves them. */
  readonly reservedDecisions: ReadonlyArray<FactoryOutcomeStore.ReservedDecision>;
  /**
   * What this process's latest pass decided for each item it read, and why. Empty after a
   * restart until the restart pass runs.
   */
  readonly lastCollection: ReadonlyArray<FactoryItemDispositionRecord>;
  /** Problems that stop the factory as a whole, from its latest pass: one entry each. */
  readonly issues: ReadonlyArray<{ readonly kind: string; readonly detail: string }>;
  /** The verified result each item of the latest pass is now built on, for its owner to judge. */
  readonly results: ReadonlyArray<FactoryResultView>;
  readonly grants: ReadonlyArray<FactoryStore.FactoryGrant>;
  /** Legacy work handed to the factory, oldest first. */
  readonly transfers: ReadonlyArray<FactoryTransferStore.FactoryTransfer>;
  readonly pools: ReadonlyArray<{
    readonly poolId: FactoryPoolId;
    readonly capacityUnits: number;
    readonly occupiedUnits: number;
  }>;
  readonly reservations: ReadonlyArray<
    FactoryStore.FactoryReservation & {
      readonly custody: FactoryCustody;
      /** The tracker claim an admitted decision makes before it starts; null when it makes none. */
      readonly claim: {
        readonly state: FactoryClaimStore.FactoryClaimState;
        readonly carrierKey: string | null;
        readonly reason: string | null;
      } | null;
    }
  >;
}

export class FactoryLifecycle extends Context.Service<
  FactoryLifecycle,
  {
    readonly configure: (
      input: FactoryConfigurationInput,
    ) => Effect.Effect<FactoryStore.FactoryConfiguration, FactoryLifecycleError>;
    /** The owner installs a factory's configuration from its JSON document, validated whole. */
    readonly installConfiguration: (
      document: string,
    ) => Effect.Effect<
      FactoryStore.FactoryConfiguration,
      FactoryConfigurationInvalid | FactoryLifecycleError
    >;
    /**
     * Records the claims other writers hold on the tracker's open issues as held reservations,
     * and decides nothing: the policy is not asked and nothing waits for a pass. So a paused
     * factory stays paused while its owner disposes of exact legacy carriers.
     */
    readonly observeClaims: (input: {
      readonly factoryId: FactoryId;
    }) => Effect.Effect<ReadonlyArray<FactoryStore.FactoryReservation>, FactoryLifecycleError>;
    /** Allocates the read generation a collection pass records its observations under. */
    readonly beginCollection: (input: {
      readonly factoryId: FactoryId;
    }) => Effect.Effect<{ readonly generation: FactoryReadGeneration }, FactoryLifecycleError>;
    readonly recordItemObservation: (
      input: ItemObservationInput,
    ) => Effect.Effect<ItemObservationResult, FactoryLifecycleError>;
    readonly admit: (
      input: FactoryAdmissionRequest,
    ) => Effect.Effect<FactoryAdmissionResult, FactoryLifecycleError>;
    readonly readState: (input: {
      readonly factoryId: FactoryId;
    }) => Effect.Effect<FactoryState, FactoryLifecycleError>;
    /** Every configured factory's state, as the owner surfaces read it. */
    readonly overview: () => Effect.Effect<
      ReadonlyArray<{ readonly factoryId: FactoryId; readonly state: FactoryState }>,
      FactoryLifecycleError
    >;
    /**
     * Records the trigger and its subjects, then reads every pending subject afresh, records
     * what each read saw, admits eligible decisions through the installed admission policy, and
     * moves every claim that can still progress.
     */
    readonly collect: (
      input: FactoryCollectionInput,
    ) => Effect.Effect<FactoryCollectionResult, FactoryLifecycleError>;
    /**
     * Collects every open issue that may be ready or held by a claim, and every item the factory
     * already owns: what a restart, the clock, a report and an owner's answer each run.
     */
    readonly reconcile: (input: {
      readonly factoryId: FactoryId;
      readonly trigger: FactoryTrigger;
    }) => Effect.Effect<FactoryReconcileResult, FactoryLifecycleError>;
    /**
     * The factories' own triggers until interrupted: one restart pass, then a pass for each
     * report, owner answer or ended factory run, and each configured clock. A pass starts an
     * agent only when it admits work.
     */
    readonly drive: Effect.Effect<never>;
    /**
     * The decision a request would make, so policy can name it in the packet (the helper's work
     * key) before admitting it.
     */
    readonly decisionKeyFor: (
      input: Pick<
        FactoryAdmissionRequest,
        "factoryId" | "itemKey" | "taskKind" | "policyRevision" | "basis"
      >,
    ) => Effect.Effect<Option.Option<FactoryDecisionKey>, FactoryLifecycleError>;
    /**
     * A worker's outcome for its own lifecycle stage. T3 binds it to the calling thread's
     * execution, then verifies it by reading back what it claims before anything depends on it.
     */
    readonly report: (input: {
      readonly threadId: ThreadId;
      readonly report: FactoryReportInput;
    }) => Effect.Effect<FactoryReportResult, FactoryReportFailure>;
    /**
     * The owner disposes of a legacy or outside claim the factory charged as unknown custody,
     * after its writer is fenced and its work is known to be gone.
     */
    readonly disposeObservedClaim: (input: {
      readonly factoryId: FactoryId;
      readonly reservationId: FactoryReservationId;
      readonly by: string;
      readonly reason: string;
    }) => Effect.Effect<boolean, FactoryLifecycleError>;
    /**
     * The owner's answer to a reserved decision; a resolved or unknown one is not changed. A
     * grant request answered with units issues a finite grant for its exact subject.
     */
    readonly resolveReservedDecision: (input: {
      readonly factoryId: FactoryId;
      readonly decisionId: string;
      readonly answer: string;
      readonly by: string;
      readonly grantUnits?: number | undefined;
    }) => Effect.Effect<boolean, FactoryLifecycleError>;
    readonly revokeGrant: (input: {
      readonly factoryId: FactoryId;
      readonly grantId: string;
      readonly by: string;
    }) => Effect.Effect<boolean, FactoryLifecycleError>;
    /**
     * The owner hands a legacy command job's work on chosen items to the factory: the job's
     * writer is fenced, its last pass drained, and each item adopted with its original
     * identities and its legacy custody held. Asking again with the same id finishes it.
     */
    readonly transferLegacy: (
      input: FactoryTransferInput,
    ) => Effect.Effect<FactoryTransferResult, FactoryLifecycleError>;
    /** Gives a transfer's items and writes back to the legacy job, unless native work began. */
    readonly rollbackTransfer: (input: {
      readonly factoryId: FactoryId;
      readonly transferId: string;
      readonly by: string;
      readonly reason: string;
    }) => Effect.Effect<FactoryTransferResult, FactoryLifecycleError>;
    /** The owner explicitly rejects a verified result; it is never consumed again. */
    readonly rejectOutcome: (input: {
      readonly factoryId: FactoryId;
      readonly outcomeId: string;
      readonly reason: string;
      readonly by: string;
    }) => Effect.Effect<boolean, FactoryLifecycleError>;
    /**
     * The owner's answer to a factory card, from their own signed-in client: re-checks the exact
     * decision or result it is bound to, applies it as `resolveReservedDecision` or
     * `rejectOutcome` would, and closes the card. A refused answer changes nothing.
     */
    readonly answerCard: (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
      readonly answers: Readonly<Record<string, unknown>>;
      readonly by: string;
    }) => Effect.Effect<{ readonly sequence: number }, FactoryCardRefused | FactoryLifecycleError>;
  }
>()("t3/factory/FactoryLifecycle") {}

/** The identity of one owner of a factory's collector in this process. */
interface CollectorToken {
  readonly factoryId: FactoryId;
}

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const makeDecisionKey = Schema.decodeSync(FactoryDecisionKey);
const makeItemKey = Schema.decodeSync(FactoryItemKey);

/** The canonical item a tracker issue is; one issue is one item, whoever collects it. */
const FactoryItemKeyFor = (subject: {
  readonly repository: string;
  readonly issueNumber: number;
}) => makeItemKey(`github:${subject.repository}#${subject.issueNumber}`);

/** The item's own content and evidence, without the claims on it. */
const substantiveDigest = (observation: FactoryStore.ItemObservation) =>
  sha256(
    JSON.stringify([observation.itemVersion, FactoryStore.canonicalEvidence(observation.evidence)]),
  );

/** Same item, task kind, policy and evidence is the same decision, whoever triggers it. */
const decisionKeyOf = (
  input: Pick<
    FactoryAdmissionRequest,
    "factoryId" | "itemKey" | "taskKind" | "policyRevision" | "stage"
  >,
  observation: FactoryStore.ItemObservation,
) =>
  makeDecisionKey(
    sha256(
      JSON.stringify([
        input.factoryId,
        input.itemKey,
        input.taskKind,
        input.policyRevision,
        FactoryStore.canonicalEvidence(observation.evidence),
        // A stage decision is also its exact basis: the same review of another head differs.
        ...(input.stage === undefined ? [] : [input.stage.basis]),
      ]),
    ),
  );

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const store = yield* FactoryStore.FactoryStore;
  const claims = yield* FactoryClaimStore.FactoryClaimStore;
  const sql = yield* SqlClient.SqlClient;
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const tracker = yield* FactoryTracker.FactoryTracker;
  const policy = yield* FactoryAdmissionPolicy;
  const outcomeStore = yield* FactoryOutcomeStore.FactoryOutcomeStore;
  const gitReadback = yield* FactoryGitReadback.FactoryGitReadback;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const operationStore = yield* FactoryOperationStore.FactoryOperationStore;
  const integrator = yield* FactoryIntegrator.FactoryIntegrator;
  const projectService = yield* ProjectService.ProjectService;
  const transfers = yield* FactoryTransferStore.FactoryTransferStore;
  const fence = yield* CommandJobFence.CommandJobFence;
  // A runtime without command jobs has no legacy writer to take work from; transfers refuse.
  const commandJobs = yield* Effect.serviceOption(CommandJobs.CommandJobs);
  // This process's collector for each factory, by a token only its owner holds. Another
  // process's collector is not visible here, and nothing here judges it alive or dead.
  const collecting = yield* Ref.make<ReadonlyMap<FactoryId, CollectorToken>>(new Map());
  // Catch-up collectors an interrupted or failed owner hands its accepted triggers to.
  const collectorScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(collectorScope, Exit.void));
  // Factories a report, an owner answer, an ended run or a finished external write asked to
  // reconcile; `drive` takes them.
  const wakes = yield* FactoryEffects.FactoryWakes;
  // Factories whose last pass could not read every item; the driver tries again shortly.
  const retryWanted = yield* Ref.make<ReadonlySet<FactoryId>>(new Set());
  const factoryIssues = yield* Ref.make<
    ReadonlyMap<FactoryId, ReadonlyArray<{ readonly kind: string; readonly detail: string }>>
  >(new Map());
  const lastPass = yield* Ref.make<
    ReadonlyMap<FactoryId, ReadonlyMap<FactoryItemKey, FactoryItemDispositionRecord>>
  >(new Map());
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const custodyContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof readExecutionCustody>>>();

  const windowsPaths = path.sep === "\\";
  const comparable = (value: string) => (windowsPaths ? value.toLowerCase() : value);

  // Follows junctions and symlinks through the deepest part of the path that exists, so a
  // path the worker has not created yet still resolves where the OS would put it.
  const resolveThroughLinks = Effect.fnUntraced(function* (absolute: string) {
    let existing = absolute;
    const remainder: Array<string> = [];
    for (;;) {
      const real = yield* fs.realPath(existing).pipe(Effect.option);
      if (Option.isSome(real)) return Option.some(path.join(real.value, ...remainder));
      const parent = path.dirname(existing);
      if (parent === existing) return Option.none<string>();
      remainder.unshift(path.basename(existing));
      existing = parent;
    }
  });

  const isAnchoredAbsolute = (candidate: string) =>
    windowsPaths
      ? /^[A-Za-z]:[\\/]/.test(candidate) || /^[\\/]{2}[^\\/]/.test(candidate)
      : path.isAbsolute(candidate);

  const insideArtifactRoot = Effect.fnUntraced(function* (root: string, candidate: string) {
    // Drive-relative and root-relative Windows forms depend on the process's current drive.
    if (!isAnchoredAbsolute(candidate)) return false;
    // ".." after a link resolves against the link's target, not lexically, so refuse it.
    if (candidate.split(/[\\/]/).includes("..")) return false;
    const realRoot = yield* resolveThroughLinks(root);
    const realCandidate = yield* resolveThroughLinks(candidate);
    if (Option.isNone(realRoot) || Option.isNone(realCandidate)) return false;
    const relative = path.relative(comparable(realRoot.value), comparable(realCandidate.value));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });

  /** Checks the proposed execution against the configuration before anything is reserved. */
  const preflight = Effect.fnUntraced(function* (
    input: FactoryAdmissionRequest,
    config: FactoryStore.FactoryConfiguration,
    observation: FactoryStore.ItemObservation,
    decisionKey: FactoryDecisionKey,
  ) {
    if (config.claim !== undefined && observation.subject === undefined) {
      return "claim_target_missing" as const;
    }
    if (input.policyRevision !== config.policyRevision) return "policy_revision_mismatch" as const;
    if (sha256(input.packet.text) !== input.packet.sha256) return "packet_digest_mismatch" as const;
    if (input.packet.briefSchemaVersion !== config.packet.briefSchemaVersion) {
      return "brief_schema_mismatch" as const;
    }
    const helper = config.packet.helper;
    if (input.packet.helperSha256 !== (helper?.sha256 ?? null))
      return "helper_pin_mismatch" as const;
    if (helper !== null) {
      const bytes = yield* fs.readFile(helper.path).pipe(Effect.option);
      if (Option.isNone(bytes) || sha256(bytes.value) !== helper.sha256) {
        return "helper_unavailable" as const;
      }
      if (helper.invocation !== undefined) {
        const refused = validateHelperInvocations({
          packetText: input.packet.text,
          helperPath: helper.path,
          invocation: helper.invocation,
          bindings: { taskKind: input.taskKind, decisionKey },
        });
        if (refused !== undefined) return refused;
      }
    }
    for (const artifactPath of input.artifactPaths) {
      if (!(yield* insideArtifactRoot(config.artifactRoot, artifactPath))) {
        return "artifact_path_outside_root" as const;
      }
    }
    // Preparation renames a temporary-looking branch with a model nobody admitted, so a factory
    // workspace never asks for one.
    const strategy = input.workspaceStrategy;
    if (
      strategy !== undefined &&
      strategy.type !== "root" &&
      strategy.branch !== undefined &&
      isTemporaryWorktreeBranch(strategy.branch)
    ) {
      return "workspace_branch_temporary" as const;
    }
    return undefined;
  });

  /**
   * A factory worktree with no branch named gets one from its decision, so preparation never
   * makes up a temporary branch and renames it through a model outside admission.
   */
  const factoryWorkspace = (
    input: FactoryAdmissionRequest,
    decisionKey: FactoryDecisionKey,
  ): OrchestrationV2ThreadLaunchWorkspaceStrategy | undefined =>
    input.workspaceStrategy?.type === "worktree" && input.workspaceStrategy.branch === undefined
      ? {
          ...input.workspaceStrategy,
          branch: `t3-factory/${sanitizeBranchFragment(input.factoryId)}/${decisionKey.slice(0, 16)}`,
        }
      : input.workspaceStrategy;

  const custodyOf = (reservation: FactoryStore.FactoryReservation) =>
    readExecutionCustody(reservation).pipe(Effect.provide(custodyContext));

  const operationsThread = (factoryId: FactoryId) =>
    ThreadId.make(`thread:factory:${factoryId}:operations`);

  /**
   * Records an operation's intent, then gives it one live effect. The intent commits first, so a
   * crash before the effect leaves it for the next pass to enqueue; a write whose answer was lost
   * waits a minute before it is read back and tried again.
   */
  const ensureOperation = Effect.fnUntraced(function* (input: {
    readonly operationId: string;
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryItemKey;
    readonly intent: FactoryOperationStore.FactoryOperationIntent;
  }) {
    const operation = yield* operationStore.intend({
      operationId: input.operationId,
      factoryId: input.factoryId,
      itemKey: input.itemKey,
      intent: input.intent,
    });
    if (operation.state !== "intended") return operation;
    const commandId = CommandId.make(`factory-operation:${operation.operationId}`);
    const effects = yield* outbox.listByCommandId(commandId);
    if (effects.some((effect) => effect.status === "pending" || effect.status === "running")) {
      return operation;
    }
    yield* outbox.enqueue([
      {
        id: `effect:factory-operation:${operation.operationId}:${effects.length + 1}`,
        commandId,
        threadId: operationsThread(input.factoryId),
        request: { type: "factory-operation.apply", operationId: operation.operationId },
        ...(operation.lastError === undefined
          ? {}
          : { availableAt: DateTime.add(yield* DateTime.now, { minutes: 1 }) }),
      },
    ]);
    yield* outbox.notifyAvailable(1);
    return operation;
  });

  /** Asks for a pass over the item, and wakes the driver for it; no turn waits for it. */
  const wakeFor = (factoryId: FactoryId, itemKey: FactoryItemKey) => {
    const subject = subjectOf(itemKey);
    return (subject === undefined ? Effect.void : requestSubjects(factoryId, [subject])).pipe(
      Effect.andThen(Queue.offer(wakes, { factoryId, trigger: "owner_decision" })),
      Effect.asVoid,
    );
  };

  const bookkeepingFor = makeBookkeeping({ operations: operationStore, claims });

  const transferOps = makeTransfers({
    store,
    outcomes: outcomeStore,
    transfers,
    fence,
    commandJobs,
    wake: (factoryId) =>
      Queue.offer(wakes, { factoryId, trigger: "owner_decision" }).pipe(Effect.asVoid),
  });

  const nativeStages = makeNativeStages({
    operations: operationStore,
    outcomes: outcomeStore,
    integrator,
    projects: projectService,
    ensureOperation,
  });

  const outcomeOps = makeFactoryOutcomes({
    store,
    outcomes: outcomeStore,
    projections,
    git: gitReadback,
    sessions,
    generations,
    ensureOperation,
    getOperation: (operationId) => operationStore.get(operationId),
    verifyEvidence: Effect.fnUntraced(function* (artifactRoot, artifacts) {
      for (const artifact of artifacts) {
        if (!(yield* insideArtifactRoot(artifactRoot, artifact.path))) return undefined;
        const bytes = yield* fs.readFile(artifact.path).pipe(Effect.option);
        if (Option.isNone(bytes) || sha256(bytes.value) !== artifact.sha256.toLowerCase()) {
          return undefined;
        }
      }
      const sorted = artifacts
        .map((artifact) => [artifact.path, artifact.sha256.toLowerCase()] as const)
        .toSorted(([a], [b]) => a.localeCompare(b));
      return sha256(canonical(sorted));
    }),
    settleThread: (reservation) =>
      orchestrator.dispatch({
        type: "thread.settle",
        commandId: CommandId.make(`factory-stage-settle:${reservation.reservationId}`),
        threadId: reservation.execution.threadId,
      }),
    custodyOf: (reservation) =>
      custodyOf(reservation).pipe(
        Effect.orElseSucceed((): FactoryCustody => ({
          state: "unknown",
          reasons: ["execution_unreadable"],
        })),
      ),
    onReported: (item) => {
      const subject = subjectOf(item.itemKey);
      return (
        subject === undefined ? Effect.void : requestSubjects(item.factoryId, [subject])
      ).pipe(
        Effect.andThen(Queue.offer(wakes, { factoryId: item.factoryId, trigger: "outcome" })),
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.logWarning("Factory report recorded; its pass will come from the next trigger", {
            itemKey: item.itemKey,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    },
  });

  /** The decision whose verified claim owns the item: the first that claimed it. */
  const itemOwner = Effect.fnUntraced(function* (factoryId: FactoryId, itemKey: FactoryItemKey) {
    for (const claim of yield* claims.list(factoryId)) {
      if (
        claim.itemKey === itemKey &&
        (claim.state === "verified" || claim.state === "workspace_authorized")
      ) {
        return { reservationId: claim.reservationId, carrierKey: claim.carrierKey };
      }
    }
    return undefined;
  });

  const configure = Effect.fn("FactoryLifecycle.configure")(
    function* (input: FactoryConfigurationInput) {
      return yield* store.configure(input);
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "configure",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  const installConfiguration = Effect.fn("FactoryLifecycle.installConfiguration")(function* (
    document: string,
  ) {
    const input = yield* decodeConfigurationDocument(document).pipe(
      Effect.mapError((cause) => new FactoryConfigurationInvalid({ reason: cause.message })),
    );
    return yield* configure(input);
  });

  const observeClaims = Effect.fn("FactoryLifecycle.observeClaims")(
    function* (input: { readonly factoryId: FactoryId }) {
      const factoryId = input.factoryId;
      const configuration = yield* store.getConfiguration(factoryId);
      if (Option.isNone(configuration)) {
        return yield* new FactoryLifecycleError({
          operation: "observe-claims",
          factoryId,
          cause: "the factory is not configured",
        });
      }
      const claim = configuration.value.claim;
      if (claim === undefined) {
        return yield* new FactoryLifecycleError({
          operation: "observe-claims",
          factoryId,
          cause: "the factory has no tracker to read claims from",
        });
      }
      const generation = yield* store.beginCollection(factoryId);
      const disposed = yield* store.disposedCarriers(factoryId);
      const reads = yield* tracker.withSession(
        { host: claim.host, cwd: configuration.value.artifactRoot },
        (session) =>
          Effect.forEach(
            claim.repositories ?? [],
            (repository) =>
              session.listOpenIssues({ repository }).pipe(
                Effect.flatMap((listed) =>
                  Effect.forEach(
                    listed.filter((issue) => mayBeReadyOrClaimed(issue, claim)),
                    (issue) =>
                      Effect.map(
                        session.readIssue({ repository, issueNumber: issue.number }),
                        (read) => ({ subject: { repository, issueNumber: issue.number }, read }),
                      ),
                    { concurrency: 4 },
                  ),
                ),
              ),
            { concurrency: 4 },
          ),
      );
      for (const { subject, read } of reads.flat()) {
        const itemKey = FactoryItemKeyFor(subject);
        const isBookkeeping = yield* bookkeepingFor({
          factoryId,
          itemKey,
          accountId: claim.accountId,
        });
        const observed = issueObservation({
          issue: read,
          subject: { tracker: "github", ...subject },
          claim,
          isBookkeeping,
        });
        yield* store.recordItemObservation({
          ...observed,
          claims: observed.claims.filter((carrier) => !disposed.has(carrier.carrierKey)),
          factoryId,
          itemKey,
          generation,
        });
      }
      return (yield* store.listReservations(factoryId)).filter(
        (reservation) => reservation.origin === "observed" && reservation.state === "held",
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isLifecycleError(cause)
            ? cause
            : new FactoryLifecycleError({
                operation: "observe-claims",
                factoryId: input.factoryId,
                cause,
              }),
        ),
      ),
  );

  const admit = Effect.fn("FactoryLifecycle.admit")(
    function* (input: FactoryAdmissionRequest) {
      const configuration = yield* store.getConfiguration(input.factoryId);
      if (Option.isNone(configuration)) {
        return { type: "refused", reason: "factory_not_configured" } as const;
      }
      const observation = yield* store.getObservation({
        factoryId: input.factoryId,
        observationId: input.basis.observationId,
      });
      if (Option.isNone(observation) || observation.value.itemKey !== input.itemKey) {
        return { type: "refused", reason: "unknown_observation" } as const;
      }
      const decisionKey = decisionKeyOf(input, observation.value);
      const prior = yield* store.findAdmission({ factoryId: input.factoryId, decisionKey });
      if (Option.isSome(prior)) return { type: "existing", reservation: prior.value } as const;

      const config = configuration.value;
      const refusal = yield* preflight(input, config, observation.value, decisionKey);
      if (refusal !== undefined) return { type: "refused", reason: refusal } as const;
      const commandId = CommandId.make(`factory:${input.factoryId}:decision:${decisionKey}`);
      const workspaceStrategy = factoryWorkspace(input, decisionKey);
      const execution =
        input.execution === undefined
          ? FactoryStore.executionFor(config, input.taskKind)
          : config.executionChoices?.[input.execution];
      if (execution === undefined) {
        return { type: "refused", reason: "unknown_execution" } as const;
      }
      const dispatched = yield* orchestrator
        .dispatch({
          type: "factory.execution.start",
          commandId,
          threadId: ThreadId.make(`thread:factory:${input.factoryId}:${decisionKey}`),
          projectId: config.projectId,
          title: input.title,
          modelSelection: execution.modelSelection,
          runtimeMode: execution.runtimeMode,
          interactionMode: execution.interactionMode,
          prompt: input.packet.text,
          ...(workspaceStrategy === undefined ? {} : { workspaceStrategy }),
          admission: {
            factoryId: input.factoryId,
            configRevision: config.revision,
            decisionKey,
            itemKey: input.itemKey,
            itemVersion: observation.value.itemVersion,
            taskKind: input.taskKind,
            policyRevision: input.policyRevision,
            poolId: input.poolId,
            units: input.units,
            packetDigest: input.packet.sha256,
            observationId: observation.value.observationId,
            basisDigest: observation.value.basisDigest,
            deadline: input.basis.deadline,
            ...(input.stage === undefined ? {} : { stageBasis: input.stage.basis }),
            ...(input.continues === undefined ? {} : { continues: input.continues }),
            ...(input.grant === undefined ? {} : { grant: input.grant }),
            // A later stage runs under the claim that owns its item, and makes none of its own.
            ...(config.claim === undefined ||
            observation.value.subject === undefined ||
            input.continues !== undefined
              ? {}
              : {
                  claim: {
                    host: config.claim.host,
                    repository: observation.value.subject.repository,
                    issueNumber: observation.value.subject.issueNumber,
                  },
                }),
          },
        })
        .pipe(
          Effect.map(() => undefined),
          Effect.catchTags({
            OrchestratorFactoryReservationRefusedError: (refused) =>
              Effect.succeed(refused.refusal),
          }),
        );
      if (dispatched !== undefined) return { type: "refused", reason: dispatched } as const;
      const admitted = yield* store.findAdmission({ factoryId: input.factoryId, decisionKey });
      if (Option.isNone(admitted)) {
        return yield* Effect.die(new Error(`Admitted decision ${decisionKey} has no reservation.`));
      }
      return { type: "admitted", reservation: admitted.value } as const;
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({ operation: "admit", factoryId: input.factoryId, cause }),
        ),
      ),
  );

  const beginCollection = Effect.fn("FactoryLifecycle.beginCollection")(
    function* (input: { readonly factoryId: FactoryId }) {
      return { generation: yield* store.beginCollection(input.factoryId) };
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "begin-collection",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  const recordItemObservation = Effect.fn("FactoryLifecycle.recordItemObservation")(
    function* (input: ItemObservationInput) {
      return yield* store.recordItemObservation(input);
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "record-item-observation",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  /** The result an item's next stage is decided on, unless its owner already rejected it. */
  const currentStageResult = Effect.fnUntraced(function* (
    factoryId: FactoryId,
    itemKey: FactoryItemKey,
  ) {
    const events = yield* outcomeStore.itemEvents({ factoryId, itemKey });
    const stage = nextStage(events);
    if (stage.type === "done") return undefined;
    const outcomeId = stageResult(stage);
    // A rejected result stays verified history, but it is never offered again.
    if (
      outcomeId === undefined ||
      events.some((event) => event.type === "rejected" && event.outcomeId === outcomeId)
    ) {
      return undefined;
    }
    return { stage: stage.type, outcomeId };
  });

  /** Only items whose stage is decided on an earlier result; others have nothing to reject. */
  const stageResultsOf = Effect.fnUntraced(function* (
    factoryId: FactoryId,
    records: ReadonlyArray<FactoryItemDispositionRecord>,
  ) {
    const results = yield* Effect.forEach(
      records.filter(
        (record) =>
          record.stage !== null && record.stage !== "implement" && record.stage !== "close",
      ),
      (record) =>
        Effect.gen(function* () {
          const current = yield* currentStageResult(factoryId, record.itemKey);
          const stored =
            current === undefined ? Option.none() : yield* outcomeStore.get(current.outcomeId);
          if (current === undefined || Option.isNone(stored) || stored.value.state !== "verified") {
            return [];
          }
          const { report } = stored.value;
          const head = report.subject?.headCommit;
          const view: FactoryResultView = {
            itemKey: record.itemKey,
            stage: current.stage,
            outcomeId: stored.value.outcomeId,
            outcomeStage: stored.value.stage,
            kind: report.outcome,
            ...(head === undefined ? {} : { head }),
            reportedAt: stored.value.reportedAt,
            summary: excerpt(report.summary),
            ...(report.failure === undefined ? {} : { failure: excerpt(report.failure) }),
            artifacts: report.artifacts?.length ?? 0,
          };
          return [view];
        }),
      { concurrency: 4 },
    );
    return results.flat();
  });

  const readState = Effect.fn("FactoryLifecycle.readState")(
    function* (input: { readonly factoryId: FactoryId }) {
      const configuration = Option.getOrNull(yield* store.getConfiguration(input.factoryId));
      const claimed = new Map(
        (yield* claims.list(input.factoryId)).map((claim) => [claim.reservationId, claim]),
      );
      const reservations = yield* Effect.forEach(
        yield* store.listReservations(input.factoryId),
        (reservation) =>
          custodyOf(reservation).pipe(
            Effect.map((custody) => {
              const claim = claimed.get(reservation.reservationId);
              return {
                ...reservation,
                custody,
                claim:
                  claim === undefined
                    ? null
                    : {
                        state: claim.state,
                        carrierKey: "carrierKey" in claim ? claim.carrierKey : null,
                        reason: "reason" in claim ? claim.reason : null,
                      },
              };
            }),
          ),
        { concurrency: 4 },
      );
      const lastCollection = [...((yield* Ref.get(lastPass)).get(input.factoryId)?.values() ?? [])];
      const results = yield* stageResultsOf(input.factoryId, lastCollection);
      return {
        configuration,
        reservedDecisions: yield* outcomeStore.reservedDecisions(input.factoryId),
        lastCollection,
        results,
        issues: (yield* Ref.get(factoryIssues)).get(input.factoryId) ?? [],
        grants: yield* store.listGrants(input.factoryId),
        transfers: yield* transfers.list(input.factoryId),
        pools: (configuration?.pools ?? []).map((pool) => ({
          poolId: pool.poolId,
          capacityUnits: pool.capacityUnits,
          // A released reservation stays as history and holds nothing.
          occupiedUnits: reservations
            .filter(
              (reservation) => reservation.poolId === pool.poolId && reservation.state === "held",
            )
            .reduce((total, reservation) => total + reservation.units, 0),
        })),
        reservations,
      };
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "read-state",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  /**
   * Gives every claim that can still progress one live effect: a pending claim, or a written
   * attempt waiting to be read back. A prepared attempt with no durable answer is left alone.
   */
  const reconcileClaims = Effect.fnUntraced(function* (
    factoryId: FactoryId,
    generation: FactoryReadGeneration,
  ) {
    const pending: Array<EffectOutbox.PendingOrchestrationEffectV2> = [];
    for (const claim of yield* claims.list(factoryId)) {
      const entry = yield* claims.get(claim.reservationId);
      if (Option.isNone(entry)) continue;
      const last = entry.value.attempts.at(-1);
      // A claim held on its own preparation's lost outcome gets one recovery check per pass;
      // the check decides from native facts whether the run may prepare again.
      if (
        claim.state === "stale_after_claim" &&
        FactoryClaimStore.PREPARATION_HOLD_REASONS.has(claim.reason)
      ) {
        const [obligation] = yield* store.openWorkspaceObligations(claim.reservationId);
        if (obligation === undefined) continue;
        const recoveryCommandId = CommandId.make(`factory-recovery-check:${obligation.runId}`);
        const checking = (yield* outbox.listByCommandId(recoveryCommandId)).some(
          (effect) => effect.status === "pending" || effect.status === "running",
        );
        if (checking) continue;
        pending.push({
          id: `effect:factory-execution.prepare:${obligation.runId}:recovery:${generation}`,
          commandId: recoveryCommandId,
          threadId: claim.threadId,
          request: {
            type: "factory-execution.prepare",
            reservationId: claim.reservationId,
            runId: obligation.runId,
          },
        });
        continue;
      }
      // A verified claim whose run's own prepare effect gave up is stranded: nothing else moves
      // it, and a runtime's stop cancels the run it left preparing. Each pass gives it one replay,
      // which decides from durable state whether the same run may be authorized and prepared.
      if (claim.state === "verified") {
        const receipt = entry.value.attempts.find((attempt) => attempt.phase === "verified");
        if (receipt === undefined) continue;
        const prepare = (yield* outbox.listByCommandId(
          CommandId.make(`factory-claim-settle:${claim.reservationId}:${receipt.attempt}`),
        )).find(
          (effect) =>
            effect.request.type === "factory-execution.prepare" &&
            effect.request.reservationId === claim.reservationId,
        );
        if (prepare === undefined || prepare.request.type !== "factory-execution.prepare") continue;
        if (prepare.status === "pending" || prepare.status === "running") continue;
        const runId = prepare.request.runId;
        const recoveryCommandId = CommandId.make(`factory-recovery-check:${runId}`);
        const replays = yield* outbox.listByCommandId(recoveryCommandId);
        if (replays.some((effect) => effect.status === "pending" || effect.status === "running")) {
          continue;
        }
        // An unreadable thread leaves this claim for the next pass instead of failing the pass.
        const records = yield* orchestrator
          .getThreadRecords(claim.threadId, ["runs"], { runIds: [runId] })
          .pipe(Effect.option);
        const status = Option.isSome(records) ? records.value.runs[0]?.status : undefined;
        const stranded =
          status === "preparing" ||
          (status === "cancelled" && (yield* claims.preparationCancelledByRuntime(runId)));
        if (!stranded) continue;
        // A replay that failed is tried again after a pause, not on every pass: the host's
        // helper is built on each attempt, and the failure is already not cached.
        const lastFailed = replays.at(-1)?.status === "failed";
        pending.push({
          id: `effect:factory-execution.prepare:${runId}:replay:${generation}`,
          commandId: recoveryCommandId,
          threadId: claim.threadId,
          request: {
            type: "factory-execution.prepare",
            reservationId: claim.reservationId,
            runId,
          },
          ...(lastFailed ? { availableAt: DateTime.add(yield* DateTime.now, REPLAY_PAUSE) } : {}),
        });
        continue;
      }
      const progresses =
        claim.state === "pending" || (claim.state === "writing" && last?.phase === "written");
      if (!progresses) continue;
      const commandId = claim.launch.messageCommandId;
      const live = (yield* outbox.listByCommandId(commandId)).some(
        (effect) =>
          effect.request.type === "factory-claim.write" &&
          (effect.status === "pending" || effect.status === "running"),
      );
      if (live) continue;
      pending.push({
        id: `effect:factory-claim.write:${claim.reservationId}:collection:${generation}`,
        commandId,
        threadId: claim.threadId,
        request: { type: "factory-claim.write", reservationId: claim.reservationId },
      });
    }
    // A stage with no claim of its own (it continues the claimed decision) owes its workspace
    // the same way, and nothing else replays it when a runtime leaves it preparing or cancels
    // it before any provider ran. Each pass gives such a run one replay, under the recovery id.
    for (const reservation of yield* store.listReservations(factoryId)) {
      if (
        reservation.state !== "held" ||
        reservation.origin !== "admitted" ||
        !FactoryStore.isNativeReservation(reservation) ||
        Option.isSome(yield* claims.get(reservation.reservationId))
      ) {
        continue;
      }
      const threadId = reservation.execution.threadId;
      const records = yield* orchestrator.getThreadRecords(threadId, ["runs"]).pipe(Effect.option);
      if (Option.isNone(records)) continue;
      const active = (run: (typeof records.value.runs)[number]) =>
        run.status === "preparing" ||
        run.status === "starting" ||
        run.status === "running" ||
        run.status === "waiting";
      for (const run of records.value.runs) {
        if (run.workspacePreparation === undefined || run.startedAt !== null) continue;
        if (records.value.runs.some((other) => other.id !== run.id && active(other))) continue;
        const obligation = yield* store.workspaceObligation(run.id);
        const owed =
          run.status === "preparing" ||
          (run.status === "failed" && Option.exists(obligation, (o) => o.state === "open")) ||
          (run.status === "cancelled" && (yield* claims.preparationCancelledByRuntime(run.id)));
        if (!owed) continue;
        const recoveryCommandId = CommandId.make(`factory-recovery-check:${run.id}`);
        const replays = yield* outbox.listByCommandId(recoveryCommandId);
        const owning = [
          ...Option.toArray(yield* outbox.get(`effect:factory-execution.prepare:${run.id}`)),
          ...replays,
        ];
        if (owning.some((effect) => effect.status === "pending" || effect.status === "running")) {
          continue;
        }
        const lastFailed = replays.at(-1)?.status === "failed";
        pending.push({
          id: `effect:factory-execution.prepare:${run.id}:replay:${generation}`,
          commandId: recoveryCommandId,
          threadId,
          request: {
            type: "factory-execution.prepare",
            reservationId: reservation.reservationId,
            runId: run.id,
          },
          ...(lastFailed ? { availableAt: DateTime.add(yield* DateTime.now, REPLAY_PAUSE) } : {}),
        });
      }
    }
    if (pending.length === 0) return;
    yield* outbox.enqueue(pending);
    yield* outbox.notifyAvailable(pending.length);
  });

  /**
   * A provider-native wake the start fence refused is still owed: the adapter offers each wake
   * once, and the dispatched message is its only record. Once the execution is proved quiet, the
   * wake is sent again as a server message (the adapter-buffered form prompts nothing then). One
   * delivery per refused run, by command id, while no later run started; user text is not resent.
   */
  const recoverRefusedWakes = Effect.fnUntraced(function* (factoryId: FactoryId) {
    for (const reservation of yield* store.listReservations(factoryId)) {
      if (
        reservation.state !== "held" ||
        reservation.origin !== "admitted" ||
        !FactoryStore.isNativeReservation(reservation)
      ) {
        continue;
      }
      const threadId = reservation.execution.threadId;
      const projection = yield* projections.getThreadProjection(threadId).pipe(Effect.option);
      if (
        Option.isNone(projection) ||
        projection.value.thread.deletedAt !== null ||
        projection.value.thread.archivedAt !== null
      ) {
        continue;
      }
      const owed = owedWakes(projection.value);
      if (owed.length === 0) continue;
      const custody = yield* custodyOf(reservation).pipe(Effect.option);
      if (Option.isNone(custody) || custody.value.state !== "quiescent") continue;
      for (const run of owed) {
        const wake = projection.value.messages.find((message) => message.id === run.userMessageId)!;
        yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(`factory-wake-recovery:${run.id}`),
            threadId,
            messageId: MessageId.make(`message:factory-wake-recovery:${run.id}`),
            text: wake.text,
            ...(wake.notification === undefined ? {} : { notification: wake.notification }),
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
            createdBy: "agent",
            creationSource: "server",
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Factory wake recovery not delivered; the next pass tries again", {
                threadId,
                runId: run.id,
                cause: Cause.pretty(cause),
              }),
            ),
          );
      }
    }
  });

  /** The reserved decision's tracker record, through an operation whose intent commits first. */
  const recordDecisionOnTracker = (
    configuration: FactoryStore.FactoryConfiguration,
    subject: { readonly repository: string; readonly issueNumber: number },
    decision: FactoryOutcomeStore.ReservedDecision,
  ) => {
    const marker = decisionMarker(decision.decisionId);
    return ensureOperation({
      operationId: `decision:${decision.decisionId}`,
      factoryId: configuration.factoryId,
      itemKey: decision.itemKey,
      intent: {
        kind: "tracker_comment",
        ...subject,
        purpose: "decision",
        ref: decision.decisionId,
        marker,
        body: [
          marker,
          decision.kind === "grant"
            ? `T3 factory ${configuration.factoryId} needs the owner's finite grant before the ${decision.stage} stage.`
            : `T3 factory ${configuration.factoryId} is waiting for the owner before the ${decision.stage} stage.`,
          decision.reason,
          `Decision ${decision.decisionId}: answer it in T3 (Settings, Factories) or with t3_factory_decide.`,
        ].join("\n\n"),
      },
    });
  };

  interface Candidate {
    readonly itemKey: FactoryItemKey;
    readonly subject: { readonly repository: string; readonly issueNumber: number };
    readonly issue: TrackerIssue;
    readonly observation: FactoryStore.ItemObservation;
    readonly stage: Exclude<FactoryStage, { readonly type: "done" }>;
    readonly owner: { readonly reservationId: FactoryReservationId } | undefined;
    readonly events: ReadonlyArray<FactoryOutcomeStore.StoredItemEvent>;
  }

  const collectPass = Effect.fnUntraced(function* (
    factoryId: FactoryId,
    configuration: FactoryStore.FactoryConfiguration,
    claim: FactoryStore.FactoryClaimConfig,
    subjects: ReadonlyArray<{ readonly repository: string; readonly issueNumber: number }>,
    proposer: Option.Option<FactoryAdmissionProposer>,
  ) {
    // T3's finished effects become outcomes, results are recovered and verified, and verified
    // stages settle, before anything new is decided; then every intended write gets its effect.
    yield* nativeStages.recordOutcomes(factoryId);
    yield* outcomeOps.reconcile(factoryId);
    for (const operation of yield* operationStore.listIntended(factoryId)) {
      yield* ensureOperation(operation);
    }
    const generation = yield* store.beginCollection(factoryId);
    const deadline = Duration.seconds(configuration.readDeadlineSeconds ?? 120);
    // Bounded parallel reads; an item that cannot be read in time is recorded unread and read
    // again shortly, and nothing is decided or spent for it meanwhile.
    const reads = yield* tracker.withSession(
      { host: claim.host, cwd: configuration.artifactRoot },
      (session) =>
        Effect.forEach(
          subjects,
          (subject) =>
            session.readIssue(subject).pipe(
              Effect.timeoutOption(deadline),
              Effect.result,
              Effect.map((read) => ({ subject, read })),
            ),
          { concurrency: 4 },
        ),
    );
    const admissions: Array<FactoryAdmissionResult> = [];
    const issues: Array<{ readonly kind: string; readonly detail: string }> = [];
    const at = DateTime.formatIso(yield* DateTime.now);
    const dispositions = new Map<FactoryItemKey, FactoryItemDispositionRecord>();
    const note = (
      itemKey: FactoryItemKey,
      stage: FactoryStage["type"] | null,
      disposition: FactoryItemDisposition,
      detail?: string,
    ) =>
      dispositions.set(itemKey, {
        itemKey,
        stage,
        disposition,
        ...(detail === undefined ? {} : { detail }),
        at,
      });
    const held = new Map(
      (yield* store.listReservations(factoryId)).flatMap((reservation) =>
        reservation.origin === "admitted" && reservation.state === "held"
          ? [[reservation.itemKey, reservation] as const]
          : [],
      ),
    );
    const transferOf = latestTransfers(yield* transfers.list(factoryId));
    const active: Array<FactoryPolicyActive> = [];
    const legacyCustody = new Map(
      (yield* store.listReservations(factoryId)).flatMap((reservation) =>
        reservation.origin === "transferred" && reservation.state === "held"
          ? [[reservation.itemKey, reservation] as const]
          : [],
      ),
    );
    // A carrier the owner disposed of is no one's claim any more: not charged, not blocking.
    const disposed = yield* store.disposedCarriers(factoryId);
    let retry = false;
    const candidates: Array<Candidate> = [];
    for (const { subject, read } of reads) {
      const itemKey = FactoryItemKeyFor(subject);
      if (Result.isFailure(read)) {
        note(itemKey, null, "read_failed", String(read.failure).slice(0, 500));
        retry = true;
        continue;
      }
      if (Option.isNone(read.success)) {
        note(itemKey, null, "read_deadline");
        retry = true;
        continue;
      }
      const issue = read.success.value;
      const isBookkeeping = yield* bookkeepingFor({
        factoryId,
        itemKey,
        accountId: claim.accountId,
      });
      const observedRead = issueObservation({
        issue,
        subject: { tracker: "github", ...subject },
        claim,
        isBookkeeping,
      });
      const observed = {
        ...observedRead,
        claims: observedRead.claims.filter((carrier) => !disposed.has(carrier.carrierKey)),
      };
      const recorded = yield* store.recordItemObservation({
        ...observed,
        factoryId,
        itemKey,
        generation,
      });
      if (recorded.type !== "recorded") {
        note(itemKey, null, "read_superseded");
        continue;
      }
      const events = yield* outcomeStore.itemEvents({ factoryId, itemKey });
      const stage = nextStage(events);
      if (stage.type === "done") {
        // Its closure stays recorded and nothing starts again, but an issue its owner reopened is not
        // done, so the item says what the tracker shows.
        if (issue.state === "open") {
          note(
            itemKey,
            "done",
            "reopened",
            `the issue is open after T3 closed it (closure ${stage.closureOutcomeId}); no stage starts until its owner settles it`,
          );
        } else {
          note(itemKey, "done", "done");
        }
        continue;
      }
      // A transferred item is the factory's only once adopted, and decided natively only once the
      // owner has disposed of the legacy custody it holds.
      const transfer = transferOf.get(itemKey);
      if (transfer !== undefined && transfer.state !== "adopted") {
        note(
          itemKey,
          stage.type,
          "legacy_owned",
          transfer.state === "draining"
            ? `transfer ${transfer.transferId} is draining job ${transfer.job}`
            : `transfer ${transfer.transferId} was rolled back to job ${transfer.job}`,
        );
        continue;
      }
      const custody = legacyCustody.get(itemKey);
      if (custody !== undefined) {
        active.push({ itemKey, stage: stage.type, custody: "legacy", issue });
        note(
          itemKey,
          stage.type,
          "legacy_custody",
          `job ${transfer?.job ?? "legacy"}'s custody is unknown until the owner disposes of ${custody.reservationId}`,
        );
        continue;
      }
      // Its current decision is still running or settling: nothing to propose until it lands. A
      // substantive change under it is recorded, and the next stage is decided on it.
      const running = held.get(itemKey);
      if (running !== undefined) {
        // Only the item's own content and evidence count; the claim landing is not a change.
        const admittedOn =
          running.origin === "admitted" && running.observationId !== undefined
            ? yield* store.getObservation({ factoryId, observationId: running.observationId })
            : Option.none<FactoryStore.ItemObservation>();
        const changed =
          Option.isSome(admittedOn) &&
          substantiveDigest(admittedOn.value) !== substantiveDigest(recorded.observation);
        if (changed) {
          yield* outcomeStore.recordBasisChange({
            factoryId,
            itemKey,
            reservationId: running.reservationId,
            basisDigest: recorded.observation.basisDigest,
            observationId: recorded.observation.observationId,
          });
        }
        active.push({
          itemKey,
          stage: isLifecycleStage(running.taskKind) ? running.taskKind : stage.type,
          custody: "native",
          issue,
        });
        note(
          itemKey,
          stage.type,
          "in_progress",
          changed ? "the item changed after this stage was admitted" : undefined,
        );
        continue;
      }
      // Until its first verified outcome, an item is decided as a new one: unclaimed and
      // eligible. After it, a later stage continues the item this factory owns, under that
      // claim, with no foreign claim on it.
      const begun = events.some((event) => event.type === "outcome");
      const owner = begun ? yield* itemOwner(factoryId, itemKey) : undefined;
      if (begun) {
        if (owner === undefined) {
          note(itemKey, stage.type, "not_owned");
          continue;
        }
        if (observed.claims.some((carrier) => carrier.carrierKey !== owner.carrierKey)) {
          active.push({ itemKey, stage: stage.type, custody: "foreign", issue });
          note(itemKey, stage.type, "foreign_claim");
          continue;
        }
      } else if (
        !isEligible(observed, issue, claim) &&
        // The owner chose a transferred item: its legacy labels do not make it ineligible.
        !(transfer !== undefined && issue.state === "open" && observed.claims.length === 0)
      ) {
        // Whoever holds it, the files and resources its work uses are not free for new work.
        if (issue.state === "open" && observed.claims.length > 0) {
          active.push({ itemKey, stage: stage.type, custody: "foreign", issue });
        }
        note(itemKey, stage.type, "not_eligible");
        continue;
      }
      candidates.push({
        itemKey,
        subject,
        issue,
        observation: recorded.observation,
        stage,
        owner,
        events,
      });
    }
    const reserved = yield* outcomeStore.reservedDecisions(factoryId);
    const grants = yield* store.listGrants(factoryId);
    if (Option.isNone(proposer)) {
      for (const candidate of candidates) {
        note(candidate.itemKey, candidate.stage.type, "policy_unavailable");
      }
    } else if (candidates.length > 0) {
      const items: Array<FactoryPolicyItem> = [];
      for (const candidate of candidates) {
        const outcomes: Array<FactoryOutcomeStore.FactoryOutcome> = [];
        for (const event of candidate.events) {
          if (event.type !== "outcome") continue;
          const outcome = yield* outcomeStore.get(event.outcomeId);
          if (Option.isSome(outcome)) outcomes.push(outcome.value);
        }
        const transferred = transferOf.get(candidate.itemKey);
        const legacyWork = transferred?.adopted?.items.find(
          (item) => item.itemKey === candidate.itemKey,
        );
        items.push({
          ...(transferred === undefined || legacyWork === undefined
            ? {}
            : {
                legacy: {
                  transferId: transferred.transferId,
                  job: transferred.job,
                  workers: legacyWork.workers,
                },
              }),
          observation: candidate.observation,
          issue: candidate.issue,
          stage: candidate.stage,
          reserved: reserved.filter((decision) => decision.itemKey === candidate.itemKey),
          grants: grants.filter((grant) => grant.itemKey === candidate.itemKey),
          outcomes,
          decisionKey: decisionKeyOf(
            {
              factoryId,
              itemKey: candidate.itemKey,
              taskKind: candidate.stage.type,
              policyRevision: configuration.policyRevision,
              stage: { type: candidate.stage.type, basis: stageBasis(candidate.stage) },
            },
            candidate.observation,
          ),
        });
      }
      const answer = yield* proposer.value.decide({ configuration, items, active });
      if (isPolicyFailure(answer)) {
        // One visible problem for the factory, not a write on every item it could not decide.
        issues.push({ kind: "policy", detail: answer.reason });
        for (const candidate of candidates) {
          note(candidate.itemKey, candidate.stage.type, "policy_failed", answer.reason);
        }
      } else {
        const byKey = new Map(candidates.map((candidate) => [candidate.itemKey, candidate]));
        const decided = new Set<FactoryItemKey>();
        for (const { itemKey, decision } of answer) {
          const candidate = byKey.get(itemKey);
          if (candidate === undefined || decided.has(itemKey)) continue;
          decided.add(itemKey);
          const result = yield* act(configuration, candidate, decision);
          for (const pending of reserved) {
            if (pending.itemKey !== itemKey || pending.state !== "pending") continue;
            const reason = overtakenBy(pending, candidate.stage, decision);
            if (reason !== undefined) {
              yield* outcomeStore.supersedeDecision({ decisionId: pending.decisionId, reason });
            }
          }
          if (result.admission !== undefined) admissions.push(result.admission);
          if (result.issue !== undefined) issues.push(result.issue);
          note(itemKey, candidate.stage.type, result.disposition, result.detail);
        }
        for (const candidate of candidates) {
          if (!decided.has(candidate.itemKey)) {
            note(candidate.itemKey, candidate.stage.type, "nothing_proposed");
          }
        }
      }
    }
    yield* Ref.update(lastPass, (passes) => {
      const items = new Map(passes.get(factoryId));
      for (const [itemKey, record] of dispositions) items.set(itemKey, record);
      return new Map(passes).set(factoryId, items);
    });
    yield* Ref.update(factoryIssues, (current) => new Map(current).set(factoryId, issues));
    if (retry) yield* Ref.update(retryWanted, (current) => new Set(current).add(factoryId));
    yield* reconcileClaims(factoryId, generation);
    yield* recoverRefusedWakes(factoryId);
    // Asking the owner never holds a pass back: a card that fails is asked again next pass.
    yield* syncOwnerCards(factoryId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Factory owner decisions could not be asked in chat", {
          factoryId,
          cause,
        }),
      ),
    );
    return admissions;
  });

  /**
   * The branch the item's work was reported on: the reviewed head's own report first, then the
   * item's latest implementation that named one.
   */
  const reportedBranch = Effect.fnUntraced(function* (
    events: ReadonlyArray<FactoryOutcomeStore.StoredItemEvent>,
    head: string,
  ) {
    let fallback: string | undefined;
    for (const event of events.toReversed()) {
      if (event.type !== "outcome" || event.kind !== "implemented") continue;
      const outcome = yield* outcomeStore.get(event.outcomeId);
      const branch = Option.isSome(outcome) ? outcome.value.report.subject?.branch : undefined;
      if (branch === undefined) continue;
      if (event.head === head) return branch;
      fallback ??= branch;
    }
    return fallback;
  });

  /** Carries out one item's decision for its current stage. */
  const act = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    candidate: Candidate,
    decision: FactoryPolicyDecision,
  ): Effect.fn.Return<
    {
      readonly disposition: FactoryItemDisposition;
      readonly detail?: string;
      readonly admission?: FactoryAdmissionResult;
      readonly issue?: { readonly kind: string; readonly detail: string };
    },
    | FactoryLifecycleError
    | FactoryStore.FactoryStoreError
    | FactoryOutcomeStore.FactoryOutcomeStoreError
    | Effect.Error<ReturnType<typeof recordDecisionOnTracker>>
    | Effect.Error<ReturnType<typeof nativeStages.planIntegration>>
  > {
    const { itemKey, stage, subject } = candidate;
    const factoryId = configuration.factoryId;
    if (decision === undefined) return { disposition: "nothing_proposed" };
    if (isNothingProposed(decision)) {
      return { disposition: "nothing_proposed", detail: decision.reason };
    }
    if (isPolicyFailure(decision)) return { disposition: "policy_failed", detail: decision.reason };
    const reserve = Effect.fnUntraced(function* (
      kind: "gate" | "grant",
      reason: string,
      evidenceDigest: string,
    ) {
      // A grant request after an earlier grant for the same subject was spent or revoked is a new
      // request, not the one the owner already answered.
      const issued =
        kind === "grant"
          ? (yield* store.listGrants(factoryId)).filter(
              (grant) =>
                grant.itemKey === itemKey &&
                grant.stage === stage.type &&
                grant.evidenceDigest === evidenceDigest,
            ).length
          : 0;
      const reservedDecision = yield* outcomeStore.reserveDecision({
        // Its exact evidence identifies it: the same question reworded is not asked again.
        decisionId: sha256(
          [factoryId, itemKey, stage.type, kind, evidenceDigest, String(issued)].join("\n"),
        ).slice(0, 40),
        factoryId,
        itemKey,
        stage: stage.type,
        reason,
        evidenceDigest,
        kind,
      });
      if (reservedDecision.state === "pending" && configuration.claim !== undefined) {
        yield* recordDecisionOnTracker(configuration, subject, reservedDecision);
      }
    });
    if (isReservationRequest(decision)) {
      yield* reserve("gate", decision.reason, decision.evidenceDigest);
      return { disposition: "reserved_decision" };
    }
    if (isGateFailure(decision)) {
      if (stage.type !== "integrate") return { disposition: "stage_mismatch" };
      // One failure per exact gate finding on this basis, however often a pass asks.
      const failureDigest = sha256(decision.failure);
      const report: FactoryOutcomeStore.FactoryOutcomeReport = {
        outcome: "failed",
        failure: decision.failure,
        summary: "A product gate refused integration.",
      };
      yield* outcomeStore.insertReported({
        outcomeId: `gate:${sha256([factoryId, itemKey, stageBasis(stage), failureDigest].join("\n")).slice(0, 40)}`,
        factoryId,
        itemKey,
        origin: { type: "native" },
        stage: "integrate",
        report,
        reportDigest: sha256(canonical(report)),
        failureDigest,
        reportedAt: DateTime.formatIso(yield* DateTime.now),
        state: "reported",
      });
      yield* Queue.offer(wakes, { factoryId, trigger: "outcome" });
      return { disposition: "gate_failed", detail: decision.failure.slice(0, 500) };
    }
    if (isProceed(decision)) {
      if (stage.type !== "integrate" && stage.type !== "close") {
        return { disposition: "stage_mismatch" };
      }
      const plan =
        stage.type === "integrate"
          ? yield* nativeStages.planIntegration({
              configuration,
              itemKey,
              stage,
              issue: { ...subject, title: candidate.issue.title },
              branch: yield* reportedBranch(candidate.events, stage.head),
            })
          : yield* nativeStages.planClosure({ configuration, itemKey, stage });
      if (plan.type === "issue") {
        return {
          disposition: "blocked",
          detail: plan.issue,
          issue: { kind: stage.type, detail: plan.issue },
        };
      }
      return { disposition: stage.type === "integrate" ? "integrating" : "closing" };
    }
    // The policy decides the brief; the lifecycle decides which stage it is for.
    if (isLifecycleStage(decision.taskKind)) {
      if (decision.taskKind !== stage.type || !AGENT_STAGES.has(stage.type)) {
        return { disposition: "stage_mismatch" };
      }
    }
    let grant: FactoryAdmissionRequest["grant"];
    if (decision.requiresGrant !== undefined) {
      const required = decision.requiresGrant;
      const available = (yield* store.listGrants(factoryId)).find(
        (candidateGrant) =>
          candidateGrant.itemKey === itemKey &&
          candidateGrant.stage === stage.type &&
          candidateGrant.evidenceDigest === required.evidenceDigest &&
          candidateGrant.state === "active" &&
          candidateGrant.remaining > 0,
      );
      if (available === undefined) {
        yield* reserve("grant", required.reason, required.evidenceDigest);
        return { disposition: "awaiting_grant" };
      }
      grant = {
        grantId: available.grantId,
        stage: stage.type,
        evidenceDigest: required.evidenceDigest,
      };
    }
    const admission = yield* admit(
      isLifecycleStage(decision.taskKind)
        ? {
            ...decision,
            stage: { type: stage.type, basis: stageBasis(stage) },
            ...(candidate.owner === undefined ? {} : { continues: candidate.owner.reservationId }),
            ...(grant === undefined ? {} : { grant }),
          }
        : decision,
    );
    return {
      admission,
      disposition: admission.type === "refused" ? `refused:${admission.reason}` : admission.type,
    };
  });

  /**
   * Every trigger and the subjects it names are durable before anything reads them, so a pass
   * that is lost, or that could not decide them, leaves them for the next one.
   */
  const requestSubjects = (factoryId: FactoryId, subjects: FactoryCollectionInput["subjects"]) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO factory_collection_requests (factory_id, requested, completed)
          VALUES (${factoryId}, 1, 0)
          ON CONFLICT(factory_id) DO UPDATE SET requested = requested + 1
        `;
        const count = yield* requestedTriggers(factoryId);
        for (const subject of subjects) {
          yield* sql`
            INSERT INTO factory_collection_subjects (
              factory_id, item_key, repository, issue_number, requested, completed
            ) VALUES (
              ${factoryId}, ${FactoryItemKeyFor(subject)}, ${subject.repository},
              ${subject.issueNumber}, ${count}, 0
            )
            ON CONFLICT(factory_id, item_key) DO UPDATE SET requested = ${count}
          `;
        }
        return count;
      }),
    );

  const acquireCollector = (factoryId: FactoryId) =>
    Ref.modify(
      collecting,
      (
        owners,
      ): readonly [Option.Option<CollectorToken>, ReadonlyMap<FactoryId, CollectorToken>] => {
        if (owners.has(factoryId)) return [Option.none(), owners];
        const token: CollectorToken = { factoryId };
        return [Option.some(token), new Map(owners).set(factoryId, token)];
      },
    );

  /** Releases only the owner's own token: an older owner never clears a newer one. */
  const releaseCollector = (token: CollectorToken) =>
    Ref.update(collecting, (owners) => {
      if (owners.get(token.factoryId) !== token) return owners;
      const next = new Map(owners);
      next.delete(token.factoryId);
      return next;
    });

  const requestedTriggers = (factoryId: FactoryId) =>
    Effect.map(
      sql<{ readonly requested: number }>`
        SELECT requested FROM factory_collection_requests WHERE factory_id = ${factoryId}
      `,
      (rows) => rows[0]?.requested ?? 0,
    );

  /**
   * One owner's passes, until nothing it can still decide is pending. `attempted` rises to every
   * trigger count a pass snapshotted, so the owner knows which triggers it covered.
   */
  const ownedPasses = Effect.fnUntraced(function* (
    factoryId: FactoryId,
    attempted: { value: number },
    admissions: Array<FactoryAdmissionResult>,
  ) {
    let passes = 0;
    for (;;) {
      // Each pass decides under the configuration and policy current when it starts.
      const configuration = yield* store.getConfiguration(factoryId);
      if (Option.isNone(configuration) || configuration.value.claim === undefined) {
        // Nothing can be decided without a claim. Stopping here covers the triggers seen so far,
        // so the owner does not reacquire for them; their subjects stay pending.
        attempted.value = Math.max(attempted.value, yield* requestedTriggers(factoryId));
        return { passes, deferred: null };
      }
      const [factoryRequest] = yield* sql<{
        readonly requested: number;
        readonly completed: number;
      }>`
        SELECT requested, completed FROM factory_collection_requests
        WHERE factory_id = ${factoryId}
      `;
      const dirty = yield* sql<{
        readonly item_key: string;
        readonly repository: string;
        readonly issue_number: number;
        readonly requested: number;
      }>`
        SELECT item_key, repository, issue_number, requested FROM factory_collection_subjects
        WHERE factory_id = ${factoryId} AND requested > completed
        ORDER BY item_key
      `;
      const target = factoryRequest?.requested ?? 0;
      attempted.value = Math.max(attempted.value, target);
      if ((factoryRequest?.completed ?? 0) >= target && dirty.length === 0) {
        return { passes, deferred: null };
      }
      const proposer = policy.forFactory({
        factoryId,
        policyRevision: configuration.value.policyRevision,
        configuration: configuration.value,
      });
      admissions.push(
        ...(yield* collectPass(
          factoryId,
          configuration.value,
          configuration.value.claim,
          dirty.map((row) => ({ repository: row.repository, issueNumber: row.issue_number })),
          proposer,
        )),
      );
      passes++;
      if (Option.isNone(proposer)) {
        // Read and recorded, claims moved on, but nothing decided: the subjects stay pending
        // for a pass that has a policy, and this one stops instead of spinning.
        yield* sql`
          UPDATE factory_collection_requests
          SET completed = MAX(completed, ${target}), deferred_reason = 'policy_unavailable'
          WHERE factory_id = ${factoryId}
        `;
        return {
          passes,
          deferred: { reason: "policy_unavailable" as const, subjects: dirty.length },
        };
      }
      const completed = yield* sql.withTransaction(
        Effect.gen(function* () {
          // A revision adopted during the pass may have refused what this pass proposed, so its
          // subjects are read again under that revision.
          const current = yield* store.getConfiguration(factoryId);
          if (Option.isNone(current) || current.value.revision !== configuration.value.revision) {
            return false;
          }
          for (const row of dirty) {
            yield* sql`
              UPDATE factory_collection_subjects SET completed = MAX(completed, ${row.requested})
              WHERE factory_id = ${factoryId} AND item_key = ${row.item_key}
            `;
          }
          yield* sql`
            UPDATE factory_collection_requests
            SET completed = MAX(completed, ${target}), deferred_reason = NULL
            WHERE factory_id = ${factoryId}
          `;
          return true;
        }),
      );
      if (!completed) continue;
    }
  });

  /**
   * An owner that failed or was interrupted lets go, then hands any trigger it did not cover to
   * a catch-up in the lifecycle's own scope. The catch-up takes ownership itself once it runs, so
   * a newer owner may win instead, and a closing scope never starts it. Its floor is the count
   * read here: failing again before any pass, it hands off only triggers that came later.
   */
  const handOff = Effect.fn("FactoryLifecycle.handOff")(
    function* (token: CollectorToken, attempted: number) {
      yield* releaseCollector(token);
      const requested = yield* requestedTriggers(token.factoryId);
      if (requested <= attempted) return;
      yield* runCollector(token.factoryId, requested).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Factory collection catch-up failed; its triggers stay pending", {
            factoryId: token.factoryId,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.forkIn(collectorScope),
      );
    },
    (effect, token) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Factory collection could not hand off; its triggers stay pending", {
            factoryId: token.factoryId,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
  );

  /**
   * `floor` is a trigger count already read; `coalesced` means another owner (or its handoff)
   * covers this trigger. After its passes the owner releases, then re-reads the triggers: one
   * committed before that read runs here, one after it finds no owner and runs itself.
   * Ownership is never left held across an interruption point.
   */
  // Declared, since it and `handOff` refer to each other.
  const runCollector: (
    factoryId: FactoryId,
    floor: number,
  ) => Effect.Effect<
    FactoryCollectionResult,
    | Effect.Error<ReturnType<typeof ownedPasses>>
    | Effect.Error<ReturnType<typeof requestedTriggers>>
  > = Effect.fn("FactoryLifecycle.runCollector")(function* (factoryId: FactoryId, floor: number) {
    // A token's whole life runs masked: acquiring it, handling each pass's exit, releasing,
    // re-reading and reacquiring. Only the passes themselves can be interrupted, and their exit
    // is handled while this fiber still holds the token, so an interruption requested anywhere
    // else is delivered at the next pass, already covered, never between holding and handling.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const first = yield* acquireCollector(factoryId);
        if (Option.isNone(first)) return { type: "coalesced" } as const;
        let token = first.value;
        const admissions: Array<FactoryAdmissionResult> = [];
        let passes = 0;
        let deferred: Extract<FactoryCollectionResult, { type: "collected" }>["deferred"] = null;
        // What this owner's passes covered. Triggers it takes over by reacquiring stay above it
        // until a pass covers them, so a failure or interruption before then hands them off.
        const attempted = { value: floor };
        for (;;) {
          const result = yield* Effect.exit(restore(ownedPasses(factoryId, attempted, admissions)));
          if (Exit.isFailure(result)) {
            yield* handOff(token, attempted.value);
            return yield* Effect.failCause(result.cause);
          }
          passes += result.value.passes;
          deferred = result.value.deferred;
          yield* releaseCollector(token);
          const requested = yield* requestedTriggers(factoryId);
          if (requested <= attempted.value) {
            return { type: "collected", passes, admissions, deferred } as const;
          }
          const next = yield* acquireCollector(factoryId);
          if (Option.isNone(next)) {
            return { type: "collected", passes, admissions, deferred } as const;
          }
          token = next.value;
        }
      }),
    );
  });

  const collect = Effect.fn("FactoryLifecycle.collect")(
    function* (input: FactoryCollectionInput) {
      const requested = yield* requestSubjects(input.factoryId, input.subjects);
      return yield* runCollector(input.factoryId, requested);
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({ operation: "collect", factoryId: input.factoryId, cause }),
        ),
      ),
  );

  const decisionKeyFor = Effect.fn("FactoryLifecycle.decisionKeyFor")(
    function* (
      input: Pick<
        FactoryAdmissionRequest,
        "factoryId" | "itemKey" | "taskKind" | "policyRevision" | "basis"
      >,
    ) {
      const observation = yield* store.getObservation({
        factoryId: input.factoryId,
        observationId: input.basis.observationId,
      });
      return Option.isNone(observation) || observation.value.itemKey !== input.itemKey
        ? Option.none<FactoryDecisionKey>()
        : Option.some(decisionKeyOf(input, observation.value));
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "decision-key",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  const reconcile = Effect.fn("FactoryLifecycle.reconcile")(
    function* (input: { readonly factoryId: FactoryId; readonly trigger: FactoryTrigger }) {
      const configuration = yield* store.getConfiguration(input.factoryId);
      if (Option.isNone(configuration)) return { type: "idle", reason: "not_configured" } as const;
      const claim = configuration.value.claim;
      if (claim === undefined) return { type: "idle", reason: "no_claim" } as const;
      // A paused factory still finishes what it owns; it only stops looking for new items.
      const discovered = configuration.value.enabled
        ? yield* tracker.withSession(
            { host: claim.host, cwd: configuration.value.artifactRoot },
            (session) =>
              Effect.forEach(
                claim.repositories ?? [],
                (repository) =>
                  Effect.map(
                    // Not only the ready ones: an unready issue another claim holds is work under
                    // way whose files and resources new work must keep clear of.
                    session.listOpenIssues({ repository }),
                    (listed) =>
                      listed.flatMap((issue) =>
                        mayBeReadyOrClaimed(issue, claim)
                          ? [{ repository, issueNumber: issue.number }]
                          : [],
                      ),
                  ),
                { concurrency: 4 },
              ),
          )
        : [];
      const owned = [
        ...(yield* store.listReservations(input.factoryId))
          .filter(
            (reservation) => reservation.origin === "admitted" && reservation.state === "held",
          )
          .map((reservation) => reservation.itemKey),
        ...(yield* outcomeStore.openItems(input.factoryId)),
        ...(yield* operationStore.listIntended(input.factoryId)).map(
          (operation) => operation.itemKey,
        ),
        ...[...latestTransfers(yield* transfers.list(input.factoryId))].flatMap(
          ([itemKey, transfer]) => (transfer.state === "adopted" ? [itemKey] : []),
        ),
      ].flatMap((itemKey) => {
        const subject = subjectOf(itemKey);
        return subject === undefined ? [] : [subject];
      });
      const subjects = new Map(
        [...discovered.flat(), ...owned].map((subject) => [FactoryItemKeyFor(subject), subject]),
      );
      return yield* collect({
        factoryId: input.factoryId,
        trigger: input.trigger,
        subjects: [...subjects.values()],
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isLifecycleError(cause)
            ? cause
            : new FactoryLifecycleError({
                operation: "reconcile",
                factoryId: input.factoryId,
                cause,
              }),
        ),
      ),
  );

  const reconcileLogged = (factoryId: FactoryId, trigger: FactoryTrigger) =>
    reconcile({ factoryId, trigger }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Factory reconciliation failed; its triggers stay pending", {
          factoryId,
          trigger,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const reconcileConfigured = Effect.fnUntraced(function* (
    trigger: "restart" | "clock",
    elapsedMinutes: number,
  ) {
    const configurations = yield* store
      .listConfigurations()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.as(
            Effect.logWarning("Factory configurations unreadable", { cause: Cause.pretty(cause) }),
            [],
          ),
        ),
      );
    for (const configuration of configurations) {
      const every = configuration.reconcileEveryMinutes;
      if (trigger === "clock" && (every === undefined || elapsedMinutes % every !== 0)) continue;
      yield* reconcileLogged(configuration.factoryId, trigger);
    }
  });

  const drive: Effect.Effect<never> = Effect.scoped(
    Effect.gen(function* () {
      yield* reconcileConfigured("restart", 0);
      // A factory run that ended may have left a verified stage to settle and capacity to use.
      yield* orchestrator.streamDomainEvents.pipe(
        Stream.runForEach((event) =>
          event.type === "run.updated" && TERMINAL_RUN_STATUSES.has(event.payload.status)
            ? store.bindingForThread(event.threadId).pipe(
                Effect.flatMap((binding) =>
                  Option.isSome(binding)
                    ? Queue.offer(wakes, {
                        factoryId: binding.value.factoryId,
                        trigger: "outcome",
                      })
                    : Effect.void,
                ),
                Effect.ignore,
              )
            : Effect.void,
        ),
        Effect.ignore,
        Effect.forkScoped,
      );
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          for (let minute = 1; ; minute++) {
            yield* Effect.sleep(Duration.minutes(1));
            yield* reconcileConfigured("clock", minute);
            for (const factoryId of yield* Ref.getAndSet(retryWanted, new Set())) {
              yield* reconcileLogged(factoryId, "clock");
            }
          }
        }),
      );
      for (;;) {
        // Wakes that queued while a pass ran are one more pass per factory, not one each.
        const pending = new Map(
          (yield* Queue.takeAll(wakes)).map((wake) => [wake.factoryId, wake.trigger]),
        );
        for (const [factoryId, trigger] of pending) yield* reconcileLogged(factoryId, trigger);
        // An item a pass could not read is read again shortly, with no model involved.
        const retry = yield* Ref.getAndSet(retryWanted, new Set());
        for (const factoryId of retry) {
          yield* Queue.offer(wakes, { factoryId, trigger: "operation" }).pipe(
            Effect.delay(Duration.minutes(1)),
            Effect.forkScoped,
          );
        }
      }
    }),
  );

  const overview = Effect.fn("FactoryLifecycle.overview")(function* () {
    const configurations = yield* store
      .listConfigurations()
      .pipe(
        Effect.mapError(
          (cause) => new FactoryLifecycleError({ operation: "overview", factoryId: "", cause }),
        ),
      );
    return yield* Effect.forEach(configurations, (configuration) =>
      Effect.map(readState({ factoryId: configuration.factoryId }), (state) => ({
        factoryId: configuration.factoryId,
        state,
      })),
    );
  });

  const resolveReservedDecision = Effect.fn("FactoryLifecycle.resolveReservedDecision")(
    function* (input: {
      readonly factoryId: FactoryId;
      readonly decisionId: string;
      readonly answer: string;
      readonly by: string;
      readonly grantUnits?: number | undefined;
    }) {
      const decision = (yield* outcomeStore.reservedDecisions(input.factoryId)).find(
        (candidate) => candidate.decisionId === input.decisionId,
      );
      if (decision === undefined || decision.state !== "pending") return false;
      // A grant answers exactly the request it was asked for: this item, stage and evidence.
      const grant =
        decision.kind === "grant" && input.grantUnits !== undefined && input.grantUnits > 0
          ? yield* store.issueGrant({
              factoryId: input.factoryId,
              itemKey: decision.itemKey,
              stage: decision.stage,
              evidenceDigest: decision.evidenceDigest,
              units: input.grantUnits,
              decisionId: decision.decisionId,
              by: input.by,
            })
          : undefined;
      const resolved = yield* outcomeStore.resolveDecision({
        decisionId: input.decisionId,
        answer: input.answer,
        by: input.by,
        ...(grant === undefined ? {} : { grantId: grant.grantId }),
      });
      if (!resolved) return false;
      yield* wakeFor(input.factoryId, decision.itemKey);
      return true;
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "resolve-reserved-decision",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  const rejectOutcome = Effect.fn("FactoryLifecycle.rejectOutcome")(
    function* (input: {
      readonly factoryId: FactoryId;
      readonly outcomeId: string;
      readonly reason: string;
      readonly by: string;
    }) {
      const outcome = yield* outcomeStore.get(input.outcomeId);
      if (Option.isNone(outcome) || outcome.value.factoryId !== input.factoryId) return false;
      const rejected = yield* outcomeStore.rejectVerified({
        outcomeId: input.outcomeId,
        failureDigest: sha256(`rejected:${input.outcomeId}\n${input.reason}`),
        by: input.by,
        reason: input.reason,
      });
      if (rejected) yield* wakeFor(input.factoryId, outcome.value.itemKey);
      return rejected;
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "reject-outcome",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      ),
  );

  const CARD_REASON_LIMIT = 2_000;
  /** A card answer as its value: current clients send an option's value, older ones its label. */
  const cardChoice = (
    answers: Readonly<Record<string, unknown>>,
    questionId: string,
    choices: Readonly<Record<string, string>>,
  ) => {
    const raw = answers[questionId];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? choices[value.trim().toLowerCase()] : undefined;
  };
  const cardText = (answers: Readonly<Record<string, unknown>>, questionId: string) => {
    const raw = answers[questionId];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? value.trim() : "";
  };
  const GATE_CHOICES = { approve: "approve", "grant one start": "approve", decline: "decline" };
  const RESULT_CHOICES = {
    reject: "reject",
    "reject result": "reject",
    keep: "keep",
    "keep it": "keep",
  };
  const itemLabel = (itemKey: string) =>
    itemKey.startsWith("github:") ? itemKey.slice("github:".length) : itemKey;

  const gateQuestions = (
    factoryId: FactoryId,
    decision: FactoryOutcomeStore.ReservedDecision,
  ): ReadonlyArray<OrchestrationV2UserInputQuestion> => [
    {
      id: "decision",
      header: decision.kind === "grant" ? "Factory grant" : "Factory gate",
      question: `${itemLabel(decision.itemKey)} · ${decision.stage}: ${decision.reason} (factory ${factoryId}, decision ${decision.decisionId})`,
      options: [
        decision.kind === "grant"
          ? {
              label: "Grant one start",
              description: "Allow exactly one start of this request.",
              value: "approve",
            }
          : {
              label: "Approve",
              description: "Let the factory proceed on exactly this decision.",
              value: "approve",
            },
        { label: "Decline", description: "Keep it held.", value: "decline" },
      ],
    },
  ];

  const resultQuestions = (
    factoryId: FactoryId,
    result: FactoryResultView,
  ): ReadonlyArray<OrchestrationV2UserInputQuestion> => [
    {
      id: "action",
      header: "Stalled result",
      question: `${itemLabel(result.itemKey)} is stalled: its ${result.stage} is already decided on ${result.outcomeStage} result ${result.outcomeId} (${result.kind}${result.head === undefined ? "" : ` at ${result.head.slice(0, 12)}`}, ${result.artifacts} artifact(s), factory ${factoryId}). ${result.summary}`,
      options: [
        {
          label: "Reject result",
          description: "Send the item back to correction with your reason.",
          value: "reject",
        },
        { label: "Keep it", description: "Leave the result and stop asking.", value: "keep" },
      ],
    },
    {
      id: "reason",
      header: "Reason",
      question: "Why is this result not acceptable? Required to reject it.",
      options: [],
      allowCustomAnswer: true,
      required: false,
    },
  ];

  /**
   * Asks the owner, in the owner's thread, for each decision only they can make: a pending gate
   * or grant, and a result an item is stalled on. Cards whose subject settled are closed; a card
   * the owner answered is never raised again, a dismissed one is.
   */
  const syncOwnerCards = Effect.fn("FactoryLifecycle.syncOwnerCards")(function* (
    factoryId: FactoryId,
  ) {
    const configuration = yield* store.getConfiguration(factoryId);
    const ownerThreadId = Option.isSome(configuration)
      ? configuration.value.ownerThreadId
      : undefined;
    if (ownerThreadId === undefined) return;
    const decisions = yield* outcomeStore.reservedDecisions(factoryId);
    const records = [...((yield* Ref.get(lastPass)).get(factoryId)?.values() ?? [])];
    const stalled = yield* stageResultsOf(
      factoryId,
      records.filter((record) => record.disposition === "existing"),
    );
    const wanted = new Map<
      string,
      {
        readonly kind: "gate" | "result";
        readonly subjectId: string;
        readonly questions: ReadonlyArray<OrchestrationV2UserInputQuestion>;
      }
    >();
    for (const decision of decisions) {
      if (decision.state !== "pending") continue;
      wanted.set(`gate:${decision.decisionId}`, {
        kind: "gate",
        subjectId: decision.decisionId,
        questions: gateQuestions(factoryId, decision),
      });
    }
    for (const result of stalled) {
      wanted.set(`result:${result.outcomeId}`, {
        kind: "result",
        subjectId: result.outcomeId,
        questions: resultQuestions(factoryId, result),
      });
    }
    const projection = yield* projections.getThreadRecords(ownerThreadId, ["runtimeRequests"]);
    const cards = projection.runtimeRequests.flatMap((request) => {
      const card = parseFactoryCardRequestId(request.id);
      return card === undefined || card.factoryId !== factoryId ? [] : [{ ...card, request }];
    });
    for (const card of cards) {
      if (card.request.status !== "pending" || wanted.has(`${card.kind}:${card.subjectId}`)) {
        continue;
      }
      const answered = decisions.some(
        (decision) => decision.decisionId === card.subjectId && decision.state === "resolved",
      );
      yield* orchestrator.dispatch({
        type: "factory_card.resolve",
        commandId: CommandId.make(`factory-card-resolve:${card.request.id}`),
        threadId: ownerThreadId,
        requestId: card.request.id,
        status: answered ? "resolved" : "cancelled",
      });
    }
    for (const [key, want] of wanted) {
      const prior = cards.filter((card) => `${card.kind}:${card.subjectId}` === key);
      if (
        prior.some(
          (card) => card.request.status === "pending" || card.request.status === "resolved",
        )
      ) {
        continue;
      }
      const requestId = RuntimeRequestId.make(
        factoryCardRequestId({
          factoryId,
          kind: want.kind,
          subjectId: want.subjectId,
          n: prior.reduce((highest, card) => Math.max(highest, card.n), 0) + 1,
        }),
      );
      yield* orchestrator.dispatch({
        type: "factory_card.record",
        commandId: CommandId.make(`factory-card-record:${requestId}`),
        threadId: ownerThreadId,
        requestId,
        questions: want.questions,
      });
    }
  });

  const answerCard = Effect.fn("FactoryLifecycle.answerCard")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
      readonly answers: Readonly<Record<string, unknown>>;
      readonly by: string;
    }) {
      const refuse = (message: string) => Effect.fail(new FactoryCardRefused({ message }));
      const card = parseFactoryCardRequestId(input.requestId);
      if (card === undefined) return yield* refuse("This is not a factory decision.");
      const factoryId = FactoryId.make(card.factoryId);
      const configuration = yield* store.getConfiguration(factoryId);
      if (Option.isNone(configuration) || configuration.value.ownerThreadId !== input.threadId) {
        return yield* refuse("This factory decision does not belong to this thread.");
      }
      const projection = yield* projections.getThreadRecords(input.threadId, ["runtimeRequests"]);
      const request = projection.runtimeRequests.find(
        (candidate) => candidate.id === input.requestId,
      );
      if (request?.status !== "pending") {
        return yield* refuse("This factory decision was already answered or dismissed.");
      }
      const close = (
        status: "resolved" | "cancelled",
        answers?: Readonly<Record<string, string>>,
      ) =>
        orchestrator.dispatch({
          type: "factory_card.resolve",
          commandId: CommandId.make(`factory-card-resolve:${input.requestId}`),
          threadId: input.threadId,
          requestId: request.id,
          status,
          ...(answers === undefined ? {} : { answers }),
        });
      if (card.kind === "gate") {
        const decision = (yield* outcomeStore.reservedDecisions(factoryId)).find(
          (candidate) => candidate.decisionId === card.subjectId,
        );
        if (decision?.state !== "pending") {
          yield* close("cancelled");
          return yield* refuse("This decision is already settled.");
        }
        const choice = cardChoice(input.answers, "decision", GATE_CHOICES);
        if (choice === undefined) return yield* refuse("Choose Approve or Decline.");
        const resolved = yield* resolveReservedDecision({
          factoryId,
          decisionId: decision.decisionId,
          by: input.by,
          ...(choice === "decline"
            ? { answer: "decline" }
            : decision.kind === "grant"
              ? { answer: "grant", grantUnits: 1 }
              : { answer: "approve" }),
        });
        if (!resolved) {
          yield* close("cancelled");
          return yield* refuse("This decision is already settled.");
        }
        return yield* close("resolved", { decision: choice });
      }
      const stored = yield* outcomeStore.get(card.subjectId);
      const current =
        Option.isNone(stored) || stored.value.factoryId !== factoryId
          ? undefined
          : yield* currentStageResult(factoryId, stored.value.itemKey);
      if (current?.outcomeId !== card.subjectId) {
        yield* close("cancelled");
        return yield* refuse(
          "This result is no longer the one its item's next stage is decided on.",
        );
      }
      const choice = cardChoice(input.answers, "action", RESULT_CHOICES);
      if (choice === undefined) return yield* refuse("Choose Reject result or Keep it.");
      if (choice === "keep") return yield* close("resolved", { action: "keep" });
      const reason = cardText(input.answers, "reason");
      if (reason.length === 0 || reason.length > CARD_REASON_LIMIT) {
        return yield* refuse("Give a reason, up to 2,000 characters, to reject the result.");
      }
      const rejected = yield* rejectOutcome({
        factoryId,
        outcomeId: card.subjectId,
        reason,
        by: input.by,
      });
      if (!rejected) {
        yield* close("cancelled");
        return yield* refuse("This result is no longer one the factory can reject.");
      }
      return yield* close("resolved", { action: "reject", reason });
    },
    (effect, input) =>
      effect.pipe(
        Effect.map((result) => ({ sequence: result.sequence })),
        Effect.catchIf(
          (cause) => !isFactoryCardRefused(cause),
          (cause) =>
            Effect.fail(
              new FactoryLifecycleError({
                operation: "answer-card",
                factoryId: parseFactoryCardRequestId(input.requestId)?.factoryId ?? "unknown",
                cause,
              }),
            ),
        ),
      ),
  );

  return FactoryLifecycle.of({
    overview,
    collect,
    reconcile,
    drive,
    decisionKeyFor,
    configure,
    installConfiguration,
    observeClaims,
    beginCollection,
    recordItemObservation,
    admit,
    readState,
    report: outcomeOps.report,
    transferLegacy: Effect.fn("FactoryLifecycle.transferLegacy")(function (input) {
      return transferOps.transferLegacy(input).pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "transfer-legacy",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      );
    }),
    rollbackTransfer: Effect.fn("FactoryLifecycle.rollbackTransfer")(function (input) {
      return transferOps.rollbackTransfer(input).pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "rollback-transfer",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      );
    }),
    disposeObservedClaim: Effect.fn("FactoryLifecycle.disposeObservedClaim")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly reservationId: FactoryReservationId;
        readonly by: string;
        readonly reason: string;
      }) {
        const reservation = yield* store.getReservation(input.reservationId);
        if (Option.isNone(reservation) || reservation.value.factoryId !== input.factoryId) {
          return false;
        }
        if (!(yield* store.disposeObservedReservation(input))) return false;
        const subject = subjectOf(reservation.value.itemKey);
        if (subject !== undefined) yield* requestSubjects(input.factoryId, [subject]);
        yield* Queue.offer(wakes, { factoryId: input.factoryId, trigger: "owner_decision" });
        return true;
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new FactoryLifecycleError({
                operation: "dispose-observed-claim",
                factoryId: input.factoryId,
                cause,
              }),
          ),
        ),
    ),
    resolveReservedDecision,
    answerCard,
    revokeGrant: Effect.fn("FactoryLifecycle.revokeGrant")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly grantId: string;
        readonly by: string;
      }) {
        const grant = (yield* store.listGrants(input.factoryId)).find(
          (candidate) => candidate.grantId === input.grantId,
        );
        if (grant === undefined) return false;
        return yield* store.revokeGrant({ grantId: input.grantId, by: input.by });
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new FactoryLifecycleError({
                operation: "revoke-grant",
                factoryId: input.factoryId,
                cause,
              }),
          ),
        ),
    ),
    rejectOutcome,
  });
});

export const layer = Layer.effect(FactoryLifecycle, make).pipe(
  Layer.provide(FactoryOutcomeStore.layer),
  Layer.provide(FactoryOperationStore.layer),
  Layer.provide(FactoryExecutionGenerations.layer),
  Layer.provide(FactoryClaimStore.layer.pipe(Layer.provideMerge(FactoryStore.layer))),
);

/** Runs the factories' own triggers in the server once it is activated. */
export const layerDriver = Layer.effectDiscard(
  Effect.flatMap(FactoryLifecycle, (lifecycle) => forkParked(lifecycle.drive)),
);
