// @effect-diagnostics nodeBuiltinImport:off - disposable repositories built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryGitReadback from "./FactoryGitReadback.ts";

const projectId = ProjectId.make("project:factory-git-readback");

const layerReadback = (workspaceRoot: string) =>
  FactoryGitReadback.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) =>
          Effect.succeed(
            id === projectId
              ? Option.some({
                  id: projectId,
                  title: "Factory Git readback",
                  workspaceRoot,
                  repositoryIdentity: null,
                  faviconPath: null,
                  defaultModelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5.4",
                  },
                  defaultThreadEnvMode: null,
                  scripts: [],
                  createdAt: "2026-10-28T00:00:00.000Z",
                  updatedAt: "2026-10-28T00:00:00.000Z",
                  deletedAt: null,
                })
              : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      GitVcsDriver.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-factory-readback-" })),
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

/** A repository with two commits, whose base loose object is overwritten with non-zlib bytes. */
const damagedRepository = Effect.acquireRelease(
  Effect.sync(() => {
    const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-readback-"));
    git(cwd, "init", "-q", "-b", "main");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "base");
    const base = git(cwd, "rev-parse", "HEAD");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "head");
    const head = git(cwd, "rev-parse", "HEAD");
    const tree = git(cwd, "rev-parse", "HEAD^{tree}");
    const object = NodePath.join(cwd, ".git", "objects", base.slice(0, 2), base.slice(2));
    NodeFS.chmodSync(object, 0o666);
    NodeFS.writeFileSync(object, "not zlib");
    return { cwd, base, head, tree };
  }),
  ({ cwd }) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
);

it.live("commitExists tells a present commit from an absent, non-commit or unreadable one", () =>
  Effect.gen(function* () {
    const repository = yield* damagedRepository;
    yield* Effect.gen(function* () {
      const readback = yield* FactoryGitReadback.FactoryGitReadback;
      const exists = (commit: string) => readback.commitExists({ projectId, commit });

      assert.isTrue(yield* exists(repository.head));
      assert.isFalse(yield* exists("0123456789abcdef0123456789abcdef01234567"));
      assert.isFalse(yield* exists(repository.tree));

      const damaged = yield* exists(repository.base).pipe(
        Effect.match({
          onFailure: (error) => `${error._tag}:${error.operation}`,
          onSuccess: (found) => found,
        }),
      );
      assert.strictEqual(
        damaged,
        "FactoryGitReadbackError:commitExists",
        "an unreadable commit is an error, not a no",
      );
    }).pipe(Effect.provide(layerReadback(repository.cwd)));
  }).pipe(Effect.scoped),
);
