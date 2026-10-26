import {
  FactoryReservationId,
  type OrchestrationV2Run,
  ProviderDriverKind,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ExecutionContainment from "../process/custody/ExecutionContainment.ts";
import {
  ExecutionJoin,
  type ExecutionJoinShape,
  type JoinContext,
  type JoinFor,
  JoinRefused,
} from "@t3tools/shared/ExecutionJoin";
import { runRanAfter } from "@t3tools/shared/orchestrationV2ThreadError";
import * as FactoryStore from "./FactoryStore.ts";

/**
 * A generation is one kernel container for a factory run's processes, created once by one host and
 * never reused. State only moves forward: `opened` (intent), `held` (its host alone admits
 * members), `ended` (a probe from its own namespace found it gone, so no member exists or joins).
 * A host that loses the race to `held` closes what it created before anything joins.
 */

export const GenerationId = TrimmedNonEmptyString.pipe(Schema.brand("ExecutionGenerationId"));
export type GenerationId = typeof GenerationId.Type;

const GenerationFields = {
  generationId: GenerationId,
  runId: RunId,
  reservationId: FactoryReservationId,
  threadId: ThreadId,
  name: Schema.String,
  /** The creator's namespace: a probe from anywhere else proves nothing about this name. */
  identity: Schema.Struct({ machine: Schema.String, session: Schema.Number }),
  ownerHost: Schema.String,
  openedAt: Schema.String,
  /** Provider processes admitted: evidence the run's provider actually started inside it. */
  providerJoins: Schema.optional(Schema.Number),
  /**
   * The provider sessions those processes served, when the producer named one. A later turn of
   * the same session runs in that process, so it is this container's work too.
   */
  providerSessions: Schema.optional(Schema.Array(Schema.String)),
};

export const ExecutionGeneration = Schema.Union([
  Schema.Struct({ ...GenerationFields, state: Schema.Literal("opened") }),
  Schema.Struct({ ...GenerationFields, state: Schema.Literal("held"), heldAt: Schema.String }),
  Schema.Struct({
    ...GenerationFields,
    state: Schema.Literal("ended"),
    endedAt: Schema.String,
    endedFrom: Schema.Literals(["opened", "held"]),
    observedBy: Schema.String,
  }),
]);
export type ExecutionGeneration = typeof ExecutionGeneration.Type;

/**
 * What the process work of one run may be concluded to be. `providerJoined` says a provider
 * process was admitted to one of the run's containers at least once.
 */
export type RunProcessFacts =
  | { readonly type: "uncontained" }
  | { readonly type: "ended"; readonly providerJoined: boolean }
  | { readonly type: "quiet"; readonly providerJoined: boolean }
  | { readonly type: "live"; readonly members: number }
  | {
      readonly type: "unknown";
      readonly reason:
        | "container_unverified"
        | "container_namespace_mismatch"
        | "container_unreadable";
    };

/**
 * What several containers add up to: one unverified or live container decides; otherwise all are
 * gone, and a provider joined if any recorded one.
 */
export const combineProcessFacts = (facts: ReadonlyArray<RunProcessFacts>): RunProcessFacts => {
  if (facts.length === 0) return { type: "uncontained" };
  const unknown = facts.find((fact) => fact.type === "unknown");
  if (unknown !== undefined) return unknown;
  const live = facts.find((fact) => fact.type === "live");
  if (live !== undefined) return live;
  const providerJoined = facts.some(
    (fact) => (fact.type === "quiet" || fact.type === "ended") && fact.providerJoined,
  );
  return facts.some((fact) => fact.type === "quiet")
    ? { type: "quiet", providerJoined }
    : { type: "ended", providerJoined };
};

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

/**
 * The thread's current execution, for a process whose producer names no run: the run under way,
 * else the latest run that actually started. A run that never started (still queued, or
 * cancelled or refused before any provider ran) owns no process, however late its ordinal.
 */
const currentExecution = (runs: ReadonlyArray<OrchestrationV2Run>): OrchestrationV2Run | null => {
  let latest: OrchestrationV2Run | null = null;
  for (const run of runs) {
    if (ACTIVE_RUN_STATUSES.has(run.status)) return run;
    if (run.startedAt === null) continue;
    if (latest === null || runRanAfter(run, latest)) latest = run;
  }
  return latest;
};

/**
 * Drivers whose provider process for a contained thread starts through `ExecutionJoin`: the
 * Claude CLI, Codex's app server (in a session only that thread uses) and Muse's host.
 */
export const CONTAINED_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
  ProviderDriverKind.make("muse"),
]);

