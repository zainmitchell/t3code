// @effect-diagnostics nodeBuiltinImport:off - every identity here is a sha256 digest.
import * as NodeCrypto from "node:crypto";

import * as Schema from "effect/Schema";

import type * as FactoryOperationStore from "./FactoryOperationStore.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { canonical } from "./factoryOutcomes.ts";

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

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

/** One item's outcomes as the engine recorded them, with their receipt-proved landings. */
export interface ItemRecord {
  readonly itemKey: string;
  readonly outcomes: ReadonlyArray<
    FactoryOutcomeStore.FactoryOutcome & { readonly landingOrigin?: LandingOrigin }
  >;
  readonly events?: ReadonlyArray<
    | { readonly type: "rejected"; readonly outcomeId: string }
    | { readonly type: "reopened"; readonly closureOutcomeId: string }
  >;
}

export interface Landing {
  readonly itemKey: string;
  readonly operationId: string;
  readonly commit: string;
  readonly tree: string;
  readonly parents: ReadonlyArray<string>;
  readonly branch: string;
  readonly reviewedHead: string;
  readonly reviewOutcomeId: string;
  readonly integratedOutcomeId: string;
}

const isVerified = (outcome: FactoryOutcomeStore.FactoryOutcome, kind: string) =>
  outcome.state === "verified" && outcome.report.outcome === kind;

/**
 * The landing an item's own records prove: its latest verified build, a later unrejected review
 * of exactly that head, a later receipt-proved integration carrying it, and no reopened closure
 * since. The same rule the policy applies, read from the engine's records instead of its input.
 */
export const landingOf = (
  record: ItemRecord,
): { readonly landing: Landing } | { readonly why: string } => {
  const { outcomes } = record;
  const rejected = new Set(
    (record.events ?? []).flatMap((event) => (event.type === "rejected" ? [event.outcomeId] : [])),
  );
  const reopened = new Set(
    (record.events ?? []).flatMap((event) =>
      event.type === "reopened" ? [event.closureOutcomeId] : [],
    ),
  );
  const last = (test: (outcome: (typeof outcomes)[number]) => boolean, after = -1) => {
    for (let index = outcomes.length - 1; index > after; index--) {
      if (test(outcomes[index]!)) return index;
    }
    return undefined;
  };
  const at = last(
    (outcome) =>
      isVerified(outcome, "implemented") &&
      (outcome.stage === "implement" || outcome.stage === "rework"),
  );
  if (at === undefined) return { why: "it has no verified implemented head" };
  const built = outcomes[at]!;
  const head = built.report.subject?.headCommit;
  if (head === undefined)
    return { why: `its implemented outcome ${built.outcomeId} names no head` };
  if (rejected.has(built.outcomeId)) {
    return { why: `its implemented outcome ${built.outcomeId} was rejected` };
  }
  const rv = last(
    (outcome) =>
      isVerified(outcome, "review_passed") &&
      outcome.report.subject?.headCommit === head &&
      !rejected.has(outcome.outcomeId),
    at,
  );
  if (rv === undefined)
    return { why: `its head ${head} has no verified independent review_passed` };
  const review = outcomes[rv]!;
  const ig = last(
    (outcome) => isVerified(outcome, "integrated") && outcome.stage === "integrate",
    rv,
  );
  if (ig === undefined) {
    return { why: `its reviewed head ${head} is accepted (${review.outcomeId}) but not landed` };
  }
  const integrated = outcomes[ig]!;
  const receipt = integrated.report.integration;
  if (rejected.has(integrated.outcomeId)) {
    return { why: `its integration ${integrated.outcomeId} was rejected` };
  }
  if (integrated.landingOrigin === undefined || receipt === undefined) {
    return { why: `no applied receipt proves its integration ${integrated.outcomeId}` };
  }
  if (!receipt.parents.includes(head) && receipt.mergeCommit !== head) {
    return { why: `its integration ${integrated.outcomeId} does not carry reviewed head ${head}` };
  }
  const later = outcomes
    .slice(ig + 1)
    .find((outcome) => isVerified(outcome, "closed") && reopened.has(outcome.outcomeId));
  if (later !== undefined) return { why: `its closure ${later.outcomeId} was reopened` };
  return {
    landing: {
      itemKey: record.itemKey,
      operationId: integrated.landingOrigin.operationId,
      commit: receipt.mergeCommit,
      tree: receipt.tree,
      parents: receipt.parents,
      branch: receipt.targetBranch,
      reviewedHead: head,
      reviewOutcomeId: review.outcomeId,
      integratedOutcomeId: integrated.outcomeId,
    },
  };
};

