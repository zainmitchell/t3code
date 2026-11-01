// @effect-diagnostics nodeBuiltinImport:off - disposable repositories built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { bindingLandingUnavailable, boundVerificationOf } from "./FactoryClaimService.ts";
import type { FactoryOperationIntent } from "./FactoryOperationStore.ts";
import { FactoryWorkspaceHead } from "./FactoryRunPreparation.ts";

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=Worker", "-c", "user.email=worker@example.invalid", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

const commitFile = (cwd: string, file: string, message: string) => {
  NodeFS.writeFileSync(NodePath.join(cwd, file), `${message}\n`);
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", message);
};

/** A project cloned before the host merged a reviewed head onto `integration`. */
const landedOnHostOnly = Effect.acquireRelease(
  Effect.sync(() => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-claim-landing-"));
    const origin = NodePath.join(root, "origin.git");
    const host = NodePath.join(root, "host");
    const project = NodePath.join(root, "project");
    git(root, "init", "--bare", "-b", "integration", origin);
    git(root, "clone", origin, host);
    commitFile(host, "a.txt", "base");
    git(host, "push", "origin", "HEAD:integration");
    git(root, "clone", origin, project);
    git(host, "checkout", "-b", "work");
    commitFile(host, "b.txt", "reviewed work");
    git(host, "checkout", "integration");
    git(host, "merge", "--no-ff", "-m", "Merge pull request #1", "work");
    git(host, "push", "origin", "HEAD:integration");
    const landed = {
      itemKey: "github:owner/repo#7",
      operationId: "integrate:7",
      commit: git(host, "rev-parse", "HEAD"),
      tree: git(host, "rev-parse", "HEAD^{tree}"),
      parents: git(host, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1),
      branch: "integration",
      reviewedHead: git(host, "rev-parse", "work"),
      reviewOutcomeId: "review-7",
      integratedOutcomeId: "integrated-7",
    };
    return { root, host, project, landed };
  }),
  ({ root }) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
);

const projectId = ProjectId.make("project-landing");

const pullRequestMerge = (landed: { reviewedHead: string }): FactoryOperationIntent => ({
  kind: "pull_request_merge",
  projectId,
  repository: "owner/repo",
  remote: "origin",
  base: "integration",
  head: "t3/review-7",
  reviewedHead: landed.reviewedHead,
  method: "merge",
  marker: "integrate:7",
  title: "Land #7",
  body: "",
});

const gitIntegrate = (landed: { reviewedHead: string }): FactoryOperationIntent => ({
  kind: "git_integrate",
  projectId,
  branch: "integration",
  remote: "origin",
  expected: landed.reviewedHead,
  reviewedHead: landed.reviewedHead,
  mode: "merge",
  marker: "integrate:7",
  message: "Land #7",
  identity: { name: "T3 Factory", email: "factory@example.invalid" },
});

const depsFor = (
  workspaceRoot: string,
  intent: FactoryOperationIntent | undefined,
  overrides: { readonly projects?: Option.Option<never> } = {},
) =>
  Effect.map(FactoryWorkspaceHead, (workspaceHead) => ({
    operations: {
      get: (operationId: string) =>
        Effect.succeed(
          intent !== undefined && operationId === "integrate:7"
            ? Option.some({ intent })
            : Option.none(),
        ),
    },
    projects:
      overrides.projects ??
      Option.some({
        getById: (id: ProjectId) =>
          Effect.succeed(id === projectId ? Option.some({ workspaceRoot }) : Option.none()),
      }),
    workspaceHead,
  }));

it.live.each([
  ["a hosted pull request merge", pullRequestMerge],
  ["a direct integration", gitIntegrate],
] as const)(
  "Landing/C1: %s's landing, only on the host, becomes the bound worktree's exact base",
  ([, intentFor]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = yield* landedOnHostOnly;
        // The host moves on after the landing; its new head substitutes for nothing.
        commitFile(repo.host, "c.txt", "a later landing");
        git(repo.host, "push", "origin", "HEAD:integration");
        const deps = yield* depsFor(repo.project, intentFor(repo.landed));
        assert.isUndefined(yield* bindingLandingUnavailable(deps, projectId, repo.landed));
        const worktree = NodePath.join(repo.root, "verify");
        git(repo.project, "worktree", "add", "-b", "verify", worktree, repo.landed.commit);
        assert.deepStrictEqual(
          yield* deps.workspaceHead.read(worktree),
          Option.some({ commit: repo.landed.commit, tree: repo.landed.tree }),
        );
        // A restart with the host gone reads the same base again, without it.
        git(repo.project, "remote", "set-url", "origin", NodePath.join(repo.root, "gone.git"));
        assert.isUndefined(yield* bindingLandingUnavailable(deps, projectId, repo.landed));
      }),
    ),
);

