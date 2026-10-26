// @effect-diagnostics nodeBuiltinImport:off - the controls run real disposable processes.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as ExecutionContainment from "./ExecutionContainment.ts";
import {
  makeMilestones,
  memberFixture,
  spawnOwned,
  testHelperCache,
  windowsDir,
} from "./testMilestones.ts";

const containment = ExecutionContainment.makeWindows({ cacheDir: testHelperCache, windowsDir });
const freshName = () => `Local\\t3-custody-test-${NodeCrypto.randomUUID()}`;

/** Starts `member.fixture.ts` through a join of `name`, and assigns it. */
const joinMember = (
  shape: ExecutionContainment.ExecutionContainmentShape,
  holder: ExecutionContainment.ContainmentHolder,
  args: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const join = yield* shape.joinCommand(holder.name, process.execPath, [memberFixture, ...args]);
    const owned = yield* spawnOwned(join.command, join.args);
    yield* holder.assign(owned.child.pid!);
    return owned;
  });

// Job objects are the Windows mechanism; elsewhere containment is unavailable by design.
describe.runIf(HostProcess.Platform.defaultValue() === "win32")(
  "ExecutionContainment on Windows",
  () => {
    it.live(
      "Custody/A1: a descendant whose intermediate parent ended stays counted until the holder closes",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const shape = yield* containment;
            const milestones = yield* makeMilestones;
            const holder = yield* Effect.acquireRelease(
              shape.hold(freshName()),
              (held) => held.close,
            );
            // root starts middle, which starts leaf and then ends.
            yield* joinMember(shape, holder, [
              String(milestones.port),
              "root",
              "--spawn",
              "middle!",
              "--spawn",
              "leaf",
            ]);
            yield* milestones.arrived("root");
            yield* milestones.arrived("leaf");
            yield* milestones.ended("middle");
            // Nothing links leaf to root any more but the container. (The console host Windows
            // attaches to the join is a member too, so counts are lower bounds.)
            assert.isAtLeast(yield* holder.count, 3);
            assert.strictEqual((yield* shape.probe(holder.name)).type, "active");

            yield* holder.close;
            yield* milestones.ended("root");
            yield* milestones.ended("leaf");
            assert.deepInclude(yield* shape.probe(holder.name), { type: "absent" });
          }),
        ),
    );

    it.live("Custody/A1: when a join's command ends, everything it started ends with it", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const shape = yield* containment;
          const milestones = yield* makeMilestones;
          const holder = yield* Effect.acquireRelease(
            shape.hold(freshName()),
            (held) => held.close,
          );
          const root = yield* joinMember(shape, holder, [
            String(milestones.port),
            "root",
            "--spawn",
            "leaf",
            "--stdin-exit",
          ]);
          yield* milestones.arrived("leaf");
          // The command ends normally; its join follows, and with it what the command started.
          root.child.stdin.end();
          yield* milestones.ended("root");
          yield* root.exited;
          // The holder is still open: only the join's own end ended the leaf.
          yield* milestones.ended("leaf");
        }),
      ),
    );

    it.live("Custody/A1: losing the holder ends every member with it", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const shape = yield* containment;
          const milestones = yield* makeMilestones;
          const holder = yield* Effect.acquireRelease(
            shape.hold(freshName()),
            (held) => held.close,
          );
          yield* joinMember(shape, holder, [String(milestones.port), "member", "--spawn", "child"]);
          yield* milestones.arrived("member");
          yield* milestones.arrived("child");
          assert.isAtLeast(yield* holder.count, 3);
          // The holder\'s own captured pid: the owner of the container disappears.
          process.kill(holder.pid);
          yield* holder.exited;
          yield* milestones.ended("member");
          yield* milestones.ended("child");
          assert.deepInclude(yield* shape.probe(holder.name), { type: "absent" });
        }),
      ),
    );

    it.live("Custody/X4: a join its holder never assigned starts nothing", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const shape = yield* containment;
          const milestones = yield* makeMilestones;
          const holder = yield* shape.hold(freshName());
          yield* holder.close;
          const join = yield* shape.joinCommand(holder.name, process.execPath, [
            memberFixture,
            String(milestones.port),
            "member",
          ]);
          const owned = yield* spawnOwned(join.command, join.args);
          const refused = yield* Effect.exit(holder.assign(owned.child.pid!));
          assert.isTrue(refused._tag === "Failure");
          // The owner stops what it could not place; the target was never created.
          owned.child.kill();
          yield* owned.exited;
          assert.isFalse(yield* milestones.hasArrived("member"));
          assert.deepInclude(yield* shape.probe(holder.name), { type: "absent" });
        }),
      ),
    );

    it.live("Custody/X5: a name that already exists is not created again", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const shape = yield* containment;
          const holder = yield* Effect.acquireRelease(
            shape.hold(freshName()),
            (held) => held.close,
          );
          const again = yield* Effect.exit(shape.hold(holder.name));
          assert.isTrue(again._tag === "Failure");
          assert.deepInclude(yield* shape.probe(holder.name), { type: "active", members: 0 });
        }),
      ),
    );

    it.live("Custody/A9: without a compiler nothing is contained", () =>
      Effect.gen(function* () {
        const shape = yield* ExecutionContainment.makeWindows({
          cacheDir: `${testHelperCache}-missing-${NodeCrypto.randomUUID()}`,
          windowsDir: `${windowsDir}\\no-such-framework`,
        });
        const held = yield* Effect.exit(shape.hold(freshName()));
        assert.isTrue(held._tag === "Failure");
        assert.deepInclude(yield* shape.probe(freshName()), { type: "unreadable" });
      }),
    );
    // The live cache is `<state dir>/custody`, 131 characters on the host that first ran a
    // factory. The compiled helper's path must leave the .NET host room to resolve `<exe>.config`
    // within MAX_PATH: a 254-character temporary binary compiled cleanly and then exited -1.
    const deploymentLengthCache = () => {
      const base = `${testHelperCache}-deep-${NodeCrypto.randomUUID()}-`;
      return base + "x".repeat(Math.max(0, 131 - base.length));
    };

    it.live("Custody/A9: a helper built in a deployment-length cache runs", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const cacheDir = deploymentLengthCache();
          yield* Effect.addFinalizer(() =>
            Effect.promise(() => NodeFSP.rm(cacheDir, { recursive: true, force: true })),
          );
          const shape = yield* ExecutionContainment.makeWindows({ cacheDir, windowsDir });
          const identity = yield* shape.identity;
          assert.isNotEmpty(identity.machine);
          const holder = yield* Effect.acquireRelease(
            shape.hold(freshName()),
            (held) => held.close,
          );
          assert.deepInclude(yield* shape.probe(holder.name), { type: "active", members: 0 });
          yield* holder.close;
          assert.deepInclude(yield* shape.probe(holder.name), { type: "absent" });
        }),
      ),
    );

    it.live("Custody/A9: a cache too deep for the host is refused before compiling, by name", () =>
      Effect.gen(function* () {
        // One character past the deepest final path the host runs.
        const cacheDir = `${testHelperCache}-too-deep-${NodeCrypto.randomUUID()}-`.padEnd(
          253 - 1 - "t3-custody-".length - 64 - ".exe".length,
          "x",
        );
        const shape = yield* ExecutionContainment.makeWindows({ cacheDir, windowsDir });
        const failed = yield* Effect.flip(shape.identity);
        assert.include(failed.reason, cacheDir);
        assert.include(failed.reason, "253");
        assert.notInclude(failed.reason, "did not compile");
        assert.isFalse(
          yield* Effect.promise(() =>
            NodeFSP.access(cacheDir).then(
              () => true,
              () => false,
            ),
          ),
        );
      }),
    );

    it.live(
      "Custody/A9: a compiler that appears later is used; the first failure is not kept",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const cacheDir = `${testHelperCache}-late-${NodeCrypto.randomUUID()}`;
            const lateWindowsDir = `${testHelperCache}-windows-${NodeCrypto.randomUUID()}`;
            yield* Effect.promise(() => NodeFSP.mkdir(lateWindowsDir, { recursive: true }));
            yield* Effect.addFinalizer(() =>
              Effect.promise(async () => {
                // The junction is removed as a link; its target is the real framework directory.
                await NodeFSP.rm(NodePath.join(lateWindowsDir, "Microsoft.NET"), { force: true });
                await NodeFSP.rm(lateWindowsDir, { recursive: true, force: true });
                await NodeFSP.rm(cacheDir, { recursive: true, force: true });
              }),
            );
            const shape = yield* ExecutionContainment.makeWindows({
              cacheDir,
              windowsDir: lateWindowsDir,
            });
            const before = yield* Effect.flip(shape.identity);
            assert.include(before.reason, "no compiler");
            yield* Effect.promise(() =>
              NodeFSP.symlink(
                NodePath.join(windowsDir, "Microsoft.NET"),
                NodePath.join(lateWindowsDir, "Microsoft.NET"),
                "junction",
              ),
            );
            assert.isNotEmpty((yield* shape.identity).machine);
          }),
        ),
    );
  },
);
