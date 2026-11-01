// @effect-diagnostics nodeBuiltinImport:off - disposable repositories and a pinned stub command.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

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
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import * as FactoryLandedCommands from "./FactoryLandedCommands.ts";
import { LANDED_INPUT_SCHEMA, landedOperationId, makeNativeStages } from "./factoryNativeStages.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

// A real local merge by T3's own Git integrator, then the landed_command it records and runs.
// DEVAPP_DEMO_* runs a project's real command instead (opt-in; raise --test-timeout for it).
const demo =
  process.env.DEVAPP_DEMO_REPO === undefined
    ? undefined
    : {
        repo: process.env.DEVAPP_DEMO_REPO,
        executable: process.env.DEVAPP_DEMO_EXECUTABLE!,
        script: process.env.DEVAPP_DEMO_SCRIPT!,
        factoryId: process.env.DEVAPP_DEMO_FACTORY ?? "btc-native-pilot-20261024",
        repository: process.env.DEVAPP_DEMO_REPOSITORY ?? "zainmitchell/btc-tracker",
        issue: Number(process.env.DEVAPP_DEMO_ISSUE ?? "9101"),
        timeoutSeconds: Number(process.env.DEVAPP_DEMO_TIMEOUT ?? "3600"),
      };

const factoryId = FactoryId.make(demo?.factoryId ?? "landed-fixture");
const repository = demo?.repository ?? "example-org/landed";
const issueNumber = demo?.issue ?? 41;
const itemKey = FactoryItemKey.make(`github:${repository}#${issueNumber}`);
const projectId = ProjectId.make("project:landed");
const identity = { name: "T3 Factory", email: "factory@example.invalid" };
const open: FactoryStore.CustodyFence = { factoryId, custodyRead: [], transfersRead: [] };
const sha256 = (data: string | Buffer) =>
  NodeCrypto.createHash("sha256").update(data).digest("hex");

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=Worker", "-c", "user.email=worker@example.invalid", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

/**
 * Records each run beside itself, prints a JSON result line, and exits as `mode` says: a code, or
 * `75once` (75, then 0), or `hangonce` (first run starts a grandchild, writes both pids, and waits).
 */
const STUB = `
const fs = require("node:fs");
const path = require("node:path");
const here = __dirname;
let stdin = "";
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  const n = fs.readdirSync(here).filter((name) => name.startsWith("seen-")).length + 1;
  fs.writeFileSync(path.join(here, "seen-" + n + ".json"), JSON.stringify({
    stdin, cwd: process.cwd(), argv: process.argv.slice(2), env: Object.keys(process.env),
  }));
  const mode = fs.readFileSync(path.join(here, "mode.txt"), "utf8").trim();
  console.log("progress line");
  console.log(JSON.stringify({ outcome: "stub", n }));
  if (mode === "hangonce" && n === 1) {
    const grandchild = require("node:child_process").spawn(
      process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" });
    fs.writeFileSync(path.join(here, "pids.json"), JSON.stringify({ stub: process.pid, grandchild: grandchild.pid }));
    setTimeout(() => process.exit(0), 120000);
    return;
  }
  const code = mode === "75once" ? (n === 1 ? 75 : 0) : mode === "hangonce" ? 0 : Number(mode);
  if (code !== 0) console.error("stub failure " + mode);
  process.exit(code);
});
`;

/** A repository whose `main` T3 integrates into, a reviewed head beside it, and a pinned stub. */
class Workspace extends Context.Service<
  Workspace,
  {
    readonly repo: string;
    readonly base: string;
    readonly head: string;
    readonly stubDir: string;
    readonly command: {
      executable: string;
      script: string;
      sha256: string;
      timeoutSeconds: number;
    };
  }
>()("t3/factory/FactoryLandedCommands.integration.test/Workspace") {}

