// @effect-diagnostics nodeBuiltinImport:off - disposable repositories built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  FactoryReservationId,
  NodeId,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import type * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import type { FactoryCustody } from "./factoryCustody.ts";
import type * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import * as FactoryGitReadback from "./FactoryGitReadback.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { makeFactoryOutcomes } from "./factoryOutcomes.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const layerTest = FactoryOutcomeStore.layer.pipe(
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

const factoryId = FactoryId.make("connector");
const threadId = ThreadId.make("thread:implement");
const runId = RunId.make("run:implement");
const reservationId = FactoryReservationId.make("reservation:implement");

// BTC131's shape: the head exists, the reported base does not; the real base is elsewhere.
const head = "84b37ddb7d53c2643fb2649dbd0b807aad2d9a85";
const inventedBase = "d7365b40c0ae3b0de1d3c8e7c3b0bd3d3b7b8e46";
const realBase = "d7365b4382b9517fa34fa92394949df4d4484e01";
const unrelated = "0000000000000000000000000000000000000001";

const configuration = {
  factoryId,
  projectId: ProjectId.make("project:connector"),
  artifactRoot: "C:/artifacts",
} as unknown as FactoryStore.FactoryConfiguration;

const admitted: FactoryStore.FactoryReservation = {
  origin: "admitted",
  reservationId,
  factoryId,
  itemKey: FactoryItemKey.make("github:example/connector#131"),
  poolId: FactoryPoolId.make("builders"),
  units: 1,
  state: "held",
  createdAt: "2026-10-28T00:00:00.000Z",
  decisionKey: FactoryDecisionKey.make("decision:implement"),
  taskKind: "implement",
  itemVersion: "version:1",
  policyRevision: "policy:1",
  configRevision: 1,
  packetDigest: "packet",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
  execution: {
    commandId: CommandId.make("command:implement"),
    threadId,
    runId,
    taskNodeId: NodeId.make("node:implement"),
  },
  stageBasis: "implement:none",
};

// The execution ended: one completed run, nothing owed, no provider session left.
const projection = {
  thread: { id: threadId },
  runs: [
    {
      id: runId,
      ordinal: 1,
      status: "completed",
      startedAt: "2026-10-28T00:00:01.000Z",
      activeAttemptId: null,
      userMessageId: null,
    },
  ],
  attempts: [],
  messages: [],
  turnItems: [],
  providerThreads: [],
  runtimeRequests: [],
} as unknown as OrchestrationV2ThreadProjection;

interface Repository {
  readonly commits: ReadonlySet<string>;
  /** Descendant to its ancestors. */
  readonly ancestry: ReadonlyMap<string, ReadonlySet<string>>;
  /** Branch name to the commit it points at. */
  readonly branches?: ReadonlyMap<string, string>;
  /** Whether a read of the repository fails, as an unreadable workspace does. */
  unreadable: boolean;
}

const fakeGit = (
  repository: Repository,
  ancestryReads: Array<{ readonly ancestor: string; readonly descendant: string }>,
): FactoryGitReadback.FactoryGitReadbackShape => {
  const unreadable = (operation: string) =>
    new FactoryGitReadback.FactoryGitReadbackError({ operation, cause: "unreadable" });
  return {
    commitExists: ({ commit }) =>
      repository.unreadable
        ? Effect.fail(unreadable("commitExists"))
        : Effect.succeed(repository.commits.has(commit)),
    // Like `git merge-base --is-ancestor`: an unknown object is exit 128, an error, not "no".
    isAncestor: ({ ancestor, descendant }) => {
      ancestryReads.push({ ancestor, descendant });
      const commit = descendant.startsWith("refs/heads/")
        ? repository.branches?.get(descendant.slice("refs/heads/".length))
        : descendant;
      if (
        repository.unreadable ||
        commit === undefined ||
        !repository.commits.has(ancestor) ||
        !repository.commits.has(commit)
      ) {
        return Effect.fail(unreadable("isAncestor"));
      }
      return Effect.succeed(
        ancestor === commit || (repository.ancestry.get(commit)?.has(ancestor) ?? false),
      );
    },
    branchExists: ({ branch }) =>
      repository.unreadable
        ? Effect.fail(unreadable("branchExists"))
        : Effect.succeed(repository.branches?.has(branch) ?? false),
  };
};

/** A real repository's readback and the head it holds, in place of the in-memory one. */
interface Readback {
  readonly git: FactoryGitReadback.FactoryGitReadbackShape;
  readonly head: string;
}

const makeFixture = (
  source: Repository | Readback,
  options: {
    readonly reservation?: FactoryStore.FactoryReservation;
    readonly configuration?: FactoryStore.FactoryConfiguration;
  } = {},
) =>
  Effect.gen(function* () {
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    let reservation = options.reservation ?? admitted;
    const configured = options.configuration ?? configuration;
    let custody: FactoryCustody = { state: "unknown", reasons: ["execution_unreadable"] };
    const ancestryReads: Array<{ readonly ancestor: string; readonly descendant: string }> = [];
    const git = "git" in source ? source.git : fakeGit(source, ancestryReads);
    const headCommit = "git" in source ? source.head : head;
    const store = {
      bindingForThread: (id: ThreadId) =>
        Effect.succeed(id === threadId ? Option.some(reservation) : Option.none()),
      getReservation: (id: FactoryReservationId) =>
        Effect.succeed(id === reservationId ? Option.some(reservation) : Option.none()),
      getConfiguration: () => Effect.succeedSome(configured),
      listReservations: () => Effect.succeed([reservation]),
      releaseReservation: (_id: FactoryReservationId, releasedReason: "outcome_verified") =>
        Effect.sync(() => {
          if (reservation.state !== "held") return false;
          reservation = { ...reservation, state: "released", releasedReason };
          return true;
        }),
    } as unknown as FactoryStore.FactoryStore["Service"];
    const projections = {
      getThreadProjection: () => Effect.succeed(projection),
    } as unknown as ProjectionStore.ProjectionStoreV2["Service"];
    const sessions = {
      isLive: () => Effect.succeed(false),
    } as unknown as ProviderSessionManager.ProviderSessionManagerV2Shape;
    const generations = {} as FactoryExecutionGenerations.FactoryExecutionGenerations["Service"];
    const ops = makeFactoryOutcomes({
      store,
      outcomes,
      projections,
      git,
      sessions,
      generations,
      custodyOf: () => Effect.sync(() => custody),
      settleThread: () => Effect.void,
      verifyEvidence: () => Effect.undefined,
      onReported: () => Effect.void,
      ensureOperation: () => Effect.die("no tracker claim is configured"),
      getOperation: () => Effect.succeedNone,
    });
    const reportImplemented = (baseCommit: string) =>
      ops.report({
        threadId,
        report: {
          outcome: "implemented",
          summary: "Implemented.",
          subject: { repository: "example/connector", baseCommit, headCommit },
        },
      });
    return {
      ops,
      outcomes,
      reportImplemented,
      ancestryReads,
      reservation: () => reservation,
      quiesce: () => {
        custody = { state: "quiescent", reasons: ["descendants_ended"] };
      },
    };
  });

/** The production readback over a real repository, as the factory wires it. */
const layerReadback = (workspaceRoot: string) =>
  FactoryGitReadback.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) =>
          Effect.succeed(
            id === configuration.projectId
              ? Option.some({
                  id: configuration.projectId,
                  title: "Connector",
                  workspaceRoot,
                  repositoryIdentity: null,
                  faviconPath: null,
                  defaultModelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5.4",
                  },
                  defaultThreadEnvMode: null,
                  scripts: [],
                  createdAt: "2026-10-28T00:00:00.000Z",
                  updatedAt: "2026-10-28T00:00:00.000Z",
                  deletedAt: null,
                })
              : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      GitVcsDriver.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-factory-outcomes-" })),
        Layer.provideMerge(VcsProcess.layer),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const gitCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=Worker", "-c", "user.email=worker@example.invalid", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

