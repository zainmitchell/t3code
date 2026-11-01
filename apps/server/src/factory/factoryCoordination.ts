// @effect-diagnostics nodeBuiltinImport:off - every identity here is a sha256 digest.
import * as NodeCrypto from "node:crypto";

import { FactoryClauseUnit, type FactoryCriteriaProposal } from "@t3tools/contracts";
import * as Result from "effect/Result";
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
  // A pull request integration whose base already holds the reviewed head records that head as a
  // git landing made outside it (`reviewedHeadInBase`), with no pull request merged.
  const alreadyInBase =
    intent.kind === "pull_request_merge" &&
    receipt.kind === "git_integrate" &&
    receipt.attribution === "external" &&
    receipt.commit === intent.reviewedHead;
  if (
    (intent.kind !== "git_integrate" && intent.kind !== "pull_request_merge") ||
    (receipt.kind !== "git_integrate" && receipt.kind !== "pull_request_merge") ||
    (receipt.kind !== intent.kind && !alreadyInBase) ||
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
  /** The retry attempt this root is for (`attemptOf` the basis); a first attempt names none. */
  readonly attempt?: string | undefined;
}) =>
  `${input.issue}-${sha256(
    [
      input.itemKey,
      input.failedOutcomeId,
      input.commit,
      input.templateSha256,
      // A root is one attempt's for ever; a retry derives its own, under the same first-attempt name.
      ...(input.attempt === undefined ? [] : [input.attempt]),
    ].join("|"),
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
      /** Who must act for a reserved clause; decoded, so a hold is never stripped as excess. */
      reserved: Schema.optional(
        Schema.Struct({ actor: Schema.String, action: Schema.String, resume: Schema.String }),
      ),
      revision: Schema.optional(Schema.String),
      /** The adopted clause-unit shape; Root's no-edit unit owns no paths. */
      unit: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            title: Schema.String,
            contract: Schema.String,
            paths: Schema.optional(Schema.Array(Schema.String)),
          }),
        ),
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

// Parent criteria preparation (factory-parent-preparation/1). Offsets are Unicode code points and
// whitespace is Python's, so these reads equal the preparation module's for the same text.
const SPACE =
  "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const SPACES = new RegExp(`${SPACE}+`, "u");
const EDGE_SPACES = new RegExp(`^${SPACE}+|${SPACE}+$`, "gu");
const strip = (text: string) => text.replace(EDGE_SPACES, "");
const normalized = (text: string) =>
  text
    .split(SPACES)
    .filter((part) => part !== "")
    .join(" ");
const codePoints = (text: string) => [...text];

const ACCEPTANCE_TITLE = /^(?:acceptance(?: checks| criteria)?|completion criteria):?$/i;
const HEADING = /^(#{1,6})[ \t]+([^\n]*?)[ \t]*#*[ \t]*$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ITEM = /^ {0,3}(?:[-*+]|\p{Nd}{1,3}[.)])[ \t]+(?:\[([ xX])\][ \t]+)?/u;
const BOLD_LABEL = /^\*\*([^*\n]{1,80}?)\*\*/u;
const PLAIN_LABEL = /^([A-Za-z0-9][\p{L}\p{N}_/-]*(?: [\p{L}\p{N}_/-]+){0,3}):[ \t]/u;
const CITATION = /\/issues\/([0-9]+)#issuecomment-([0-9]+)(?![\p{L}\p{N}_])/gu;
const DETAILS_TAG = /<details(?:\s+[^<>]*)?>|<\/details\s*>/gi;
const DETAILS_FRAGMENT = /<\/?details/i;

export interface AcceptanceItem {
  readonly start: number;
  readonly end: number;
  readonly checked: boolean;
  readonly excerpt: string;
  readonly sha256: string;
  readonly anchor: string;
}

/** A heading's anchor: the fragment a clause's `source.ref` names it by. */
const headingAnchor = (title: string) =>
  strip(
    title
      .replace(/:+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, ""),
  ).replaceAll(" ", "-");

const NO_ANCHORS: ReadonlySet<string> = new Set();

/**
 * The current acceptance of an issue body: each top-level list item under an Acceptance,
 * Acceptance checks, Acceptance criteria or Completion criteria heading, or a heading whose anchor
 * is in `anchors`, with its exact span. `<details>` and fenced text are never read; text after a
 * first item that belongs to none is `unlisted`.
 */
export const parentAcceptance = (body: string, anchors: ReadonlySet<string> = NO_ANCHORS) => {
  interface Section {
    readonly anchor: string;
    readonly items: Array<{ start: number; end: number; checked: boolean }>;
    readonly unlisted: Array<string>;
  }
  const sections: Array<Section> = [];
  let current: Section | undefined;
  let item: { start: number; end: number; checked: boolean } | undefined;
  let fence: string | undefined;
  let depth = 0;
  let blank = false;
  const closeItem = () => {
    if (item !== undefined) current?.items.push(item);
    item = undefined;
  };
  let at = 0;
  let offset = 0;
  while (at < body.length) {
    const newline = body.indexOf("\n", at);
    const raw = newline < 0 ? body.slice(at) : body.slice(at, newline + 1);
    const start = offset;
    at += raw.length;
    offset += codePoints(raw).length;
    const line = raw.replace(/[\r\n]+$/, "");
    const end = start + codePoints(line).length;
    const opened = FENCE.exec(line);
    if (fence !== undefined) {
      if (opened !== null && opened[1]![0] === fence[0] && opened[1]!.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (opened !== null) {
      fence = opened[1]!;
      continue;
    }
    const tags = [...line.matchAll(DETAILS_TAG)];
    if (tags.length > 0 || depth > 0 || DETAILS_FRAGMENT.test(line)) {
      const before = depth;
      const outside: Array<string> = [];
      let position = 0;
      let malformed = DETAILS_FRAGMENT.test(line.replace(DETAILS_TAG, ""));
      for (const tag of tags) {
        if (depth === 0) outside.push(line.slice(position, tag.index));
        if (tag[0].startsWith("</")) {
          if (depth === 0) malformed = true;
          else depth--;
        } else depth++;
        position = tag.index + tag[0].length;
      }
      if (depth === 0) outside.push(line.slice(position));
      if (current !== undefined) {
        if (before === 0 && tags.length > 0) closeItem();
        if (malformed || outside.some((part) => strip(part) !== ""))
          current.unlisted.push(strip(line));
      }
      blank = true;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      if (current !== undefined) closeItem();
      current = undefined;
      const title = strip(heading[2]!);
      const anchor = headingAnchor(title);
      if (ACCEPTANCE_TITLE.test(title) || anchors.has(anchor)) {
        current = { anchor, items: [], unlisted: [] };
        sections.push(current);
      }
      continue;
    }
    if (current === undefined) continue;
    if (strip(line) === "") {
      blank = true;
      continue;
    }
    const marker = line.length - line.replace(/^ +/, "").length <= 1 ? ITEM.exec(line) : null;
    if (marker !== null) {
      closeItem();
      item = {
        start: start + codePoints(marker[0]).length,
        end,
        checked: /x/i.test(marker[1] ?? ""),
      };
    } else if (item !== undefined && (!blank || line.startsWith(" ") || line.startsWith("\t"))) {
      item.end = end;
    } else if (item === undefined && current.items.length === 0) {
      // A preamble before the first item is not acceptance.
    } else {
      closeItem();
      current.unlisted.push(strip(line));
    }
    blank = false;
  }
  if (current !== undefined) {
    closeItem();
    if (depth > 0) current.unlisted.push("unclosed details block");
  }
  const characters = codePoints(body);
  return {
    items: sections.flatMap((section) =>
      section.items.map((found): AcceptanceItem => {
        const excerpt = characters.slice(found.start, found.end).join("");
        return { ...found, excerpt, sha256: sha256(excerpt), anchor: section.anchor };
      }),
    ),
    unlisted: sections.flatMap((section) => section.unlisted),
  };
};

const labelOf = (excerpt: string) => {
  const found = BOLD_LABEL.exec(excerpt) ?? PLAIN_LABEL.exec(excerpt);
  if (found === null) return undefined;
  const slug = strip(found[1]!)
    .replace(/[:.]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? undefined : slug;
};

/** The comments an acceptance item cites on its own issue, by complete receipt, in id order. */
const citedBy = (excerpt: string, issue: number) => [
  ...new Set(
    [...excerpt.matchAll(CITATION)]
      .filter((match) => match[1] === String(issue))
      .map((match) => match[2]!),
  ),
];

const isText = (value: unknown): value is string =>
  typeof value === "string" && strip(value) !== "";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasTexts = (value: unknown, keys: ReadonlyArray<string>) =>
  isRecord(value) && keys.every((key) => isText(value[key]));

type RawClause = Record<string, unknown> & { readonly id: string };

/**
 * Root-adopted criteria as the preparation reads them, every hold and annotation kept: the raw
 * document, not `decodeCriteria`'s view, which drops every field its schema does not name.
 */
export const adoptedClauses = (document: unknown, issue: number) => {
  const clauseOk = (clause: unknown): clause is RawClause => {
    if (!isRecord(clause)) return false;
    const state = clause.state ?? "open";
    const unit = clause.unit;
    return (
      isText(clause.id) &&
      typeof clause.required === "boolean" &&
      hasTexts(clause.source, ["kind", "ref"]) &&
      (state === "open" || state === "reserved" || state === "revised") &&
      (state !== "reserved" || hasTexts(clause.reserved, ["actor", "action", "resume"])) &&
      (state !== "revised" || isText(clause.revision)) &&
      Array.isArray(clause.evidence ?? []) &&
      ((clause.evidence ?? []) as ReadonlyArray<unknown>).every((evidence) =>
        hasTexts(evidence, ["itemKey", "scope"]),
      ) &&
      (unit === undefined ||
        unit === null ||
        (hasTexts(unit, ["title", "contract"]) &&
          Array.isArray((unit as Record<string, unknown>).paths ?? [])))
    );
  };
  if (
    !isRecord(document) ||
    document.schema !== "factory-parent-criteria/1" ||
    document.issue !== issue ||
    !Array.isArray(document.clauses) ||
    document.clauses.length === 0 ||
    !document.clauses.every(clauseOk)
  ) {
    return undefined;
  }
  const clauses = document.clauses as ReadonlyArray<RawClause>;
  return new Set(clauses.map((clause) => clause.id)).size === clauses.length ? clauses : undefined;
};

/**
 * The heading anchors Root's adoption names as acceptance: the `source.ref` fragment of each
 * required clause, so a parent's acceptance may sit under its own headings. None without a usable
 * adopted document.
 */
export const adoptedAnchors = (adopted: unknown, issue: number): ReadonlySet<string> =>
  new Set(
    (adopted === undefined ? [] : (adoptedClauses(adopted, issue) ?? [])).flatMap((clause) => {
      const ref = isRecord(clause.source) ? clause.source.ref : undefined;
      if (clause.required !== true || typeof ref !== "string" || !ref.includes("#")) return [];
      const fragment = ref.slice(ref.indexOf("#") + 1);
      return fragment === "" ? [] : [fragment];
    }),
  );

interface Evidence {
  readonly itemKey: string;
  readonly scope: string;
}
const evidenceOf = (clause: RawClause) => (clause.evidence ?? []) as ReadonlyArray<Evidence>;

/** An adopted clause's recorded list item as acceptance text: its marker and checkbox dropped. */
const listedText = (text: string) => normalized(text.replace(ITEM, ""));

const isHold = (clause: RawClause) => (clause.state ?? "open") === "reserved";

/** An unmatched adopted clause preparation keeps byte-exact: a reserved hold or an open option. */
const keptUnmatched = (clause: RawClause) =>
  isHold(clause) || (clause.required === false && (clause.state ?? "open") === "open");

/**
 * Each current acceptance item as the prepared clause it must become: the adopted clause's id,
 * state and annotations for the same text, else its label or text digest; and the evidence it may
 * cite, adopted for that text or a member quoting it verbatim. Unmatched adopted holds and open
 * optional clauses stay byte-exact in adopted order.
 */
const derivedClauses = (input: {
  readonly items: ReadonlyArray<AcceptanceItem>;
  readonly adopted: ReadonlyArray<RawClause>;
  readonly children: ReadonlyArray<{ readonly itemKey: string; readonly body?: string }>;
}) => {
  const known = input.adopted.map((clause) => {
    const texts = new Set(evidenceOf(clause).map((evidence) => normalized(evidence.scope)));
    const source = isRecord(clause.source) ? clause.source : {};
    if (typeof source.excerpt === "string") texts.add(normalized(source.excerpt));
    // Only evidence and excerpt count as text recorded for the reserved-by-id rule below.
    const recorded = texts.size > 0;
    const listed = typeof source.text === "string" ? listedText(source.text) : "";
    if (listed !== "") texts.add(listed);
    return { clause, texts, recorded };
  });
  const carriers = input.children.flatMap((child) =>
    child.body === undefined
      ? []
      : [
          {
            itemKey: child.itemKey,
            texts: new Set(
              parentAcceptance(child.body).items.map((item) => normalized(item.excerpt)),
            ),
          },
        ],
  );
  const used = new Set<number>();
  const derived = input.items.map((item) => {
    const text = normalized(item.excerpt);
    const label = labelOf(item.excerpt) ?? `clause-${sha256(text).slice(0, 12)}`;
    const index = known.findIndex(
      ({ clause, texts, recorded }, at) =>
        !used.has(at) &&
        (texts.has(text) ||
          // An adopted reservation recorded without its text still holds the clause bearing its id.
          (!recorded && clause.id === label && (clause.state ?? "open") === "reserved")),
    );
    const adopted = index < 0 ? undefined : known[index]!.clause;
    if (index >= 0) used.add(index);
    const evidence = [...(adopted === undefined ? [] : evidenceOf(adopted))];
    for (const carrier of carriers) {
      if (carrier.texts.has(text) && !evidence.some((each) => each.itemKey === carrier.itemKey)) {
        evidence.push({ itemKey: carrier.itemKey, scope: text });
      }
    }
    return { item, id: adopted?.id ?? label, adopted, evidence };
  });
  const kept = input.adopted.filter((clause, at) => !used.has(at) && keptUnmatched(clause));
  const taken = new Map<string, number>();
  for (const clause of derived) taken.set(clause.id, (taken.get(clause.id) ?? 0) + 1);
  const keptIds = new Set(kept.map((clause) => clause.id));
  return {
    derived: derived.map((clause) =>
      clause.adopted === undefined && ((taken.get(clause.id) ?? 0) > 1 || keptIds.has(clause.id))
        ? { ...clause, id: `${clause.id}-${clause.item.sha256.slice(0, 6)}` }
        : clause,
    ),
    kept,
  };
};

export interface IssueComment {
  readonly id: number | string;
  readonly body: string;
}

const sliceOf = (text: string, start: number, end: number) =>
  codePoints(text).slice(start, end).join("");

const decodeClauseUnit = Schema.decodeUnknownResult(FactoryClauseUnit, {
  onExcessProperty: "error",
});

/** Why a proposed clause unit is not exactly a bounded `{title, contract, paths}`, if it is not. */
const clauseUnitProblem = (clause: FactoryCriteriaProposal["clauses"][number]) => {
  if (clause.unit === undefined) return undefined;
  const decoded = decodeClauseUnit(clause.unit);
  return Result.isSuccess(decoded)
    ? undefined
    : `clause ${clause.id} names a unit that is not a bounded {title, contract, paths}: ${decoded.failure.message.replace(/\s+/g, " ")}`;
};

/**
 * Every way a criteria proposal departs from the exact acceptance of `body`: one clause per
 * item in order, each quoting its item exactly and the comments it cites, and naming at most a
 * bounded unit. Comment quotes are checked against `comments` when T3 holds them.
 */
export const criteriaProposalProblems = (input: {
  readonly proposal: FactoryCriteriaProposal;
  readonly issue: number;
  readonly body: string;
  readonly comments?: ReadonlyArray<IssueComment>;
  /** Root's adopted criteria for the parent, whose required clauses may name more sections. */
  readonly adopted?: unknown;
}): ReadonlyArray<string> => {
  const { proposal, issue, body } = input;
  if (proposal.issue !== issue) return [`the proposal is for #${proposal.issue}, not #${issue}`];
  if (proposal.basis.bodySha256 !== sha256(body)) {
    return [`the proposal names body ${proposal.basis.bodySha256}, not ${sha256(body)}`];
  }
  const accepted = parentAcceptance(body, adoptedAnchors(input.adopted, issue));
  if (accepted.items.length === 0) return [`the body of #${issue} states no acceptance list`];
  if (accepted.unlisted.length > 0) {
    return [`#${issue}'s acceptance has text outside its list items`];
  }
  const problems: Array<string> = [];
  if (proposal.clauses.length !== accepted.items.length) {
    problems.push(
      `the proposal names ${proposal.clauses.length} clauses; the acceptance has ${accepted.items.length} items`,
    );
  }
  if (new Set(proposal.clauses.map((clause) => clause.id)).size !== proposal.clauses.length) {
    problems.push("the proposal names a clause id twice");
  }
  for (const clause of proposal.clauses) {
    const problem = clauseUnitProblem(clause);
    if (problem !== undefined) problems.push(problem);
  }
  const comments = new Map((input.comments ?? []).map((comment) => [String(comment.id), comment]));
  accepted.items.forEach((item, at) => {
    const clause = proposal.clauses[at];
    if (clause === undefined) return;
    const { source } = clause;
    if (
      source.start !== item.start ||
      source.end !== item.end ||
      source.sha256 !== item.sha256 ||
      source.excerpt !== item.excerpt
    ) {
      problems.push(
        `clause ${clause.id} does not quote the item at ${item.start}-${item.end} (sha256 ${item.sha256})`,
      );
    }
    const cited = citedBy(item.excerpt, issue);
    const quoted = clause.comments ?? [];
    if (
      quoted
        .map((comment) => comment.id)
        .toSorted()
        .join(",") !== cited.toSorted().join(",")
    ) {
      problems.push(
        `clause ${clause.id} quotes other comments than its text cites (${cited.join(", ")})`,
      );
      return;
    }
    if (input.comments === undefined) return;
    for (const quote of quoted) {
      const comment = comments.get(quote.id);
      if (
        comment === undefined ||
        sha256(comment.body) !== quote.sha256 ||
        quote.end > codePoints(comment.body).length ||
        sliceOf(comment.body, quote.start, quote.end) !== quote.excerpt
      ) {
        problems.push(`clause ${clause.id} does not quote comment ${quote.id} as T3 read it`);
      }
    }
  });
  return problems;
};

