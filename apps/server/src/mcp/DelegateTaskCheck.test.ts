import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as DelegateTaskCheck from "./DelegateTaskCheck.ts";

const request: DelegateTaskCheck.DelegateTaskCheckRequest = {
  task: "generated",
  workspaceRoot: "/work/hsa",
  checkoutPath: "/work/hsa",
  isolation: "worktree",
  baseCommit: "a".repeat(40),
  driver: "claudeAgent",
  providerInstanceId: "hsa_claude",
};

const leakedUrl = "https://example.invalid/?token=TEST_ONLY";

// Admits only the exact task "generated" with the context it was sent, like rules.py dispatch-check.
const verifier = [
  process.execPath,
  "-e",
  `let input = "";
process.stdin.on("data", (chunk) => (input += chunk)).on("end", () => {
  const request = JSON.parse(input);
  if (request.task === "generated" && request.driver === "claudeAgent") process.exit(0);
  process.stderr.write(JSON.stringify({ error: "SENTINEL_STDERR ${leakedUrl} " + request.task.length }));
  process.exit(2);
});`,
];

const stdoutVerifier = [
  process.execPath,
  "-e",
  `process.stdout.write("SENTINEL_STDOUT ${leakedUrl}");
process.exit(1);`,
];

const check = (env: Record<string, string>, input: DelegateTaskCheck.DelegateTaskCheckRequest) =>
  Effect.gen(function* () {
    const service = yield* DelegateTaskCheck.DelegateTaskCheck;
    return yield* service.check(input).pipe(Effect.flip, Effect.option);
  }).pipe(
    Effect.provide(
      DelegateTaskCheck.layer.pipe(
        Layer.provide(ProcessRunner.layer),
        Layer.provide(NodeServices.layer),
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
      ),
    ),
  );

const configuredWith = (argv: ReadonlyArray<string>) => ({
  [DelegateTaskCheck.DELEGATE_TASK_CHECK_ENV]: JSON.stringify(argv),
});
const configured = configuredWith(verifier);

const encodeRejected = Schema.encodeSync(DelegateTaskCheck.DelegateTaskCheckRejected);
const isProcessSpawnError = Schema.is(ProcessRunner.ProcessSpawnError);

const assertRefusedWithoutLeak = (
  rejected: DelegateTaskCheck.DelegateTaskCheckRejected,
  sentinel: string,
) => {
  assert.equal(rejected.category, "refused");
  const visible = [
    rejected.message,
    JSON.stringify({ ...encodeRejected(rejected), cause: undefined }),
  ];
  for (const text of visible) {
    assert.notInclude(text, sentinel);
    assert.notInclude(text, leakedUrl);
  }
  assert.include(JSON.stringify(rejected.cause), sentinel);
};

describe("DelegateTaskCheck", () => {
  it.effect("leaves delegation unchanged when no verifier is configured", () =>
    Effect.gen(function* () {
      const rejected = yield* check({}, { ...request, task: "any prose" });
      assert.isTrue(rejected._tag === "None");
    }),
  );

  it.effect("admits only what the verifier accepts and keeps its stderr out of the message", () =>
    Effect.gen(function* () {
      assert.isTrue((yield* check(configured, request))._tag === "None");
      // The MCP input schema trims a trailing newline before this check; the verifier itself refuses it.
      for (const task of ["generated\n", "Note: generated", "edited"]) {
        const rejected = yield* check(configured, { ...request, task });
        assert.isTrue(rejected._tag === "Some");
        if (rejected._tag === "Some") {
          assertRefusedWithoutLeak(rejected.value, "SENTINEL_STDERR");
        }
      }
      const wrongProvider = yield* check(configured, { ...request, driver: "codex" });
      assert.isTrue(wrongProvider._tag === "Some");
    }),
  );

  it.effect("keeps a refusing verifier's stdout out of the message", () =>
    Effect.gen(function* () {
      const rejected = yield* check(configuredWith(stdoutVerifier), request);
      assert.isTrue(rejected._tag === "Some");
      if (rejected._tag === "Some") {
        assertRefusedWithoutLeak(rejected.value, "SENTINEL_STDOUT");
      }
    }),
  );

  it.effect("refuses when the verifier is misconfigured or cannot run", () =>
    Effect.gen(function* () {
      for (const value of ["not json", "[]"]) {
        const rejected = yield* check(
          { [DelegateTaskCheck.DELEGATE_TASK_CHECK_ENV]: value },
          request,
        );
        assert.isTrue(rejected._tag === "Some", value);
        if (rejected._tag === "Some") {
          assert.equal(rejected.value.category, "misconfigured");
          assert.isUndefined(rejected.value.cause);
        }
      }
      const missing = yield* check(configuredWith(["t3-missing-verifier-binary"]), request);
      assert.isTrue(missing._tag === "Some");
      if (missing._tag === "Some") {
        assert.equal(missing.value.category, "failed_to_run");
        assert.isTrue(isProcessSpawnError(missing.value.cause));
        assert.notInclude(missing.value.message, "t3-missing-verifier-binary");
      }
    }),
  );

  it.effect("refuses when a verifier is configured but the host did not provide the check", () =>
    Effect.gen(function* () {
      const unprovided = (env: Record<string, string>) =>
        DelegateTaskCheck.fromContext.pipe(
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        );
      assert.isTrue((yield* unprovided({}))._tag === "None");
      const resolved = yield* unprovided(configured);
      assert.isTrue(resolved._tag === "Some");
      if (resolved._tag === "Some") {
        const rejected = yield* resolved.value.check(request).pipe(Effect.flip);
        assert.equal(rejected.category, "unavailable");
        assert.isUndefined(rejected.cause);
      }
    }),
  );
});
