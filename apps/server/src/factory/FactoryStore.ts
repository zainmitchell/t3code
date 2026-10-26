import { modelSelectionsEqual } from "@t3tools/shared/model";
// @effect-diagnostics nodeBuiltinImport:off - sha256 of small identity strings.
import { encodeItemEvent } from "./factoryItemEvents.ts";
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  FactoryClaimCarrierKey,
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryObservationId,
  FactoryPoolId,
  FactoryReadGeneration,
  FactoryReservationId,
  ModelSelection,
  NodeId,
  NonNegativeInt,
  type OrchestrationV2FactoryAdmission,
  type OrchestrationV2ThreadCreatedFrom,
  PositiveInt,
  ProjectId,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";

export class FactoryStoreError extends Schema.TaggedError<FactoryStoreError>()(
  "FactoryStoreError",
  {
    operation: Schema.String,
    factoryId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Factory store ${this.operation} failed.`;
  }
}

const Bounded = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const FactoryPool = Schema.Struct({
  poolId: FactoryPoolId,
  capacityUnits: NonNegativeInt,
});

/**
 * The consumer schema of the pinned helper command a packet tells the worker to run. `supplied`
 * arguments are bound to the native decision; `workerSupplied` ones are report-time obligations.
 */
export const FactoryHelperInvocation = Schema.Struct({
  command: Bounded,
  required: Schema.Array(Bounded),
  choices: Schema.Record(Bounded, Schema.Array(Bounded)),
  supplied: Schema.Record(Bounded, Schema.Literals(["taskKind", "decisionKey"])),
  workerSupplied: Schema.Array(Bounded),
});
export type FactoryHelperInvocation = typeof FactoryHelperInvocation.Type;

/** How the factory claims a tracker item before any provider work. Labels are policy, not provenance. */
export const FactoryClaimConfig = Schema.Struct({
  host: Bounded,
  /** The verified tracker account allowed to write claims. */
  accountId: Bounded,
  /**
   * The label that marks a new item ready, for a project whose readiness is a label. Absent,
   * readiness is the project policy's. Either way, collection also reads unready issues a claim
   * may hold, since their work occupies files and resources.
   */
  eligibilityLabel: Schema.optional(Bounded),
  foreignClaimLabels: Schema.Array(Bounded),
  foreignClaimCommentPatterns: Schema.Array(Bounded),
  /** What an observed claim nobody can attribute is charged. */
  observedClaimPool: Schema.Struct({ poolId: FactoryPoolId, units: PositiveInt }),
  /** Where reconciliation looks for open issues. */
  repositories: Schema.optional(Schema.Array(Bounded)),
});
export type FactoryClaimConfig = typeof FactoryClaimConfig.Type;

const FactoryExecution = Schema.Struct({
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type FactoryExecution = typeof FactoryExecution.Type;

export const FactoryConfigurationInput = Schema.Struct({
  factoryId: FactoryId,
  projectId: ProjectId,
  policyRevision: Bounded,
  enabled: Schema.Boolean,
  pools: Schema.Array(FactoryPool),
  execution: FactoryExecution,
  /**
   * Stages that run other than `execution`, such as an independent review on another model.
   * Each stage's work, and everything it delegates, runs as configured for that stage.
   */
  stageExecution: Schema.optional(
    Schema.Struct({
      implement: Schema.optional(FactoryExecution),
      review: Schema.optional(FactoryExecution),
      correct: Schema.optional(FactoryExecution),
      rework: Schema.optional(FactoryExecution),
    }),
  ),
  /**
   * Executions a project policy may choose for one decision by name, such as a builder's effort
   * from the issue's labels. A name the configuration does not hold is refused.
   */
  executionChoices: Schema.optional(Schema.Record(Bounded, FactoryExecution)),
  packet: Schema.Struct({
    briefSchemaVersion: Bounded,
    helper: Schema.NullOr(
      Schema.Struct({
        path: TrimmedNonEmptyString,
        sha256: Bounded,
        invocation: Schema.optional(FactoryHelperInvocation),
      }),
    ),
  }),
  artifactRoot: TrimmedNonEmptyString,
  claim: Schema.optional(FactoryClaimConfig),
  /**
   * The project's one-shot policy command, pinned by content: it receives one item's immutable
   * facts on stdin and answers with one decision on stdout. It keeps no state between calls.
   */
  policy: Schema.optional(
    Schema.Struct({
      executable: TrimmedNonEmptyString,
      script: TrimmedNonEmptyString,
      sha256: Bounded,
    }),
  ),
  /** How often the server reconciles the factory on its own; absent, only triggers do. */
  reconcileEveryMinutes: Schema.optional(PositiveInt),
  /**
   * The owner's thread, where the factory asks for the owner's decisions as chat questions that
   * only the owner's own signed-in client can answer. Absent, decisions wait in Settings.
   */
  ownerThreadId: Schema.optional(ThreadId),
  /**
   * Where T3 lands reviewed work: directly, merging or fast-forwarding a branch of `remote` (the
   * project itself when null) under T3's identity; or by pull request, publishing the reviewed head
   * and merging into `branch` of `repository` at exactly that head once host protection allows.
   * Absent, nothing integrates.
   */
  integration: Schema.optional(
    Schema.Union([
      Schema.Struct({
        branch: Bounded,
        remote: Schema.NullOr(Bounded),
        mode: Schema.Literals(["merge", "fast_forward"]),
        identity: Schema.Struct({ name: Bounded, email: Bounded }),
      }),
      Schema.Struct({
        mode: Schema.Literal("pull_request"),
        repository: Bounded,
        remote: Bounded,
        branch: Bounded,
        method: Schema.Literals(["merge", "squash", "rebase"]),
        /**
         * A commit status the repository's protection requires as its record of independent
         * acceptance; T3 posts it on the exact reviewed head before merging.
         */
        acceptanceStatus: Schema.optional(Schema.Struct({ context: Bounded })),
      }),
    ]),
  ),
  /** How long one item's tracker read may take before the pass records it unread. */
  readDeadlineSeconds: Schema.optional(PositiveInt),
});
export type FactoryConfigurationInput = typeof FactoryConfigurationInput.Type;

/**
 * Finite owner authority for one exact supervised subject: the item, the stage and the evidence
 * of the request the owner answered. It is spent only in an admission commit that revalidates all
 * three, so it never falls through to another item, stage or changed request.
 */
export const FactoryGrant = Schema.Struct({
  grantId: Bounded,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  stage: Bounded,
  evidenceDigest: Bounded,
  units: PositiveInt,
  remaining: NonNegativeInt,
  state: Schema.Literals(["active", "spent", "revoked"]),
  /** The reserved decision the owner answered with it. */
  decisionId: Schema.String,
  issuedBy: Schema.String,
  issuedAt: Schema.String,
  /** The reservations that spent it, in order. */
  spentBy: Schema.Array(Schema.String),
  revoked: Schema.optional(Schema.Struct({ by: Schema.String, at: Schema.String })),
});
export type FactoryGrant = typeof FactoryGrant.Type;

export const FactoryConfiguration = Schema.Struct({
  ...FactoryConfigurationInput.fields,
  revision: PositiveInt,
  createdAt: Schema.String,
});
export type FactoryConfiguration = typeof FactoryConfiguration.Type;

const ExecutionBinding = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  runId: RunId,
  taskNodeId: NodeId,
});

const ReservationFields = {
  reservationId: FactoryReservationId,
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  poolId: FactoryPoolId,
  units: PositiveInt,
  /** A released reservation stays as history and holds nothing. */
  state: Schema.Literals(["held", "released"]),
  releasedReason: Schema.optional(
    Schema.Literals([
      "claim_not_written",
      "attested_native_mirror",
      "outcome_verified",
      "owner_disposition",
      "rolled_back",
    ]),
  ),
  createdAt: Schema.String,
};

/** A factory decision admitted through `factory.execution.start`. */
const AdmittedReservation = Schema.Struct({
  origin: Schema.Literal("admitted"),
  ...ReservationFields,
  decisionKey: FactoryDecisionKey,
  taskKind: Bounded,
  itemVersion: Bounded,
  policyRevision: Bounded,
  configRevision: PositiveInt,
  packetDigest: Bounded,
  modelSelection: ModelSelection,
  execution: ExecutionBinding,
  /** A later lifecycle stage: the reservation whose claim owns the item. */
  continues: Schema.optional(FactoryReservationId),
  stageBasis: Schema.optional(Bounded),
  /** The observation the decision was admitted on, so a later change under it is recorded. */
  observationId: Schema.optional(FactoryObservationId),
  /** The finite grant the decision spent, if it was supervised. */
  grantId: Schema.optional(Bounded),
});

/** A counted descendant of a native execution, admitted under the configuration current then. */
const InheritedReservation = Schema.Struct({
  origin: Schema.Literal("inherited"),
  ...ReservationFields,
  parentReservationId: FactoryReservationId,
  decisionKey: FactoryDecisionKey,
  configRevision: PositiveInt,
  modelSelection: ModelSelection,
  execution: ExecutionBinding,
});

/** An external claim no native operation produced; its custody is unknown. */
const ObservedReservation = Schema.Struct({
  origin: Schema.Literal("observed"),
  ...ReservationFields,
  carrierKey: FactoryClaimCarrierKey,
  /** The read generation the claim was seen in. */
  generation: FactoryReadGeneration,
});

/**
 * A legacy worker's custody, transferred to the factory: one per worker, bound to its thread, so
 * every live or unknown worker is charged and nothing it starts escapes the factory. Nothing
 * contained that work, so its custody stays unknown until the owner disposes of it. An item whose
 * legacy work names no worker holds one for the item.
 */
const TransferredReservation = Schema.Struct({
  origin: Schema.Literal("transferred"),
  ...ReservationFields,
  transferId: Bounded,
  job: Bounded,
  workId: Schema.optional(Bounded),
  threadId: Schema.optional(ThreadId),
});

const WorkspaceObligationFields = {
  runId: RunId,
  reservationId: FactoryReservationId,
  threadId: ThreadId,
  commandId: CommandId,
  ownerId: PreparationOwnerId,
  openedAt: Schema.String,
  /** Owners a routine recovery replaced, with the containers proved ended before it did. */
  priorOwners: Schema.optional(
    Schema.Array(
      Schema.Struct({
        ownerId: PreparationOwnerId,
        endedGenerations: Schema.Array(Schema.String),
        recoveredAt: Schema.String,
      }),
    ),
  ),
};

/**
 * A claimed run's workspace work. Open from the transaction that authorizes it, before any
 * workspace I/O. Settled only by its own owner, and only for the scope that owner's preparation
 * proved: no external process boundary was ever entered, or every process it started was a
 * member of its run's container, whose own facts then say whether they ended.
 */
export const WorkspaceObligation = Schema.Union([
  Schema.Struct({ ...WorkspaceObligationFields, state: Schema.Literal("open") }),
  Schema.Struct({
    ...WorkspaceObligationFields,
    state: Schema.Literal("settled"),
    scope: Schema.Literal("no_external_work"),
    settledAt: Schema.String,
  }),
  Schema.Struct({
    ...WorkspaceObligationFields,
    state: Schema.Literal("settled"),
    scope: Schema.Literal("contained"),
    generationId: Schema.String,
    settledAt: Schema.String,
  }),
]);
export type WorkspaceObligation = typeof WorkspaceObligation.Type;

export const FactoryReservation = Schema.Union([
  AdmittedReservation,
  InheritedReservation,
  ObservedReservation,
  TransferredReservation,
]);
export type FactoryReservation = typeof FactoryReservation.Type;
/** A reservation for work T3 itself started, with its execution. */
export type NativeReservation = Extract<
  FactoryReservation,
  { readonly origin: "admitted" | "inherited" }
>;

export const isNativeReservation = (
  reservation: FactoryReservation,
): reservation is NativeReservation =>
  reservation.origin === "admitted" || reservation.origin === "inherited";

export const FactoryReservationRefusal = Schema.Literals([
  "configuration_changed",
  "factory_paused",
  "unknown_pool",
  "decision_already_admitted",
  "item_owned",
  "capacity_exhausted",
  "deadline_expired",
  "incomplete_basis",
  "stale_basis",
  "unbound_destination",
  "selection_not_configured",
  "selection_pinned",
  "origin_conflict",
  "claim_not_ready",
  "grant_unavailable",
  /** The work comes from a transferred legacy worker, whose custody is not T3's to extend. */
  "legacy_custody",
]);
export type FactoryReservationRefusal = typeof FactoryReservationRefusal.Type;

export interface ReserveExecutionInput {
  readonly commandId: CommandId;
  readonly executionThreadId: ThreadId;
  readonly runId: RunId;
  readonly taskNodeId: NodeId;
  readonly modelSelection: ModelSelection;
  readonly origin:
    | { readonly type: "admission"; readonly admission: OrchestrationV2FactoryAdmission }
    | {
        readonly type: "descendant";
        /** Trusted origin threads in order: lineage parent, then sender. */
        readonly ownerThreadIds: ReadonlyArray<ThreadId>;
        readonly scheduledTaskId: ScheduledTaskId | null;
        /** False when the thread already ran before this start. */
        readonly firstRun: boolean;
      };
}

export type ReserveExecutionResult =
  | { readonly type: "reserved"; readonly reservation: NativeReservation }
  /** A continuation of the thread's own execution, or work with no factory origin. */
  | { readonly type: "none" }
  | { readonly type: "refused"; readonly refusal: FactoryReservationRefusal };

const ObservedClaim = Schema.Struct({
  /** Stable identity of the external claim record, e.g. the tracker event that applied a label. */
  carrierKey: FactoryClaimCarrierKey,
  poolId: FactoryPoolId,
  units: PositiveInt,
});

const EvidenceEntry = Schema.Struct({ carrierId: Bounded, bodyDigest: Bounded, version: Bounded });

/** One collection read of an item, recorded natively so admission can fence on it. */
export const ItemObservationInput = Schema.Struct({
  factoryId: FactoryId,
  itemKey: FactoryItemKey,
  itemVersion: Bounded,
  /** Allocated by `beginCollection` before the read started. */
  generation: FactoryReadGeneration,
  /** False when the read could not see everything the decision depends on. */
  complete: Schema.Boolean,
  evidence: Schema.Array(EvidenceEntry),
  sources: Schema.Array(Schema.Struct({ sourceKey: Bounded, version: Bounded })),
  claims: Schema.Array(ObservedClaim),
  /** The tracker item this read observed; a claim is written to it and nowhere else. */
  subject: Schema.optional(
    Schema.Struct({
      tracker: Schema.Literal("github"),
      repository: Bounded,
      issueNumber: PositiveInt,
    }),
  ),
});
export type ItemObservationInput = typeof ItemObservationInput.Type;

export const ItemObservation = Schema.Struct({
  ...ItemObservationInput.fields,
  observationId: FactoryObservationId,
  /** Digest of everything but the generation: two reads with equal digests saw the same item. */
  basisDigest: Bounded,
  observedAt: Schema.String,
});
export type ItemObservation = typeof ItemObservation.Type;

export type ItemObservationResult =
  | { readonly type: "recorded"; readonly observation: ItemObservation }
  /**
   * This generation already recorded different evidence for the item. The conflict and its claims
   * are kept, and no basis read at or before this generation admits; reread under a new one.
   */
  | { readonly type: "conflict"; readonly recorded: ItemObservation }
  /** A later generation already observed the item, so this delayed read is not kept. */
  | { readonly type: "superseded"; readonly current: ItemObservation }
  | { readonly type: "unknown_generation" };

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const byTuple = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.join("\u0000") < right.join("\u0000")
    ? -1
    : left.join("\u0000") > right.join("\u0000")
      ? 1
      : 0;

/** The one canonical ordering of a decision's evidence, shared by every digest over it. */
export const canonicalEvidence = (evidence: ReadonlyArray<typeof EvidenceEntry.Type>) =>
  evidence.map((entry) => [entry.carrierId, entry.bodyDigest, entry.version]).toSorted(byTuple);

/**
 * Two reads with equal digests saw the same item. `ownCarrier` leaves out exactly the carrier
 * this factory's own claim wrote, so its expected self-mutation does not read as a change.
 */
export const basisDigestOf = (
  input: Omit<ItemObservationInput, "factoryId" | "itemKey" | "generation" | "complete">,
  ownCarrier?: string,
) =>
  sha256(
    JSON.stringify([
      input.itemVersion,
      canonicalEvidence(input.evidence),
      input.sources.map((source) => [source.sourceKey, source.version]).toSorted(byTuple),
      input.claims
        .filter((claim) => claim.carrierKey !== ownCarrier)
        .map((claim) => [claim.carrierKey])
        .toSorted(byTuple),
      ...(input.subject === undefined
        ? []
        : [[input.subject.tracker, input.subject.repository, input.subject.issueNumber]]),
    ]),
  );

const sameSelection = Schema.toEquivalence(ModelSelection);

const hasDistinctOptionIds = (selection: ModelSelection) => {
  const ids = (selection.options ?? []).map((option) => option.id);
  return new Set(ids).size === ids.length;
};

/**
 * Whether a starting request runs on an execution's pinned selection. Option order does not
 * matter when every id is distinct; a repeated id is read by its first entry, so then only the
 * exact list is the same selection.
 */
/** Every model a decision or its delegates may run on under this configuration. */
const configuredSelections = (
  configuration: Pick<
    FactoryConfigurationInput,
    "execution" | "stageExecution" | "executionChoices"
  >,
) => [
  configuration.execution.modelSelection,
  ...Object.values(configuration.stageExecution ?? {}).flatMap((execution) =>
    execution === undefined ? [] : [execution.modelSelection],
  ),
  ...Object.values(configuration.executionChoices ?? {}).map(
    (execution) => execution.modelSelection,
  ),
];

/** How a decision for `taskKind` runs under this configuration. */
export const executionFor = (
  configuration: Pick<FactoryConfigurationInput, "execution" | "stageExecution">,
  taskKind: string,
): FactoryExecution =>
  (taskKind === "implement" ||
  taskKind === "review" ||
  taskKind === "correct" ||
  taskKind === "rework"
    ? configuration.stageExecution?.[taskKind]
    : undefined) ?? configuration.execution;

export const samePinnedSelection = (pinned: ModelSelection, requested: ModelSelection) =>
  sameSelection(pinned, requested) ||
  (hasDistinctOptionIds(pinned) &&
    hasDistinctOptionIds(requested) &&
    modelSelectionsEqual(pinned, requested));

export class FactoryStore extends Context.Service<
  FactoryStore,
  {
    readonly configure: (
      input: FactoryConfigurationInput,
    ) => Effect.Effect<FactoryConfiguration, FactoryStoreError>;
    readonly getConfiguration: (
      factoryId: FactoryId,
    ) => Effect.Effect<Option.Option<FactoryConfiguration>, FactoryStoreError>;
    /** Every factory's current configuration. */
    readonly listConfigurations: () => Effect.Effect<
      ReadonlyArray<FactoryConfiguration>,
      FactoryStoreError
    >;
    /** Allocates the next read generation; call before a collection reads anything. */
    readonly beginCollection: (
      factoryId: FactoryId,
    ) => Effect.Effect<FactoryReadGeneration, FactoryStoreError>;
    /** Records a collection read and the claims it saw. */
    readonly recordItemObservation: (
      input: ItemObservationInput,
    ) => Effect.Effect<ItemObservationResult, FactoryStoreError>;
    readonly getObservation: (input: {
      readonly factoryId: FactoryId;
      readonly observationId: FactoryObservationId;
    }) => Effect.Effect<Option.Option<ItemObservation>, FactoryStoreError>;
    /** Decides and records a reservation. The caller must hold the write transaction. */
    readonly reserveExecution: (
      input: ReserveExecutionInput,
    ) => Effect.Effect<ReserveExecutionResult, FactoryStoreError>;
    /**
     * Records that T3's own claim effect produced `carrierKey` for this native reservation. Only
     * such a claim is that reservation's mirror; the effect calls this after reading it back.
     */
    readonly recordClaimOperation: (input: {
      readonly reservationId: FactoryReservationId;
      readonly carrierKey: FactoryClaimCarrierKey;
    }) => Effect.Effect<boolean, FactoryStoreError>;
    readonly listReservations: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<FactoryReservation>, FactoryStoreError>;
    readonly findAdmission: (input: {
      readonly factoryId: FactoryId;
      readonly decisionKey: FactoryDecisionKey;
    }) => Effect.Effect<Option.Option<FactoryReservation>, FactoryStoreError>;
    /**
     * Records that a schedule a factory execution creates or edits belongs to that execution.
     * Callers that also write the schedule run both in one transaction.
     */
    readonly recordScheduleOrigin: (input: {
      readonly scheduledTaskId: ScheduledTaskId;
      readonly callerThreadId: ThreadId;
    }) => Effect.Effect<Option.Option<FactoryReservation>, FactoryStoreError>;
    readonly scheduleOrigin: (
      scheduledTaskId: ScheduledTaskId,
    ) => Effect.Effect<Option.Option<FactoryReservation>, FactoryStoreError>;
    /**
     * Records the factory execution a thread was created for, when its creator belongs to one, so
     * the thread's first start is charged however it comes. The caller must hold the write
     * transaction that creates the thread.
     */
    readonly recordThreadOrigin: (input: {
      readonly threadId: ThreadId;
      readonly createdFrom: OrchestrationV2ThreadCreatedFrom;
    }) => Effect.Effect<void, FactoryStoreError>;
    /** The reservation whose execution owns this thread, if any. */
    readonly bindingForThread: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<FactoryReservation>, FactoryStoreError>;
    /** Whether work under this reservation may start, as far as its tracker claim goes. */
    readonly isClaimReady: (
      reservation: NativeReservation,
    ) => Effect.Effect<boolean, FactoryStoreError>;
    /**
     * Releases a reservation the caller has proved holds nothing. The caller must hold the write
     * transaction that proved it.
     */
    readonly releaseReservation: (
      reservationId: FactoryReservationId,
      reason:
        | "claim_not_written"
        | "attested_native_mirror"
        | "outcome_verified"
        | "owner_disposition",
    ) => Effect.Effect<boolean, FactoryStoreError>;
    /** Every observation of the item recorded after the given one, oldest first. */
    readonly observationsAfter: (input: {
      readonly factoryId: FactoryId;
      readonly observationId: FactoryObservationId;
    }) => Effect.Effect<ReadonlyArray<ItemObservation>, FactoryStoreError>;
    readonly getReservation: (
      reservationId: FactoryReservationId,
    ) => Effect.Effect<Option.Option<FactoryReservation>, FactoryStoreError>;
    /**
     * Releases the observed reservation an attested native claim carrier was charged as, so one
     * claim is never charged twice. The caller holds the transaction that attested it.
     */
    readonly releaseObservedCarrier: (input: {
      readonly factoryId: FactoryId;
      readonly carrierKey: FactoryClaimCarrierKey;
    }) => Effect.Effect<void, FactoryStoreError>;
    /**
     * The owner disposes of an observed claim nobody could attribute, once its writer is fenced
     * and its work is known to be gone: its reservation is released, and that exact carrier is
     * not charged or counted as a claim again. False when it is not a held observed reservation.
     */
    readonly disposeObservedReservation: (input: {
      readonly reservationId: FactoryReservationId;
      readonly by: string;
      readonly reason: string;
    }) => Effect.Effect<boolean, FactoryStoreError>;
    readonly disposedCarriers: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlySet<string>, FactoryStoreError>;
    /**
     * Holds one transferred legacy worker's unknown custody once, against capacity, bound to its
     * thread so nothing it starts escapes the factory; or the item's, when no worker is named.
     */
    readonly holdTransferredCustody: (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly transferId: string;
      readonly job: string;
      readonly poolId: FactoryPoolId;
      readonly units: number;
      readonly worker?: { readonly workId: string; readonly threadId: ThreadId | null };
      readonly historical?: boolean;
    }) => Effect.Effect<FactoryReservation, FactoryStoreError>;
    /** Gives a rolled-back transfer's held custody back to its legacy writer. */
    readonly releaseTransferredCustody: (input: {
      readonly factoryId: FactoryId;
      readonly transferId: string;
    }) => Effect.Effect<void, FactoryStoreError>;
    /** Issues the owner's finite grant for one exact subject; one per answered decision. */
    readonly issueGrant: (input: {
      readonly factoryId: FactoryId;
      readonly itemKey: FactoryItemKey;
      readonly stage: string;
      readonly evidenceDigest: string;
      readonly units: number;
      readonly decisionId: string;
      readonly by: string;
    }) => Effect.Effect<FactoryGrant, FactoryStoreError>;
    readonly listGrants: (
      factoryId: FactoryId,
    ) => Effect.Effect<ReadonlyArray<FactoryGrant>, FactoryStoreError>;
    /** Revokes what remains of a grant; false when it is not active. */
    readonly revokeGrant: (input: {
      readonly grantId: string;
      readonly by: string;
    }) => Effect.Effect<boolean, FactoryStoreError>;
    /** Records a run's open workspace obligation. The caller holds the authorizing transaction. */
    readonly openWorkspaceObligation: (input: {
      readonly runId: RunId;
      readonly reservationId: FactoryReservationId;
      readonly threadId: ThreadId;
      readonly commandId: CommandId;
      readonly ownerId: PreparationOwnerId;
    }) => Effect.Effect<void, FactoryStoreError>;
    /** Settles the run's open obligation for its own owner only; false when that did not hold. */
    readonly settleWorkspaceObligation: (input: {
      readonly runId: RunId;
      readonly ownerId: PreparationOwnerId;
      readonly scope:
        | { readonly type: "no_external_work" }
        | { readonly type: "contained"; readonly generationId: string };
    }) => Effect.Effect<boolean, FactoryStoreError>;
    /** A run's obligation; unreadable rows fail rather than read as absent. */
    readonly workspaceObligation: (
      runId: RunId,
    ) => Effect.Effect<Option.Option<WorkspaceObligation>, FactoryStoreError>;
    /** The reservation's open obligations, oldest first. */
    readonly openWorkspaceObligations: (
      reservationId: FactoryReservationId,
    ) => Effect.Effect<ReadonlyArray<WorkspaceObligation>, FactoryStoreError>;
    /**
     * Gives an open obligation a new owner, recording the one it replaces and the containers
     * proved ended; false when it is not open under `fromOwnerId`. The caller holds the
     * recovery transaction.
     */
    readonly reownWorkspaceObligation: (input: {
      readonly runId: RunId;
      readonly fromOwnerId: PreparationOwnerId;
      readonly toOwnerId: PreparationOwnerId;
      readonly endedGenerations: ReadonlyArray<string>;
    }) => Effect.Effect<boolean, FactoryStoreError>;
  }
>()("t3/factory/FactoryStore") {}

const WorkspaceObligationJson = Schema.fromJsonString(WorkspaceObligation);
const encodeWorkspaceObligation = Schema.encodeEffect(WorkspaceObligationJson, {
  onExcessProperty: "error",
});
const decodeWorkspaceObligation = Schema.decodeUnknownEffect(WorkspaceObligationJson, {
  onExcessProperty: "error",
});

const ConfigurationJson = Schema.fromJsonString(FactoryConfiguration);
const ReservationJson = Schema.fromJsonString(FactoryReservation);
const ObservationJson = Schema.fromJsonString(ItemObservation);
const encodeConfiguration = Schema.encodeEffect(ConfigurationJson);
const decodeConfiguration = Schema.decodeUnknownEffect(ConfigurationJson);
const GrantJson = Schema.fromJsonString(FactoryGrant);
const encodeGrant = Schema.encodeEffect(GrantJson, { onExcessProperty: "error" });
const decodeGrant = Schema.decodeUnknownEffect(GrantJson);
const encodeDisposition = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      carrierKey: Schema.String,
      reservationId: Schema.String,
      by: Schema.String,
      reason: Schema.String,
      disposedAt: Schema.String,
    }),
  ),
);
const encodeReservation = Schema.encodeEffect(ReservationJson);
const decodeReservation = Schema.decodeUnknownEffect(ReservationJson);
const encodeObservation = Schema.encodeEffect(ObservationJson);
const decodeObservation = Schema.decodeUnknownEffect(ObservationJson);
const encodeObservationInput = Schema.encodeEffect(Schema.fromJsonString(ItemObservationInput));
const makeReservationId = Schema.decodeSync(FactoryReservationId);
const makeObservationId = Schema.decodeSync(FactoryObservationId);
const makeReadGeneration = Schema.decodeSync(FactoryReadGeneration);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const fail =
    (operation: string, factoryId?: FactoryId) =>
    (cause: unknown): FactoryStoreError =>
      new FactoryStoreError({
        operation,
        ...(factoryId === undefined ? {} : { factoryId }),
        cause,
      });

  // The queries and helpers below run inside one store operation, which owns the span.
  const decodeOptional = <A, E>(
    decode: (json: string) => Effect.Effect<A, E>,
    rows: ReadonlyArray<{ readonly record_json: string }>,
  ) =>
    rows[0] === undefined
      ? Effect.succeed(Option.none<A>())
      : decode(rows[0].record_json).pipe(Effect.asSome);

  const latestConfiguration = (factoryId: FactoryId) =>
    sql<{ readonly config_json: string }>`
      SELECT config_json FROM factory_configurations
      WHERE factory_id = ${factoryId}
      ORDER BY revision DESC
      LIMIT 1
    `.pipe(
      Effect.flatMap((rows) =>
        decodeOptional(
          decodeConfiguration,
          rows.map((row) => ({ record_json: row.config_json })),
        ),
      ),
    );

  const listConfigurations = () =>
    sql<{ readonly config_json: string }>`
      SELECT config_json FROM factory_configurations AS configuration
      WHERE revision = (
        SELECT MAX(revision) FROM factory_configurations
        WHERE factory_id = configuration.factory_id
      )
      ORDER BY factory_id
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeConfiguration(row.config_json))),
    );

  const reservationById = (reservationId: FactoryReservationId) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_reservations WHERE reservation_id = ${reservationId}
    `.pipe(Effect.flatMap((rows) => decodeOptional(decodeReservation, rows)));

  const bindingForThread = (threadId: ThreadId) =>
    sql<{ readonly reservation_id: FactoryReservationId }>`
      SELECT reservation_id FROM factory_thread_bindings WHERE thread_id = ${threadId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryReservation>())
          : reservationById(rows[0].reservation_id),
      ),
    );

  const stagedOrigin = (threadId: ThreadId) =>
    sql<{ readonly reservation_id: FactoryReservationId }>`
      SELECT reservation_id FROM factory_thread_origins WHERE thread_id = ${threadId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryReservation>())
          : reservationById(rows[0].reservation_id),
      ),
    );

  /** The execution a thread belongs to: the one it runs, else the one it was created for. */
  const originReservationFor = (threadId: ThreadId) =>
    bindingForThread(threadId).pipe(
      Effect.filterOrElse(Option.isSome, () => stagedOrigin(threadId)),
    );

  const scheduleOrigin = (scheduledTaskId: ScheduledTaskId) =>
    sql<{ readonly reservation_id: FactoryReservationId }>`
      SELECT reservation_id FROM factory_schedule_origins
      WHERE scheduled_task_id = ${scheduledTaskId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryReservation>())
          : reservationById(rows[0].reservation_id),
      ),
    );

  const occupiedUnits = (factoryId: FactoryId, poolId: FactoryPoolId) =>
    sql<{ readonly units: number }>`
      SELECT COALESCE(SUM(units), 0) AS units FROM factory_reservations
      WHERE factory_id = ${factoryId} AND pool_id = ${poolId} AND state = 'held'
    `.pipe(Effect.map((rows) => rows[0]?.units ?? 0));

  /** The admitted decision a native reservation belongs to. */
  const admittedRootOf = Effect.fnUntraced(function* (reservation: NativeReservation) {
    let current: FactoryReservation = reservation;
    while (current.origin === "inherited") {
      const parent: Option.Option<FactoryReservation> = yield* reservationById(
        current.parentReservationId,
      );
      if (Option.isNone(parent)) return Option.none<FactoryReservation>();
      current = parent.value;
    }
    return Option.some(current);
  });

  /**
   * Whether work under this reservation may start: its admitted decision either claims nothing
   * or holds a verified tracker claim. Anything else, including an unreadable chain, is not ready.
   */
  const claimReady = Effect.fnUntraced(function* (reservation: NativeReservation) {
    const root = yield* admittedRootOf(reservation);
    if (Option.isNone(root)) return false;
    // A later stage starts under the claim of the decision that owns its item.
    const owner =
      root.value.origin === "admitted" && root.value.continues !== undefined
        ? root.value.continues
        : root.value.reservationId;
    const claims = yield* sql<{ readonly state: string }>`
      SELECT state FROM factory_claims WHERE reservation_id = ${owner}
    `;
    return (
      claims[0] === undefined ||
      claims[0].state === "verified" ||
      claims[0].state === "workspace_authorized"
    );
  });

  /** Releases a reservation whose release the caller has proved safe; history is kept. */
  const releaseReservation = Effect.fnUntraced(function* (
    reservationId: FactoryReservationId,
    reason:
      | "claim_not_written"
      | "attested_native_mirror"
      | "outcome_verified"
      | "owner_disposition"
      | "rolled_back",
  ) {
    const reservation = yield* reservationById(reservationId);
    if (Option.isNone(reservation) || reservation.value.state !== "held") return false;
    const released: FactoryReservation = {
      ...reservation.value,
      state: "released",
      releasedReason: reason,
    };
    yield* sql`
      UPDATE factory_reservations
      SET state = 'released', record_json = ${yield* encodeReservation(released)}
      WHERE reservation_id = ${reservationId} AND state = 'held'
    `;
    return true;
  });

  const insertReservation = Effect.fnUntraced(function* (reservation: FactoryReservation) {
    const recordJson = yield* encodeReservation(reservation);
    const native = isNativeReservation(reservation) ? reservation : undefined;
    yield* sql`
      INSERT INTO factory_reservations (
        reservation_id, factory_id, origin, state, decision_key, item_key, pool_id, units,
        execution_thread_id, parent_reservation_id, carrier_key, record_json, created_at
      ) VALUES (
        ${reservation.reservationId}, ${reservation.factoryId}, ${reservation.origin},
        ${reservation.state}, ${native?.decisionKey ?? null}, ${reservation.itemKey},
        ${reservation.poolId}, ${reservation.units}, ${native?.execution.threadId ?? null},
        ${reservation.origin === "inherited" ? reservation.parentReservationId : null},
        ${reservation.origin === "observed" ? reservation.carrierKey : null}, ${recordJson},
        ${reservation.createdAt}
      )
    `;
    if (native !== undefined) {
      yield* sql`
        INSERT INTO factory_thread_bindings (thread_id, reservation_id)
        VALUES (${native.execution.threadId}, ${native.reservationId})
      `;
    }
  });

  const configure = Effect.fn("FactoryStore.configure")(
    function* (input: FactoryConfigurationInput) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly revision: number | null }>`
            SELECT MAX(revision) AS revision FROM factory_configurations
            WHERE factory_id = ${input.factoryId}
          `;
          const configuration: FactoryConfiguration = {
            ...input,
            revision: (rows[0]?.revision ?? 0) + 1,
            createdAt: DateTime.formatIso(yield* DateTime.now),
          };
          yield* sql`
            INSERT INTO factory_configurations (factory_id, revision, project_id, config_json, created_at)
            VALUES (
              ${configuration.factoryId}, ${configuration.revision}, ${configuration.projectId},
              ${yield* encodeConfiguration(configuration)}, ${configuration.createdAt}
            )
          `;
          return configuration;
        }),
      );
    },
    (effect, input) => effect.pipe(Effect.mapError(fail("configure", input.factoryId))),
  );

  const beginCollection = Effect.fn("FactoryStore.beginCollection")(
    function* (factoryId: FactoryId) {
      const rows = yield* sql<{ readonly last_generation: number }>`
        INSERT INTO factory_read_generations (factory_id, last_generation) VALUES (${factoryId}, 1)
        ON CONFLICT(factory_id) DO UPDATE SET last_generation = last_generation + 1
        RETURNING last_generation
      `;
      return makeReadGeneration(rows[0]!.last_generation);
    },
    (effect, factoryId) => effect.pipe(Effect.mapError(fail("begin-collection", factoryId))),
  );

  const readGrant = (grantId: string) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_grants WHERE grant_id = ${grantId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<FactoryGrant>())
          : Effect.asSome(decodeGrant(rows[0].record_json)),
      ),
    );

  const writeGrant = (grant: FactoryGrant) =>
    Effect.flatMap(
      encodeGrant(grant),
      (json) => sql`
        UPDATE factory_grants
        SET state = ${grant.state}, remaining = ${grant.remaining}, record_json = ${json}
        WHERE grant_id = ${grant.grantId}
      `,
    );

  /** Spends one unit only for the exact subject it was issued for; the caller's commit holds it. */
  const spendGrant = Effect.fnUntraced(function* (input: {
    readonly grantId: string;
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryItemKey;
    readonly stage: string;
    readonly evidenceDigest: string;
    readonly reservationId: FactoryReservationId;
  }) {
    const grant = yield* readGrant(input.grantId);
    if (
      Option.isNone(grant) ||
      grant.value.state !== "active" ||
      grant.value.remaining < 1 ||
      grant.value.factoryId !== input.factoryId ||
      grant.value.itemKey !== input.itemKey ||
      grant.value.stage !== input.stage ||
      grant.value.evidenceDigest !== input.evidenceDigest
    ) {
      return false;
    }
    const remaining = grant.value.remaining - 1;
    yield* writeGrant({
      ...grant.value,
      remaining,
      state: remaining === 0 ? "spent" : "active",
      spentBy: [...grant.value.spentBy, input.reservationId],
    });
    return true;
  });

  const reserveAdmission = Effect.fnUntraced(function* (
    input: ReserveExecutionInput,
    admission: OrchestrationV2FactoryAdmission,
  ) {
    // Rechecked here, on the commit's writer, because collection and preflight ran earlier.
    if (DateTime.isLessThanOrEqualTo(admission.deadline, yield* DateTime.now)) {
      return { type: "refused", refusal: "deadline_expired" } as const;
    }
    const named = yield* sql<{ readonly generation: number; readonly basis_digest: string }>`
      SELECT generation, basis_digest FROM factory_item_observations
      WHERE observation_id = ${admission.observationId}
        AND factory_id = ${admission.factoryId} AND item_key = ${admission.itemKey}
    `;
    if (named[0] === undefined || named[0].basis_digest !== admission.basisDigest) {
      return { type: "refused", refusal: "stale_basis" } as const;
    }
    // Any later read that saw something else retires this basis, even if a still later read
    // sees the same evidence again.
    const changedSince = yield* sql`
      SELECT 1 FROM factory_item_observations
      WHERE factory_id = ${admission.factoryId} AND item_key = ${admission.itemKey}
        AND generation > ${named[0].generation} AND basis_digest != ${admission.basisDigest}
      LIMIT 1
    `;
    if (changedSince.length > 0) return { type: "refused", refusal: "stale_basis" } as const;
    const conflicted = yield* sql`
      SELECT 1 FROM factory_item_conflicts
      WHERE factory_id = ${admission.factoryId} AND item_key = ${admission.itemKey}
        AND generation >= ${named[0].generation}
      LIMIT 1
    `;
    if (conflicted.length > 0) return { type: "refused", refusal: "stale_basis" } as const;
    const latest = yield* sql<{ readonly complete: number }>`
      SELECT complete FROM factory_item_observations
      WHERE factory_id = ${admission.factoryId} AND item_key = ${admission.itemKey}
      ORDER BY generation DESC
      LIMIT 1
    `;
    if (latest[0]?.complete !== 1) return { type: "refused", refusal: "incomplete_basis" } as const;
    const configuration = yield* latestConfiguration(admission.factoryId);
    if (Option.isNone(configuration) || configuration.value.revision !== admission.configRevision) {
      return { type: "refused", refusal: "configuration_changed" } as const;
    }
    if (!configuration.value.enabled) {
      return { type: "refused", refusal: "factory_paused" } as const;
    }
    const pool = configuration.value.pools.find(
      (candidate) => candidate.poolId === admission.poolId,
    );
    if (pool === undefined) return { type: "refused", refusal: "unknown_pool" } as const;
    const duplicate = yield* sql`
      SELECT 1 FROM factory_reservations
      WHERE factory_id = ${admission.factoryId} AND decision_key = ${admission.decisionKey}
        AND origin = 'admitted'
    `;
    if (duplicate.length > 0) {
      return { type: "refused", refusal: "decision_already_admitted" } as const;
    }
    const owner = yield* sql`
      SELECT 1 FROM factory_reservations
      WHERE factory_id = ${admission.factoryId} AND item_key = ${admission.itemKey}
        AND state = 'held' AND origin IN ('admitted', 'observed', 'transferred')
    `;
    if (owner.length > 0) return { type: "refused", refusal: "item_owned" } as const;
    const occupied = yield* occupiedUnits(admission.factoryId, admission.poolId);
    if (occupied + admission.units > pool.capacityUnits) {
      return { type: "refused", refusal: "capacity_exhausted" } as const;
    }
    const reservationId = makeReservationId(`reservation:${input.commandId}`);
    if (admission.grant !== undefined) {
      const spent = yield* spendGrant({
        grantId: admission.grant.grantId,
        factoryId: admission.factoryId,
        itemKey: admission.itemKey,
        stage: admission.grant.stage,
        evidenceDigest: admission.grant.evidenceDigest,
        reservationId,
      });
      if (!spent) return { type: "refused", refusal: "grant_unavailable" } as const;
    }
    const reservation: NativeReservation = {
      origin: "admitted",
      reservationId,
      factoryId: admission.factoryId,
      itemKey: admission.itemKey,
      poolId: admission.poolId,
      units: admission.units,
      state: "held",
      createdAt: DateTime.formatIso(yield* DateTime.now),
      decisionKey: admission.decisionKey,
      taskKind: admission.taskKind,
      itemVersion: admission.itemVersion,
      policyRevision: admission.policyRevision,
      configRevision: admission.configRevision,
      packetDigest: admission.packetDigest,
      modelSelection: input.modelSelection,
      execution: {
        commandId: input.commandId,
        threadId: input.executionThreadId,
        runId: input.runId,
        taskNodeId: input.taskNodeId,
      },
      ...(admission.continues === undefined ? {} : { continues: admission.continues }),
      ...(admission.stageBasis === undefined ? {} : { stageBasis: admission.stageBasis }),
      observationId: admission.observationId,
      ...(admission.grant === undefined ? {} : { grantId: admission.grant.grantId }),
    };
    yield* insertReservation(reservation);
    // The same commit records the admission in the item's lifecycle order.
    const admittedEvent = yield* encodeItemEvent({
      type: "admitted",
      stage: admission.taskKind,
      reservationId: reservation.reservationId,
      ...(admission.stageBasis === undefined ? {} : { stageBasis: admission.stageBasis }),
    });
    yield* sql`
      INSERT INTO factory_item_events (factory_id, item_key, record_json)
      VALUES (${admission.factoryId}, ${admission.itemKey}, ${admittedEvent})
    `;
    return { type: "reserved", reservation } as const;
  });

  const reserveDescendant = Effect.fnUntraced(function* (
    input: ReserveExecutionInput,
    origin: Extract<ReserveExecutionInput["origin"], { readonly type: "descendant" }>,
  ) {
    // A thread that already owns a reservation is continuing that execution, on the selection
    // it was admitted with: a later request cannot move it to another account, model or options.
    const bound = yield* bindingForThread(input.executionThreadId);
    if (Option.isSome(bound)) {
      // A transferred legacy worker continues nothing: new work is the factory's to admit.
      if (bound.value.origin === "transferred") {
        return { type: "refused", refusal: "legacy_custody" } as const;
      }
      if (!isNativeReservation(bound.value)) return { type: "none" } as const;
      if (!samePinnedSelection(bound.value.modelSelection, input.modelSelection)) {
        return { type: "refused", refusal: "selection_pinned" } as const;
      }
      return (yield* claimReady(bound.value))
        ? ({ type: "none" } as const)
        : ({ type: "refused", refusal: "claim_not_ready" } as const);
    }
    // The trusted initiator comes first; context lineage, a sender and a schedule may agree with
    // it but never override it. Owners from different decisions are refused, not chosen between.
    const candidates = [yield* stagedOrigin(input.executionThreadId)];
    for (const ownerThreadId of origin.ownerThreadIds) {
      candidates.push(yield* originReservationFor(ownerThreadId));
    }
    if (origin.scheduledTaskId !== null) {
      candidates.push(yield* scheduleOrigin(origin.scheduledTaskId));
    }
    // Work a transferred legacy worker forks, launches, messages or schedules starts nowhere.
    if (
      candidates.some(
        (candidate) => Option.isSome(candidate) && candidate.value.origin === "transferred",
      )
    ) {
      return { type: "refused", refusal: "legacy_custody" } as const;
    }
    const owners = candidates.flatMap((candidate) =>
      Option.isSome(candidate) && isNativeReservation(candidate.value) ? [candidate.value] : [],
    );
    const owner = owners[0];
    if (owner === undefined) return { type: "none" } as const;
    if (
      owners.some(
        (other) => other.factoryId !== owner.factoryId || other.decisionKey !== owner.decisionKey,
      )
    ) {
      return { type: "refused", refusal: "origin_conflict" } as const;
    }
    // Factory work may not borrow a conversation that already ran outside the factory.
    if (!origin.firstRun) return { type: "refused", refusal: "unbound_destination" } as const;
    // Descendants of a decision whose tracker claim is not verified start nothing.
    if (!(yield* claimReady(owner))) {
      return { type: "refused", refusal: "claim_not_ready" } as const;
    }
    const parent = owner;
    // A new counted execution meets the policy in force now; the parent keeps its own pins.
    const configuration = yield* latestConfiguration(parent.factoryId);
    if (Option.isNone(configuration)) {
      return { type: "refused", refusal: "configuration_changed" } as const;
    }
    if (!configuration.value.enabled) {
      return { type: "refused", refusal: "factory_paused" } as const;
    }
    const pool = configuration.value.pools.find((candidate) => candidate.poolId === parent.poolId);
    if (pool === undefined) return { type: "refused", refusal: "unknown_pool" } as const;
    // A descendant runs on a model the configuration in force now allows.
    if (
      !configuredSelections(configuration.value).some((selection) =>
        sameSelection(input.modelSelection, selection),
      )
    ) {
      return { type: "refused", refusal: "selection_not_configured" } as const;
    }
    const occupied = yield* occupiedUnits(parent.factoryId, parent.poolId);
    if (occupied + parent.units > pool.capacityUnits) {
      return { type: "refused", refusal: "capacity_exhausted" } as const;
    }
    const reservation: NativeReservation = {
      origin: "inherited",
      reservationId: makeReservationId(`reservation:${input.commandId}:${input.executionThreadId}`),
      factoryId: parent.factoryId,
      itemKey: parent.itemKey,
      poolId: parent.poolId,
      units: parent.units,
      state: "held",
      createdAt: DateTime.formatIso(yield* DateTime.now),
      parentReservationId: parent.reservationId,
      decisionKey: parent.decisionKey,
      configRevision: configuration.value.revision,
      modelSelection: input.modelSelection,
      execution: {
        commandId: input.commandId,
        threadId: input.executionThreadId,
        runId: input.runId,
        taskNodeId: input.taskNodeId,
      },
    };
    yield* insertReservation(reservation);
    return { type: "reserved", reservation } as const;
  });

  const recordThreadOrigin = Effect.fn("FactoryStore.recordThreadOrigin")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly createdFrom: OrchestrationV2ThreadCreatedFrom;
    }) {
      const owner =
        input.createdFrom.type === "thread"
          ? yield* originReservationFor(input.createdFrom.threadId)
          : yield* scheduleOrigin(input.createdFrom.scheduledTaskId);
      if (Option.isNone(owner) || !isNativeReservation(owner.value)) return;
      yield* sql`
        INSERT INTO factory_thread_origins (thread_id, reservation_id, recorded_at)
        VALUES (
          ${input.threadId}, ${owner.value.reservationId}, ${DateTime.formatIso(yield* DateTime.now)}
        )
        ON CONFLICT(thread_id) DO NOTHING
      `;
    },
    (effect) => effect.pipe(Effect.mapError(fail("record-thread-origin"))),
  );

  const reserveExecution = Effect.fn("FactoryStore.reserveExecution")(
    function* (input: ReserveExecutionInput) {
      return input.origin.type === "admission"
        ? yield* reserveAdmission(input, input.origin.admission)
        : yield* reserveDescendant(input, input.origin);
    },
    (effect) => effect.pipe(Effect.mapError(fail("reserve-execution"))),
  );

  // Only a carrier T3's own claim operation produced mirrors a native reservation; metadata in
  // the claim itself proves nothing, so every other claim is charged as an unknown observation.
  const recordClaim = Effect.fnUntraced(function* (
    input: ItemObservationInput,
    claim: typeof ObservedClaim.Type,
  ) {
    const operation = yield* sql<{ readonly reservation_id: FactoryReservationId }>`
      SELECT reservation_id FROM factory_claim_operations
      WHERE factory_id = ${input.factoryId} AND carrier_key = ${claim.carrierKey}
    `;
    if (operation[0] !== undefined) {
      const produced = yield* reservationById(operation[0].reservation_id);
      // Its later stages continue under it after a verified, settled outcome released it; any
      // other release leaves a claim that landed late with no native owner, so it is charged.
      if (
        Option.isSome(produced) &&
        isNativeReservation(produced.value) &&
        produced.value.itemKey === input.itemKey &&
        (produced.value.state === "held" || produced.value.releasedReason === "outcome_verified")
      ) {
        return;
      }
    }
    const existing = yield* sql`
      SELECT 1 FROM factory_reservations
      WHERE factory_id = ${input.factoryId} AND carrier_key = ${claim.carrierKey}
        AND origin = 'observed' AND state = 'held'
    `;
    if (existing.length > 0) return;
    yield* insertReservation({
      origin: "observed",
      // A carrier charged again after an earlier row was released is a new reservation.
      reservationId: makeReservationId(
        `reservation:observed:${input.factoryId}:${claim.carrierKey}:${input.generation}`,
      ),
      factoryId: input.factoryId,
      itemKey: input.itemKey,
      poolId: claim.poolId,
      units: claim.units,
      state: "held",
      createdAt: DateTime.formatIso(yield* DateTime.now),
      carrierKey: claim.carrierKey,
      generation: input.generation,
    });
  });

  const recordItemObservation = Effect.fn("FactoryStore.recordItemObservation")(
    function* (read: ItemObservationInput) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          // An owner's disposition of a carrier stands: it is no one's claim, so whoever reads the
          // item next (a collection pass, or a claim's own read before it writes) neither counts it
          // in the item's basis nor charges it again.
          const disposed = new Set(
            (yield* sql<{ readonly carrier_key: string }>`
              SELECT carrier_key FROM factory_carrier_dispositions WHERE factory_id = ${read.factoryId}
            `).map((row) => row.carrier_key),
          );
          const input = {
            ...read,
            claims: read.claims.filter((claim) => !disposed.has(claim.carrierKey)),
          };
          const allocated = yield* sql<{ readonly last_generation: number }>`
            SELECT last_generation FROM factory_read_generations WHERE factory_id = ${input.factoryId}
          `;
          if (allocated[0] === undefined || input.generation > allocated[0].last_generation) {
            return { type: "unknown_generation" } as const;
          }
          const basisDigest = basisDigestOf(input);
          const sameGeneration = yield* sql<{ readonly record_json: string }>`
            SELECT record_json FROM factory_item_observations
            WHERE factory_id = ${input.factoryId} AND item_key = ${input.itemKey}
              AND generation = ${input.generation}
          `;
          const recorded = yield* decodeOptional(decodeObservation, sameGeneration);
          if (Option.isSome(recorded)) {
            // A generation's read of an item is immutable: a replay returns it. A different
            // payload under the same token is not kept as an observation, but what it saw stays
            // binding: the conflict fences earlier bases and its claims are charged.
            if (
              recorded.value.basisDigest === basisDigest &&
              recorded.value.complete === input.complete
            ) {
              return { type: "recorded", observation: recorded.value } as const;
            }
            yield* sql`
              INSERT INTO factory_item_conflicts (
                factory_id, item_key, generation, basis_digest, record_json, observed_at
              ) VALUES (
                ${input.factoryId}, ${input.itemKey}, ${input.generation}, ${basisDigest},
                ${yield* encodeObservationInput(input)}, ${DateTime.formatIso(yield* DateTime.now)}
              )
              ON CONFLICT DO NOTHING
            `;
            for (const claim of input.claims) yield* recordClaim(input, claim);
            return { type: "conflict", recorded: recorded.value } as const;
          }
          const later = yield* sql<{ readonly record_json: string }>`
            SELECT record_json FROM factory_item_observations
            WHERE factory_id = ${input.factoryId} AND item_key = ${input.itemKey}
              AND generation > ${input.generation}
            ORDER BY generation DESC
            LIMIT 1
          `;
          const current = yield* decodeOptional(decodeObservation, later);
          if (Option.isSome(current)) {
            // The newer observation stays the item's record, but a carrier this read saw is still
            // positive evidence of someone's claim, so it is charged like any other read's.
            for (const claim of input.claims) yield* recordClaim(input, claim);
            return { type: "superseded", current: current.value } as const;
          }
          const observedAt = DateTime.formatIso(yield* DateTime.now);
          const rows = yield* sql<{ readonly observation_id: number }>`
            INSERT INTO factory_item_observations (
              factory_id, item_key, generation, complete, basis_digest, record_json, observed_at
            ) VALUES (
              ${input.factoryId}, ${input.itemKey}, ${input.generation}, ${input.complete ? 1 : 0},
              ${basisDigest}, '{}', ${observedAt}
            )
            RETURNING observation_id
          `;
          const observation: ItemObservation = {
            ...input,
            observationId: makeObservationId(rows[0]!.observation_id),
            basisDigest,
            observedAt,
          };
          yield* sql`
            UPDATE factory_item_observations
            SET record_json = ${yield* encodeObservation(observation)}
            WHERE observation_id = ${observation.observationId}
          `;
          for (const claim of input.claims) {
            yield* recordClaim(input, claim);
          }
          return { type: "recorded", observation } as const;
        }),
      );
    },
    (effect, input) =>
      effect.pipe(Effect.mapError(fail("record-item-observation", input.factoryId))),
  );

  const getObservation = Effect.fn("FactoryStore.getObservation")(
    function* (input: {
      readonly factoryId: FactoryId;
      readonly observationId: FactoryObservationId;
    }) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM factory_item_observations
        WHERE observation_id = ${input.observationId} AND factory_id = ${input.factoryId}
      `;
      return yield* decodeOptional(decodeObservation, rows);
    },
    (effect, input) => effect.pipe(Effect.mapError(fail("get-observation", input.factoryId))),
  );

  const observationsAfter = Effect.fn("FactoryStore.observationsAfter")(
    function* (input: {
      readonly factoryId: FactoryId;
      readonly observationId: FactoryObservationId;
    }) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT later.record_json FROM factory_item_observations AS later
        JOIN factory_item_observations AS named ON named.observation_id = ${input.observationId}
        WHERE later.factory_id = ${input.factoryId} AND later.item_key = named.item_key
          AND later.generation > named.generation
        ORDER BY later.generation ASC
      `;
      return yield* Effect.forEach(rows, (row) => decodeObservation(row.record_json));
    },
    (effect, input) => effect.pipe(Effect.mapError(fail("observations-after", input.factoryId))),
  );

  const recordClaimOperation = Effect.fn("FactoryStore.recordClaimOperation")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly carrierKey: FactoryClaimCarrierKey;
    }) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const reservation = yield* reservationById(input.reservationId);
          if (Option.isNone(reservation) || !isNativeReservation(reservation.value)) return false;
          yield* sql`
            INSERT INTO factory_claim_operations (factory_id, carrier_key, reservation_id)
            VALUES (${reservation.value.factoryId}, ${input.carrierKey}, ${input.reservationId})
            ON CONFLICT(factory_id, carrier_key) DO NOTHING
          `;
          return true;
        }),
      );
    },
    (effect) => effect.pipe(Effect.mapError(fail("record-claim-operation"))),
  );

  const listReservations = Effect.fn("FactoryStore.listReservations")(
    function* (factoryId: FactoryId) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM factory_reservations
        WHERE factory_id = ${factoryId}
        ORDER BY created_at, reservation_id
      `;
      return yield* Effect.forEach(rows, (row) => decodeReservation(row.record_json));
    },
    (effect, factoryId) => effect.pipe(Effect.mapError(fail("list-reservations", factoryId))),
  );

  const findAdmission = Effect.fn("FactoryStore.findAdmission")(
    function* (input: { readonly factoryId: FactoryId; readonly decisionKey: FactoryDecisionKey }) {
      const rows = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM factory_reservations
        WHERE factory_id = ${input.factoryId} AND decision_key = ${input.decisionKey}
          AND origin = 'admitted'
      `;
      return yield* decodeOptional(decodeReservation, rows);
    },
    (effect, input) => effect.pipe(Effect.mapError(fail("find-admission", input.factoryId))),
  );

  const recordScheduleOrigin = Effect.fn("FactoryStore.recordScheduleOrigin")(
    function* (input: {
      readonly scheduledTaskId: ScheduledTaskId;
      readonly callerThreadId: ThreadId;
    }) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const owner = yield* bindingForThread(input.callerThreadId);
          if (Option.isSome(owner)) {
            yield* sql`
              INSERT INTO factory_schedule_origins (scheduled_task_id, reservation_id)
              VALUES (${input.scheduledTaskId}, ${owner.value.reservationId})
              ON CONFLICT(scheduled_task_id) DO NOTHING
            `;
          }
          return yield* scheduleOrigin(input.scheduledTaskId);
        }),
      );
    },
    (effect) => effect.pipe(Effect.mapError(fail("record-schedule-origin"))),
  );

  return FactoryStore.of({
    configure,
    getConfiguration: Effect.fn("FactoryStore.getConfiguration")(function (factoryId) {
      return latestConfiguration(factoryId).pipe(
        Effect.mapError(fail("get-configuration", factoryId)),
      );
    }),
    listConfigurations: Effect.fn("FactoryStore.listConfigurations")(function () {
      return listConfigurations().pipe(Effect.mapError(fail("list-configurations")));
    }),
    beginCollection,
    recordItemObservation,
    getObservation,
    reserveExecution,
    recordClaimOperation,
    listReservations,
    findAdmission,
    recordScheduleOrigin,
    recordThreadOrigin,
    scheduleOrigin: Effect.fn("FactoryStore.scheduleOrigin")(function (scheduledTaskId) {
      return scheduleOrigin(scheduledTaskId).pipe(Effect.mapError(fail("schedule-origin")));
    }),
    bindingForThread: Effect.fn("FactoryStore.bindingForThread")(function (threadId) {
      return bindingForThread(threadId).pipe(Effect.mapError(fail("binding-for-thread")));
    }),
    isClaimReady: Effect.fn("FactoryStore.isClaimReady")(function (reservation) {
      return claimReady(reservation).pipe(Effect.mapError(fail("claim-ready")));
    }),
    releaseReservation: Effect.fn("FactoryStore.releaseReservation")(
      function (reservationId, reason) {
        return releaseReservation(reservationId, reason).pipe(
          Effect.mapError(fail("release-reservation")),
        );
      },
    ),
    observationsAfter,
    openWorkspaceObligation: Effect.fn("FactoryStore.openWorkspaceObligation")(
      function* (input: {
        readonly runId: RunId;
        readonly reservationId: FactoryReservationId;
        readonly threadId: ThreadId;
        readonly commandId: CommandId;
        readonly ownerId: PreparationOwnerId;
      }) {
        const obligation: WorkspaceObligation = {
          ...input,
          openedAt: DateTime.formatIso(yield* DateTime.now),
          state: "open",
        };
        yield* sql`
          INSERT INTO factory_workspace_obligations (
            run_id, reservation_id, thread_id, owner_id, state, record_json
          ) VALUES (
            ${input.runId}, ${input.reservationId}, ${input.threadId}, ${input.ownerId}, 'open',
            ${yield* encodeWorkspaceObligation(obligation)}
          )
        `;
      },
      Effect.mapError(fail("open-workspace-obligation")),
    ),
    settleWorkspaceObligation: Effect.fn("FactoryStore.settleWorkspaceObligation")(
      function* (input: {
        readonly runId: RunId;
        readonly ownerId: PreparationOwnerId;
        readonly scope:
          | { readonly type: "no_external_work" }
          | { readonly type: "contained"; readonly generationId: string };
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<{ readonly record_json: string }>`
              SELECT record_json FROM factory_workspace_obligations
              WHERE run_id = ${input.runId} AND owner_id = ${input.ownerId} AND state = 'open'
            `;
            if (rows[0] === undefined) return false;
            const open = yield* decodeWorkspaceObligation(rows[0].record_json);
            const settled: WorkspaceObligation = {
              runId: open.runId,
              reservationId: open.reservationId,
              threadId: open.threadId,
              commandId: open.commandId,
              ownerId: open.ownerId,
              openedAt: open.openedAt,
              ...(open.priorOwners === undefined ? {} : { priorOwners: open.priorOwners }),
              state: "settled",
              ...(input.scope.type === "contained"
                ? { scope: "contained" as const, generationId: input.scope.generationId }
                : { scope: "no_external_work" as const }),
              settledAt: DateTime.formatIso(yield* DateTime.now),
            };
            const updated = yield* sql`
              UPDATE factory_workspace_obligations
              SET state = 'settled', record_json = ${yield* encodeWorkspaceObligation(settled)}
              WHERE run_id = ${input.runId} AND owner_id = ${input.ownerId} AND state = 'open'
              RETURNING run_id
            `;
            return updated.length === 1;
          }),
        );
      },
      Effect.mapError(fail("settle-workspace-obligation")),
    ),
    workspaceObligation: Effect.fn("FactoryStore.workspaceObligation")(
      function* (runId: RunId) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_workspace_obligations WHERE run_id = ${runId}
        `;
        return rows[0] === undefined
          ? Option.none<WorkspaceObligation>()
          : Option.some(yield* decodeWorkspaceObligation(rows[0].record_json));
      },
      Effect.mapError(fail("workspace-obligation")),
    ),
    openWorkspaceObligations: Effect.fn("FactoryStore.openWorkspaceObligations")(
      function* (reservationId: FactoryReservationId) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_workspace_obligations
          WHERE reservation_id = ${reservationId} AND state = 'open'
          ORDER BY rowid
        `;
        return yield* Effect.forEach(rows, (row) => decodeWorkspaceObligation(row.record_json));
      },
      Effect.mapError(fail("open-workspace-obligations")),
    ),
    reownWorkspaceObligation: Effect.fn("FactoryStore.reownWorkspaceObligation")(
      function* (input: {
        readonly runId: RunId;
        readonly fromOwnerId: PreparationOwnerId;
        readonly toOwnerId: PreparationOwnerId;
        readonly endedGenerations: ReadonlyArray<string>;
      }) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_workspace_obligations
          WHERE run_id = ${input.runId} AND owner_id = ${input.fromOwnerId} AND state = 'open'
        `;
        if (rows[0] === undefined) return false;
        const open = yield* decodeWorkspaceObligation(rows[0].record_json);
        const reowned: WorkspaceObligation = {
          ...open,
          ownerId: input.toOwnerId,
          priorOwners: [
            ...(open.priorOwners ?? []),
            {
              ownerId: input.fromOwnerId,
              endedGenerations: [...input.endedGenerations],
              recoveredAt: DateTime.formatIso(yield* DateTime.now),
            },
          ],
        };
        const updated = yield* sql`
          UPDATE factory_workspace_obligations
          SET owner_id = ${input.toOwnerId}, record_json = ${yield* encodeWorkspaceObligation(reowned)}
          WHERE run_id = ${input.runId} AND owner_id = ${input.fromOwnerId} AND state = 'open'
          RETURNING run_id
        `;
        return updated.length === 1;
      },
      Effect.mapError(fail("reown-workspace-obligation")),
    ),
    releaseObservedCarrier: Effect.fn("FactoryStore.releaseObservedCarrier")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly carrierKey: FactoryClaimCarrierKey;
      }) {
        const rows = yield* sql<{ readonly reservation_id: FactoryReservationId }>`
          SELECT reservation_id FROM factory_reservations
          WHERE factory_id = ${input.factoryId} AND carrier_key = ${input.carrierKey}
            AND origin = 'observed' AND state = 'held'
        `;
        for (const row of rows)
          yield* releaseReservation(row.reservation_id, "attested_native_mirror");
      },
      Effect.mapError(fail("release-observed-carrier")),
    ),
    disposeObservedReservation: Effect.fn("FactoryStore.disposeObservedReservation")(
      function* (input: {
        readonly reservationId: FactoryReservationId;
        readonly by: string;
        readonly reason: string;
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const reservation = yield* reservationById(input.reservationId);
            if (Option.isNone(reservation) || reservation.value.state !== "held") return false;
            // Transferred custody holds no carrier: releasing it is the whole disposition.
            if (reservation.value.origin === "transferred") {
              return yield* releaseReservation(input.reservationId, "owner_disposition");
            }
            if (reservation.value.origin !== "observed") return false;
            const { factoryId, carrierKey } = reservation.value;
            yield* releaseReservation(input.reservationId, "owner_disposition");
            const disposition = yield* encodeDisposition({
              carrierKey,
              reservationId: input.reservationId,
              by: input.by,
              reason: input.reason,
              disposedAt: DateTime.formatIso(yield* DateTime.now),
            });
            yield* sql`
              INSERT INTO factory_carrier_dispositions (factory_id, carrier_key, record_json)
              VALUES (${factoryId}, ${carrierKey}, ${disposition})
              ON CONFLICT(factory_id, carrier_key) DO NOTHING
            `;
            return true;
          }),
        );
      },
      Effect.mapError(fail("dispose-observed-reservation")),
    ),
    issueGrant: Effect.fn("FactoryStore.issueGrant")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly itemKey: FactoryItemKey;
        readonly stage: string;
        readonly evidenceDigest: string;
        readonly units: number;
        readonly decisionId: string;
        readonly by: string;
      }) {
        const grant: FactoryGrant = {
          grantId: `grant:${input.decisionId}`,
          factoryId: input.factoryId,
          itemKey: input.itemKey,
          stage: input.stage,
          evidenceDigest: input.evidenceDigest,
          units: input.units,
          remaining: input.units,
          state: "active",
          decisionId: input.decisionId,
          issuedBy: input.by,
          issuedAt: DateTime.formatIso(yield* DateTime.now),
          spentBy: [],
        };
        yield* sql`
          INSERT INTO factory_grants (grant_id, factory_id, item_key, state, remaining, record_json)
          VALUES (
            ${grant.grantId}, ${grant.factoryId}, ${grant.itemKey}, 'active', ${grant.remaining},
            ${yield* encodeGrant(grant)}
          )
          ON CONFLICT(grant_id) DO NOTHING
        `;
        return Option.getOrThrow(yield* readGrant(grant.grantId));
      },
      Effect.mapError(fail("issue-grant")),
    ),
    listGrants: Effect.fn("FactoryStore.listGrants")(
      function* (factoryId: FactoryId) {
        const rows = yield* sql<{ readonly record_json: string }>`
          SELECT record_json FROM factory_grants WHERE factory_id = ${factoryId} ORDER BY rowid
        `;
        return yield* Effect.forEach(rows, (row) => decodeGrant(row.record_json));
      },
      Effect.mapError(fail("list-grants")),
    ),
    revokeGrant: Effect.fn("FactoryStore.revokeGrant")(
      function* (input: { readonly grantId: string; readonly by: string }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const grant = yield* readGrant(input.grantId);
            if (Option.isNone(grant) || grant.value.state !== "active") return false;
            yield* writeGrant({
              ...grant.value,
              state: "revoked",
              revoked: { by: input.by, at: DateTime.formatIso(yield* DateTime.now) },
            });
            return true;
          }),
        );
      },
      Effect.mapError(fail("revoke-grant")),
    ),
    holdTransferredCustody: Effect.fn("FactoryStore.holdTransferredCustody")(
      function* (input: {
        readonly factoryId: FactoryId;
        readonly itemKey: FactoryItemKey;
        readonly transferId: string;
        readonly job: string;
        readonly poolId: FactoryPoolId;
        readonly units: number;
        readonly worker?: { readonly workId: string; readonly threadId: ThreadId | null };
        /** The owner already accounted for this worker: released at once, still bound. */
        readonly historical?: boolean;
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const reservationId = FactoryReservationId.make(
              `reservation:transferred:${input.transferId}:${input.worker?.workId ?? input.itemKey}`,
            );
            const existing = yield* reservationById(reservationId);
            if (Option.isSome(existing)) return existing.value;
            const threadId = input.worker?.threadId ?? null;
            const held: FactoryReservation = {
              origin: "transferred",
              reservationId,
              factoryId: input.factoryId,
              itemKey: input.itemKey,
              poolId: input.poolId,
              units: input.units,
              state: "held",
              createdAt: DateTime.formatIso(yield* DateTime.now),
              transferId: input.transferId,
              job: input.job,
              ...(input.worker === undefined ? {} : { workId: input.worker.workId }),
              ...(threadId === null ? {} : { threadId }),
            };
            yield* insertReservation(held);
            if (threadId !== null) {
              yield* sql`
                INSERT INTO factory_thread_bindings (thread_id, reservation_id)
                VALUES (${threadId}, ${reservationId})
                ON CONFLICT(thread_id) DO UPDATE SET reservation_id = excluded.reservation_id
              `;
            }
            if (input.historical === true) {
              yield* releaseReservation(reservationId, "owner_disposition");
            }
            return Option.getOrThrow(yield* reservationById(reservationId));
          }),
        );
      },
      Effect.mapError(fail("hold-transferred-custody")),
    ),
    releaseTransferredCustody: Effect.fn("FactoryStore.releaseTransferredCustody")(
      function* (input: { readonly factoryId: FactoryId; readonly transferId: string }) {
        for (const reservation of yield* listReservations(input.factoryId)) {
          if (reservation.origin !== "transferred" || reservation.transferId !== input.transferId) {
            continue;
          }
          yield* releaseReservation(reservation.reservationId, "rolled_back");
          // The legacy writer owns its workers again, starts included.
          yield* sql`
            DELETE FROM factory_thread_bindings WHERE reservation_id = ${reservation.reservationId}
          `;
        }
      },
      Effect.mapError(fail("release-transferred-custody")),
    ),
    disposedCarriers: Effect.fn("FactoryStore.disposedCarriers")(
      function* (factoryId: FactoryId) {
        const rows = yield* sql<{ readonly carrier_key: string }>`
          SELECT carrier_key FROM factory_carrier_dispositions WHERE factory_id = ${factoryId}
        `;
        return new Set(rows.map((row) => row.carrier_key));
      },
      Effect.mapError(fail("disposed-carriers")),
    ),
    getReservation: Effect.fn("FactoryStore.getReservation")(function (reservationId) {
      return reservationById(reservationId).pipe(Effect.mapError(fail("get-reservation")));
    }),
  });
});

export const layer = Layer.effect(FactoryStore, make);
