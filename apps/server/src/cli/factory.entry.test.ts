// @effect-diagnostics nodeBuiltinImport:off - the public entry runs in its own process against a synthetic host.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

// A close reason the peer chose: the CLI keeps it out of everything it prints and audits.
const PEER_TEXT = "SYNTHETIC_FORBIDDEN_PEER_TEXT_122";
const BIN = NodeURL.fileURLToPath(new URL("../bin.ts", import.meta.url));

/** One client frame from `buffer`, unmasked, or undefined until it has fully arrived. */
const readFrame = (buffer: Buffer) => {
  if (buffer.length < 2) return undefined;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const masked = (buffer[1]! & 0x80) !== 0;
  const start = offset + (masked ? 4 : 0);
  if (buffer.length < start + length) return undefined;
  const payload = Buffer.from(buffer.subarray(start, start + length));
  if (masked) {
    for (let index = 0; index < payload.length; index++) {
      payload[index] = payload[index]! ^ buffer[offset + (index % 4)]!;
    }
  }
  return { opcode: buffer[0]! & 0x0f, payload, size: start + length };
};

/**
 * A host as the CLI meets it: it issues a ticket, accepts the WebSocket, and closes it with code
 * 1011 and its own reason once the CLI sends its first request.
 */
const syntheticHost = async () => {
  const requests: Array<string> = [];
  const sockets = new Set<NodeNet.Socket>();
  const server = NodeHttp.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ ticket: "synthetic-ticket", expiresAt: "2099-01-01T00:00:00.000Z" }),
      );
    });
  });
  server.on("upgrade", (request: NodeHttp.IncomingMessage, socket: NodeNet.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const accept = NodeCrypto.createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (let frame = readFrame(buffered); frame !== undefined; frame = readFrame(buffered)) {
        buffered = buffered.subarray(frame.size);
        const message =
          frame.opcode === 1
            ? (JSON.parse(frame.payload.toString("utf8")) as { _tag: string; tag?: string })
            : undefined;
        if (message?._tag !== "Request") continue;
        requests.push(message.tag ?? "");
        const close = Buffer.concat([Buffer.from([0x03, 0xf3]), Buffer.from(PEER_TEXT)]);
        socket.end(Buffer.concat([Buffer.from([0x88, close.length]), close]));
        return;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as NodeNet.AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    [Symbol.asyncDispose]: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

/** `t3 factory <args>` as an operator runs it, in its own process, with each stream kept apart. */
const runEntry = (args: ReadonlyArray<string>, home: string) =>
  new Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>(
    (resolve, reject) => {
      const child = NodeChildProcess.spawn(process.execPath, [BIN, "factory", ...args], {
        env: { ...process.env, T3CODE_HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );

it.each([
  {
    kind: "read",
    args: ["state"],
    request: "factory.overview",
    shown: "factory state: the connection was lost: SocketCloseError (code 1011)",
    audited: "failed",
  },
  {
    kind: "write",
    args: ["observe", "--factory", "synthetic-factory"],
    request: "factory.observeClaims",
    shown:
      "factory observe: delivery unknown: the connection was lost before the server acknowledged the observed claims (SocketCloseError (code 1011)); read the factory back before repeating it",
    audited: "unknown",
  },
])(
  "Public entry: a $kind whose connection the peer closes with its own reason prints no peer text on stdout or stderr",
  async ({ args, request, shown, audited }) => {
    await using host = await syntheticHost();
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "factory-cli-entry-"));
    try {
      const tokenFile = NodePath.join(home, "token.txt");
      await NodeFSP.writeFile(tokenFile, "synthetic-session-token");
      const { code, stdout, stderr } = await runEntry(
        [...args, "--base-dir", home, "--server", host.origin, "--token-file", tokenFile],
        home,
      );

      assert.strictEqual(code, 1);
      assert.notInclude(stdout, PEER_TEXT);
      assert.notInclude(stderr, PEER_TEXT);
      // The failure is still shown, bounded, and the request was sent once.
      assert.include(stdout + stderr, shown);
      assert.deepStrictEqual(host.requests, [request]);
      const audit = await NodeFSP.readFile(
        NodePath.join(home, "userdata", "factory-admin-audit.jsonl"),
        "utf8",
      );
      assert.deepStrictEqual(
        audit
          .trim()
          .split("\n")
          .map((line) => (JSON.parse(line) as { outcome: string }).outcome),
        [audited],
      );
      assert.notInclude(audit, PEER_TEXT);
    } finally {
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  },
);