const layerWorkspace = Layer.effect(
  Workspace,
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-landed-"));
      const stubDir = NodePath.join(root, "command");
      NodeFS.mkdirSync(stubDir);
      const script = NodePath.join(stubDir, "landed.cjs");
      NodeFS.writeFileSync(script, STUB);
      NodeFS.writeFileSync(NodePath.join(stubDir, "mode.txt"), "0");
      if (demo !== undefined) {
        return {
          root,
          repo: demo.repo,
          base: git(demo.repo, "rev-parse", "refs/heads/main"),
          head: git(demo.repo, "rev-parse", "refs/heads/review"),
          stubDir,
          command: {
            executable: demo.executable,
            script: demo.script,
            sha256: sha256(NodeFS.readFileSync(demo.script)),
            timeoutSeconds: demo.timeoutSeconds,
          },
        };
      }
      // T3's Git refuses bare repositories, so the project is a work tree whose `main` is not
      // checked out (a local target is never moved under a work tree).
      const repo = NodePath.join(root, "project");
      git(root, "init", "-q", "-b", "main", repo);
      NodeFS.writeFileSync(NodePath.join(repo, "a.txt"), "one\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "base");
      const base = git(repo, "rev-parse", "HEAD");
      git(repo, "checkout", "-q", "-b", "review");
      NodeFS.writeFileSync(NodePath.join(repo, "b.txt"), "reviewed\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "reviewed work");
      const head = git(repo, "rev-parse", "HEAD");
      git(repo, "checkout", "-q", "--detach");
      return {
        root,
        repo,
        base,
        head,
        stubDir,
        command: {
          executable: process.execPath,
          script,
          sha256: sha256(STUB),
          timeoutSeconds: 120,
        },
      };
    }),
    ({ root }) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
  ),
);

const layerProjects = Layer.effect(
  ProjectService.ProjectService,
  Effect.map(
    Workspace,
    (workspace) =>
      ({
        getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: workspace.repo }),
      }) as unknown as ProjectService.ProjectService["Service"],
  ),
);

const layerIntegrator = FactoryIntegrator.layer.pipe(
  Layer.provide(
    GitVcsDriver.layer.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-factory-landed-" })),
      Layer.provideMerge(VcsProcess.layer),
    ),
  ),
);

/** Everything but the runner, which the restart tests start and stop themselves. */
const layerBase = FactoryEffects.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      FactoryOperationStore.layer,
      FactoryOutcomeStore.layer,
      FactoryStore.layer,
      EffectOutbox.layer,
      FactoryEffects.layerWakes,
      ProcessRunner.layer,
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(layerIntegrator, layerProjects)),
  Layer.provideMerge(layerWorkspace),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

const layerTest = FactoryLandedCommands.layer.pipe(Layer.provideMerge(layerBase));

/** A runner on the test's durable store; stopping it is a server shutdown, starting another a restart. */
const startRunner = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(FactoryLandedCommands.layer, scope);
  return {
    runner: Context.get(context, FactoryLandedCommands.FactoryLandedCommands),
    stop: Scope.close(scope, Exit.void),
  };
});

/** The next "operation" wake: what a landed command offers when its operation ends. */
const nextEnded = Effect.gen(function* () {
  const wakes = yield* FactoryEffects.FactoryWakes;
  for (;;) {
    const wake = yield* Queue.take(wakes);
    if (wake.trigger === "operation" && wake.factoryId === factoryId) return wake;
  }
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waits, by file-system event, for a file the stub writes. */
const fileWritten = (file: string) =>
  Effect.callback<void>((resume) => {
    const check = () => {
      if (NodeFS.existsSync(file)) resume(Effect.void);
    };
    const watcher = NodeFS.watch(NodePath.dirname(file), check);
    check();
    return Effect.sync(() => watcher.close());
  });

/** A local-merge factory, its native stages, and one drain of its integrate stage. */
const factory = (options: { readonly afterIntegration?: boolean } = {}) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    const outcomes = yield* FactoryOutcomeStore.FactoryOutcomeStore;
    const effects = yield* FactoryEffects.FactoryEffects;
    const configuration = yield* (yield* FactoryStore.FactoryStore).configure({
      factoryId,
      projectId,
      policyRevision: "policy-r7",
      enabled: true,
      pools: [{ poolId: FactoryPoolId.make("builders"), capacityUnits: 1 }],
      execution: {
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      },
      packet: { briefSchemaVersion: "brief-v1", helper: null },
      artifactRoot: process.cwd(),
      integration: { branch: "main", remote: null, mode: "merge", identity },
      ...(options.afterIntegration === false ? {} : { afterIntegration: workspace.command }),
    });
    const stages = makeNativeStages({
      operations,
      outcomes,
      integrator: yield* FactoryIntegrator.FactoryIntegrator,
      projects: yield* ProjectService.ProjectService,
      ensureOperation: operations.intend,
      ensureFencedOperation: operations.intendBeside,
    });
    const integrate = Effect.gen(function* () {
      const planned = yield* stages.planIntegration({
        configuration,
        itemKey,
        stage: { type: "integrate", reviewOutcomeId: "review:accepted", head: workspace.head },
        issue: { repository, issueNumber, title: "Reviewed work" },
        fence: open,
      });
      assert.strictEqual(planned.type, "in_flight", JSON.stringify(planned));
      for (const operation of yield* operations.listIntended(factoryId)) {
        yield* effects.apply(operation.operationId);
      }
      yield* stages.recordOutcomes(factoryId, configuration);
      const [integrated] = (yield* outcomes.listReported(factoryId)).filter(
        (outcome) => outcome.report.outcome === "integrated",
      );
      return integrated!;
    });
    const landed = (outcomeId: string) =>
      Effect.map(operations.get(landedOperationId(factoryId, outcomeId)), Option.getOrUndefined);
    return { workspace, operations, stages, configuration, integrate, landed, effects };
  });