/** JSON text as a value, or undefined when it is not JSON. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const sameJson = (left: unknown, right: unknown) => canonical(left) === canonical(right);

/**
 * Every way prepared criteria depart from what T3 derives from its own reads of the body,
 * comments, complete membership, adoption and verified proposal. Each clause keeps its source,
 * id, state and adopted holds; its evidence is only adopted for that text or a member quoting it,
 * and its unit is the adopted one, else the proposal's.
 */
export const preparedCriteriaProblems = (input: {
  readonly document: unknown;
  readonly issue: number;
  readonly repository: string;
  readonly body: string;
  readonly comments: ReadonlyArray<IssueComment>;
  readonly children: ReadonlyArray<{ readonly itemKey: string; readonly body?: string }>;
  readonly adopted: unknown;
  readonly proposal: FactoryCriteriaProposal;
}): ReadonlyArray<string> => {
  const { document, issue } = input;
  const adopted = input.adopted === undefined ? [] : adoptedClauses(input.adopted, issue);
  if (adopted === undefined) {
    return [
      `the adopted criteria are not a usable factory-parent-criteria/1 document for #${issue}`,
    ];
  }
  const proposed = criteriaProposalProblems(input);
  if (proposed.length > 0) return proposed;
  if (
    !isRecord(document) ||
    document.schema !== "factory-parent-criteria/1" ||
    document.issue !== issue ||
    document.bodySha256 !== sha256(input.body) ||
    !Array.isArray(document.clauses)
  ) {
    return [`the prepared document is not factory-parent-criteria/1 for #${issue}'s current body`];
  }
  const accepted = parentAcceptance(input.body, adoptedAnchors(input.adopted, issue)).items;
  const { derived, kept } = derivedClauses({ items: accepted, adopted, children: input.children });
  const clauses = document.clauses as ReadonlyArray<unknown>;
  if (clauses.length !== derived.length + kept.length) {
    const holds = kept.filter(isHold).length;
    const options = kept.length - holds;
    return [
      `the prepared document has ${clauses.length} clauses; ${derived.length} acceptance items${options === 0 ? " and" : ","} ${holds} kept holds${options === 0 ? "" : ` and ${options} kept optional clauses`} need ${derived.length + kept.length}`,
    ];
  }
  const comments = new Map(input.comments.map((comment) => [String(comment.id), comment]));
  const problems: Array<string> = [];
  derived.forEach((expected, at) => {
    const clause = clauses[at];
    const { item } = expected;
    const proposal = input.proposal.clauses[at]!;
    if (!isRecord(clause) || clause.id !== expected.id) {
      problems.push(`clause ${at + 1} is not ${expected.id}`);
      return;
    }
    const source = clause.source;
    if (
      clause.required !== true ||
      !isRecord(source) ||
      source.kind !== "issue_acceptance" ||
      source.ref !== `https://github.com/${input.repository}/issues/${issue}#${item.anchor}` ||
      source.start !== item.start ||
      source.end !== item.end ||
      source.sha256 !== item.sha256 ||
      source.excerpt !== item.excerpt
    ) {
      problems.push(
        `clause ${expected.id} is not the required acceptance item at ${item.start}-${item.end}`,
      );
    }
    const cited = citedBy(item.excerpt, issue);
    const quotes = isRecord(source) && Array.isArray(source.comments) ? source.comments : [];
    if (
      quotes.length !== cited.length ||
      !quotes.every((quote: unknown) => {
        if (!isRecord(quote) || typeof quote.id !== "string" || !cited.includes(quote.id)) {
          return false;
        }
        const comment = comments.get(quote.id);
        return (
          comment !== undefined &&
          quote.sha256 === sha256(comment.body) &&
          typeof quote.start === "number" &&
          typeof quote.end === "number" &&
          sliceOf(comment.body, quote.start, quote.end) === quote.excerpt
        );
      })
    ) {
      problems.push(`clause ${expected.id} does not quote the comments it cites as T3 reads them`);
    }
    const adoptedState = (expected.adopted?.state ?? "open") as string;
    const state =
      adoptedState === "open" && proposal.needs !== undefined ? "reserved" : adoptedState;
    if ((clause.state ?? "open") !== state) {
      problems.push(`clause ${expected.id} is ${String(clause.state ?? "open")}, not ${state}`);
    }
    for (const key of ["reserved", "revision", "unit"] as const) {
      const held = expected.adopted?.[key];
      if (held !== undefined && held !== null && !sameJson(clause[key], held)) {
        problems.push(`clause ${expected.id} does not keep its adopted ${key}`);
      }
    }
    // An adopted unit always wins; a proposed one is prepared only where adoption names none.
    const adoptedUnit = expected.adopted?.unit;
    if (proposal.unit !== undefined) {
      if (adoptedUnit !== undefined && adoptedUnit !== null) {
        if (!sameJson(proposal.unit, adoptedUnit)) {
          problems.push(`clause ${expected.id} proposes a unit other than its adopted unit`);
        }
      } else if (!sameJson(clause.unit, proposal.unit)) {
        problems.push(`clause ${expected.id} does not carry its proposed unit`);
      }
    }
    if (state === "reserved" && !hasTexts(clause.reserved, ["actor", "action", "resume"])) {
      problems.push(`clause ${expected.id} is reserved without its actor, action and resume`);
    }
    const evidence = Array.isArray(clause.evidence)
      ? (clause.evidence as ReadonlyArray<unknown>)
      : [];
    for (const each of evidence) {
      if (!expected.evidence.some((allowed) => sameJson(allowed, each))) {
        problems.push(
          `clause ${expected.id} cites evidence ${canonical(each).slice(0, 200)} that neither adoption nor a member's own acceptance supports`,
        );
      }
    }
  });
  kept.forEach((clause, at) => {
    if (!sameJson(clauses[derived.length + at], clause)) {
      problems.push(
        `the adopted ${isHold(clause) ? "hold" : "optional clause"} ${clause.id} is not kept as adopted`,
      );
    }
  });
  return problems;
};

