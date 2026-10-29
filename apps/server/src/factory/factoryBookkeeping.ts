// @effect-diagnostics nodeBuiltinImport:off - write receipts are matched by sha256 digest.
import * as NodeCrypto from "node:crypto";

import type { FactoryId, FactoryItemKey } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TrackerComment } from "./factoryClaimPolicy.ts";
import type * as FactoryClaimStore from "./FactoryClaimStore.ts";
import type * as FactoryOperationStore from "./FactoryOperationStore.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/**
 * The comments on an item that T3 itself wrote, as its native write records prove: the receipts
 * and intents of its tracker operations, and the nonces only its own claim attempts disclosed.
 * Every other comment is evidence, whatever account wrote it: people and other tools may use the
 * factory's account too.
 */
export const makeBookkeeping =
  (deps: {
    readonly operations: FactoryOperationStore.FactoryOperationStore["Service"];
    readonly claims: FactoryClaimStore.FactoryClaimStore["Service"];
  }) =>
  (input: {
    readonly factoryId: FactoryId;
    readonly itemKey: FactoryItemKey;
    readonly accountId: string;
  }) =>
    Effect.gen(function* () {
      const written = new Set<string>();
      const intended = new Set<string>();
      for (const operation of yield* deps.operations.forItem(input)) {
        const { intent } = operation;
        if (intent.kind === "git_integrate") continue;
        if (operation.state === "applied" && "commentId" in operation.receipt) {
          written.add(`${operation.receipt.commentId}:${operation.receipt.bodyDigest}`);
        }
        if (operation.state === "intended") intended.add(sha256(intent.body));
      }
      const nonces: Array<string> = [];
      for (const claim of yield* deps.claims.list(input.factoryId)) {
        if (claim.itemKey !== input.itemKey) continue;
        const record = yield* deps.claims.get(claim.reservationId);
        if (Option.isSome(record)) {
          nonces.push(...record.value.attempts.map((attempt) => attempt.nonce));
        }
      }
      return (comment: TrackerComment) => {
        if (comment.authorId !== input.accountId) return false;
        const digest = sha256(comment.body);
        return (
          written.has(`${comment.id}:${digest}`) ||
          intended.has(digest) ||
          nonces.some((nonce) => comment.body.includes(nonce))
        );
      };
    });
