// @effect-diagnostics nodeBuiltinImport:off - sha256 of tracker content.
import * as NodeCrypto from "node:crypto";

import { FactoryClaimCarrierKey, type FactoryItemKey } from "@t3tools/contracts";

import type * as FactoryStore from "./FactoryStore.ts";

/** The tracker issue as the factory reads it; everything a decision may depend on. */
export interface TrackerIssue {
  readonly state: "open" | "closed";
  readonly title: string;
  readonly body: string;
  readonly labels: ReadonlyArray<string>;
  readonly comments: ReadonlyArray<TrackerComment>;
  /** Who opened it, when the tracker says. */
  readonly author?: { readonly id: string; readonly login: string };
  /** The issues it is blocked by; null when the tracker could not say. */
  readonly blockedBy?: ReadonlyArray<{
    readonly repository: string;
    readonly number: number;
    readonly state: "open" | "closed";
  }> | null;
  /** The issue it is a sub-issue of; null when it is none's. */
  readonly parent?: { readonly repository: string; readonly number: number } | null;
  /** How many sub-issues it has, when the tracker says: a parent is not a unit of work. */
  readonly subIssueCount?: number;
}

export interface TrackerComment {
  readonly id: number;
  readonly body: string;
  readonly authorId: string;
}

export interface TrackerSubject {
  readonly tracker: "github";
  readonly repository: string;
  readonly issueNumber: number;
}

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const CLAIM_MARKER = "t3-factory-claim:v1";

/** The comment a claim writes. The nonce is known only to the attempt until this is sent. */
export const claimCommentBody = (input: {
  readonly operationId: string;
  readonly nonce: string;
  readonly itemKey: FactoryItemKey;
}) =>
  `<!-- ${CLAIM_MARKER} operation=${input.operationId} nonce=${input.nonce} -->\n` +
  `Claimed by T3 Code for \`${input.itemKey}\`.`;

const subjectPrefix = (subject: TrackerSubject) =>
  `github:${subject.repository}#${subject.issueNumber}`;

/**
 * A comment carrier is the comment as it reads now: an edit, even under the same id and author,
 * is a different carrier, so an attested comment rewritten into a manual claim is not ours.
 */
export const commentDigest = (body: string) => sha256(body).slice(0, 32);

/** The one key a comment carrier is known by, from its issue, id and content digest. */
export const commentCarrierKeyOf = (
  issue: { readonly repository: string; readonly issueNumber: number },
  commentId: number,
  digest: string,
) =>
  FactoryClaimCarrierKey.make(
    `github:${issue.repository}#${issue.issueNumber}:comment:${commentId}:${digest}`,
  );

const commentCarrierKey = (subject: TrackerSubject, commentId: number, body: string) =>
  commentCarrierKeyOf(subject, commentId, commentDigest(body));

/**
 * Every claim-shaped carrier on the issue, whoever made it: claim labels, comments matching a
 * claim pattern and every T3 claim comment. Recognising one says nothing about who owns it.
 */
const claimCarriersOf = (
  issue: TrackerIssue,
  subject: TrackerSubject,
  claim: FactoryStore.FactoryClaimConfig,
) => {
  const patterns = claim.foreignClaimCommentPatterns.map((pattern) => new RegExp(pattern, "m"));
  return [
    ...issue.labels
      .filter((label) => claim.foreignClaimLabels.includes(label))
      .map((label) => `${subjectPrefix(subject)}:label:${label}`),
    ...issue.comments
      .filter(
        (comment) =>
          comment.body.includes(CLAIM_MARKER) ||
          patterns.some((pattern) => pattern.test(comment.body)),
      )
      .map((comment) => commentCarrierKey(subject, comment.id, comment.body)),
  ].map((carrierKey) => FactoryClaimCarrierKey.make(carrierKey));
};

/**
 * The item version is its content (title, body, state, labels), never `updated_at`; claim carriers
 * are part of the basis. Every comment is evidence unless a native write record proves T3 wrote
 * exactly that comment (claim, report, decision and closing records are bookkeeping). The author
 * account alone proves nothing: people and other tools may use it too.
 */