/** A base and its child head, with the base's loose object damaged until `restore`. */
const damagedBaseRepository = Effect.acquireRelease(
  Effect.sync(() => {
    const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-outcomes-"));
    gitCli(cwd, "init", "-q", "-b", "main");
    gitCli(cwd, "commit", "-q", "--allow-empty", "-m", "base");
    const base = gitCli(cwd, "rev-parse", "HEAD");
    gitCli(cwd, "commit", "-q", "--allow-empty", "-m", "head");
    const head = gitCli(cwd, "rev-parse", "HEAD");
    const object = NodePath.join(cwd, ".git", "objects", base.slice(0, 2), base.slice(2));
    const original = NodeFS.readFileSync(object);
    NodeFS.chmodSync(object, 0o666);
    NodeFS.writeFileSync(object, "not zlib");
    return { cwd, base, head, restore: () => NodeFS.writeFileSync(object, original) };
  }),
  ({ cwd }) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
);

const btc131 = (): Repository => ({
  commits: new Set([head, realBase, unrelated]),
  ancestry: new Map([[head, new Set([realBase])]]),
  unreadable: false,
});

it.effect(
  "rejects an absent base without reading ancestry, then recovers once the execution is quiet",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture(btc131());
      const { outcomeId } = yield* fixture.reportImplemented(inventedBase);

      yield* fixture.ops.reconcile(factoryId);
      const rejected = yield* fixture.outcomes.get(outcomeId);
      assert.isTrue(Option.isSome(rejected));
      const outcome = Option.getOrThrow(rejected);
      assert.strictEqual(outcome.state, "rejected");
      assert.strictEqual(
        outcome.state === "rejected" ? outcome.rejection : undefined,
        `base ${inventedBase} does not exist`,
      );
      // The original report is kept exactly as received.
      assert.strictEqual(outcome.report.subject?.baseCommit, inventedBase);
      assert.strictEqual(outcome.report.subject?.headCommit, head);
      assert.deepStrictEqual(fixture.ancestryReads, []);

      // Unknown custody keeps the stage held: no missing result is recorded yet.
      yield* fixture.ops.reconcile(factoryId);
      assert.strictEqual(
        (yield* fixture.outcomes.listForOrigin(reservationId)).length,
        1,
        "nothing more is filed while custody is unknown",
      );
      assert.strictEqual(fixture.reservation().state, "held");

      fixture.quiesce();
      yield* fixture.ops.reconcile(factoryId);
      const missing = yield* fixture.outcomes.get(`no-result:${reservationId}`);
      assert.isTrue(Option.isSome(missing));
      const failed = Option.getOrThrow(missing);
      assert.strictEqual(failed.state, "verified");
      assert.strictEqual(failed.report.outcome, "failed");
      assert.include(
        failed.report.failure,
        `Its report was rejected: base ${inventedBase} does not exist`,
      );
      assert.strictEqual(fixture.reservation().state, "released");
      assert.strictEqual(
        fixture.reservation().state === "released"
          ? fixture.reservation().releasedReason
          : undefined,
        "outcome_verified",
      );

      // A repeated pass files nothing more and leaves the rejected report as it was.
      yield* fixture.ops.reconcile(factoryId);
      const filed = yield* fixture.outcomes.listForOrigin(reservationId);
      assert.deepStrictEqual(
        filed.map((each) => [each.outcomeId, each.state]),
        [
          [outcomeId, "rejected"],
          [`no-result:${reservationId}`, "verified"],
        ],
      );
      assert.deepStrictEqual(fixture.ancestryReads, []);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a report pending while the repository cannot be read", () =>
  Effect.gen(function* () {
    const repository = { ...btc131(), unreadable: true };
    const fixture = yield* makeFixture(repository);
    const { outcomeId } = yield* fixture.reportImplemented(realBase);

    yield* fixture.ops.reconcile(factoryId);
    yield* fixture.ops.reconcile(factoryId);
    assert.strictEqual(Option.getOrThrow(yield* fixture.outcomes.get(outcomeId)).state, "reported");
    assert.strictEqual(
      (yield* fixture.outcomes.listForOrigin(reservationId)).length,
      1,
      "a pending report is not a missing result",
    );

    repository.unreadable = false;
    fixture.quiesce();
    yield* fixture.ops.reconcile(factoryId);
    assert.strictEqual(Option.getOrThrow(yield* fixture.outcomes.get(outcomeId)).state, "verified");
  }).pipe(Effect.provide(layerTest)),
);

