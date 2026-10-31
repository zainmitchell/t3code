// @effect-diagnostics nodeBuiltinImport:off - sha256 of small identity strings.
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  FactoryDecisionKey,
  factoryCardRequestId,
  factoryDecisionChoices,
  FactoryId,
  FactoryItemKey,
  type FactoryObservationId,
  type FactoryPoolId,
  type FactoryReadGeneration,
  type FactoryEnterInput,
  type FactoryEnterResult,
  type FactoryReportFailure,
  type FactoryReportInput,
  type FactoryReportResult,
  type FactoryReservationId,
  type FactorySwitchProviderInput,
  type FactorySwitchProviderResult,
  MessageId,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type OrchestrationV2UserInputQuestion,
  parseFactoryCardRequestId,
  RuntimeRequestId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, sanitizeBranchFragment } from "@t3tools/shared/git";
import * as HostProcess from "@t3tools/shared/HostProcess";
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
import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import {
  type HelperInvocationRefusal,
  isEligible,
  issueObservation,
  issueTextDigest,
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
import { entryView } from "./factoryEntry.ts";
import {
  canonical,
  candidateBaseProblem,
  makeFactoryOutcomes,
  subjectOf,
} from "./factoryOutcomes.ts";
import {
  neverStartedRefusals,
  quarantineRefusals,
  readNeverStartedEvidence,
  readQuarantineEvidence,
  readResidualFacts,
  readTerminationEvidence,
  residualScopeOf,
  terminationRefusals,
} from "./factoryDisposition.ts";
import {
  decodeHistoricalProvenance,
  HistoricalProvenanceSource,
  HostBootReader,
  RESIDUAL_UNCERTAINTIES,
  type ResidualUncertainty,
} from "./factoryHistoricalTermination.ts";
import { makeNativeStages, TICKET_DECISION_STAGE } from "./factoryNativeStages.ts";
import { makeBookkeeping } from "./factoryBookkeeping.ts";
import { makeSwitchProvider } from "./factoryProviderSwitch.ts";
import { decisionGuidance } from "./factoryDecisionGuidance.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryPreparedCriteriaStore from "./FactoryPreparedCriteriaStore.ts";
import {
  adoptedClauses,
  bindingBasis,
  criteriaProposalProblems,
  type Criteria,
  decodeCriteria,
  decodeVerificationDocument,
  defectChild,
  failureAnswered,
  type LandingOrigin,
  landingOf,
  landingOrigin,
  namesPolicy,
  type NoEditRequirement,
  noEditBasis,
  outputRootName,
  parseJson,
  type PinnedFile,
  preparedCriteriaProblems,
  reconcileCriteria,
  reviewedHeadsOf,
  waitText,
} from "./factoryCoordination.ts";
import * as FactoryTransferStore from "./FactoryTransferStore.ts";
import {
  type FactoryTransferInput,
  type FactoryTransferResult,
  latestTransfers,
  makeTransfers,
  declaresOwnedFiles,
  namesOwnedFiles,
} from "./factoryTransfers.ts";
import { forkParked } from "../serverActivation.ts";
import {
  AGENT_STAGES,
  type FactoryStage,
  type FactoryStageType,
  isFactoryStage,
  nextStage,
  PARENT_CLOSURE,
  stageBasis,
  triageBasis,
} from "./factoryStages.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/** The marker a reserved decision's tracker record carries, found before any write. */
const decisionMarker = (decisionId: string) => `<!-- t3-factory-decision:${decisionId} -->`;

/**
 * Whether a correction spec repairs only a no-edit unit's run: its first line past any marker
 * comment declares an execution_binding_repair, or every failure class it states is harness and
 * it states that no source changes.
 */
const repairsRun = (summary: string) => {
  const lines = summary.split("\n").map((line) => line.trim());
  const first = lines.find((line) => line !== "" && !/^<!--.*-->$/.test(line));
  if (/^action class:\s*execution_binding_repair$/i.test(first ?? "")) return true;
  const classes = lines.flatMap((line) => /^failure class:\s*(\S+)$/i.exec(line)?.[1] ?? []);
  return (
    classes.length > 0 &&
    classes.every((each) => each.toLowerCase() === "harness") &&
    lines.includes("No source change; review the same head again on its evidence")
  );
};

type DecidedProposal = Exclude<FactoryPolicyDecision, undefined>;

const isReservationRequest = (proposal: DecidedProposal): proposal is FactoryReservation =>
  "type" in proposal && proposal.type === "reserve";

const isGateFailure = (proposal: DecidedProposal): proposal is FactoryGateFailure =>
  "type" in proposal && proposal.type === "gate_failed";

const isProceed = (proposal: DecidedProposal): proposal is FactoryProceed =>
  "type" in proposal && proposal.type === "proceed";

const isNothingProposed = (proposal: DecidedProposal): proposal is FactoryNothingProposed =>
  "type" in proposal && proposal.type === "none";

const isSpawnRequest = (proposal: DecidedProposal): proposal is FactorySpawnRequest =>
  "type" in proposal && proposal.type === "spawn";

const isPolicyFailure = (
  proposal: DecidedProposal | ReadonlyArray<unknown>,
): proposal is FactoryPolicyFailure =>
  !Array.isArray(proposal) && "type" in proposal && proposal.type === "policy_failed";

/** The identity of an owner gate asked on its evidence, as gates were before questions had names. */
const evidenceGateId = (input: {
  readonly factoryId: string;
  readonly itemKey: string;
  readonly stage: string;
  readonly evidenceDigest: string;
}) =>
  sha256(
    [input.factoryId, input.itemKey, input.stage, "gate", input.evidenceDigest, "0"].join("\n"),
  ).slice(0, 40);

/** The identity of an owner gate the policy names by its question rather than its evidence. */
const gateDecisionId = (input: {
  readonly factoryId: string;
  readonly itemKey: string;
  readonly stage: string;
  readonly question: string;
}) =>
  sha256(
    [input.factoryId, input.itemKey, input.stage, "gate", `question:${input.question}`, "0"].join(
      "\n",
    ),
  ).slice(0, 40);

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
  // A parent closure waiting on its owner's answer still asks that question.
  if (isProceed(decision) && decision.parentClosure?.ownerDecisionId === pending.decisionId) {
    return undefined;
  }
  if (isReservationRequest(decision) && decision.question !== undefined) {
    // The gate still asks when it is this question, or the same evidence asked before questions
    // were named; any other pending gate is another question.
    return pending.question === decision.question ||
      pending.decisionId === gateDecisionId({ ...pending, question: decision.question }) ||
      (pending.question === undefined &&
        pending.decisionId === evidenceGateId(pending) &&
        pending.evidenceDigest === decision.evidenceDigest)
      ? undefined
      : "the policy now asks another question";
  }
  const asks = isReservationRequest(decision)
    ? { kind: "gate", evidenceDigest: decision.evidenceDigest }
    : isProceed(decision) ||
        isGateFailure(decision) ||
        isSpawnRequest(decision) ||
        decision.requiresGrant === undefined
      ? undefined
      : { kind: "grant", evidenceDigest: decision.requiresGrant.evidenceDigest };
  if (asks === undefined) return "the policy no longer asks the owner";
  return asks.kind === (pending.kind ?? "gate") && asks.evidenceDigest === pending.evidenceDigest
    ? undefined
    : "the evidence it was asked on changed";
};

/**
 * The pending gate a policy's explicit withdrawal supersedes, or why it supersedes none: only an
 * unanswered owner gate of this item, stage and evidence, withdrawn on the item version and policy
 * revision of this pass. A grant request, or T3's own ticket question, is never withdrawn.
 */