/** Runs the landed command once and waits for that run to end. */
const runOnce = (operation: FactoryOperationStore.FactoryOperation) =>
  Effect.gen(function* () {
    assert.strictEqual(operation.state, "intended");
    const runner = yield* FactoryLandedCommands.FactoryLandedCommands;
    const fiber = yield* runner.ensure(operation as FactoryOperationStore.IntendedOperation);
    assert.isTrue(Option.isSome(fiber), "the command did not start");
    if (Option.isSome(fiber)) yield* Fiber.join(fiber.value);
  });

const seen = (stubDir: string, n: number) =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(stubDir, `seen-${n}.json`), "utf8")) as {
    stdin: string;
    cwd: string;
    argv: ReadonlyArray<string>;
    env: ReadonlyArray<string>;
  };

it.effect(
  "After integration: a real local merge gets one pinned command run with its native facts",
  () =>
    Effect.gen(function* () {
      if (demo !== undefined) return;
      const { workspace, operations, stages, configuration, integrate, landed, effects } =
        yield* factory();
      const integrated = yield* integrate;
      const merge = git(workspace.repo, "rev-parse", "refs/heads/main");
      assert.deepStrictEqual(integrated.report.integration, {
        targetBranch: "main",
        mergeCommit: merge,
        parents: [workspace.base, workspace.head],
        tree: git(workspace.repo, "rev-parse", `${merge}^{tree}`),
        attribution: "operation",
      });
      const operation = (yield* landed(integrated.outcomeId))!;
      assert.strictEqual(operation.intent.kind, "landed_command");
      if (operation.intent.kind !== "landed_command") return;
      assert.deepStrictEqual(operation.intent.command, workspace.command);
      assert.deepStrictEqual(JSON.parse(operation.intent.input), {
        schema: LANDED_INPUT_SCHEMA,
        factoryId,
        itemKey,
        outcomeId: integrated.outcomeId,
        operationId: operation.operationId,
        subject: { repository, issueNumber },
        configurationRevision: configuration.revision,
        policyRevision: "policy-r7",
        review: { outcomeId: "review:accepted", head: workspace.head },
        integration: {
          targetBranch: "main",
          remote: null,
          mergeCommit: merge,
          parents: [workspace.base, workspace.head],
          tree: git(workspace.repo, "rev-parse", `${merge}^{tree}`),
          attribution: "operation",
        },
      });
      // Not an outbox effect, and the effect worker leaves it alone.
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      assert.deepStrictEqual(
        yield* outbox.listByCommandId(`factory-operation:${operation.operationId}` as never),
        [],
      );
      yield* effects.apply(operation.operationId);
      assert.strictEqual((yield* landed(integrated.outcomeId))!.state, "intended");
      // Another pass records nothing new.
      yield* stages.recordOutcomes(factoryId, configuration);
      const all = yield* operations.forItem({ factoryId, itemKey });
      assert.strictEqual(all.filter((each) => each.intent.kind === "landed_command").length, 1);

      process.env.T3CODE_DEPLOYMENT_ADMISSION_FILE = "must-not-reach-the-command";
      process.env.GIT_DIR = "must-not-reach-the-command";
      try {
        yield* runOnce(operation);
      } finally {
        delete process.env.T3CODE_DEPLOYMENT_ADMISSION_FILE;
        delete process.env.GIT_DIR;
      }
      const ended = (yield* landed(integrated.outcomeId))!;
      assert.strictEqual(ended.state, "applied");
      if (ended.state !== "applied" || ended.receipt.kind !== "landed_command") return;
      assert.strictEqual(ended.receipt.exitCode, 0);
      assert.deepStrictEqual(JSON.parse(ended.receipt.result!), { outcome: "stub", n: 1 });
      const first = seen(workspace.stubDir, 1);
      assert.strictEqual(first.stdin, operation.intent.input);
      assert.strictEqual(NodeFS.realpathSync(first.cwd), NodeFS.realpathSync(workspace.stubDir));
      assert.deepStrictEqual(first.argv, []);
      assert.isFalse(first.env.some((name) => /^(GIT_|T3CODE_|PYTHON)/i.test(name)));
      // An ended command is never run again, even when offered the record a pass read earlier.
      const runner = yield* FactoryLandedCommands.FactoryLandedCommands;
      const again = yield* runner.ensure(operation as FactoryOperationStore.IntendedOperation);
      if (Option.isSome(again)) yield* Fiber.join(again.value);
      assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-2.json")));
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "After integration: exit 75 at an idle factory is run again at its deadline, unasked",
  () =>
    Effect.gen(function* () {
      if (demo !== undefined) return;
      const { workspace, configuration, integrate, landed } = yield* factory();
      // No periodic reconciliation and no further pass: only the runner's own wake can retry it.
      assert.isUndefined(configuration.reconcileEveryMinutes);
      const integrated = yield* integrate;
      NodeFS.writeFileSync(NodePath.join(workspace.stubDir, "mode.txt"), "75once");
      yield* Queue.clear(yield* FactoryEffects.FactoryWakes);
      yield* runOnce((yield* landed(integrated.outcomeId))!);
      const waiting = (yield* landed(integrated.outcomeId))!;
      assert.strictEqual(waiting.state, "intended");
      assert.include(waiting.lastError ?? "", "asked to run later");
      assert.strictEqual(waiting.retryAt, "1970-01-01T00:01:00.000Z");
      // A pass offering it before the deadline starts nothing.
      const runner = yield* FactoryLandedCommands.FactoryLandedCommands;
      assert.isTrue(
        Option.isNone(yield* runner.ensure(waiting as FactoryOperationStore.IntendedOperation)),
      );
      yield* TestClock.adjust("59 seconds");
      assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-2.json")));
      yield* TestClock.adjust("1 second");
      yield* nextEnded;
      assert.strictEqual((yield* landed(integrated.outcomeId))!.state, "applied");
      assert.strictEqual(seen(workspace.stubDir, 2).stdin, seen(workspace.stubDir, 1).stdin);
      assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-3.json")));
    }).pipe(Effect.provide(layerTest)),
);

it.effect("After integration: a restart keeps a waiting command's deadline and runs it once", () =>
  Effect.gen(function* () {
    if (demo !== undefined) return;
    const { workspace, integrate, landed } = yield* factory();
    const integrated = yield* integrate;
    NodeFS.writeFileSync(NodePath.join(workspace.stubDir, "mode.txt"), "75once");
    const first = yield* startRunner;
    const started = yield* first.runner.ensure(
      (yield* landed(integrated.outcomeId))! as FactoryOperationStore.IntendedOperation,
    );
    if (Option.isSome(started)) yield* Fiber.join(started.value);
    yield* first.stop;
    // The deadline passes while no server runs: nothing runs.
    yield* TestClock.adjust("30 seconds");
    assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-2.json")));
    // A restart before the kept deadline waits for it rather than running at once.
    yield* Queue.clear(yield* FactoryEffects.FactoryWakes);
    const second = yield* startRunner;
    yield* TestClock.adjust("29 seconds");
    assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-2.json")));
    yield* TestClock.adjust("1 second");
    yield* nextEnded;
    assert.strictEqual((yield* landed(integrated.outcomeId))!.state, "applied");
    assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-3.json")));
    yield* second.stop;
  }).pipe(Effect.provide(layerBase)),
);

it.live(
  "After integration: shutdown kills a running command's process tree; the restart runs it once",
  () =>
    Effect.gen(function* () {
      if (demo !== undefined) return;
      const { workspace, integrate, landed } = yield* factory();
      const integrated = yield* integrate;
      NodeFS.writeFileSync(NodePath.join(workspace.stubDir, "mode.txt"), "hangonce");
      const first = yield* startRunner;
      yield* first.runner.ensure(
        (yield* landed(integrated.outcomeId))! as FactoryOperationStore.IntendedOperation,
      );
      const pidsFile = NodePath.join(workspace.stubDir, "pids.json");
      yield* fileWritten(pidsFile);
      const pids = JSON.parse(NodeFS.readFileSync(pidsFile, "utf8")) as {
        stub: number;
        grandchild: number;
      };
      assert.isTrue(alive(pids.stub) && alive(pids.grandchild));
      yield* first.stop;
      assert.isFalse(alive(pids.stub), "the command outlived the shutdown");
      assert.isFalse(alive(pids.grandchild), "the command's child outlived the shutdown");
      assert.strictEqual((yield* landed(integrated.outcomeId))!.state, "intended");
      // The restart resumes it with no factory pass, exactly once.
      yield* Queue.clear(yield* FactoryEffects.FactoryWakes);
      const second = yield* startRunner;
      yield* nextEnded;
      assert.strictEqual((yield* landed(integrated.outcomeId))!.state, "applied");
      assert.isTrue(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-2.json")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-3.json")));
      yield* second.stop;
    }).pipe(Effect.provide(layerBase)),
);

