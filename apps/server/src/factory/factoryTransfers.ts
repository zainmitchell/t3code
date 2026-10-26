import type { FactoryId, FactoryItemKey, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import type * as CommandJobFence from "../commandJobs/CommandJobFence.ts";
import type * as CommandJobs from "../commandJobs/CommandJobs.ts";
import { canonical } from "./factoryOutcomes.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";
import type * as FactoryTransferStore from "./FactoryTransferStore.ts";

export interface FactoryTransferInput {
  readonly factoryId: FactoryId;
  /** Chosen by the caller; asking again with it finishes the same transfer. */
  readonly transferId: string;
  /** The legacy command job whose work is handed over. */
  readonly job: string;
  readonly by: string;
  readonly items: ReadonlyArray<{
    readonly itemKey: FactoryItemKey;
    /** The job's own work ids for the item, exactly as its receipts record them. */
    readonly workIds: ReadonlyArray<string>;
    /** Of those, workers the owner already accounted for, with why. */
    readonly historical?:
      | ReadonlyArray<{ readonly workId: string; readonly reason: string }>
      | undefined;
    readonly uncertain?: ReadonlyArray<string> | undefined;
  }>;
}

export type FactoryTransferResult =
  | {
      readonly type: "draining" | "adopted" | "rolled_back";
      readonly transfer: FactoryTransferStore.FactoryTransfer;
    }
  | { readonly type: "refused"; readonly reason: string };

export interface TransferDependencies {
  readonly store: FactoryStore.FactoryStore["Service"];
  readonly outcomes: FactoryOutcomeStore.FactoryOutcomeStore["Service"];
  readonly transfers: FactoryTransferStore.FactoryTransferStore["Service"];
  readonly fence: CommandJobFence.CommandJobFence["Service"];
  readonly commandJobs: Option.Option<CommandJobs.CommandJobs["Service"]>;
  readonly wake: (factoryId: FactoryId) => Effect.Effect<void>;
}

type TransferError =
  | FactoryStore.FactoryStoreError
  | FactoryOutcomeStore.FactoryOutcomeStoreError
  | FactoryTransferStore.FactoryTransferStoreError
  | CommandJobFence.CommandJobFenceError;

const refused = (reason: string): FactoryTransferResult => ({ type: "refused", reason });

/** Each transferred item's latest transfer, which says who holds the item now. */
export const latestTransfers = (transfers: ReadonlyArray<FactoryTransferStore.FactoryTransfer>) => {
  const latest = new Map<FactoryItemKey, FactoryTransferStore.FactoryTransfer>();
  for (const transfer of transfers) {
    for (const item of transfer.items) latest.set(item.itemKey, transfer);
  }
  return latest;
};

/**
 * Moves a legacy job's items to the factory or back: the writer fence is raised and the last pass
 * must stop first, yet neither proves uncontained legacy work ended, so adopted custody stays held,
 * charged and unstarted until the owner disposes of it. Original job, task, work, thread, run and
 * receipt identities are recorded as they were; the job's own state is not changed.
 */
export const makeTransfers = (deps: TransferDependencies) => {
  const { store, outcomes, transfers, fence } = deps;

  const transferLegacy = Effect.fn("FactoryLifecycle.transferLegacy")(function* (
    input: FactoryTransferInput,
  ): Effect.fn.Return<FactoryTransferResult, TransferError> {
    const configuration = yield* store.getConfiguration(input.factoryId);
    if (Option.isNone(configuration)) return refused("the factory is not configured");
    if (Option.isNone(deps.commandJobs)) return refused("this runtime runs no command jobs");
    const jobs = deps.commandJobs.value;
    if (input.items.length === 0) return refused("a transfer names the items it takes over");
    const requested = input.items.map((item) => ({
      itemKey: item.itemKey,
      workIds: [...item.workIds],
      ...(item.historical === undefined || item.historical.length === 0
        ? {}
        : { historical: item.historical.map((entry) => ({ ...entry })) }),
      uncertain: [...(item.uncertain ?? [])],
    }));
    const existing = yield* transfers.get(input.transferId);
    if (Option.isSome(existing)) {
      const same =
        existing.value.factoryId === input.factoryId &&
        existing.value.job === input.job &&
        canonical(existing.value.items) === canonical(requested);
      if (!same) return refused(`transfer ${input.transferId} names other work`);
      if (existing.value.state !== "draining") {
        return { type: existing.value.state, transfer: existing.value };
      }
    }
    const described = yield* Effect.result(jobs.describe(input.job));
    if (Result.isFailure(described)) return refused(described.failure.message);
    if (described.success.projectId !== configuration.value.projectId) {
      return refused(`job ${input.job} works in another project`);
    }
    const known = new Set(described.success.workers.map((worker) => worker.workId));
    const named = new Set<string>();
    for (const item of requested) {
      for (const workId of item.workIds) {
        if (!known.has(workId)) return refused(`job ${input.job} has no work ${workId}`);
        if (named.has(workId)) return refused(`work ${workId} is named twice`);
        named.add(workId);
      }
      for (const { workId } of item.historical ?? []) {
        if (!item.workIds.includes(workId)) {
          return refused(`historical work ${workId} is not among ${item.itemKey}'s work`);
        }
      }
    }
    if (Option.isNone(existing)) {
      const holders = latestTransfers(yield* transfers.list(input.factoryId));
      const reservations = yield* store.listReservations(input.factoryId);
      for (const { itemKey } of requested) {
        const other = holders.get(itemKey);
        if (other !== undefined && other.state !== "rolled_back") {
          return refused(`${itemKey} is already in transfer ${other.transferId}`);
        }
        const native =
          reservations.some(
            (reservation) =>
              reservation.itemKey === itemKey && FactoryStore.isNativeReservation(reservation),
          ) ||
          (yield* outcomes.itemEvents({ factoryId: input.factoryId, itemKey })).some(
            (event) => event.type === "outcome",
          );
        if (native) return refused(`${itemKey} already has native work`);
      }
    }
    const holder = `factory:${input.factoryId}:transfer:${input.transferId}`;
    const transfer = Option.isSome(existing)
      ? existing.value
      : yield* transfers.begin({
          transferId: input.transferId,
          factoryId: input.factoryId,
          job: input.job,
          holder,
          by: input.by,
          items: requested,
        });
    // From here the job's runner applies nothing more through T3, whatever it had queued.
    const writer = yield* fence.raise({ job: input.job, holder: transfer.holder });
    if (yield* jobs.running(input.job)) return { type: "draining", transfer };

    const drained = yield* Effect.result(jobs.describe(input.job));
    if (Result.isFailure(drained)) return refused(drained.failure.message);
    const workers = new Map(drained.success.workers.map((worker) => [worker.workId, worker]));
    const claim = configuration.value.claim;
    const charge = claim?.observedClaimPool ?? {
      poolId: configuration.value.pools[0]?.poolId,
      units: 1,
    };
    const poolId = charge.poolId;
    if (poolId === undefined) return refused("the factory has no pool to hold custody in");
    const reservations = yield* store.listReservations(input.factoryId);
    const items = [];
    for (const item of transfer.items) {
      const hold = (worker?: { readonly workId: string; readonly threadId: ThreadId | null }) =>
        store.holdTransferredCustody({
          factoryId: input.factoryId,
          itemKey: item.itemKey,
          transferId: transfer.transferId,
          job: transfer.job,
          poolId,
          units: charge.units,
          ...(worker === undefined ? {} : { worker }),
          historical:
            worker !== undefined &&
            (item.historical ?? []).some((entry) => entry.workId === worker.workId),
        });
      // Every legacy worker is its own execution: each is charged and bound, never folded into
      // one unit for the item.
      const custody = [];
      for (const workId of item.workIds) {
        const threadId = workers.get(workId)?.threadId ?? null;
        const held = yield* hold({ workId, threadId });
        custody.push({
          reservationId: held.reservationId,
          workId,
          threadId,
          state: held.state === "held" ? ("held" as const) : ("historical" as const),
        });
      }
      if (item.workIds.length === 0) {
        const held = yield* hold();
        custody.push({
          reservationId: held.reservationId,
          workId: null,
          threadId: null,
          state: "held" as const,
        });
      }
      items.push({
        itemKey: item.itemKey,
        workers: item.workIds.flatMap((workId) => {
          const worker = workers.get(workId);
          return worker === undefined ? [] : [{ ...worker, taskId: String(worker.taskId) }];
        }),
        carriers: reservations.flatMap((reservation) =>
          reservation.origin === "observed" &&
          reservation.state === "held" &&
          reservation.itemKey === item.itemKey
            ? [reservation.carrierKey]
            : [],
        ),
        custody,
      });
    }
    yield* transfers.adopt({
      transferId: transfer.transferId,
      adopted: {
        at: DateTime.formatIso(yield* DateTime.now),
        fenceGeneration: writer.generation,
        receiptsSha256: drained.success.receiptsSha256,
        lastPass: drained.success.lastPass,
        items,
      },
    });
    yield* deps.wake(input.factoryId);
    const adopted = Option.getOrThrow(yield* transfers.get(transfer.transferId));
    return { type: adopted.state, transfer: adopted };
  });

  const rollbackTransfer = Effect.fn("FactoryLifecycle.rollbackTransfer")(function* (input: {
    readonly factoryId: FactoryId;
    readonly transferId: string;
    readonly by: string;
    readonly reason: string;
  }): Effect.fn.Return<FactoryTransferResult, TransferError> {
    const found = yield* transfers.get(input.transferId);
    if (Option.isNone(found) || found.value.factoryId !== input.factoryId) {
      return refused(`no transfer ${input.transferId} in this factory`);
    }
    const transfer = found.value;
    if (transfer.state === "adopted" && transfer.adopted !== undefined) {
      const adoptedAt = transfer.adopted.at;
      const itemKeys = new Set(transfer.items.map((item) => item.itemKey));
      // Native work on an item makes it the factory's: two writers never share one.
      const started = (yield* store.listReservations(input.factoryId)).find(
        (reservation) =>
          reservation.origin === "admitted" &&
          itemKeys.has(reservation.itemKey) &&
          reservation.createdAt >= adoptedAt,
      );
      if (started !== undefined) {
        return refused(`native work began on ${started.itemKey}; it stays the factory's`);
      }
    }
    if (transfer.state !== "rolled_back") {
      yield* transfers.rollBack({
        transferId: transfer.transferId,
        by: input.by,
        reason: input.reason,
      });
    }
    // Each step is idempotent, so asking again finishes a rollback a crash interrupted.
    yield* store.releaseTransferredCustody({
      factoryId: input.factoryId,
      transferId: transfer.transferId,
    });
    yield* fence.lift({ job: transfer.job, holder: transfer.holder });
    yield* deps.wake(input.factoryId);
    const rolledBack = Option.getOrThrow(yield* transfers.get(transfer.transferId));
    return { type: rolledBack.state, transfer: rolledBack };
  });

  return { transferLegacy, rollbackTransfer };
};