const withdrawalOf = (
  reserved: ReadonlyArray<FactoryOutcomeStore.ReservedDecision>,
  candidate: {
    readonly itemKey: FactoryItemKey;
    readonly stage: FactoryStage;
    readonly observation: { readonly itemVersion: string };
  },
  withdrawal: FactoryGateWithdrawal,
  policyRevision: string,
): { readonly decisionId: string; readonly reason: string } | { readonly refused: string } => {
  const named = `decision ${withdrawal.decisionId}`;
  const pending = reserved.find((decision) => decision.decisionId === withdrawal.decisionId);
  if (pending === undefined || pending.itemKey !== candidate.itemKey) {
    return { refused: `${named} is not this item's` };
  }
  if (pending.state !== "pending") return { refused: `${named} is already ${pending.state}` };
  if ((pending.kind ?? "gate") !== "gate" || pending.stage === TICKET_DECISION_STAGE) {
    return { refused: `${named} is not a policy gate` };
  }
  if (withdrawal.stage !== pending.stage || pending.stage !== candidate.stage.type) {
    return { refused: `${named} was asked at its ${pending.stage} stage, not ${withdrawal.stage}` };
  }
  if (withdrawal.evidenceDigest !== pending.evidenceDigest) {
    return { refused: `${named} was asked on other evidence` };
  }
  if (withdrawal.itemVersion !== candidate.observation.itemVersion) {
    return { refused: `the withdrawal of ${named} names another item version` };
  }
  if (withdrawal.policyRevision !== policyRevision) {
    return { refused: `the withdrawal of ${named} names another policy revision` };
  }
  return { decisionId: pending.decisionId, reason: `the policy withdrew it: ${withdrawal.reason}` };
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

/** An install that names a revision it replaces which is no longer the latest; nothing installed. */
export class FactoryConfigurationStale extends Schema.TaggedError<FactoryConfigurationStale>()(
  "FactoryConfigurationStale",
  { factoryId: Schema.String, revision: Schema.Number, expectRevision: Schema.Number },
) {
  override get message(): string {
    return `${this.factoryId} is at revision ${this.revision}, not ${this.expectRevision}: nothing installed`;
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
  /** Named single-capacity resources the work holds while it runs; sorted, distinct. */
  readonly resources?: ReadonlyArray<string>;
  /**
   * The triage outcome whose proposal this first build adopts. It starts only while that proposal
   * is the item's current preparation and its base reads back where the build starts.
   */
  readonly prepared?: string;
  /** The policy's pointer to the Root-adopted binding a bound verification runs under. */
  readonly verificationBinding?: PinnedFile;
  /** An adopted no-edit unit: it verifies an exact existing commit and changes no file. */
  readonly noEdit?: NoEditRequirement;
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
  | "workspace_branch_exists"
  | "workspace_branch_unreadable"
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
  | "in_progress"
  /** Held under the owner's quarantine: owns its item, is not charged, proves nothing. */
  | "quarantined"
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
  /** A read that cannot succeed as asked: a pull request's number, or not found or refused. */
  | "unavailable"
  /** Work under way on another item was not read by this pass, so nothing was decided beside it. */
  | "custody_unread"
  | "blocked"
  /** T3 is opening the tracker issue the item's evidence asked for. */
  | "spawning"
  /** A transfer of it is draining its legacy writer, or was rolled back to it. */
  | "legacy_owned"
  /** Transferred, with its legacy writer's custody held until the owner disposes of it. */
  | "legacy_custody"
  /** Legacy work T3 cannot scope may still write on another item, so nothing new starts. */
  | "legacy_unscoped"
  /** A product gate refused T3's own stage; the failure goes to correction. */
  | "gate_failed";

export interface FactoryItemDispositionRecord {
  readonly itemKey: FactoryItemKey;
  readonly stage: FactoryStage["type"] | null;
  readonly disposition: FactoryItemDisposition;
  readonly detail?: string;
  /** The policy's class for why nothing was proposed, such as `needs_routing`. */
  readonly reasonClass?: string;
  readonly at: string;
}

/** What one pass did with the items it read, as counts the owner can watch over time. */
export interface FactoryPassMetrics {
  readonly at: string;
  readonly read: number;
  readonly admitted: number;
  readonly byDisposition: Readonly<Record<string, number>>;
  readonly byReasonClass: Readonly<Record<string, number>>;
}

export type FactoryReconcileResult =
  | FactoryCollectionResult
  | { readonly type: "idle"; readonly reason: "not_configured" | "no_claim" };

/**
 * The stage-basis suffix naming the execution chosen for a decision that holds resources or
 * verifies a no-edit unit, so its reservation records that choice. Other decisions keep their keys.
 */
const choiceBasis = (decision: {
  readonly execution?: string | undefined;
  readonly resources?: ReadonlyArray<string> | undefined;
  readonly noEdit?: unknown;
}) =>
  decision.execution === undefined ||
  ((decision.resources ?? []).length === 0 && decision.noEdit === undefined)
    ? ""
    : `|exe:${encodeURIComponent(decision.execution)}`;

/** An execution as it runs: its model selection with options, runtime and interaction mode. */
const executionIdentity = (execution: {
  readonly modelSelection: unknown;
  readonly runtimeMode: string;
  readonly interactionMode: string;
}) =>
  sha256(
    canonical([execution.modelSelection, execution.runtimeMode, execution.interactionMode]),
  ).slice(0, 32);

/** The stage-basis suffix naming the single-capacity resources a decision holds. */
const resourceBasis = (resources: ReadonlyArray<string> | undefined) =>
  resources === undefined || resources.length === 0 ? "" : `|res:${resources.join(",")}`;

/** The most evidence items one adopted criteria document has projected for the policy. */
const CRITERIA_EVIDENCE_LIMIT = 200;

/** How long a stranded claim waits after a failed replay before a pass gives it another. */
const REPLAY_PAUSE = { minutes: 30 } as const;

export interface FactoryCollectionInput {
  readonly factoryId: FactoryId;
  /** What asked for the pass; triggers that arrive while one runs coalesce into one more pass. */
  readonly trigger: FactoryTrigger;
  /** Items to read; they stay pending, across restarts, until a pass with a policy reads them. */
  readonly subjects: ReadonlyArray<{ readonly repository: string; readonly issueNumber: number }>;
}

/**
 * An outcome as policy reads it. A result of an admitted stage names the item version that stage
 * was admitted on, so a result for older text never stands for the item's current text: a triage
 * proposal, or a failure that a correction on unchanged text would only repeat.
 */
export type FactoryPolicyOutcome = FactoryOutcomeStore.FactoryOutcome & {
  readonly itemVersion?: string;
  /** The policy revision its stage was admitted under, so a stale preparation is never adopted. */
  readonly policyRevision?: string;
  /** The decision its stage was admitted as: a triage result counts only for its own inputs. */
  readonly decisionKey?: FactoryDecisionKey;
  /** For an integration: the operation whose own applied receipt proves exactly this landing. */
  readonly landingOrigin?: LandingOrigin;
};

/** Another item's recorded outcomes and validity events, as policy reads them. */
export interface FactoryPolicyItemFacts {
  readonly itemKey: FactoryItemKey;
  readonly outcomes: ReadonlyArray<FactoryPolicyOutcome>;
  /** Each names the outcome it rejects or whose closure it invalidates, by outcome id. */
  readonly events?: ReadonlyArray<
    | { readonly type: "rejected"; readonly outcomeId: string; readonly failureDigest: string }
    | { readonly type: "reopened"; readonly closureOutcomeId: string }
  >;
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
  readonly outcomes: ReadonlyArray<FactoryPolicyOutcome>;
  /**
   * Each closed blocker in the item's own repository, with this factory's outcomes for it as
   * recorded: tracker closure alone never shows that its work was reviewed and integrated.
   * Rejections and reopens are carried as recorded, never folded into an outcome's state.
   */
  readonly blockers?: ReadonlyArray<FactoryPolicyItemFacts>;
  /**
   * Every sub-issue of a parent in its own repository, open or closed, with this factory's
   * outcomes for it: only when the whole membership was read. Membership is no evidence by itself.
   */
  readonly children?: ReadonlyArray<
    FactoryPolicyItemFacts & {
      readonly state: "open" | "closed";
      /** Its current body from the same membership read; absent when that read carried none. */
      readonly body?: string;
    }
  >;
  /**
   * The items Root's one adopted criteria document for this item names as evidence, in its own
   * repository, with this factory's outcomes and validity events: no tracker relation is implied.
   * An item T3 holds no record of is left out, as is every key past the bound.
   */
  readonly criteriaEvidence?: ReadonlyArray<FactoryPolicyItemFacts>;
  /** Why a parent's children are not given: its membership could not be read whole. */
  readonly childrenUnread?: {
    readonly reason: string;
    /** Sub-issues in another repository, whose outcomes this factory does not hold. */
    readonly foreign: ReadonlyArray<FactoryItemKey>;
  };
  /** The decision a request for this stage would be, so its packet can name its work key. */
  readonly decisionKey: FactoryDecisionKey;
  /**
   * The preparation the factory owes the item now, from its own records: a routine coordination
   * gap its last preparation stopped on, or a legacy needs-main label. A policy that sees it
   * triages on `triageDecisionKey`; a person's hold never makes one due.
   */
  readonly preparation?: {
    readonly due: true;
    readonly reason: "routine_gap" | "legacy_needs_main";
    readonly gap?: string;
  };
  /**
   * The decision a triage of this item version is: the earlier one it reuses when only comments
   * were added since, else a new one. Only before its first build.
   */
  readonly triageDecisionKey?: FactoryDecisionKey;
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
  /** A parent to close on its adopted criteria, which T3 reconciles itself before it closes. */
  readonly parentClosure?: {
    /** Root-adopted criteria for the current body. */
    readonly criteria?: PinnedFile | undefined;
    /**
     * Criteria the project's policy prepared from the parent's verified criteria proposal, with
     * the adopted document it carried forward. T3 revalidates every clause against its own reads
     * and keeps the bytes under the criteria root before it closes on them.
     */
    readonly prepared?:
      | {
          readonly bytes: string;
          readonly sha256: string;
          readonly adopted?: PinnedFile | undefined;
        }
      | undefined;
    readonly ownerDecisionId?: string | undefined;
  };
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
  /** A class the owner can count across passes, such as `needs_routing`. */
  readonly class?: string;
  /** One pending owner gate the policy raised that no longer stands; never an answer to it. */
  readonly withdraws?: FactoryGateWithdrawal;
}

/**
 * A policy's explicit withdrawal of one pending gate, naming it as the policy was given it: its
 * decision, evidence and stage, the item version and the policy revision it decides on now.
 */
export interface FactoryGateWithdrawal {
  readonly decisionId: string;
  readonly evidenceDigest: string;
  readonly stage: string;
  readonly itemVersion: string;
  readonly policyRevision: string;
  readonly reason: string;
}

/**
 * The policy asks T3 to open a tracker issue the item's own evidence calls for (a correction
 * ticket for a verification-only item's spec). Opened once per item and stage basis, whatever its wording,
 * by durable intent and readback, and recorded on the item as `ticket_opened`.
 */
export interface FactorySpawnRequest {
  readonly type: "spawn";
  readonly reason: string;
  readonly ticket: {
    readonly title: string;
    readonly body: string;
    readonly labels: ReadonlyArray<string>;
    readonly parentIssueNumber: number | null;
    readonly blocks: ReadonlyArray<number>;
  };
}

/** One item's decision: a worker's admission, a reserved gate, a native go-ahead, or nothing. */
export type FactoryPolicyDecision =
  | FactoryAdmissionRequest
  | FactoryReservation
  | FactoryProceed
  | FactoryGateFailure
  | FactorySpawnRequest
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
  /**
   * The question's own identity, when the policy names one: the same question on reworded
   * evidence is still that one decision, and once withdrawn or answered it is not asked again.
   */
  readonly question?: string | undefined;
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

/**
 * The result a stage is decided on. An owner's rejection of it sends the item to correction, or for a
 * review result, back to a fresh review of the same head.
 */
const stageResult = (stage: FactoryStage): string | undefined => {
  switch (stage.type) {
    case "review":
    case "correct":
      return stage.retryOutcomeId ?? stage.outcomeId;
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
  /** The environment's agent ceiling, shared by every factory, and what it counts now. */
  readonly agents: FactoryStore.AgentOccupancy;
  /** Decisions only the owner can make, pending until that authority resolves them. */
  readonly reservedDecisions: ReadonlyArray<FactoryOutcomeStore.ReservedDecision>;
  /**
   * What this process's latest pass decided for each item it read, and why. Empty after a
   * restart until the restart pass runs.
   */
  readonly lastCollection: ReadonlyArray<FactoryItemDispositionRecord>;
  /** The latest pass's counts; null until this process ran one. */
  readonly lastPassMetrics: FactoryPassMetrics | null;
  /** Items that wait now, as recorded durably, from when each was first seen waiting so. */
  readonly waits: ReadonlyArray<FactoryOutcomeStore.FactoryItemWait>;
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
    /**
     * The owner installs a factory's configuration from its JSON document, validated whole, only
     * while `expectRevision` (0 for a new factory) is still its latest, checked in the same write.
     */
    readonly installConfiguration: (
      document: string,
      expectRevision: number,
    ) => Effect.Effect<
      FactoryStore.FactoryConfiguration,
      FactoryConfigurationInvalid | FactoryConfigurationStale | FactoryLifecycleError
    >;
    /**
     * The owner moves future work from one provider instance to another, given the providers this
     * server runs now. A target that cannot run a moving selection unchanged is refused.
     */
    readonly switchProvider: (
      input: FactorySwitchProviderInput,
      providers: ReadonlyArray<ServerProvider>,
    ) => Effect.Effect<FactorySwitchProviderResult, FactoryLifecycleError>;
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
    /**
     * The environment's agent ceiling and what it counts now. With `set`, the owner first sets
     * it, or clears it with null, while `expectRevision` is still its revision.
     */
    readonly agentCeiling: (input: {
      readonly set?: { readonly agents: number | null; readonly expectRevision: number };
      readonly by: string;
    }) => Effect.Effect<
      { readonly applied: boolean; readonly occupancy: FactoryStore.AgentOccupancy },
      FactoryLifecycleError
    >;
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
     * Asks the factory to take one issue now: a collection of exactly that subject, so its
     * readiness, policy, claim and decision keys decide as for any tracker event, and its request
     * stays pending across a restart until a pass reads it. Returns the item's native state.
     */
    readonly enter: (
      input: FactoryEnterInput,
    ) => Effect.Effect<FactoryEnterResult, FactoryLifecycleError>;
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
     * The owner's quarantine of a held stage whose historical execution can never be proved to
     * have ended, or its end. A read without `expectDigest`; an exact digest records it. The stage
     * keeps its item, thread and claim; only its pool stops counting it. Nothing is released.
     */
    readonly quarantine: (input: {
      readonly factoryId: FactoryId;
      readonly reservationId: FactoryReservationId;
      readonly action: "enter" | "leave";
      readonly by: string;
      readonly reason: string;
      readonly expectDigest?: string | undefined;
    }) => Effect.Effect<
      {
        readonly applied: boolean;
        readonly refusals: ReadonlyArray<string>;
        readonly evidence?: string;
        readonly evidenceDigest?: string;
      },
      FactoryLifecycleError
    >;
    /**
     * The owner's proof that a full restart of this host ended a historical execution: `capture`
     * binds it and this boot to an operation, `verify` reads a later boot with it unchanged. Only
     * an exact digest records; custody then counts those attempts as ended and normal settlement
     * proceeds. It releases nothing itself.
     */
    readonly historicalTermination: (input: {
      readonly factoryId: FactoryId;
      readonly reservationId: FactoryReservationId;
      readonly action: "capture" | "verify";
      readonly operationRef: string;
      readonly by: string;
      readonly reason: string;
      readonly expectDigest?: string | undefined;
    }) => Effect.Effect<
      {
        readonly applied: boolean;
        readonly refusals: ReadonlyArray<string>;
        readonly evidence?: string;
        readonly evidenceDigest?: string;
      },
      FactoryLifecycleError
    >;
    /**
     * The owner's attestation that an admitted stage never started, for one whose custody is
     * unknown only because nothing proves its preparation history. A read without `expectDigest`;
     * an exact digest records the evidence, failure and release in one transaction.
     */
    readonly disposeNeverStarted: (input: {
      readonly factoryId: FactoryId;
      readonly reservationId: FactoryReservationId;
      readonly by: string;
      readonly reason: string;
      readonly expectDigest?: string | undefined;
    }) => Effect.Effect<
      {
        readonly disposed: boolean;
        readonly refusals: ReadonlyArray<string>;
        readonly evidence?: string;
        readonly evidenceDigest?: string;
      },
      FactoryLifecycleError
    >;
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

interface PolicyOutcomeReads {
  readonly outcomeStore: Pick<
    FactoryOutcomeStore.FactoryOutcomeStore["Service"],
    "get" | "itemEvents"
  >;
  readonly store: Pick<FactoryStore.FactoryStore["Service"], "getReservation">;
  /** With it, an integration carries the operation whose own receipt proves its landing. */
  readonly operations?: Pick<FactoryOperationStore.FactoryOperationStore["Service"], "get">;
}

/**
 * An item's verified outcomes in its native order, as policy reads them. Untraced, like the pass
 * that calls it once per item and blocker.
 */
export const policyOutcomes = Effect.fnUntraced(function* (
  reads: PolicyOutcomeReads,
  events: ReadonlyArray<FactoryOutcomeStore.StoredItemEvent>,
) {
  const outcomes: Array<FactoryPolicyOutcome> = [];
  for (const event of events) {
    if (event.type !== "outcome") continue;
    const outcome = yield* reads.outcomeStore.get(event.outcomeId);
    if (Option.isNone(outcome)) continue;
    const reservationId = outcome.value.origin.reservationId;
    const admitted =
      reservationId === undefined
        ? Option.none()
        : yield* reads.store.getReservation(reservationId);
    outcomes.push(
      Option.isSome(admitted) && admitted.value.origin === "admitted"
        ? {
            ...outcome.value,
            itemVersion: admitted.value.itemVersion,
            policyRevision: admitted.value.policyRevision,
            decisionKey: admitted.value.decisionKey,
          }
        : outcome.value,
    );
  }
  if (reads.operations === undefined) return outcomes;
  const rejected = new Set(
    events.flatMap((event) => (event.type === "rejected" ? [event.outcomeId] : [])),
  );
  const reviewed = reviewedHeadsOf(outcomes, rejected);
  const landed: Array<FactoryPolicyOutcome> = [];
  for (const outcome of outcomes) {
    const operationId = outcome.origin.type === "native" ? outcome.origin.operationId : undefined;
    const origin =
      operationId === undefined || outcome.report.outcome !== "integrated"
        ? undefined
        : landingOrigin(
            outcome,
            Option.getOrUndefined(yield* reads.operations.get(operationId)),
            reviewed,
          );
    landed.push(origin === undefined ? outcome : { ...outcome, landingOrigin: origin });
  }
  return landed;
});

/** Another item's outcomes and validity events, read once per pass through `read`. */
const policyItemFacts = Effect.fnUntraced(function* (
  reads: PolicyOutcomeReads,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  read: Map<FactoryItemKey, FactoryPolicyItemFacts>,
) {
  const known = read.get(itemKey);
  if (known !== undefined) return known;
  const itemEvents = yield* reads.outcomeStore.itemEvents({ factoryId, itemKey });
  const outcomes = yield* policyOutcomes(reads, itemEvents);
  const events: Array<NonNullable<FactoryPolicyItemFacts["events"]>[number]> = [];
  for (const event of itemEvents) {
    if (event.type === "rejected") {
      events.push({
        type: "rejected",
        outcomeId: event.outcomeId,
        failureDigest: event.failureDigest,
      });
    } else if (event.type === "reopened") {
      events.push({ type: "reopened", closureOutcomeId: event.closureOutcomeId });
    }
  }
  const facts = { itemKey, outcomes, ...(events.length === 0 ? {} : { events }) };
  read.set(itemKey, facts);
  return facts;
});

/**
 * Each closed blocker of an issue in its own repository, with this factory's outcomes for it;
 * none when it has no such blocker. `read` keeps a pass from reading one blocker twice.
 */
export const policyBlockers = Effect.fnUntraced(function* (
  reads: PolicyOutcomeReads,
  input: {
    readonly factoryId: FactoryId;
    readonly repository: string;
    readonly issue: TrackerIssue;
    readonly read: Map<FactoryItemKey, FactoryPolicyItemFacts>;
  },
) {
  const blockers: Array<FactoryPolicyItemFacts> = [];
  for (const blocker of input.issue.blockedBy ?? []) {
    if (blocker.state !== "closed" || blocker.repository !== input.repository) continue;
    const itemKey = FactoryItemKeyFor({
      repository: blocker.repository,
      issueNumber: blocker.number,
    });
    blockers.push(yield* policyItemFacts(reads, input.factoryId, itemKey, input.read));
  }
  return blockers.length === 0 ? {} : { blockers };
});

/**
 * A parent's children with this factory's outcomes for each, when `membership` is its whole
 * sub-issue list as the tracker counts it; otherwise why they are not given. A sub-issue in
 * another repository is never given: this factory holds no outcomes for it.
 */
export const policyChildren = Effect.fnUntraced(function* (
  reads: PolicyOutcomeReads,
  input: {
    readonly factoryId: FactoryId;
    readonly repository: string;
    readonly issue: TrackerIssue;
    /** The sub-issues read, or why they could not be. */
    readonly membership:
      | ReadonlyArray<{
          readonly repository: string;
          readonly number: number;
          readonly state: "open" | "closed";
          readonly body?: string;
        }>
      | { readonly unread: string };
    readonly read: Map<FactoryItemKey, FactoryPolicyItemFacts>;
  },
): Effect.fn.Return<
  Pick<FactoryPolicyItem, "children" | "childrenUnread">,
  | FactoryOutcomeStore.FactoryOutcomeStoreError
  | FactoryStore.FactoryStoreError
  | FactoryOperationStore.FactoryOperationStoreError
> {
  const { membership } = input;
  if (input.issue.subIssueCount === undefined || input.issue.subIssueCount === 0) return {};
  if ("unread" in membership) {
    return { childrenUnread: { reason: membership.unread, foreign: [] } };
  }
  const listed = membership;
  const foreign = listed
    .filter((child) => child.repository !== input.repository)
    .map((child) => FactoryItemKeyFor({ repository: child.repository, issueNumber: child.number }));
  if (listed.length !== input.issue.subIssueCount || foreign.length > 0) {
    return {
      childrenUnread: {
        reason:
          foreign.length > 0
            ? "sub-issues in another repository have no outcomes here"
            : `the tracker counts ${input.issue.subIssueCount} sub-issues but listed ${listed.length}`,
        foreign,
      },
    };
  }
  const children: Array<NonNullable<FactoryPolicyItem["children"]>[number]> = [];
  for (const child of listed) {
    const itemKey = FactoryItemKeyFor({ repository: child.repository, issueNumber: child.number });
    children.push({
      ...(yield* policyItemFacts(reads, input.factoryId, itemKey, input.read)),
      state: child.state,
      ...(child.body === undefined ? {} : { body: child.body }),
    });
  }
  return { children };
});

/**
 * Whether `candidate` lies inside `root` as the OS resolves both, through links: an absolute,
 * anchored path with no `..`, whose real location is the root or below it.
 */
export const makeInsideRoot = (fs: FileSystem.FileSystem, path: Path.Path) => {
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
  return insideArtifactRoot;
};

export const makePreparedCriteriaPublication = (deps: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly store: FactoryPreparedCriteriaStore.FactoryPreparedCriteriaStore["Service"];
}) => {
  const { fs, path, store } = deps;
  const normalized = (value: string) =>
    path.sep === "\\" ? path.normalize(value).toLowerCase() : path.normalize(value);
  const identityOf = (info: FileSystem.File.Info, type: "File" | "Directory") =>
    info.type === type && Option.isSome(info.ino) && info.ino.value > 0n
      ? { device: String(info.dev), inode: String(info.ino.value) }
      : undefined;
  const sameIdentity = (
    left: FactoryPreparedCriteriaStore.CreationIdentity | undefined,
    right: FactoryPreparedCriteriaStore.CreationIdentity,
  ) => left?.device === right.device && left.inode === right.inode;
  const rootOf = Effect.fnUntraced(function* (root: string) {
    const real = normalized(yield* fs.realPath(root));
    const identity = identityOf(yield* fs.stat(real), "Directory");
    return identity === undefined ? undefined : { root: real, identity };
  });
  const verify = Effect.fnUntraced(
    function* (
      file: string,
      identity: FactoryPreparedCriteriaStore.CreationIdentity,
      reservation: FactoryPreparedCriteriaStore.Reservation,
    ) {
      const rootIdentity = reservation.rootIdentity;
      if (rootIdentity === undefined || path.dirname(file) !== reservation.root) return false;
      return yield* Effect.scoped(
        Effect.gen(function* () {
          if (
            normalized(yield* fs.realPath(reservation.root)) !== reservation.root ||
            !sameIdentity(
              identityOf(yield* fs.stat(reservation.root), "Directory"),
              rootIdentity,
            ) ||
            normalized(yield* fs.realPath(file)) !== file
          )
            return false;
          const handle = yield* fs.open(file, { flag: "r" });
          if (!sameIdentity(identityOf(yield* handle.stat, "File"), identity)) return false;
          const hash = NodeCrypto.createHash("sha256");
          let chunk = yield* handle.readAlloc(64 * 1024);
          while (Option.isSome(chunk)) {
            hash.update(chunk.value);
            chunk = yield* handle.readAlloc(64 * 1024);
          }
          return (
            hash.digest("hex") === reservation.digest &&
            sameIdentity(identityOf(yield* handle.stat, "File"), identity) &&
            sameIdentity(identityOf(yield* fs.stat(file), "File"), identity) &&
            normalized(yield* fs.realPath(file)) === file &&
            sameIdentity(identityOf(yield* fs.stat(reservation.root), "Directory"), rootIdentity)
          );
        }),
      );
    },
    Effect.orElseSucceed(() => false),
  );

  const isKept = Effect.fn("FactoryLifecycle.isKeptPreparedCriteria")(
    function* (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly issue: number;
      readonly root: string;
      readonly target: string;
    }) {
      const root = yield* rootOf(input.root);
      const target = normalized(input.target);
      const found = yield* store.get(target);
      if (root === undefined || Option.isNone(found) || found.value.state === "reserved")
        return false;
      const { reservation, identity } = found.value;
      if (
        reservation.factoryId !== input.factoryId ||
        reservation.itemKey !== input.itemKey ||
        reservation.issue !== input.issue ||
        reservation.root !== root.root ||
        reservation.path !== target ||
        !sameIdentity(reservation.rootIdentity, root.identity)
      )
        return false;
      if (
        !(yield* verify(reservation.anchorPath, identity, reservation)) ||
        !(yield* verify(target, identity, reservation))
      )
        return false;
      return Option.isSome(yield* store.publish({ reservation, identity }));
    },
    Effect.orElseSucceed(() => false),
  );

  const keep = Effect.fn("FactoryLifecycle.keepPreparedCriteria")(function* (input: {
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryItemKey;
    readonly issue: number;
    readonly root: string;
    readonly digest: string;
    readonly bytes: string;
    readonly basis: FactoryPreparedCriteriaStore.Reservation["basis"];
  }) {
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        if (sha256(input.bytes) !== input.digest)
          return "the prepared digest does not match its bytes";
        const root = yield* rootOf(input.root);
        if (root === undefined) return "the platform cannot identify the criteria root";
        const target = path.join(root.root, `parent-${input.issue}-${input.digest}.json`);
        let found = yield* store.get(target);
        if (Option.isNone(found)) {
          if (yield* fs.exists(target)) return "an unrecognized target already exists";
          const creationId = NodeCrypto.randomUUID();
          found = yield* store.reserve({
            factoryId: input.factoryId,
            itemKey: input.itemKey,
            issue: input.issue,
            root: root.root,
            rootIdentity: root.identity,
            path: target,
            digest: input.digest,
            basis: input.basis,
            creationId,
            anchorPath: `${target}.${creationId}.anchor`,
          });
        }
        if (Option.isNone(found)) return "another creation reserved this target";
        const reservation = found.value.reservation;
        if (
          reservation.factoryId !== input.factoryId ||
          reservation.itemKey !== input.itemKey ||
          reservation.issue !== input.issue ||
          reservation.root !== root.root ||
          reservation.digest !== input.digest ||
          !sameIdentity(reservation.rootIdentity, root.identity)
        )
          return "the target belongs to another parent or criteria root";
        // The same bytes revalidated on a later basis are the same kept copy; it keeps its
        // creation's basis as provenance.
        let record = found.value;
        if (record.state === "reserved") {
          const opened = yield* fs.open(reservation.anchorPath, { flag: "wx" }).pipe(Effect.result);
          if (opened._tag === "Failure")
            return (yield* fs.exists(reservation.anchorPath))
              ? "an unidentified anchor exists; its origin cannot be recovered"
              : opened.failure.message;
          const handle = opened.success;
          yield* handle.writeAll(new TextEncoder().encode(input.bytes));
          yield* handle.sync;
          const identity = identityOf(yield* handle.stat, "File");
          if (identity === undefined) return "the platform cannot identify the created anchor";
          if (!(yield* verify(reservation.anchorPath, identity, reservation)))
            return "the created anchor could not be verified";
          const identified = yield* store.identify({ reservation, identity });
          if (Option.isNone(identified) || identified.value.state === "reserved")
            return "the anchor identity was not recorded";
          record = identified.value;
        }
        const identity = record.identity;
        if (!(yield* verify(reservation.anchorPath, identity, reservation)))
          return "the recorded anchor is missing or replaced";
        if (!(yield* fs.exists(target))) {
          const linked = yield* fs.link(reservation.anchorPath, target).pipe(Effect.result);
          if (linked._tag === "Failure" && !(yield* verify(target, identity, reservation)))
            return linked.failure.message;
        }
        if (!(yield* verify(target, identity, reservation)))
          return "the target is not the recorded anchor object";
        if (!(yield* verify(reservation.anchorPath, identity, reservation)))
          return "the recorded anchor was replaced during publication";
        return Option.isSome(yield* store.publish({ reservation, identity }))
          ? undefined
          : "publication was not recorded";
      }),
    ).pipe(Effect.result);
    return result._tag === "Success" ? result.success : result.failure.message;
  });
  return { keep, isKept };
};

export interface VerificationBindingDeps {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly insideRoot: (root: string, candidate: string) => Effect.Effect<boolean>;
  readonly reads: PolicyOutcomeReads & {
    readonly operations: NonNullable<PolicyOutcomeReads["operations"]>;
  };
}

/** What a bound verification is checked against: the item now, and what was proposed for it. */
export interface VerificationBindingInput {
  readonly configuration: FactoryStore.FactoryConfiguration;
  readonly candidate: {
    readonly itemKey: FactoryItemKey;
    readonly subject: { readonly repository: string; readonly issueNumber: number };
    readonly issue: TrackerIssue;
    readonly events: ReadonlyArray<FactoryOutcomeStore.StoredItemEvent>;
    readonly stage: Exclude<FactoryStage, { readonly type: "done" }>;
  };
  readonly pointer: PinnedFile;
  readonly execution: string | undefined;
  readonly workspace: OrchestrationV2ThreadLaunchWorkspaceStrategy | undefined;
  /** The item version the verification runs for; a unit prepared for another proves nothing. */
  readonly itemVersion: string;
  /**
   * A binding derived from a template is recorded whole for its worker to read. Admission writes
   * the record if it is absent; a first use only names it, for its caller to check after the digest.
   */
  readonly record: "write" | "name";
}

/**
 * A bound verification's binding, checked and completed from T3's own records and its Root-adopted
 * configuration, never from the policy: the stage basis and packet note to admit it with, or the
 * one wait that holds it. A template carries only stable meaning; T3 derives the failure, the
 * landing, the source and a fresh output directory. A whole binding must match all of them.
 */
