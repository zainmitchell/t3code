import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export class FactoryIntegratorError extends Schema.TaggedError<FactoryIntegratorError>()(
  "FactoryIntegratorError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Factory integration ${this.operation} failed.`;
  }
}

/** The branch an integration lands on: a remote's branch, or a local one when `remote` is null. */
export interface IntegrationTarget {
  readonly branch: string;
  readonly remote: string | null;
}

export interface IntegrationLanded {
  readonly commit: string;
  readonly parents: ReadonlyArray<string>;
  readonly tree: string;
  /** `external`: the reviewed head reached the target without this integration's commit. */
  readonly attribution: "operation" | "external";
}

export type IntegrationApplyResult =
  | ({ readonly type: "applied" } & Omit<IntegrationLanded, "attribution">)
  /** The target is not where the integration was decided; nothing was written. */
  | { readonly type: "moved"; readonly tip: string | null }
  | { readonly type: "conflict"; readonly detail: string }
  | { readonly type: "not_fast_forward" }
  /** A local target branch checked out in a worktree is never moved under it. */
  | { readonly type: "target_checked_out" };

/**
 * The Git side of integration. Every write is a compare-and-set on the target branch from the
 * exact tip the integration was decided on, and every merge commit carries the operation's
 * marker, so a crash after a write is found by reading the target back, never repeated.
 */
export interface FactoryIntegratorShape {
  /**
   * Puts a reviewed head on a remote branch for its pull request: creates the branch or
   * fast-forwards it, never overwrites it. `diverged` leaves the branch as someone made it.
   */
  readonly publish: (input: {
    readonly cwd: string;
    readonly remote: string;
    readonly branch: string;
    readonly commit: string;
  }) => Effect.Effect<
    { readonly type: "published" } | { readonly type: "diverged"; readonly tip: string },
    FactoryIntegratorError
  >;
  readonly tip: (input: {
    readonly cwd: string;
    readonly target: IntegrationTarget;
  }) => Effect.Effect<string | null, FactoryIntegratorError>;
  readonly landed: (input: {
    readonly cwd: string;
    readonly target: IntegrationTarget;
    readonly marker: string;
    readonly reviewedHead: string;
  }) => Effect.Effect<Option.Option<IntegrationLanded>, FactoryIntegratorError>;
  readonly apply: (input: {
    readonly cwd: string;
    readonly target: IntegrationTarget;
    readonly expected: string;
    readonly reviewedHead: string;
    readonly mode: "merge" | "fast_forward";
    readonly message: string;
    readonly identity: { readonly name: string; readonly email: string };
  }) => Effect.Effect<IntegrationApplyResult, FactoryIntegratorError>;
}

const noIntegrator = (operation: string) =>
  Effect.fail(new FactoryIntegratorError({ operation, cause: "No integrator is configured." }));

/**
 * The Git side of integration the server gives the runtime. A runtime without one lands
 * nothing: every integration stays intended.
 */
export const FactoryIntegrator = Context.Reference<FactoryIntegratorShape>(
  "t3/factory/FactoryIntegrator",
  {
    defaultValue: () => ({
      publish: () => noIntegrator("publish"),
      tip: () => noIntegrator("tip"),
      landed: () => noIntegrator("landed"),
      apply: () => noIntegrator("apply"),
    }),
  },
);

