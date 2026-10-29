import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import { makeNativeStages } from "./factoryNativeStages.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryTracker from "./FactoryTracker.ts";

const factoryId = FactoryId.make("connector");
const repository = "example-org/connectors";
const itemKey = FactoryItemKey.make(`github:${repository}#81`);
const projectId = ProjectId.make("project:connectors");
const base = "ba5e0081";
const head = "8ac88cdd";
// Exactly as a release before acknowledgements recorded GitHub's 422 for an empty pull request.
const refusal =
  'refused: the pull request was not created ({"tag":"GitHubApiResponseError","status":422})';
const open: FactoryStore.CustodyFence = { factoryId, custodyRead: [], transfersRead: [] };

/**
 * The remote as Git and GitHub show it, with every write T3 sends recorded. Like GitHub, it
 * refuses a pull request whose head its base already contains.
 */
class Remote extends Context.Service<
  Remote,
  {
    readonly parents: Map<string, ReadonlyArray<string>>;
    readonly trees: Map<string, string>;
    readonly branches: Map<string, string>;
    readonly pulls: Array<FactoryTracker.TrackerPullRequest & { readonly head: string }>;
    readonly writes: Array<string>;
    unreadable: boolean;
  }
>()("t3/factory/FactoryNoopIntegration.test/Remote") {}

const layerRemote = Layer.sync(Remote, () => ({
  parents: new Map<string, ReadonlyArray<string>>([
    [base, []],
    [head, [base]],
  ]),
  trees: new Map([
    [base, "tree-base"],
    [head, "tree-head"],
  ]),
  // The no-change unit: its reviewed head is already the target's tip.
  branches: new Map([["main", head]]),
  pulls: [],
  writes: [],
  unreadable: false,
}));

const contains = (remote: Remote["Service"], tip: string, commit: string) => {
  for (const queue = [tip]; queue.length > 0;) {
    const next = queue.pop()!;
    if (next === commit) return true;
    queue.push(...(remote.parents.get(next) ?? []));
  }
  return false;
};

/** As the Git integrator reads it: the target's fresh tip, then ancestry, never content. */
const layerIntegrator = Layer.effect(
  FactoryIntegrator.FactoryIntegrator,
  Effect.map(Remote, (remote) => {
    const unreadable = (operation: string) =>
      new FactoryIntegrator.FactoryIntegratorError({ operation, cause: "connection reset" });
    return FactoryIntegrator.FactoryIntegrator.of({
      tip: ({ target }) =>
        remote.unreadable
          ? Effect.fail(unreadable("tip"))
          : Effect.succeed(remote.branches.get(target.branch) ?? null),
      landed: ({ target, reviewedHead }) =>
        Effect.suspend(() => {
          if (remote.unreadable) return Effect.fail(unreadable("landed"));
          const tip = remote.branches.get(target.branch);
          if (tip === undefined || !contains(remote, tip, reviewedHead)) return Effect.succeedNone;
          return Effect.succeedSome({
            commit: reviewedHead,
            parents: remote.parents.get(reviewedHead) ?? [],
            tree: remote.trees.get(reviewedHead)!,
            attribution: tip === reviewedHead ? ("operation" as const) : ("external" as const),
          });
        }),
      publish: ({ branch, commit }) =>
        Effect.sync(() => {
          remote.writes.push(`publish ${branch}`);
          remote.branches.set(branch, commit);
          return { type: "published" as const };
        }),
      apply: () => Effect.die("a pull request integration never writes the target itself"),
    });
  }),
);

