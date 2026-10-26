// @effect-diagnostics nodeBuiltinImport:off - random claim nonces and helper digests.
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  type FactoryId,
  type FactoryReadGeneration,
  type FactoryReservationId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import type * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import {
  claimCommentBody,
  commentCarrierKeyOf,
  commentDigest,
  issueObservation,
} from "./factoryClaimPolicy.ts";
import * as FactoryClaimStore from "./FactoryClaimStore.ts";
import { makeBookkeeping } from "./factoryBookkeeping.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryRunPreparation from "./FactoryRunPreparation.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import * as FactoryTracker from "./FactoryTracker.ts";

export class FactoryClaimServiceError extends Schema.TaggedError<FactoryClaimServiceError>()(
  "FactoryClaimServiceError",
  { operation: Schema.String, reservationId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory claim ${this.operation} failed for ${this.reservationId}.`;
  }
}

/** Another writer moved our claim or attempt first; the move is not ours to make. */
class LostOwnMove extends Schema.TaggedError<LostOwnMove>()("LostOwnMove", {}) {}

export type FirstUseDecision =
  | {
      readonly type: "authorized";
      /** The run's container intent, committed with a workspace authorization on a contained host. */
      readonly generation?: FactoryExecutionGenerations.ExecutionGeneration;
    }
  | { readonly type: "refused"; readonly reason: string };

const authorized: FirstUseDecision = { type: "authorized" };
const refused = (reason: string): FirstUseDecision => ({ type: "refused", reason });

export class FactoryClaimService extends Context.Service<
  FactoryClaimService,
  {
    /**
     * Advances one claim as far as durable facts allow: write it once, read back our own
     * comment, and settle. Safe to run again at any point; it never repeats a send.
     */
    readonly process: (
      reservationId: FactoryReservationId,
    ) => Effect.Effect<void, FactoryClaimServiceError>;
    /**
     * The final check before a claimed decision first uses its claim: preparing its workspace, or
     * starting its first provider turn. All reads of the tracker and helper happen first; then
     * one native transaction records what the read saw, reloads the claim and the run, and
     * decides. A refusal holds the claim. Callers run it outside any transaction.
     */
    readonly authorizeFirstUse: (
      reservation: FactoryStore.NativeReservation,
      stage: FactoryClaimStore.FirstUseStage,
    ) => Effect.Effect<FirstUseDecision, FactoryClaimServiceError>;
    /**
     * Takes a claimed run waiting in `preparing` to its persisted preparation outcome: authorize
     * first use, prepare the workspace once, and wait for the run to be released or failed. Once
     * workspace work may have begun, a replay never prepares again; it holds the claim instead.
     */
    readonly prepareFirstUse: (input: {
      readonly reservationId: FactoryReservationId;
      readonly runId: RunId;
    }) => Effect.Effect<void, FactoryClaimServiceError>;
    /**
     * The owner's explicit recovery of a stage run someone interrupted before it ever started:
     * after fresh checks, the same run resumes through its own retry and prepares its workspace.
     * Nothing else ever resumes an interrupted run.
     */
    readonly recoverInterruptedRun: (input: {
      readonly factoryId: FactoryId;
      readonly reservationId: FactoryReservationId;
      readonly runId: RunId;
    }) => Effect.Effect<
      { readonly recovered: true } | { readonly recovered: false; readonly reason: string },
      FactoryClaimServiceError
    >;
  }
>()("t3/factory/FactoryClaimService") {}

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const store = yield* FactoryStore.FactoryStore;
  const claims = yield* FactoryClaimStore.FactoryClaimStore;
  const bookkeepingFor = makeBookkeeping({
    operations: yield* FactoryOperationStore.FactoryOperationStore,
    claims,
  });
  const tracker = yield* FactoryTracker.FactoryTracker;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const preparation = yield* FactoryRunPreparation.FactoryRunPreparation;
  const generations = yield* FactoryExecutionGenerations.FactoryExecutionGenerations;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  // Preparation watchers outlive the effect that started them, not the service.
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  // The helpers below are untraced: each runs only inside `process` or `authorizeFirstUse`, whose
  // spans already cover the claim operation they belong to.
  const helperMatches = Effect.fnUntraced(function* (
    configuration: FactoryStore.FactoryConfiguration,
  ) {
    const helper = configuration.packet.helper;
    if (helper === null) return true;
    const bytes = yield* fs.readFile(helper.path).pipe(Effect.option);
    return Option.isSome(bytes) && sha256(bytes.value) === helper.sha256;
  });

  /** A carrier the owner disposed of is no one's claim: it neither blocks nor is charged. */
  const withoutDisposed = Effect.fnUntraced(function* <
    O extends ReturnType<typeof issueObservation>,
  >(factoryId: FactoryStore.FactoryConfiguration["factoryId"], observation: O) {
    const disposed = yield* store.disposedCarriers(factoryId);
    return {
      ...observation,
      claims: observation.claims.filter((carrier) => !disposed.has(carrier.carrierKey)),
    };
  });

  const readFresh = Effect.fnUntraced(function* (
    session: FactoryTracker.TrackerSession,
    claim: FactoryClaimStore.FactoryClaimRecord,
    claimConfig: FactoryStore.FactoryClaimConfig,
  ) {
    const issue = yield* session.readIssue({
      repository: claim.target.repository,
      issueNumber: claim.target.issueNumber,
    });
    return yield* withoutDisposed(
      claim.factoryId,
      issueObservation({
        issue,
        subject: {
          tracker: "github",
          repository: claim.target.repository,
          issueNumber: claim.target.issueNumber,
        },
        claim: claimConfig,
        isBookkeeping: yield* bookkeepingFor({
          factoryId: claim.factoryId,
          itemKey: claim.itemKey,
          accountId: claimConfig.accountId,
        }),
      }),
    );
  });

  /**
   * Releases a claim that never sent a request, or whose every request was refused: nothing was
   * written and nothing ran, so the unit is free. One transaction for both records.
   */
  const releaseUnwritten = (
    claim: FactoryClaimStore.FactoryClaimRecord,
    from: ReadonlyArray<FactoryClaimStore.FactoryClaimState>,
    reason: FactoryClaimStore.FactoryClaimReleaseReason,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        if (
          yield* claims.transition({
            reservationId: claim.reservationId,
            from,
            to: { state: "released", reason },
          })
        ) {
          yield* store.releaseReservation(claim.reservationId, "claim_not_written");
        }
      }),
    );

  /**
   * Refuses a claim the fresh read shows it may not make, keeping what the read saw: the read is
   * recorded (so a foreign claim it saw is charged as its own observed reservation) in the same
   * transaction that frees the unwritten native unit, so capacity never looks free in between.
   */
  const refuseWithFreshRead = Effect.fnUntraced(function* (
    claim: FactoryClaimStore.FactoryClaimRecord,
    fresh: ReturnType<typeof issueObservation>,
    reason: "foreign_claim" | "source_changed",
  ) {
    const generation = yield* store.beginCollection(claim.factoryId);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* store.recordItemObservation({
          ...fresh,
          factoryId: claim.factoryId,
          itemKey: claim.itemKey,
          generation,
        });
        yield* releaseUnwritten(claim, ["pending"], reason);
      }),
    );
  });

  /** Our comment exists but may not start the execution: it stays held, with the reason. */
  const holdVerifiedComment = (
    claim: FactoryClaimStore.FactoryClaimRecord,
    attempt: FactoryClaimStore.WrittenFactoryClaimAttempt,
    digest: string,
    to: Extract<
      FactoryClaimStore.FactoryClaimDisposition,
      { readonly state: "stale_after_claim" | "conflicted"; readonly carrierKey: unknown }
    >,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* claims.advanceAttempt({
          reservationId: claim.reservationId,
          attempt: attempt.attempt,
          to: { phase: "verified", commentId: attempt.commentId, commentDigest: digest },
        });
        yield* claims.transition({ reservationId: claim.reservationId, from: ["writing"], to });
      }),
    );

  /**
   * Holds our read-back comment after a fresh read showed it may not start, keeping what that
   * read saw. Our comment is recorded as our own claim operation and the read is recorded, which
   * charges every other carrier it found; our own moves run in a savepoint, so if another writer
   * moved the claim first only they roll back, and the read and its charges still commit.
   */
  const holdWithFreshRead = Effect.fnUntraced(function* (
    claim: FactoryClaimStore.FactoryClaimRecord,
    attempt: FactoryClaimStore.WrittenFactoryClaimAttempt,
    digest: string,
    fresh: ReturnType<typeof issueObservation>,
    generation: FactoryReadGeneration,
    to: Extract<
      FactoryClaimStore.FactoryClaimDisposition,
      { readonly state: "stale_after_claim" | "conflicted"; readonly carrierKey: unknown }
    >,
  ) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const mirrored = yield* store.recordClaimOperation({
          reservationId: claim.reservationId,
          carrierKey: to.carrierKey,
        });
        // A collection that read our comment before this readback attested it charged it as
        // nobody's; our held native unit is now its one charge, as at settle.
        const reservation = yield* store.getReservation(claim.reservationId);
        if (mirrored && Option.exists(reservation, (held) => held.state === "held")) {
          yield* store.releaseObservedCarrier({
            factoryId: claim.factoryId,
            carrierKey: to.carrierKey,
          });
        }
        yield* store.recordItemObservation({
          ...fresh,
          factoryId: claim.factoryId,
          itemKey: claim.itemKey,
          generation,
        });
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const verified = yield* claims.advanceAttempt({
                reservationId: claim.reservationId,
                attempt: attempt.attempt,
                to: { phase: "verified", commentId: attempt.commentId, commentDigest: digest },
              });
              if (!verified) return yield* new LostOwnMove();
              const held = yield* claims.transition({
                reservationId: claim.reservationId,
                from: ["writing"],
                to,
              });
              if (!held) return yield* new LostOwnMove();
            }),
          )
          .pipe(Effect.catchTags({ LostOwnMove: () => Effect.void }));
      }),
    );
  });

  /**
   * Reads our own comment back by the id GitHub returned, checks the item afresh with exactly
   * that comment set aside, and settles: the verifying commit starts the execution.
   */
  const verifyWritten = Effect.fnUntraced(function* (
    session: FactoryTracker.TrackerSession,
    claim: FactoryClaimStore.FactoryClaimRecord,
    claimConfig: FactoryStore.FactoryClaimConfig,
    attempt: FactoryClaimStore.WrittenFactoryClaimAttempt,
  ) {
    const { commentId } = attempt;
    const comment = yield* session.readComment({
      repository: claim.target.repository,
      commentId,
    });
    // Not readable yet: the written receipt stays, and a later pass reads it again.
    if (Option.isNone(comment)) return;
    // The comment must be exactly what this attempt sent, rebuilt from its durable record: a
    // body that merely still carries our tokens may say something we never wrote.
    const intended = claimCommentBody({
      operationId: claim.operationId,
      nonce: attempt.nonce,
      itemKey: claim.itemKey,
    });
    if (comment.value.authorId !== attempt.accountId || comment.value.body !== intended) {
      // Our request applied, but what the comment says now is not certified as ours.
      return yield* claims.transition({
        reservationId: claim.reservationId,
        from: ["writing"],
        to: { state: "conflicted", reason: "own_comment_changed", commentId },
      });
    }
    const digest = commentDigest(intended);
    const carrierKey = commentCarrierKeyOf(claim.target, commentId, digest);
    const generation = yield* store.beginCollection(claim.factoryId);
    const fresh = yield* readFresh(session, claim, claimConfig);
    if (fresh.claims.some((carrier) => carrier.carrierKey !== carrierKey)) {
      return yield* holdWithFreshRead(claim, attempt, digest, fresh, generation, {
        state: "conflicted",
        reason: "foreign_claim",
        carrierKey,
      });
    }
    if (FactoryStore.basisDigestOf(fresh, carrierKey) !== claim.admitted.basisDigest) {
      return yield* holdWithFreshRead(claim, attempt, digest, fresh, generation, {
        state: "stale_after_claim",
        reason: "source_changed",
        carrierKey,
      });
    }
    yield* orchestrator
      .dispatch({
        type: "factory.claim.settle",
        commandId: CommandId.make(`factory-claim-settle:${claim.reservationId}:${attempt.attempt}`),
        threadId: claim.threadId,
        reservationId: claim.reservationId,
        attempt: attempt.attempt,
        commentId,
        commentDigest: digest,
        launch: claim.launch,
      })
      .pipe(
        // The settle commit re-checks every first-start fence; a failed fence holds the claim.
        Effect.catchTags({
          OrchestratorFactoryReservationRefusedError: Effect.fn(
            "FactoryClaimService.holdRefusedSettle",
          )(function* () {
            const current = yield* claims.get(claim.reservationId);
            if (Option.isSome(current) && current.value.claim.state === "writing") {
              yield* holdVerifiedComment(claim, attempt, digest, {
                state: "stale_after_claim",
                reason: "first_start_fence",
                carrierKey,
              });
            }
          }),
        }),
      );
  });

  const process = Effect.fn("FactoryClaimService.process")(
    function* (reservationId: FactoryReservationId) {
      const entry = yield* claims.get(reservationId);
      if (Option.isNone(entry)) return;
      const { claim, attempts } = entry.value;
      const configuration = yield* store.getConfiguration(claim.factoryId);
      if (Option.isNone(configuration) || configuration.value.claim === undefined) return;
      const claimConfig = configuration.value.claim;
      yield* tracker.withSession(
        { host: claim.target.host, cwd: configuration.value.artifactRoot },
        (session) =>
          Effect.gen(function* () {
            const last = attempts.at(-1);
            if (claim.state === "writing" && last?.phase === "written") {
              return yield* verifyWritten(session, claim, claimConfig, last);
            }
            // A prepared attempt with no durable answer belongs to the writer that prepared it.
            if (claim.state !== "pending") return;
            if (session.account.accountId !== claimConfig.accountId) {
              return yield* releaseUnwritten(claim, ["pending"], "claim_account_mismatch");
            }
            const fresh = yield* readFresh(session, claim, claimConfig);
            if (fresh.claims.length > 0) {
              return yield* refuseWithFreshRead(claim, fresh, "foreign_claim");
            }
            if (FactoryStore.basisDigestOf(fresh) !== claim.admitted.basisDigest) {
              return yield* refuseWithFreshRead(claim, fresh, "source_changed");
            }
            if (!(yield* helperMatches(configuration.value))) {
              return yield* releaseUnwritten(claim, ["pending"], "helper_changed");
            }
            const nonce = NodeCrypto.randomBytes(16).toString("hex");
            // Native state is checked again after the reads, in the transaction that takes the
            // sole right to send.
            const prepared = yield* sql.withTransaction(
              Effect.gen(function* () {
                const fence = yield* claims.firstStartFences(claim, undefined);
                if (fence !== undefined) {
                  yield* releaseUnwritten(claim, ["pending"], fence);
                  return undefined;
                }
                const result = yield* claims.prepareAttempt({
                  reservationId,
                  nonce,
                  accountId: session.account.accountId,
                });
                return result.type === "prepared" ? result.attempt : undefined;
              }),
            );
            if (prepared === undefined) return;
            const outcome = yield* session.createComment({
              repository: claim.target.repository,
              issueNumber: claim.target.issueNumber,
              body: claimCommentBody({
                operationId: claim.operationId,
                nonce,
                itemKey: claim.itemKey,
              }),
            });
            const record = (to: FactoryClaimStore.FactoryClaimAttemptOutcome) =>
              claims.advanceAttempt({ reservationId, attempt: prepared.attempt, to });
            switch (outcome.type) {
              case "ambiguous":
                // It may have applied: held, never sent again, never started.
                return yield* sql.withTransaction(
                  Effect.gen(function* () {
                    yield* record({ phase: "ambiguous", cause: outcome.cause });
                    yield* claims.transition({
                      reservationId,
                      from: ["writing"],
                      to: { state: "unknown", reason: "create_ambiguous" },
                    });
                  }),
                );
              case "rejected":
                return yield* sql.withTransaction(
                  Effect.gen(function* () {
                    yield* record({
                      phase: "rejected",
                      cause: outcome.cause,
                      transient: outcome.transient,
                    });
                    if (outcome.transient) {
                      yield* claims.transition({
                        reservationId,
                        from: ["writing"],
                        to: { state: "pending" },
                      });
                    } else {
                      yield* releaseUnwritten(claim, ["writing"], "create_rejected");
                    }
                  }),
                );
              case "written":
                // The id GitHub returned is durable before anything reads it back.
                yield* record({ phase: "written", commentId: outcome.commentId });
                return yield* verifyWritten(session, claim, claimConfig, {
                  ...prepared,
                  phase: "written",
                  commentId: outcome.commentId,
                });
            }
          }),
      );
    },
    (effect, reservationId) =>
      effect.pipe(
        Effect.mapError(
          (cause) => new FactoryClaimServiceError({ operation: "process", reservationId, cause }),
        ),
      ),
  );

  const authorizeFirstUse = Effect.fn("FactoryClaimService.authorizeFirstUse")(
    function* (
      reservation: FactoryStore.NativeReservation,
      stage: FactoryClaimStore.FirstUseStage,
    ) {
      if (reservation.origin !== "admitted") return authorized;
      const entry = yield* claims.get(reservation.reservationId);
      // A decision admitted without a claim requirement has nothing to recheck here.
      if (Option.isNone(entry)) return authorized;
      // What was verified selects what to read; only the transaction below authorizes.
      const { claim } = entry.value;
      const receipt = entry.value.attempts.find(
        (attempt): attempt is FactoryClaimStore.VerifiedFactoryClaimAttempt =>
          attempt.phase === "verified",
      );
      const usable =
        (claim.state === "verified" && stage.type !== "workspace_recovery") ||
        (claim.state === "workspace_authorized" &&
          stage.type === "provider_start" &&
          claim.runId === stage.runId) ||
        (claim.state === "stale_after_claim" &&
          stage.type === "workspace_recovery" &&
          FactoryClaimStore.PREPARATION_HOLD_REASONS.has(claim.reason));
      if (!usable || receipt === undefined) return refused("claim_not_ready");
      const configuration = yield* store.getConfiguration(claim.factoryId);
      if (Option.isNone(configuration) || configuration.value.claim === undefined) {
        return refused("configuration_changed");
      }
      const claimConfig = configuration.value.claim;

      // The tracker is read first (T1), then the helper (T2); native state is decided after both.
      const generation = yield* store.beginCollection(claim.factoryId);
      const read = yield* tracker.withSession(
        { host: claim.target.host, cwd: configuration.value.artifactRoot },
        (session) =>
          Effect.map(
            session.readIssue({
              repository: claim.target.repository,
              issueNumber: claim.target.issueNumber,
            }),
            (issue) => ({ issue, accountId: session.account.accountId }),
          ),
      );
      const helperCurrent = yield* helperMatches(configuration.value);

      const fresh = yield* withoutDisposed(
        claim.factoryId,
        issueObservation({
          issue: read.issue,
          subject: {
            tracker: "github",
            repository: claim.target.repository,
            issueNumber: claim.target.issueNumber,
          },
          claim: claimConfig,
          isBookkeeping: yield* bookkeepingFor({
            factoryId: claim.factoryId,
            itemKey: claim.itemKey,
            accountId: claimConfig.accountId,
          }),
        }),
      );
      const ownComment = read.issue.comments.find((comment) => comment.id === receipt.commentId);
      const ownCarrier =
        ownComment === undefined
          ? ("own_claim_missing" as const)
          : ownComment.authorId !== receipt.accountId ||
              ownComment.body !==
                claimCommentBody({
                  operationId: claim.operationId,
                  nonce: receipt.nonce,
                  itemKey: claim.itemKey,
                })
            ? ("own_claim_changed" as const)
            : undefined;
      const foreign = fresh.claims.some((carrier) => carrier.carrierKey !== claim.carrierKey);

      // T3: what the read saw is kept whatever is decided, so a foreign claim it found is charged
      // even when our own claim or run moved meanwhile.
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* store.recordItemObservation({
              ...fresh,
              factoryId: claim.factoryId,
              itemKey: claim.itemKey,
              generation,
            });
            const current = yield* claims.get(claim.reservationId);
            if (
              Option.isNone(current) ||
              current.value.claim.state !== claim.state ||
              !("carrierKey" in current.value.claim) ||
              current.value.claim.carrierKey !== claim.carrierKey ||
              !current.value.attempts.some(
                (attempt) =>
                  attempt.phase === "verified" &&
                  attempt.attempt === receipt.attempt &&
                  attempt.commentId === receipt.commentId &&
                  attempt.commentDigest === receipt.commentDigest,
              )
            ) {
              return refused("claim_moved");
            }
            if (!(yield* claims.runIsCurrent(stage))) return refused("run_moved");
            const fence = yield* claims.firstStartFences(claim, claim.carrierKey);
            // The admission window bounds how long a decision waits for its first start, and the
            // settle commit enforced it when it reserved this run. A revival or recovery resumes
            // that reservation, and a provider start after an authorized workspace continues it;
            // each has just read the basis again, so the window no longer applies to them.
            const firstStart =
              claim.state === "verified" &&
              (stage.type === "workspace" || stage.type === "provider_start");
            const reason = foreign
              ? ("foreign_claim" as const)
              : (ownCarrier ??
                (read.accountId === claimConfig.accountId
                  ? undefined
                  : ("claim_account_mismatch" as const)) ??
                (helperCurrent ? undefined : ("helper_changed" as const)) ??
                (fence === "deadline_expired" && !firstStart ? undefined : fence));
            if (reason !== undefined) {
              // A held claim stays held, with its own reason; recovery only declines.
              if (stage.type === "workspace_recovery") return refused(reason);
              const held = yield* claims.transition({
                reservationId: claim.reservationId,
                from: [claim.state],
                to:
                  reason === "foreign_claim"
                    ? { state: "conflicted", reason, carrierKey: claim.carrierKey }
                    : { state: "stale_after_claim", reason, carrierKey: claim.carrierKey },
              });
              return refused(held ? reason : "claim_moved");
            }
            if (stage.type === "workspace_recovery") {
              // One commit: the obligation passes to the new owner, the claim returns to this run,
              // and the new container's intent is recorded. Any lost move undoes all of it.
              const reowned = yield* store.reownWorkspaceObligation({
                runId: stage.runId,
                fromOwnerId: stage.priorOwnerId,
                toOwnerId: stage.ownerId,
                endedGenerations: stage.endedGenerations,
              });
              if (!reowned) return yield* new LostOwnMove();
              const recovered = yield* claims.recoverPreparation({
                reservationId: claim.reservationId,
                runId: stage.runId,
                carrierKey: claim.carrierKey,
              });
              if (!recovered) return yield* new LostOwnMove();
              const generation = yield* generations.openIntent({
                runId: stage.runId,
                reservationId: claim.reservationId,
                threadId: claim.threadId,
              });
              return { type: "authorized", generation } satisfies FirstUseDecision;
            }
            if (stage.type === "workspace" || stage.type === "workspace_revival") {
              const intended = yield* claims.transition({
                reservationId: claim.reservationId,
                from: ["verified"],
                to: {
                  state: "workspace_authorized",
                  carrierKey: claim.carrierKey,
                  runId: stage.runId,
                },
              });
              if (!intended) return refused("claim_moved");
              // The same commit opens the run's workspace obligation, before any workspace I/O, and on
              // a host that can contain it, the intent for the container its processes will join.
              yield* store.openWorkspaceObligation({
                runId: stage.runId,
                reservationId: claim.reservationId,
                threadId: claim.threadId,
                commandId: FactoryClaimStore.preparationCommandId(stage.runId),
                ownerId: stage.ownerId,
              });
              if (generations.available) {
                const generation = yield* generations.openIntent({
                  runId: stage.runId,
                  reservationId: claim.reservationId,
                  threadId: claim.threadId,
                });
                return { type: "authorized", generation } satisfies FirstUseDecision;
              }
            }
            return authorized;
          }),
        )
        .pipe(Effect.catchTags({ LostOwnMove: () => Effect.succeed(refused("claim_moved")) }));
    },
    (effect, reservation) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryClaimServiceError({
              operation: "authorize-first-use",
              reservationId: reservation.reservationId,
              cause,
            }),
        ),
      ),
  );

  const runStatus = (threadId: ThreadId, runId: RunId) =>
    Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs"], { runIds: [runId] }),
      (records) => records.runs.find((run) => run.id === runId)?.status,
    );

  /**
   * Waits for the run to leave `preparing`, the persisted preparation milestone: released into
   * `starting`, or failed or cancelled. Events are read from before `begin`, so an outcome
   * committed in between is not missed.
   */
  const awaitPreparation = Effect.fnUntraced(function* (
    threadId: ThreadId,
    runId: RunId,
    begin: Effect.Effect<void>,
  ) {
    const afterSequence = yield* orchestrator.getThreadEventSequence(threadId);
    yield* begin;
    const now = yield* runStatus(threadId, runId);
    if (now !== "preparing") return now;
    const left = yield* orchestrator
      .streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" })
      .pipe(
        Stream.map((stored) =>
          stored.event.type === "run.updated" && stored.event.payload.id === runId
            ? stored.event.payload.status
            : "preparing",
        ),
        Stream.filter((status) => status !== "preparing"),
        Stream.runHead,
      );
    if (Option.isNone(left)) {
      return yield* Effect.fail("The run's events ended while it was still preparing." as const);
    }
    return left.value;
  });

  // Each owned attempt of a run fails under its own id: a recovered attempt that fails again must
  // not replay the first attempt's failure, which would leave the run preparing.
  const failPreparingRun = (
    threadId: ThreadId,
    runId: RunId,
    reason: string,
    ownerId?: PreparationOwnerId,
  ) =>
    orchestrator.dispatch({
      type: "prepared-run.fail",
      commandId: CommandId.make(
        ownerId === undefined
          ? `factory-prepare-refused:${runId}`
          : `factory-prepare-refused:${runId}:${ownerId}`,
      ),
      threadId,
      runId,
      failure: makeProviderFailure({
        cause: reason,
        message: `This factory execution may not prepare its workspace: ${reason}.`,
        class: "validation_error",
        retryable: false,
      }),
    });

  /**
   * Holds the claim when its own preparation of `runId` failed or was cancelled before release.
   * The claim, run and phase are re-read in this transaction: a released or unknown phase, or a
   * claim that has moved on, changes nothing, so a successful handoff replays as a no-op whatever
   * its provider did later. A hold is a disposition, not proof that workspace work stopped.
   */
  const holdOnPreparationOutcome = (
    reservationId: FactoryReservationId,
    threadId: ThreadId,
    runId: RunId,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const current = yield* claims.get(reservationId);
        if (Option.isNone(current)) return;
        const { claim } = current.value;
        if (claim.state !== "workspace_authorized" || claim.runId !== runId) return;
        const phase = yield* claims.preparationPhase({ threadId, runId });
        if (phase !== "failed" && phase !== "cancelled") return;
        yield* claims.transition({
          reservationId,
          from: ["workspace_authorized"],
          to: {
            state: "stale_after_claim",
            reason:
              phase === "failed"
                ? "workspace_preparation_failed"
                : "workspace_preparation_cancelled",
            carrierKey: claim.carrierKey,
          },
        });
      }),
    );

  /**
   * Settles the run's obligation for this owner when its preparation ended having entered no
   * external process boundary. Forked into the service's own scope as soon as the handle exists,
   * so a lost drain does not lose the observation; any other evidence leaves it open.
   */
  const watchPreparation = (
    runId: RunId,
    handle: ThreadLaunchService.PreparationHandle,
    generationId: string | undefined,
  ) =>
    handle.ended.pipe(
      Effect.flatMap((evidence) =>
        evidence.type === "no_external_work"
          ? store.settleWorkspaceObligation({
              runId,
              ownerId: handle.ownerId,
              scope: { type: "no_external_work" },
            })
          : // Every process it may have started joined the run's container, which accounts for it.
            generationId !== undefined
            ? store.settleWorkspaceObligation({
                runId,
                ownerId: handle.ownerId,
                scope: { type: "contained", generationId },
              })
            : Effect.void,
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Factory workspace obligation could not be settled; it stays open", {
          runId,
          cause: Cause.pretty(cause),
        }),
      ),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );

  /**
   * Prepares an authorized run's workspace: its container exists, and is this host's, before any
   * workspace I/O (if it cannot be, nothing is prepared); then the owned preparation runs, joined
   * to it, and the claim follows its persisted outcome.
   */
  const prepareAuthorized = Effect.fnUntraced(function* (
    reservationId: FactoryReservationId,
    threadId: ThreadId,
    runId: RunId,
    ownerId: PreparationOwnerId,
    generation: FactoryExecutionGenerations.ExecutionGeneration | undefined,
  ) {
    if (generation !== undefined) {
      const held = yield* Effect.exit(generations.hold(generation));
      if (held._tag === "Failure") {
        // Nothing was prepared; the failed run holds its claim, for routine recovery to resume.
        yield* failPreparingRun(threadId, runId, "workspace_containment_unavailable", ownerId);
        return yield* holdOnPreparationOutcome(reservationId, threadId, runId);
      }
    }
    yield* awaitPreparation(
      threadId,
      runId,
      preparation
        .startOwned({
          commandId: FactoryClaimStore.preparationCommandId(runId),
          threadId,
          runId,
          ownerId,
          ...(generation === undefined ? {} : { join: generations.joinFor(runId) }),
        })
        .pipe(
          Effect.flatMap(
            Option.match({
              // Another preparation already holds the command: this owner's obligation stays
              // open, since nothing here can account for that one.
              onNone: () => Effect.void,
              onSome: (handle) => watchPreparation(runId, handle, generation?.generationId),
            }),
          ),
        ),
    );
    return yield* holdOnPreparationOutcome(reservationId, threadId, runId);
  });

  /**
   * The run's own retry, which the authorization just committed re-issued for it. A refusal (the
   * thread archived meanwhile, another run active) leaves the claim authorized for a run that is
   * not resuming: the container intent is abandoned at once, so the hold that follows reads it as
   * gone and routine recovery can resume the same run on a later pass.
   */
  const resumeRun = Effect.fnUntraced(function* (
    threadId: ThreadId,
    runId: RunId,
    ownerId: PreparationOwnerId,
    generation: FactoryExecutionGenerations.ExecutionGeneration | undefined,
  ) {
    yield* orchestrator
      .dispatch({
        type: "prepared-run.retry",
        commandId: CommandId.make(`factory-recovery:${runId}:${ownerId}`),
        threadId,
        runId,
      })
      .pipe(
        Effect.onError(() =>
          generation === undefined ? Effect.void : generations.abandonIntent(generation),
        ),
      );
  });

  /**
   * Recovers a held preparation from native facts only: every container of the run proved ended,
   * no preparation running here, effects reconciled from durable receipts. A setup that may have
   * run, or an unrecorded worktree, is never repeated (the claim stays held); otherwise one commit
   * re-owns the obligation under every first-use fence and the run's own retry prepares again.
   */
  const recoverHeldPreparation = Effect.fnUntraced(function* (
    reservation: FactoryStore.NativeReservation,
    threadId: ThreadId,
    runId: RunId,
  ) {
    const obligation = yield* store.workspaceObligation(runId);
    if (
      Option.isNone(obligation) ||
      obligation.value.state !== "open" ||
      obligation.value.reservationId !== reservation.reservationId
    ) {
      return;
    }
    const prior = obligation.value;
    const ended = yield* lostPreparationEnded(prior, runId);
    if (Option.isNone(ended)) return;
    const ownerId = PreparationOwnerId.make(yield* randomUuidV4);
    const decision = yield* authorizeFirstUse(reservation, {
      type: "workspace_recovery",
      runId,
      ownerId,
      priorOwnerId: prior.ownerId,
      endedGenerations: ended.value,
    });
    if (decision.type === "refused") return;
    yield* resumeRun(threadId, runId, ownerId, decision.generation);
    return yield* prepareAuthorized(
      reservation.reservationId,
      threadId,
      runId,
      ownerId,
      decision.generation,
    );
  });

  /**
   * The ended containers of a lost preparation that may prepare again: no owner here, every
   * container proved ended, and no receipt of setup or of a worktree begun but never recorded.
   */
  const lostPreparationEnded = Effect.fnUntraced(function* (
    prior: Extract<FactoryStore.WorkspaceObligation, { readonly state: "open" }>,
    runId: RunId,
  ) {
    if (Option.isSome(yield* preparation.currentOwner(prior.commandId))) return Option.none();
    if (!generations.available) return Option.none();
    const stored = yield* generations.generations(runId);
    const facts = (yield* generations.observe([runId])).get(runId);
    if (stored.length === 0 || facts?.type !== "ended") return Option.none();
    const receiptOf = (suffix: string) =>
      receipts
        .getByCommandId(CommandId.make(`${prior.commandId}:${suffix}`))
        .pipe(Effect.map(Option.isSome));
    if (yield* receiptOf("progress:setup")) return Option.none();
    if ((yield* receiptOf("progress:worktree")) && !(yield* receiptOf("workspace"))) {
      return Option.none();
    }
    return Option.some(stored.map((generation) => generation.generationId));
  });

  const otherRunActive = (threadId: ThreadId, runId: RunId) =>
    Effect.map(orchestrator.getThreadRecords(threadId, ["runs"]), (records) =>
      records.runs.some(
        (run) =>
          run.id !== runId &&
          (run.status === "preparing" ||
            run.status === "starting" ||
            run.status === "running" ||
            run.status === "waiting"),
      ),
    );

  /**
   * A stage with no claim of its own (it continues the claimed decision, or its factory requires
   * no claim) prepares under the owning claim's readiness, with an obligation and a container of
   * its own. A preparation lost or cancelled by a runtime recovers as a claimed one does.
   */
  const prepareUnclaimed = Effect.fnUntraced(function* (input: {
    readonly reservationId: FactoryReservationId;
    readonly runId: RunId;
  }) {
    const found = yield* store.getReservation(input.reservationId);
    if (
      Option.isNone(found) ||
      !FactoryStore.isNativeReservation(found.value) ||
      found.value.origin !== "admitted" ||
      found.value.state !== "held"
    ) {
      return;
    }
    const reservation = found.value;
    const threadId = reservation.execution.threadId;
    const status = yield* runStatus(threadId, input.runId);
    const cancelledByRuntime =
      status === "cancelled" && (yield* claims.preparationCancelledByRuntime(input.runId));
    const ownerId = PreparationOwnerId.make(yield* randomUuidV4);
    const obligation = yield* store.workspaceObligation(input.runId);
    const intent = (effect: Effect.Effect<boolean, FactoryStore.FactoryStoreError>) =>
      sql.withTransaction(
        Effect.gen(function* () {
          if (!(yield* effect))
            return Option.none<FactoryExecutionGenerations.ExecutionGeneration>();
          const generation = generations.available
            ? yield* generations.openIntent({
                runId: input.runId,
                reservationId: input.reservationId,
                threadId,
              })
            : undefined;
          return Option.some(generation);
        }),
      );
    if (Option.isSome(obligation)) {
      const prior = obligation.value;
      if (prior.state !== "open" || prior.reservationId !== input.reservationId) return;
      if (status !== "preparing" && status !== "failed" && !cancelledByRuntime) return;
      const ended = yield* lostPreparationEnded(prior, input.runId);
      if (Option.isNone(ended)) return;
      const generation = yield* intent(
        store.reownWorkspaceObligation({
          runId: input.runId,
          fromOwnerId: prior.ownerId,
          toOwnerId: ownerId,
          endedGenerations: ended.value,
        }),
      );
      if (Option.isNone(generation)) return;
      if (status !== "preparing") {
        yield* resumeRun(threadId, input.runId, ownerId, generation.value);
      }
      return yield* prepareAuthorized(
        input.reservationId,
        threadId,
        input.runId,
        ownerId,
        generation.value,
      );
    }
    if (status !== "preparing" && !cancelledByRuntime) return;
    // A container intent with no obligation belongs to a preparation this host cannot see.
    if ((yield* generations.generations(input.runId)).length > 0) return;
    if (!(yield* store.isClaimReady(reservation))) return;
    if (cancelledByRuntime && (yield* otherRunActive(threadId, input.runId))) return;
    const generation = yield* intent(
      store
        .openWorkspaceObligation({
          runId: input.runId,
          reservationId: input.reservationId,
          threadId,
          commandId: FactoryClaimStore.preparationCommandId(input.runId),
          ownerId,
        })
        .pipe(Effect.as(true)),
    );
    if (Option.isNone(generation)) return;
    if (cancelledByRuntime) yield* resumeRun(threadId, input.runId, ownerId, generation.value);
    return yield* prepareAuthorized(
      input.reservationId,
      threadId,
      input.runId,
      ownerId,
      generation.value,
    );
  });

  const recoverInterruptedRun = Effect.fn("FactoryClaimService.recoverInterruptedRun")(
    function* (input: {
      readonly factoryId: FactoryId;
      readonly reservationId: FactoryReservationId;
      readonly runId: RunId;
    }) {
      const refuse = (reason: string) => ({ recovered: false as const, reason });
      const found = yield* store.getReservation(input.reservationId);
      if (
        Option.isNone(found) ||
        !FactoryStore.isNativeReservation(found.value) ||
        found.value.origin !== "admitted" ||
        found.value.factoryId !== input.factoryId
      ) {
        return refuse("no admitted native reservation of this factory has that id");
      }
      const reservation = found.value;
      if (reservation.state !== "held") return refuse("the reservation is not held");
      if (reservation.execution.runId !== input.runId) {
        return refuse("the run is not the reservation's admitted run");
      }
      if (Option.isSome(yield* claims.get(reservation.reservationId))) {
        return refuse(
          "the reservation holds a claim of its own; only a continuing stage recovers here",
        );
      }
      const threadId = reservation.execution.threadId;
      const records = yield* orchestrator.getThreadRecords(threadId, ["runs"]);
      if (records.thread.archivedAt !== null || records.thread.deletedAt !== null) {
        return refuse("the reservation's thread is archived or deleted");
      }
      const run = records.runs.find((candidate) => candidate.id === input.runId);
      if (run === undefined) return refuse("the run is not on the reservation's thread");
      if (run.status !== "interrupted") return refuse(`the run is ${run.status}, not interrupted`);
      if (run.startedAt !== null) return refuse("the run started before it was interrupted");
      if (run.workspacePreparation === undefined) return refuse("the run asked for no workspace");
      if (yield* otherRunActive(threadId, input.runId)) return refuse("another run is active");
      if (!(yield* store.isClaimReady(reservation))) return refuse("the owning claim is not ready");
      // An obligation here is only an earlier recovery's whose resume was refused: taken over
      // once nothing prepares under it and every container it opened is proved ended.
      const prior = yield* store.workspaceObligation(input.runId);
      const stored = yield* generations.generations(input.runId);
      if (Option.isNone(prior) && stored.length > 0) {
        return refuse("the run already has an execution container");
      }
      if (Option.isSome(prior)) {
        if (prior.value.state !== "open" || prior.value.reservationId !== input.reservationId) {
          return refuse("the run already has a workspace obligation");
        }
        if (Option.isSome(yield* preparation.currentOwner(prior.value.commandId))) {
          return refuse("a preparation of the run is under way");
        }
        const facts = (yield* generations.observe([input.runId])).get(input.runId);
        if (stored.length > 0 && facts?.type !== "ended") {
          return refuse("the run's execution container is not proved ended");
        }
      }
      const ownerId = PreparationOwnerId.make(yield* randomUuidV4);
      const generation = yield* sql.withTransaction(
        Effect.gen(function* () {
          if (Option.isSome(prior)) {
            const reowned = yield* store.reownWorkspaceObligation({
              runId: input.runId,
              fromOwnerId: prior.value.ownerId,
              toOwnerId: ownerId,
              endedGenerations: stored.map((entry) => entry.generationId),
            });
            if (!reowned)
              return yield* Effect.fail("the run's obligation moved while it was taken over");
          } else {
            yield* store.openWorkspaceObligation({
              runId: input.runId,
              reservationId: input.reservationId,
              threadId,
              commandId: FactoryClaimStore.preparationCommandId(input.runId),
              ownerId,
            });
          }
          return generations.available
            ? yield* generations.openIntent({
                runId: input.runId,
                reservationId: input.reservationId,
                threadId,
              })
            : undefined;
        }),
      );
      yield* resumeRun(threadId, input.runId, ownerId, generation);
      // The resume is committed; the preparation runs as any stage's does, and a restart resumes it.
      yield* prepareAuthorized(input.reservationId, threadId, input.runId, ownerId, generation);
      return { recovered: true as const };
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryClaimServiceError({
              operation: "recover-interrupted-run",
              reservationId: input.reservationId,
              cause,
            }),
        ),
      ),
  );

  const prepareFirstUse = Effect.fn("FactoryClaimService.prepareFirstUse")(
    function* (input: { readonly reservationId: FactoryReservationId; readonly runId: RunId }) {
      // Nothing is authorized where nothing could prepare it.
      if (!preparation.available) {
        return yield* Effect.fail("No workspace preparation is available here." as const);
      }
      const entry = yield* claims.get(input.reservationId);
      if (Option.isNone(entry)) return yield* prepareUnclaimed(input);
      const { claim } = entry.value;
      const reservation = yield* store.getReservation(input.reservationId);
      if (Option.isNone(reservation) || !FactoryStore.isNativeReservation(reservation.value)) {
        return;
      }
      const commandId = FactoryClaimStore.preparationCommandId(input.runId);
      const status = yield* runStatus(claim.threadId, input.runId);
      const intentForThisRun =
        claim.state === "workspace_authorized" && claim.runId === input.runId;
      // Held only because its own preparation's outcome was lost: once that work is proved
      // gone and its effects reconciled, the same run prepares again.
      if (
        claim.state === "stale_after_claim" &&
        FactoryClaimStore.PREPARATION_HOLD_REASONS.has(claim.reason) &&
        (status === "failed" ||
          (status === "cancelled" && (yield* claims.preparationCancelledByRuntime(input.runId))))
      ) {
        return yield* recoverHeldPreparation(reservation.value, claim.threadId, input.runId);
      }
      // Cancelled by a runtime's own stop or start while its prepare effect had given up, with no
      // workspace work ever authorized: the same run is authorized afresh, under every first-use
      // fence, and prepares. A run anyone interrupted or took back stays as they left it.
      if (
        claim.state === "verified" &&
        status === "cancelled" &&
        (yield* claims.preparationCancelledByRuntime(input.runId))
      ) {
        const obligation = yield* store.workspaceObligation(input.runId);
        const stored = yield* generations.generations(input.runId);
        if (Option.isSome(obligation) || stored.length > 0) return;
        // The retry that follows the authorization is refused while another run is active, which
        // would leave the claim authorized for a run it cannot resume; a later pass tries again.
        const records = yield* orchestrator.getThreadRecords(claim.threadId, ["runs"]);
        if (
          records.runs.some(
            (run) =>
              run.id !== input.runId &&
              (run.status === "preparing" ||
                run.status === "starting" ||
                run.status === "running" ||
                run.status === "waiting"),
          )
        ) {
          return;
        }
        const ownerId = PreparationOwnerId.make(yield* randomUuidV4);
        const decision = yield* authorizeFirstUse(reservation.value, {
          type: "workspace_revival",
          runId: input.runId,
          threadId: claim.threadId,
          ownerId,
        });
        if (decision.type === "refused") {
          yield* Effect.logWarning("Factory claim revival refused; the claim stays as it is", {
            reservationId: input.reservationId,
            runId: input.runId,
            reason: decision.reason,
          });
          return;
        }
        yield* resumeRun(claim.threadId, input.runId, ownerId, decision.generation);
        return yield* prepareAuthorized(
          input.reservationId,
          claim.threadId,
          input.runId,
          ownerId,
          decision.generation,
        );
      }
      if (status !== "preparing") {
        if (intentForThisRun) {
          yield* holdOnPreparationOutcome(input.reservationId, claim.threadId, input.runId);
        }
        return;
      }
      if (claim.state === "verified") {
        const ownerId = PreparationOwnerId.make(yield* randomUuidV4);
        const decision = yield* authorizeFirstUse(reservation.value, {
          type: "workspace",
          runId: input.runId,
          ownerId,
        });
        if (decision.type === "refused") {
          return yield* failPreparingRun(claim.threadId, input.runId, decision.reason);
        }
        return yield* prepareAuthorized(
          input.reservationId,
          claim.threadId,
          input.runId,
          ownerId,
          decision.generation,
        );
      }
      if (intentForThisRun) {
        // This runtime's preparation by the obligation's own owner is awaited, never started
        // again. Any other owner, or none, is uncertainty about the earlier one.
        const obligation = yield* store.workspaceObligation(input.runId);
        const owner = yield* preparation.currentOwner(commandId);
        if (
          Option.isSome(obligation) &&
          obligation.value.state === "open" &&
          Option.exists(owner, (current) => current === obligation.value.ownerId)
        ) {
          yield* awaitPreparation(claim.threadId, input.runId, Effect.void);
          return yield* holdOnPreparationOutcome(input.reservationId, claim.threadId, input.runId);
        }
        // Workspace work may have begun under an owner this runtime cannot see. That is
        // uncertainty, not proof the work stopped: the claim and its unit stay held, and nothing
        // prepares again.
        yield* claims.transition({
          reservationId: claim.reservationId,
          from: ["workspace_authorized"],
          to: {
            state: "stale_after_claim",
            reason: "workspace_preparation_unknown",
            carrierKey: claim.carrierKey,
          },
        });
        return yield* failPreparingRun(
          claim.threadId,
          input.runId,
          "workspace_preparation_unknown",
          Option.isSome(obligation) ? obligation.value.ownerId : undefined,
        );
      }
      return yield* failPreparingRun(claim.threadId, input.runId, "claim_not_ready");
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new FactoryClaimServiceError({
              operation: "prepare-first-use",
              reservationId: input.reservationId,
              cause,
            }),
        ),
      ),
  );

  return FactoryClaimService.of({
    process,
    authorizeFirstUse,
    prepareFirstUse,
    recoverInterruptedRun,
  });
});

export const layer = Layer.effect(FactoryClaimService, make);
