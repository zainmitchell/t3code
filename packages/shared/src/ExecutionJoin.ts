import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * How a process that belongs to a contained execution is started. The producer launches the
 * ticket's command, which runs nothing until it is admitted, then admits the process it started.
 * A ticket that is never admitted must be cancelled.
 */
export interface JoinTicket {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /**
   * `exited` completes once the started process has exited; for a provider it lets a caller that
   * closed the provider wait for that process to actually end.
   */
  readonly admit: (pid: number, exited?: Effect.Effect<void>) => Effect.Effect<void, JoinRefused>;
  readonly cancel: Effect.Effect<void>;
}

export class JoinRefused extends Schema.TaggedError<JoinRefused>()("JoinRefused", {
  threadId: Schema.optional(Schema.String),
  reason: Schema.String,
}) {
  override get message(): string {
    return `This execution's processes must start inside its container, and cannot: ${this.reason}`;
  }
}

/**
 * `provider` marks the provider's own process: the container records that one joined, so a run
 * whose provider never joined is not mistaken for one whose processes all ended.
 */
export type JoinRole = "provider" | "process";

export type JoinFor = (
  command: string,
  args: ReadonlyArray<string>,
  role?: JoinRole,
) => Effect.Effect<JoinTicket, JoinRefused>;

/**
 * What the producer knows about the process it starts. The run whose turn it serves is
 * authoritative over any reading of the thread's runs; the provider session it belongs to is
 * recorded by the container, so a later turn of that same session is attributable to it.
 */
export interface JoinContext {
  readonly runId?: string;
  readonly providerSessionId?: string;
}

export interface ExecutionJoinShape {
  /**
   * For a thread whose work is contained: how its processes join the container of its current
   * run, or of the run the context names. None when the thread's work is not contained here; a
   * refusal when it must be and cannot.
   */
  readonly forThread: (
    threadId: string,
    context?: JoinContext,
  ) => Effect.Effect<Option.Option<JoinFor>, JoinRefused>;
  /**
   * The same, only while this host already holds the container of the thread's current run;
   * never creates one. For work that belongs to a running execution if there is one.
   */
  readonly heldForThread: (threadId: string) => Effect.Effect<Option.Option<JoinFor>>;
}

/** Ownership comes from the factory's native binding; this leaf lets producers ask without it. */
export const ExecutionJoin = Context.Reference<ExecutionJoinShape>(
  "@t3tools/shared/ExecutionJoin",
  {
    defaultValue: () => ({
      forThread: () => Effect.succeedNone,
      heldForThread: () => Effect.succeedNone,
    }),
  },
);

/**
 * The container the current fiber's processes join, set by the code that owns the work (a
 * claimed run's preparation, or a mediated request for a contained thread). Forked fibers inherit
 * it. Absent, spawns are unchanged.
 */
export const CurrentExecutionJoin = Context.Reference<Option.Option<JoinFor>>(
  "@t3tools/shared/ExecutionJoin/CurrentExecutionJoin",
  { defaultValue: () => Option.none() },
);

const refusedSpawn = (description: string, cause?: unknown) =>
  PlatformError.badArgument({
    module: "ChildProcess",
    method: "spawn",
    description,
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * Starts `command` through its container's join and admits the process it started; if admission
 * fails, the join is stopped. A piped or shell command cannot be joined as one process, so it is
 * refused rather than run outside.
 */
export const spawnJoined = Effect.fnUntraced(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  join: JoinFor,
  command: ChildProcess.Command,
  role: JoinRole = "process",
) {
  if (command._tag !== "StandardCommand" || command.options.shell) {
    return yield* refusedSpawn("A contained execution cannot start a piped or shell command.");
  }
  const ticket = yield* join(command.command, command.args, role).pipe(
    Effect.mapError((error) => refusedSpawn(error.message, error)),
  );
  const handle = yield* spawner
    .spawn(ChildProcess.make(ticket.command, ticket.args, command.options))
    .pipe(Effect.onError(() => ticket.cancel));
  yield* ticket.admit(handle.pid, Effect.ignore(handle.exitCode)).pipe(
    Effect.tapError(() => handle.kill().pipe(Effect.ignore)),
    Effect.mapError((error) => refusedSpawn(error.message, error)),
  );
  return handle;
});

/** Starts every process of a fiber under `CurrentExecutionJoin` inside its container. */
const containedSpawner = (base: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const join = yield* CurrentExecutionJoin;
      return Option.isNone(join)
        ? yield* base.spawn(command)
        : yield* spawnJoined(base, join.value, command);
    }),
  );

/** Replaces the spawner with one that honours `CurrentExecutionJoin`. */
export const layerContainedSpawner = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, containedSpawner),
);