const layerTracker = Layer.effect(
  FactoryTracker.FactoryTracker,
  Effect.map(Remote, (remote) => {
    const recorded = (name: string) => Effect.sync(() => void remote.writes.push(name));
    const session: Pick<
      FactoryTracker.TrackerSession,
      | "findPullRequest"
      | "readPullRequest"
      | "createPullRequest"
      | "markReadyForReview"
      | "mergePullRequest"
      | "ensureSuccessStatus"
      | "readChecks"
      | "readReviewFindings"
      | "readCommit"
    > = {
      findPullRequest: (input) =>
        Effect.sync(() =>
          Option.fromNullishOr(remote.pulls.findLast((pull) => pull.head === input.head)),
        ),
      readPullRequest: ({ number }) =>
        Effect.sync(() => remote.pulls.find((pull) => pull.number === number)!),
      createPullRequest: (input) =>
        Effect.sync((): FactoryTracker.CreatePullRequestOutcome => {
          remote.writes.push("create pull request");
          const published = remote.branches.get(input.head)!;
          if (contains(remote, remote.branches.get(input.base)!, published)) {
            return {
              type: "rejected",
              transient: false,
              cause: '{"tag":"GitHubApiResponseError","status":422}',
            };
          }
          const number = 100 + remote.pulls.length;
          remote.pulls.push({
            number,
            head: input.head,
            state: "open",
            merged: false,
            mergeCommit: null,
            headSha: published,
            draft: false,
            nodeId: null,
            mergeableState: "blocked",
          });
          return { type: "written", number };
        }),
      markReadyForReview: () => recorded("mark ready"),
      mergePullRequest: () =>
        recorded("merge").pipe(Effect.as({ type: "refused" as const, status: 405 })),
      ensureSuccessStatus: () => recorded("status").pipe(Effect.as(true)),
      readChecks: () => Effect.succeed({ pending: ["ci / test"], failed: [] }),
      readReviewFindings: () => Effect.succeedNone,
      readCommit: ({ sha }) =>
        Effect.succeed({
          parents: remote.parents.get(sha) ?? [],
          tree: remote.trees.get(sha)!,
          message: "",
        }),
    };
    return FactoryTracker.FactoryTracker.of({
      withSession: (_input, use) => use(session as FactoryTracker.TrackerSession),
    });
  }),
);

const layerProjects = Layer.succeed(ProjectService.ProjectService, {
  getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: "/projects/connectors" }),
} as unknown as ProjectService.ProjectService["Service"]);

const layerTest = FactoryEffects.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      FactoryOperationStore.layer,
      FactoryOutcomeStore.layer,
      FactoryStore.layer,
      EffectOutbox.layer,
      FactoryEffects.layerWakes,
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(layerIntegrator, layerTracker, layerProjects)),
  Layer.provideMerge(layerRemote),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

