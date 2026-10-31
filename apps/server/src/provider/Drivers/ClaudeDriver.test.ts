import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type ClaudeSettings,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import { vi } from "vite-plus/test";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as PortScanner from "../../preview/PortScanner.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as CodexInstallation from "../CodexInstallation.ts";
import * as CodexManagedTokenBroker from "../CodexManagedTokenBroker.ts";
import * as ModelManifest from "../ModelManifest.ts";
import * as ProviderHostLive from "../ProviderHostLive.ts";
import * as ProviderInstanceRegistry from "../ProviderInstanceRegistry.ts";
import * as ProviderInstanceRegistryMutator from "../ProviderInstanceRegistryMutator.ts";
import * as ProviderOrchestrationAdapterInfrastructure from "../ProviderOrchestrationAdapterInfrastructure.ts";
import * as ProviderRegistry from "../ProviderRegistry.ts";
import * as ResetCreditCoordinator from "../resetCreditCoordinator.ts";
import { ClaudeDriver, type ClaudeDriverEnv } from "./ClaudeDriver.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const layerBaseDeps = ServerConfig.layerTest(process.cwd(), {
  prefix: "claude-driver-freshness-test",
}).pipe(
  Layer.provideMerge(
    Layer.mock(CodexManagedTokenBroker.CodexManagedTokenBroker)({
      endpoint: Effect.succeed("unused-private-pipe"),
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(
    Layer.mock(CodexInstallation.CodexInstallation)({ managedDirectory: "unused" }),
  ),
  Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
  Layer.provideMerge(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("00000000-0000-4000-8000-000000000002")),
    }),
  ),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      reportClientActivity: () => Effect.void,
      removeRpcClient: () => Effect.void,
      snapshot: Effect.succeed({
        hostPower: {
          source: "unknown",
          idle: "unknown",
          idleSeconds: null,
          locked: "unknown",
          suspended: false,
          onBattery: "unknown",
          lowPowerMode: "unknown",
          thermalState: "unknown",
          stale: true,
          updatedAt: TEST_EPOCH,
        },
        leases: [],
        activeForegroundLeaseCount: 0,
        activeScopeKeys: [],
        shouldRunOpportunisticWork: true,
        updatedAt: TEST_EPOCH,
      }),
      shouldRunScopeWork: () => Effect.succeed(true),
      shouldRunOpportunisticWork: Effect.succeed(true),
    }),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
      ),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(ProviderLatestVersions.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(ModelManifest.layerTest),
  Layer.provideMerge(ResetCreditCoordinator.layerTest),
);
const layerTest = ProviderOrchestrationAdapterInfrastructure.layer.pipe(
  Layer.provide(PortScanner.layerTest),
  Layer.provideMerge(ProviderHostLive.layer.pipe(Layer.provideMerge(layerBaseDeps))),
  Layer.provideMerge(Layer.mock(SecretResolver.SecretResolver)({})),
  Layer.provideMerge(
    Layer.mock(ProviderInstanceRegistryMutator.ProviderInstanceRegistryMutator)({}),
  ),
);

const claudeConfig = (binaryPath: string, homePath: string): ClaudeSettings => ({
  enabled: true,
  binaryPath,
  homePath,
  customModels: [],
  launchArgs: "",
  autoCompactWindow: "",
  idleCompaction: "default",
});

/**
 * SYNTHETIC account and usage, as the Claude CLI's initialize and usage control answer them: one
 * HOME whose logged-in account a test switches, probes it counts, and failures or a held probe it
 * scripts. No real CLI, account, credential or network is used.
 */
