// @effect-diagnostics nodeBuiltinImport:off - building is simulated; no compiler or helper runs.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import * as ExecutionContainment from "./ExecutionContainment.ts";

const commands = vi.hoisted(() => ({
  run: vi.fn<
    (
      file: string,
      args: ReadonlyArray<string>,
      options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => { exitCode: number; kill: () => void }
  >(),
}));

vi.mock("node:child_process", () => ({ execFile: commands.run }));

/**
 * A temporary Windows directory whose "compiler" writes a text file answering `version <key>`, so
 * the production build, verification and publication run without any process starting.
 */
const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-build-"));
    const windowsDir = NodePath.join(root, "windows");
    const compiler = NodePath.join(
      windowsDir,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    );
    const builds: Array<string> = [];
    commands.run.mockReset();
    commands.run.mockImplementation((file, args, _options, callback) => {
      const answer = async () => {
        if (file === compiler) {
          const output = args.find((arg) => arg.startsWith("-out:"))?.slice(5);
          const source = args.at(-1);
          if (output === undefined || source === undefined) throw new Error("bad compiler call");
          const key = /const string Key = "([a-f0-9]{64})";/.exec(
            await NodeFSP.readFile(source, "utf8"),
          )?.[1];
          if (key === undefined) throw new Error("source has no substituted key");
          await NodeFSP.writeFile(output, `version ${key}`);
          builds.push(output);
          return "";
        }
        const version = await NodeFSP.readFile(file, "utf8");
        if (args[0] === "version") return version;
        if (args[0] === "identity") return "identity build-fixture 1\n";
        throw new Error(`unexpected helper command ${args[0]}`);
      };
      void answer().then(
        (stdout) => callback(null, stdout),
        (cause: unknown) => callback(cause instanceof Error ? cause : new Error(String(cause)), ""),
      );
      return { exitCode: 0, kill: () => {} };
    });
    const installCompiler = async () => {
      await NodeFSP.mkdir(NodePath.dirname(compiler), { recursive: true });
      await NodeFSP.writeFile(compiler, "fake compiler bytes; never executed");
    };
    return { root, windowsDir, builds, installCompiler };
  }),
  ({ root }) =>
    Effect.promise(async () => {
      commands.run.mockReset();
      await NodeFSP.rm(root, { recursive: true, force: true });
    }),
);

it.effect("a fresh build in a deployment-length cache publishes its helper and reuses it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(test.installCompiler);
      const cacheDir = NodePath.join(test.root, "cache-").padEnd(131, "x");
      const shape = yield* ExecutionContainment.makeWindows({
        cacheDir,
        windowsDir: test.windowsDir,
      });
      assert.strictEqual((yield* shape.identity).machine, "build-fixture");
      const join = yield* shape.joinCommand("unused", "unused", []);
      assert.lengthOf(test.builds, 1);
      assert.isAtMost(test.builds[0]!.length, 252);
      assert.isBelow(test.builds[0]!.length, join.command.length);
      assert.deepEqual(yield* Effect.promise(() => NodeFSP.readdir(cacheDir)), [
        NodePath.basename(join.command),
      ]);
      const again = yield* ExecutionContainment.makeWindows({
        cacheDir,
        windowsDir: test.windowsDir,
      });
      assert.strictEqual((yield* again.identity).machine, "build-fixture");
      assert.lengthOf(test.builds, 1);
    }),
  ),
);

it.effect("a compiler that appears later is used; the first failure is not kept", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const test = yield* fixture;
      const shape = yield* ExecutionContainment.makeWindows({
        cacheDir: NodePath.join(test.root, "cache"),
        windowsDir: test.windowsDir,
      });
      assert.include((yield* Effect.flip(shape.identity)).reason, "no compiler");
      assert.lengthOf(test.builds, 0);
      yield* Effect.promise(test.installCompiler);
      assert.strictEqual((yield* shape.identity).machine, "build-fixture");
      assert.lengthOf(test.builds, 1);
    }),
  ),
);
