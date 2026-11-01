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
