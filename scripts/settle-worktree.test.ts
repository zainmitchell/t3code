// @effect-diagnostics nodeBuiltinImport:off - runs the real settle script against a disposable Git checkout.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { expect, it } from "vite-plus/test";

it("removes only the build output Git ignores, and only in the worktree T3 settles", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-settle-"));
  try {
    const checkout = NodePath.join(root, "checkout");
    const other = NodePath.join(root, "other");
    const write = (file: string, text = "x") => {
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, text);
    };
    const at = (...parts: string[]) => NodePath.join(checkout, ...parts);
    write(at(".gitignore"), "node_modules\n.turbo\n.env\napps/*/dist\npackages/*/dist\n");
    for (const file of [
      at("apps", "web", "dist", "index.js"),
      at("packages", "contracts", ".turbo", "log"),
      at(".turbo", "cache"),
      // Tracked despite the ignore rule, untracked but not ignored, and env or dependencies.
      at("apps", "docs", "dist", "guide.md"),
      at("dist", "notes.txt"),
      at(".env"),
      at("node_modules", "pkg", "index.js"),
      at("apps", "web", "src", "index.ts"),
      NodePath.join(other, "dist", "out.js"),
    ])
      write(file);
    // A linked package folder: its dist belongs to another checkout.
    NodeFS.symlinkSync(other, at("packages", "linked"), "junction");
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], { stdio: "ignore" });
    git("init", "-q");
    git("add", "-f", "apps/docs/dist/guide.md");
    const script = at("scripts", "settle-worktree.ts");
    write(
      script,
      NodeFS.readFileSync(NodePath.join(import.meta.dirname, "settle-worktree.ts"), "utf8"),
    );
    const run = (worktreePath: string | undefined) => {
      const env = { ...NodeProcess.env };
      delete env.T3CODE_WORKTREE_PATH;
      if (worktreePath !== undefined) env.T3CODE_WORKTREE_PATH = worktreePath;
      const result = NodeChildProcess.spawnSync(NodeProcess.execPath, [script], {
        cwd: checkout,
        env: { ...env, T3CODE_PROJECT_ROOT: other },
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    };
    const present = () =>
      [
        at("apps", "web", "dist"),
        at("packages", "contracts", ".turbo"),
        at(".turbo"),
        at("apps", "docs", "dist", "guide.md"),
        at("dist", "notes.txt"),
        at(".env"),
        at("node_modules", "pkg", "index.js"),
        at("apps", "web", "src", "index.ts"),
        NodePath.join(other, "dist", "out.js"),
      ].map((path) => NodeFS.existsSync(path));

    // Run outside a settle of this worktree, it changes nothing.
    run(undefined);
    run(other);
    expect(present()).toEqual([true, true, true, true, true, true, true, true, true]);

    run(checkout);
    expect(present()).toEqual([false, false, false, true, true, true, true, true, true]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