/** The verified failure a correction spec answers: the latest real failure before it. */
export const failureAnswered = (
  outcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>,
  specOutcomeId: string,
) => {
  const index = outcomes.findIndex((outcome) => outcome.outcomeId === specOutcomeId);
  if (index < 0) return undefined;
  return outcomes
    .slice(0, index)
    .findLast(
      (outcome) =>
        outcome.stage !== "correct" &&
        (isVerified(outcome, "failed") || isVerified(outcome, "review_failed")),
    );
};

/** The correction child T3 opened for a failure: the first ticket after it naming its basis. */
export const defectChild = (
  itemKey: string,
  outcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>,
  failed: FactoryOutcomeStore.FactoryOutcome,
) => {
  const failureSha256 = sha256(failed.report.failure ?? failed.report.summary);
  const basis = sha256(canonical({ itemKey, failedOutcomeId: failed.outcomeId, failureSha256 }));
  const token = `[defect ${basis.slice(0, 12)}]`;
  const start = outcomes.indexOf(failed);
  return outcomes
    .slice(start + 1)
    .find(
      (outcome) => isVerified(outcome, "ticket_opened") && outcome.report.summary.includes(token),
    )?.report.ticket?.number;
};

/** The child T3 opened on a parent for one clause, named by the token the policy titled it with. */
export const criterionToken = (parent: number, clause: string) =>
  `[criterion ${clause} ${sha256(canonical({ parent, clause })).slice(0, 12)}]`;

/** A Root-adopted file a policy points at: read only inside its root and only with this sha256. */
export interface PinnedFile {
  readonly root: string;
  readonly path: string;
  readonly sha256: string;
}

const Inputs = Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String }));
const Consumer = Schema.Struct({ contract: Schema.String, version: Schema.String });

/** Root-adopted stable semantics of a bound verification; T3 derives every per-run fact. */
const VerificationTemplate = Schema.Struct({
  schema: Schema.Literal("factory-verification-template/1"),
  issue: Schema.Int,
  prerequisite: Schema.optional(Schema.Int),
  worker: Schema.Struct({ execution: Schema.String }),
  auth: Schema.Struct({ identity: Schema.String }),
  inputs: Inputs,
  consumer: Consumer,
  policyIdentity: Schema.String,
  ownership: Schema.Struct({ owned: Schema.Array(Schema.String) }),
});

/** A binding pinned whole for one failure; every field is checked against T3's own facts. */
const VerificationBinding = Schema.Struct({
  schema: Schema.Literal("factory-verification-binding/1"),
  issue: Schema.Int,
  failedOutcomeId: Schema.String,
  prerequisite: Schema.optional(Schema.Unknown),
  landed: Schema.Struct({
    itemKey: Schema.String,
    operationId: Schema.String,
    commit: Schema.String,
    tree: Schema.String,
    parents: Schema.Array(Schema.String),
    branch: Schema.String,
    reviewedHead: Schema.String,
    reviewOutcomeId: Schema.String,
    integratedOutcomeId: Schema.String,
  }),
  source: Schema.Struct({ repository: Schema.String, commit: Schema.String }),
  worker: Schema.Struct({ execution: Schema.String }),
  auth: Schema.Struct({ identity: Schema.String }),
  inputs: Inputs,
  consumer: Consumer,
  policyRevision: Schema.String,
  ownership: Schema.Struct({ owned: Schema.Array(Schema.String) }),
  outputRoot: Schema.String,
});

export const decodeVerificationDocument = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([VerificationTemplate, VerificationBinding])),
);
export type VerificationDocument =
  | typeof VerificationTemplate.Type
  | typeof VerificationBinding.Type;

/** A policy identity names the installed revision, whole or without its trailing config pin. */
export const namesPolicy = (identity: string, installed: string) =>
  identity === installed ||
  (installed.startsWith(`${identity}:`) &&
    /^[0-9a-f]{16}$/.test(installed.slice(identity.length + 1)));

