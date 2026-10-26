import type { FactoryStateResult, FactoryTransferResult } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type * as FactoryLifecycle from "./FactoryLifecycle.ts";

type FactoryState = FactoryLifecycle.FactoryState;

/** A factory's state as every owner surface reads it: MCP, web, desktop and mobile alike. */
export const factoryStateView = (state: FactoryState): FactoryStateResult => ({
  configured: state.configuration !== null,
  ...(state.configuration === null
    ? {}
    : {
        enabled: state.configuration.enabled,
        configurationRevision: state.configuration.revision,
        policyRevision: state.configuration.policyRevision,
      }),
  pools: state.pools,
  issues: state.issues,
  reservations: state.reservations.map((reservation) => ({
    reservationId: reservation.reservationId,
    itemKey: reservation.itemKey,
    origin: reservation.origin,
    state: reservation.state,
    ...(reservation.origin === "admitted"
      ? { stage: reservation.taskKind, threadId: reservation.execution.threadId }
      : {}),
    custody: { state: reservation.custody.state, reasons: [...reservation.custody.reasons] },
    ...(reservation.claim === null ? {} : { claimState: reservation.claim.state }),
    ...(reservation.origin === "observed" ? { carrierKey: reservation.carrierKey } : {}),
    ...(reservation.origin === "transferred"
      ? {
          job: reservation.job,
          ...(reservation.workId === undefined ? {} : { workId: reservation.workId }),
        }
      : {}),
  })),
  reservedDecisions: state.reservedDecisions.map((decision) => ({
    decisionId: decision.decisionId,
    itemKey: decision.itemKey,
    stage: decision.stage,
    kind: decision.kind ?? "gate",
    reason: decision.reason,
    state: decision.state,
    createdAt: decision.createdAt,
    ...(decision.resolution === undefined
      ? {}
      : {
          answer: decision.resolution.answer,
          answeredBy: decision.resolution.by,
          ...(decision.resolution.grantId === undefined
            ? {}
            : { grantId: decision.resolution.grantId }),
        }),
  })),
  grants: state.grants.map((grant) => ({
    grantId: grant.grantId,
    itemKey: grant.itemKey,
    stage: grant.stage,
    state: grant.state,
    units: grant.units,
    remaining: grant.remaining,
  })),
  results: state.results,
  lastCollection: state.lastCollection,
});

/** A transfer's result as every owner surface reads it. */
export const transferView = (
  transferId: string,
  result: Effect.Success<
    ReturnType<FactoryLifecycle.FactoryLifecycle["Service"]["transferLegacy"]>
  >,
): FactoryTransferResult =>
  result.type === "refused"
    ? { state: "refused" as const, reason: result.reason, transferId, custody: [] }
    : {
        state: result.type,
        transferId,
        custody: (result.transfer.adopted?.items ?? []).flatMap((item) =>
          item.custody.map((held) => ({
            itemKey: item.itemKey,
            reservationId: held.reservationId,
            workId: held.workId,
            state: held.state,
          })),
        ),
      };
