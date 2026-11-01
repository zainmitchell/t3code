// @effect-diagnostics nodeBuiltinImport:off - a pinned object is named by its sha256.
import * as NodeCrypto from "node:crypto";

import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export class FactoryGitReadbackError extends Schema.TaggedError<FactoryGitReadbackError>()(
  "FactoryGitReadbackError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory Git readback ${this.operation} failed.`;
  }
}

/**
 * What the factory reads back from a project's repository before it accepts an outcome. Reads
 * only; an answer it cannot get is an error, never a "no".
 */
export interface FactoryGitReadbackShape {
  readonly commitExists: (input: {
    readonly projectId: ProjectId;
    readonly commit: string;
  }) => Effect.Effect<boolean, FactoryGitReadbackError>;
  readonly isAncestor: (input: {
    readonly projectId: ProjectId;
    readonly ancestor: string;
    readonly descendant: string;
  }) => Effect.Effect<boolean, FactoryGitReadbackError>;
  readonly branchExists: (input: {
    readonly projectId: ProjectId;
    readonly branch: string;
  }) => Effect.Effect<boolean, FactoryGitReadbackError>;
  /** Each path at the commit (resolved to its full id): a regular text file's sha256, or why it is not one. */
  readonly objectsAt: (input: {
    readonly projectId: ProjectId;
    readonly commit: string;
    readonly paths: ReadonlyArray<string>;
  }) => Effect.Effect<
    {
      readonly commit: string;
      readonly tree: string;
      readonly objects: ReadonlyArray<FactoryGitObject>;
    },
    FactoryGitReadbackError
  >;
}

/**
 * One path at a commit. Only a regular file whose bytes read back whole as text is a `blob`; a link,
 * submodule, directory, binary or missing path is never hashed.
 */
export interface FactoryGitObject {
  readonly path: string;
  readonly kind: "blob" | "missing" | "link" | "other";
  readonly sha256?: string;
}

export class FactoryGitReadback extends Context.Service<
  FactoryGitReadback,
  FactoryGitReadbackShape
>()("t3/factory/FactoryGitReadback") {}

export const layer = Layer.effect(
  FactoryGitReadback,
  Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    const projects = yield* ProjectService.ProjectService;
    const fail = (operation: string) => (cause: unknown) =>
      new FactoryGitReadbackError({ operation, cause });
    const rootOf = (projectId: ProjectId) =>
      projects.getById(projectId).pipe(
        Effect.mapError(fail("resolve-project")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(fail("resolve-project")("The project no longer exists.")),
            onSome: (project) => Effect.succeed(project.workspaceRoot),
          }),
        ),
      );
    const run = (operation: string, projectId: ProjectId, args: ReadonlyArray<string>) =>
      Effect.flatMap(rootOf(projectId), (cwd) =>
        git
          .execute({
            operation: `FactoryGitReadback.${operation}`,
            cwd,
            args,
            allowNonZeroExit: true,
          })
          .pipe(Effect.mapError(fail(operation))),
      );
    return FactoryGitReadback.of({
      commitExists: Effect.fn("FactoryGitReadback.commitExists")(function (input) {
        return Effect.flatMap(
          run("commitExists", input.projectId, [
            "rev-parse",
            "--verify",
            "--quiet",
            `${input.commit}^{commit}`,
          ]),
          (result) =>
            result.exitCode === 0
              ? Effect.succeed(true)
              : result.exitCode === 1
                ? Effect.succeed(false)
                : Effect.fail(fail("commitExists")(result.stderr)),
        );
      }),
      isAncestor: Effect.fn("FactoryGitReadback.isAncestor")(function (input) {
        return Effect.flatMap(
          run("isAncestor", input.projectId, [
            "merge-base",
            "--is-ancestor",
            input.ancestor,
            input.descendant,
          ]),
          (result) =>
            result.exitCode === 0
              ? Effect.succeed(true)
              : result.exitCode === 1
                ? Effect.succeed(false)
                : Effect.fail(fail("isAncestor")(result.stderr)),
        );
      }),
      objectsAt: Effect.fn("FactoryGitReadback.objectsAt")(function* (input) {
        const tree = yield* run("objectsAt", input.projectId, [
          "rev-parse",
          "--verify",
          "--quiet",
          `${input.commit}^{tree}`,
        ]);
        if (tree.exitCode !== 0) return yield* fail("objectsAt")(`no tree for ${input.commit}`);
        const resolved = yield* run("objectsAt", input.projectId, [
          "rev-parse",
          "--verify",
          "--quiet",
          `${input.commit}^{commit}`,
        ]);
        if (resolved.exitCode !== 0) return yield* fail("objectsAt")(`no commit ${input.commit}`);
        const listing = yield* run("objectsAt", input.projectId, [
          "ls-tree",
          "-z",
          "--full-tree",
          input.commit,
          "--",
          ...input.paths,
        ]);
        if (listing.exitCode !== 0 || listing.stdoutTruncated) {
          return yield* fail("objectsAt")(listing.stderr);
        }
        const entries = new Map<string, { mode: string; type: string; oid: string }>();
        for (const record of listing.stdout.split("\0")) {
          const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.+)$/s.exec(record);
          if (match !== null)
            entries.set(match[4]!, { mode: match[1]!, type: match[2]!, oid: match[3]! });
        }
        const objects: Array<FactoryGitObject> = [];
        for (const path of input.paths) {
          const entry = entries.get(path);
          if (entry === undefined) {
            objects.push({ path, kind: "missing" });
          } else if (entry.mode === "120000") {
            objects.push({ path, kind: "link" });
          } else if (
            entry.type !== "blob" ||
            (entry.mode !== "100644" && entry.mode !== "100755")
          ) {
            objects.push({ path, kind: "other" });
          } else {
            const blob = yield* run("objectsAt", input.projectId, ["cat-file", "blob", entry.oid]);
            // Text decoded from the bytes hashes back to them only when it decoded whole and cleanly.
            objects.push(
              blob.exitCode !== 0 ||
                blob.stdoutTruncated ||
                blob.stdout.includes("\0") ||
                blob.stdout.includes("�")
                ? { path, kind: "other" }
                : {
                    path,
                    kind: "blob",
                    sha256: NodeCrypto.createHash("sha256").update(blob.stdout).digest("hex"),
                  },
            );
          }
        }
        return { commit: resolved.stdout.trim(), tree: tree.stdout.trim(), objects };
      }),
      branchExists: Effect.fn("FactoryGitReadback.branchExists")(function (input) {
        return Effect.flatMap(
          run("branchExists", input.projectId, [
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${input.branch}`,
          ]),
          (result) =>
            result.exitCode === 0
              ? Effect.succeed(true)
              : result.exitCode === 1
                ? Effect.succeed(false)
                : Effect.fail(fail("branchExists")(result.stderr)),
        );
      }),
    });
  }),
);