export class FactoryExecutionGenerationError extends Schema.TaggedError<FactoryExecutionGenerationError>()(
  "FactoryExecutionGenerationError",
  {
    runId: RunId,
    reason: Schema.Literals(["unavailable", "fenced", "store"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Execution container for run ${this.runId} could not be held (${this.reason}).`;
  }
}

/** A generation this host holds. Local bookkeeping; durable `held` is what others read. */
interface Held {
  generation: Extract<ExecutionGeneration, { readonly state: "held" }>;
  readonly holder: ExecutionContainment.ContainmentHolder;
  readonly permit: Semaphore.Semaphore;
  /** Joins started but not yet admitted or cancelled: they may become members at any moment. */
  pending: number;
  /** Exits of provider processes started here, for waiting on a provider that was closed. */
  readonly providerExits: Array<Effect.Effect<void>>;
  lost: boolean;
  closing: boolean;
}

export class FactoryExecutionGenerations extends Context.Service<
  FactoryExecutionGenerations,
  {
    /** Whether this host has a containment mechanism at all. */
    readonly available: boolean;
    /**
     * Records intent for a new generation of the run. Runs inside the caller's transaction and
     * does no kernel I/O; `hold` creates the object after that transaction commits.
     */
    readonly openIntent: (input: {
      readonly runId: RunId;
      readonly reservationId: FactoryReservationId;
      readonly threadId: ThreadId;
    }) => Effect.Effect<ExecutionGeneration, FactoryExecutionGenerationError>;
    /** Creates a committed intent's container and commits `held`, or fails fenced. */
    readonly hold: (
      generation: ExecutionGeneration,
    ) => Effect.Effect<void, FactoryExecutionGenerationError>;
    /**
     * Ends a committed intent this host will not hold after all, so recovery can read it as gone
     * now rather than after this process ends. Nothing joined it: no container was created.
     */
    readonly abandonIntent: (generation: ExecutionGeneration) => Effect.Effect<void>;
    /** This host's held generation for the run, opening and holding one if it holds none. */
    readonly ensureHeld: (input: {
      readonly runId: RunId;
      readonly reservationId: FactoryReservationId;
      readonly threadId: ThreadId;
    }) => Effect.Effect<void, FactoryExecutionGenerationError>;
    /**
     * How a process joins the run's held generation here. A provider's owner names the session
     * its process serves, which the generation records.
     */
    readonly joinFor: (runId: RunId, owner?: { readonly providerSessionId?: string }) => JoinFor;
    /** Whether this host holds a usable generation for the run now. */
    readonly isHeld: (runId: RunId) => Effect.Effect<boolean>;
    /** What each run's process work may be concluded to be; ends generations it finds gone. */
    readonly observe: (
      runIds: ReadonlyArray<RunId>,
    ) => Effect.Effect<ReadonlyMap<RunId, RunProcessFacts>>;
    /**
     * Every generation recorded for one execution (its reservation on its thread), each with
     * what its processes may be concluded to be. The whole set is what a custody judgement
     * reads: a provider that joined any of them is this execution's, and all must be gone.
     */
    readonly observeExecution: (input: {
      readonly reservationId: FactoryReservationId;
      readonly threadId: ThreadId;
    }) => Effect.Effect<
      ReadonlyArray<{ readonly generation: ExecutionGeneration; readonly facts: RunProcessFacts }>
    >;
    /** Ends this host's generation of the run if it has no member and no pending join. */
    readonly closeIfQuiet: (runId: RunId) => Effect.Effect<boolean>;
    /** Waits until every provider process this host started in the run's container has exited. */
    readonly awaitProviderExits: (runId: RunId) => Effect.Effect<void>;
    readonly generations: (
      runId: RunId,
    ) => Effect.Effect<ReadonlyArray<ExecutionGeneration>, FactoryExecutionGenerationError>;
  }
>()("t3/factory/FactoryExecutionGenerations") {}

const GenerationJson = Schema.fromJsonString(ExecutionGeneration);
const encodeGeneration = Schema.encodeEffect(GenerationJson, { onExcessProperty: "error" });
const decodeGeneration = Schema.decodeUnknownEffect(GenerationJson);

const isGenerationError = Schema.is(FactoryExecutionGenerationError);

const sameIdentity = (
  left: ExecutionContainment.ContainmentIdentity,
  right: ExecutionContainment.ContainmentIdentity,
) => left.machine === right.machine && left.session === right.session;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const containment = yield* ExecutionContainment.ExecutionContainment;
  const ownerHost = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
  const held = new Map<RunId, Held>();
  // Generations this host committed intent for and is creating: not yet held, already its own.
  const creating = new Set<GenerationId>();
  const creation = yield* Semaphore.make(1);
  const watchers = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const entry of held.values()) yield* entry.holder.close;
      yield* Scope.close(watchers, Exit.void);
    }),
  );

  const storeError = (runId: RunId) => (cause: unknown) =>
    new FactoryExecutionGenerationError({ runId, reason: "store", cause });

  const generations = (
    runId: RunId,
  ): Effect.Effect<ReadonlyArray<ExecutionGeneration>, FactoryExecutionGenerationError> =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_execution_generations WHERE run_id = ${runId}
      ORDER BY rowid
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeGeneration(row.record_json))),
      Effect.mapError(storeError(runId)),
    );

  const openIntent = Effect.fn("FactoryExecutionGenerations.openIntent")(function* (input: {
    readonly runId: RunId;
    readonly reservationId: FactoryReservationId;
    readonly threadId: ThreadId;
  }) {
    const identity = yield* containment.identity.pipe(
      Effect.mapError(
        (cause) =>
          new FactoryExecutionGenerationError({ runId: input.runId, reason: "unavailable", cause }),
      ),
    );
    const generationId = GenerationId.make(
      yield* crypto.randomUUIDv4().pipe(Effect.mapError(storeError(input.runId))),
    );
    const generation: ExecutionGeneration = {
      ...input,
      generationId,
      name: `Local\\t3-custody-${generationId}`,
      identity,
      ownerHost,
      openedAt: DateTime.formatIso(yield* DateTime.now),
      state: "opened",
    };
    const record = yield* encodeGeneration(generation).pipe(
      Effect.mapError(storeError(input.runId)),
    );
    creating.add(generationId);
    yield* sql`
      INSERT INTO factory_execution_generations (
        generation_id, run_id, reservation_id, thread_id, state, record_json
      ) VALUES (
        ${generationId}, ${input.runId}, ${input.reservationId}, ${input.threadId}, 'opened',
        ${record}
      )
    `.pipe(
      Effect.mapError(storeError(input.runId)),
      Effect.onError(() => Effect.sync(() => creating.delete(generationId))),
    );
    return generation;
  });

  /** Commits `ended` from `from`; false when the stored state had already moved on. */
  const commitEnded = Effect.fn("FactoryExecutionGenerations.commitEnded")(
    function* (generation: ExecutionGeneration, from: "opened" | "held") {
      if (generation.state === "ended") return true;
      const ended: ExecutionGeneration = {
        generationId: generation.generationId,
        runId: generation.runId,
        reservationId: generation.reservationId,
        threadId: generation.threadId,
        name: generation.name,
        identity: generation.identity,
        ownerHost: generation.ownerHost,
        openedAt: generation.openedAt,
        ...(generation.providerJoins === undefined
          ? {}
          : { providerJoins: generation.providerJoins }),
        // Which session's process it held is what attributes that session's later turns to it.
        ...(generation.providerSessions === undefined
          ? {}
          : { providerSessions: generation.providerSessions }),
        state: "ended",
        endedAt: DateTime.formatIso(yield* DateTime.now),
        endedFrom: from,
        observedBy: ownerHost,
      };
      const rows = yield* sql`
        UPDATE factory_execution_generations
        SET state = 'ended', record_json = ${yield* encodeGeneration(ended)}
        WHERE generation_id = ${generation.generationId} AND state = ${from}
        RETURNING generation_id
      `;
      return rows.length === 1;
    },
    (effect, generation) => Effect.mapError(effect, storeError(generation.runId)),
  );

  const hold = Effect.fn("FactoryExecutionGenerations.hold")(function* (
    generation: ExecutionGeneration,
  ) {
    const { runId } = generation;
    // Creation and the `held` commit are one step: an interruption between them closes what was
    // created, and nothing has joined it yet.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const holder = yield* containment
          .hold(generation.name)
          .pipe(
            Effect.mapError(
              (cause) =>
                new FactoryExecutionGenerationError({ runId, reason: "unavailable", cause }),
            ),
          );
        const heldGeneration = {
          ...generation,
          state: "held" as const,
          heldAt: DateTime.formatIso(yield* DateTime.now),
        };
        const heldRecord = yield* encodeGeneration(heldGeneration).pipe(
          Effect.mapError(storeError(runId)),
          Effect.onError(() => holder.close),
        );
        const committed = yield* sql`
          UPDATE factory_execution_generations
          SET state = 'held', record_json = ${heldRecord}
          WHERE generation_id = ${generation.generationId} AND state = 'opened'
          RETURNING generation_id
        `.pipe(
          Effect.map((rows) => rows.length === 1),
          Effect.mapError(storeError(runId)),
          Effect.onError(() => holder.close),
        );
        if (!committed) {
          // Another host proved this generation gone first: this one is fenced.
          yield* holder.close;
          return yield* new FactoryExecutionGenerationError({ runId, reason: "fenced" });
        }
        const entry: Held = {
          generation: heldGeneration,
          holder,
          permit: yield* Semaphore.make(1),
          pending: 0,
          providerExits: [],
          lost: false,
          closing: false,
        };
        held.set(runId, entry);
        yield* holder.exited.pipe(
          Effect.andThen(Effect.sync(() => (entry.lost = true))),
          Effect.forkIn(watchers),
        );
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => creating.delete(generation.generationId))));
  });

  const abandonIntent = Effect.fn("FactoryExecutionGenerations.abandonIntent")(function* (
    generation: ExecutionGeneration,
  ) {
    creating.delete(generation.generationId);
    yield* commitEnded(generation, "opened").pipe(Effect.ignore);
  });

  const ensureHeld = Effect.fn("FactoryExecutionGenerations.ensureHeld")(function* (input: {
    readonly runId: RunId;
    readonly reservationId: FactoryReservationId;
    readonly threadId: ThreadId;
  }) {
    yield* creation.withPermits(1)(
      Effect.gen(function* () {
        const current = held.get(input.runId);
        if (current !== undefined && !current.lost && !current.closing) return;
        const generation = yield* sql
          .withTransaction(openIntent(input))
          .pipe(
            Effect.mapError((cause) =>
              isGenerationError(cause) ? cause : storeError(input.runId)(cause),
            ),
          );
        yield* hold(generation);
      }),
    );
  });

  /** Records, after the holder admitted it, that the run's provider started inside. */
  const recordProviderJoin = Effect.fn("FactoryExecutionGenerations.recordProviderJoin")(
    function* (entry: Held, providerSessionId: string | undefined) {
      const sessions = entry.generation.providerSessions ?? [];
      const generation = {
        ...entry.generation,
        providerJoins: (entry.generation.providerJoins ?? 0) + 1,
        ...(providerSessionId === undefined
          ? {}
          : {
              providerSessions: sessions.includes(providerSessionId)
                ? sessions
                : [...sessions, providerSessionId],
            }),
      };
      yield* sql`
        UPDATE factory_execution_generations
        SET record_json = ${yield* encodeGeneration(generation)}
        WHERE generation_id = ${generation.generationId} AND state = 'held'
      `;
      entry.generation = generation;
    },
    (effect, entry) => Effect.mapError(effect, storeError(entry.generation.runId)),
  );

  const joinFor =
    (runId: RunId, owner?: { readonly providerSessionId?: string }): JoinFor =>
    (command, args, role = "process") =>
      Effect.gen(function* () {
        const entry = held.get(runId);
        if (entry === undefined || entry.lost || entry.closing) {
          return yield* new JoinRefused({ reason: `run ${runId} holds no container here` });
        }
        yield* entry.permit.withPermits(1)(Effect.sync(() => entry.pending++));
        const release = Effect.sync(() => entry.pending--);
        const launch = yield* containment.joinCommand(entry.generation.name, command, args).pipe(
          Effect.tapError(() => release),
          Effect.mapError((cause) => new JoinRefused({ reason: cause.reason })),
        );
        return {
          command: launch.command,
          args: launch.args,
          admit: (pid: number, exited?: Effect.Effect<void>) =>
            entry.holder.assign(pid).pipe(
              Effect.mapError((cause) => new JoinRefused({ reason: cause.detail })),
              Effect.andThen(
                role === "provider"
                  ? recordProviderJoin(entry, owner?.providerSessionId).pipe(
                      Effect.mapError((cause) => new JoinRefused({ reason: cause.message })),
                      Effect.andThen(
                        Effect.sync(() => {
                          if (exited !== undefined) entry.providerExits.push(exited);
                        }),
                      ),
                    )
                  : Effect.void,
              ),
              Effect.ensuring(release),
            ),
          cancel: release,
        };
      });

  /** Facts about one generation; commits `ended` when its own namespace proves it gone. */
  const observeGeneration: (generation: ExecutionGeneration) => Effect.Effect<RunProcessFacts> =
    Effect.fn("FactoryExecutionGenerations.observeGeneration")(function* (
      generation: ExecutionGeneration,
    ) {
      const providerJoined = (generation.providerJoins ?? 0) > 0;
      if (generation.state === "ended") return { type: "ended", providerJoined };
      if (creating.has(generation.generationId)) return { type: "live", members: 0 };
      const own = held.get(generation.runId);
      // A generation this host is closing, or lost, is judged like anyone else's: by probe.
      if (
        own !== undefined &&
        own.generation.generationId === generation.generationId &&
        !own.lost &&
        !own.closing
      ) {
        const ownFacts = yield* own.permit.withPermits(1)(
          Effect.gen(function* () {
            if (own.pending > 0) {
              return Option.some<RunProcessFacts>({ type: "live", members: own.pending });
            }
            const members = yield* own.holder.count.pipe(Effect.option);
            // A holder that cannot answer has ended, whether or not its exit was seen yet.
            if (Option.isNone(members)) {
              own.lost = true;
              return Option.none<RunProcessFacts>();
            }
            return Option.some<RunProcessFacts>(
              members.value === 0
                ? ({ type: "quiet", providerJoined } as const)
                : ({ type: "live", members: members.value } as const),
            );
          }),
        );
        if (Option.isSome(ownFacts)) return ownFacts.value;
      }
      const probe = yield* containment.probe(generation.name);
      if (probe.identity !== null && !sameIdentity(probe.identity, generation.identity)) {
        return { type: "unknown", reason: "container_namespace_mismatch" };
      }
      if (probe.type === "absent") {
        const ended = yield* commitEnded(generation, generation.state).pipe(
          Effect.orElseSucceed(() => false),
        );
        if (ended) {
          if (own?.generation.generationId === generation.generationId)
            held.delete(generation.runId);
          return { type: "ended", providerJoined };
        }
        // Its state moved while it was probed: judge it again from what is stored now.
        return { type: "unknown", reason: "container_unverified" };
      }
      return probe.type === "active"
        ? { type: "unknown", reason: "container_unverified" }
        : { type: "unknown", reason: "container_unreadable" };
    });

  const combine = combineProcessFacts;

  const observe = Effect.fn("FactoryExecutionGenerations.observe")(function* (
    runIds: ReadonlyArray<RunId>,
  ) {
    const result = new Map<RunId, RunProcessFacts>();
    for (const runId of new Set(runIds)) {
      const stored = yield* generations(runId).pipe(Effect.option);
      if (Option.isNone(stored)) {
        result.set(runId, { type: "unknown", reason: "container_unreadable" });
        continue;
      }
      result.set(runId, combine(yield* Effect.forEach(stored.value, observeGeneration)));
    }
    return result as ReadonlyMap<RunId, RunProcessFacts>;
  });

  const observeExecution = Effect.fn("FactoryExecutionGenerations.observeExecution")(
    function* (input: {
      readonly reservationId: FactoryReservationId;
      readonly threadId: ThreadId;
    }) {
      const stored = yield* sql<{ readonly record_json: string }>`
      SELECT record_json FROM factory_execution_generations
      WHERE reservation_id = ${input.reservationId} AND thread_id = ${input.threadId}
      ORDER BY rowid
    `.pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeGeneration(row.record_json))),
        Effect.option,
      );
      // An unreadable store lists nothing here; the judged runs' own read of it reports unknown.
      if (Option.isNone(stored)) return [];
      return yield* Effect.forEach(stored.value, (generation) =>
        Effect.map(observeGeneration(generation), (facts) => ({ generation, facts })),
      );
    },
  );

  const closeIfQuiet = Effect.fn("FactoryExecutionGenerations.closeIfQuiet")(function* (
    runId: RunId,
  ) {
    const entry = held.get(runId);
    if (entry === undefined || entry.lost) return false;
    const quiet = yield* entry.permit.withPermits(1)(
      Effect.gen(function* () {
        if (entry.pending > 0) return false;
        const members = yield* entry.holder.count.pipe(Effect.option);
        if (Option.isNone(members) || members.value !== 0) return false;
        // No join is pending and none can start: the next one finds it closing.
        entry.closing = true;
        return true;
      }),
    );
    if (!quiet) return false;
    yield* entry.holder.close;
    const ended = yield* observeGeneration(entry.generation);
    if (held.get(runId) === entry) held.delete(runId);
    return ended.type === "ended";
  });

  const isHeld = (runId: RunId) =>
    Effect.sync(() => {
      const entry = held.get(runId);
      return entry !== undefined && !entry.lost && !entry.closing;
    });

  return FactoryExecutionGenerations.of({
    available: containment.mechanism !== null,
    isHeld,
    openIntent,
    hold,
    abandonIntent,
    ensureHeld,
    joinFor,
    observe,
    observeExecution,
    closeIfQuiet,
    awaitProviderExits: Effect.fn("FactoryExecutionGenerations.awaitProviderExits")(
      function (runId) {
        return Effect.suspend(() => {
          const entry = held.get(runId);
          return entry === undefined
            ? Effect.void
            : Effect.forEach(entry.providerExits, (exited) => exited, { discard: true });
        });
      },
    ),
    generations,
  });
});

export const layer = Layer.effect(FactoryExecutionGenerations, make);

/**
 * The production join resolver: a thread bound to a native factory reservation joins the held
 * generation of its current run; any other thread is not contained here.
 */
const makeExecutionJoin = Effect.gen(function* () {
  const generations = yield* FactoryExecutionGenerations;
  const store = yield* FactoryStore.FactoryStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const containment = yield* ExecutionContainment.ExecutionContainment;
  return {
    forThread: Effect.fn("ExecutionJoin.forThread")(function* (
      threadId: string,
      context?: JoinContext,
    ) {
      const thread = ThreadId.make(threadId);
      const binding = yield* store
        .bindingForThread(thread)
        .pipe(Effect.mapError((cause) => new JoinRefused({ threadId, reason: cause.message })));
      if (Option.isNone(binding) || !FactoryStore.isNativeReservation(binding.value)) {
        return Option.none();
      }
      // A host without a mechanism contains nothing; its runs' custody stays unknown.
      if (containment.mechanism === null) return Option.none();
      const projection = yield* projections
        .getThreadProjection(thread)
        .pipe(Effect.mapError((cause) => new JoinRefused({ threadId, reason: String(cause) })));
      // The run the producer serves is authoritative; a producer that names none (Git work, a
      // terminal, a shared app server) joins the thread's current execution.
      const run =
        context?.runId === undefined
          ? currentExecution(projection.runs)
          : (projection.runs.find((candidate) => candidate.id === context.runId) ?? null);
      if (run === null) {
        return yield* new JoinRefused({
          threadId,
          reason:
            context?.runId === undefined
              ? "the thread has no run to contain"
              : `run ${context.runId} is not a run of this thread`,
        });
      }
      yield* generations
        .ensureHeld({
          runId: run.id,
          reservationId: binding.value.reservationId,
          threadId: thread,
        })
        .pipe(Effect.mapError((cause) => new JoinRefused({ threadId, reason: cause.message })));
      return Option.some(
        generations.joinFor(
          run.id,
          context?.providerSessionId === undefined
            ? undefined
            : { providerSessionId: context.providerSessionId },
        ),
      );
    }),
    heldForThread: Effect.fn("ExecutionJoin.heldForThread")(function* (threadId: string) {
      const thread = ThreadId.make(threadId);
      const binding = yield* store.bindingForThread(thread).pipe(Effect.option);
      if (Option.isNone(binding) || Option.isNone(binding.value)) return Option.none();
      if (!FactoryStore.isNativeReservation(binding.value.value)) return Option.none();
      const projection = yield* projections.getThreadProjection(thread).pipe(Effect.option);
      if (Option.isNone(projection)) return Option.none();
      const run = currentExecution(projection.value.runs);
      if (run === null || !(yield* generations.isHeld(run.id))) return Option.none();
      return Option.some(generations.joinFor(run.id));
    }),
  } satisfies ExecutionJoinShape;
});

export const layerExecutionJoin = Layer.effect(ExecutionJoin, makeExecutionJoin);

/**
 * Everything contained execution needs, built once per server: the host's mechanism, this
 * process's generations, and the resolver providers, terminals and mediated tools ask.
 */
export const layerExecutionCustody = layerExecutionJoin.pipe(
  Layer.provideMerge(layer),
  Layer.provide(FactoryStore.layer),
  Layer.provideMerge(ExecutionContainment.layer),
);
