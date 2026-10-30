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

export const dependency = (wait: Omit<WaitFor, "kind">): WaitFor => ({
  ...wait,
  kind: "dependency",
});

export const uncertain = (wait: Omit<WaitFor, "kind">): WaitFor => ({
  ...wait,
  kind: "uncertain",
});

export const waitBasis = (wait: WaitFor) =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([wait.kind, ...wait.facts]))
    .digest("hex");

const REASON_LIMIT = 220;

/** Git and GitHub may echo a remote URL; any credential in one never reaches a record. */
export const redact = (text: string) => text.replace(/:\/\/[^/\s@]+@/g, "://***@");

const oneLine = (text: string, limit: number) => {
  const plain = redact(text).replace(/\s+/g, " ").trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
};

/**
 * The wait as one line, the reason first: what the factory's state shows for the operation. Who
 * acts, what they do and when it resumes stay in the first 500 characters whatever the reason.
 */
export const renderWait = (reason: string, wait: WaitFor) =>
  [
    oneLine(reason, REASON_LIMIT),
    wait.kind === "uncertain" ? "uncertain write, read back before any resend" : "waiting",
    `who acts: ${wait.actor}`,
    `action: ${wait.action}`,
    `resumes when: ${wait.resume}`,
  ].join(" | ");