// No-edit verification units (factory-noedit/1): an exact existing commit, checked and reviewed,
// changing no file.
const Sha40 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const NoEditText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000));

/** What a no-edit unit is admitted to verify, exactly as the policy and Root adopted it. */
export const NoEditRequirement = Schema.Struct({
  schema: Schema.Literal("factory-noedit/1"),
  candidate: Sha40,
  base: Sha40,
  ownedFiles: Schema.Array(Schema.String).check(Schema.isMaxLength(0)),
  checks: Schema.Array(NoEditText).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
    Schema.makeFilter((checks) => new Set(checks).size === checks.length, {
      expected: "each check named once",
    }),
  ),
  // A policy may name no execution as null.
  execution: Schema.optional(Schema.NullOr(NoEditText)),
  instructionRevision: NoEditText,
  clauseBinding: NoEditText,
  // What the policy binds the unit to, when it names it: T3 checks the item and its version at
  // admission, and the digest binds all four, so a receipt for another unit or criteria refuses.
  itemKey: Schema.optional(NoEditText),
  itemVersion: Schema.optional(NoEditText),
  unit: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))),
  criteria: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))),
}).check(
  Schema.makeFilter((requirement) => requirement.candidate === requirement.base, {
    expected: "a candidate that is its own base",
  }),
);
export type NoEditRequirement = typeof NoEditRequirement.Type;

