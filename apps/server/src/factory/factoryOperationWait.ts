// @effect-diagnostics nodeBuiltinImport:off - a wait's basis is a sha256 of the facts it stands on.
import * as NodeCrypto from "node:crypto";

import * as Schema from "effect/Schema";

/**
 * Why an intended operation is not done. `uncertain`: a sent write's effect is unknown, so it is
 * read back before anything is resent. `dependency`: nothing of ours is pending and `actor` must
 * act; each attempt still reads first. The same `basis` read again is the same wait, from `since`.
 */
export const OperationWait = Schema.Struct({
  kind: Schema.Literals(["uncertain", "dependency"]),
  basis: Schema.String,
  actor: Schema.String,
  action: Schema.String,
  resume: Schema.String,
  since: Schema.String,
});
export type OperationWait = typeof OperationWait.Type;

/** A wait as an attempt finds it, before it is recorded. */
export interface WaitFor {
  readonly kind: OperationWait["kind"];
  readonly actor: string;
  readonly action: string;
  readonly resume: string;
  /** Only the facts that decide the wait; wording and read times stay out of its basis. */
  readonly facts: ReadonlyArray<string>;
}

/** Git and GitHub may echo a remote URL; any credential in one never reaches a record. */
export const redact = (text: string) => text.replace(/:\/\/[^/\s@]+@/g, "://***@");

/** A wait as made, with every part and fact redacted: its basis never holds a credential either. */
const made = (kind: WaitFor["kind"], wait: Omit<WaitFor, "kind">): WaitFor => ({
  kind,
  actor: redact(wait.actor),
  action: redact(wait.action),
  resume: redact(wait.resume),
  facts: wait.facts.map(redact),
});

export const dependency = (wait: Omit<WaitFor, "kind">) => made("dependency", wait);

export const uncertain = (wait: Omit<WaitFor, "kind">) => made("uncertain", wait);

export const waitBasis = (wait: WaitFor) =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([wait.kind, ...wait.facts]))
    .digest("hex");

/** FactoryLifecycle shows this much of a waiting operation's text. */
const EXCERPT = 500;
const ACTOR_LIMIT = 80;
const ACTION_LIMIT = 140;
const RESUME_LIMIT = 120;

const oneLine = (text: string, limit: number) => {
  const plain = redact(text).replace(/\s+/g, " ").trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
};

/**
 * The wait as one line of at most 500 characters, the reason first. Each part has its own budget
 * and the reason gets what is left, so who acts, the action and the resume are always shown.
 */
export const renderWait = (reason: string, wait: WaitFor) => {
  const parts = [
    wait.kind === "uncertain" ? "uncertain write, read back before any resend" : "waiting",
    `who acts: ${oneLine(wait.actor, ACTOR_LIMIT)}`,
    `action: ${oneLine(wait.action, ACTION_LIMIT)}`,
    `resumes when: ${oneLine(wait.resume, RESUME_LIMIT)}`,
  ].join(" | ");
  return `${oneLine(reason, EXCERPT - parts.length - 3)} | ${parts}`;
};
