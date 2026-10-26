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
type Completion = PullRequestAttempt | undefined;

const make = Effect.gen(function* () {
  const operations = yield* FactoryOperationStore.FactoryOperationStore;
  const store = yield* FactoryStore.FactoryStore;
  const tracker = yield* FactoryTracker.FactoryTracker;
  const integrator = yield* FactoryIntegrator.FactoryIntegrator;
  const projects = yield* ProjectService.ProjectService;
  const wakes = yield* FactoryWakes;
  const outbox = yield* EffectOutbox.EffectOutboxV2;

  /** Our record on the issue, by its marker and our own account, written if it is not there. */
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
    const existing = issue.comments.find(ours);
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
    return Option.isSome(readBack) && ours(readBack.value)
      ? ({ commentId: written.commentId, bodyDigest: sha256(readBack.value.body), issue } as const)
      : undefined;
  });

  const attempt = Effect.fnUntraced(function* (
    operation: FactoryOperationStore.IntendedOperation,
  ): Effect.fn.Return<
    Completion,
    | FactoryTracker.FactoryTrackerError
    | FactoryIntegrator.FactoryIntegratorError
    | FactoryStore.FactoryStoreError
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
        (session) => attemptPullRequestMerge(session, integrator, { cwd, intent }),
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
      // Not known whether the write applied, or not yet allowed: the next attempt reads it back
      // first, a minute later.
      if (completion === undefined || completion.state === "waiting") {
        yield* operations.noteUncertain({
          operationId,
          error: Result.isFailure(attempted)
            ? String(attempted.failure).slice(0, 2_000)
            : (completion?.reason ?? "the write was not confirmed"),
        });
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
      if (yield* operations.complete({ operationId, completion })) {
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
