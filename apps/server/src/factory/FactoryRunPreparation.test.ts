// @effect-diagnostics nodeBuiltinImport:off - disposable repositories built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { FactoryWorkspaceHead } from "./FactoryRunPreparation.ts";

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=Worker", "-c", "user.email=worker@example.invalid", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

const fails = (cwd: string, ...args: ReadonlyArray<string>) => {
  try {
    git(cwd, ...args);
    return false;
  } catch {
    return true;
  }
};

const commitFile = (cwd: string, file: string, text: string, message: string) => {
  NodeFS.writeFileSync(NodePath.join(cwd, file), text);
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
};

/**
 * A host remote, a project clone taken before the landing, and the landing itself: a merge the
 * host made on `integration` (as a hosted pull request merge does), which the project never fetched.
 */
const landedOnHostOnly = Effect.acquireRelease(
  Effect.sync(() => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-landing-"));
    const origin = NodePath.join(root, "origin.git");
    const host = NodePath.join(root, "host");
    const project = NodePath.join(root, "project");
    git(root, "init", "--bare", "-b", "integration", origin);
    git(root, "clone", origin, host);
    const base = commitFile(host, "a.txt", "one\n", "base");
    git(host, "push", "origin", "HEAD:integration");
    git(root, "clone", origin, project);
    git(host, "checkout", "-b", "work");
    const reviewed = commitFile(host, "b.txt", "reviewed\n", "reviewed work");
    git(host, "checkout", "integration");
    commitFile(host, "c.txt", "beside\n", "beside the review");
    git(host, "merge", "--no-ff", "-m", "Merge pull request #1", "work");
    git(host, "push", "origin", "HEAD:integration");
    const landed = {
      commit: git(host, "rev-parse", "HEAD"),
      tree: git(host, "rev-parse", "HEAD^{tree}"),
      parents: git(host, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1),
    };
    return { root, origin, host, project, base, reviewed, landed };
  }),
  ({ root }) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
);

const integration = { remote: "origin", branch: "integration" } as const;

it.live(
  "Landing/L1: a landing only on the host is made local at exactly its commit, tree and parents, and a worktree is cut there",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = yield* landedOnHostOnly;
        const head = yield* FactoryWorkspaceHead;
        // The counterexample: the exact base a bound worktree needs is not an object here.
        assert.isTrue(fails(repo.project, "branch", "--no-track", "verify", repo.landed.commit));
        const found = yield* head.materializeLanded!({
          cwd: repo.project,
          ...integration,
          commit: repo.landed.commit,
        });
        assert.deepStrictEqual(found, { type: "available", object: repo.landed });
        // Read through the integrator's private ref; the user's tracking ref is left as it was.
        assert.strictEqual(
          git(repo.project, "rev-parse", "refs/t3-factory/integration/origin/integration"),
          repo.landed.commit,
        );
        assert.strictEqual(
          git(repo.project, "rev-parse", "refs/remotes/origin/integration"),
          repo.base,
        );
        const worktree = NodePath.join(repo.root, "verify");
        git(repo.project, "worktree", "add", "-b", "verify", worktree, repo.landed.commit);
        assert.deepStrictEqual(
          yield* head.read(worktree),
          Option.some({ commit: repo.landed.commit, tree: repo.landed.tree }),
        );
      }),
    ),
);

it.live("Landing/L2: a host head moved past the landing never stands in for it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = yield* landedOnHostOnly;
      const moved = commitFile(repo.host, "d.txt", "later\n", "a later landing");
      git(repo.host, "push", "origin", "HEAD:integration");
      const found = yield* (yield* FactoryWorkspaceHead).materializeLanded!({
        cwd: repo.project,
        ...integration,
        commit: repo.landed.commit,
      });
      assert.deepStrictEqual(found, { type: "available", object: repo.landed });
      assert.notStrictEqual(git(repo.project, "rev-parse", `${moved}^{tree}`), repo.landed.tree);
    }),
  ),
);

it.live(
  "Landing/L3: a landing already local is read without the host, however often and concurrently",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = yield* landedOnHostOnly;
        const head = yield* FactoryWorkspaceHead;
        const input = { cwd: repo.project, ...integration, commit: repo.landed.commit };
        const concurrent = yield* Effect.all(
          [head.materializeLanded!(input), head.materializeLanded!(input)],
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual(concurrent, [
          { type: "available", object: repo.landed },
          { type: "available", object: repo.landed },
        ]);
        // A restart with the host gone still finds what is already here.
        git(repo.project, "remote", "set-url", "origin", NodePath.join(repo.root, "gone.git"));
        assert.deepStrictEqual(yield* head.materializeLanded!(input), {
          type: "available",
          object: repo.landed,
        });
      }),
    ),
);

it.live("Landing/L4: a landing the host cannot give is refused, naming why", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = yield* landedOnHostOnly;
      const materialize = (yield* FactoryWorkspaceHead).materializeLanded!;
      const at = (input: { remote?: string | null; branch?: string; commit?: string }) =>
        materialize({ cwd: repo.project, ...integration, commit: repo.landed.commit, ...input });
      // Rewritten away on the host: its branch no longer carries the landing.
      git(repo.host, "push", "--force", "origin", `${repo.base}:refs/heads/integration`);
      assert.deepStrictEqual(yield* at({}), {
        type: "unavailable",
        detail: `landed commit ${repo.landed.commit} is not on origin/integration`,
      });
      assert.deepStrictEqual(yield* at({ remote: null }), {
        type: "unavailable",
        detail: `landed commit ${repo.landed.commit} is not in this repository`,
      });
      assert.deepStrictEqual(yield* at({ commit: repo.landed.commit.slice(0, 12) }), {
        type: "unavailable",
        detail: `${repo.landed.commit.slice(0, 12)} is not a full commit id`,
      });
      assert.deepStrictEqual(yield* at({ remote: "--upload-pack=x" }), {
        type: "unavailable",
        detail: "integration target --upload-pack=x/integration is not a fetchable ref",
      });
      git(repo.project, "remote", "set-url", "origin", NodePath.join(repo.root, "gone.git"));
      const unreachable = yield* at({});
      assert.strictEqual(unreachable.type, "unavailable");
      assert.match(
        unreachable.type === "unavailable" ? unreachable.detail : "",
        /^fetching origin\/integration failed: \S/,
      );
      // Nothing it refused became a base.
      assert.isTrue(fails(repo.project, "cat-file", "-e", `${repo.landed.commit}^{commit}`));
    }),
  ),
);