export const issueObservation = (input: {
  readonly issue: TrackerIssue;
  readonly subject: TrackerSubject;
  readonly claim: FactoryStore.FactoryClaimConfig;
  readonly isBookkeeping?: (comment: TrackerComment) => boolean;
}) => {
  const { issue, subject, claim } = input;
  const isBookkeeping = input.isBookkeeping ?? (() => false);
  const labels = issue.labels.toSorted();
  const contentDigest = sha256(JSON.stringify([issue.title, issue.body, issue.state, labels]));
  return {
    itemVersion: contentDigest.slice(0, 32),
    complete: true,
    evidence: [
      {
        carrierId: `${subjectPrefix(subject)}:issue`,
        bodyDigest: sha256(JSON.stringify([issue.title, issue.body])),
        version: contentDigest.slice(0, 32),
      },
      ...issue.comments
        .filter((comment) => !isBookkeeping(comment))
        .map((comment) => ({
          carrierId: `${subjectPrefix(subject)}:comment:${comment.id}`,
          bodyDigest: sha256(comment.body),
          version: commentDigest(comment.body),
        })),
    ],
    sources: [
      { sourceKey: `${subjectPrefix(subject)}:state`, version: contentDigest.slice(0, 32) },
    ],
    claims: claimCarriersOf(issue, subject, claim).map((carrierKey) => ({
      carrierKey,
      poolId: claim.observedClaimPool.poolId,
      units: claim.observedClaimPool.units,
    })),
    subject,
  };
};

/**
 * A new item may go to the policy when it is open, nobody's claim is on it and, if the project's
 * readiness is a label, it carries that label. Without one, the policy alone decides readiness.
 */
export const isEligible = (
  observation: ReturnType<typeof issueObservation>,
  issue: TrackerIssue,
  claim: FactoryStore.FactoryClaimConfig,
) =>
  issue.state === "open" &&
  (claim.eligibilityLabel === undefined || issue.labels.includes(claim.eligibilityLabel)) &&
  observation.claims.length === 0;

/**
 * Whether collection must read a listed open issue: it may be ready, or a claim may hold it. This
 * is exact, not a heuristic: every claim is a claim label or a comment, so an issue with neither,
 * and without the readiness label, can be neither admitted nor occupied. What the listing did not
 * say is read.
 */
export const mayBeReadyOrClaimed = (
  listed: {
    readonly labels: ReadonlyArray<string> | undefined;
    readonly comments: number | undefined;
  },
  claim: FactoryStore.FactoryClaimConfig,
) =>
  claim.eligibilityLabel === undefined ||
  listed.labels === undefined ||
  listed.comments !== 0 ||
  listed.labels.some(
    (label) => label === claim.eligibilityLabel || claim.foreignClaimLabels.includes(label),
  );

export type HelperInvocationRefusal =
  | "helper_command_missing"
  | "helper_argument_missing"
  | "helper_argument_invalid"
  | "helper_argument_mismatch";

/** Splits text into shell words, honouring single and double quotes. */
const shellWords = (text: string) =>
  Array.from(text.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g), (match) =>
    (match[1] ?? match[2] ?? match[3] ?? "").replace(/[.,;)]+$/, ""),
  );

/**
 * Checks every invocation of the pinned helper in a packet against the helper's consumer
 * schema, so the worker cannot find a missing or wrong argument only after the claim.
 */
export const validateHelperInvocations = (input: {
  readonly packetText: string;
  readonly helperPath: string;
  readonly invocation: FactoryStore.FactoryHelperInvocation;
  readonly bindings: { readonly taskKind: string; readonly decisionKey: string };
}): HelperInvocationRefusal | undefined => {
  const { invocation } = input;
  const invocations = input.packetText
    .split(input.helperPath)
    .slice(1)
    .map((rest) => shellWords(rest));
  if (invocations.length === 0) return "helper_command_missing";
  for (const words of invocations) {
    if (words[0] !== invocation.command) return "helper_command_missing";
    const values = new Map<string, string | undefined>();
    for (let index = 1; index < words.length; index++) {
      const word = words[index]!;
      if (!word.startsWith("--")) break;
      const next = words[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.set(word, next);
        index++;
      } else {
        values.set(word, undefined);
      }
    }
    for (const required of invocation.required) {
      if (!values.has(required)) return "helper_argument_missing";
    }
    for (const workerSupplied of invocation.workerSupplied) {
      if (!values.has(workerSupplied)) return "helper_argument_missing";
    }
    for (const [flag, allowed] of Object.entries(invocation.choices)) {
      const value = values.get(flag);
      if (invocation.workerSupplied.includes(flag)) continue;
      if (value === undefined || !allowed.includes(value)) return "helper_argument_invalid";
    }
    for (const [flag, binding] of Object.entries(invocation.supplied)) {
      if (values.get(flag) !== input.bindings[binding]) return "helper_argument_mismatch";
    }
  }
  return undefined;
};
