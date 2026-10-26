// @effect-diagnostics nodeBuiltinImport:off - disposable repositories built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";

const layer = FactoryIntegrator.layer.pipe(
  Layer.provide(
    GitVcsDriver.layer.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-factory-integrator-" })),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
);

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=Worker", "-c", "user.email=worker@example.invalid", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const write = (cwd: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(cwd, file), text);

/** A project clone with an origin, and a reviewed head on a branch of it. */
const repository = Effect.acquireRelease(
  Effect.sync(() => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-integrator-"));
    const origin = NodePath.join(root, "origin.git");
    const cwd = NodePath.join(root, "project");
    git(root, "init", "--bare", "-b", "main", origin);
    git(root, "clone", origin, cwd);
    write(cwd, "a.txt", "one\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "base");
    git(cwd, "push", "origin", "HEAD:main");
    const base = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-b", "work");
    write(cwd, "b.txt", "reviewed\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "reviewed work");
    const head = git(cwd, "rev-parse", "HEAD");
    return { root, origin, cwd, base, head };
  }),
  ({ root }) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
);

const remoteMain = { branch: "main", remote: "origin" } as const;
const identity = { name: "T3 Factory", email: "factory@example.invalid" };
const message = (marker: string) => `Integrate reviewed work\n\nT3-Factory-Operation: ${marker}\n`;

it.live(
  "Integration/N16: a merge lands once and is read back by its marker after a lost answer",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = yield* repository;
        const integrator = yield* FactoryIntegrator.FactoryIntegrator;
        const marker = "op-merge-1";
        const applied = yield* integrator.apply({
          cwd: repo.cwd,
          target: remoteMain,
          expected: repo.base,
          reviewedHead: repo.head,
          mode: "merge",
          message: message(marker),
          identity,
        });
        assert.strictEqual(applied.type, "applied");
        if (applied.type !== "applied") return;
        assert.deepStrictEqual(applied.parents, [repo.base, repo.head]);
        assert.strictEqual(git(repo.origin, "rev-parse", "main"), applied.commit);
        assert.strictEqual(
          git(repo.origin, "log", "-1", "--format=%an <%ae>", "main"),
          "T3 Factory <factory@example.invalid>",
        );
        // The answer is lost: the readback finds the same commit, and a retry writes nothing.
        const found = yield* integrator.landed({
          cwd: repo.cwd,
          target: remoteMain,
          marker,
          reviewedHead: repo.head,
        });
        assert.deepStrictEqual(Option.getOrUndefined(found), {
          commit: applied.commit,
          parents: applied.parents,
          tree: applied.tree,
          attribution: "operation",
        });
        const retried = yield* integrator.apply({
          cwd: repo.cwd,
          target: remoteMain,
          expected: repo.base,
          reviewedHead: repo.head,
          mode: "merge",
          message: message(marker),
          identity,
        });
        assert.deepStrictEqual(retried, { type: "moved", tip: applied.commit });
        assert.strictEqual(git(repo.origin, "rev-list", "--count", "main"), "3");
      }),
    ).pipe(Effect.provide(layer)),
);

