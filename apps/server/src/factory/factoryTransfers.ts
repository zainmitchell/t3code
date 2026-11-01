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
    /** The issue body the owner attests bounds every legacy write on the item. */
    readonly scope?: { readonly body: string; readonly reason: string } | undefined;
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

/**
 * The files ALPHA's Python policy reads from a scope, or none if it would skip an entry and leave its
 * writer unseen: one `## Owned files` section of blank and `` - `path` `` lines its file pattern
 * takes whole. Python ends lines only at `\n` and counts other whitespace than JS, so any but
 * space, tab, `\n` and `\r\n` is refused.
 */
const listedOwnedFiles = (body: string, allowNone = false) => {
  for (let index = 0; index < body.length; index++) {
    const char = body.charAt(index);
    if (char === " " || char === "\t" || char === "\n") continue;
    if (char === "\r" && body.charAt(index + 1) === "\n") continue;
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || code === 0x85 || /\s/u.test(char)) return undefined;
  }
  const lines = body.split("\n");
  const heading = lines.findIndex((line) => /^## Owned files[ \t\r]*$/.test(line));
  if (heading === -1) return undefined;
  if (lines.some((line, index) => index !== heading && /^\s*#+\s*owned files\b/i.test(line))) {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  const section = lines.slice(heading + 1, end === -1 ? undefined : end);
  const files: Array<string> = [];
  let none = false;
  for (const line of section) {
    const file = /^[ \t]*- `([\w./-]+(?:\/[\w.-]+|\.\w+))`[ \t\r]*$/.exec(line)?.[1];
    if (file !== undefined) files.push(file);
    // ALPHA writes `None` for a verification-only unit: it owns no file, and says so once.
    else if (allowNone && !none && /^[ \t]*None[ \t\r]*$/.test(line)) none = true;
    else if (!/^[ \t\r]*$/.test(line)) return undefined;
  }
  if (none) return files.length === 0 ? files : undefined;
  return files.length === 0 ? undefined : files;
};

// BETA's policy (`beta_tick.py` `UNIT`, `RESOURCES`, `canon_path`) weighs a body only by the first
// Builder unit marker's `writes=`, as paths it compares case-insensitively.
const BETA_UNIT = /<!-- beta-unit:builder(?: writes=([^ ]+))?(?: resources=([a-z;-]+))? -->/;
const BETA_RESOURCES = new Set(["gpu", "ocr", "native-input"]);
const betaPath = (path: string) => {
  const unified = path.replaceAll("\\", "/");
  if (unified.startsWith("/") || unified.includes(":")) return undefined;
  const parts: Array<string> = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || !/^[A-Za-z0-9._@+-]+$/.test(segment)) return undefined;
    const name = segment.replace(/\.+$/, "");
    if (name === "") return undefined;
    parts.push(name.toLowerCase());
  }
  return parts.join("/") || ".";
};

/**
 * Whether BETA's policy weighs exactly the listed files. A body without a marker is unknown to
 * BETA, which keeps every start out beside it. One with a marker must name each listed file in
 * `writes=` and nothing else, plus known `resources=`: a narrower marker would hide the rest, and
 * any marker BETA reads otherwise, or a second one, is refused rather than guessed at.
 */
const betaWritesListed = (body: string, files: ReadonlyArray<string>) => {
  if ((body.match(/beta-unit/gi)?.length ?? 0) === 0) return true;
  const written = betaWrites(body);
  const listed = files.map(betaPath);
  return written !== undefined && !listed.includes(undefined) && sameScope(written, listed);
};

const sameScope = (
  left: ReadonlyArray<string | undefined>,
  right: ReadonlyArray<string | undefined>,
) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((path) => rightSet.has(path));
};

/** The paths BETA's only Builder marker writes, as BETA compares them; none if it reads otherwise. */
const betaWrites = (body: string) => {
  const marker = BETA_UNIT.exec(body);
  if ((body.match(/beta-unit/gi)?.length ?? 0) !== 1 || marker === null) return undefined;
  const [, writes, resources] = marker;
  if (writes === undefined || resources === undefined) return undefined;
  if (
    resources.split(";").some((name) => name !== "" && name !== "none" && !BETA_RESOURCES.has(name))
  ) {
    return undefined;
  }
  const written = writes.split(";").flatMap((path) => (path === "" ? [] : [betaPath(path)]));
  return written.length === 0 || written.includes(undefined) ? undefined : written;
};

// The connector policy's unit marker (`connector_policy.py` `UNIT`, `PATH`, `clean_paths`,
// `marker`): `writes` is the collision reservation, `edits` the narrower edit authority inside it.
const CONNECTOR_UNIT = /<!-- connector-unit ((?:[a-z]+=\S+ ?)+)-->/g;
const CONNECTOR_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.@+/-]{1,200}$/;
const CONNECTOR_WRITES_LIMIT = 40;
const CONNECTOR_EDITS_LIMIT = 100;

/** Paths as the connector policy cleans them: sorted, once each; none if any is unsafe. */
const connectorPaths = (raw: ReadonlyArray<string>, limit: number) => {
  if (raw.length === 0 || raw.length > limit) return undefined;
  const paths = new Set<string>();
  for (const entry of raw) {
    let path = entry.trim().replace(/^`+|`+$/g, "");
    if (path.startsWith("./")) path = path.slice(2);
    if (!CONNECTOR_PATH.test(path)) return undefined;
    paths.add(path);
  }
  return [...paths].toSorted();
};

/**
 * The issue's one connector-unit marker as the connector policy reads it, or none when it has no
 * such marker, more than one, a field twice or unknown, or a path that policy would refuse.
 */