it.live("Landing/C2: a landing T3 cannot make the exact base refuses before any workspace", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = yield* landedOnHostOnly;
      const { landed } = repo;
      const deps = yield* depsFor(repo.project, pullRequestMerge(landed));
      const refusal = (
        overrides: Partial<typeof landed>,
        using: Effect.Success<ReturnType<typeof depsFor>> = deps,
      ) => bindingLandingUnavailable(using, projectId, { ...landed, ...overrides });
      const unreachable = yield* Effect.gen(function* () {
        git(repo.project, "remote", "set-url", "origin", NodePath.join(repo.root, "gone.git"));
        const reason = yield* refusal({});
        git(repo.project, "remote", "set-url", "origin", NodePath.join(repo.root, "origin.git"));
        return reason ?? "";
      });
      assert.match(
        unreachable,
        /^binding_landing_unavailable: fetching origin\/integration failed: /,
      );
      assert.strictEqual(
        yield* refusal({}, yield* depsFor(repo.project, undefined)),
        "binding_landing_unavailable: operation integrate:7 names no integration target",
      );
      assert.strictEqual(
        yield* refusal(
          {},
          yield* depsFor(repo.project, pullRequestMerge(landed), { projects: Option.none() }),
        ),
        "binding_landing_unavailable: its project is unreadable",
      );
      assert.strictEqual(
        yield* bindingLandingUnavailable(deps, ProjectId.make("project-gone"), landed),
        "binding_landing_unavailable: its project is unreadable",
      );
      // The object exists, but is not what the receipt says landed.
      assert.strictEqual(yield* refusal({ tree: landed.parents[0]! }), "binding_landing_mismatch");
      assert.strictEqual(
        yield* refusal({ parents: [...landed.parents].reverse() }),
        "binding_landing_mismatch",
      );
      assert.strictEqual(
        yield* refusal({ commit: landed.reviewedHead.slice(0, 12) }),
        `binding_landing_unavailable: ${landed.reviewedHead.slice(0, 12)} is not a full commit id`,
      );
    }),
  ),
);

it("reads a bound verification's binding by key, and refuses a binding it cannot read exactly", () => {
  const vb = "a".repeat(32);
  const out = "b".repeat(32);
  const ne = "c".repeat(32);
  const cases: ReadonlyArray<
    readonly [string | undefined, ReturnType<typeof boundVerificationOf>]
  > = [
    [undefined, undefined],
    ["rework:o1", undefined],
    ["rework:o1|res:ocr|exe:verifier", undefined],
    [`rework:o1|vb:${vb}|out:${out}`, { specOutcomeId: "o1", bindingDigest: vb }],
    // Resources, an execution choice and a no-edit unit sit before the binding.
    [
      `rework:o1|res:ocr,gpu|exe:verifier|ne:${ne}|vb:${vb}|out:${out}`,
      { specOutcomeId: "o1", bindingDigest: vb },
    ],
    [`rework:o1|exe:verifier|vb:${vb}|out:${out}`, { specOutcomeId: "o1", bindingDigest: vb }],
    // A rework run again after an environment failure binds the same spec.
    [
      `rework:o1:env:0123456789ab:${"d".repeat(32)}|vb:${vb}|out:${out}`,
      { specOutcomeId: "o1", bindingDigest: vb },
    ],
    [
      `rework:o1:env:0123456789ab:owner:${"e".repeat(16)}|vb:${vb}|out:${out}`,
      { specOutcomeId: "o1", bindingDigest: vb },
    ],
    [`rework:o1|vb:${vb}`, "malformed"],
    [`rework:o1|out:${out}`, "malformed"],
    [`rework:o1|vb:${vb}|vb:${vb}|out:${out}`, "malformed"],
    [`rework:o1|vb:${vb}|out:${out}|out:${out}`, "malformed"],
    [`rework:o1|out:${out}|vb:${vb}`, "malformed"],
    [`rework:o1|vb:${vb}|out:${out}|res:ocr`, "malformed"],
    [`rework:o1|vb:${vb.slice(1)}|out:${out}`, "malformed"],
    [`rework:o1|vb:${vb}|out:${"B".repeat(32)}`, "malformed"],
    [`implement:o1|vb:${vb}|out:${out}`, "malformed"],
    [`rework:|vb:${vb}|out:${out}`, "malformed"],
  ];
  for (const [basis, expected] of cases) {
    assert.deepStrictEqual(boundVerificationOf(basis), expected, basis);
  }
});