it.live("Integration/N17: a moved target or a conflict writes nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = yield* repository;
      const integrator = yield* FactoryIntegrator.FactoryIntegrator;
      // Someone lands a conflicting change on main after the integration was decided.
      git(repo.cwd, "checkout", "-b", "other", repo.base);
      write(repo.cwd, "b.txt", "competing\n");
      git(repo.cwd, "add", ".");
      git(repo.cwd, "commit", "-m", "competing");
      git(repo.cwd, "push", "origin", "HEAD:main");
      const moved = git(repo.cwd, "rev-parse", "HEAD");
      const stale = yield* integrator.apply({
        cwd: repo.cwd,
        target: remoteMain,
        expected: repo.base,
        reviewedHead: repo.head,
        mode: "merge",
        message: message("op-stale"),
        identity,
      });
      assert.deepStrictEqual(stale, { type: "moved", tip: moved });
      const conflicted = yield* integrator.apply({
        cwd: repo.cwd,
        target: remoteMain,
        expected: moved,
        reviewedHead: repo.head,
        mode: "merge",
        message: message("op-conflict"),
        identity,
      });
      assert.strictEqual(conflicted.type, "conflict");
      assert.strictEqual(git(repo.origin, "rev-parse", "main"), moved);
      assert.isTrue(
        Option.isNone(
          yield* integrator.landed({
            cwd: repo.cwd,
            target: remoteMain,
            marker: "op-conflict",
            reviewedHead: repo.head,
          }),
        ),
      );
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("Integration: local targets move only by compare-and-set, never under a checkout", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = yield* repository;
      const integrator = yield* FactoryIntegrator.FactoryIntegrator;
      // `work` is checked out in the project: its branch is never moved under it.
      assert.deepStrictEqual(
        yield* integrator.apply({
          cwd: repo.cwd,
          target: { branch: "work", remote: null },
          expected: repo.head,
          reviewedHead: repo.head,
          mode: "fast_forward",
          message: message("op-checked-out"),
          identity,
        }),
        { type: "target_checked_out" },
      );
      git(repo.cwd, "branch", "integration", repo.base);
      const local = { branch: "integration", remote: null } as const;
      const forwarded = yield* integrator.apply({
        cwd: repo.cwd,
        target: local,
        expected: repo.base,
        reviewedHead: repo.head,
        mode: "fast_forward",
        message: message("op-ff"),
        identity,
      });
      assert.strictEqual(
        forwarded.type === "applied" ? forwarded.commit : forwarded.type,
        repo.head,
      );
      assert.strictEqual(git(repo.cwd, "rev-parse", "integration"), repo.head);
      // A head that does not descend from the target is not fast-forwarded.
      git(repo.cwd, "branch", "integration-2", repo.base);
      git(repo.cwd, "checkout", "-b", "side", repo.base);
      write(repo.cwd, "c.txt", "side\n");
      git(repo.cwd, "add", ".");
      git(repo.cwd, "commit", "-m", "side");
      const side = git(repo.cwd, "rev-parse", "HEAD");
      git(repo.cwd, "checkout", "work");
      git(repo.cwd, "branch", "-f", "integration-2", side);
      assert.deepStrictEqual(
        yield* integrator.apply({
          cwd: repo.cwd,
          target: { branch: "integration-2", remote: null },
          expected: side,
          reviewedHead: repo.head,
          mode: "fast_forward",
          message: message("op-not-ff"),
          identity,
        }),
        { type: "not_fast_forward" },
      );
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("Integration: a reviewed head someone else already landed is external, not ours", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = yield* repository;
      const integrator = yield* FactoryIntegrator.FactoryIntegrator;
      git(repo.cwd, "checkout", "-b", "manual", repo.base);
      git(repo.cwd, "merge", "--no-ff", "-m", "manual merge", repo.head);
      git(repo.cwd, "push", "origin", "HEAD:main");
      const found = yield* integrator.landed({
        cwd: repo.cwd,
        target: remoteMain,
        marker: "op-never-written",
        reviewedHead: repo.head,
      });
      assert.strictEqual(Option.getOrUndefined(found)?.attribution, "external");
    }),
  ).pipe(Effect.provide(layer)),
);

it.live(
  "PR integration: a pull request's head branch is created or fast-forwarded, never overwritten",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = yield* repository;
        const integrator = yield* FactoryIntegrator.FactoryIntegrator;
        const branch = { remote: "origin", branch: "beta/12-parse-dates" } as const;
        assert.deepStrictEqual(
          yield* integrator.publish({ cwd: repo.cwd, ...branch, commit: repo.base }),
          {
            type: "published",
          },
        );
        // Publishing the same commit again changes nothing; a descendant moves it forward.
        assert.deepStrictEqual(
          yield* integrator.publish({ cwd: repo.cwd, ...branch, commit: repo.base }),
          {
            type: "published",
          },
        );
        assert.deepStrictEqual(
          yield* integrator.publish({ cwd: repo.cwd, ...branch, commit: repo.head }),
          {
            type: "published",
          },
        );
        assert.strictEqual(git(repo.origin, "rev-parse", branch.branch), repo.head);
        // A head that does not descend from what the branch holds is refused, and the branch kept.
        git(repo.cwd, "checkout", "-b", "rebased", repo.base);
        write(repo.cwd, "b.txt", "rebased\n");
        git(repo.cwd, "add", ".");
        git(repo.cwd, "commit", "-m", "rebased work");
        const rebased = git(repo.cwd, "rev-parse", "HEAD");
        assert.deepStrictEqual(
          yield* integrator.publish({ cwd: repo.cwd, ...branch, commit: rebased }),
          {
            type: "diverged",
            tip: repo.head,
          },
        );
        assert.strictEqual(git(repo.origin, "rev-parse", branch.branch), repo.head);
      }),
    ).pipe(Effect.provide(layer)),
);