const scriptedClaude = Effect.fn("ClaudeDriver.test.scriptedClaude")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homePath = yield* HostProcess.HomeDirectory;
  const fixtureDir = yield* fileSystem.makeTempDirectoryScoped({
    directory: homePath,
    prefix: ".t3-claude-freshness-test-",
  });
  const claudePath = path.join(fixtureDir, "claude");
  const claudeHome = path.join(fixtureDir, "claude-home");
  yield* fileSystem.copyFile(
    yield* path.fromFileUrl(
      new URL("../testing/ProviderInstanceRegistryLive.fixture.mjs", import.meta.url),
    ),
    claudePath,
  );
  yield* fileSystem.chmod(claudePath, 0o755);
  yield* fileSystem.makeDirectory(claudeHome);
  const state = {
    email: "account-a@example.com",
    fail: false,
    probes: 0,
    hold: undefined as Promise<void> | undefined,
    onStart: undefined as (() => void) | undefined,
  };
  const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
    () =>
      ({
        initializationResult: async () => {
          state.probes++;
          state.onStart?.();
          // The account is read when the probe answers, as the CLI reads its login then.
          if (state.hold !== undefined) await state.hold;
          if (state.fail) throw new Error("initialization failed");
          return {
            commands: [],
            account: { email: state.email, subscriptionType: "pro", tokenSource: "oauth" },
          };
        },
        // A usage-bearing answer earns the capabilities cache its five-minute life.
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 12, resets_at: "2026-07-18T14:39:00Z" } },
        }),
      }) as unknown as ReturnType<typeof ClaudeSdk.query>,
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
  const instanceId = ProviderInstanceId.make("claude_freshness");
  const { registry: instances } =
    yield* ProviderInstanceRegistry.makeProviderInstanceRegistry<ClaudeDriverEnv>({
      drivers: [ClaudeDriver],
      configMap: {
        [instanceId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          config: claudeConfig(`~/${path.relative(homePath, claudePath)}`, claudeHome),
        },
      },
    });
  const instance = (yield* instances.getInstance(instanceId))!;
  const registry = yield* ProviderRegistry.ProviderRegistry.pipe(
    Effect.provide(
      ProviderRegistry.layer.pipe(
        Layer.provide(
          Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
            getInstance: (id) => Effect.succeed(id === instanceId ? instance : undefined),
            listInstances: Effect.succeed([instance]),
            listUnavailable: Effect.succeed([]),
            streamChanges: Stream.empty,
            subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), PubSub.subscribe),
          }),
        ),
      ),
    ),
  );
  const accountOf = (
    providers: ReadonlyArray<{ readonly instanceId: string; readonly auth: unknown }>,
  ) => providers.find((provider) => provider.instanceId === instanceId)?.auth;
  return { state, instance, registry, instanceId, accountOf };
});

describe("ClaudeDriver account freshness", () => {
  it.live(
    "a warm usage-bearing cache serves account A after a switch to B; a fresh observation reads B",
    () =>
      Effect.gen(function* () {
        if (yield* HostProcess.isWindows) return;
        const { state, instance, registry, instanceId, accountOf } = yield* scriptedClaude();
        expect(yield* instance.snapshot.refresh).toMatchObject({
          auth: { status: "authenticated", email: "account-a@example.com" },
        });
        const warm = state.probes;
        // Another login in the same HOME within the cache's life.
        state.email = "account-b@example.com";
        // The ordinary refresh keeps its cache: it still reports A and probes nothing.
        expect(accountOf(yield* registry.refreshInstance(instanceId))).toMatchObject({
          email: "account-a@example.com",
        });
        expect(state.probes).toBe(warm);
        // A strict observation probes afresh and reports the account logged in now.
        const observed = yield* registry.observeInstance!(instanceId);
        expect(Option.getOrThrow(observed).auth).toMatchObject({
          status: "authenticated",
          email: "account-b@example.com",
        });
        expect(state.probes).toBeGreaterThan(warm);
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.live("a failing probe never lets the last good account stand as observed now", () =>
    Effect.gen(function* () {
      if (yield* HostProcess.isWindows) return;
      const { state, instance, registry, instanceId } = yield* scriptedClaude();
      yield* instance.snapshot.refresh;
      state.email = "account-b@example.com";
      state.fail = true;
      // Display keeps its one-probe fallback after an explicit invalidation, as before.
      yield* instance.invalidateCaches ?? Effect.void;
      expect((yield* instance.snapshot.refresh).auth).toMatchObject({
        status: "authenticated",
        email: "account-a@example.com",
      });
      // Warm A again, then observe while probes fail: no account is reported.
      state.fail = false;
      state.email = "account-a@example.com";
      yield* instance.invalidateCaches ?? Effect.void;
      yield* instance.snapshot.refresh;
      state.fail = true;
      const observed = yield* registry.observeInstance!(instanceId);
      expect(Option.getOrThrow(observed).auth.status).not.toBe("authenticated");
      // Recovered: the account logged in now, never the one cached before.
      state.fail = false;
      state.email = "account-b@example.com";
      expect(Option.getOrThrow(yield* registry.observeInstance!(instanceId)).auth).toMatchObject({
        status: "authenticated",
        email: "account-b@example.com",
      });
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.live("a probe in flight when caches are dropped never becomes the fallback after it", () =>
    Effect.gen(function* () {
      if (yield* HostProcess.isWindows) return;
      const { state, instance } = yield* scriptedClaude();
      // No account was ever read, so there is no earlier fallback.
      state.fail = true;
      yield* instance.snapshot.refresh;
      state.fail = false;
      // A probe of account A starts and is held; the caches are dropped while it is in flight.
      let open!: () => void;
      state.hold = new Promise((resolve) => {
        open = resolve;
      });
      const started = new Promise<void>((resolve) => {
        state.onStart = resolve;
      });
      const inFlight = yield* Effect.forkScoped(instance.snapshot.refresh);
      yield* Effect.promise(() => started);
      state.onStart = undefined;
      yield* instance.invalidateCaches ?? Effect.void;
      open();
      state.hold = undefined;
      yield* Fiber.join(inFlight);
      // It answered for an older generation, so a failing probe after it has no account to reuse.
      state.fail = true;
      expect((yield* instance.snapshot.refresh).auth.status).not.toBe("authenticated");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});