/** A pull-request factory and the native stages the lifecycle runs for its integrate stage. */
const factory = Effect.gen(function* () {
  const operations = yield* FactoryOperationStore.FactoryOperationStore;
  const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
  const effects = yield* FactoryEffects.FactoryEffects;
  const configuration = yield* (yield* FactoryStore.FactoryStore).configure({
    factoryId,
    projectId,
    policyRevision: "policy-r1",
    enabled: true,
    pools: [{ poolId: FactoryPoolId.make("builders"), capacityUnits: 1 }],
    execution: {
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    packet: { briefSchemaVersion: "brief-v1", helper: null },
    artifactRoot: process.cwd(),
    claim: {
      host: "github.com",
      accountId: "9001",
      foreignClaimLabels: [],
      foreignClaimCommentPatterns: [],
      observedClaimPool: { poolId: FactoryPoolId.make("builders"), units: 1 },
    },
    integration: {
      mode: "pull_request",
      repository,
      remote: "origin",
      branch: "main",
      method: "merge",
    },
  });
  const stages = makeNativeStages({
    operations,
    outcomes,
    integrator: yield* FactoryIntegrator.FactoryIntegrator,
    projects: yield* ProjectService.ProjectService,
    ensureOperation: operations.intend,
    ensureFencedOperation: operations.intendBeside,
  });
  const plan = (reviewedHead = head, fence = open) =>
    stages.planIntegration({
      configuration,
      itemKey,
      stage: { type: "integrate", reviewOutcomeId: `review:${reviewedHead}`, head: reviewedHead },
      issue: { repository, issueNumber: 81, title: "No-change unit" },
      branch: "t3-factory/connector/81",
      fence,
    });
  /** Runs every intended operation's effect once, then records what their readback proved. */
  const drain = Effect.gen(function* () {
    for (const operation of yield* operations.listIntended(factoryId)) {
      yield* effects.apply(operation.operationId);
    }
    yield* stages.recordOutcomes(factoryId);
  });
  const integrations = Effect.map(outcomes.listReported(factoryId), (reported) =>
    reported.filter((outcome) => outcome.stage === "integrate"),
  );
  /** The failed create a release before this fix kept for exactly this head. */
  const retainRefusedCreate = Effect.gen(function* () {
    const remote = yield* Remote;
    const target = remote.branches.get("main")!;
    remote.branches.set("main", base);
    const planned = yield* plan();
    remote.branches.set("main", target);
    if (planned.type !== "in_flight") return yield* Effect.die(planned);
    yield* operations.complete({
      operationId: planned.operationId,
      completion: { state: "failed", reason: refusal },
    });
    return planned.operationId;
  });
  return { operations, plan, drain, integrations, retainRefusedCreate };
});

const acknowledged = (
  parents: ReadonlyArray<string>,
): FactoryOutcomeStore.FactoryOutcomeReport => ({
  outcome: "integrated",
  summary: "The reviewed head was already on main.",
  integration: {
    targetBranch: "main",
    mergeCommit: head,
    parents,
    tree: "tree-head",
    attribution: "external",
  },
});

it.effect(
  "No-op integration: a reviewed head already on the target integrates once, with no pull request",
  () =>
    Effect.gen(function* () {
      const remote = yield* Remote;
      const { operations, plan, drain, integrations } = yield* factory;
      const planned = yield* plan();
      assert.strictEqual(planned.type, "in_flight");
      yield* drain;
      const [operation, ...others] = yield* operations.forItem({ factoryId, itemKey });
      assert.deepStrictEqual(others, []);
      assert.deepStrictEqual(operation?.state === "applied" ? operation.receipt : operation, {
        kind: "git_integrate",
        branch: "main",
        commit: head,
        parents: [base],
        tree: "tree-head",
        attribution: "external",
      });
      assert.deepStrictEqual(
        (yield* integrations).map((outcome) => outcome.report),
        [acknowledged([base])],
      );
      // A repeated pass, or one after a restart, reads the same operation back and writes nothing.
      assert.deepStrictEqual(yield* plan(), planned);
      yield* drain;
      assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 1);
      assert.strictEqual((yield* integrations).length, 1);
      assert.deepStrictEqual(remote.writes, []);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: a head under a later target is acknowledged as itself", () =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    remote.parents.set("1a7e0081", [head]);
    remote.trees.set("1a7e0081", "tree-later");
    remote.branches.set("main", "1a7e0081");
    const { plan, drain, integrations } = yield* factory;
    yield* plan();
    yield* drain;
    assert.deepStrictEqual(
      (yield* integrations).map((outcome) => outcome.report),
      [acknowledged([base])],
    );
    assert.deepStrictEqual(remote.writes, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "No-op integration: a retained refused create for exactly that head integrates on a fresh read",
  () =>
    Effect.gen(function* () {
      const remote = yield* Remote;
      const { operations, plan, drain, integrations, retainRefusedCreate } = yield* factory;
      const refused = yield* retainRefusedCreate;
      const planned = yield* plan();
      assert.strictEqual(planned.type, "in_flight");
      assert.notStrictEqual(planned.type === "in_flight" && planned.operationId, refused);
      yield* drain;
      assert.deepStrictEqual(
        (yield* integrations).map((outcome) => outcome.report),
        [acknowledged([base])],
      );
      // The refusal stays as history; repeats add nothing.
      const recorded = Option.getOrUndefined(yield* operations.get(refused));
      assert.deepStrictEqual(
        recorded?.state === "failed" ? recorded.reason : recorded?.state,
        refusal,
      );
      assert.deepStrictEqual(yield* plan(), planned);
      yield* drain;
      assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 2);
      assert.strictEqual((yield* integrations).length, 1);
      assert.deepStrictEqual(remote.writes, []);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: an unreadable target keeps the refusal until a read proves it", () =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    const { operations, plan, drain, integrations, retainRefusedCreate } = yield* factory;
    yield* retainRefusedCreate;
    remote.unreadable = true;
    assert.deepStrictEqual(yield* plan(), { type: "issue", issue: refusal });
    assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 1);
    remote.unreadable = false;
    const planned = yield* plan();
    assert.strictEqual(planned.type, "in_flight");
    // The effect's own read fails too: it stays intended for the next try and writes nothing.
    remote.unreadable = true;
    yield* drain;
    const pending = yield* operations.listIntended(factoryId);
    assert.deepStrictEqual(
      pending.map((operation) => operation.operationId),
      [planned.type === "in_flight" ? planned.operationId : ""],
    );
    assert.deepStrictEqual(yield* integrations, []);
    remote.unreadable = false;
    yield* drain;
    assert.strictEqual((yield* integrations).length, 1);
    assert.deepStrictEqual(remote.writes, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: an equal tree off the target's history is not containment", () =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    const { operations, plan, retainRefusedCreate } = yield* factory;
    yield* retainRefusedCreate;
    remote.parents.set("e0000081", [base]);
    remote.trees.set("e0000081", "tree-head");
    remote.branches.set("main", "e0000081");
    assert.deepStrictEqual(yield* plan(), { type: "issue", issue: refusal });
    assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 1);
    assert.deepStrictEqual(remote.writes, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: any other failure on a contained head still holds the item", () =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    const { operations, plan } = yield* factory;
    remote.branches.set("main", base);
    const planned = yield* plan();
    if (planned.type !== "in_flight") return yield* Effect.die(planned);
    const closed = "refused: pull request #100 was closed without merging";
    yield* operations.complete({
      operationId: planned.operationId,
      completion: { state: "failed", reason: closed },
    });
    remote.branches.set("main", head);
    assert.deepStrictEqual(yield* plan(), { type: "issue", issue: closed });
    assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: custody that moved since the pass records no new attempt", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { operations, plan, retainRefusedCreate } = yield* factory;
    yield* retainRefusedCreate;
    yield* sql`
      INSERT INTO factory_transfers (transfer_id, factory_id, job_name, state, record_json)
      VALUES ('transfer:1', ${factoryId}, 'legacy-writer', 'begun', '{}')
    `;
    assert.deepStrictEqual(yield* plan(), { type: "custody_changed" });
    assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "No-op integration: a head the target lacks still publishes and opens its pull request",
  () =>
    Effect.gen(function* () {
      const remote = yield* Remote;
      remote.parents.set("c0000082", [head]);
      remote.trees.set("c0000082", "tree-next");
      const { operations, plan, drain, integrations, retainRefusedCreate } = yield* factory;
      // A refusal kept for an older head says nothing about the next one.
      yield* retainRefusedCreate;
      const planned = yield* plan("c0000082");
      assert.strictEqual(planned.type, "in_flight");
      yield* drain;
      assert.deepStrictEqual(remote.writes, [
        "publish t3-factory/connector/81",
        "create pull request",
      ]);
      const [waiting] = yield* operations.listIntended(factoryId);
      assert.match(waiting?.lastError ?? "", /pull request #100 awaits checks/);
      assert.deepStrictEqual(yield* integrations, []);
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "No-op integration: a target that left the head before the effect opens nothing new",
  () =>
    Effect.gen(function* () {
      const remote = yield* Remote;
      const { operations, plan, drain, integrations, retainRefusedCreate } = yield* factory;
      yield* retainRefusedCreate;
      const planned = yield* plan();
      assert.strictEqual(planned.type, "in_flight");
      // The target is force-moved off the head between the pass and its effect.
      remote.parents.set("f0000081", [base]);
      remote.trees.set("f0000081", "tree-forced");
      remote.branches.set("main", "f0000081");
      yield* drain;
      assert.deepStrictEqual(yield* integrations, []);
      // The recovery may only acknowledge: it publishes and opens nothing, and keeps waiting.
      assert.deepStrictEqual(remote.writes, []);
      const [waiting, ...others] = yield* operations.listIntended(factoryId);
      assert.deepStrictEqual(others, []);
      assert.strictEqual(waiting?.operationId, planned.type === "in_flight" && planned.operationId);
      assert.match(
        waiting?.lastError ?? "",
        /does not contain the reviewed head .*nothing was published/,
      );
      // Once the target holds the head again, its retry acknowledges it as itself.
      remote.branches.set("main", head);
      yield* TestClock.adjust("2 minutes");
      yield* drain;
      assert.deepStrictEqual(
        (yield* integrations).map((outcome) => outcome.report),
        [acknowledged([base])],
      );
      const recovered = Option.getOrUndefined(yield* operations.get(waiting!.operationId));
      assert.deepStrictEqual(recovered?.state === "applied" ? recovered.receipt : recovered, {
        kind: "git_integrate",
        branch: "main",
        commit: head,
        parents: [base],
        tree: "tree-head",
        attribution: "external",
      });
      assert.deepStrictEqual(remote.writes, []);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: a missing target holds the attempt and publishes nothing", () =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    const { operations, plan, drain, integrations } = yield* factory;
    remote.branches.delete("main");
    const planned = yield* plan();
    assert.strictEqual(planned.type, "in_flight");
    yield* drain;
    assert.deepStrictEqual(remote.writes, []);
    assert.deepStrictEqual(yield* integrations, []);
    const [waiting, ...others] = yield* operations.listIntended(factoryId);
    assert.deepStrictEqual(others, []);
    assert.strictEqual(waiting?.operationId, planned.type === "in_flight" && planned.operationId);
    assert.match(waiting?.lastError ?? "", /main does not exist on origin; nothing was published/);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("No-op integration: a missing target keeps a retained refusal", () =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    const { operations, plan, retainRefusedCreate } = yield* factory;
    yield* retainRefusedCreate;
    remote.branches.delete("main");
    assert.deepStrictEqual(yield* plan(), { type: "issue", issue: refusal });
    assert.strictEqual((yield* operations.forItem({ factoryId, itemKey })).length, 1);
    assert.deepStrictEqual(remote.writes, []);
  }).pipe(Effect.provide(layerTest)),
);
