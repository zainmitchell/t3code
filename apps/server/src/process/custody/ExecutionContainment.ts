// @effect-diagnostics nodeBuiltinImport:off - the holder must be this process's own direct child,
// so Node's kill-on-close job ends it with the server, and the helper is built by a local compiler.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../../config.ts";
import { CUSTODY_HELPER_SOURCE } from "./helperSource.ts";

/**
 * Execution containment: a kernel-maintained set of processes. Every process created by a member
 * is a member, none can leave, and the set ends all its members when its holder goes away. Only
 * descendants are covered; work a member hands to a broker (WMI, a scheduler, a running app) is not.
 */

export class ContainmentUnavailable extends Schema.TaggedError<ContainmentUnavailable>()(
  "ContainmentUnavailable",
  { reason: Schema.String },
) {
  override get message(): string {
    return `Execution containment is unavailable: ${this.reason}`;
  }
}

export class ContainmentHolderError extends Schema.TaggedError<ContainmentHolderError>()(
  "ContainmentHolderError",
  { name: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Execution container ${this.name} failed: ${this.detail}`;
  }
}

/** Where a kernel object name resolves: the same name in another session is another object. */
export interface ContainmentIdentity {
  readonly machine: string;
  readonly session: number;
}

export type ContainmentProbe =
  | { readonly type: "absent"; readonly identity: ContainmentIdentity }
  | { readonly type: "active"; readonly members: number; readonly identity: ContainmentIdentity }
  | {
      readonly type: "unreadable";
      readonly detail: string;
      readonly identity: ContainmentIdentity | null;
    };

/** The one handle that keeps a container alive. Only its holder assigns members. */
export interface ContainmentHolder {
  readonly name: string;
  readonly identity: ContainmentIdentity;
  readonly pid: number;
  /** Members now. Exact while no join this process started is between spawn and assignment. */
  readonly count: Effect.Effect<number, ContainmentHolderError>;
  /** Makes a process that this server started, and still holds, a member. */
  readonly assign: (pid: number) => Effect.Effect<void, ContainmentHolderError>;
  /** Ends the holder, and with it every member still running. */
  readonly close: Effect.Effect<void>;
  /** Completes when the holder process has exited, for any reason. */
  readonly exited: Effect.Effect<void>;
}

export interface ExecutionContainmentShape {
  readonly mechanism: "windows_job" | null;
  /** Creates the container `name`; fails if anything by that name already exists. */
  readonly hold: (
    name: string,
  ) => Effect.Effect<ContainmentHolder, ContainmentUnavailable | ContainmentHolderError>;
  /**
   * The command line for a process that joins `name`. It waits, running nothing, until the holder
   * assigned it, and then checks its membership before it starts `command`.
   */
  readonly joinCommand: (
    name: string,
    command: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<
    { readonly command: string; readonly args: ReadonlyArray<string> },
    ContainmentUnavailable
  >;
  readonly probe: (name: string) => Effect.Effect<ContainmentProbe>;
  readonly identity: Effect.Effect<ContainmentIdentity, ContainmentUnavailable>;
}

const unavailable = (reason: string): ExecutionContainmentShape => ({
  mechanism: null,
  hold: () => Effect.fail(new ContainmentUnavailable({ reason })),
  joinCommand: () => Effect.fail(new ContainmentUnavailable({ reason })),
  probe: () => Effect.succeed({ type: "unreadable", detail: reason, identity: null }),
  identity: Effect.fail(new ContainmentUnavailable({ reason })),
});

export const ExecutionContainment = Context.Reference<ExecutionContainmentShape>(
  "t3/process/ExecutionContainment",
  { defaultValue: () => unavailable("no containment mechanism on this host") },
);

const parseIdentity = (line: string | undefined): ContainmentIdentity | null => {
  const parts = line?.trim().split(" ");
  if (parts === undefined || parts.length !== 3 || parts[0] !== "identity") return null;
  const session = Number(parts[2]);
  return Number.isSafeInteger(session) ? { machine: parts[1]!, session } : null;
};

const sha256 = (data: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(data).digest("hex");

/**
 * The longest helper path the .NET Framework host starts. It resolves `<exe>.config` within
 * MAX_PATH: a 253-character binary compiles and then exits -1 without output, a 252-character one
 * runs. Measured on the host whose 131-character state directory first ran a factory.
 */
const HELPER_PATH_LIMIT = 252;

/** Kept after a success only, so one failed build does not stand in for the process's lifetime. */
const cachedSuccess = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.cachedWithTTL((exit: Exit.Exit<A, E>) =>
      Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
    ),
  );

const execFile = (file: string, args: ReadonlyArray<string>) =>
  Effect.callback<{ readonly code: number; readonly stdout: string }, ContainmentUnavailable>(
    (resume) => {
      const child = NodeChildProcess.execFile(
        file,
        [...args],
        { windowsHide: true, encoding: "utf8" },
        (error, stdout) => {
          if (error !== null && typeof error.code !== "number") {
            resume(Effect.fail(new ContainmentUnavailable({ reason: error.message })));
            return;
          }
          resume(Effect.succeed({ code: error === null ? 0 : Number(error.code), stdout }));
        },
      );
      return Effect.sync(() => {
        if (child.exitCode === null) child.kill();
      });
    },
  );

/**
 * Builds the helper from the shipped source with the compiler the host has, once per exact source
 * and compiler, and uses a binary only after it reports the expected key.
 */
const produceHelper = Effect.fn("ExecutionContainment.produceHelper")(function* (
  cacheDir: string,
  windowsDir: string,
) {
  const compiler = NodePath.join(
    windowsDir,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const compilerBytes = yield* Effect.tryPromise({
    try: () => NodeFSP.readFile(compiler),
    catch: () => new ContainmentUnavailable({ reason: `no compiler at ${compiler}` }),
  });
  const key = sha256(`${CUSTODY_HELPER_SOURCE}\0${compiler}\0${sha256(compilerBytes)}`);
  const helper = NodePath.join(cacheDir, `t3-custody-${key}.exe`);
  if (helper.length > HELPER_PATH_LIMIT) {
    return yield* new ContainmentUnavailable({
      reason: `the custody cache ${cacheDir} is too deep: the helper's path would be ${helper.length} characters, and the .NET host starts none longer than ${HELPER_PATH_LIMIT}`,
    });
  }
  /** Why the binary at `path` is not this key's helper; undefined when it is. */
  const rejected = (path: string) =>
    execFile(path, ["version"]).pipe(
      Effect.map((result) => {
        const answer = result.stdout.trim();
        if (result.code === 0 && answer === `version ${key}`) return undefined;
        return `exited ${result.code} on version${answer === "" ? "" : ` with "${answer}"`}`;
      }),
      Effect.catch((error) => Effect.succeed(error.reason)),
    );
  if ((yield* rejected(helper)) === undefined) return helper;
  yield* Effect.tryPromise({
    try: () => NodeFSP.mkdir(cacheDir, { recursive: true }),
    catch: (cause) => new ContainmentUnavailable({ reason: `cannot create ${cacheDir}: ${cause}` }),
  });
  // Unique per build, and shorter than the final name, so the temporary binary runs wherever the
  // cached one will: the host's limit is on the path, so a long temporary name fails a cache that
  // the helper itself fits.
  const temporary = NodePath.join(
    cacheDir,
    `t3-custody-${key.slice(0, 16)}.${NodeCrypto.randomBytes(8).toString("hex")}`,
  );
  const discard = Effect.promise(async () => {
    await NodeFSP.rm(`${temporary}.exe`, { force: true });
    await NodeFSP.rm(`${temporary}.cs`, { force: true });
  });
  yield* Effect.tryPromise({
    try: () =>
      NodeFSP.writeFile(
        `${temporary}.cs`,
        CUSTODY_HELPER_SOURCE.replace("__T3_CUSTODY_KEY__", key),
      ),
    catch: (cause) =>
      new ContainmentUnavailable({ reason: `cannot write the helper source: ${cause}` }),
  });
  const compiled = yield* execFile(compiler, [
    "-nologo",
    "-optimize",
    `-out:${temporary}.exe`,
    `${temporary}.cs`,
  ]).pipe(Effect.onError(() => discard));
  if (compiled.code !== 0) {
    yield* discard;
    return yield* new ContainmentUnavailable({
      reason: `${compiler} exited ${compiled.code}: ${compiled.stdout.trim().slice(-400)}`,
    });
  }
  const built = yield* rejected(`${temporary}.exe`);
  if (built !== undefined) {
    yield* discard;
    return yield* new ContainmentUnavailable({
      reason: `the compiled helper ${temporary}.exe ${built}`,
    });
  }
  // A hard link appears complete or not at all and never replaces a binary in use; whichever
  // process links first wins, and every process still verifies what it runs.
  yield* Effect.promise(() => NodeFSP.link(`${temporary}.exe`, helper).catch(() => undefined));
  yield* discard;
  const cached = yield* rejected(helper);
  if (cached !== undefined) {
    return yield* new ContainmentUnavailable({ reason: `the cached helper ${helper} ${cached}` });
  }
  return helper;
});