/** The stage-basis suffix binding an admitted no-edit unit to its exact requirement. */
export const noEditBasis = (requirement: NoEditRequirement) =>
  `|ne:${sha256(canonical(requirement)).slice(0, 32)}`;

const NoEditReceipt = Schema.Struct({
  schema: Schema.Literal("factory-noedit-receipt/1"),
  requirement: NoEditRequirement,
  itemKey: Schema.String,
  itemVersion: Schema.String,
  results: Schema.Array(
    Schema.Struct({
      check: Schema.String,
      exitCode: Schema.Int,
      log: Schema.Struct({ path: Schema.String, sha256: Schema.String }),
    }),
  ),
});
const decodeNoEditReceipt = Schema.decodeUnknownOption(Schema.fromJsonString(NoEditReceipt));

/** Why T3 refused a no-edit report: the code leads the outcome's rejection, before a colon. */
export type NoEditRefusal =
  | "noedit_artifacts_unverified"
  | "noedit_receipt_missing"
  | "noedit_requirement_mismatch"
  | "noedit_head_mismatch"
  | "noedit_item_mismatch"
  | "noedit_checks_mismatch"
  | "noedit_check_failed"
  | "noedit_log_unverified";

/** What T3 itself read back for an accepted no-edit report, recorded on its verified outcome. */
export interface NoEditNativeReceipt {
  readonly requirementDigest: string;
  /** The admitted requirement exactly as T3 decoded it, every field it binds. */
  readonly requirement: NoEditRequirement;
  readonly candidate: string;
  readonly results: ReadonlyArray<{
    readonly check: string;
    readonly exitCode: number;
    readonly logPath: string;
    /** The sha256 of the log's bytes as T3 read them, not as the worker claimed. */
    readonly logSha256: string;
  }>;
}

