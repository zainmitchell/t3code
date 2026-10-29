// @effect-diagnostics nodeBuiltinImport:off - a disposable process for containment tests.
/**
 * `member.fixture.ts <port> <role> [--spawn <role>]... [--stdin-exit]` reports `<role> <pid>` on a
 * loopback socket that only the OS closes, so its close means this process ended. Each `--spawn`
 * starts a detached child for the rest of the chain; a `!` role exits after reporting and spawning;
 * `--stdin-exit` exits when stdin ends, as Claude Code does when its SDK closes it.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";

const [port, roleArgument, ...rest] = process.argv.slice(2);
const exitAfter = roleArgument!.endsWith("!");
const role = exitAfter ? roleArgument!.slice(0, -1) : roleArgument!;
// Only explicit `--spawn <role>` pairs: an SDK appends its own arguments after these.
const chain = rest.flatMap((arg, index) =>
  arg === "--spawn" && rest[index + 1] !== undefined ? [rest[index + 1]!] : [],
);
const childRole = chain[0];
const childChain = chain.slice(1).flatMap((next) => ["--spawn", next]);

const socket = NodeNet.connect(Number(port), "127.0.0.1", () => {
  if (childRole !== undefined) {
    NodeChildProcess.spawn(
      process.execPath,
      [import.meta.filename, port!, childRole, ...childChain],
      { detached: true, stdio: "ignore" },
    ).unref();
  }
  socket.write(`${role} ${process.pid}\n`, () => {
    if (exitAfter) process.exit(0);
  });
});
socket.on("error", () => {});
if (rest.includes("--stdin-exit")) {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.resume();
}
