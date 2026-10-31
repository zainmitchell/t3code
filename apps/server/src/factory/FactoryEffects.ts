// @effect-diagnostics nodeBuiltinImport:off - receipts carry sha256 digests of what was written.
import * as NodeCrypto from "node:crypto";

import { CommandId, type FactoryId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";

import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import {
  dependency,
  redact,
  renderWait,
  uncertain,
  waitBasis,
  type WaitFor,
} from "./factoryOperationWait.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import { attemptPullRequestMerge, type PullRequestAttempt } from "./factoryPullRequests.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryTracker from "./FactoryTracker.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

export type FactoryWakeTrigger = "outcome" | "owner_decision" | "operation";

/**
 * Factories that something outside a collection pass asked to reconcile: a report, an owner's
 * answer, an ended run or a finished external write. The driver takes them; nothing else waits.
 */
export class FactoryWakes extends Context.Service<
  FactoryWakes,
  Queue.Queue<{ readonly factoryId: FactoryId; readonly trigger: FactoryWakeTrigger }>
>()("t3/factory/FactoryEffects/FactoryWakes") {}

export const layerWakes = Layer.effect(
  FactoryWakes,
  Queue.unbounded<{ readonly factoryId: FactoryId; readonly trigger: FactoryWakeTrigger }>(),
);

/**
 * Applies one intended factory operation, after its intent committed. Each kind reads back by
 * its stable identity before it writes, so a write that landed before a crash or a lost answer is
 * found and recorded, never repeated. Anything it cannot know stays intended for the next try. A
 * runtime the server gave no factory effects writes nothing: its operations stay intended.
 */
export const FactoryEffects = Context.Reference<{
  readonly apply: (operationId: string) => Effect.Effect<void>;
}>("t3/factory/FactoryEffects", {
  defaultValue: () => ({
    apply: (operationId) =>
      Effect.logWarning("No factory effects in this runtime; the operation stays intended", {
        operationId,
      }),
  }),
});

/** Undefined: the write's effect is unknown and the next attempt reads it back first. */
/** `held`: a ticket create already sent waits for its ticket to be asked for again; no retry of its own. */
type Completion =
  | PullRequestAttempt
  | { readonly state: "held"; readonly reason: string; readonly wait: WaitFor }
  | undefined;

/** Why an attempt that neither ended the operation nor named its wait left it intended. */
const unknownOutcome = (
  intent: FactoryOperationStore.FactoryOperationIntent,
  failure: unknown,
): { readonly reason: string; readonly wait: WaitFor } => {
  const cause =
    typeof failure === "object" && failure !== null && "cause" in failure
      ? `: ${String(failure.cause).slice(0, 600)}`
      : "";
  return {
    reason:
      failure === undefined
        ? "the write was not confirmed"
        : redact(`${String(failure)}${cause}`).slice(0, 2_000),
    wait: uncertain({
      actor: "T3",
      action: `read the ${intent.kind} back by its stable identity before writing again`,
      resume: "the next attempt reaches the tracker and Git and reads what landed",
      facts: [
        intent.kind,
        failure === undefined
          ? "unconfirmed"
          : typeof failure === "object" && failure !== null && "_tag" in failure
            ? String(failure._tag)
            : "failure",
      ],
    }),
  };
};

const make = Effect.gen(function* () {
  const operations = yield* FactoryOperationStore.FactoryOperationStore;
  const store = yield* FactoryStore.FactoryStore;
  const tracker = yield* FactoryTracker.FactoryTracker;
  const integrator = yield* FactoryIntegrator.FactoryIntegrator;
  const projects = yield* ProjectService.ProjectService;
  const wakes = yield* FactoryWakes;
  const outbox = yield* EffectOutbox.EffectOutboxV2;

  /**
   * Our record on the issue, written if it is not there. Only a comment of our own account that
   * says exactly what the record says is adopted: one that merely carries the marker may be a
   * worker's, or another record quoting it. Line endings alone may differ, as a tracker stores them.
   */
  const ensureComment = Effect.fnUntraced(function* (
    session: FactoryTracker.TrackerSession,
    target: {
      readonly repository: string;
      readonly issueNumber: number;
      readonly marker: string;
      readonly body: string;
    },
  ) {
    const issue = yield* session.readIssue(target);
    const ours = (comment: { readonly body: string; readonly authorId: string }) =>
      comment.body.includes(target.marker) && comment.authorId === session.account.accountId;
    const existing = issue.comments.find(
      (comment) => ours(comment) && FactoryTracker.sameTrackerBody(comment.body, target.body),
    );
    if (existing !== undefined) {
      return { commentId: existing.id, bodyDigest: sha256(existing.body), issue } as const;
    }
    const written = yield* session.createComment({
      repository: target.repository,
      issueNumber: target.issueNumber,
      body: target.body,
    });
    if (written.type === "rejected" && !written.transient) {
      return { refused: written.cause } as const;
    }
    if (written.type !== "written") return undefined;
    const readBack = yield* session.readComment({
      repository: target.repository,
      commentId: written.commentId,
    });
    // Ours by the id our own create returned, so a body stored differently sends no second one.
    return Option.isSome(readBack) && ours(readBack.value)
      ? ({ commentId: written.commentId, bodyDigest: sha256(readBack.value.body), issue } as const)
      : undefined;
  });

  /**
   * The issue the intent opens: recorded, else found by marker, else created. A create is recorded
   * before it is sent and its issue as soon as known; while a sent create stays unidentified, none
   * is sent again without its owner. Relations are then written and read back.
   */
  const createIssue = Effect.fnUntraced(function* (
    session: FactoryTracker.TrackerSession,
    operation: FactoryOperationStore.IntendedOperation,
    intent: Extract<
      FactoryOperationStore.FactoryOperationIntent,
      { readonly kind: "tracker_create_issue" }
    >,
  ): Effect.fn.Return<
    Completion,
    FactoryTracker.FactoryTrackerError | FactoryOperationStore.FactoryOperationStoreError
  > {
    let created = operation.createdIssue;
    if (created === undefined) {
      const existing = yield* session.findIssueByMarker(intent);
      let identity: { readonly number: number; readonly id: number };
      const pending = operation.createPending;
      if (Option.isSome(existing)) {
        identity = existing.value;
      } else if (pending !== undefined && pending.cleared === undefined) {
        // The listing may lag a create GitHub applied: never send another on its silence.
        yield* operations.noteCreateUnconfirmed({
          operationId: operation.operationId,
          attempt: pending.attempt,
        });
        return {
          state: "held",
          reason: `unconfirmed_create: a create sent at ${pending.at} may have opened an issue carrying ${intent.marker}; none is found yet`,
          wait: uncertain({
            actor: "the factory owner, only while GitHub lists no issue carrying the marker",
            action: `search ${intent.repository} for ${intent.marker}, then answer the ticket question; T3 sends no create meanwhile`,
            resume:
              "GitHub lists the issue carrying the marker, or the owner approves one more create",
            facts: ["unconfirmed_create", String(pending.attempt)],
          }),
        };
      } else {
        // Recorded before it is sent, so an attempt that ends unseen is never followed by another.
        const recorded = yield* operations.noteCreatePending(operation.operationId);
        if (Option.isNone(recorded)) return undefined;
        const written = yield* session.createIssue(intent);
        if (written.type === "rejected") {
          // Refused by GitHub, or never sent: no issue stands from this create.
          yield* operations.clearCreatePending({
            operationId: operation.operationId,
            attempt: recorded.value.attempt,
            by: `refused: ${written.cause}`,
          });
          return written.transient
            ? undefined
            : { state: "failed", reason: `refused: ${written.cause}` };
        }
        if (written.type !== "written") return undefined;
        identity = written.issue;
      }
      const recorded = yield* operations.noteCreatedIssue({
        operationId: operation.operationId,
        issue: identity,
      });
      if (Option.isNone(recorded)) return undefined;
      created = recorded.value;
    }
    const confirmed = yield* session.readIssue({
      repository: intent.repository,
      issueNumber: created.number,
    });
    if (
      !confirmed.body.includes(intent.marker) ||
      confirmed.author?.id !== session.account.accountId
    ) {
      return {
        state: "failed",
        reason: `refused: issue #${created.number}, which this operation created, no longer carries its marker as this account's`,
      };
    }
    const issue = { number: created.number, id: created.id, body: confirmed.body };
    // A 422 is only a refusal if the readback below lacks the relation; a duplicate shows there.
    const refusals = new Map<string, string>();
    if (intent.parentIssueNumber !== null) {
      const linked = yield* session.readIssue({
        repository: intent.repository,
        issueNumber: issue.number,
      });
      if (linked.parent?.number !== intent.parentIssueNumber) {
        const outcome = yield* session.addSubIssue({
          repository: intent.repository,
          parentIssueNumber: intent.parentIssueNumber,
          issueId: issue.id,
        });
        if (outcome.type === "ambiguous") return undefined;
        if (outcome.type === "refused") {
          refusals.set(
            "parent",
            `#${issue.number} as a sub-issue of #${intent.parentIssueNumber} (${outcome.detail})`,
          );
        }
      }
    }
    for (const blocked of intent.blocks) {
      const target = yield* session.readIssue({
        repository: intent.repository,
        issueNumber: blocked,
      });
      if (target.blockedBy?.some((blocker) => blocker.number === issue.number) === true) continue;
      const outcome = yield* session.addBlockedBy({
        repository: intent.repository,
        issueNumber: blocked,
        issueId: issue.id,
      });
      if (outcome.type === "ambiguous") return undefined;
      if (outcome.type === "refused") {
        refusals.set(
          `blocks:${blocked}`,
          `#${issue.number} as blocking #${blocked} (${outcome.detail})`,
        );
      }
    }
    // Read every relation back: a receipt names only what the tracker shows.
    const child = yield* session.readIssue({
      repository: intent.repository,
      issueNumber: issue.number,
    });
    const parentLinked =
      intent.parentIssueNumber === null || child.parent?.number === intent.parentIssueNumber;
    const blocking: Array<number> = [];
    for (const blocked of intent.blocks) {
      const target = yield* session.readIssue({
        repository: intent.repository,
        issueNumber: blocked,
      });
      if (target.blockedBy?.some((blocker) => blocker.number === issue.number) === true) {
        blocking.push(blocked);
      }
    }
    const missing = [
      ...(parentLinked ? [] : ["parent"]),
      ...intent.blocks.filter((blocked) => !blocking.includes(blocked)).map((n) => `blocks:${n}`),
    ];
    const refused = missing.flatMap((relation) => refusals.get(relation) ?? []);
    if (refused.length > 0) {
      return { state: "failed", reason: `refused: GitHub would not record ${refused.join("; ")}` };
    }
    if (missing.length > 0) return undefined;
    return {
      state: "applied",
      receipt: {
        kind: "tracker_create_issue",
        repository: intent.repository,
        number: issue.number,
        bodyDigest: sha256(issue.body),
        parentLinked,
        blocking,
      },
    };
  });

  const attempt = Effect.fnUntraced(function* (
    operation: FactoryOperationStore.IntendedOperation,
  ): Effect.fn.Return<
    Completion,
    | FactoryTracker.FactoryTrackerError
    | FactoryIntegrator.FactoryIntegratorError
    | FactoryStore.FactoryStoreError
    | FactoryOperationStore.FactoryOperationStoreError
    | ProjectService.ProjectOperationError
  > {
    const { intent } = operation;
    if (intent.kind === "git_integrate") {
      const project = yield* projects.getById(intent.projectId);
      if (Option.isNone(project)) {
        return { state: "failed", reason: "configuration: the project no longer exists" };
      }
      const cwd = project.value.workspaceRoot;
      const target = { branch: intent.branch, remote: intent.remote };
      const landed = yield* integrator.landed({
        cwd,
        target,
        marker: intent.marker,
        reviewedHead: intent.reviewedHead,
      });
      if (Option.isSome(landed)) {
        return {
          state: "applied",
          receipt: { kind: "git_integrate", branch: intent.branch, ...landed.value },
        };
      }
      const applied = yield* integrator.apply({
        cwd,
        target,
        expected: intent.expected,
        reviewedHead: intent.reviewedHead,
        mode: intent.mode,
        message: intent.message,
        identity: intent.identity,
      });
      switch (applied.type) {
        case "applied":
          return {
            state: "applied",
            receipt: {
              kind: "git_integrate",
              branch: intent.branch,
              commit: applied.commit,
              parents: applied.parents,
              tree: applied.tree,
              attribution: "operation",
            },
          };
        case "moved":
          return { state: "stale", reason: `target moved to ${applied.tip ?? "nothing"}` };
        case "conflict":
          return { state: "failed", reason: `conflict: ${applied.detail}` };
        case "not_fast_forward":
          return {
            state: "failed",
            reason: "not_fast_forward: the reviewed head does not descend from the target",
          };
        case "target_checked_out":
          return {
            state: "failed",
            reason: `configuration: ${intent.branch} is checked out in a worktree`,
          };
        case "refused":
          return {
            state: "waiting",
            reason: `the write of ${intent.branch} was refused and it still holds ${intent.expected}: ${redact(applied.detail)}`,
            wait: dependency({
              actor: `whoever controls writes to ${intent.branch}${intent.remote === null ? "" : ` on ${intent.remote}`}`,
              action: `let this account move ${intent.branch} from ${intent.expected}, or lift the rule that refused it`,
              resume: `the write is accepted; each attempt reads ${intent.branch} first and a moved target ends it`,
              facts: ["integrate_refused", intent.branch, intent.expected, intent.reviewedHead],
            }),
          };
      }
    }
    const configuration = yield* store.getConfiguration(operation.factoryId);
    const claim = Option.isSome(configuration) ? configuration.value.claim : undefined;
    if (Option.isNone(configuration) || claim === undefined) {
      return { state: "failed", reason: "configuration: the factory has no tracker" };
    }
    if (intent.kind === "pull_request_merge") {
      const project = yield* projects.getById(intent.projectId);
      if (Option.isNone(project)) {
        return { state: "failed", reason: "configuration: the project no longer exists" };
      }
      const cwd = project.value.workspaceRoot;
      return yield* tracker.withSession(
        { host: claim.host, cwd: configuration.value.artifactRoot },
        (session) =>
          attemptPullRequestMerge(session, integrator, {
            cwd,
            intent,
            creates: {
              unresolved:
                operation.pullRequestCreate !== undefined &&
                operation.pullRequestCreate.cleared === undefined,
              record: operations.notePullRequestCreate(operation.operationId),
              clear: (attempt, by) =>
                operations.clearPullRequestCreate({
                  operationId: operation.operationId,
                  attempt,
                  by,
                }),
            },
            publications: {
              // Only this factory and item's own receipts, on the same repository, remote and branch.
              proves: (tip) =>
                Effect.map(
                  operations.forItem({
                    factoryId: operation.factoryId,
                    itemKey: operation.itemKey,
                  }),
                  (recorded) =>
                    recorded.some(
                      (each) =>
                        each.intent.kind === "pull_request_merge" &&
                        each.intent.repository === intent.repository &&
                        each.intent.remote === intent.remote &&
                        each.published?.branch === intent.head &&
                        each.published.commit === tip,
                    ),
                ),
              record: operations.notePublished({
                operationId: operation.operationId,
                branch: intent.head,
                commit: intent.reviewedHead,
              }),
            },
          }),
      );
    }
    if (intent.kind === "tracker_create_issue") {
      return yield* tracker.withSession(
        { host: claim.host, cwd: configuration.value.artifactRoot },
        (session) => createIssue(session, operation, intent),
      );
    }
    return yield* tracker.withSession(
      { host: claim.host, cwd: configuration.value.artifactRoot },
      (session) =>
        Effect.gen(function* (): Effect.fn.Return<Completion, FactoryTracker.FactoryTrackerError> {
          const record = yield* ensureComment(session, intent);
          if (record === undefined) return undefined;
          if ("refused" in record) return { state: "failed", reason: `refused: ${record.refused}` };
          if (intent.kind === "tracker_comment") {
            return {
              state: "applied",
              receipt: {
                kind: "tracker_comment",
                commentId: record.commentId,
                bodyDigest: record.bodyDigest,
              },
            };
          }
          if (record.issue.state !== "closed") yield* session.closeIssue(intent);
          const closed = yield* session.readIssue(intent);
          return closed.state === "closed"
            ? {
                state: "applied",
                receipt: {
                  kind: "tracker_close",
                  commentId: record.commentId,
                  bodyDigest: record.bodyDigest,
                },
              }
            : undefined;
        }),
    );
  });

  const apply = Effect.fn("FactoryEffects.apply")(
    function* (operationId: string) {
      const operation = yield* operations.get(operationId);
      if (Option.isNone(operation) || operation.value.state !== "intended") return;
      const intended = operation.value;
      const attempted = yield* Effect.result(attempt(intended));
      const completion = Result.isSuccess(attempted) ? attempted.success : undefined;
      if (
        completion === undefined ||
        completion.state === "waiting" ||
        completion.state === "held"
      ) {
        const { reason, wait } =
          completion === undefined
            ? unknownOutcome(
                intended.intent,
                Result.isFailure(attempted) ? attempted.failure : undefined,
              )
            : completion;
        yield* operations.noteWait({
          operationId,
          wait: {
            kind: wait.kind,
            basis: waitBasis(wait),
            actor: wait.actor,
            action: wait.action,
            resume: wait.resume,
          },
          text: renderWait(reason, wait),
        });
      }
      if (completion?.state === "held") return;
      // Not known whether the write applied, or not yet allowed: the next attempt reads it back
      // first, a minute later.
      if (completion === undefined || completion.state === "waiting") {
        const commandId = CommandId.make(`factory-operation:${operationId}`);
        const effects = yield* outbox.listByCommandId(commandId);
        yield* outbox.enqueue([
          {
            id: `effect:factory-operation:${operationId}:${effects.length + 1}`,
            commandId,
            threadId: ThreadId.make(`thread:factory:${intended.factoryId}:operations`),
            request: { type: "factory-operation.apply", operationId },
            availableAt: DateTime.add(yield* DateTime.now, { minutes: 1 }),
          },
        ]);
        return;
      }
      const fenced =
        "createAttempt" in completion ? { createAttempt: completion.createAttempt } : {};
      if (yield* operations.complete({ operationId, completion, ...fenced })) {
        yield* Queue.offer(wakes, { factoryId: intended.factoryId, trigger: "operation" });
      }
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Factory operation stays intended for the next try", {
        operationId: "",
        cause: Cause.pretty(cause),
      }),
    ),
  );

  return { apply };
});

export const layer = Layer.effect(FactoryEffects, make);