const holdWith = Effect.fn("ExecutionContainment.hold")(function* (helper: string, name: string) {
  const lines = yield* Queue.unbounded<string>();
  const exited = yield* Deferred.make<void>();
  const child = NodeChildProcess.spawn(helper, ["hold", name], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  let partial = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    partial += chunk;
    for (let index = partial.indexOf("\n"); index >= 0; index = partial.indexOf("\n")) {
      Queue.offerUnsafe(lines, partial.slice(0, index).trim());
      partial = partial.slice(index + 1);
    }
  });
  child.stdin.on("error", () => {});
  child.once("close", () => {
    Queue.offerUnsafe(lines, "exited");
    Deferred.doneUnsafe(exited, Effect.void);
  });
  child.once("error", () => {
    Queue.offerUnsafe(lines, "exited");
    Deferred.doneUnsafe(exited, Effect.void);
  });
  const fail = (detail: string) => new ContainmentHolderError({ name, detail });
  const identity = parseIdentity(yield* Queue.take(lines));
  const ready = yield* Queue.take(lines);
  if (identity === null || ready !== "ready" || child.pid === undefined) {
    if (child.exitCode === null) child.kill();
    yield* Deferred.await(exited);
    return yield* fail(ready.startsWith("failed") ? ready : "the holder did not start");
  }
  const permit = yield* Semaphore.make(1);
  const request = (line: string) =>
    permit.withPermits(1)(
      Effect.gen(function* () {
        if (child.exitCode !== null || child.stdin.destroyed) return "exited";
        child.stdin.write(`${line}\n`);
        return yield* Queue.take(lines);
      }),
    );
  return {
    name,
    identity,
    pid: child.pid,
    count: Effect.flatMap(request("count"), (reply) => {
      const members = reply.startsWith("members ") ? Number(reply.slice(8)) : Number.NaN;
      return Number.isSafeInteger(members) ? Effect.succeed(members) : Effect.fail(fail(reply));
    }),
    assign: (pid: number) =>
      Effect.flatMap(request(`assign ${pid}`), (reply) =>
        reply === `assigned ${pid}` ? Effect.void : Effect.fail(fail(reply)),
      ),
    close: Effect.gen(function* () {
      if (child.exitCode === null) child.stdin.end();
      yield* Deferred.await(exited);
    }),
    exited: Deferred.await(exited),
  } satisfies ContainmentHolder;
});

