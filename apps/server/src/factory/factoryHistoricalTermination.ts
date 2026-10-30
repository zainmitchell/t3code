// @effect-diagnostics nodeBuiltinImport:off - machine and boot identity have no Effect API; they
// are read from the OS itself, never from a client, a report or a file anyone can name.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProviderDriverKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as HostProcess from "@t3tools/shared/HostProcess";

/**
 * Which boot of which host this server runs in, read from the OS: the machine's own identity, the
 * OS's identity for this boot, and how long this boot has run by the OS's own counter.
 */
export const HostBoot = Schema.Struct({
  platform: Schema.Literals(["win32", "linux"]),
  machineId: Schema.String,
  /** Linux's random id for this boot; on Windows, the boot counter each boot increments. */
  bootId: Schema.String,
  /** Starts at zero only when the OS starts; suspend, hibernation and resume keep counting. */
  uptimeMs: Schema.Number,
});
export type HostBoot = typeof HostBoot.Type;

export class HostBootUnreadable extends Schema.TaggedError<HostBootUnreadable>()(
  "HostBootUnreadable",
  { reason: Schema.String },
) {
  override get message(): string {
    return `This host's boot identity could not be read: ${this.reason}`;
  }
}

const unreadable = (reason: string) => new HostBootUnreadable({ reason });

const run = (command: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) =>
        NodeChildProcess.execFile(
          command,
          args,
          { windowsHide: true, timeout: 10_000 },
          (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
        ),
      ),
    catch: (cause) => unreadable(`${NodePath.basename(command)} failed: ${String(cause)}`),
  });

const readText = (path: string) =>
  Effect.tryPromise({
    try: () => NodeFSP.readFile(path, "utf8"),
    catch: (cause) => unreadable(`${path}: ${String(cause)}`),
  }).pipe(Effect.map((text) => text.trim()));

/** One value of a `reg query` listing: its name, its type, then its data. */
export const registryValue = (listing: string, name: string) =>
  listing
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[0] === name && parts.length === 3)?.[2];

const readWindows = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const reg = NodePath.join(environment.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  const machineId = registryValue(
    yield* run(reg, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]),
    "MachineGuid",
  );
  const bootCount = Number(
    registryValue(
      yield* run(reg, [
        "query",
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters",
        "/v",
        "BootId",
      ]),
      "BootId",
    ),
  );
  if (machineId === undefined || !Number.isSafeInteger(bootCount)) {
    return yield* unreadable("the registry did not list MachineGuid and BootId");
  }
  // GetTickCount64: the interrupt-time count, which sleep and hibernation do not reset.
  return {
    platform: "win32" as const,
    machineId,
    bootId: String(bootCount),
    uptimeMs: NodeOS.uptime() * 1000,
  };
});

const readLinux = Effect.gen(function* () {
  const machineId = yield* readText("/etc/machine-id");
  const bootId = yield* readText("/proc/sys/kernel/random/boot_id");
  // CLOCK_BOOTTIME, which counts time suspended too.
  const uptimeMs = Number((yield* readText("/proc/uptime")).split(/\s+/)[0]) * 1000;
  if (machineId === "" || bootId === "" || !Number.isFinite(uptimeMs)) {
    return yield* unreadable("machine-id, boot_id or uptime was empty");
  }
  return { platform: "linux" as const, machineId, bootId, uptimeMs };
});

const readLocalHostBoot: Effect.Effect<HostBoot, HostBootUnreadable> = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  if (platform === "win32") return yield* readWindows;
  if (platform === "linux") return yield* readLinux;
  return yield* unreadable(`no boot identity is read on ${platform}`);
});

/** The OS's own account of this host and boot. Tests substitute the OS, nothing else does. */
export const HostBootReader = Context.Reference<{
  readonly read: Effect.Effect<HostBoot, HostBootUnreadable>;
}>("t3/factory/HostBootReader", { defaultValue: () => ({ read: readLocalHostBoot }) });

/**
 * What a producer retained while a historical execution ran: its exact runs, attempts, launches and
 * provider sessions, their host and every executor, for one restart operation. Only this places the
 * historical writers; a driver name or today's boot host says nothing about where they ran.
 */
export const HistoricalProvenance = Schema.Struct({
  reservationId: Schema.String,
  operationRef: Schema.String,
  /** Who retained it; recorded with the proof, never itself a reason to trust it. */
  source: Schema.String,
  host: Schema.Struct({ platform: Schema.Literals(["win32", "linux"]), machineId: Schema.String }),
  runs: Schema.Array(Schema.String),
  attempts: Schema.Array(Schema.String),
  launches: Schema.Array(
    Schema.Struct({ runId: Schema.String, status: Schema.String, attemptCount: Schema.Number }),
  ),
  providerSessions: Schema.Array(Schema.String),
  executors: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["local_process", "remote", "persistent", "delegated"]),
      machineId: Schema.String,
    }),
  ),
});
export type HistoricalProvenance = typeof HistoricalProvenance.Type;
export const decodeHistoricalProvenance = Schema.decodeUnknownOption(HistoricalProvenance);

/**
 * The retained provenance of a historical execution, for one restart operation. No producer of
 * this server retained any, so production reads none and every restart proof is refused; only a
 * test substitutes it. What it answers is decoded and checked like any other untrusted value.
 */
