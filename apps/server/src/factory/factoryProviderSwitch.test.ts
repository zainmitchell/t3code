import { assert, it } from "@effect/vitest";
import {
  CommandId,
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { makeSwitchProvider } from "./factoryProviderSwitch.ts";
import * as FactoryStore from "./FactoryStore.ts";

const second = ProviderInstanceId.make("claude_second");
const first = ProviderInstanceId.make("claudeAgent");
const codex = ProviderInstanceId.make("codex_cli");
const factoryId = FactoryId.make("native-pilot");

const claude = (instanceId: ProviderInstanceId, effort: string) => ({
  modelSelection: {
    instanceId,
    model: "claude-opus-5-5",
    options: [
      { id: "effort", value: effort },
      { id: "fastMode", value: false },
    ],
  },
  runtimeMode: "auto" as const,
  interactionMode: "default" as const,
});
const gpt = {
  modelSelection: {
    instanceId: codex,
    model: "gpt-6.1-sol",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};

// Shaped like an operator's installed documents: four Claude selections, two others.
const document = (id = factoryId): FactoryStore.FactoryConfigurationInput => ({
  factoryId: id,
  projectId: ProjectId.make("project:pilot"),
  policyRevision: "pilot-policy:r1",
  enabled: true,
  pools: [{ poolId: FactoryPoolId.make("builders"), capacityUnits: 2 }],
  execution: claude(second, "high"),
  stageExecution: { review: gpt, correct: claude(second, "xhigh") },
  executionChoices: {
    "builder-high": claude(second, "high"),
    "builder-medium": claude(second, "medium"),
    triage: gpt,
  },
  packet: { briefSchemaVersion: "brief-v1", helper: null },
  artifactRoot: "/artifacts/pilot",
  policy: { executable: "python", script: "/policy/factory_policy.py", sha256: "a".repeat(64) },
  reconcileEveryMinutes: 5,
  ownerThreadId: ThreadId.make("thread:owner"),
  integration: {
    mode: "pull_request",
    repository: "acme/pilot",
    remote: "origin",
    branch: "main",
    method: "squash",
  },
});

const CLAUDE_PATHS = [
  "/execution/modelSelection/instanceId",
  "/stageExecution/correct/modelSelection/instanceId",
  "/executionChoices/builder-high/modelSelection/instanceId",
  "/executionChoices/builder-medium/modelSelection/instanceId",
];

const provider = (
  instanceId: ProviderInstanceId,
  displayName: string,
  overrides: Partial<ServerProvider> = {},
  efforts: ReadonlyArray<string> = ["low", "medium", "high", "xhigh"],
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName,
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-28T00:00:00.000Z",
  models: [
    {
      slug: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: efforts.map((id) => ({ id, label: id })),
          },
          { id: "fastMode", label: "Fast mode", type: "boolean" },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
  ...overrides,
});
const providers = [provider(second, "Second Claude"), provider(first, "First Claude")];

const layer = FactoryStore.layer.pipe(
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
);

const latest = Effect.gen(function* () {
  const store = yield* FactoryStore.FactoryStore;
  const configuration = yield* store.getConfiguration(factoryId);
  if (Option.isNone(configuration)) throw new Error("expected a configuration");
  const { revision, createdAt: _createdAt, ...rest } = configuration.value;
  return { revision, document: rest };
});

/** `document` with exactly the given paths' instance moved, as the switch must write it. */
const movedTo = (instanceId: ProviderInstanceId, base = document()) => {
  const expected = structuredClone(base) as unknown as Record<string, unknown>;
  for (const path of CLAUDE_PATHS) {
    const keys = path.slice(1).split("/");
    let node = expected;
    for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[keys.at(-1)!] = instanceId;
  }
  return expected;
};

it.effect("A dry run names each moving path and display name and writes nothing", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    yield* store.configure(document());
    const result = yield* makeSwitchProvider(store)(
      { factoryId, from: second, to: first, apply: false },
      providers,
    );
    assert.strictEqual(result.outcome, "planned");
    assert.deepStrictEqual(result.from, { instanceId: second, displayName: "Second Claude" });
    assert.deepStrictEqual(result.to, { instanceId: first, displayName: "First Claude" });
    assert.deepStrictEqual(
      result.changes,
      CLAUDE_PATHS.map((path) => ({ path, model: "claude-opus-5-5" })),
    );
    assert.deepStrictEqual(result.alreadyOnTarget, []);
    assert.strictEqual(result.revision, 1);
    assert.deepStrictEqual(yield* latest, { revision: 1, document: document() });
  }).pipe(Effect.provide(layer)),
);