const HISTORY_SCAN = 200;

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: { readonly stdin?: string; readonly env?: NodeJS.ProcessEnv } = {},
  ) =>
    git
      .execute({
        operation: `FactoryIntegrator.${operation}`,
        cwd,
        args,
        allowNonZeroExit: true,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        ...(options.env === undefined ? {} : { env: options.env }),
      })
      .pipe(Effect.mapError((cause) => new FactoryIntegratorError({ operation, cause })));
  const must = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    Effect.flatMap(run(operation, cwd, args), (result) =>
      result.exitCode === 0
        ? Effect.succeed(result.stdout.trim())
        : Effect.fail(new FactoryIntegratorError({ operation, cause: result.stderr })),
    );

  const localRef = (branch: string) => `refs/heads/${branch}`;
  // A remote target's history is read through a private ref, never the user's tracking refs.
  const readRef = (target: IntegrationTarget) =>
    target.remote === null
      ? localRef(target.branch)
      : `refs/t3-factory/integration/${target.remote}/${target.branch}`;

  const tip = Effect.fn("FactoryIntegrator.tip")(function* (input: {
    readonly cwd: string;
    readonly target: IntegrationTarget;
  }) {
    const { cwd, target } = input;
    if (target.remote === null) {
      const result = yield* run("tip", cwd, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${localRef(target.branch)}^{commit}`,
      ]);
      return result.exitCode === 0 ? result.stdout.trim() : null;
    }
    const listed = yield* must("tip", cwd, [
      "ls-remote",
      "--heads",
      target.remote,
      localRef(target.branch),
    ]);
    return listed === "" ? null : listed.split(/\s+/)[0]!;
  });

  const fetchTarget = (cwd: string, target: IntegrationTarget) =>
    target.remote === null
      ? Effect.void
      : must("fetch", cwd, [
          "fetch",
          "--no-tags",
          "--quiet",
          target.remote,
          `+${localRef(target.branch)}:${readRef(target)}`,
        ]).pipe(Effect.asVoid);

  const describe = (cwd: string, commit: string) =>
    Effect.map(must("describe", cwd, ["rev-list", "--parents", "-n", "1", commit]), (line) => ({
      parents: line.split(/\s+/).slice(1),
    })).pipe(
      Effect.flatMap(({ parents }) =>
        Effect.map(must("describe", cwd, ["rev-parse", `${commit}^{tree}`]), (tree) => ({
          commit,
          parents,
          tree,
        })),
      ),
    );

  const isAncestor = (cwd: string, ancestor: string, descendant: string) =>
    Effect.flatMap(
      run("is-ancestor", cwd, ["merge-base", "--is-ancestor", ancestor, descendant]),
      (result) =>
        result.exitCode === 0
          ? Effect.succeed(true)
          : result.exitCode === 1
            ? Effect.succeed(false)
            : Effect.fail(
                new FactoryIntegratorError({ operation: "is-ancestor", cause: result.stderr }),
              ),
    );

  const landed = Effect.fn("FactoryIntegrator.landed")(function* (input: {
    readonly cwd: string;
    readonly target: IntegrationTarget;
    readonly marker: string;
    readonly reviewedHead: string;
  }) {
    const { cwd, target } = input;
    if ((yield* tip({ cwd, target })) === null) return Option.none<IntegrationLanded>();
    yield* fetchTarget(cwd, target);
    const ref = readRef(target);
    const log = yield* must("landed", cwd, [
      "log",
      "--first-parent",
      `-n${HISTORY_SCAN}`,
      "--format=%H%x1f%B%x1e",
      ref,
    ]);
    for (const entry of log.split("\u001e")) {
      const [commit, body] = entry.trim().split("\u001f");
      if (commit !== undefined && body?.includes(input.marker) === true) {
        return Option.some<IntegrationLanded>({
          ...(yield* describe(cwd, commit)),
          attribution: "operation",
        });
      }
    }
    if (!(yield* isAncestor(cwd, input.reviewedHead, ref))) {
      return Option.none<IntegrationLanded>();
    }
    const current = yield* must("landed", cwd, ["rev-parse", ref]);
    // A fast-forward leaves no commit of its own: the target at exactly the reviewed head is it.
    return Option.some<IntegrationLanded>({
      ...(yield* describe(cwd, input.reviewedHead)),
      attribution: current === input.reviewedHead ? "operation" : "external",
    });
  });

  const checkedOut = Effect.fn("FactoryIntegrator.checkedOut")(function* (
    cwd: string,
    branch: string,
  ) {
    const listed = yield* must("worktrees", cwd, ["worktree", "list", "--porcelain"]);
    return listed.split(/\r?\n/).some((line) => line.trim() === `branch ${localRef(branch)}`);
  });

  const apply = Effect.fn("FactoryIntegrator.apply")(function* (input: {
    readonly cwd: string;
    readonly target: IntegrationTarget;
    readonly expected: string;
    readonly reviewedHead: string;
    readonly mode: "merge" | "fast_forward";
    readonly message: string;
    readonly identity: { readonly name: string; readonly email: string };
  }) {
    const { cwd, target, expected } = input;
    if (target.remote === null && (yield* checkedOut(cwd, target.branch))) {
      return { type: "target_checked_out" } as const;
    }
    const current = yield* tip({ cwd, target });
    if (current !== expected) return { type: "moved", tip: current } as const;
    let commit: string;
    if (input.mode === "fast_forward") {
      if (!(yield* isAncestor(cwd, expected, input.reviewedHead))) {
        return { type: "not_fast_forward" } as const;
      }
      commit = input.reviewedHead;
    } else {
      const merged = yield* run("merge-tree", cwd, [
        "merge-tree",
        "--write-tree",
        expected,
        input.reviewedHead,
      ]);
      if (merged.exitCode === 1) {
        return { type: "conflict", detail: merged.stdout.trim().slice(0, 4_000) } as const;
      }
      if (merged.exitCode !== 0) {
        return yield* new FactoryIntegratorError({ operation: "merge-tree", cause: merged.stderr });
      }
      const tree = merged.stdout.trim().split(/\r?\n/)[0]!;
      const env = {
        GIT_AUTHOR_NAME: input.identity.name,
        GIT_AUTHOR_EMAIL: input.identity.email,
        GIT_COMMITTER_NAME: input.identity.name,
        GIT_COMMITTER_EMAIL: input.identity.email,
      };
      const created = yield* run(
        "commit-tree",
        cwd,
        ["commit-tree", tree, "-p", expected, "-p", input.reviewedHead, "-F", "-"],
        { stdin: input.message, env },
      );
      if (created.exitCode !== 0) {
        return yield* new FactoryIntegratorError({
          operation: "commit-tree",
          cause: created.stderr,
        });
      }
      commit = created.stdout.trim();
    }
    const advanced =
      target.remote === null
        ? yield* run("update-ref", cwd, [
            "update-ref",
            "-m",
            "t3 factory integration",
            localRef(target.branch),
            commit,
            expected,
          ])
        : yield* run("push", cwd, [
            "push",
            "--porcelain",
            `--force-with-lease=${localRef(target.branch)}:${expected}`,
            target.remote,
            `${commit}:${localRef(target.branch)}`,
          ]);
    if (advanced.exitCode !== 0) {
      const after = yield* tip({ cwd, target });
      // Still where it was decided: nothing landed, and the write can be tried again.
      if (after === expected) {
        return yield* new FactoryIntegratorError({ operation: "advance", cause: advanced.stderr });
      }
      // A refused compare-and-set leaves the target as someone else made it.
      if (after !== commit) return { type: "moved", tip: after } as const;
    }
    return { type: "applied", ...(yield* describe(cwd, commit)) } as const;
  });

  const publish = Effect.fn("FactoryIntegrator.publish")(function* (input: {
    readonly cwd: string;
    readonly remote: string;
    readonly branch: string;
    readonly commit: string;
  }) {
    const { cwd, commit } = input;
    const target = { branch: input.branch, remote: input.remote };
    const current = yield* tip({ cwd, target });
    if (current === commit) return { type: "published" } as const;
    if (current !== null) {
      // Every ancestor of the reviewed head is local; a tip we do not have is someone else's.
      const known = yield* run("publish", cwd, ["cat-file", "-e", `${current}^{commit}`]);
      if (known.exitCode !== 0 || !(yield* isAncestor(cwd, current, commit))) {
        return { type: "diverged", tip: current } as const;
      }
    }
    // A plain push: the remote itself refuses anything but a create or a fast-forward.
    const pushed = yield* run("publish", cwd, [
      "push",
      "--porcelain",
      input.remote,
      `${commit}:${localRef(input.branch)}`,
    ]);
    if (pushed.exitCode === 0) return { type: "published" } as const;
    const after = yield* tip({ cwd, target });
    if (after === commit) return { type: "published" } as const;
    if (after === current) {
      return yield* new FactoryIntegratorError({ operation: "publish", cause: pushed.stderr });
    }
    return after === null
      ? yield* new FactoryIntegratorError({ operation: "publish", cause: pushed.stderr })
      : ({ type: "diverged", tip: after } as const);
  });

  return FactoryIntegrator.of({ publish, tip, landed, apply });
});

export const layer = Layer.effect(FactoryIntegrator, make);