export const HistoricalProvenanceSource = Context.Reference<{
  readonly read: (input: {
    readonly reservationId: string;
    readonly operationRef: string;
  }) => Effect.Effect<Option.Option<unknown>>;
}>("t3/factory/HistoricalProvenanceSource", {
  defaultValue: () => ({ read: () => Effect.succeedNone }),
});

/**
 * Drivers whose provider runs only as processes on the server's own host. Necessary, never
 * sufficient: a name says nothing about where a historical run's writers ran or what they started.
 */
export const LOCAL_PROCESS_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
]);

/**
 * Why `current` is not a later boot of the host `captured` was read on; empty when it is. A
 * smaller uptime than at capture proves the OS started again since: nothing else resets it, and
 * a suspend or hibernation keeps counting. The boot identity must agree. Elapsed wall-clock time,
 * process listings and server restarts say nothing here.
 */
export const bootBoundaryRefusals = (
  captured: HostBoot,
  current: HostBoot,
): ReadonlyArray<string> => {
  if (captured.platform !== current.platform || captured.machineId !== current.machineId) {
    return ["foreign_host"];
  }
  return [
    ...(current.bootId === captured.bootId
      ? ["same_boot"]
      : current.platform === "win32" && !(Number(current.bootId) > Number(captured.bootId))
        ? ["boot_not_later"]
        : []),
    ...(current.uptimeMs < captured.uptimeMs ? [] : ["uptime_not_reset"]),
  ];
};

/**
 * What no retained producer fact settles for a historical execution whose provider never joined
 * its container: where its provider processes ran, and what their shell commands started beyond
 * T3. An owner may accept exactly this uncertainty; accepting it is a decision, never provenance.
 */
export const RESIDUAL_UNCERTAINTIES = [
  "non_t3_side_effects_unrecordable",
  "provider_executor_locality_unrecorded",
] as const;
export type ResidualUncertainty = (typeof RESIDUAL_UNCERTAINTIES)[number];

/**
 * Everything an owner's residual decision covers, read from T3's own records in the capture
 * transaction: the containers' host and serving process, every started attempt's provider thread
 * and session, and every recorded provider-native descendant with its exact session and fork.
 */
export interface ResidualScope {
  readonly reservationId: string;
  readonly operationRef: string;
  readonly host: { readonly platform: string; readonly machineId: string };
  readonly servingProcess: { readonly admittedIn: string; readonly ownerHost: string };
  readonly generations: ReadonlyArray<{
    readonly generationId: string;
    readonly runId: string;
    readonly machine: string;
    readonly session: number;
  }>;
  readonly attempts: ReadonlyArray<{
    readonly attemptId: string;
    readonly runId: string;
    readonly providerInstanceId: string;
    readonly providerThreadId: string;
    readonly providerSessionId: string;
    readonly driver: string;
    readonly nativeThreadId: string;
  }>;
  readonly nativeDescendants: ReadonlyArray<{
    readonly childThreadId: string;
    readonly parentThreadId: string;
    readonly subagentId: string;
    readonly providerInstanceId: string;
    readonly providerThreadId: string;
    readonly providerSessionId: string;
    readonly forkedFromProviderThreadId: string;
    readonly forkedFromProviderTurnId: string | null;
    readonly nativeThreadId: string;
  }>;
}

/** What a restart proof covers: exactly these attempts, launches and containers. */
export interface TerminationCoverage {
  readonly attempts: ReadonlyArray<string>;
  readonly launches: ReadonlyArray<{
    readonly runId: string;
    readonly status: string;
    readonly attemptCount: number;
  }>;
  readonly generations: ReadonlyArray<string>;
}

const launchKey = (launch: TerminationCoverage["launches"][number]) =>
  `${launch.runId}\u0000${launch.status}\u0000${launch.attemptCount}`;

/**
 * What a recorded restart covers, and on what: a proved restart whose capture bound retained
 * provenance of every writer, or the owner's accepted residual uncertainty. An unproved capture,
 * or a proof from a build that bound neither, covers nothing.
 */
export const provedCoverage = (
  termination:
    | {
        readonly capture: {
          readonly covers: TerminationCoverage;
          readonly provenance?: unknown;
          readonly residual?: unknown;
        };
        readonly proof?: unknown;
      }
    | undefined,
):
  | { readonly covers: TerminationCoverage; readonly basis: "provenance" | "residual" }
  | undefined => {
  if (termination?.proof === undefined) return undefined;
  const { capture } = termination;
  if (capture.provenance !== undefined) return { covers: capture.covers, basis: "provenance" };
  if (capture.residual !== undefined) return { covers: capture.covers, basis: "residual" };
  return undefined;
};

/**
 * The attempts a proved restart still covers. Any launch or container it did not name, or a
 * launch that changed, could be work started after that restart, so then it covers nothing.
 */
export const coveredAttempts = (
  covers: TerminationCoverage | undefined,
  current: Pick<TerminationCoverage, "launches" | "generations">,
): ReadonlySet<string> => {
  if (covers === undefined) return new Set();
  const proved = covers.launches.map(launchKey).toSorted();
  const now = current.launches.map(launchKey).toSorted();
  const knownGenerations = new Set(covers.generations);
  if (
    proved.length !== now.length ||
    proved.some((key, index) => key !== now[index]) ||
    current.generations.some((generationId) => !knownGenerations.has(generationId))
  ) {
    return new Set();
  }
  return new Set(covers.attempts);
};