it.effect("Applying moves only the matching instance ids, and switching back restores it", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    yield* store.configure(document());
    const toFirst = yield* makeSwitchProvider(store)(
      { factoryId, from: second, to: first, apply: true },
      providers,
    );
    assert.strictEqual(toFirst.outcome, "switched");
    assert.strictEqual(toFirst.switchedRevision, 2);
    // Models, efforts, the codex stages, policy, pools, pause state and the rest are as they were.
    assert.deepStrictEqual(yield* latest, { revision: 2, document: movedTo(first) });

    const toSecond = yield* makeSwitchProvider(store)(
      { factoryId, from: first, to: second, apply: true },
      providers,
    );
    assert.strictEqual(toSecond.outcome, "switched");
    assert.deepStrictEqual(yield* latest, { revision: 3, document: document() });
  }).pipe(Effect.provide(layer)),
);

it.effect("Repeating a finished switch, or one that matches nothing, writes nothing", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    yield* store.configure(document());
    const run = (from: ProviderInstanceId, to: ProviderInstanceId) =>
      makeSwitchProvider(store)({ factoryId, from, to, apply: true }, providers);
    yield* run(second, first);
    const again = yield* run(second, first);
    assert.strictEqual(again.outcome, "already_switched");
    assert.deepStrictEqual(again.alreadyOnTarget, CLAUDE_PATHS);
    const nothing = yield* run(ProviderInstanceId.make("cursor"), ProviderInstanceId.make("grok"));
    assert.strictEqual(nothing.outcome, "no_match");
    assert.strictEqual((yield* latest).revision, 2);
  }).pipe(Effect.provide(layer)),
);

it.effect("A partly switched factory moves the rest and reports what was already there", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const mixed = { ...document(), execution: claude(first, "high") };
    yield* store.configure(mixed);
    const result = yield* makeSwitchProvider(store)(
      { factoryId, from: second, to: first, apply: true },
      providers,
    );
    assert.strictEqual(result.outcome, "switched");
    assert.deepStrictEqual(
      result.changes.map((change) => change.path),
      CLAUDE_PATHS.slice(1),
    );
    assert.deepStrictEqual(result.alreadyOnTarget, CLAUDE_PATHS.slice(0, 1));
    assert.deepStrictEqual((yield* latest).document, movedTo(first));
  }).pipe(Effect.provide(layer)),
);

it.effect.each([
  ["missing", [providers[0]!], "is not registered"],
  ["disabled", [providers[0]!, provider(first, "First Claude", { enabled: false })], "is disabled"],
  [
    "signed out",
    [providers[0]!, provider(first, "First Claude", { auth: { status: "unauthenticated" } })],
    "is not authenticated",
  ],
  [
    "without the model",
    [providers[0]!, provider(first, "First Claude", { models: [] })],
    "/execution/modelSelection/instanceId: claudeAgent does not offer model claude-opus-5-5.",
  ],
  [
    "without the effort",
    [providers[0]!, provider(first, "First Claude", {}, ["low", "medium", "high"])],
    "/stageExecution/correct/modelSelection/instanceId: Option effort must be one of",
  ],
] as const)("A %s target is refused and nothing is written", ([, registered, reason]) =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    yield* store.configure(document());
    for (const apply of [false, true]) {
      const result = yield* makeSwitchProvider(store)(
        { factoryId, from: second, to: first, apply },
        registered,
      );
      assert.strictEqual(result.outcome, "refused");
      assert.include(result.reason, reason);
    }
    assert.deepStrictEqual(yield* latest, { revision: 1, document: document() });
  }).pipe(Effect.provide(layer)),
);