it.live("keeps a report pending while its base cannot be read, then verifies it", () =>
  Effect.gen(function* () {
    const repository = yield* damagedBaseRepository;
    yield* Effect.gen(function* () {
      const production = yield* FactoryGitReadback.FactoryGitReadback;
      const existenceReads: Array<readonly [string, boolean | string]> = [];
      const git: FactoryGitReadback.FactoryGitReadbackShape = {
        ...production,
        commitExists: (input) =>
          production.commitExists(input).pipe(
            Effect.tap((found) => Effect.sync(() => existenceReads.push([input.commit, found]))),
            Effect.tapError((error) =>
              Effect.sync(() => existenceReads.push([input.commit, error._tag])),
            ),
          ),
      };
      const fixture = yield* makeFixture({ git, head: repository.head });
      fixture.quiesce();
      const { outcomeId } = yield* fixture.reportImplemented(repository.base);

      yield* fixture.ops.reconcile(factoryId);
      assert.deepStrictEqual(existenceReads, [
        [repository.head, true],
        [repository.base, "FactoryGitReadbackError"],
      ]);
      const pending = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
      assert.strictEqual(
        pending.state === "rejected" ? pending.rejection : pending.state,
        "reported",
      );
      assert.deepStrictEqual(
        (yield* fixture.outcomes.listForOrigin(reservationId)).map((each) => each.outcomeId),
        [outcomeId],
        "a pending report files no missing result",
      );
      assert.strictEqual(fixture.reservation().state, "held");

      repository.restore();
      yield* fixture.ops.reconcile(factoryId);
      assert.strictEqual(
        Option.getOrThrow(yield* fixture.outcomes.get(outcomeId)).state,
        "verified",
      );
      assert.strictEqual(fixture.reservation().state, "released");
    }).pipe(Effect.provide(Layer.merge(layerTest, layerReadback(repository.cwd))));
  }).pipe(Effect.scoped),
);

