// @effect-diagnostics nodeBuiltinImport:off - disposable repositories built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  type FactoryCriteriaProposal,
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
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import type * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { type NoEditRequirement, noEditBasis, parentAcceptance } from "./factoryCoordination.ts";
import type { FactoryCustody } from "./factoryCustody.ts";
import type * as FactoryExecutionGenerations from "./FactoryExecutionGenerations.ts";
import * as FactoryGitReadback from "./FactoryGitReadback.ts";
import { encodeItemEvent } from "./factoryItemEvents.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import { type FactoryOutcomeDependencies, makeFactoryOutcomes } from "./factoryOutcomes.ts";
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
  /** Ref name below `refs/` (`heads/main`, `remotes/origin/main`) to the commit it points at. */
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
  const resolve = (rev: string) =>
    rev.startsWith("refs/") ? repository.branches?.get(rev.slice("refs/".length)) : rev;
  return {
    objectsAt: () => Effect.fail(unreadable("objectsAt")),
    commitExists: ({ commit }) => {
      if (repository.unreadable) return Effect.fail(unreadable("commitExists"));
      const resolved = resolve(commit);
      return Effect.succeed(resolved !== undefined && repository.commits.has(resolved));
    },
    // Like `git merge-base --is-ancestor`: an unknown object is exit 128, an error, not "no".
    isAncestor: ({ ancestor, descendant }) => {
      ancestryReads.push({ ancestor, descendant });
      const commit = resolve(descendant);
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
        : Effect.succeed(repository.branches?.has(`heads/${branch}`) ?? false),
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
    readonly verifyEvidence?: FactoryOutcomeDependencies["verifyEvidence"];
    readonly readArtifact?: FactoryOutcomeDependencies["readArtifact"];
    readonly adoptedCriteria?: FactoryOutcomeDependencies["adoptedCriteria"];
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
      verifyEvidence: options.verifyEvidence ?? (() => Effect.undefined),
      readArtifact: options.readArtifact ?? (() => Effect.undefined),
      adoptedCriteria: options.adoptedCriteria ?? (() => Effect.undefined),
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

// A review whose LINT.log digest lost three characters in transcription was verified anyway,
// and no later brief could carry the artifact.
it.effect("refuses an artifact digest that is not a sha256, so the worker resends it", () =>
  Effect.gen(function* () {
    const review: FactoryStore.FactoryReservation = {
      ...admitted,
      decisionKey: FactoryDecisionKey.make("decision:review"),
      taskKind: "review",
      stageBasis: `review:${head}`,
    };
    const fixture = yield* makeFixture(btc131(), { reservation: review });
    fixture.quiesce();
    const reportWith = (lintSha256: string) =>
      fixture.ops.report({
        threadId,
        report: {
          outcome: "review_failed",
          summary: "Two blocking findings.",
          failure: "Adversarial fixture runs fail.",
          subject: { repository: "example/connector", headCommit: head },
          artifacts: [
            {
              path: "C:/artifacts/issue-113/review/REVIEW.md",
              sha256: "e820a4d0cf1337a613aa525da8b981d6bf032a69940b5371ddaa53a71a851b3a",
            },
            { path: "C:/artifacts/issue-113/review/LINT.log", sha256: lintSha256 },
          ],
        },
      });

    const refused = yield* Effect.flip(
      reportWith("e0296418a07e11c1855fceb8edb60fd8ffd51fd290350e4f7decfb018fa8a"),
    );
    assert.strictEqual(refused.code, "subject_missing");
    assert.include(refused.message, "C:/artifacts/issue-113/review/LINT.log");
    assert.deepStrictEqual(yield* fixture.outcomes.listForOrigin(reservationId), []);
    assert.strictEqual(fixture.reservation().state, "held");

    const { outcomeId } = yield* reportWith(
      "E0296418A07E11C1855FCEB8EDB60FD8FFD51FD290350E4F7D47FECFB018FA8A",
    );
    yield* fixture.ops.reconcile(factoryId);
    assert.strictEqual(Option.getOrThrow(yield* fixture.outcomes.get(outcomeId)).state, "verified");
    assert.strictEqual(fixture.reservation().state, "released");
  }).pipe(Effect.provide(layerTest)),
);

const triage: FactoryStore.FactoryReservation = {
  ...admitted,
  decisionKey: FactoryDecisionKey.make("decision:triage"),
  taskKind: "triage",
  stageBasis: "triage:version:1",
};

const integrating = (
  integration: NonNullable<FactoryStore.FactoryConfiguration["integration"]> | undefined,
): FactoryStore.FactoryConfiguration => ({
  ...configuration,
  ...(integration === undefined ? {} : { integration }),
});
const merging = (remote: string | null) =>
  integrating({
    branch: "main",
    remote,
    mode: "merge",
    identity: { name: "T3", email: "t3@example.invalid" },
  });
const pullRequests = integrating({
  mode: "pull_request",
  repository: "example/connector",
  remote: "origin",
  branch: "main",
  method: "merge",
});

it.effect("verifies a proposal's candidate base only as T3 reads it on the integration line", () =>
  Effect.gen(function* () {
    // Both lines hold realBase; `unrelated` exists but is on no line T3 integrates.
    const repository = (
      refs: ReadonlyArray<string> = ["heads/main", "remotes/origin/main"],
    ): Repository => ({
      ...btc131(),
      branches: new Map(refs.map((ref) => [ref, head])),
    });
    const local = { ancestor: realBase, descendant: "refs/heads/main" };
    const remote = { ancestor: realBase, descendant: "refs/remotes/origin/main" };
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly basis?: string;
      readonly baseCommit?: string;
      readonly configuration?: FactoryStore.FactoryConfiguration;
      readonly refs?: ReadonlyArray<string>;
      readonly expected: string;
      readonly ancestryReads: ReadonlyArray<{
        readonly ancestor: string;
        readonly descendant: string;
      }>;
    }> = [
      {
        name: "no candidate named",
        configuration: merging(null),
        expected: "the proposal names no candidate base",
        ancestryReads: [],
      },
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
        configuration: merging(null),
        expected: `base ${inventedBase} does not exist`,
        ancestryReads: [],
      },
      {
        name: "no integration line to read it against",
        baseCommit: realBase,
        expected: `no integration branch is configured to read base ${realBase} against`,
        ancestryReads: [],
      },
      {
        name: "a base on the local integration branch",
        baseCommit: realBase,
        configuration: merging(null),
        expected: "verified",
        ancestryReads: [local],
      },
      {
        name: "a base off the local integration branch",
        baseCommit: unrelated,
        configuration: merging(null),
        expected: `base ${unrelated} is not on the integration line refs/heads/main`,
        ancestryReads: [{ ...local, ancestor: unrelated }],
      },
      {
        name: "a local integration branch that is missing",
        baseCommit: realBase,
        configuration: merging(null),
        refs: [],
        expected: "the integration line refs/heads/main cannot be read",
        ancestryReads: [],
      },
      {
        name: "a base on the fetched remote branch",
        baseCommit: realBase,
        configuration: merging("origin"),
        expected: "verified",
        ancestryReads: [remote],
      },
      {
        name: "a base off the fetched remote branch",
        baseCommit: unrelated,
        configuration: merging("origin"),
        expected: `base ${unrelated} is not on the integration line refs/remotes/origin/main`,
        ancestryReads: [{ ...remote, ancestor: unrelated }],
      },
      {
        name: "a pull request target never fetched",
        baseCommit: realBase,
        configuration: pullRequests,
        refs: ["heads/main"],
        expected: "the integration line refs/remotes/origin/main cannot be read",
        ancestryReads: [],
      },
      {
        name: "a base on the pull request target",
        baseCommit: realBase,
        configuration: pullRequests,
        expected: "verified",
        ancestryReads: [remote],
      },
    ];
    // Each row reads in its own store: equal reports are one outcome, whatever row filed it.
    for (const row of cases) {
      yield* Effect.gen(function* () {
        const fixture = yield* makeFixture(repository(row.refs), {
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

const parentBody =
  "Parent.\n\n## Acceptance\n- **P1:** the import keeps order.\n- **P2:** the rule in [this](https://github.com/example/connector/issues/131#issuecomment-9) holds.\n";
const parentItems = parentAcceptance(parentBody).items;
const criteriaReport = (change: (proposal: FactoryCriteriaProposal) => FactoryCriteriaProposal) =>
  ({
    outcome: "criteria_proposed",
    summary: "Two clauses.",
    criteria: change({
      schema: "factory-parent-criteria-proposal/1",
      issue: 131,
      basis: {
        bodySha256: NodeCrypto.createHash("sha256").update(parentBody).digest("hex"),
        itemVersion: "version:1",
      },
      clauses: parentItems.map((item, at) => ({
        id: `P${at + 1}`,
        source: { start: item.start, end: item.end, sha256: item.sha256, excerpt: item.excerpt },
        ...(at === 1
          ? { comments: [{ id: "9", start: 0, end: 4, sha256: "a".repeat(64), excerpt: "Rule" }] }
          : {}),
      })),
    }),
  }) as const;

it.effect("verifies a parent's criteria only as exact quotes of the text its triage read", () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly change?: (proposal: FactoryCriteriaProposal) => FactoryCriteriaProposal;
      readonly admittedBody?: string | null;
      readonly expected: string;
    }> = [
      { name: "the exact acceptance", expected: "verified" },
      {
        name: "another item version",
        change: (proposal) => ({
          ...proposal,
          basis: { ...proposal.basis, itemVersion: "version:0" },
        }),
        expected: "the criteria name item version version:0, not version:1",
      },
      {
        name: "another issue",
        change: (proposal) => ({ ...proposal, issue: 132 }),
        expected: "the proposal is for #132, not #131",
      },
      {
        name: "text the triage did not read",
        admittedBody: `${parentBody}\n`,
        expected: "the proposal names body",
      },
      {
        name: "a dropped clause",
        change: (proposal) => ({ ...proposal, clauses: proposal.clauses.slice(0, 1) }),
        expected: "the proposal names 1 clauses; the acceptance has 2 items",
      },
      {
        name: "a shifted quote",
        change: (proposal) => ({
          ...proposal,
          clauses: proposal.clauses.map((clause, at) =>
            at === 0
              ? {
                  ...clause,
                  source: {
                    ...clause.source,
                    start: clause.source.start + 1,
                    end: clause.source.end + 1,
                  },
                }
              : clause,
          ),
        }),
        expected: "clause P1 does not quote the item at",
      },
      {
        name: "a cited comment left unquoted",
        change: (proposal) => ({
          ...proposal,
          clauses: proposal.clauses.map(({ comments: _comments, ...clause }) => clause),
        }),
        expected: "clause P2 quotes other comments than its text cites (9)",
      },
      {
        name: "no kept text of the admitted triage",
        admittedBody: null,
        expected: "T3 kept no text of the issue this triage read",
      },
    ];
    for (const row of cases) {
      yield* Effect.gen(function* () {
        const fixture = yield* makeFixture(btc131(), { reservation: triage });
        if (row.admittedBody !== null) {
          const sql = yield* SqlClient.SqlClient;
          const record = yield* encodeItemEvent({
            type: "admitted",
            stage: "triage",
            reservationId,
            stageBasis: triage.stageBasis!,
            issueText: { title: "Parent", body: row.admittedBody ?? parentBody },
          });
          yield* sql`INSERT INTO factory_item_events (factory_id, item_key, record_json)
            VALUES (${factoryId}, ${triage.itemKey}, ${record})`;
        }
        const { outcomeId } = yield* fixture.ops.report({
          threadId,
          report: criteriaReport(row.change ?? ((proposal) => proposal)),
        });
        yield* fixture.ops.reconcile(factoryId);
        const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
        assert.include(
          outcome.state === "rejected" ? outcome.rejection : outcome.state,
          row.expected,
          row.name,
        );
      }).pipe(Effect.provide(layerTest));
    }
    // A clause may name its bounded unit; the verified proposal keeps it for preparation.
    yield* Effect.gen(function* () {
      const fixture = yield* makeFixture(btc131(), { reservation: triage });
      const sql = yield* SqlClient.SqlClient;
      const record = yield* encodeItemEvent({
        type: "admitted",
        stage: "triage",
        reservationId,
        stageBasis: triage.stageBasis!,
        issueText: { title: "Parent", body: parentBody },
      });
      yield* sql`INSERT INTO factory_item_events (factory_id, item_key, record_json)
        VALUES (${factoryId}, ${triage.itemKey}, ${record})`;
      const unit = { title: "Import keeps order", contract: "Rows keep order.", paths: ["a.ts"] };
      const { outcomeId } = yield* fixture.ops.report({
        threadId,
        report: criteriaReport((proposal) => ({
          ...proposal,
          clauses: proposal.clauses.map((clause, at) => (at === 0 ? { ...clause, unit } : clause)),
        })),
      });
      yield* fixture.ops.reconcile(factoryId);
      const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
      assert.deepStrictEqual(
        [outcome.state, outcome.report.criteria?.clauses.map((clause) => clause.unit)],
        ["verified", [unit, undefined]],
      );
    }).pipe(Effect.provide(layerTest));
    // Root's adoption may anchor acceptance on the parent's own heading; unread, it defers.
    const routedBody = "Stage.\n\n## Done when\n- [ ] the target is identified.\n";
    // Its span read off the body directly (ASCII), not through the reading under test.
    const routedText = "the target is identified.";
    const routedItem = {
      start: routedBody.indexOf(routedText),
      end: routedBody.indexOf(routedText) + routedText.length,
      sha256: NodeCrypto.createHash("sha256").update(routedText).digest("hex"),
      excerpt: routedText,
    };
    const route = {
      schema: "factory-parent-criteria/1",
      issue: 131,
      version: "route-1",
      bodySha256: "0".repeat(64),
      clauses: [
        {
          id: "C01",
          required: true,
          source: {
            kind: "github_issue",
            ref: "https://github.com/example/connector/issues/131#done-when",
            text: "- [ ] the target is identified.",
          },
          state: "open",
          evidence: [],
        },
      ],
    };
    const adoptions: ReadonlyArray<
      readonly [Effect.Success<ReturnType<FactoryOutcomeDependencies["adoptedCriteria"]>>, string]
    > = [
      [undefined, "the body of #131 states no acceptance list"],
      [{ unread: "the criteria root is unreadable" }, "reported"],
      [{ document: route }, "verified"],
    ];
    for (const [adoption, expected] of adoptions) {
      yield* Effect.gen(function* () {
        const fixture = yield* makeFixture(btc131(), {
          reservation: triage,
          adoptedCriteria: () => Effect.succeed(adoption),
        });
        const sql = yield* SqlClient.SqlClient;
        const record = yield* encodeItemEvent({
          type: "admitted",
          stage: "triage",
          reservationId,
          stageBasis: triage.stageBasis!,
          issueText: { title: "Parent", body: routedBody },
        });
        yield* sql`INSERT INTO factory_item_events (factory_id, item_key, record_json)
          VALUES (${factoryId}, ${triage.itemKey}, ${record})`;
        const { outcomeId } = yield* fixture.ops.report({
          threadId,
          report: {
            outcome: "criteria_proposed",
            summary: "One clause under the route's heading.",
            criteria: {
              schema: "factory-parent-criteria-proposal/1",
              issue: 131,
              basis: {
                bodySha256: NodeCrypto.createHash("sha256").update(routedBody).digest("hex"),
                itemVersion: "version:1",
              },
              clauses: [{ id: "C01", source: routedItem }],
            },
          },
        });
        yield* fixture.ops.reconcile(factoryId);
        const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
        assert.strictEqual(
          outcome.state === "rejected" ? outcome.rejection : outcome.state,
          expected,
          JSON.stringify(adoption),
        );
      }).pipe(Effect.provide(layerTest));
    }
    // The payload is required with its outcome, and refused with any other.
    yield* Effect.gen(function* () {
      const fixture = yield* makeFixture(btc131(), { reservation: triage });
      const { criteria } = criteriaReport((proposal) => proposal);
      const missing = yield* Effect.flip(
        fixture.ops.report({
          threadId,
          report: { outcome: "criteria_proposed", summary: "None." },
        }),
      );
      const stray = yield* Effect.flip(
        fixture.ops.report({
          threadId,
          report: { outcome: "not_actionable", summary: "Held.", failure: "hold: owner", criteria },
        }),
      );
      assert.deepStrictEqual(
        [missing.code, stray.code],
        ["subject_missing", "outcome_not_expected"],
      );
    }).pipe(Effect.provide(layerTest));
  }),
);

it.effect("verifies a no-edit unit only by its exact receipt and the logs T3 read itself", () =>
  Effect.gen(function* () {
    const requirement: NoEditRequirement = {
      schema: "factory-noedit/1",
      candidate: head,
      base: head,
      ownedFiles: [],
      checks: ["vp test run src/a.test.ts", "vp run typecheck"],
      instructionRevision: "e04d4b92",
      clauseBinding: "#5/C05",
    };
    const reservation = { ...admitted, stageBasis: `implement:none${noEditBasis(requirement)}` };
    const logSha = "a".repeat(64);
    const logOf = (check: string) => ({ path: `/artifacts/${check.length}.log`, sha256: logSha });
    const receiptPath = "/artifacts/receipt.json";
    const receipt = (change: Record<string, unknown> = {}) =>
      JSON.stringify({
        schema: "factory-noedit-receipt/1",
        requirement,
        itemKey: admitted.itemKey,
        itemVersion: admitted.itemVersion,
        results: requirement.checks.map((check) => ({ check, exitCode: 0, log: logOf(check) })),
        ...change,
      });
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly receipt?: string | undefined;
      readonly verified?: boolean;
      readonly baseCommit?: string;
      readonly logs?: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
      /** The sha256 of a log's bytes as T3 reads them, or null when it cannot read them. */
      readonly logBytesSha?: string | null;
      /** The sha256 of the receipt's bytes as T3 reads them, when they changed. */
      readonly receiptBytesSha?: string;
      readonly expected: string;
    }> = [
      { name: "the exact receipt", receipt: receipt(), expected: "verified" },
      {
        name: "a log T3 cannot read",
        receipt: receipt(),
        logBytesSha: null,
        expected: "noedit_artifacts_unverified: ",
      },
      {
        // The receipt's bytes changed after the report declared them: what T3 read is not that.
        name: "a receipt whose bytes are not the declared ones",
        receipt: receipt(),
        receiptBytesSha: "c".repeat(64),
        expected: "noedit_artifacts_unverified: ",
      },
      { name: "no receipt", receipt: undefined, expected: "noedit_receipt_missing: " },
      {
        name: "a receipt for another requirement",
        receipt: receipt({ requirement: { ...requirement, checks: ["vp run typecheck"] } }),
        expected: "noedit_requirement_mismatch: ",
      },
      {
        name: "results for another check list",
        receipt: receipt({
          results: [{ check: "vp run lint", exitCode: 0, log: logOf("vp run lint") }],
        }),
        expected: "noedit_checks_mismatch: ",
      },
      {
        name: "a failed check",
        receipt: receipt({
          results: requirement.checks.map((check, at) => ({
            check,
            exitCode: at,
            log: logOf(check),
          })),
        }),
        expected: "noedit_check_failed: check vp run typecheck failed with exit code 1",
      },
      {
        name: "a log not among the artifacts",
        receipt: receipt(),
        logs: [logOf(requirement.checks[0]!)],
        expected: "noedit_log_unverified: ",
      },
      {
        name: "a log whose bytes are not the declared ones",
        receipt: receipt(),
        logBytesSha: "f".repeat(64),
        expected: "noedit_artifacts_unverified: ",
      },
      {
        name: "a changed head",
        receipt: receipt(),
        baseCommit: realBase,
        expected: `noedit_head_mismatch: a no-edit unit reports base and head ${head}, unchanged`,
      },
      {
        name: "another item version",
        receipt: receipt({ itemVersion: "version:0" }),
        expected: "noedit_item_mismatch: ",
      },
    ];
    for (const row of cases) {
      yield* Effect.gen(function* () {
        const fixture = yield* makeFixture(btc131(), {
          reservation,
          // A separate check that saw the declared bytes proves nothing about what T3 reads.
          verifyEvidence: () => Effect.succeed("digest"),
          readArtifact: (_root, path) =>
            Effect.succeed(
              path === receiptPath
                ? row.receipt === undefined
                  ? undefined
                  : { text: row.receipt, sha256: row.receiptBytesSha ?? "b".repeat(64) }
                : row.logBytesSha === null
                  ? undefined
                  : { text: "log", sha256: row.logBytesSha ?? logSha },
            ),
        });
        const { outcomeId } = yield* fixture.ops.report({
          threadId,
          report: {
            outcome: "implemented",
            summary: "Verified as it is.",
            subject: {
              repository: "example/connector",
              baseCommit: row.baseCommit ?? head,
              headCommit: head,
            },
            artifacts: [
              ...(row.receipt === undefined ? [] : [{ path: receiptPath, sha256: "b".repeat(64) }]),
              ...(row.logs ?? requirement.checks.map(logOf)),
            ],
          },
        });
        yield* fixture.ops.reconcile(factoryId);
        const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
        assert.include(
          outcome.state === "rejected" ? outcome.rejection : outcome.state,
          row.expected,
          row.name,
        );
        // An accepted unit carries what T3 itself read: each check's result and log sha256.
        if (outcome.state === "verified") {
          assert.deepStrictEqual(outcome.receipt.noEdit, {
            requirementDigest: noEditBasis(requirement).slice("|ne:".length),
            requirement,
            candidate: head,
            results: requirement.checks.map((check) => ({
              check,
              exitCode: 0,
              logPath: logOf(check).path,
              logSha256: logSha,
            })),
          });
        }
      }).pipe(Effect.provide(layerTest));
    }
  }),
);

it.effect("reads a stage's own basis beneath the resources it holds", () =>
  Effect.gen(function* () {
    // A correction holding a resource still answers its failure, by that failure's digest.
    yield* Effect.gen(function* () {
      const fixture = yield* makeFixture(btc131(), {
        reservation: { ...admitted, taskKind: "correct", stageBasis: "correct:digest-1|res:ocr" },
      });
      const { outcomeId } = yield* fixture.ops.report({
        threadId,
        report: { outcome: "correction_spec", summary: "Retry with the lock released." },
      });
      const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
      assert.strictEqual(outcome.corrects, "digest-1");
    }).pipe(Effect.provide(layerTest));
    // A review holding a resource still names the exact head it was admitted for.
    yield* Effect.gen(function* () {
      const fixture = yield* makeFixture(btc131(), {
        reservation: { ...admitted, taskKind: "review", stageBasis: `review:${head}|res:ocr` },
      });
      const { outcomeId } = yield* fixture.ops.report({
        threadId,
        report: {
          outcome: "review_passed",
          summary: "Passes.",
          subject: { repository: "example/connector", headCommit: head },
        },
      });
      yield* fixture.ops.reconcile(factoryId);
      assert.strictEqual(
        Option.getOrThrow(yield* fixture.outcomes.get(outcomeId)).state,
        "verified",
      );
    }).pipe(Effect.provide(layerTest));
  }),
);

it.effect("binds each admitted no-edit check to exactly one result, whatever its text", () =>
  Effect.gen(function* () {
    const base = {
      schema: "factory-noedit/1" as const,
      candidate: head,
      base: head,
      ownedFiles: [],
      instructionRevision: "e04d4b92",
      clauseBinding: "#5/C05",
    };
    const logOf = (at: number) => ({ path: `/artifacts/${at}.log`, sha256: "a".repeat(64) });
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly checks: ReadonlyArray<string>;
      readonly results: ReadonlyArray<{ readonly check: string; readonly exitCode: number }>;
      readonly expected: string;
    }> = [
      {
        name: "a requirement naming one check twice",
        checks: ["test", "test"],
        results: [
          { check: "test", exitCode: 0 },
          { check: "test", exitCode: 1 },
        ],
        expected: "noedit_receipt_missing: ",
      },
      {
        name: "one result whose text joins two checks",
        checks: ["a", "b"],
        results: [{ check: "a\nb", exitCode: 0 }],
        expected: "noedit_checks_mismatch: ",
      },
      {
        name: "a check reported twice and another not at all",
        checks: ["a", "b"],
        results: [
          { check: "a", exitCode: 0 },
          { check: "a", exitCode: 1 },
        ],
        expected: "noedit_checks_mismatch: ",
      },
      {
        name: "multiline checks, each once",
        checks: ["vp test run\n--reporter dot", "vp run typecheck"],
        results: [
          { check: "vp run typecheck", exitCode: 0 },
          { check: "vp test run\n--reporter dot", exitCode: 0 },
        ],
        expected: "verified",
      },
    ];
    for (const row of cases) {
      yield* Effect.gen(function* () {
        const requirement = { ...base, checks: row.checks };
        const receiptPath = "/artifacts/receipt.json";
        const receipt = JSON.stringify({
          schema: "factory-noedit-receipt/1",
          requirement,
          itemKey: admitted.itemKey,
          itemVersion: admitted.itemVersion,
          results: row.results.map((result, at) => ({ ...result, log: logOf(at) })),
        });
        const fixture = yield* makeFixture(btc131(), {
          reservation: {
            ...admitted,
            stageBasis: `implement:none${noEditBasis(requirement as NoEditRequirement)}`,
          },
          readArtifact: (_root, path) =>
            Effect.succeed(
              path === receiptPath
                ? { text: receipt, sha256: "b".repeat(64) }
                : { text: "log", sha256: "a".repeat(64) },
            ),
        });
        const { outcomeId } = yield* fixture.ops.report({
          threadId,
          report: {
            outcome: "implemented",
            summary: "Verified as it is.",
            subject: { repository: "example/connector", baseCommit: head, headCommit: head },
            artifacts: [
              { path: receiptPath, sha256: "b".repeat(64) },
              ...row.results.map((_result, at) => logOf(at)),
            ],
          },
        });
        yield* fixture.ops.reconcile(factoryId);
        const outcome = Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
        assert.include(
          outcome.state === "rejected" ? outcome.rejection : outcome.state,
          row.expected,
          row.name,
        );
      }).pipe(Effect.provide(layerTest));
    }
  }),
);

it.effect(
  "records the policy's whole no-edit binding in T3's own receipt, and refuses another one",
  () =>
    Effect.gen(function* () {
      const requirement: NoEditRequirement = {
        schema: "factory-noedit/1",
        candidate: head,
        base: head,
        ownedFiles: [],
        checks: ["vp run typecheck"],
        execution: "verifier",
        instructionRevision: "e04d4b92",
        clauseBinding: "#5/C05",
        itemKey: admitted.itemKey,
        itemVersion: admitted.itemVersion,
        unit: "d".repeat(64),
        criteria: "e".repeat(64),
      };
      const receiptPath = "/artifacts/receipt.json";
      const log = { path: "/artifacts/typecheck.log", sha256: "a".repeat(64) };
      const run = (copied: NoEditRequirement) =>
        Effect.gen(function* () {
          const receipt = JSON.stringify({
            schema: "factory-noedit-receipt/1",
            requirement: copied,
            itemKey: admitted.itemKey,
            itemVersion: admitted.itemVersion,
            results: [{ check: "vp run typecheck", exitCode: 0, log }],
          });
          const fixture = yield* makeFixture(btc131(), {
            reservation: { ...admitted, stageBasis: `implement:none${noEditBasis(requirement)}` },
            readArtifact: (_root, path) =>
              Effect.succeed(
                path === receiptPath
                  ? { text: receipt, sha256: "b".repeat(64) }
                  : { text: "log", sha256: log.sha256 },
              ),
          });
          const { outcomeId } = yield* fixture.ops.report({
            threadId,
            report: {
              outcome: "implemented",
              summary: "Verified as it is.",
              subject: { repository: "example/connector", baseCommit: head, headCommit: head },
              artifacts: [{ path: receiptPath, sha256: "b".repeat(64) }, log],
            },
          });
          yield* fixture.ops.reconcile(factoryId);
          return Option.getOrThrow(yield* fixture.outcomes.get(outcomeId));
        }).pipe(Effect.provide(layerTest));
      const accepted = yield* run(requirement);
      assert.strictEqual(accepted.state, "verified");
      if (accepted.state !== "verified") return;
      assert.deepStrictEqual(accepted.receipt.noEdit?.requirement, requirement);
      // A receipt copying the requirement for another unit is not the one admitted.
      const other = yield* run({ ...requirement, unit: "f".repeat(64) });
      assert.include(
        other.state === "rejected" ? other.rejection : other.state,
        "noedit_requirement_mismatch: ",
      );
    }),
);

/** A repository whose head carries a text file, a nested text file, a link, a binary file and a renamed path. */
const objectsRepository = Effect.acquireRelease(
  Effect.sync(() => {
    const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-objects-"));
    gitCli(cwd, "init", "-q", "-b", "main");
    NodeFS.mkdirSync(NodePath.join(cwd, "btclink", "route"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(cwd, "btclink", "route", "run.py"), "print('run')\n");
    NodeFS.writeFileSync(NodePath.join(cwd, "with space.txt"), "spaced\n");
    NodeFS.writeFileSync(NodePath.join(cwd, "binary.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    gitCli(cwd, "add", "-A");
    // A symbolic-link object without creating a link on the host.
    const blob = NodeChildProcess.execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd,
      input: "../target",
      encoding: "utf8",
    }).trim();
    gitCli(cwd, "update-index", "--add", "--cacheinfo", `120000,${blob},link.py`);
    gitCli(cwd, "commit", "-q", "-m", "objects");
    return {
      cwd,
      head: gitCli(cwd, "rev-parse", "HEAD"),
      tree: gitCli(cwd, "rev-parse", "HEAD^{tree}"),
    };
  }),
  ({ cwd }) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
);

it.live(
  "E1: reads each pinned path at a commit as a hashed text blob, or names why it is not one",
  () =>
    Effect.gen(function* () {
      const repository = yield* objectsRepository;
      yield* Effect.gen(function* () {
        const git = yield* FactoryGitReadback.FactoryGitReadback;
        const read = yield* git.objectsAt({
          projectId: configuration.projectId,
          commit: repository.head,
          paths: ["btclink/route/run.py", "with space.txt", "binary.bin", "link.py", "absent.py"],
        });
        const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
        assert.strictEqual(read.tree, repository.tree);
        assert.deepStrictEqual(read.objects, [
          { path: "btclink/route/run.py", kind: "blob", sha256: sha256("print('run')\n") },
          { path: "with space.txt", kind: "blob", sha256: sha256("spaced\n") },
          { path: "binary.bin", kind: "other" },
          { path: "link.py", kind: "link" },
          { path: "absent.py", kind: "missing" },
        ]);
        const unknown = yield* git
          .objectsAt({ projectId: configuration.projectId, commit: "0".repeat(40), paths: ["x"] })
          .pipe(Effect.result);
        assert.strictEqual(
          unknown._tag,
          "Failure",
          "an unknown commit is an error, never 'missing'",
        );
      }).pipe(Effect.provide(layerReadback(repository.cwd)));
    }).pipe(Effect.scoped),
);
