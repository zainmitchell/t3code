// @effect-diagnostics nodeBuiltinImport:off - a prepared worktree's checkout is read with git itself.
import * as NodeChildProcess from "node:child_process";

import type { CommandId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import type { JoinFor } from "@t3tools/shared/ExecutionJoin";

/**
 * The workspace preparation a claimed factory run uses: the existing launch service, narrowed to
 * what the claim handoff needs. A runtime without it (the minimal one tests and tools build)
 * prepares nothing, and says so before anything is authorized. Its production provision lives
 * with the launch service in the runtime layer, so custody can read this without importing it.
 */
export interface FactoryRunPreparationShape {
  readonly available: boolean;
  /**
   * Schedules the run's recorded workspace preparation for `ownerId`. The handle exists only when
   * this call reserved it, and reports how that preparation, and no other, ended.
   */
  readonly startOwned: (
    input: ThreadLaunchService.ThreadLaunchPreparationInput & {
      readonly ownerId: ThreadLaunchService.PreparationOwnerId;
      readonly join?: JoinFor;
    },
  ) => Effect.Effect<Option.Option<ThreadLaunchService.PreparationHandle>>;
  /** In-process only: none never proves that an earlier preparation stopped. */
  readonly currentOwner: (
    commandId: CommandId,
  ) => Effect.Effect<Option.Option<ThreadLaunchService.PreparationOwnerId>>;
}

export const FactoryRunPreparation = Context.Reference<FactoryRunPreparationShape>(
  "t3/factory/FactoryRunPreparation",
  {
    defaultValue: () => ({
      available: false,
      startOwned: () => Effect.succeedNone,
      currentOwner: () => Effect.succeedNone,
    }),
  },
);

const readGitHead = (cwd: string) =>
  Effect.promise(
    () =>
      new Promise<Option.Option<{ readonly commit: string; readonly tree: string }>>((resolve) =>
        NodeChildProcess.execFile(
          "git",
          ["-C", cwd, "rev-parse", "HEAD^{commit}", "HEAD^{tree}"],
          { windowsHide: true, timeout: 10_000 },
          (error, stdout) => {
            const [commit, tree] = stdout.trim().split(/\r?\n/);
            resolve(
              error === null && commit !== undefined && tree !== undefined
                ? Option.some({ commit, tree })
                : Option.none(),
            );
          },
        ),
      ),
  );

const runGit = (cwd: string, args: ReadonlyArray<string>, timeout: number) =>
  Effect.promise(
    () =>
      new Promise<{ readonly ok: boolean; readonly stdout: string; readonly stderr: string }>(
        (resolve) =>
          NodeChildProcess.execFile(
            "git",
            ["-C", cwd, ...args],
            {
              windowsHide: true,
              timeout,
              env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
            },
            (error, stdout, stderr) =>
              resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr) }),
          ),
      ),
  );

interface LandedObject {
  readonly commit: string;
  readonly tree: string;
  readonly parents: ReadonlyArray<string>;
}

type LandedAvailability =
  | { readonly type: "available"; readonly object: LandedObject }
  | { readonly type: "unavailable"; readonly detail: string };

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const readLandedObject = (cwd: string, commit: string) =>
  Effect.map(runGit(cwd, ["cat-file", "commit", commit], 10_000), (read) => {
    if (!read.ok) return undefined;
    const header = read.stdout.split("\n\n", 1)[0]!.split("\n");
    const tree = header.find((line) => line.startsWith("tree "))?.slice(5);
    const parents = header
      .filter((line) => line.startsWith("parent "))
      .map((line) => line.slice(7));
    return tree === undefined ? undefined : { commit, tree, parents };
  });

const materializeLanded = Effect.fn("FactoryWorkspaceHead.materializeLanded")(function* (input: {
  readonly cwd: string;
  readonly remote: string | null;
  readonly branch: string;
  readonly commit: string;
}) {
  const available = (object: LandedObject): LandedAvailability => ({ type: "available", object });
  const unavailable = (detail: string): LandedAvailability => ({ type: "unavailable", detail });
  const { cwd, remote, branch, commit } = input;
  if (!OBJECT_ID.test(commit)) return unavailable(`${commit} is not a full commit id`);
  const local = yield* readLandedObject(cwd, commit);
  if (local !== undefined) return available(local);
  if (remote === null) return unavailable(`landed commit ${commit} is not in this repository`);
  if (remote.startsWith("-") || branch.startsWith("-")) {
    return unavailable(`integration target ${remote}/${branch} is not a fetchable ref`);
  }
  // The integration target's own private ref, as the integrator reads it; never a tracking ref.
  const fetched = yield* runGit(
    cwd,
    [
      "fetch",
      "--no-tags",
      "--quiet",
      // Without it, git also moves the user's matching remote-tracking ref.
      "--refmap=",
      remote,
      `+refs/heads/${branch}:refs/t3-factory/integration/${remote}/${branch}`,
    ],
    120_000,
  );
  // A concurrent fetch of the same ref may hold its lock; what it brought counts all the same.
  const after = yield* readLandedObject(cwd, commit);
  if (after !== undefined) return available(after);
  return unavailable(
    fetched.ok
      ? `landed commit ${commit} is not on ${remote}/${branch}`
      : `fetching ${remote}/${branch} failed: ${fetched.stderr.trim().split(/\r?\n/)[0] ?? ""}`,
  );
});

export interface FactoryWorkspaceHeadShape {
  readonly read: (
    cwd: string,
  ) => Effect.Effect<Option.Option<{ readonly commit: string; readonly tree: string }>>;
  readonly materializeLanded?: (input: {
    readonly cwd: string;
    readonly remote: string | null;
    readonly branch: string;
    readonly commit: string;
  }) => Effect.Effect<LandedAvailability>;
}

/**
 * A workspace's checked-out commit and tree, as git reads them; `materializeLanded` makes a landed
 * commit local before a bound worktree is cut from it, fetching only its integration target's ref.
 * Tests substitute it; nothing else does. One without `materializeLanded` fetches nothing.
 */
export const FactoryWorkspaceHead = Context.Reference<FactoryWorkspaceHeadShape>(
  "t3/factory/FactoryWorkspaceHead",
  {
    defaultValue: () => ({ read: readGitHead, materializeLanded }),
  },
);