export const deriveVerificationBinding = Effect.fnUntraced(function* (
  deps: VerificationBindingDeps,
  input: VerificationBindingInput,
) {
  const { fs, path, reads } = deps;
  const insideArtifactRoot = deps.insideRoot;
  const { configuration, candidate, pointer } = input;
  const decision = { execution: input.execution, workspaceStrategy: input.workspace };
  const issue = candidate.subject.issueNumber;
  const wait = (
    what: string,
    actor: string,
    action: string,
    resume: string,
    reasonClass = "needs_routing",
  ) => ({
    wait: waitText({
      issue,
      what,
      actor,
      action,
      consequence: "the bound verification does not start; earlier attempts and failures stay",
      resume,
    }),
    reasonClass,
  });
  const { stage } = candidate;
  if (stage.type !== "rework") {
    return wait(
      `a verification binding was proposed at its ${stage.type} stage`,
      "project policy",
      "propose a binding only for the rework of a failed proof",
      "a rework stage",
    );
  }
  const verification = configuration.verification;
  if (verification === undefined) {
    return wait(
      "the factory has no verification authority configured",
      "Root coordinator",
      "adopt verification {templateRoot, outputBase, consumers, identities} in the factory configuration",
      "that configuration is installed",
    );
  }
  const target = path.resolve(pointer.root, pointer.path);
  const bytes =
    (yield* insideArtifactRoot(verification.templateRoot, pointer.root)) &&
    (yield* insideArtifactRoot(pointer.root, target))
      ? yield* fs.readFile(target).pipe(Effect.option)
      : Option.none<Uint8Array>();
  if (Option.isNone(bytes) || sha256(bytes.value) !== pointer.sha256) {
    return wait(
      `binding ${pointer.path} is unreadable, outside ${verification.templateRoot} or not sha256 ${pointer.sha256}`,
      "Root coordinator",
      "install the exact adopted binding document under the template root",
      "the pinned bytes read back",
    );
  }
  const decoded = decodeVerificationDocument(new TextDecoder().decode(bytes.value));
  if (Option.isNone(decoded) || decoded.value.issue !== issue) {
    return wait(
      `binding ${pointer.path} is not a verification template or binding for #${issue}`,
      "Root coordinator",
      "adopt a factory-verification-template/1 for this issue",
      "a valid document is pinned",
    );
  }
  const doc = decoded.value;
  const outcomes = yield* policyOutcomes(reads, candidate.events);
  const failed = failureAnswered(outcomes, stage.specOutcomeId);
  if (failed === undefined) {
    return wait(
      `correction spec ${stage.specOutcomeId} answers no verified failure`,
      "T3",
      "record the failure the proof reruns for",
      "a verified failure precedes the spec",
    );
  }
  const prerequisite =
    doc.schema === "factory-verification-binding/1"
      ? Number(/#(\d+)$/.exec(doc.landed.itemKey)?.[1])
      : (doc.prerequisite ?? defectChild(candidate.itemKey, outcomes, failed));
  if (prerequisite === undefined || !Number.isSafeInteger(prerequisite)) {
    return wait(
      `no correction child T3 opened for failure ${failed.outcomeId} names its defect basis`,
      "Root coordinator",
      "name the prerequisite in the template, or let T3 open the correction",
      "the prerequisite is known",
    );
  }
  const edge = candidate.issue.blockedBy?.find(
    (blocker) =>
      blocker.number === prerequisite && blocker.repository === candidate.subject.repository,
  );
  if (edge === undefined || edge.state !== "closed") {
    return wait(
      `#${prerequisite} is ${edge === undefined ? "not a recorded blocker" : "still open"}`,
      `#${prerequisite} through T3`,
      `land and close #${prerequisite} as a blocker of #${issue}`,
      `T3 records #${prerequisite} integrated`,
      "waiting",
    );
  }
  const found = landingOf(
    yield* policyItemFacts(
      reads,
      configuration.factoryId,
      FactoryItemKeyFor({ repository: candidate.subject.repository, issueNumber: prerequisite }),
      new Map(),
    ),
  );
  if ("why" in found) {
    return wait(
      `#${prerequisite} has not landed: ${found.why}`,
      `#${prerequisite} through T3 review and integration`,
      `land #${prerequisite} at its exact reviewed head`,
      `T3 records #${prerequisite} integrated by its own operation`,
      "waiting",
    );
  }
  const landed = found.landing;
  const execution = doc.worker.execution;
  if (
    decision.execution !== execution ||
    configuration.executionChoices?.[execution] === undefined
  ) {
    return wait(
      `binding names execution ${execution}, which this decision does not run or the configuration does not hold`,
      "Root coordinator",
      `configure execution ${execution} and propose it for this verification`,
      "the execution is configured and proposed",
    );
  }
  const adopted = verification.identities[execution];
  if (adopted === undefined || adopted.identity !== doc.auth.identity) {
    return wait(
      adopted === undefined
        ? `the configuration declares no account identity for execution ${execution}`
        : `binding names identity ${doc.auth.identity}, but execution ${execution} is configured as ${adopted.identity}`,
      "Root coordinator",
      `declare the non-secret account identity execution ${execution} runs as`,
      "the identities agree",
    );
  }
  const identity = adopted.identity;
  // The issue's own bounded declaration, read as HSA and BTC read it, is the scope it owns.
  const declared = declaresOwnedFiles(candidate.issue.body, doc.ownership.owned);
  if (declared !== true) {
    return wait(
      declared === undefined
        ? `#${issue} declares no owned files in a notation T3 reads (an HSA "## Owned files" section or one BTC builder marker), or declares them ambiguously`
        : `binding owns ${doc.ownership.owned.join(", ") || "nothing"}, which is not exactly what #${issue} declares`,
      "Root coordinator",
      "make the issue declare exactly the binding's owned files, or adopt a binding for its declaration",
      "the declared and bound scopes agree",
    );
  }
  // The engine's own record of the unit's scope, where one was prepared, binds the template's.
  const proposed = outcomes.findLast(
    (outcome) =>
      outcome.state === "verified" &&
      outcome.report.outcome === "unit_proposed" &&
      outcome.report.proposal?.basis === input.itemVersion,
  )?.report.proposal?.ownedFiles;
  if (
    proposed !== undefined &&
    [...proposed].toSorted().join("\n") !== [...doc.ownership.owned].toSorted().join("\n")
  ) {
    return wait(
      `binding owns ${doc.ownership.owned.join(", ") || "nothing"}, but the prepared unit owns ${proposed.join(", ") || "nothing"}`,
      "Root coordinator",
      "adopt a template for the unit's current owned files",
      "the owned scopes agree",
    );
  }
  if (
    !verification.consumers.some(
      (consumer) =>
        consumer.contract === doc.consumer.contract && consumer.version === doc.consumer.version,
    )
  ) {
    return wait(
      `consumer ${doc.consumer.contract} ${doc.consumer.version} is not one Root declared`,
      "owner or Root coordinator",
      "declare the consumer contract in verification.consumers",
      "a supported consumer is installed",
      "held",
    );
  }
  const policyName =
    doc.schema === "factory-verification-binding/1" ? doc.policyRevision : doc.policyIdentity;
  if (!namesPolicy(policyName, configuration.policyRevision)) {
    return wait(
      `binding names policy ${policyName}, not the installed ${configuration.policyRevision}`,
      "Root coordinator",
      "adopt a binding for the installed policy",
      "the policy identities agree",
    );
  }
  for (const input of doc.inputs) {
    const file = path.resolve(pointer.root, input.path);
    const read = (yield* insideArtifactRoot(pointer.root, file))
      ? yield* fs.readFile(file).pipe(Effect.option)
      : Option.none<Uint8Array>();
    if (Option.isNone(read) || sha256(read.value) !== input.sha256.toLowerCase()) {
      return wait(
        `input ${input.path} is unreadable, outside the template root or not sha256 ${input.sha256}`,
        "Root coordinator",
        "restore the exact adopted input",
        "every input rehashes as recorded",
      );
    }
  }
  const workspace = decision.workspaceStrategy;
  if (
    workspace?.type !== "worktree" ||
    workspace.baseRef !== landed.commit ||
    workspace.startFromOrigin === true
  ) {
    return wait(
      `the verification would not start at landed commit ${landed.commit}`,
      "project policy",
      `start the worktree exactly at ${landed.commit}`,
      "the proposal starts there",
    );
  }
  if (doc.schema === "factory-verification-binding/1") {
    const claimed = doc.landed;
    const same =
      doc.failedOutcomeId === failed.outcomeId &&
      doc.source.repository === candidate.subject.repository &&
      doc.source.commit === landed.commit &&
      claimed.itemKey === landed.itemKey &&
      claimed.operationId === landed.operationId &&
      claimed.commit === landed.commit &&
      claimed.tree === landed.tree &&
      claimed.parents.join() === landed.parents.join() &&
      claimed.branch === landed.branch &&
      claimed.reviewedHead === landed.reviewedHead &&
      claimed.reviewOutcomeId === landed.reviewOutcomeId &&
      claimed.integratedOutcomeId === landed.integratedOutcomeId;
    if (!same) {
      return wait(
        `binding ${pointer.path} does not name failure ${failed.outcomeId} and the landing T3 recorded`,
        "Root coordinator",
        "adopt a template so T3 derives the landing, or a binding that matches it",
        "a matching document is pinned",
      );
    }
  }
  const outputRoot =
    doc.schema === "factory-verification-binding/1"
      ? path.resolve(doc.outputRoot)
      : path.join(
          path.resolve(verification.outputBase),
          outputRootName({
            issue,
            itemKey: candidate.itemKey,
            failedOutcomeId: failed.outcomeId,
            commit: landed.commit,
            templateSha256: pointer.sha256,
          }),
        );
  const named = path.relative(path.resolve(verification.outputBase), outputRoot);
  const existing = yield* fs.readDirectory(outputRoot).pipe(Effect.option);
  if (
    named === "" ||
    named.startsWith("..") ||
    path.isAbsolute(named) ||
    named.includes(path.sep) ||
    (Option.isSome(existing) && existing.value.length > 0)
  ) {
    return wait(
      `output root ${outputRoot} is not a new empty directory directly under ${verification.outputBase}`,
      "Root coordinator",
      "leave earlier output in place and bind a fresh output root",
      "a fresh output root is bound",
    );
  }
  const bindingDigest = sha256(
    canonical({
      binding: pointer,
      failedOutcomeId: failed.outcomeId,
      landed,
      outputRoot,
      execution,
      identity,
      inputs: doc.inputs,
      consumer: doc.consumer,
      policyRevision: configuration.policyRevision,
    }),
  );
  // A pinned binding is already a file its worker reads; one derived from a template is written
  // beside its output root, named by its digest so no other binding ever overwrites it.
  let recorded: { readonly path: string; readonly sha256: string } | undefined;
  if (doc.schema === "factory-verification-template/1") {
    const text = canonical({
      schema: "factory-verification-binding/1",
      issue,
      failedOutcomeId: failed.outcomeId,
      prerequisite,
      landed,
      source: { repository: candidate.subject.repository, commit: landed.commit },
      worker: { execution },
      auth: { identity },
      inputs: doc.inputs,
      consumer: doc.consumer,
      policyRevision: configuration.policyRevision,
      ownership: doc.ownership,
      outputRoot,
    });
    const file = path.join(
      path.resolve(verification.outputBase),
      `${path.basename(outputRoot)}.binding-${bindingDigest.slice(0, 16)}.json`,
    );
    const digest = sha256(text);
    const unrecorded = (what: string) =>
      wait(
        `the binding T3 recorded at ${file} ${what}`,
        "Root coordinator",
        "restore the recorded binding exactly as T3 wrote it, or remove it before the next admission",
        "the recorded bytes read back",
      );
    if (input.record === "write") {
      const existing = yield* fs.readFile(file).pipe(Effect.option);
      if (Option.isSome(existing)) {
        if (sha256(existing.value) !== digest) return unrecorded(`is not sha256 ${digest}`);
      } else if (Option.isNone(yield* fs.writeFileString(file, text).pipe(Effect.option))) {
        return unrecorded("could not be written");
      }
    }
    recorded = { path: file, sha256: digest };
  }
  return {
    digest: bindingDigest,
    landed,
    ...(recorded === undefined ? {} : { recorded }),
    basis: bindingBasis(bindingDigest, outputRoot),
    note: [
      `T3 bound this verification (binding ${bindingDigest.slice(0, 16)}): it reruns failure ${failed.outcomeId} on ${landed.commit} (tree ${landed.tree}), the landing of ${landed.itemKey} by operation ${landed.operationId}.`,
      ...(recorded === undefined
        ? []
        : [
            `The recorded factory-verification-binding/1 is ${recorded.path} (sha256 ${recorded.sha256}); read it and check it before acting.`,
          ]),
      `Write only under ${outputRoot}; T3 reserved it for this attempt alone. Change no product file.`,
      bindingMarker({ binding: pointer, execution, baseRef: landed.commit }),
    ].join("\n"),
  };
});

const MARKER = /^<!-- t3-verification-binding (\{.*\}) -->$/m;
const BindingMarker = Schema.Struct({
  binding: Schema.Struct({ root: Schema.String, path: Schema.String, sha256: Schema.String }),
  execution: Schema.String,
  baseRef: Schema.String,
});
const decodeBindingMarker = Schema.decodeUnknownOption(Schema.fromJsonString(BindingMarker));

/** What a bound packet records of its proposal, so its first use can derive the binding again. */
const bindingMarker = (marker: typeof BindingMarker.Type) =>
  `<!-- t3-verification-binding ${JSON.stringify(marker)} -->`;

/**
 * The proposal a bound verification was admitted on, read from its own packet: the packet is the
 * text its reservation's digest names, so a changed one proves nothing and reads as none.
 */
export const admittedBinding = (packetText: string, packetDigest: string) => {
  if (sha256(packetText) !== packetDigest) return Option.none();
  const found = MARKER.exec(packetText)?.[1];
  return found === undefined ? Option.none() : decodeBindingMarker(found);
};

/** The line T3 integrates onto, as preparation reads candidate bases against it. */
const integrationLineOf = (configuration: FactoryStore.FactoryConfiguration) => {
  const integration = configuration.integration;
  if (integration === undefined) return "no configured integration line";
  return integration.remote === null
    ? `refs/heads/${integration.branch}`
    : `refs/remotes/${integration.remote}/${integration.branch}`;
};

/** The item's own content and evidence, without the claims on it. */
const substantiveDigest = (
  observation: Pick<FactoryStore.ItemObservation, "itemVersion" | "evidence">,
) =>
  sha256(
    JSON.stringify([observation.itemVersion, FactoryStore.canonicalEvidence(observation.evidence)]),
  );

/** The counts a pass leaves behind: its dispositions and the policy's reasons for starting nothing. */
const passMetrics = (
  at: string,
  records: ReadonlyArray<FactoryItemDispositionRecord>,
): FactoryPassMetrics => {
  const byDisposition: Record<string, number> = {};
  const byReasonClass: Record<string, number> = {};
  for (const record of records) {
    byDisposition[record.disposition] = (byDisposition[record.disposition] ?? 0) + 1;
    if (record.reasonClass !== undefined) {
      byReasonClass[record.reasonClass] = (byReasonClass[record.reasonClass] ?? 0) + 1;
    }
  }
  return {
    at,
    read: records.length,
    admitted: byDisposition["admitted"] ?? 0,
    byDisposition,
    byReasonClass,
  };
};

/**
 * The owner's answers that grant a request: the card and Settings send `grant`. Earlier builds
 * issued a grant with any answer sent with units, so only these authorize one it issued.
 */
const isGrantAnswer = (answer: string) =>
  ["grant", "approve"].includes(answer.trim().toLowerCase());

/** Same item, task kind, policy and evidence is the same decision, whoever triggers it. */
/**
 * The policy a preparation is decided under: its revision without a trailing configuration pin,
 * so a configuration change alone never makes the same item's preparation another decision.
 */
export const policyIdentityOf = (policyRevision: string) =>
  /^(.+:[0-9a-f]{16}):[0-9a-f]{16}$/.exec(policyRevision)?.[1] ?? policyRevision;

export const decisionKeyOf = (
  input: Pick<
    FactoryAdmissionRequest,
    "factoryId" | "itemKey" | "taskKind" | "policyRevision" | "stage"
  >,
  observation: FactoryStore.ItemObservation,
  options: { readonly exactPolicy?: boolean } = {},
) =>
  makeDecisionKey(
    sha256(
      JSON.stringify([
        input.factoryId,
        input.itemKey,
        input.taskKind,
        input.taskKind === "triage" && options.exactPolicy !== true
          ? policyIdentityOf(input.policyRevision)
          : input.policyRevision,
        FactoryStore.canonicalEvidence(observation.evidence),
        // A stage decision is also its exact basis: the same review of another head differs.
        ...(input.stage === undefined ? [] : [input.stage.basis]),
      ]),
    ),
  );

/**
 * An item's triage decision: its exact text, evidence and policy. After a preparation on those
 * inputs ended without a result (a rejected report, say), it is also what T3 reads back for that
 * failure now (`readback`: its candidate base and the item's blockers). The retry runs once on that
 * readback; a failed retry is decided again only when the readback changes or new inputs arrive.
 */
/**
 * A preparation gap that is routine coordination, the factory's own to settle by preparing again:
 * a request for an outside coordinator. A person's decision, permission, private data, ownership
 * another writer or person holds, or hold is never routine: project policies name those held.
 */
export const isRoutineGap = (failure: string | undefined) =>
  failure !== undefined && /^\s*(?:main|needs-main)\s*:/i.test(failure);

/**
 * A preparation result that stands until its inputs change: a usable unit, or a hold the policy
 * names held. A decision is answered by a comment, and a failure may be settled by one, so neither
 * stands against comments added later.
 */
const standsAgainstComments = (report: FactoryOutcomeStore.FactoryOutcome["report"]) =>
  report.outcome === "unit_proposed" ||
  (report.outcome === "not_actionable" &&
    /^\s*(?:hold|permission|private_data|ownership)\s*:/i.test(report.failure ?? ""));

const COMMENT_CARRIER = /:comment:\d+$/;

/**
 * Whether evidence read now is what an earlier decision read with only comments added since:
 * every carrier it read still reads the same and nothing else is new. A comment it read that was
 * edited or deleted is a change; a later note beside it is not.
 */
export const onlyCommentsAdded = (
  read: FactoryStore.ItemObservation["evidence"],
  now: FactoryStore.ItemObservation["evidence"],
) => {
  const current = new Map(now.map((entry) => [entry.carrierId, entry]));
  const earlier = new Set(read.map((entry) => entry.carrierId));
  return (
    read.every((entry) => {
      const same = current.get(entry.carrierId);
      return same?.bodyDigest === entry.bodyDigest && same.version === entry.version;
    }) &&
    now.every((entry) => earlier.has(entry.carrierId) || COMMENT_CARRIER.test(entry.carrierId))
  );
};

/** An earlier preparation of the item whose inputs differ from now only by added comments. */
interface ReusedPreparation {
  readonly basis: string;
  readonly decisionKey: FactoryDecisionKey;
}

/** The legacy tracker label that parked an item for an external coordinator. */
export const LEGACY_NEEDS_MAIN_LABEL = "needs-main";

/**
 * Whether the factory owes the item a preparation now, from its own records: its last preparation
 * on this text stopped on routine coordination and the retry it opens has not run, or it still
 * carries the legacy needs-main label with no preparation on this text. Never for a person's hold.
 */
export const preparationDueOf = (input: {
  readonly labels: ReadonlyArray<string>;
  readonly itemVersion: string;
  readonly outcomes: ReadonlyArray<FactoryPolicyOutcome>;
  readonly triage: {
    readonly keys: ReadonlySet<FactoryDecisionKey>;
    readonly failed?: FactoryPolicyOutcome;
  };
}): FactoryPolicyItem["preparation"] => {
  const tried = input.outcomes.some(
    (outcome) =>
      outcome.stage === "triage" &&
      outcome.decisionKey !== undefined &&
      input.triage.keys.has(outcome.decisionKey),
  );
  if (tried) return undefined;
  const failed = input.triage.failed;
  if (failed?.report.outcome === "not_actionable") {
    return { due: true, reason: "routine_gap", gap: (failed.report.failure ?? "").slice(0, 2_000) };
  }
  const prepared = input.outcomes.some(
    (outcome) =>
      outcome.stage === "triage" &&
      outcome.itemVersion === input.itemVersion &&
      outcome.state === "verified",
  );
  return input.labels.includes(LEGACY_NEEDS_MAIN_LABEL) && !prepared && failed === undefined
    ? { due: true, reason: "legacy_needs_main" }
    : undefined;
};

const triageDecisionOf = (
  input: Pick<FactoryAdmissionRequest, "factoryId" | "itemKey" | "policyRevision">,
  observation: FactoryStore.ItemObservation,
  outcomes: ReadonlyArray<FactoryPolicyOutcome>,
  readback?: string,
  reused: ReadonlyArray<ReusedPreparation> = [],
) => {
  const keyOf = (basis: string) =>
    decisionKeyOf({ ...input, taskKind: "triage", stage: { type: "triage", basis } }, observation);
  // Earlier builds keyed a preparation by its exact revision, configuration pin included. Each
  // revision recorded on this item under the same policy identity names the same decision.
  const identity = policyIdentityOf(input.policyRevision);
  const revisions = new Set([
    input.policyRevision,
    ...outcomes.flatMap((outcome) =>
      outcome.stage === "triage" &&
      outcome.policyRevision !== undefined &&
      policyIdentityOf(outcome.policyRevision) === identity
        ? [outcome.policyRevision]
        : [],
    ),
  ]);
  const keysOf = (basis: string): ReadonlySet<FactoryDecisionKey> =>
    new Set([
      keyOf(basis),
      ...[...revisions].map((policyRevision) =>
        decisionKeyOf(
          { ...input, policyRevision, taskKind: "triage", stage: { type: "triage", basis } },
          observation,
          { exactPolicy: true },
        ),
      ),
      ...reused.flatMap((earlier) => (earlier.basis === basis ? [earlier.decisionKey] : [])),
    ]);
  // What the item's preparation stands on: the latest earlier one of this basis it reuses.
  const decisionOf = (basis: string) =>
    reused.findLast((earlier) => earlier.basis === basis)?.decisionKey ?? keyOf(basis);
  const first = triageBasis(observation.itemVersion);
  const firstKey = keyOf(first);
  const firstKeys = keysOf(first);
  // A preparation that stopped on routine coordination ended without a usable result too: the
  // factory prepares it again, once per gap and readback, instead of parking it for a person.
  const failed = outcomes.findLast(
    (outcome) =>
      outcome.stage === "triage" &&
      outcome.decisionKey !== undefined &&
      firstKeys.has(outcome.decisionKey) &&
      outcome.state === "verified" &&
      (outcome.report.outcome === "failed" ||
        (outcome.report.outcome === "not_actionable" && isRoutineGap(outcome.report.failure))) &&
      outcome.failureDigest !== undefined,
  );
  if (failed?.failureDigest === undefined) {
    return {
      basis: first,
      key: firstKey,
      decision: decisionOf(first),
      keys: firstKeys,
      keysFor: keysOf,
    };
  }
  const basis = triageBasis(observation.itemVersion, failed.failureDigest, readback);
  return {
    basis,
    key: keyOf(basis),
    decision: decisionOf(basis),
    keys: keysOf(basis),
    keysFor: keysOf,
    failed,
  };
};

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
  const preparedCriteriaStore = yield* FactoryPreparedCriteriaStore.FactoryPreparedCriteriaStore;
  const preparedPublication = makePreparedCriteriaPublication({
    fs,
    path,
    store: preparedCriteriaStore,
  });
  const integrator = yield* FactoryIntegrator.FactoryIntegrator;
  const projectService = yield* ProjectService.ProjectService;
  const transfers = yield* FactoryTransferStore.FactoryTransferStore;
  const fence = yield* CommandJobFence.CommandJobFence;
  const platform = yield* HostProcess.Platform;
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
  const lastMetrics = yield* Ref.make<ReadonlyMap<FactoryId, FactoryPassMetrics>>(new Map());
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const custodyContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof readExecutionCustody>>>();

  const insideArtifactRoot = makeInsideRoot(fs, path);

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
    // A worktree is always made on a new branch, so a name the repository already has (a
    // reopened item's earlier unit, say) would fail preparation only after capacity was taken.
    if (strategy?.type === "worktree" && strategy.branch !== undefined) {
      const exists = yield* gitReadback
        .branchExists({ projectId: config.projectId, branch: strategy.branch })
        .pipe(Effect.option);
      if (Option.isNone(exists)) return "workspace_branch_unreadable" as const;
      if (exists.value) return "workspace_branch_exists" as const;
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

  /**
   * Custody that rests on an owner's residual decision holds only while the decision's exact scope
   * does: any descendant, launch or binding since, or one that cannot be read, is a writer the
   * owner never weighed, so custody is unknown again. Every other custody is as read.
   */
  const residualStillScoped = Effect.fnUntraced(function* (
    reservation: FactoryStore.FactoryReservation,
    custody: FactoryCustody,
  ) {
    const capture =
      reservation.origin === "admitted" ? reservation.historicalTermination?.capture : undefined;
    if (
      reservation.origin !== "admitted" ||
      capture?.residual === undefined ||
      custody.state !== "quiescent" ||
      !custody.reasons.includes("owner_accepted_residual_after_restart")
    ) {
      return custody;
    }
    const scoped = residualScopeOf(yield* readResidualFacts(reservation), {
      reservationId: reservation.reservationId,
      admittedIn: reservation.admittedIn ?? null,
      operationRef: capture.operationRef,
      host: capture.host,
    });
    return scoped.scope !== null && sha256(canonical(scoped.scope)) === capture.residual.scopeDigest
      ? custody
      : ({ state: "unknown", reasons: ["residual_scope_changed"] } satisfies FactoryCustody);
  });

  const custodyOf = (
    reservation: FactoryStore.FactoryReservation,
    options?: { readonly judgeDeleted?: boolean },
  ) =>
    readExecutionCustody(reservation, options).pipe(
      Effect.flatMap((custody) => residualStillScoped(reservation, custody)),
      Effect.provide(custodyContext),
    );

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

  /** A new operation a pass decided on is recorded only beside the custody that pass weighed. */
  const ensureFencedOperation = Effect.fnUntraced(function* (
    input: {
      readonly operationId: string;
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly intent: FactoryOperationStore.FactoryOperationIntent;
    },
    fence: FactoryStore.CustodyFence,
  ) {
    const intended = yield* operationStore.intendBeside(input, fence);
    return Option.isNone(intended) ? intended : Option.some(yield* ensureOperation(input));
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
    ensureFencedOperation,
  });

  const outcomeOps = makeFactoryOutcomes({
    // A stage held on an owner's residual decision is released only in a transaction that reads
    // its custody, scope included, again: nothing committed after that read can be inherited.
    store: {
      ...store,
      releaseReservation: (reservationId, reason) =>
        reason !== "outcome_verified"
          ? store.releaseReservation(reservationId, reason)
          : sql
              .withTransaction(
                Effect.gen(function* () {
                  const found = yield* store.getReservation(reservationId);
                  if (
                    Option.isSome(found) &&
                    found.value.origin === "admitted" &&
                    found.value.historicalTermination?.capture.residual !== undefined &&
                    (yield* custodyOf(found.value).pipe(
                      Effect.map((custody) => custody.state !== "quiescent"),
                      Effect.orElseSucceed(() => true),
                    ))
                  ) {
                    return false;
                  }
                  return yield* store.releaseReservation(reservationId, reason);
                }),
              )
              .pipe(
                Effect.catchTags({
                  SqlError: (cause) =>
                    Effect.fail(
                      new FactoryStore.FactoryStoreError({
                        operation: "release-reservation",
                        cause,
                      }),
                    ),
                }),
              ),
    },
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
    readArtifact: Effect.fnUntraced(function* (artifactRoot, artifactPath) {
      if (!(yield* insideArtifactRoot(artifactRoot, artifactPath))) return undefined;
      const bytes = yield* fs.readFile(artifactPath).pipe(Effect.option);
      return Option.isNone(bytes)
        ? undefined
        : { text: new TextDecoder().decode(bytes.value), sha256: sha256(bytes.value) };
    }),
    adoptedCriteria: Effect.fnUntraced(function* ({ configuration, itemKey, issue }) {
      const root = configuration.parents?.criteriaRoot;
      if (root === undefined) return undefined;
      const adoptions = yield* adoptionsIn(yield* listCriteria(root), {
        root,
        issue,
        factoryId: configuration.factoryId,
        itemKey,
      });
      if ("unread" in adoptions) return { unread: adoptions.unread };
      return adoptions.found.length === 1 ? { document: adoptions.found[0]!.document } : undefined;
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
    expectRevision: number,
  ) {
    const input = yield* decodeConfigurationDocument(document).pipe(
      Effect.mapError((cause) => new FactoryConfigurationInvalid({ reason: cause.message })),
    );
    const written = yield* store.configureAtRevision(input, expectRevision).pipe(
      Effect.mapError(
        (cause) =>
          new FactoryLifecycleError({
            operation: "configure",
            factoryId: input.factoryId,
            cause,
          }),
      ),
    );
    if (written.type === "conflict") {
      return yield* new FactoryConfigurationStale({
        factoryId: input.factoryId,
        revision: written.revision,
        expectRevision,
      });
    }
    return written.configuration;
  });

  const switchProvider = makeSwitchProvider(store);

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
    function* (input: FactoryAdmissionRequest, collected?: CollectedBasis) {
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
            ...(collected === undefined
              ? {}
              : {
                  custodyRead: [...collected.custodyRead],
                  transfersRead: [...collected.transfersRead],
                  issueText: collected.issueText,
                }),
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
    (effect, input, _collected?: CollectedBasis) =>
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

  const agentCeiling = Effect.fn("FactoryLifecycle.agentCeiling")(
    function* (input: {
      readonly set?: { readonly agents: number | null; readonly expectRevision: number };
      readonly by: string;
    }) {
      if (input.set === undefined) {
        return { applied: false, occupancy: yield* store.agentOccupancy() };
      }
      const result = yield* store.setAgentCeiling({ ...input.set, by: input.by });
      if (result.applied) {
        // Every factory waits on the one ceiling, so each reads it again now.
        for (const configuration of yield* store.listConfigurations()) {
          yield* Queue.offer(wakes, {
            factoryId: configuration.factoryId,
            trigger: "owner_decision",
          });
        }
      }
      return result;
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({ operation: "agent-ceiling", factoryId: "", cause }),
        ),
      ),
  );

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
        agents: yield* store.agentOccupancy(),
        reservedDecisions: yield* outcomeStore.reservedDecisions(input.factoryId),
        lastCollection,
        lastPassMetrics: (yield* Ref.get(lastMetrics)).get(input.factoryId) ?? null,
        waits: yield* outcomeStore.currentWaits(input.factoryId),
        results,
        issues: (yield* Ref.get(factoryIssues)).get(input.factoryId) ?? [],
        grants: yield* store.listGrants(input.factoryId),
        transfers: yield* transfers.list(input.factoryId),
        pools: (configuration?.pools ?? []).map((pool) => ({
          poolId: pool.poolId,
          capacityUnits: pool.capacityUnits,
          // A released reservation stays as history and holds nothing; a quarantined one still
          // owns its item but is not charged.
          occupiedUnits: reservations
            .filter(
              (reservation) =>
                reservation.poolId === pool.poolId &&
                reservation.state === "held" &&
                (reservation.origin !== "admitted" || reservation.quarantine === undefined),
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
          decisionGuidance(decision, configuration, platform),
        ].join("\n\n"),
      },
    });
  };

  /** What a collection pass decided beside: the custody it weighed and the issue text it read. */
  interface CollectedBasis {
    readonly custodyRead: ReadonlyArray<FactoryReservationId>;
    readonly transfersRead: ReadonlyArray<{ readonly transferId: string; readonly state: string }>;
    readonly issueText: { readonly title: string; readonly body: string };
  }

  interface Candidate {
    readonly itemKey: FactoryItemKey;
    readonly subject: { readonly repository: string; readonly issueNumber: number };
    readonly issue: TrackerIssue;
    readonly observation: FactoryStore.ItemObservation;
    readonly stage: Exclude<FactoryStage, { readonly type: "done" }>;
    readonly owner: { readonly reservationId: FactoryReservationId } | undefined;
    readonly events: ReadonlyArray<FactoryOutcomeStore.StoredItemEvent>;
  }

  /**
   * Supersedes the one gate a policy's explicit withdrawal names, only while everything it was
   * decided on still stands. One write transaction rereads the configuration, the item's later
   * reads, its lifecycle and the gate; the pass's own snapshot of them is never enough.
   */
  const withdrawGate = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    candidate: Candidate,
    withdrawal: FactoryGateWithdrawal,
  ) {
    const { factoryId } = configuration;
    const stale = (why: string) => ({
      refused: `the withdrawal of decision ${withdrawal.decisionId} ${why}`,
    });
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* store.getConfiguration(factoryId);
          if (
            Option.isNone(current) ||
            current.value.revision !== configuration.revision ||
            current.value.policyRevision !== configuration.policyRevision
          ) {
            return stale("was decided on a factory configuration since replaced");
          }
          const later = yield* store.observationsAfter({
            factoryId,
            observationId: candidate.observation.observationId,
          });
          if (later.some((read) => !read.complete || read.itemVersion !== withdrawal.itemVersion)) {
            return stale("was decided on an item read over since");
          }
          const events = yield* outcomeStore.itemEvents({ factoryId, itemKey: candidate.itemKey });
          if (
            events.map((event) => event.seq).join() !==
            candidate.events.map((event) => event.seq).join()
          ) {
            return stale("was decided before the item's lifecycle moved");
          }
          const checked = withdrawalOf(
            yield* outcomeStore.reservedDecisions(factoryId),
            {
              itemKey: candidate.itemKey,
              stage: nextStage(events),
              observation: candidate.observation,
            },
            withdrawal,
            current.value.policyRevision,
          );
          if ("refused" in checked) return checked;
          // Pending only: an answer or supersession that committed first stands.
          return (yield* outcomeStore.supersedeDecision(checked))
            ? { withdrew: checked.decisionId }
            : stale("lost to an answer or supersession committed first");
        }),
      )
      .pipe(
        Effect.catchTags({
          SqlError: (cause) =>
            Effect.fail(
              new FactoryOutcomeStore.FactoryOutcomeStoreError({
                operation: "withdraw-gate",
                cause,
              }),
            ),
        }),
      );
  });

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
    yield* nativeStages.settleTicketCreates(factoryId);
    yield* outcomeOps.reconcile(factoryId);
    for (const operation of yield* operationStore.listIntended(factoryId)) {
      // A ticket create already sent once moves only when its ticket is asked for again.
      if (operation.createPending !== undefined && operation.createdIssue === undefined) continue;
      yield* ensureOperation(operation);
    }
    const generation = yield* store.beginCollection(factoryId);
    // Every item work is under way on is read too, whatever changed: the policy can keep new work
    // clear of work under way only by the items that work is on. That is every item custody
    // holds, and every item a legacy job may still write while its transfer drains.
    const toRead = new Map(subjects.map((subject) => [FactoryItemKeyFor(subject), subject]));
    const readAlso = (itemKey: FactoryItemKey) => {
      const subject = subjectOf(itemKey);
      if (subject !== undefined) toRead.set(FactoryItemKeyFor(subject), subject);
    };
    const heldBeforeReads = new Set<FactoryReservationId>();
    const listedBeforeReads = yield* store.listReservations(factoryId);
    for (const reservation of listedBeforeReads) {
      if (reservation.state !== "held") continue;
      heldBeforeReads.add(reservation.reservationId);
      readAlso(reservation.itemKey);
    }
    // So is every started lineage: its history may still claim files new work must keep clear of,
    // and a policy weighs that history only on an item it is given.
    const openLineages = (yield* outcomeStore.openItems(factoryId)).filter(
      (itemKey) => subjectOf(itemKey) !== undefined,
    );
    for (const itemKey of openLineages) readAlso(itemKey);
    // A legacy job's workers by work id and whether each finished; none while a pass of the job
    // runs or it cannot be described, since any of its workers may then still write.
    const jobWorkers = new Map<string, ReadonlyMap<string, boolean | null> | null>();
    const workersOf = Effect.fnUntraced(function* (job: string) {
      const known = jobWorkers.get(job);
      if (known !== undefined) return known;
      let workers: ReadonlyMap<string, boolean | null> | null = null;
      if (Option.isSome(commandJobs) && !(yield* commandJobs.value.running(job))) {
        const described = yield* Effect.result(commandJobs.value.describe(job));
        if (Result.isSuccess(described)) {
          workers = new Map(
            described.success.workers.map((worker) => [worker.workId, worker.terminal]),
          );
        }
      }
      jobWorkers.set(job, workers);
      return workers;
    });
    // Every worker any transfer named writes its item until it finished or the owner accounted
    // for it (named it historical, or disposed of its custody), whatever later transfers name: a
    // rolled-back transfer hands its workers back to the job, still writing.
    const handedBackWriting = Effect.fnUntraced(function* (
      rows: ReadonlyArray<FactoryTransferStore.FactoryTransfer>,
      held: ReadonlyArray<FactoryStore.FactoryReservation>,
    ) {
      const accounted = new Set<string>();
      for (const row of rows) {
        for (const item of row.items) {
          for (const { workId } of item.historical ?? []) accounted.add(`${row.job}\n${workId}`);
        }
      }
      for (const reservation of held) {
        if (
          reservation.origin === "transferred" &&
          reservation.releasedReason === "owner_disposition" &&
          reservation.workId !== undefined
        ) {
          accounted.add(`${reservation.job}\n${reservation.workId}`);
        }
      }
      const writing: Array<readonly [FactoryItemKey, string]> = [];
      for (const row of rows) {
        if (row.state !== "rolled_back") continue;
        for (const item of row.items) {
          const open = item.workIds.filter((workId) => !accounted.has(`${row.job}\n${workId}`));
          if (open.length === 0) continue;
          const workers = yield* workersOf(row.job);
          if (workers === null || open.some((workId) => workers.get(workId) !== true)) {
            writing.push([item.itemKey, row.transferId]);
          }
        }
      }
      return writing;
    });
    // A legacy writer started on text T3 never saw, so no read shows the policy what it writes:
    // while one may still write (custody held, a transfer draining, or a worker a rollback named
    // unfinished), nothing new starts, unless every transfer it may still write under carries
    // the same scope the owner attested.
    const legacyScopes = Effect.fnUntraced(function* (
      rows: ReadonlyArray<FactoryTransferStore.FactoryTransfer>,
      listed: ReadonlyArray<FactoryStore.FactoryReservation>,
    ) {
      const latest = latestTransfers(rows);
      const writersOf = new Map<FactoryItemKey, Set<string>>();
      const writer = (itemKey: FactoryItemKey, transferId: string) =>
        writersOf.set(itemKey, (writersOf.get(itemKey) ?? new Set()).add(transferId));
      for (const reservation of listed) {
        if (reservation.origin === "transferred" && reservation.state === "held") {
          writer(reservation.itemKey, reservation.transferId);
        }
      }
      for (const [itemKey, transfer] of latest) {
        if (transfer.state === "draining") writer(itemKey, transfer.transferId);
      }
      for (const [itemKey, transferId] of yield* handedBackWriting(rows, listed)) {
        writer(itemKey, transferId);
      }
      const legacyWriting = new Set(writersOf.keys());
      const scopeOf = (itemKey: FactoryItemKey) => {
        const bodies = new Set<string | undefined>();
        for (const transferId of writersOf.get(itemKey) ?? []) {
          const row = rows.find((transfer) => transfer.transferId === transferId);
          const body = row?.scopes?.find((scope) => scope.itemKey === itemKey)?.body;
          bodies.add(body !== undefined && namesOwnedFiles(body) ? body : undefined);
        }
        const [body] = bodies;
        return bodies.size === 1 ? body : undefined;
      };
      const legacyScoped = new Map(
        [...legacyWriting].flatMap((itemKey) => {
          const body = scopeOf(itemKey);
          return body === undefined ? [] : [[itemKey, body] as const];
        }),
      );
      return { legacyWriting, legacyScoped };
    });
    // Scoped legacy work that may still write is weighed on its item's read, whoever holds it.
    for (const itemKey of (yield* legacyScopes(
      yield* transfers.list(factoryId),
      listedBeforeReads,
    )).legacyScoped.keys()) {
      readAlso(itemKey);
    }
    // Decided on what the job reports after the reads, not before.
    jobWorkers.clear();
    const deadline = Duration.seconds(configuration.readDeadlineSeconds ?? 120);
    // Bounded parallel reads; an item that cannot be read in time is recorded unread and read
    // again shortly, and nothing is decided or spent for it meanwhile.
    const reads = yield* tracker.withSession(
      { host: claim.host, cwd: configuration.artifactRoot },
      (session) =>
        Effect.forEach(
          [...toRead.values()],
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
      reasonClass?: string,
    ) =>
      dispositions.set(itemKey, {
        itemKey,
        stage,
        disposition,
        ...(detail === undefined ? {} : { detail }),
        ...(reasonClass === undefined ? {} : { reasonClass }),
        at,
      });
    // A carrier the owner disposed of is no one's claim any more: not charged, not blocking.
    const disposed = yield* store.disposedCarriers(factoryId);
    let retry = false;
    // Every read is recorded before anything is decided, so the custody listed next includes the
    // claims these reads charged.
    const recordedReads = [];
    // Subjects a later pass must still read: their request stays pending until one does.
    const unreadSubjects = new Set<FactoryItemKey>();
    for (const { subject, read } of reads) {
      const itemKey = FactoryItemKeyFor(subject);
      if (Result.isFailure(read)) {
        const unavailable = FactoryTracker.unavailableIssue(read.failure);
        if (unavailable === undefined) {
          note(itemKey, null, "read_failed", String(read.failure).slice(0, 500));
          unreadSubjects.add(itemKey);
        } else {
          note(
            itemKey,
            null,
            "unavailable",
            {
              not_an_issue: `${subject.repository}#${subject.issueNumber} is a pull request, not an issue.`,
              unreadable: `GitHub answers that ${subject.repository}#${subject.issueNumber} does not exist, or the factory's tracker account cannot read it.`,
              forbidden: `GitHub refuses the factory's tracker account access to ${subject.repository}#${subject.issueNumber}.`,
              gone: `GitHub answers that ${subject.repository}#${subject.issueNumber} is gone: deleted, or issues are turned off for the repository.`,
            }[unavailable],
            unavailable,
          );
        }
        retry = true;
        continue;
      }
      if (Option.isNone(read.success)) {
        note(itemKey, null, "read_deadline");
        unreadSubjects.add(itemKey);
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
      recordedReads.push({ itemKey, subject, issue, observed, recorded });
    }
    const reservations = yield* store.listReservations(factoryId);
    const held = new Map(
      reservations.flatMap((reservation) =>
        reservation.origin === "admitted" && reservation.state === "held"
          ? [[reservation.itemKey, reservation] as const]
          : [],
      ),
    );
    const transferRows = yield* transfers.list(factoryId);
    const transferOf = latestTransfers(transferRows);
    // A running stage does the work of the text it was admitted on, whatever the issue says now.
    // One admitted before T3 kept that text is known only while the issue's text is unchanged.
    const textUnknown: Array<FactoryItemKey> = [];
    const asAdmitted = Effect.fnUntraced(function* (
      running: FactoryStore.FactoryReservation,
      admittedOn: Option.Option<FactoryStore.ItemObservation>,
      issue: TrackerIssue,
    ) {
      const text = issueTextDigest(issue);
      if (
        Option.isSome(admittedOn) &&
        admittedOn.value.evidence.some((e) => e.bodyDigest === text)
      ) {
        return issue;
      }
      for (const { record } of yield* outcomeStore.itemRecords({
        factoryId,
        itemKey: running.itemKey,
      })) {
        if (
          record.type === "admitted" &&
          record.reservationId === running.reservationId &&
          record.issueText !== undefined
        ) {
          return { ...issue, ...record.issueText };
        }
      }
      textUnknown.push(running.itemKey);
      return issue;
    });
    const legacyCustody = new Map(
      reservations.flatMap((reservation) =>
        reservation.origin === "transferred" && reservation.state === "held"
          ? [[reservation.itemKey, reservation] as const]
          : [],
      ),
    );
    const { legacyWriting, legacyScoped } = yield* legacyScopes(transferRows, reservations);
    const legacyUnscoped = [...legacyWriting].filter((itemKey) => !legacyScoped.has(itemKey));
    // A read stands when it was recorded, or when the read that overtook it saw the same item,
    // claims aside. Any other read may show the work under way on its item as it no longer is.
    const readItems = new Set<FactoryItemKey>();
    const readAs = new Map<FactoryItemKey, Pick<FactoryPolicyActive, "stage" | "issue">>();
    const shown = new Map<FactoryItemKey, FactoryPolicyActive>();
    const show = (entry: FactoryPolicyActive) => {
      if (readItems.has(entry.itemKey) && !shown.has(entry.itemKey)) {
        shown.set(entry.itemKey, entry);
      }
    };
    const candidates: Array<Candidate> = [];
    for (const { itemKey, subject, issue, observed, recorded } of recordedReads) {
      const overtaken =
        recorded.type === "superseded"
          ? recorded.current
          : recorded.type === "conflict"
            ? recorded.recorded
            : undefined;
      if (
        recorded.type === "recorded" ||
        (overtaken !== undefined && substantiveDigest(overtaken) === substantiveDigest(observed))
      ) {
        readItems.add(itemKey);
      }
      // Only a recorded read decides the item.
      const observation = recorded.type === "recorded" ? recorded.observation : undefined;
      let events = yield* outcomeStore.itemEvents({ factoryId, itemKey });
      let stage = nextStage(events);
      // An issue open again after T3 closed it is a new version of the item (BTC #14): its history
      // and claim stay, and the policy decides the remaining scope from there.
      if (stage.type === "done" && issue.state === "open" && observation !== undefined) {
        yield* outcomeStore.recordReopen({
          factoryId,
          itemKey,
          closureOutcomeId: stage.closureOutcomeId,
          observationId: observation.observationId,
        });
        events = yield* outcomeStore.itemEvents({ factoryId, itemKey });
        stage = nextStage(events);
      }
      const running = held.get(itemKey);
      const admittedOn =
        running?.origin === "admitted" && running.observationId !== undefined
          ? yield* store.getObservation({ factoryId, observationId: running.observationId })
          : Option.none<FactoryStore.ItemObservation>();
      const weighed = running === undefined ? issue : yield* asAdmitted(running, admittedOn, issue);
      // Custody left on a done item is shown at the stage that finished it.
      readAs.set(itemKey, { stage: stage.type === "done" ? "close" : stage.type, issue: weighed });
      if (stage.type === "done") {
        note(itemKey, "done", "done");
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
        const body = legacyScoped.get(itemKey);
        show({
          itemKey,
          stage: stage.type,
          custody: "legacy",
          issue: body === undefined ? issue : { ...issue, body },
        });
        note(
          itemKey,
          stage.type,
          "legacy_custody",
          `job ${transfer?.job ?? "legacy"}'s custody is unknown until the owner disposes of ${custody.reservationId}`,
        );
        continue;
      }
      if (legacyWriting.has(itemKey)) {
        note(
          itemKey,
          stage.type,
          "legacy_owned",
          "a worker a rolled-back transfer named may still write it",
        );
        continue;
      }
      // Its current decision is still running or settling: nothing to propose until it lands. A
      // substantive change under it is recorded, and the next stage is decided on it.
      if (running !== undefined) {
        // Only the item's own content and evidence count; the claim landing is not a change.
        const changed =
          observation !== undefined &&
          Option.isSome(admittedOn) &&
          substantiveDigest(admittedOn.value) !== substantiveDigest(observation);
        if (changed) {
          yield* outcomeStore.recordBasisChange({
            factoryId,
            itemKey,
            reservationId: running.reservationId,
            basisDigest: observation.basisDigest,
            observationId: observation.observationId,
          });
        }
        show({
          itemKey,
          stage: isFactoryStage(running.taskKind) ? running.taskKind : stage.type,
          custody: "native",
          issue: weighed,
        });
        if (running.origin === "admitted" && running.quarantine !== undefined) {
          note(
            itemKey,
            stage.type,
            "quarantined",
            `its ${running.taskKind} stage's historical execution has no proof its processes ended; it still owns this item, uncharged since ${running.quarantine.quarantinedAt}. Next: the owner proves its processes ended and reconciles it, or ends the quarantine with t3_factory_quarantine.`,
          );
          continue;
        }
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
      // claim. A ticket T3 opened for it, or a parent's own closure, is no work begun on it.
      const begun = events.some(
        (event) =>
          event.type === "outcome" &&
          event.kind !== "ticket_opened" &&
          !event.outcomeId.startsWith(PARENT_CLOSURE),
      );
      const owner = begun ? yield* itemOwner(factoryId, itemKey) : undefined;
      if (begun) {
        if (owner === undefined) {
          note(itemKey, stage.type, "not_owned");
          continue;
        }
        if (observed.claims.some((carrier) => carrier.carrierKey !== owner.carrierKey)) {
          show({ itemKey, stage: stage.type, custody: "foreign", issue });
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
          show({ itemKey, stage: stage.type, custody: "foreign", issue });
        }
        note(
          itemKey,
          stage.type,
          "not_eligible",
          issue.state !== "open"
            ? "the issue is closed"
            : observed.claims.length > 0
              ? "another writer's claim holds it"
              : claim.eligibilityLabel === undefined
                ? undefined
                : `it lacks the readiness label ${claim.eligibilityLabel}`,
        );
        continue;
      }
      // A paused factory finishes what it owns and decides nothing new: no policy call, gate or
      // ticket for an item it has not begun, even one entered or requested before the pause.
      if (!begun && transfer === undefined && !configuration.enabled) {
        note(itemKey, stage.type, "refused:factory_paused");
        continue;
      }
      if (observation === undefined) {
        note(itemKey, stage.type, "read_superseded");
        continue;
      }
      candidates.push({ itemKey, subject, issue, observation, stage, owner, events });
    }
    // Custody is work under way on every item this pass read, whatever the read shows of it now:
    // a claim label gone or an issue closed ends no work, and a draining job may still write.
    const custodyOn = new Map<FactoryItemKey, FactoryPolicyActive["custody"]>();
    for (const reservation of reservations) {
      if (reservation.state !== "held" || custodyOn.get(reservation.itemKey) === "native") continue;
      custodyOn.set(
        reservation.itemKey,
        FactoryStore.isNativeReservation(reservation)
          ? "native"
          : reservation.origin === "transferred"
            ? "legacy"
            : (custodyOn.get(reservation.itemKey) ?? "foreign"),
      );
    }
    for (const [itemKey, body] of legacyScoped) {
      const read = readAs.get(itemKey);
      if (read !== undefined) {
        show({ itemKey, custody: "legacy", stage: read.stage, issue: { ...read.issue, body } });
      }
    }
    for (const [itemKey, read] of readAs) {
      const custody = custodyOn.get(itemKey);
      if (custody !== undefined) show({ itemKey, custody, ...read });
    }
    const active = [...shown.values()];
    // The policy sees work under way only as this pass read it: custody already held when the
    // pass listed it, on an item it then read, or a claim its own reads charged. Any other, unread,
    // read as it no longer is or taken since, leaves nothing decided beside it until a later pass
    // reads it.
    const notRead = (listed: ReadonlyArray<FactoryStore.FactoryReservation>) => [
      ...new Set(
        listed.flatMap((reservation) =>
          reservation.state !== "held" ||
          subjectOf(reservation.itemKey) === undefined ||
          (readItems.has(reservation.itemKey) &&
            (heldBeforeReads.has(reservation.reservationId) ||
              (reservation.origin === "observed" && reservation.generation === generation) ||
              (reservation.origin === "inherited" &&
                heldBeforeReads.has(reservation.parentReservationId))))
            ? []
            : [reservation.itemKey],
        ),
      ),
    ];
    const holdFor = (disposition: FactoryItemDisposition, detail: string) => {
      for (const candidate of candidates) {
        note(candidate.itemKey, candidate.stage.type, disposition, detail);
      }
    };
    const holdBack = (keys: ReadonlyArray<FactoryItemKey>, why = "was not read by this pass") => {
      retry = true;
      holdFor("custody_unread", `work under way on ${keys.join(", ")} ${why}`);
    };
    const unread = [
      ...new Set([
        ...notRead(reservations),
        ...[...legacyScoped.keys()].filter((itemKey) => !shown.has(itemKey)),
      ]),
    ];
    // A started lineage the policy will not weigh, as an item or as work under way, leaves nothing
    // decided beside it. A closing one is done; one this factory no longer owns waits on the owner.
    const weighed = new Set([...candidates.map((candidate) => candidate.itemKey), ...shown.keys()]);
    const unweighed = openLineages.filter(
      (itemKey) => !weighed.has(itemKey) && dispositions.get(itemKey)?.disposition !== "done",
    );
    const unowned = unweighed.filter(
      (itemKey) => dispositions.get(itemKey)?.disposition === "not_owned",
    );
    const unseen = unweighed.filter((itemKey) => !unowned.includes(itemKey));
    const reserved = yield* outcomeStore.reservedDecisions(factoryId);
    const grants = yield* store.listGrants(factoryId);
    if (Option.isNone(proposer)) {
      for (const candidate of candidates) {
        note(candidate.itemKey, candidate.stage.type, "policy_unavailable");
      }
    } else if (unread.length > 0) {
      holdBack(unread);
    } else if (unseen.length > 0) {
      holdBack(unseen, "is started work this pass could not read as it is");
    } else if (unowned.length > 0) {
      // No retry: no later read changes who owns it.
      holdFor(
        "custody_unread",
        `started work on ${unowned.join(", ")} is no longer this factory's, and its history may still claim files`,
      );
    } else if (textUnknown.length > 0) {
      holdBack(textUnknown, "has changed from the text it was admitted on, which T3 did not keep");
    } else if (legacyUnscoped.length > 0) {
      // No retry: it lifts when the owner scopes or disposes of the custody, or the named workers
      // finish.
      holdFor(
        "legacy_unscoped",
        `legacy work under way on ${legacyUnscoped.join(", ")} has a scope T3 cannot establish`,
      );
    } else if (candidates.length > 0) {
      const reads = { outcomeStore, store, operations: operationStore };
      const itemFacts = new Map<FactoryItemKey, FactoryPolicyItemFacts>();
      const items: Array<FactoryPolicyItem> = [];
      // Why T3 offers an item no preparation now, shown on its wait whatever the policy decides.
      const preparationBlocked = new Map<FactoryItemKey, string>();
      // One read of the criteria root serves every item of the pass.
      const criteriaRoot = configuration.parents?.criteriaRoot;
      const listing =
        criteriaRoot === undefined ? undefined : yield* Effect.cached(listCriteria(criteriaRoot));
      // Each parent's one Root adoption, which may name acceptance sections of its own.
      const adoptedOf = new Map<FactoryItemKey, unknown>();
      for (const candidate of candidates) {
        const outcomes = yield* policyOutcomes(reads, candidate.events);
        const adoption =
          listing === undefined || criteriaRoot === undefined
            ? undefined
            : yield* adoptionsIn(yield* listing, {
                root: criteriaRoot,
                issue: candidate.subject.issueNumber,
                factoryId,
                itemKey: candidate.itemKey,
              });
        if (adoption !== undefined && "found" in adoption && adoption.found.length === 1) {
          adoptedOf.set(candidate.itemKey, adoption.found[0]!.document);
        }
        const criteriaEvidence =
          adoption === undefined || "unread" in adoption || adoption.found.length !== 1
            ? []
            : yield* evidenceFacts(reads, {
                factoryId,
                candidate,
                document: adoption.found[0]!.document,
                read: itemFacts,
              });
        const blockers = yield* policyBlockers(reads, {
          factoryId,
          repository: candidate.subject.repository,
          issue: candidate.issue,
          read: itemFacts,
        });
        const children = yield* policyChildren(reads, {
          factoryId,
          repository: candidate.subject.repository,
          issue: candidate.issue,
          membership: yield* subIssuesOf(configuration, candidate.subject, candidate.issue),
          read: itemFacts,
        });
        // Triage decomposes an item only before its first build.
        const triage =
          candidate.stage.type === "implement"
            ? yield* triageDecisionFor(configuration, candidate, outcomes)
            : undefined;
        if (triage !== undefined && "unread" in triage) {
          preparationBlocked.set(
            candidate.itemKey,
            `its preparation waits on ${triage.unread.actor}: ${triage.unread.what}; ${triage.unread.action}`,
          );
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
          ...blockers,
          ...children,
          ...(criteriaEvidence.length === 0 ? {} : { criteriaEvidence }),
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
          // No triage is offered while a failed preparation's readback cannot be made.
          ...(triage === undefined || "unread" in triage
            ? {}
            : { triageDecisionKey: triage.decision }),
          ...(() => {
            const preparation =
              triage === undefined || "unread" in triage
                ? undefined
                : preparationDueOf({
                    labels: candidate.issue.labels,
                    itemVersion: candidate.observation.itemVersion,
                    outcomes,
                    triage,
                  });
            return preparation === undefined ? {} : { preparation };
          })(),
        });
      }
      const answer = yield* proposer.value.decide({ configuration, items, active });
      // Custody taken, or a transfer begun or moved, while the policy decided was not in what it
      // weighed, even if it left nothing held.
      const custodyNow = isPolicyFailure(answer) ? [] : yield* store.listReservations(factoryId);
      const weighed = new Set(transferRows.map((row) => `${row.transferId}\n${row.state}`));
      const movedSince = (isPolicyFailure(answer) ? [] : yield* transfers.list(factoryId)).flatMap(
        (row) =>
          weighed.has(`${row.transferId}\n${row.state}`)
            ? []
            : row.items.map((item) => item.itemKey),
      );
      const takenSince = [...new Set([...notRead(custodyNow), ...movedSince])];
      if (isPolicyFailure(answer)) {
        // One visible problem for the factory, not a write on every item it could not decide.
        issues.push({ kind: "policy", detail: answer.reason });
        for (const candidate of candidates) {
          note(candidate.itemKey, candidate.stage.type, "policy_failed", answer.reason);
        }
      } else if (takenSince.length > 0) {
        holdBack(takenSince);
      } else {
        // Each admission commits only beside the custody weighed here and the pass's own, so
        // custody taken, or a transfer begun or moved, while the pass acts refuses its later
        // admissions.
        const custodyRead = custodyNow.flatMap((reservation) =>
          reservation.state === "held" ? [reservation.reservationId] : [],
        );
        const transfersRead = transferRows.map(({ transferId, state }) => ({ transferId, state }));
        const byKey = new Map(candidates.map((candidate) => [candidate.itemKey, candidate]));
        const decided = new Set<FactoryItemKey>();
        let moved = false;
        for (const { itemKey, decision } of answer) {
          const candidate = byKey.get(itemKey);
          if (candidate === undefined || decided.has(itemKey)) continue;
          decided.add(itemKey);
          // Once custody moved, the rest of the answer was decided beside custody that is gone.
          if (moved) {
            note(
              itemKey,
              candidate.stage.type,
              "custody_unread",
              "custody moved while the pass acted",
            );
            continue;
          }
          const result = yield* act(
            configuration,
            candidate,
            decision,
            { custodyRead, transfersRead },
            adoptedOf.get(itemKey),
          );
          if (result.admission?.type === "admitted") {
            custodyRead.push(result.admission.reservation.reservationId);
          }
          if (result.disposition === "refused:custody_changed") {
            moved = true;
            retry = true;
          }
          const withdrawal =
            decision !== undefined &&
            isNothingProposed(decision) &&
            decision.withdraws !== undefined
              ? yield* withdrawGate(configuration, candidate, decision.withdraws)
              : undefined;
          for (const pending of reserved) {
            if (pending.itemKey !== itemKey || pending.state !== "pending") continue;
            // T3's own question about a ticket create is settled by that create, not the policy.
            if (pending.stage === TICKET_DECISION_STAGE) continue;
            const reason = overtakenBy(pending, candidate.stage, result.effective ?? decision);
            if (reason !== undefined) {
              yield* outcomeStore.supersedeDecision({ decisionId: pending.decisionId, reason });
            }
          }
          const blocked =
            result.disposition === "nothing_proposed" ? preparationBlocked.get(itemKey) : undefined;
          const detail = [
            result.detail,
            ...(withdrawal !== undefined && "refused" in withdrawal
              ? [`T3 withdrew nothing: ${withdrawal.refused}`]
              : []),
            ...(blocked === undefined ? [] : [`T3: ${blocked}`]),
          ]
            .filter((part) => part !== undefined)
            .join("; ");
          // A precise reason to start nothing is a wait, kept once per basis; anything else ends it.
          yield* outcomeStore.recordWait({
            factoryId,
            itemKey,
            wait:
              result.disposition === "nothing_proposed" && detail !== undefined
                ? {
                    basis: sha256(
                      canonical([candidate.stage.type, result.reasonClass ?? null, detail]),
                    ).slice(0, 32),
                    stage: candidate.stage.type,
                    reasonClass: result.reasonClass,
                    detail,
                  }
                : { ended: result.disposition },
          });
          if (result.admission !== undefined) admissions.push(result.admission);
          if (result.issue !== undefined) issues.push(result.issue);
          note(itemKey, candidate.stage.type, result.disposition, detail, result.reasonClass);
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
    yield* Ref.update(lastMetrics, (current) =>
      new Map(current).set(factoryId, passMetrics(at, [...dispositions.values()])),
    );
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
    return { admissions, unread: unreadSubjects };
  });

  /** A parent's sub-issues as the tracker lists them now, or why they could not be read. */
  const subIssuesOf = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    subject: { readonly repository: string; readonly issueNumber: number },
    issue: TrackerIssue,
  ) {
    if (issue.subIssueCount === undefined || issue.subIssueCount === 0) return [];
    const claim = configuration.claim;
    if (claim === undefined)
      return { unread: "the factory has no tracker to read sub-issues from" };
    const listed = yield* tracker
      .withSession({ host: claim.host, cwd: configuration.artifactRoot }, (session) =>
        session.listSubIssues === undefined
          ? Effect.fail(
              new FactoryTracker.FactoryTrackerError({
                operation: "list-sub-issues",
                cause: "this tracker does not list sub-issues",
              }),
            )
          : session.listSubIssues(subject),
      )
      .pipe(Effect.result);
    return listed._tag === "Success"
      ? listed.success
      : { unread: `its sub-issues could not be read: ${listed.failure.message}` };
  });

  /** Carries out one item's decision for its current stage, beside the custody it was decided on. */
  /**
   * The item's triage decision as of this pass. After a failed preparation it includes what T3
   * reads back for that failure now: whether the base it named is on the integration line, and the
   * item's blockers. None is offered while that readback cannot be made, so nothing starts on it.
   */
  const triageDecisionFor = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    candidate: Candidate,
    outcomes: ReadonlyArray<FactoryPolicyOutcome>,
  ) {
    const input = {
      factoryId: configuration.factoryId,
      itemKey: candidate.itemKey,
      policyRevision: configuration.policyRevision,
    };
    // Earlier standing preparations on this item text and policy, decided on what is read now save
    // for comments added since, oldest first: a status note is not a new preparation.
    const identity = policyIdentityOf(configuration.policyRevision);
    const reused: Array<ReusedPreparation> = [];
    const weighed = new Set<string>();
    for (const outcome of outcomes) {
      const reservationId = outcome.origin.reservationId;
      if (
        outcome.stage !== "triage" ||
        outcome.state !== "verified" ||
        !standsAgainstComments(outcome.report) ||
        reservationId === undefined ||
        weighed.has(reservationId) ||
        outcome.itemVersion !== candidate.observation.itemVersion ||
        outcome.policyRevision === undefined ||
        policyIdentityOf(outcome.policyRevision) !== identity
      ) {
        continue;
      }
      weighed.add(reservationId);
      const earlier = yield* store.getReservation(reservationId);
      if (
        Option.isNone(earlier) ||
        earlier.value.origin !== "admitted" ||
        earlier.value.stageBasis === undefined ||
        earlier.value.observationId === undefined
      ) {
        continue;
      }
      const read = yield* store.getObservation({
        factoryId: configuration.factoryId,
        observationId: earlier.value.observationId,
      });
      if (
        Option.isSome(read) &&
        onlyCommentsAdded(read.value.evidence, candidate.observation.evidence)
      ) {
        reused.push({ basis: earlier.value.stageBasis, decisionKey: earlier.value.decisionKey });
      }
    }
    const plain = triageDecisionOf(input, candidate.observation, outcomes, undefined, reused);
    const reservationId = plain.failed?.origin.reservationId;
    if (plain.failed === undefined) return plain;
    const failed = plain.failed;
    const unread = (what: string, actor: string, action: string) => ({
      unread: {
        what: `its last preparation ${failed.outcomeId} (failure ${failed.failureDigest?.slice(0, 12)}) failed, and ${what}`,
        actor,
        action,
      },
    });
    const line = integrationLineOf(configuration);
    if (reservationId === undefined) {
      return unread(
        "names no execution whose proposal T3 can read back",
        "owner",
        `reject outcome ${failed.outcomeId} with the factory's reject-outcome control, so the item is prepared afresh`,
      );
    }
    const filed = yield* outcomeStore.listForOrigin(reservationId);
    const base = filed.find((outcome) => outcome.report.outcome === "unit_proposed")?.report.subject
      ?.baseCommit;
    const read =
      base === undefined
        ? Option.some<string | undefined>(undefined)
        : yield* candidateBaseProblem(gitReadback, configuration, base).pipe(Effect.option);
    if (Option.isNone(read)) {
      return unread(
        `T3 could not read its candidate base ${base} against ${line}`,
        "T3 (git readback of the project repository)",
        `read ${base} and ${line} back again; restore the project repository or that line if it is missing`,
      );
    }
    // A retry of this failure may name another candidate. T3 rejected it for that base alone, so
    // it counts once its base reads otherwise than that rejection; a further failure changes nothing.
    const { itemVersion } = candidate.observation;
    const retryBasis = `${triageBasis(itemVersion, plain.failed.failureDigest)}:after:`;
    const retried = new Map<string, string>();
    for (const outcome of outcomes) {
      const retryId = outcome.origin.reservationId;
      if (
        outcome === plain.failed ||
        outcome.stage !== "triage" ||
        outcome.state !== "verified" ||
        outcome.report.outcome !== "failed" ||
        retryId === undefined
      ) {
        continue;
      }
      const retry = yield* store.getReservation(retryId);
      if (Option.isNone(retry) || retry.value.origin !== "admitted") continue;
      const basis = retry.value.stageBasis;
      if (
        basis?.startsWith(retryBasis) !== true ||
        outcome.decisionKey === undefined ||
        ![
          decisionKeyOf(
            { ...input, taskKind: "triage", stage: { type: "triage", basis } },
            candidate.observation,
          ),
          decisionKeyOf(
            {
              ...input,
              policyRevision: retry.value.policyRevision,
              taskKind: "triage",
              stage: { type: "triage", basis },
            },
            candidate.observation,
            { exactPolicy: true },
          ),
          ...reused.flatMap((earlier) => (earlier.basis === basis ? [earlier.decisionKey] : [])),
        ].includes(outcome.decisionKey)
      ) {
        continue;
      }
      for (const proposal of yield* outcomeStore.listForOrigin(retryId)) {
        const named = proposal.report.subject?.baseCommit;
        if (
          proposal.state !== "rejected" ||
          proposal.report.outcome !== "unit_proposed" ||
          proposal.report.proposal?.basis !== itemVersion ||
          named === undefined ||
          named === base ||
          retried.has(named)
        ) {
          continue;
        }
        const now = yield* candidateBaseProblem(gitReadback, configuration, named).pipe(
          Effect.option,
        );
        if (Option.isNone(now)) {
          return unread(
            `T3 could not read its retried candidate base ${named} against ${line}`,
            "T3 (git readback of the project repository)",
            `read ${named} and ${line} back again; restore the project repository or that line if it is missing`,
          );
        }
        if (now.value !== proposal.rejection) {
          retried.set(named, now.value ?? "on the integration line");
        }
      }
    }
    const blockers = yield* policyBlockers(
      { outcomeStore, store },
      {
        factoryId: configuration.factoryId,
        repository: candidate.subject.repository,
        issue: candidate.issue,
        read: new Map(),
      },
    );
    const readback = sha256(
      canonical([
        base ?? null,
        read.value ?? "on the integration line",
        (candidate.issue.blockedBy ?? null)?.map((blocker) => [blocker.number, blocker.state]) ??
          null,
        (blockers.blockers ?? []).map((blocker) => [
          blocker.itemKey,
          blocker.outcomes.map((outcome) => [outcome.outcomeId, outcome.state]),
        ]),
        ...(retried.size === 0 ? [] : [[...retried].toSorted(([a], [b]) => a.localeCompare(b))]),
      ]),
    ).slice(0, 32);
    return triageDecisionOf(input, candidate.observation, outcomes, readback, reused);
  });

  /**
   * Why a first build may not adopt the preparation it names, read at admission: the proposal must
   * be verified on the item's current triage inputs, the build must start exactly at its base, and
   * that base must read back now on the line T3 integrates onto. What cannot be read is not ready.
   */
  /**
   * Why a no-edit unit may not run again at a rework, if it may not. Only a repair of its run
   * runs it again: a verified correction declaring an execution_binding_repair, or a harness
   * failure needing no source change, answering this item's own failure of exactly this unit
   * (requirement, item version and execution), on its candidate.
   */
  const noEditRepairProblem = Effect.fnUntraced(function* (
    candidate: Candidate,
    stage: Extract<FactoryStage, { readonly type: "rework" }>,
    requirement: NoEditRequirement,
    execution: string | undefined,
  ) {
    const correction = yield* outcomeStore.get(stage.specOutcomeId);
    if (
      Option.isNone(correction) ||
      correction.value.state !== "verified" ||
      correction.value.report.outcome !== "correction_spec" ||
      !repairsRun(correction.value.report.summary ?? "")
    ) {
      return "its correction is not a verified execution_binding_repair";
    }
    const head = correction.value.report.subject?.headCommit;
    if (head !== undefined && head !== requirement.candidate) {
      return `its correction names head ${head}, not the candidate ${requirement.candidate}`;
    }
    const answered = candidate.events.find(
      (event) =>
        event.type === "outcome" &&
        event.kind === "failed" &&
        event.failureDigest !== undefined &&
        event.failureDigest === correction.value.corrects,
    );
    const failed =
      answered?.type === "outcome" ? yield* outcomeStore.get(answered.outcomeId) : Option.none();
    const reservationId = Option.isSome(failed) ? failed.value.origin.reservationId : undefined;
    const earlier =
      reservationId === undefined ? Option.none() : yield* store.getReservation(reservationId);
    if (Option.isNone(earlier) || earlier.value.origin !== "admitted") {
      return "its correction answers no failure of this item's own stage";
    }
    if (earlier.value.stageBasis?.includes(noEditBasis(requirement)) !== true) {
      return "it is not the no-edit unit whose failure its correction answers";
    }
    if (earlier.value.itemVersion !== candidate.observation.itemVersion) {
      return "the item changed since the no-edit unit failed";
    }
    if (execution === undefined || earlier.value.executionChoice !== execution) {
      return `it does not run on the execution the no-edit unit failed on (${earlier.value.executionChoice ?? "none named"})`;
    }
    return undefined;
  });

  const preparedStale = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    candidate: Candidate,
    decision: FactoryAdmissionRequest,
    outcomeId: string,
  ): Effect.fn.Return<
    { readonly what: string; readonly actor: string; readonly action: string } | undefined,
    Effect.Error<ReturnType<typeof triageDecisionFor>>
  > {
    const policy = (what: string, action: string) => ({ what, actor: "project policy", action });
    const prepare = (what: string) => ({
      what,
      actor: "T3 (preparation)",
      action: "prepare the unit again on the item's current text, evidence and policy",
    });
    if (candidate.stage.type !== "implement") {
      return policy(
        `prepared unit ${outcomeId} was proposed past the item's first build`,
        "propose this stage without a prepared unit",
      );
    }
    const outcomes = yield* policyOutcomes({ outcomeStore, store }, candidate.events);
    const outcome = outcomes.find((each) => each.outcomeId === outcomeId);
    if (
      outcome?.stage !== "triage" ||
      outcome.state !== "verified" ||
      outcome.report.outcome !== "unit_proposed"
    ) {
      return policy(
        `${outcomeId} is not a verified unit proposal of this item`,
        "name the item's verified unit_proposed outcome as its prepared unit",
      );
    }
    const current = yield* triageDecisionFor(configuration, candidate, outcomes);
    if (current === undefined) return prepare(`${outcomeId}'s preparation cannot be read back now`);
    if ("unread" in current) return current.unread;
    // A preparation run again on another execution after an environment failure is that basis too.
    const preparedOn =
      outcome.origin.reservationId === undefined
        ? Option.none<FactoryStore.FactoryReservation>()
        : yield* store.getReservation(outcome.origin.reservationId);
    const retriedBasis =
      Option.isSome(preparedOn) && preparedOn.value.origin === "admitted"
        ? preparedOn.value.stageBasis
        : undefined;
    const onAnotherExecution =
      retriedBasis !== undefined &&
      retriedBasis.startsWith(`${current.basis}:env:`) &&
      /^[0-9a-f]{32}$/.test(retriedBasis.slice(current.basis.length + ":env:".length)) &&
      outcome.decisionKey !== undefined &&
      current.keysFor(retriedBasis).has(outcome.decisionKey);
    if (
      !onAnotherExecution &&
      (outcome.decisionKey === undefined || !current.keys.has(outcome.decisionKey))
    ) {
      return prepare(
        `${outcomeId} was prepared on other inputs than the item's current text, evidence and policy`,
      );
    }
    const base = outcome.report.subject?.baseCommit;
    if (base === undefined) return prepare(`${outcomeId} names no candidate base`);
    const workspace = decision.workspaceStrategy;
    if (
      workspace?.type !== "worktree" ||
      workspace.baseRef !== base ||
      workspace.startFromOrigin === true
    ) {
      return policy(
        `the build would not start at ${outcomeId}'s prepared base ${base}`,
        `start the build's worktree exactly at ${base}, not from origin`,
      );
    }
    const line = integrationLineOf(configuration);
    const problem = yield* candidateBaseProblem(gitReadback, configuration, base).pipe(
      Effect.option,
    );
    if (Option.isNone(problem)) {
      return {
        what: `T3 could not read ${outcomeId}'s prepared base ${base} against ${line}`,
        actor: "T3 (git readback of the project repository)",
        action: `read ${base} and ${line} back again; restore the project repository or that line if it is missing`,
      };
    }
    return problem.value === undefined
      ? undefined
      : prepare(`${outcomeId}'s prepared base ${base} no longer holds: ${problem.value}`);
  });

  /** Every criteria document under the criteria root, by real path, as read now. */
  const listCriteria = Effect.fnUntraced(function* (root: string): Effect.fn.Return<
    | { readonly unread: string }
    | {
        readonly documents: ReadonlyArray<{
          readonly target: string;
          readonly issue: number;
          readonly document: unknown;
        }>;
      }
  > {
    const listed = yield* fs.readDirectory(root, { recursive: true }).pipe(Effect.result);
    if (listed._tag === "Failure") return { unread: listed.failure.message };
    const documents: Array<{
      readonly target: string;
      readonly issue: number;
      readonly document: unknown;
    }> = [];
    for (const entry of listed.success.toSorted()) {
      if (!entry.toLowerCase().endsWith(".json")) continue;
      const read = yield* fs.realPath(path.join(root, entry)).pipe(
        Effect.flatMap((target) => Effect.map(fs.readFile(target), (bytes) => ({ target, bytes }))),
        Effect.result,
      );
      if (read._tag === "Failure") return { unread: `${entry}: ${read.failure.message}` };
      const { target, bytes } = read.success;
      const document = parseJson(new TextDecoder().decode(bytes));
      if (
        typeof document === "object" &&
        document !== null &&
        "schema" in document &&
        document.schema === "factory-parent-criteria/1" &&
        "issue" in document &&
        typeof document.issue === "number"
      ) {
        documents.push({ target, issue: document.issue, document });
      }
    }
    return { documents };
  });

  /** Root's criteria documents for one issue in a listing; T3's own kept copies are not adoptions. */
  const adoptionsIn = Effect.fnUntraced(function* (
    listing: Effect.Success<ReturnType<typeof listCriteria>>,
    input: {
      readonly root: string;
      readonly issue: number;
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
    },
  ) {
    if ("unread" in listing) return { unread: listing.unread };
    const found: Array<{ readonly target: string; readonly document: unknown }> = [];
    for (const each of listing.documents) {
      if (each.issue !== input.issue) continue;
      if (yield* preparedPublication.isKept({ ...input, target: each.target })) continue;
      found.push(each);
    }
    return { found };
  });

  /** Every criteria document Root adopted for `issue` under the criteria root, read now. */
  const adoptedCriteriaOf = Effect.fnUntraced(function* (input: {
    readonly root: string;
    readonly issue: number;
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryItemKey;
  }) {
    const adoptions = yield* adoptionsIn(yield* listCriteria(input.root), input);
    if ("unread" in adoptions) return { unread: adoptions.unread };
    return { found: adoptions.found.map((each) => each.target) };
  });

  /**
   * The facts of each item the one adopted criteria document for an item names as evidence. Only
   * same-repository keys T3 holds records of; none at all when the adoption is not exactly one or
   * names more than the bound.
   */
  const evidenceFacts = Effect.fnUntraced(function* (
    reads: PolicyOutcomeReads,
    input: {
      readonly factoryId: FactoryId;
      readonly candidate: Candidate;
      readonly document: unknown;
      readonly read: Map<FactoryItemKey, FactoryPolicyItemFacts>;
    },
  ) {
    const { candidate } = input;
    const clauses = adoptedClauses(input.document, candidate.subject.issueNumber) ?? [];
    const own = `github:${candidate.subject.repository}#`;
    const keys = [
      ...new Set(
        clauses.flatMap((clause) =>
          ((clause.evidence ?? []) as ReadonlyArray<{ readonly itemKey: string }>).map(
            (evidence) => evidence.itemKey,
          ),
        ),
      ),
    ].filter(
      (key) =>
        key.startsWith(own) && /^\d+$/.test(key.slice(own.length)) && key !== candidate.itemKey,
    );
    if (keys.length > CRITERIA_EVIDENCE_LIMIT) return [];
    const facts: Array<FactoryPolicyItemFacts> = [];
    for (const key of keys) {
      const itemKey = FactoryItemKeyFor({
        repository: candidate.subject.repository,
        issueNumber: Number(key.slice(own.length)),
      });
      const events = yield* reads.outcomeStore.itemEvents({ factoryId: input.factoryId, itemKey });
      if (events.length === 0) continue;
      facts.push(yield* policyItemFacts(reads, input.factoryId, itemKey, input.read));
    }
    return facts;
  });

  /**
   * A parent's closure on its adopted criteria, under the factory's configured parent authority.
   * T3 rereads the criteria and judges every clause from its own records and the parent's whole
   * membership; the policy's word that they are met counts for nothing. Its plan, or one wait.
   */
  /**
   * The identity of the execution a failed preparation actually ran on: its thread's model
   * selection (options included), runtime and interaction mode. Undefined when it cannot be read.
   */
  const executionRanBy = Effect.fnUntraced(function* (failed: FactoryPolicyOutcome) {
    const reservationId = failed.origin.reservationId;
    if (reservationId === undefined) return undefined;
    const reservation = yield* store.getReservation(reservationId).pipe(Effect.option);
    const ran = Option.flatten(reservation);
    if (Option.isNone(ran) || ran.value.origin !== "admitted") return undefined;
    const projection = yield* projections
      .getThreadProjection(ran.value.execution.threadId)
      .pipe(Effect.option);
    return Option.isNone(projection) ? undefined : executionIdentity(projection.value.thread);
  });

  const closeParent = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    candidate: Candidate,
    closure: NonNullable<FactoryProceed["parentClosure"]>,
    fence: FactoryStore.CustodyFence,
  ) {
    const issue = candidate.subject.issueNumber;
    const wait = (what: string, actor: string, action: string, resume: string) => ({
      wait: waitText({
        issue,
        what,
        actor,
        action,
        consequence: "the parent stays open and is never a broad implementation unit",
        resume,
      }),
    });
    if (candidate.stage.type !== "implement") {
      return wait(
        `a parent closure was proposed at its ${candidate.stage.type} stage`,
        "project policy",
        "propose closure only for a parent that is not itself built",
        "a parent at its first stage",
      );
    }
    const authority = configuration.parents;
    if (authority === undefined) {
      return wait(
        "the factory has no parent closure authority configured",
        "Root coordinator",
        "adopt parents {close, criteriaRoot} for the project",
        "that authority is installed",
      );
    }
    const readPinned = Effect.fnUntraced(function* (pinned: PinnedFile) {
      const target = path.resolve(pinned.root, pinned.path);
      const bytes =
        (yield* insideArtifactRoot(authority.criteriaRoot, pinned.root)) &&
        (yield* insideArtifactRoot(pinned.root, target))
          ? yield* fs.readFile(target).pipe(Effect.option)
          : Option.none<Uint8Array>();
      return Option.isSome(bytes) && sha256(bytes.value) === pinned.sha256
        ? Option.some(new TextDecoder().decode(bytes.value))
        : Option.none<string>();
    });
    const reads = { outcomeStore, store, operations: operationStore };
    const records = new Map<FactoryItemKey, FactoryPolicyItemFacts>();
    const membership = yield* Effect.cached(
      Effect.flatMap(subIssuesOf(configuration, candidate.subject, candidate.issue), (listed) =>
        policyChildren(reads, {
          factoryId: configuration.factoryId,
          repository: candidate.subject.repository,
          issue: candidate.issue,
          membership: listed,
          read: records,
        }),
      ),
    );
    const parentOutcomes = yield* policyOutcomes(reads, candidate.events);
    const bodySha256 = sha256(candidate.issue.body);
    let criteria: Option.Option<Criteria>;
    let criteriaSha256: string;
    let prepared: string | undefined;
    let preparedBasis: FactoryPreparedCriteriaStore.Reservation["basis"] | undefined;
    if ((closure.criteria === undefined) === (closure.prepared === undefined)) {
      return wait(
        "the parent closure names neither or both of adopted and prepared criteria",
        "project policy",
        "name exactly one criteria document for the closure",
        "a closure naming one",
      );
    }
    if (closure.criteria !== undefined) {
      const pinned = closure.criteria;
      criteria = Option.flatMap(yield* readPinned(pinned), decodeCriteria);
      criteriaSha256 = pinned.sha256;
      if (
        Option.isNone(criteria) ||
        criteria.value.issue !== issue ||
        criteria.value.bodySha256 !== bodySha256
      ) {
        return wait(
          `criteria ${pinned.path} is unreadable, outside ${authority.criteriaRoot}, malformed or for another issue body`,
          "Root coordinator",
          `adopt criteria for the current body sha256 ${bodySha256}`,
          "current criteria are installed",
        );
      }
    } else {
      const given = closure.prepared!;
      criteriaSha256 = given.sha256;
      const document = sha256(given.bytes) === given.sha256 ? parseJson(given.bytes) : undefined;
      const adopted =
        given.adopted === undefined
          ? undefined
          : Option.flatMap(yield* readPinned(given.adopted), (text) =>
              Option.fromUndefinedOr(parseJson(text)),
            );
      if (document === undefined || (adopted !== undefined && Option.isNone(adopted))) {
        return wait(
          document === undefined
            ? "the prepared criteria are not the JSON their sha256 names"
            : `the adopted criteria ${given.adopted?.path} are unreadable, outside ${authority.criteriaRoot} or not as pinned`,
          "project policy",
          "prepare the parent's criteria again from the current facts",
          "prepared criteria T3 can read",
        );
      }
      // Root's adoption for this parent is T3's own lookup: a closure that leaves it out, or pins
      // another document, would drop the holds it carries.
      const adoptions = yield* adoptedCriteriaOf({
        root: authority.criteriaRoot,
        issue,
        factoryId: configuration.factoryId,
        itemKey: candidate.itemKey,
      });
      if ("unread" in adoptions) {
        return wait(
          `T3 could not read Root's adopted criteria for #${issue} under ${authority.criteriaRoot}: ${adoptions.unread}`,
          "T3",
          "read the criteria root back",
          "the criteria root reads whole",
        );
      }
      if (adoptions.found.length > 1) {
        return wait(
          `#${issue} has ${adoptions.found.length} Root-adopted criteria documents under ${authority.criteriaRoot}`,
          "Root coordinator",
          `keep exactly one factory-parent-criteria/1 document for #${issue} there`,
          "one adopted document",
        );
      }
      const pinnedAdoption =
        given.adopted === undefined
          ? undefined
          : yield* fs
              .realPath(path.resolve(given.adopted.root, given.adopted.path))
              .pipe(Effect.option, Effect.map(Option.getOrUndefined));
      const sameFile = (left: string | undefined, right: string | undefined) =>
        path.sep === "\\" ? left?.toLowerCase() === right?.toLowerCase() : left === right;
      if (!sameFile(pinnedAdoption, adoptions.found[0])) {
        return wait(
          adoptions.found[0] === undefined
            ? `the prepared closure pins adopted criteria ${given.adopted?.path} that are not #${issue}'s`
            : `the prepared closure does not carry #${issue}'s adopted criteria ${path.relative(authority.criteriaRoot, adoptions.found[0])}`,
          "project policy",
          `prepare #${issue} with exactly its adopted criteria and pin them`,
          "a prepared closure carrying them",
        );
      }
      // The latest verified proposal on the current text, under the current policy, is its basis.
      const proposalOutcome = parentOutcomes.findLast(
        (outcome) =>
          outcome.stage === "triage" &&
          outcome.state === "verified" &&
          outcome.report.outcome === "criteria_proposed" &&
          outcome.report.criteria?.basis.itemVersion === candidate.observation.itemVersion &&
          outcome.report.criteria.basis.bodySha256 === bodySha256 &&
          outcome.policyRevision !== undefined &&
          policyIdentityOf(outcome.policyRevision) ===
            policyIdentityOf(configuration.policyRevision),
      );
      const proposal = proposalOutcome?.report.criteria;
      if (proposal === undefined || proposalOutcome === undefined) {
        return wait(
          `#${issue} has no verified criteria proposal for its current text (item version ${candidate.observation.itemVersion}) under the current policy`,
          "T3 (preparation)",
          "triage the parent on its current text",
          "a verified criteria_proposed for that text",
        );
      }
      const children = yield* membership;
      if (children.childrenUnread !== undefined) {
        return wait(
          `its children are unread: ${children.childrenUnread.reason}`,
          "T3",
          "read the parent's whole sub-issue membership",
          "the membership reads whole",
        );
      }
      const problems = preparedCriteriaProblems({
        document,
        issue,
        repository: candidate.subject.repository,
        body: candidate.issue.body,
        comments: candidate.issue.comments,
        children: children.children ?? [],
        adopted: adopted === undefined ? undefined : Option.getOrUndefined(adopted),
        proposal,
      });
      criteria = problems.length === 0 ? decodeCriteria(given.bytes) : Option.none();
      if (Option.isNone(criteria)) {
        return wait(
          `the prepared criteria do not match T3's reads: ${problems[0] ?? "they do not decode"}`,
          "project policy",
          "prepare the parent's criteria again from the current facts",
          "prepared criteria that match the parent's current text, membership and adoption",
        );
      }
      prepared = given.bytes;
      preparedBasis = {
        configurationRevision: configuration.revision,
        policyRevision: configuration.policyRevision,
        itemVersion: candidate.observation.itemVersion,
        bodySha256,
        proposalOutcomeId: proposalOutcome.outcomeId,
      };
    }
    if (authority.close === "owner") {
      const decided = (yield* outcomeStore.reservedDecisions(configuration.factoryId)).find(
        (decision) => decision.decisionId === closure.ownerDecisionId,
      );
      if (
        decided === undefined ||
        decided.itemKey !== candidate.itemKey ||
        (decided.kind ?? "gate") !== "gate" ||
        decided.state !== "resolved" ||
        decided.resolution?.answer.trim().toLowerCase() !== "approve"
      ) {
        return wait(
          "the owner has not approved closing this parent",
          "owner",
          "answer the parent's closure question",
          "a resolved approve of that question",
        );
      }
    }
    const children = yield* membership;
    if (children.childrenUnread !== undefined) {
      return wait(
        `its children are unread: ${children.childrenUnread.reason}`,
        "T3",
        "read the parent's whole sub-issue membership",
        "the membership reads whole",
      );
    }
    yield* policyBlockers(reads, {
      factoryId: configuration.factoryId,
      repository: candidate.subject.repository,
      issue: candidate.issue,
      read: records,
    });
    // Evidence an adopted clause names is judged from T3's own records of it, like a child's.
    for (const clause of criteria.value.clauses) {
      for (const evidence of clause.evidence ?? []) {
        const own = `github:${candidate.subject.repository}#`;
        const number = evidence.itemKey.slice(own.length);
        if (!evidence.itemKey.startsWith(own) || !/^\d+$/.test(number)) continue;
        const itemKey = FactoryItemKeyFor({
          repository: candidate.subject.repository,
          issueNumber: Number(number),
        });
        if (records.has(itemKey)) continue;
        const events = yield* outcomeStore.itemEvents({
          factoryId: configuration.factoryId,
          itemKey,
        });
        if (events.length > 0)
          yield* policyItemFacts(reads, configuration.factoryId, itemKey, records);
      }
    }
    const clauses = reconcileCriteria({
      criteria: criteria.value,
      repository: candidate.subject.repository,
      parentOutcomes,
      records,
    });
    const unmet = clauses.find(
      (clause) => clause.required && clause.status !== "satisfied" && clause.status !== "revised",
    );
    // A reserved clause waits on the actor its own hold names.
    const hold =
      unmet?.status === "reserved"
        ? criteria.value.clauses.find((clause) => clause.id === unmet.id)?.reserved
        : undefined;
    if (unmet !== undefined && hold !== undefined) {
      return wait(
        `clause ${unmet.id} is reserved (${clauses.map((clause) => `${clause.id}=${clause.status}`).join(", ")})`,
        hold.actor,
        hold.action,
        hold.resume,
      );
    }
    if (unmet !== undefined) {
      return wait(
        `clause ${unmet.id} is ${unmet.status}${unmet.why === undefined ? "" : `: ${unmet.why}`} (${clauses.map((clause) => `${clause.id}=${clause.status}`).join(", ")})`,
        "owner or Root coordinator",
        `prove clause ${unmet.id} with landed work, or revise the criteria`,
        "every required clause is proved",
      );
    }
    if (prepared !== undefined && preparedBasis !== undefined) {
      const kept = yield* preparedPublication.keep({
        factoryId: configuration.factoryId,
        itemKey: candidate.itemKey,
        issue,
        root: authority.criteriaRoot,
        digest: criteriaSha256,
        bytes: prepared,
        basis: preparedBasis,
      });
      if (kept !== undefined) {
        return wait(
          `T3 could not keep the prepared criteria under ${authority.criteriaRoot}: ${kept}`,
          "T3",
          "write the prepared criteria under the criteria root",
          "they are kept as prepared",
        );
      }
    }
    return yield* nativeStages.planParentClosure({
      configuration,
      itemKey: candidate.itemKey,
      criteriaSha256,
      reopenOf: candidate.stage.type === "implement" ? candidate.stage.reopenOf : undefined,
      evidence: clauses.flatMap((clause) =>
        clause.landed.map(
          (landed) =>
            `Clause ${clause.id} (${landed.scope}): ${landed.itemKey} landed ${landed.commit} (tree ${landed.tree}) by ${landed.operationId}, reviewed head ${landed.reviewedHead}.`,
        ),
      ),
      // The parent authority this closure was judged under must still be current at its commit.
      fence: { ...fence, configurationRevision: configuration.revision },
    });
  });

  const act = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
    candidate: Candidate,
    decision: FactoryPolicyDecision,
    fence: Omit<CollectedBasis, "issueText">,
    adopted: unknown,
  ): Effect.fn.Return<
    {
      readonly disposition: FactoryItemDisposition;
      readonly detail?: string;
      readonly reasonClass?: string;
      readonly admission?: FactoryAdmissionResult;
      /** The decision as T3 acted on it, when that differs from the policy's, e.g. a bound grant. */
      readonly effective?: FactoryPolicyDecision;
      readonly issue?: { readonly kind: string; readonly detail: string };
    },
    | FactoryLifecycleError
    | FactoryStore.FactoryStoreError
    | FactoryOutcomeStore.FactoryOutcomeStoreError
    | Effect.Error<ReturnType<typeof recordDecisionOnTracker>>
    | Effect.Error<ReturnType<typeof nativeStages.planIntegration>>
    | Effect.Error<ReturnType<typeof nativeStages.planTicket>>
  > {
    const { itemKey, stage, subject } = candidate;
    const factoryId = configuration.factoryId;
    const collected = {
      ...fence,
      issueText: { title: candidate.issue.title, body: candidate.issue.body },
    };
    const custody = { factoryId, ...fence };
    if (decision === undefined) return { disposition: "nothing_proposed" };
    if (isNothingProposed(decision)) {
      return {
        disposition: "nothing_proposed",
        detail: decision.reason,
        ...(decision.class === undefined ? {} : { reasonClass: decision.class }),
      };
    }
    if (isPolicyFailure(decision)) return { disposition: "policy_failed", detail: decision.reason };
    if (isSpawnRequest(decision)) {
      if (stage.type === "integrate" || stage.type === "close") {
        return { disposition: "stage_mismatch" };
      }
      if (configuration.claim === undefined) {
        return { disposition: "blocked", detail: "the item has no tracker to open an issue on" };
      }
      const plan = yield* nativeStages.planTicket({
        configuration,
        itemKey,
        stage,
        subject,
        issueOpen: candidate.issue.state === "open",
        ticket: decision.ticket,
        fence: custody,
      });
      if (plan.type === "custody_changed") return { disposition: "refused:custody_changed" };
      if (plan.type === "issue") {
        return {
          disposition: "blocked",
          detail: plan.issue,
          issue: { kind: "spawn", detail: plan.issue },
        };
      }
      return { disposition: "spawning", detail: decision.reason };
    }
    const reserve = Effect.fnUntraced(function* (
      kind: "gate" | "grant",
      reason: string,
      evidenceDigest: string,
      question?: string,
    ) {
      // A grant request after an earlier grant for the same subject was spent or revoked is a new
      // request, not the one the owner already answered.
      const authorized = kind === "grant" ? yield* authorizedGrants(factoryId) : new Set<string>();
      const issued =
        kind === "grant"
          ? (yield* store.listGrants(factoryId)).filter(
              (grant) =>
                authorized.has(grant.grantId) &&
                grant.itemKey === itemKey &&
                grant.stage === stage.type &&
                grant.evidenceDigest === evidenceDigest,
            ).length
          : 0;
      // A question already asked is that decision in any state: pending, answered or withdrawn.
      // A gate asked on the same evidence before questions had names is named once, in place.
      if (question !== undefined && kind === "gate") {
        const gates = (yield* outcomeStore.reservedDecisions(factoryId)).filter(
          (decision) =>
            decision.itemKey === itemKey &&
            decision.stage === stage.type &&
            (decision.kind ?? "gate") === "gate",
        );
        const named = gates.find(
          (decision) =>
            decision.question === question ||
            decision.decisionId ===
              gateDecisionId({ factoryId, itemKey, stage: stage.type, question }),
        );
        const unnamed =
          named === undefined
            ? gates.find(
                (decision) =>
                  decision.question === undefined &&
                  decision.decisionId ===
                    evidenceGateId({ factoryId, itemKey, stage: stage.type, evidenceDigest }),
              )
            : undefined;
        if (unnamed !== undefined) {
          yield* outcomeStore.nameDecision({ decisionId: unnamed.decisionId, question });
        }
        const existing = named ?? unnamed;
        if (existing !== undefined) {
          if (existing.state === "pending" && configuration.claim !== undefined) {
            yield* recordDecisionOnTracker(configuration, subject, existing);
          }
          return;
        }
      }
      const reservedDecision = yield* outcomeStore.reserveDecision({
        // Its exact evidence identifies it, or the question the policy names: the same question
        // reworded is not asked again.
        decisionId:
          question !== undefined && kind === "gate"
            ? gateDecisionId({ factoryId, itemKey, stage: stage.type, question })
            : sha256(
                [factoryId, itemKey, stage.type, kind, evidenceDigest, String(issued)].join("\n"),
              ).slice(0, 40),
        factoryId,
        itemKey,
        stage: stage.type,
        reason,
        evidenceDigest,
        kind,
        ...(question !== undefined && kind === "gate" ? { question } : {}),
      });
      if (reservedDecision.state === "pending" && configuration.claim !== undefined) {
        yield* recordDecisionOnTracker(configuration, subject, reservedDecision);
      }
    });
    if (isReservationRequest(decision)) {
      yield* reserve("gate", decision.reason, decision.evidenceDigest, decision.question);
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
    if (isProceed(decision) && decision.parentClosure !== undefined) {
      const plan = yield* closeParent(configuration, candidate, decision.parentClosure, custody);
      if ("wait" in plan) {
        return { disposition: "nothing_proposed", detail: plan.wait, reasonClass: "parent" };
      }
      if (plan.type === "custody_changed") return { disposition: "refused:custody_changed" };
      if (plan.type === "issue") {
        return {
          disposition: "blocked",
          detail: plan.issue,
          issue: { kind: "close", detail: plan.issue },
        };
      }
      return { disposition: "closing" };
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
              fence: custody,
            })
          : yield* nativeStages.planClosure({ configuration, itemKey, stage, fence: custody });
      if (plan.type === "custody_changed") return { disposition: "refused:custody_changed" };
      if (plan.type === "issue") {
        return {
          disposition: "blocked",
          detail: plan.issue,
          issue: { kind: stage.type, detail: plan.issue },
        };
      }
      // An effect still waiting says on what (checks, approvals, a lost answer), never silently.
      const operation =
        plan.type === "in_flight"
          ? yield* operationStore.get(plan.operationId)
          : Option.none<FactoryOperationStore.FactoryOperation>();
      const waiting =
        Option.isSome(operation) && operation.value.state === "intended"
          ? operation.value.lastError
          : undefined;
      return {
        disposition: stage.type === "integrate" ? "integrating" : "closing",
        ...(waiting === undefined ? {} : { detail: `waiting: ${waiting.slice(0, 500)}` }),
      };
    }
    // Triage decomposes an item before its first build, on the inputs the policy was shown.
    if (decision.taskKind === "triage") {
      if (stage.type !== "implement") return { disposition: "stage_mismatch" };
      const outcomes = yield* policyOutcomes({ outcomeStore, store }, candidate.events);
      // A parent's criteria proposal still quoting its current text and comments is not paid for
      // again: a comment no clause cites changes the triage key, not the preparation.
      const preparedOn = outcomes.findLast(
        (outcome) =>
          outcome.state === "verified" &&
          outcome.report.outcome === "criteria_proposed" &&
          outcome.report.criteria?.basis.itemVersion === candidate.observation.itemVersion &&
          outcome.policyRevision !== undefined &&
          policyIdentityOf(outcome.policyRevision) ===
            policyIdentityOf(configuration.policyRevision),
      );
      if (
        (candidate.issue.subIssueCount ?? 0) > 0 &&
        preparedOn?.report.criteria !== undefined &&
        criteriaProposalProblems({
          proposal: preparedOn.report.criteria,
          issue: subject.issueNumber,
          body: candidate.issue.body,
          comments: candidate.issue.comments,
          adopted,
        }).length === 0
      ) {
        return {
          disposition: "nothing_proposed",
          detail: `#${subject.issueNumber} is already prepared on its current text by ${preparedOn.outcomeId}`,
          reasonClass: "prepared",
        };
      }
      const triage = yield* triageDecisionFor(configuration, candidate, outcomes);
      if (triage === undefined || "unread" in triage) {
        const unread = triage?.unread;
        return {
          disposition: "nothing_proposed",
          detail: waitText({
            issue: subject.issueNumber,
            what: unread?.what ?? "its last preparation failed, and it cannot be read back now",
            actor: unread?.actor ?? "T3 (preparation)",
            action: unread?.action ?? "read the failed preparation back again",
            consequence: "no new preparation starts on facts T3 cannot read",
            resume: "those facts read back, or the item's text, evidence or policy change",
          }),
          reasonClass: "waiting",
        };
      }
      for (const key of triage.keys) {
        if (key === triage.key) continue;
        const earlier = yield* store.findAdmission({ factoryId, decisionKey: key });
        if (Option.isSome(earlier)) {
          return {
            admission: { type: "existing", reservation: earlier.value },
            disposition: "existing",
          };
        }
      }
      // A preparation that failed in its environment runs again only on an execution other than the
      // one it failed on, once per execution: the same one would fail the same way.
      let basis = triage.basis;
      if (triage.failed?.report.failureClass === "environment") {
        const chosen =
          decision.execution === undefined
            ? FactoryStore.executionFor(configuration, "triage")
            : configuration.executionChoices?.[decision.execution];
        if (chosen !== undefined) {
          const ran = yield* executionRanBy(triage.failed);
          const now = executionIdentity(chosen);
          if (ran === undefined || ran === now) {
            return {
              disposition: "nothing_proposed",
              detail: waitText({
                issue: subject.issueNumber,
                what:
                  ran === undefined
                    ? "its last preparation failed in its environment, and T3 cannot read back the execution it ran on"
                    : "its last preparation failed in its environment, and the execution it would prepare on is the one it failed on",
                actor: "the operator of that execution (its provider credential, model or runtime)",
                action:
                  "repair that execution and change its configuration (model, options, runtime or interaction mode); a credential repair alone is not visible to T3",
                consequence: "no preparation starts on the environment it failed in",
                resume:
                  "the execution the preparation is decided on differs from the one it failed on",
              }),
              reasonClass: "waiting",
            };
          }
          basis = `${triage.basis}:env:${now}`;
        }
      }
      const admission = yield* admit(
        {
          ...decision,
          stage: { type: "triage", basis },
          ...(candidate.owner === undefined ? {} : { continues: candidate.owner.reservationId }),
        },
        collected,
      );
      return {
        admission,
        disposition: admission.type === "refused" ? `refused:${admission.reason}` : admission.type,
      };
    }
    // The policy decides the brief; the lifecycle decides which stage it is for.
    if (isFactoryStage(decision.taskKind)) {
      if (decision.taskKind !== stage.type || !AGENT_STAGES.has(stage.type)) {
        return { disposition: "stage_mismatch" };
      }
    }
    if (decision.prepared !== undefined) {
      const stale = yield* preparedStale(configuration, candidate, decision, decision.prepared);
      if (stale !== undefined) {
        return {
          disposition: "nothing_proposed",
          detail: waitText({
            issue: subject.issueNumber,
            what: `prepared unit is stale: ${stale.what}`,
            actor: stale.actor,
            action: stale.action,
            consequence: "the prepared build does not start; the proposal stays as recorded",
            resume:
              "a verified proposal for the item's current inputs, or the facts named here change",
          }),
          reasonClass: "prepared_stale",
        };
      }
    }
    let bound:
      | { readonly basis: string; readonly note: string; readonly digest: string }
      | undefined;
    if (decision.verificationBinding !== undefined) {
      const checked = yield* deriveVerificationBinding(
        {
          fs,
          path,
          insideRoot: insideArtifactRoot,
          reads: { outcomeStore, store, operations: operationStore },
        },
        {
          configuration,
          candidate,
          pointer: decision.verificationBinding,
          execution: decision.execution,
          workspace: decision.workspaceStrategy,
          itemVersion: candidate.observation.itemVersion,
          record: "write",
        },
      );
      if ("wait" in checked) {
        return {
          disposition: "nothing_proposed",
          detail: checked.wait,
          reasonClass: checked.reasonClass,
        };
      }
      bound = checked;
    }
    // A no-edit unit starts exactly at its candidate and is bound to its exact requirement.
    let noEdit: { readonly basis: string; readonly note: string } | undefined;
    if (decision.noEdit !== undefined) {
      const requirement = decision.noEdit;
      const workspace = decision.workspaceStrategy;
      const repair =
        stage.type === "rework"
          ? yield* noEditRepairProblem(candidate, stage, requirement, decision.execution)
          : undefined;
      const refused =
        stage.type !== "implement" && stage.type !== "rework"
          ? `a no-edit unit was proposed at the item's ${stage.type} stage`
          : repair !== undefined
            ? `a no-edit unit was proposed at the item's rework stage, but ${repair}`
            : workspace?.type !== "worktree" ||
                workspace.baseRef !== requirement.candidate ||
                workspace.startFromOrigin === true
              ? `the no-edit unit would not start exactly at its candidate ${requirement.candidate}`
              : requirement.execution !== undefined &&
                  requirement.execution !== null &&
                  requirement.execution !== decision.execution
                ? `the no-edit unit names execution ${requirement.execution}, not the one admitted`
                : (requirement.itemKey !== undefined && requirement.itemKey !== itemKey) ||
                    (requirement.itemVersion !== undefined &&
                      requirement.itemVersion !== candidate.observation.itemVersion)
                  ? "the no-edit unit is bound to another item or item version"
                  : undefined;
      if (refused !== undefined) {
        return {
          disposition: "nothing_proposed",
          detail: waitText({
            issue: subject.issueNumber,
            what: refused,
            actor: "project policy",
            action:
              "admit the no-edit unit at its candidate with its execution, at its first build or at the rework of an execution_binding_repair of its own failure",
            consequence: "the no-edit unit does not start",
            resume: "an admission that matches its adopted requirement",
          }),
          reasonClass: "waiting",
        };
      }
      noEdit = {
        basis: noEditBasis(requirement),
        note: [
          `This is a no-edit unit: verify commit ${requirement.candidate} as it is and change no file.`,
          "Run each required check exactly, writing each one's log under the artifact root:",
          ...requirement.checks.map((check) => `- ${check}`),
          `Then write a receipt JSON under ${configuration.artifactRoot}: {"schema":"factory-noedit-receipt/1","requirement":<the requirement below, exactly>,"itemKey":"${itemKey}","itemVersion":"${candidate.observation.itemVersion}","results":[{"check":<check>,"exitCode":<its exit code>,"log":{"path":<its log>,"sha256":<its sha256>}}]}.`,
          `Report implemented with subject.baseCommit and subject.headCommit both ${requirement.candidate}, listing the receipt and every log in artifacts with their sha256.`,
          `Requirement: ${canonical(requirement)}`,
        ].join("\n"),
      };
    }
    let grant: FactoryAdmissionRequest["grant"];
    if (decision.requiresGrant !== undefined) {
      // A grant answers one exact binding: the same evidence text for another binding is another
      // request, so leftover units of an earlier answer never fund it.
      const required =
        bound === undefined
          ? decision.requiresGrant
          : {
              reason: `${decision.requiresGrant.reason} (verification binding ${bound.digest.slice(0, 16)})`,
              evidenceDigest: sha256(
                `${decision.requiresGrant.evidenceDigest}\nbinding:${bound.digest}`,
              ),
            };
      const authorized = yield* authorizedGrants(factoryId);
      const available = (yield* store.listGrants(factoryId)).find(
        (candidateGrant) =>
          authorized.has(candidateGrant.grantId) &&
          candidateGrant.itemKey === itemKey &&
          candidateGrant.stage === stage.type &&
          candidateGrant.evidenceDigest === required.evidenceDigest &&
          candidateGrant.state === "active" &&
          candidateGrant.remaining > 0,
      );
      if (available === undefined) {
        yield* reserve("grant", required.reason, required.evidenceDigest);
        return {
          disposition: "awaiting_grant",
          effective: { ...decision, requiresGrant: required },
        };
      }
      grant = {
        grantId: available.grantId,
        stage: stage.type,
        evidenceDigest: required.evidenceDigest,
      };
    }
    // The binding and its output root are part of the decision: a changed one is another decision.
    const notes = [bound?.note, noEdit?.note].filter((note) => note !== undefined);
    const text = [decision.packet.text, ...notes].join("\n\n");
    const packet =
      notes.length === 0 ? decision.packet : { ...decision.packet, text, sha256: sha256(text) };
    const admission = yield* admit(
      isFactoryStage(decision.taskKind)
        ? {
            ...decision,
            packet,
            stage: {
              type: stage.type,
              // The binding's output root stays last: the store reads it at the end.
              basis: `${stageBasis(stage)}${resourceBasis(decision.resources)}${choiceBasis(decision)}${noEdit?.basis ?? ""}${bound?.basis ?? ""}`,
            },
            ...(candidate.owner === undefined ? {} : { continues: candidate.owner.reservationId }),
            ...(grant === undefined ? {} : { grant }),
          }
        : decision,
      collected,
    );
    // A resource another reservation holds is a wait that names it and its holder.
    if (admission.type === "refused" && admission.reason === "resource_held") {
      const wanted = new Set(decision.resources ?? []);
      const holder = (yield* store.listReservations(factoryId)).find(
        (held) =>
          held.state === "held" &&
          held.origin === "admitted" &&
          (held.resources ?? []).some((resource) => wanted.has(resource)),
      );
      const resource =
        holder?.origin === "admitted"
          ? (holder.resources ?? []).find((each) => wanted.has(each))
          : undefined;
      return {
        disposition: "nothing_proposed",
        detail: waitText({
          issue: subject.issueNumber,
          what: `resource ${resource ?? [...wanted].join(", ")} is held by ${holder?.itemKey ?? "another reservation"}`,
          actor: "T3",
          action: "admit the work once that reservation releases the resource",
          consequence: "the work does not start while the resource is held",
          resume: "the holder's reservation is released",
        }),
        reasonClass: "resource_held",
      };
    }
    // An unchanged basis is never decided twice; when its last attempt failed, say how, so the
    // item does not wait silently on a repeat of the same failure.
    const last = candidate.events.at(-1);
    const repeated =
      admission.type === "existing" &&
      last?.type === "outcome" &&
      last.kind === "failed" &&
      last.stage === stage.type
        ? yield* outcomeStore.get(last.outcomeId)
        : Option.none<FactoryOutcomeStore.FactoryOutcome>();
    return {
      admission,
      disposition: admission.type === "refused" ? `refused:${admission.reason}` : admission.type,
      ...(Option.isSome(repeated)
        ? {
            detail: `already decided on this basis; its last ${stage.type} failed: ${(repeated.value.report.failure ?? repeated.value.report.summary).slice(0, 500)}`,
          }
        : {}),
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
    // Subjects this owner's passes could not read; a later owner's pass reads them again.
    const unread = new Set<string>();
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
      const dirty = (yield* sql<{
        readonly item_key: string;
        readonly repository: string;
        readonly issue_number: number;
        readonly requested: number;
      }>`
        SELECT item_key, repository, issue_number, requested FROM factory_collection_subjects
        WHERE factory_id = ${factoryId} AND requested > completed
        ORDER BY item_key
      `).filter((row) => !unread.has(row.item_key));
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
      const pass = yield* collectPass(
        factoryId,
        configuration.value,
        configuration.value.claim,
        dirty.map((row) => ({ repository: row.repository, issueNumber: row.issue_number })),
        proposer,
      );
      admissions.push(...pass.admissions);
      for (const itemKey of pass.unread) unread.add(itemKey);
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
            if (unread.has(row.item_key)) continue;
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

  // Whether a stored subject request still waits for a pass to read it.
  const hasPendingSubjects = (factoryId: FactoryId) =>
    sql<{ readonly pending: number }>`
      SELECT 1 AS pending FROM factory_collection_subjects
      WHERE factory_id = ${factoryId} AND requested > completed
      LIMIT 1
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orElseSucceed(() => false),
    );

  // A failure before any pass, such as a listing or identity read GitHub did not answer, read no
  // stored request, so none of them asked for the retry a failed read asks for. Ask for it here,
  // on the same one-minute pace; a request already read to its end is not pending.
  const retryPendingSubjects = Effect.fn("FactoryLifecycle.retryPendingSubjects")(function* (
    factoryId: FactoryId,
  ) {
    if (yield* hasPendingSubjects(factoryId)) {
      yield* Ref.update(retryWanted, (current) => new Set(current).add(factoryId));
    }
  });

  const enter = Effect.fn("FactoryLifecycle.enter")(
    function* (input: FactoryEnterInput) {
      const itemKey = FactoryItemKeyFor(input);
      const refused = (reason: string, nextAction: string): FactoryEnterResult => ({
        itemKey,
        status: "refused",
        reason,
        nextAction,
      });
      const configuration = yield* store.getConfiguration(input.factoryId);
      if (Option.isNone(configuration)) {
        return refused(
          `${input.factoryId} is not a configured factory.`,
          "Name a configured factory; t3_factory_state reads one.",
        );
      }
      const repositories = configuration.value.claim?.repositories ?? [];
      if (!repositories.includes(input.repository)) {
        return refused(
          repositories.length === 0
            ? `${input.factoryId} collects no tracker repositories.`
            : `${input.factoryId} collects ${repositories.join(", ")}, not ${input.repository}.`,
          "Enter the issue into the factory that collects its repository, or ask that factory's owner to add it.",
        );
      }
      const nativeState = Effect.gen(function* () {
        const held = (yield* store.listReservations(input.factoryId)).find(
          (reservation) =>
            reservation.itemKey === itemKey &&
            reservation.state === "held" &&
            FactoryStore.isNativeReservation(reservation),
        );
        const pending = (yield* outcomeStore.reservedDecisions(input.factoryId)).find(
          (decision) => decision.itemKey === itemKey && decision.state === "pending",
        );
        return { held, pending };
      });
      if (!configuration.value.enabled) {
        // No read and no request: a pass on it could still ask the policy for gates or tickets.
        const { held, pending } = yield* nativeState;
        return held === undefined && pending === undefined
          ? refused(
              "The factory is paused: it finishes what it owns and starts nothing new.",
              "The factory owner enables it, then enters the issue again.",
            )
          : entryView({
              itemKey,
              startedReservationIds: new Set(),
              held,
              pending,
              record: undefined,
            });
      }
      const collected = yield* collect({
        factoryId: input.factoryId,
        trigger: "tracker_event",
        subjects: [{ repository: input.repository, issueNumber: input.issueNumber }],
      }).pipe(Effect.tapCause(() => retryPendingSubjects(input.factoryId)));
      const started = new Set(
        collected.type === "collected"
          ? collected.admissions.flatMap((admission) =>
              admission.type === "admitted" && admission.reservation.itemKey === itemKey
                ? [admission.reservation.reservationId]
                : [],
            )
          : [],
      );
      const { held, pending } = yield* nativeState;
      return entryView({
        itemKey,
        startedReservationIds: started,
        held,
        pending,
        record:
          collected.type === "collected"
            ? (yield* Ref.get(lastPass)).get(input.factoryId)?.get(itemKey)
            : undefined,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isLifecycleError(cause)
            ? cause
            : new FactoryLifecycleError({ operation: "enter", factoryId: input.factoryId, cause }),
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
        Effect.gen(function* () {
          yield* Effect.logWarning("Factory reconciliation failed; its triggers stay pending", {
            factoryId,
            trigger,
            cause: Cause.pretty(cause),
          });
          yield* retryPendingSubjects(factoryId);
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

  /**
   * The grants that authorize starts: each one an explicit grant that settled its request issued and
   * named. Any other grant stays in the record, unspent and uncounted, so its answer stands and the
   * request is not asked again.
   */
  const authorizedGrants = Effect.fnUntraced(function* (factoryId: FactoryId) {
    return new Set(
      (yield* outcomeStore.reservedDecisions(factoryId)).flatMap((answered) =>
        answered.state === "resolved" &&
        answered.resolution?.grantId !== undefined &&
        isGrantAnswer(answered.resolution.answer)
          ? [answered.resolution.grantId]
          : [],
      ),
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
      const units = decision.kind === "grant" ? input.grantUnits : undefined;
      // Units come only with a grant: a decline or anything else sent with them settles nothing.
      if (units !== undefined && !isGrantAnswer(input.answer)) return false;
      const grantUnits = units !== undefined && units > 0 ? units : undefined;
      // Only the answer that settles the decision issues its grant, in the same transaction: another
      // answer that read it as pending too leaves nothing behind. A grant answers exactly the
      // request it was asked for: this item, stage and evidence.
      const resolved = yield* sql.withTransaction(
        Effect.gen(function* () {
          const settled = yield* outcomeStore.resolveDecision({
            decisionId: input.decisionId,
            answer: input.answer,
            by: input.by,
            ...(grantUnits === undefined
              ? {}
              : { grantId: FactoryStore.grantIdOf(decision.decisionId) }),
          });
          if (settled && grantUnits !== undefined) {
            yield* store.issueGrant({
              factoryId: input.factoryId,
              itemKey: decision.itemKey,
              stage: decision.stage,
              evidenceDigest: decision.evidenceDigest,
              units: grantUnits,
              decisionId: decision.decisionId,
              by: input.by,
            });
          }
          return settled;
        }),
      );
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
    if (typeof value !== "string") return undefined;
    // Only a choice the card offers: never a name every object inherits, such as "constructor".
    const key = value.trim().toLowerCase();
    return Object.hasOwn(choices, key) ? choices[key] : undefined;
  };
  const cardText = (answers: Readonly<Record<string, unknown>>, questionId: string) => {
    const raw = answers[questionId];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? value.trim() : "";
  };
  // A decision takes its own choices, by answer or by label; anything else is no answer.
  const decisionCardChoices = (decision: FactoryOutcomeStore.ReservedDecision) =>
    Object.fromEntries(
      factoryDecisionChoices(decision).flatMap((choice) => [
        [choice.answer, choice.answer],
        [choice.label.toLowerCase(), choice.answer],
      ]),
    );
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
      options: factoryDecisionChoices(decision).map((choice) => ({
        label: choice.label,
        description: choice.description,
        value: choice.answer,
      })),
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
          description:
            result.outcomeStage === "review"
              ? "Review the same head again, with your reason."
              : "Send the item back to correction with your reason.",
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
    const settle = (requestId: RuntimeRequestId, status: "resolved" | "cancelled") =>
      orchestrator.dispatch({
        type: "factory_card.resolve",
        commandId: CommandId.make(`factory-card-resolve:${requestId}`),
        threadId: ownerThreadId,
        requestId,
        status,
      });
    // An unencoded card from an earlier build is withdrawn even while its subject stands: it is
    // asked again under an id every guard reads.
    for (const card of cards) {
      if (card.request.status !== "pending") continue;
      if (!card.legacy && wanted.has(`${card.kind}:${card.subjectId}`)) continue;
      const answered = decisions.some(
        (decision) => decision.decisionId === card.subjectId && decision.state === "resolved",
      );
      yield* settle(card.request.id, answered ? "resolved" : "cancelled");
    }
    for (const request of projection.runtimeRequests) {
      if (
        request.status === "pending" &&
        request.id.startsWith(`factory-card:${factoryId}:`) &&
        parseFactoryCardRequestId(request.id) === undefined
      ) {
        yield* settle(request.id, "cancelled");
      }
    }
    for (const [key, want] of wanted) {
      const prior = cards.filter((card) => `${card.kind}:${card.subjectId}` === key);
      // No build's guard read an unencoded card, so an answer on one reached the owner's thread as
      // a prompt, never the factory: it stays as history and answers nothing.
      if (
        prior.some(
          (card) =>
            !card.legacy &&
            (card.request.status === "pending" || card.request.status === "resolved"),
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
      if (card.legacy) {
        yield* orchestrator.dispatch({
          type: "factory_card.resolve",
          commandId: CommandId.make(`factory-card-resolve:${input.requestId}`),
          threadId: input.threadId,
          requestId: request.id,
          status: "cancelled",
        });
        return yield* refuse(
          "This decision was raised by an earlier version of T3 and can't be answered here. It is withdrawn, and asked again if it still stands.",
        );
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
        const choice = cardChoice(input.answers, "decision", decisionCardChoices(decision));
        if (choice === undefined) {
          return yield* refuse(
            `Choose ${factoryDecisionChoices(decision)
              .map((offered) => offered.label)
              .join(" or ")}.`,
          );
        }
        const resolved = yield* resolveReservedDecision({
          factoryId,
          decisionId: decision.decisionId,
          by: input.by,
          ...(choice === "decline" || choice === "abandon"
            ? { answer: choice }
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
    enter,
    reconcile,
    drive,
    configure,
    installConfiguration,
    switchProvider: Effect.fn("FactoryLifecycle.switchProvider")(function (input, providers) {
      return switchProvider(input, providers).pipe(
        Effect.mapError(
          (cause) =>
            new FactoryLifecycleError({
              operation: "switch-provider",
              factoryId: input.factoryId,
              cause,
            }),
        ),
      );
    }),
    observeClaims,
    beginCollection,
    recordItemObservation,
    admit,
    readState,
    agentCeiling,
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
    disposeNeverStarted: Effect.fn("FactoryLifecycle.disposeNeverStarted")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly reservationId: FactoryReservationId;
        readonly by: string;
        readonly reason: string;
        readonly expectDigest?: string | undefined;
      }) {
        const result = yield* sql.withTransaction(
          Effect.gen(function* () {
            const found = yield* store.getReservation(input.reservationId);
            if (Option.isNone(found) || found.value.factoryId !== input.factoryId) {
              return { disposed: false, refusals: ["unknown_reservation"] };
            }
            const reservation = found.value;
            if (reservation.origin !== "admitted" || reservation.state !== "held") {
              return { disposed: false, refusals: ["not_held_admitted"] };
            }
            if (reservation.neverStartedAttestation !== undefined) {
              return { disposed: false, refusals: ["already_attested"] };
            }
            const facts = yield* readNeverStartedEvidence(
              reservation,
              yield* custodyOf(reservation, { judgeDeleted: true }),
            ).pipe(Effect.provide(custodyContext));
            const evidence = canonical(facts);
            const read = { evidence, evidenceDigest: sha256(evidence) };
            const refusals = neverStartedRefusals(facts);
            if (refusals.length > 0 || input.expectDigest === undefined) {
              return { disposed: false, refusals, ...read };
            }
            if (input.expectDigest !== read.evidenceDigest) {
              return { disposed: false, refusals: ["evidence_changed"], ...read };
            }
            const attestation = {
              by: input.by,
              reason: input.reason,
              evidenceDigest: read.evidenceDigest,
            };
            if (!(yield* outcomeOps.disposeAttested(reservation, attestation))) {
              return { disposed: false, refusals: ["existing_outcome_or_owed_work"], ...read };
            }
            // The refusals passed an open obligation only once its owner was lost and every
            // container of its run ended: the disposition takes it over and settles it.
            const disposer = PreparationOwnerId.make(`owner-disposition:${read.evidenceDigest}`);
            for (const run of facts.runs) {
              if (typeof run.obligation !== "object" || run.obligation.state !== "open") continue;
              const ended = run.generations.map((generation) => generation.generationId);
              const settled =
                (yield* store.reownWorkspaceObligation({
                  runId: run.runId,
                  fromOwnerId: run.obligation.ownerId,
                  toOwnerId: disposer,
                  endedGenerations: ended,
                })) &&
                (yield* store.settleWorkspaceObligation({
                  runId: run.runId,
                  ownerId: disposer,
                  scope: { type: "contained", generationId: ended.at(-1)! },
                }));
              if (!settled) {
                return yield* Effect.die(
                  new Error("Disposition obligation changed during transaction"),
                );
              }
            }
            const attested = yield* store.attestNeverStarted({
              reservationId: reservation.reservationId,
              expected: reservation,
              ...attestation,
              evidence: read.evidence,
            });
            if (
              !attested ||
              !(yield* store.releaseReservation(reservation.reservationId, "owner_disposition"))
            ) {
              return yield* Effect.die(
                new Error("Disposition reservation changed during transaction"),
              );
            }
            return { disposed: true, refusals: [], ...read };
          }),
        );
        if (result.disposed) {
          const reservation = yield* store.getReservation(input.reservationId);
          const subject = Option.isSome(reservation)
            ? subjectOf(reservation.value.itemKey)
            : undefined;
          if (subject !== undefined) yield* requestSubjects(input.factoryId, [subject]);
          yield* Queue.offer(wakes, { factoryId: input.factoryId, trigger: "owner_decision" });
        }
        return result;
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new FactoryLifecycleError({
                operation: "dispose-never-started",
                factoryId: input.factoryId,
                cause,
              }),
          ),
        ),
    ),
    quarantine: Effect.fn("FactoryLifecycle.quarantine")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly reservationId: FactoryReservationId;
        readonly action: "enter" | "leave";
        readonly by: string;
        readonly reason: string;
        readonly expectDigest?: string | undefined;
      }) {
        const result = yield* sql.withTransaction(
          Effect.gen(function* () {
            const found = yield* store.getReservation(input.reservationId);
            if (Option.isNone(found) || found.value.factoryId !== input.factoryId) {
              return { applied: false, refusals: ["unknown_reservation"] };
            }
            const reservation = found.value;
            if (reservation.origin !== "admitted" || reservation.state !== "held") {
              return { applied: false, refusals: ["not_held_admitted"] };
            }
            const facts = yield* readQuarantineEvidence(
              reservation,
              yield* custodyOf(reservation),
              yield* outcomeStore.listForOrigin(reservation.reservationId),
            ).pipe(Effect.provide(custodyContext));
            const evidence = canonical({ action: input.action, ...facts });
            const read = { evidence, evidenceDigest: sha256(evidence) };
            const refusals =
              input.action === "enter"
                ? quarantineRefusals(facts, store.servingId)
                : facts.quarantine === null
                  ? ["not_quarantined"]
                  : [];
            if (refusals.length > 0 || input.expectDigest === undefined) {
              return { applied: false, refusals, ...read };
            }
            if (input.expectDigest !== read.evidenceDigest) {
              return { applied: false, refusals: ["evidence_changed"], ...read };
            }
            const applied = yield* store.recordQuarantine({
              reservationId: reservation.reservationId,
              expected: reservation,
              change:
                input.action === "enter"
                  ? {
                      type: "enter",
                      quarantine: {
                        by: input.by,
                        reason: input.reason,
                        evidenceDigest: read.evidenceDigest,
                        evidence: read.evidence,
                      },
                    }
                  : {
                      type: "leave",
                      by: input.by,
                      reason: input.reason,
                      evidenceDigest: read.evidenceDigest,
                    },
            });
            return applied
              ? { applied: true, refusals: [], ...read }
              : { applied: false, refusals: ["evidence_changed"], ...read };
          }),
        );
        // The capacity it held is free now, or charged again: the next pass weighs that.
        if (result.applied) {
          yield* Queue.offer(wakes, { factoryId: input.factoryId, trigger: "owner_decision" });
        }
        return result;
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new FactoryLifecycleError({
                operation: "quarantine",
                factoryId: input.factoryId,
                cause,
              }),
          ),
        ),
    ),
    historicalTermination: Effect.fn("FactoryLifecycle.historicalTermination")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly reservationId: FactoryReservationId;
        readonly action: "capture" | "verify";
        readonly operationRef: string;
        readonly by: string;
        readonly reason: string;
        readonly expectDigest?: string | undefined;
        /** The owner's acceptance of exactly the residual uncertainty; never provenance. */
        readonly acceptResidual?: ReadonlyArray<ResidualUncertainty> | undefined;
      }) {
        // Read from the OS before the transaction; never from the caller.
        const host = Option.getOrNull(yield* Effect.option((yield* HostBootReader).read));
        // From the retained source only, decoded like any untrusted value; never caller JSON.
        const retained = yield* (yield* HistoricalProvenanceSource).read({
          reservationId: input.reservationId,
          operationRef: input.operationRef,
        });
        const decoded = Option.flatMap(retained, decodeHistoricalProvenance);
        const provenance = Option.isSome(decoded)
          ? decoded.value
          : Option.isSome(retained)
            ? ("malformed" as const)
            : ("missing" as const);
        const provenanceDigest =
          typeof provenance === "string" ? null : sha256(canonical(provenance));
        const result = yield* sql.withTransaction(
          Effect.gen(function* () {
            const found = yield* store.getReservation(input.reservationId);
            if (Option.isNone(found) || found.value.factoryId !== input.factoryId) {
              return { applied: false, refusals: ["unknown_reservation"] };
            }
            const reservation = found.value;
            if (reservation.origin !== "admitted" || reservation.state !== "held") {
              return { applied: false, refusals: ["not_held_admitted"] };
            }
            const termination = yield* readTerminationEvidence(
              reservation,
              yield* custodyOf(reservation),
              yield* outcomeStore.listForOrigin(reservation.reservationId),
            ).pipe(Effect.provide(custodyContext));
            const executionDigest = sha256(canonical(termination.execution));
            const recorded = reservation.historicalTermination;
            // Where no provenance was retained, the scope an owner's residual decision would cover,
            // read from T3's own records in this transaction and shown whether or not accepted.
            const boundHost = recorded?.capture.host ?? host;
            const scoped =
              provenance === "missing" && boundHost !== null
                ? residualScopeOf(
                    yield* readResidualFacts(reservation).pipe(Effect.provide(custodyContext)),
                    {
                      reservationId: reservation.reservationId,
                      admittedIn: reservation.admittedIn ?? null,
                      operationRef: input.operationRef,
                      host: boundHost,
                    },
                  )
                : undefined;
            const scopeDigest = scoped?.scope == null ? null : sha256(canonical(scoped.scope));
            const residual =
              input.acceptResidual === undefined
                ? undefined
                : {
                    accepted: input.acceptResidual,
                    refusals: scoped?.refusals ?? [],
                    scopeDigest,
                  };
            const evidence = canonical({
              action: input.action,
              operationRef: input.operationRef,
              execution: termination.execution,
              host:
                host === null
                  ? null
                  : { platform: host.platform, machineId: host.machineId, bootId: host.bootId },
              servingId: store.servingId,
              provenance: provenanceDigest,
              ...(scoped === undefined
                ? {}
                : {
                    residual: {
                      required: RESIDUAL_UNCERTAINTIES,
                      accepted: input.acceptResidual ?? null,
                      scopeDigest,
                      scope: scoped.scope,
                      refusals: scoped.refusals,
                    },
                  }),
              ...(input.action === "verify" && recorded !== undefined
                ? {
                    capture: {
                      evidenceDigest: recorded.capture.evidenceDigest,
                      host: recorded.capture.host,
                      servingId: recorded.capture.servingId,
                    },
                  }
                : {}),
            });
            const read = { evidence, evidenceDigest: sha256(evidence) };
            const refusals = terminationRefusals({
              action: input.action,
              facts: termination.facts,
              executionDigest,
              evidenceDigest: read.evidenceDigest,
              operationRef: input.operationRef,
              servingId: store.servingId,
              host,
              recorded,
              provenance,
              provenanceDigest,
              providerSessions: termination.execution.providerSessions,
              ...(residual === undefined ? {} : { residual }),
            });
            const basis =
              typeof provenance !== "string" && provenanceDigest !== null
                ? ({
                    type: "provenance",
                    digest: provenanceDigest,
                    source: provenance.source,
                  } as const)
                : residual !== undefined && scoped?.scope != null && scopeDigest !== null
                  ? ({
                      type: "residual",
                      accepted: residual.accepted,
                      scopeDigest,
                      scope: canonical(scoped.scope),
                    } as const)
                  : undefined;
            if (
              refusals.length > 0 ||
              input.expectDigest === undefined ||
              host === null ||
              basis === undefined
            ) {
              return { applied: false, refusals, ...read };
            }
            if (input.expectDigest !== read.evidenceDigest) {
              return { applied: false, refusals: ["evidence_changed"], ...read };
            }
            const signed = {
              by: input.by,
              reason: input.reason,
              evidenceDigest: read.evidenceDigest,
              evidence: read.evidence,
              servingId: store.servingId,
              host,
            };
            const { facts } = termination;
            const applied = yield* store.recordHistoricalTermination({
              reservationId: reservation.reservationId,
              expected: reservation,
              change:
                input.action === "capture"
                  ? {
                      type: "capture",
                      capture: {
                        ...signed,
                        operationRef: input.operationRef,
                        executionDigest,
                        ...(basis.type === "provenance"
                          ? { provenance: { digest: basis.digest, source: basis.source } }
                          : {
                              residual: {
                                accepted: basis.accepted,
                                scopeDigest: basis.scopeDigest,
                                scope: basis.scope,
                              },
                            }),
                        covers: {
                          attempts: facts.attempts.map((attempt) => attempt.attemptId),
                          launches: facts.launches.map((launch) => ({
                            runId: launch.runId,
                            status: launch.status,
                            attemptCount: launch.attempts,
                          })),
                          generations: facts.runs.flatMap((run) =>
                            run.generations.map((generation) => generation.generationId),
                          ),
                        },
                      },
                    }
                  : { type: "prove", proof: signed },
            });
            return applied
              ? { applied: true, refusals: [], ...read }
              : { applied: false, refusals: ["evidence_changed"], ...read };
          }),
        );
        // Its custody may be quiet now: the next pass settles it like any other stage.
        if (result.applied && input.action === "verify") {
          yield* Queue.offer(wakes, { factoryId: input.factoryId, trigger: "owner_decision" });
        }
        return result;
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new FactoryLifecycleError({
                operation: "historical-termination",
                factoryId: input.factoryId,
                cause,
              }),
          ),
        ),
    ),
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

/** The lifecycle on the stores its caller provides. */
export const layerUsingStores = Layer.effect(FactoryLifecycle, make).pipe(
  Layer.provide(FactoryPreparedCriteriaStore.layer),
);

export const layer = layerUsingStores.pipe(
  Layer.provide(FactoryOutcomeStore.layer),
  Layer.provide(FactoryOperationStore.layer),
  Layer.provide(FactoryExecutionGenerations.layer),
  Layer.provide(FactoryClaimStore.layer.pipe(Layer.provideMerge(FactoryStore.layer))),
);

/** Runs the factories' own triggers in the server once it is activated. */
export const layerDriver = Layer.effectDiscard(
  Effect.flatMap(FactoryLifecycle, (lifecycle) => forkParked(lifecycle.drive)),
);