/** A bound verification's output directory: fresh for each failure, landing and template. */
export const outputRootName = (input: {
  readonly issue: number;
  readonly itemKey: string;
  readonly failedOutcomeId: string;
  readonly commit: string;
  readonly templateSha256: string;
}) =>
  `${input.issue}-${sha256(
    [input.itemKey, input.failedOutcomeId, input.commit, input.templateSha256].join("|"),
  ).slice(0, 16)}`;

/** The stage-basis suffix that makes a binding and its output root part of the decision. */
export const bindingBasis = (bindingDigest: string, outputRoot: string) =>
  `|vb:${bindingDigest.slice(0, 32)}|out:${outputRootDigest(outputRoot)}`;

export const outputRootDigest = (outputRoot: string) =>
  sha256(outputRoot.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()).slice(0, 32);

/**
 * One wait: what is missing, who acts, what they do, and what resumes it, with a basis that is
 * the same while those are. The skeleton matches the policy's own waits.
 */
export const waitText = (input: {
  readonly issue: number;
  readonly what: string;
  readonly actor: string;
  readonly action: string;
  readonly consequence: string;
  readonly resume: string;
}) =>
  `#${input.issue} waits [${sha256(canonical(input)).slice(0, 12)}]: ${input.what}. Actor: ${input.actor}. Action: ${input.action}. Consequence: ${input.consequence}. Resume: ${input.resume}.`.slice(
    0,
    2_000,
  );

const Criteria = Schema.Struct({
  schema: Schema.Literal("factory-parent-criteria/1"),
  issue: Schema.Int,
  version: Schema.String,
  bodySha256: Schema.String,
  clauses: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      required: Schema.Boolean,
      source: Schema.Struct({ kind: Schema.String, ref: Schema.String }),
      state: Schema.optional(Schema.Literals(["open", "reserved", "revised"])),
      evidence: Schema.optional(
        Schema.Array(Schema.Struct({ itemKey: Schema.String, scope: Schema.String })),
      ),
    }),
  ),
});
export const decodeCriteria = Schema.decodeUnknownOption(Schema.fromJsonString(Criteria));
export type Criteria = typeof Criteria.Type;

export interface ClauseStatus {
  readonly id: string;
  readonly required: boolean;
  readonly status: "satisfied" | "missing" | "reserved" | "revised" | "unknown_source";
  /** Each landing that proves it, with the scope its evidence was adopted for. */
  readonly landed: ReadonlyArray<Landing & { readonly scope: string }>;
  readonly why?: string;
}

/**
 * Every clause of a parent's adopted criteria, judged only by landings in T3's own records: the
 * clause's adopted evidence and the child T3 opened for it. A child known only by membership, an
 * item T3 holds no record of, or a landing it cannot prove leaves the clause unproved.
 */
export const reconcileCriteria = (input: {
  readonly criteria: Criteria;
  readonly repository: string;
  readonly parentOutcomes: ReadonlyArray<FactoryOutcomeStore.FactoryOutcome>;
  readonly records: ReadonlyMap<string, ItemRecord>;
}): ReadonlyArray<ClauseStatus> =>
  input.criteria.clauses.map((clause) => {
    const base = { id: clause.id, required: clause.required, landed: [] };
    if (clause.state === "revised") return { ...base, status: "revised" };
    if (clause.state === "reserved") return { ...base, status: "reserved" };
    const token = criterionToken(input.criteria.issue, clause.id);
    const child = input.parentOutcomes.find(
      (outcome) => isVerified(outcome, "ticket_opened") && outcome.report.summary.includes(token),
    )?.report.ticket?.number;
    const evidence = [
      ...(clause.evidence ?? []),
      ...(child === undefined
        ? []
        : [
            {
              itemKey: `github:${input.repository}#${child}`,
              scope: `criterion ${clause.id} child`,
            },
          ]),
    ];
    if (evidence.length === 0) return { ...base, status: "missing", why: "no evidence item" };
    const landed: Array<Landing & { readonly scope: string }> = [];
    for (const item of evidence) {
      const record = input.records.get(item.itemKey);
      if (record === undefined) {
        return { ...base, status: "unknown_source", why: `T3 holds no record of ${item.itemKey}` };
      }
      const found = landingOf(record);
      if ("why" in found)
        return { ...base, status: "missing", why: `${item.itemKey}: ${found.why}` };
      landed.push({ ...found.landing, scope: item.scope });
    }
    return { ...base, status: "satisfied", landed };
  });