const probeWith = (helper: string, name: string) =>
  execFile(helper, ["probe", name]).pipe(
    Effect.map((result): ContainmentProbe => {
      const [identityLine, outcome = ""] = result.stdout.trim().split(/\r?\n/);
      const identity = parseIdentity(identityLine);
      if (result.code !== 0 || identity === null) {
        return { type: "unreadable", detail: `probe exited ${result.code}`, identity };
      }
      if (outcome === "absent") return { type: "absent", identity };
      const members = outcome.startsWith("active ") ? Number(outcome.slice(7)) : Number.NaN;
      return Number.isSafeInteger(members)
        ? { type: "active", members, identity }
        : { type: "unreadable", detail: outcome, identity };
    }),
    Effect.catch((error) =>
      Effect.succeed<ContainmentProbe>({
        type: "unreadable",
        detail: error.reason,
        identity: null,
      }),
    ),
  );

/**
 * Windows job objects through `t3-custody`. The helper is built lazily on first use; until it
 * exists nothing is contained, and every caller sees the mechanism as unavailable.
 */
export const makeWindows = Effect.fn("ExecutionContainment.makeWindows")(function* (options: {
  readonly cacheDir: string;
  readonly windowsDir: string;
}) {
  const helper = yield* cachedSuccess(produceHelper(options.cacheDir, options.windowsDir));
  const identity = yield* cachedSuccess(
    Effect.flatMap(helper, (path) => execFile(path, ["identity"])).pipe(
      Effect.flatMap((result) => {
        const parsed = parseIdentity(result.stdout);
        return parsed === null
          ? Effect.fail(new ContainmentUnavailable({ reason: "the helper reported no identity" }))
          : Effect.succeed(parsed);
      }),
    ),
  );
  return {
    mechanism: "windows_job",
    hold: (name) => Effect.flatMap(helper, (path) => holdWith(path, name)),
    joinCommand: (name, command, args) =>
      Effect.map(helper, (path) => ({
        command: path,
        args: ["join", name, "--", command, ...args],
      })),
    probe: (name) =>
      helper.pipe(
        Effect.flatMap((path) => probeWith(path, name)),
        Effect.catch((error) =>
          Effect.succeed<ContainmentProbe>({
            type: "unreadable",
            detail: error.reason,
            identity: null,
          }),
        ),
      ),
    identity,
  } satisfies ExecutionContainmentShape;
});

export const layerWindows = (options: { readonly cacheDir: string; readonly windowsDir: string }) =>
  Layer.effect(ExecutionContainment, makeWindows(options));

/**
 * The host's mechanism: job objects on Windows, cached under the server's state directory; none
 * elsewhere, where contained work stays unknown rather than assumed.
 */
export const layer = Layer.effect(
  ExecutionContainment,
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    if (platform !== "win32") return unavailable(`no containment mechanism on ${platform}`);
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const environment = yield* HostProcess.Environment;
    return yield* makeWindows({
      cacheDir: NodePath.join(stateDir, "custody"),
      windowsDir: environment.SystemRoot ?? environment.windir ?? "C:\\Windows",
    });
  }),
);