it.effect("After integration: a failing command or a changed script fails it, once", () =>
  Effect.gen(function* () {
    if (demo !== undefined) return;
    const { workspace, integrate, landed } = yield* factory();
    const integrated = yield* integrate;
    NodeFS.writeFileSync(NodePath.join(workspace.stubDir, "mode.txt"), "3");
    yield* runOnce((yield* landed(integrated.outcomeId))!);
    const failed = (yield* landed(integrated.outcomeId))!;
    assert.strictEqual(failed.state, "failed");
    if (failed.state === "failed")
      assert.include(failed.reason, "landed_command: exit 3: stub failure 3");

    // A second factory whose pinned script no longer matches never runs it.
    NodeFS.appendFileSync(workspace.command.script, "\n// changed\n");
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    const forged = yield* operations.intend({
      operationId: "landed:forged",
      factoryId,
      itemKey,
      intent: { kind: "landed_command", outcomeId: "x", command: workspace.command, input: "{}" },
    });
    yield* runOnce(forged);
    const refused = Option.getOrUndefined(yield* operations.get("landed:forged"))!;
    assert.strictEqual(refused.state, "failed");
    if (refused.state === "failed") assert.include(refused.reason, "does not match its pin");
    assert.isFalse(NodeFS.existsSync(NodePath.join(workspace.stubDir, "seen-2.json")));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("After integration: a factory without the command records the integration alone", () =>
  Effect.gen(function* () {
    if (demo !== undefined) return;
    const { integrate, landed } = yield* factory({ afterIntegration: false });
    const integrated = yield* integrate;
    assert.strictEqual(integrated.report.outcome, "integrated");
    assert.isUndefined(yield* landed(integrated.outcomeId));
  }).pipe(Effect.provide(layerTest)),
);

it.live("After integration demo: a project's real command on a real merge", () =>
  Effect.gen(function* () {
    if (demo === undefined) return;
    const { workspace, integrate, landed } = yield* factory();
    const integrated = yield* integrate;
    const operation = (yield* landed(integrated.outcomeId))!;
    yield* runOnce(operation);
    // A command that exited 75 (its own lock held) is run again by the runner's wake, unasked.
    while ((yield* landed(integrated.outcomeId))!.state === "intended") yield* nextEnded;
    const ended = (yield* landed(integrated.outcomeId))!;
    const record = {
      merge: git(workspace.repo, "rev-parse", "refs/heads/main"),
      integrated: integrated.report.integration,
      landedOperationId: operation.operationId,
      input: operation.intent.kind === "landed_command" ? JSON.parse(operation.intent.input) : null,
      state: ended.state,
      receipt: ended.state === "applied" ? ended.receipt : undefined,
      reason: ended.state === "failed" ? ended.reason : undefined,
    };
    if (process.env.DEVAPP_DEMO_RECORD !== undefined) {
      NodeFS.writeFileSync(process.env.DEVAPP_DEMO_RECORD, JSON.stringify(record, null, 1));
    }
    assert.strictEqual(ended.state, "applied", JSON.stringify(record));
  }).pipe(Effect.provide(layerTest)),
);