it.effect("An unconfigured factory, or the same instance on both sides, is refused", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const unconfigured = yield* makeSwitchProvider(store)(
      { factoryId, from: second, to: first, apply: true },
      providers,
    );
    assert.strictEqual(unconfigured.outcome, "refused");
    assert.strictEqual(unconfigured.reason, "the factory is not configured");
    yield* store.configure(document());
    const same = yield* makeSwitchProvider(store)(
      { factoryId, from: first, to: first, apply: true },
      providers,
    );
    assert.strictEqual(same.outcome, "refused");
    assert.strictEqual((yield* latest).revision, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("An install landing after the read is reported and kept, never overwritten", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const other = FactoryId.make("other-pilot");
    yield* store.configure(document());
    yield* store.configure(document(other));
    const concurrent = { ...document(), enabled: false };
    // Another writer installs between this switch's read and its write.
    const racing = FactoryStore.FactoryStore.of({
      ...store,
      configureAtRevision: (input, expectRevision) =>
        input.factoryId === factoryId
          ? Effect.andThen(
              store.configure(concurrent),
              store.configureAtRevision(input, expectRevision),
            )
          : store.configureAtRevision(input, expectRevision),
    });
    const results = yield* Effect.forEach([factoryId, other], (id) =>
      makeSwitchProvider(racing)(
        { factoryId: id, from: second, to: first, apply: true },
        providers,
      ),
    );
    assert.deepStrictEqual(
      results.map((result) => [result.factoryId, result.outcome]),
      [
        [factoryId, "conflict"],
        [other, "switched"],
      ],
    );
    assert.include(results[0]!.reason, "revision 2 was installed after revision 1 was read");
    assert.deepStrictEqual(yield* latest, { revision: 2, document: concurrent });
    const switched = yield* store.getConfiguration(other);
    assert.strictEqual(Option.getOrThrow(switched).execution.modelSelection.instanceId, first);
  }).pipe(Effect.provide(layer)),
);

it.effect("Running work keeps its reservation, pinned selection and admitted revision", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    const sql = yield* SqlClient.SqlClient;
    const configuration = yield* store.configure(document());
    const recorded = yield* store.recordItemObservation({
      factoryId,
      itemKey: FactoryItemKey.make("github:acme/pilot#75"),
      itemVersion: "v1",
      generation: yield* store.beginCollection(factoryId),
      complete: true,
      evidence: [],
      sources: [],
      claims: [],
    });
    if (recorded.type !== "recorded") throw new Error("expected a recorded observation");
    yield* sql.withTransaction(
      store.reserveExecution({
        commandId: CommandId.make("factory:pilot:decision:75"),
        executionThreadId: ThreadId.make("thread:builder-75"),
        runId: RunId.make("run:builder-75"),
        taskNodeId: NodeId.make("node:builder-75"),
        modelSelection: document().execution.modelSelection,
        origin: {
          type: "admission",
          admission: {
            factoryId,
            configRevision: configuration.revision,
            decisionKey: FactoryDecisionKey.make("75"),
            itemKey: FactoryItemKey.make("github:acme/pilot#75"),
            itemVersion: "v1",
            taskKind: "implement",
            policyRevision: "pilot-policy:r1",
            poolId: FactoryPoolId.make("builders"),
            units: 1,
            packetDigest: "packet-75",
            observationId: recorded.observation.observationId,
            basisDigest: recorded.observation.basisDigest,
            deadline: DateTime.add(yield* DateTime.now, { hours: 1 }),
          },
        },
      }),
    );
    const before = yield* store.listReservations(factoryId);
    assert.strictEqual(before.length, 1);
    const result = yield* makeSwitchProvider(store)(
      { factoryId, from: second, to: first, apply: true },
      providers,
    );
    assert.strictEqual(result.outcome, "switched");
    assert.deepStrictEqual(yield* store.listReservations(factoryId), before);
  }).pipe(Effect.provide(layer)),
);
it.effect("An install at a stale revision is refused and writes nothing", () =>
  Effect.gen(function* () {
    const store = yield* FactoryStore.FactoryStore;
    yield* store.configure(document());
    yield* store.configure(document());
    const stale = yield* store.configureAtRevision({ ...document(), enabled: false }, 1);
    assert.deepStrictEqual(stale, { type: "conflict", revision: 2 });
    const current = yield* store.configureAtRevision({ ...document(), enabled: false }, 2);
    assert.strictEqual(current.type === "configured" && current.configuration.revision, 3);
  }).pipe(Effect.provide(layer)),
);
