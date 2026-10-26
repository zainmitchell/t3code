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
  readonly parentsOf: (input: {
    readonly projectId: ProjectId;
    readonly commit: string;
  }) => Effect.Effect<ReadonlyArray<string>, FactoryGitReadbackError>;
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
      commitExists: (input) =>
        Effect.map(
          run("commitExists", input.projectId, ["cat-file", "-e", `${input.commit}^{commit}`]),
          (result) => result.exitCode === 0,
        ),
      isAncestor: (input) =>
        Effect.flatMap(
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
        ),
      parentsOf: (input) =>
        Effect.flatMap(
          run("parentsOf", input.projectId, ["rev-list", "--parents", "-n", "1", input.commit]),
          (result) =>
            result.exitCode === 0
              ? Effect.succeed(result.stdout.trim().split(/\s+/).slice(1))
              : Effect.fail(fail("parentsOf")(result.stderr)),
        ),
    });
  }),
);
