// @effect-diagnostics nodeBuiltinImport:off - runs as a t3.json settle script, Node built-ins only.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Removes the build output Git ignores in a settled worktree, so storage cleanup's
// `any-local-files` guard is not held by output a build recreates. Never node_modules, env
// files, tracked files, anything reached through a link, or another checkout.
const worktree = NodeFS.realpathSync.native(NodePath.dirname(import.meta.dirname));
const settled = process.env.T3CODE_WORKTREE_PATH;
const same = (left: string, right: string) => NodePath.relative(left, right) === "";
// Only the worktree T3 settles: the main checkout and manual runs elsewhere change nothing.
if (settled === undefined || !same(NodeFS.realpathSync.native(settled), worktree)) process.exit(0);

const git = (args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync("git", ["-C", worktree, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
const regenerable = (relative: string) => {
  const tracked = git(["ls-files", "--", relative]);
  return (
    git(["check-ignore", "-q", "--", relative]).status === 0 &&
    tracked.status === 0 &&
    tracked.stdout === ""
  );
};

const candidates = [".turbo"];
for (const area of ["apps", "packages", "infra"]) {
  const base = NodePath.join(worktree, area);
  if (!NodeFS.existsSync(base)) continue;
  for (const name of NodeFS.readdirSync(base)) {
    candidates.push(`${area}/${name}/dist`, `${area}/${name}/.turbo`);
  }
}

for (const relative of candidates) {
  const target = NodePath.join(worktree, relative);
  // A link is never a directory to lstat, and a linked parent shows as a different real path.
  if (NodeFS.lstatSync(target, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
  if (!same(NodeFS.realpathSync.native(target), target) || !regenerable(relative)) continue;
  NodeFS.rmSync(target, { recursive: true, force: true });
  process.stdout.write(`settle: removed build output ${relative}\n`);
}