/**
 * Whether an implemented report proves the no-edit unit its stage was admitted for. The receipt is
 * read back from the report's own artifacts, each with the sha256 of the bytes T3 read: it must
 * name the admitted requirement exactly, its candidate must be both reported commits, and each
 * required check must have exactly one passing result whose log T3 read with that sha256.
 */
export const noEditReceiptProblem = (input: {
  readonly basis: string;
  readonly itemKey: string;
  readonly itemVersion: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    /** The sha256 of the bytes T3 read, or undefined when it could not read them. */
    readonly sha256: string | undefined;
    readonly text: string | undefined;
  }>;
}):
  | { readonly refused: NoEditRefusal; readonly why: string }
  | { readonly receipt: NoEditNativeReceipt } => {
  const refuse = (refused: NoEditRefusal, why: string) => ({ refused, why });
  const receipts = input.artifacts.flatMap((artifact) => {
    const receipt = artifact.text === undefined ? undefined : decodeNoEditReceipt(artifact.text);
    return receipt === undefined || receipt._tag === "None" ? [] : [receipt.value];
  });
  if (receipts.length !== 1) {
    return refuse(
      "noedit_receipt_missing",
      `the report lists ${receipts.length} no-edit receipts, not one`,
    );
  }
  const receipt = receipts[0]!;
  const { requirement } = receipt;
  if (noEditBasis(requirement) !== input.basis) {
    return refuse(
      "noedit_requirement_mismatch",
      "its receipt names another requirement than the one admitted",
    );
  }
  if (input.baseCommit !== requirement.candidate || input.headCommit !== requirement.candidate) {
    return refuse(
      "noedit_head_mismatch",
      `a no-edit unit reports base and head ${requirement.candidate}, unchanged`,
    );
  }
  if (receipt.itemKey !== input.itemKey || receipt.itemVersion !== input.itemVersion) {
    return refuse("noedit_item_mismatch", "its receipt is for another item or item version");
  }
  // Exactly one result per admitted check, compared as values, never through a joined text.
  const counts = new Map<string, number>();
  for (const result of receipt.results) {
    counts.set(result.check, (counts.get(result.check) ?? 0) + 1);
  }
  if (
    receipt.results.length !== requirement.checks.length ||
    !requirement.checks.every((check) => counts.get(check) === 1)
  ) {
    return refuse(
      "noedit_checks_mismatch",
      `its results name checks ${JSON.stringify(receipt.results.map((result) => result.check))}, not each of ${JSON.stringify(requirement.checks)} once`,
    );
  }
  const read = new Map(input.artifacts.map((artifact) => [artifact.path, artifact.sha256]));
  const results: Array<NoEditNativeReceipt["results"][number]> = [];
  for (const check of requirement.checks) {
    const result = receipt.results.find((each) => each.check === check);
    if (result === undefined) {
      return refuse("noedit_checks_mismatch", `check ${JSON.stringify(check)} has no result`);
    }
    if (result.exitCode !== 0) {
      return refuse(
        "noedit_check_failed",
        `check ${check} failed with exit code ${result.exitCode}`,
      );
    }
    const logSha256 = read.get(result.log.path);
    if (logSha256 === undefined || logSha256 !== result.log.sha256.toLowerCase()) {
      return refuse(
        "noedit_log_unverified",
        `check ${check}'s log is not among the artifacts T3 read with that sha256`,
      );
    }
    results.push({ check, exitCode: result.exitCode, logPath: result.log.path, logSha256 });
  }
  return {
    receipt: {
      requirementDigest: input.basis.slice("|ne:".length),
      requirement,
      candidate: requirement.candidate,
      results,
    },
  };
};