it.effect("rejects a present base that is not an ancestor of the head", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture(btc131());
    const { outcomeId } = yield* fixture.reportImplemented(unrelated);

    yield* fixture.ops.reconcile(factoryId);
    const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
    assert.strictEqual(
      outcome.state === "rejected" ? outcome.rejection : outcome.state,
      `base ${unrelated} is not an ancestor of head ${head}`,
    );
    assert.deepStrictEqual(fixture.ancestryReads, [{ ancestor: unrelated, descendant: head }]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("verifies a present ancestor base and settles the quiet stage", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture(btc131());
    fixture.quiesce();
    const { outcomeId } = yield* fixture.reportImplemented(realBase);

    yield* fixture.ops.reconcile(factoryId);
    assert.strictEqual(Option.getOrThrow(yield* fixture.outcomes.get(outcomeId)).state, "verified");
    assert.strictEqual(fixture.reservation().state, "released");
    assert.deepStrictEqual(fixture.ancestryReads, [{ ancestor: realBase, descendant: head }]);
  }).pipe(Effect.provide(layerTest)),
);

const triage: FactoryStore.FactoryReservation = {
  ...admitted,
  decisionKey: FactoryDecisionKey.make("decision:triage"),
  taskKind: "triage",
  stageBasis: "triage:version:1",
};

const integratingLocally = (remote: string | null): FactoryStore.FactoryConfiguration => ({
  ...configuration,
  integration: {
    branch: "main",
    remote,
    mode: "merge",
    identity: { name: "T3", email: "t3@example.invalid" },
  },
});

it.effect("verifies a proposal's candidate base only as T3 reads it on the integration line", () =>
  Effect.gen(function* () {
    // `main` holds realBase; `unrelated` exists but is on no line T3 integrates.
    const repository = (): Repository => ({
      ...btc131(),
      branches: new Map([["main", head]]),
    });
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly basis?: string;
      readonly baseCommit?: string;
      readonly configuration?: FactoryStore.FactoryConfiguration;
      readonly expected: string;
      readonly ancestryReads: ReadonlyArray<{
        readonly ancestor: string;
        readonly descendant: string;
      }>;
    }> = [
      { name: "no candidate named", expected: "verified", ancestryReads: [] },
      {
        name: "another item version",
        basis: "version:0",
        baseCommit: realBase,
        expected: "the proposal names item version version:0, not version:1",
        ancestryReads: [],
      },
      {
        name: "an invented base",
        baseCommit: inventedBase,
        configuration: integratingLocally(null),
        expected: `base ${inventedBase} does not exist`,
        ancestryReads: [],
      },
      {
        name: "a base on the local integration branch",
        baseCommit: realBase,
        configuration: integratingLocally(null),
        expected: "verified",
        ancestryReads: [{ ancestor: realBase, descendant: "refs/heads/main" }],
      },
      {
        name: "a base off the local integration branch",
        baseCommit: unrelated,
        configuration: integratingLocally(null),
        expected: `base ${unrelated} is not on the integration branch main`,
        ancestryReads: [{ ancestor: unrelated, descendant: "refs/heads/main" }],
      },
      {
        name: "a remote integration branch, whose local copy may be stale",
        baseCommit: unrelated,
        configuration: integratingLocally("origin"),
        expected: "verified",
        ancestryReads: [],
      },
    ];
    // Each row reads in its own store: equal reports are one outcome, whatever row filed it.
    for (const row of cases) {
      yield* Effect.gen(function* () {
        const fixture = yield* makeFixture(repository(), {
          reservation: triage,
          ...(row.configuration === undefined ? {} : { configuration: row.configuration }),
        });
        const { outcomeId } = yield* fixture.ops.report({
          threadId,
          report: {
            outcome: "unit_proposed",
            summary: "One bounded unit.",
            proposal: {
              basis: row.basis ?? "version:1",
              unit: "## Owned files\n- apps/server/src/a.ts",
              ownedFiles: ["apps/server/src/a.ts"],
            },
            ...(row.baseCommit === undefined
              ? {}
              : { subject: { repository: "example/connector", baseCommit: row.baseCommit } }),
          },
        });
        yield* fixture.ops.reconcile(factoryId);
        const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
        assert.strictEqual(
          outcome.state === "rejected" ? outcome.rejection : outcome.state,
          row.expected,
          row.name,
        );
        assert.deepStrictEqual(fixture.ancestryReads, row.ancestryReads, row.name);
      }).pipe(Effect.provide(layerTest));
    }
  }),
);