const connectorUnit = (body: string) => {
  const found = [...body.matchAll(CONNECTOR_UNIT)];
  if (found.length !== 1 || (body.match(/connector-unit/g)?.length ?? 0) !== 1) return undefined;
  const fields = new Map<string, string>();
  for (const part of found[0]![1]!.trim().split(/\s+/)) {
    const at = part.indexOf("=");
    const key = part.slice(0, at);
    if (fields.has(key)) return undefined;
    fields.set(key, part.slice(at + 1));
  }
  if ([...fields.keys()].some((key) => !["writes", "edits", "effort", "closure"].includes(key))) {
    return undefined;
  }
  const effort = fields.get("effort");
  const closure = fields.get("closure") ?? "bounded";
  if (
    (effort !== undefined && effort !== "high" && effort !== "medium") ||
    (closure !== "bounded" && closure !== "whole")
  ) {
    return undefined;
  }
  const writes = connectorPaths((fields.get("writes") ?? "").split(";"), CONNECTOR_WRITES_LIMIT);
  if (writes === undefined) return undefined;
  const editsField = fields.get("edits");
  if (editsField === undefined) return { writes, effort, closure };
  const edits = connectorPaths(editsField.split(";"), CONNECTOR_EDITS_LIMIT);
  const inside = (path: string) =>
    writes.some((write) => path === write || (write.endsWith("/") && path.startsWith(write)));
  if (edits === undefined || !edits.every(inside)) return undefined;
  return { writes, edits, effort, closure };
};

/**
 * Whether a bounded issue's own declaration owns exactly `owned`, as its policy reads it: one
 * connector-unit marker's `writes` reservation alone; ALPHA's `## Owned files` section (`None` for
 * none), which any BETA Builder marker must name exactly; else BETA's Builder marker alone.
 * Undefined when the body declares nothing these read, or declares it ambiguously or mixed.
 */
export const declaresOwnedFiles = (body: string, owned: ReadonlyArray<string>) => {
  const connector = /connector-unit/.test(body);
  if (connector) {
    // One notation per issue: a connector unit beside another declaration is ambiguous.
    if (/^#+\s*owned files\b/im.test(body) || /beta-unit/i.test(body)) return undefined;
    const unit = connectorUnit(body);
    if (unit === undefined) return undefined;
    const claimed = connectorPaths(owned, CONNECTOR_WRITES_LIMIT);
    return claimed !== undefined && sameScope(unit.writes, claimed);
  }
  if (/^## Owned files[ \t\r]*$/m.test(body)) {
    const files = listedOwnedFiles(body, true);
    if (files === undefined || !betaWritesListed(body, files)) return undefined;
    return sameScope(files, owned) && owned.length === new Set(owned).size;
  }
  const written = betaWrites(body);
  if (written === undefined) return undefined;
  const claimed = owned.map(betaPath);
  return !claimed.includes(undefined) && sameScope(written, claimed);
};

/**
 * Whether every policy reads a scope as the same complete list of owned files: ALPHA from its
 * `## Owned files` section, BETA from its Builder unit marker. Stored scopes are checked again
 * with it at each pass, so one accepted by an earlier build counts as unscoped.
 */
export const namesOwnedFiles = (body: string) => {
  const files = listedOwnedFiles(body);
  return files !== undefined && betaWritesListed(body, files);
};

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
    const scopes = input.items.flatMap((item) =>
      item.scope === undefined
        ? []
        : [
            {
              itemKey: item.itemKey,
              body: item.scope.body,
              reason: item.scope.reason,
              by: input.by,
            },
          ],
    );
    const vague = scopes.find((scope) => listedOwnedFiles(scope.body) === undefined);
    if (vague !== undefined) {
      return refused(`${vague.itemKey}'s scope does not list each owned file under ## Owned files`);
    }
    const unmatched = scopes.find((scope) => !namesOwnedFiles(scope.body));
    if (unmatched !== undefined) {
      return refused(
        `${unmatched.itemKey}'s beta-unit marker does not declare exactly its owned files as writes, with resources`,
      );
    }
    // Scopes join the transfer whatever its state: a held pass lifts only once the owner says
    // what the legacy work may write.
    const attest = Effect.fnUntraced(function* (transfer: FactoryTransferStore.FactoryTransfer) {
      if (scopes.length === 0) return transfer;
      const before = transfer.scopes?.length ?? 0;
      const attested = yield* transfers.attestScopes({ transferId: transfer.transferId, scopes });
      if (attested.type === "refused") return attested.reason;
      if ((attested.transfer.scopes?.length ?? 0) > before) yield* deps.wake(input.factoryId);
      return attested.transfer;
    });
    const existing = yield* transfers.get(input.transferId);
    if (Option.isSome(existing)) {
      const same =
        existing.value.factoryId === input.factoryId &&
        existing.value.job === input.job &&
        canonical(existing.value.items) === canonical(requested);
      if (!same) return refused(`transfer ${input.transferId} names other work`);
      const scoped = yield* attest(existing.value);
      if (typeof scoped === "string") return refused(scoped);
      if (scoped.state !== "draining") return { type: scoped.state, transfer: scoped };
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
    if (Option.isNone(existing)) {
      const begun = yield* attest(
        yield* transfers.begin({
          transferId: input.transferId,
          factoryId: input.factoryId,
          job: input.job,
          holder,
          by: input.by,
          items: requested,
        }),
      );
      if (typeof begun === "string") return refused(begun);
    }
    const transfer = Option.getOrThrow(yield* transfers.get(input.transferId));
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
