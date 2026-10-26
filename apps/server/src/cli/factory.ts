// @effect-diagnostics nodeBuiltinImport:off - audit records carry sha256 digests and the host user.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentHttpApi,
  FactoryId,
  FactoryReservationId,
  FactoryTransferInput,
  RunId,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

/**
 * Host-admin path to a factory: base-directory access can already issue sessions, so this issues a
 * short `host-admin` session, calls the server's owner methods with it, then revokes it. The
 * server checks each method's scope as for any client and records the session as the actor; every
 * operation is also appended to the state directory's `factory-admin-audit.jsonl`.
 */

export class FactoryCliError extends Schema.TaggedError<FactoryCliError>()("FactoryCliError", {
  operation: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `factory ${this.operation}: ${this.reason}`;
  }
}

const HOST_ADMIN_SUBJECT = "host-admin";
const SESSION_TTL = Duration.minutes(10);
const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const decodeDocumentFactory = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ factoryId: FactoryId })),
);
const decodeTransfer = Schema.decodeUnknownEffect(Schema.fromJsonString(FactoryTransferInput));
const encodeAudit = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const factoryIdFlag = Flag.String("factory").pipe(
  Flag.withSchema(FactoryId),
  Flag.withDescription("The factory to act on."),
);

const fileArgument = (name: string, description: string) =>
  Argument.String(name).pipe(Argument.withDescription(description));

const expectSha256Flag = Flag.String("expect-sha256").pipe(
  Flag.withDescription("The sha256 the file must have; any other content is refused."),
);

interface HostAdminCall {
  readonly operation: string;
  readonly request: unknown;
  readonly documentSha256?: string;
  readonly receiptSha256?: string;
}

type FactoryClient = Effect.Success<ReturnType<typeof makeClient>>;

/** Runs `use` with a factory client authenticated as this host's administrator, then audits it. */
const withHostAdmin = Effect.fn("factoryCli.withHostAdmin")(function* <A, E>(
  flags: CliAuthLocationFlags,
  call: HostAdminCall,
  use: (client: FactoryClient) => Effect.Effect<A, E>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nonce = NodeCrypto.randomUUID();
  const requestDigest = sha256(`${call.operation}\n${yield* encodeAudit(call.request)}`);
  const audit = Effect.fn("factoryCli.audit")(function* (record: Record<string, unknown>) {
    const line = yield* encodeAudit({
      at: DateTime.formatIso(yield* DateTime.now),
      nonce,
      operation: call.operation,
      requestDigest,
      ...(call.documentSha256 === undefined ? {} : { documentSha256: call.documentSha256 }),
      ...(call.receiptSha256 === undefined ? {} : { receiptSha256: call.receiptSha256 }),
      ...record,
    });
    yield* fs.writeFileString(
      path.join(config.stateDir, "factory-admin-audit.jsonl"),
      `${line}\n`,
      {
        flag: "a",
      },
    );
  });

  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return yield* new FactoryCliError({
      operation: call.operation,
      reason: "no running T3 server for this base directory; start it first",
    });
  }
  const origin = runtimeState.value.origin;
  return yield* Effect.gen(function* () {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* Effect.acquireUseRelease(
      environmentAuth.issueSession({
        subject: HOST_ADMIN_SUBJECT,
        label: "t3 factory cli",
        ttl: SESSION_TTL,
        scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope, AuthSettingsWriteScope],
      }),
      (issued) => {
        const actor = {
          kind: "host-admin-cli",
          subject: issued.subject,
          sessionId: issued.sessionId,
          osUser: NodeOS.userInfo().username,
          pid: process.pid,
        };
        return Effect.scoped(
          Effect.flatMap(makeClient(origin, issued.token), (client) => use(client)),
        ).pipe(
          Effect.tap((result) => audit({ actor, outcome: "succeeded", result })),
          Effect.tapError((error) =>
            audit({ actor, outcome: "failed", error: String(error) }).pipe(Effect.ignore),
          ),
        );
      },
      (issued) => environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore),
    );
  }).pipe(
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
      ),
    ),
  );
});

/** The running server's owner methods, over its WebSocket, as any client reaches them. */
const makeClient = Effect.fn("factoryCli.makeClient")(function* (origin: string, token: string) {
  const http = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
  const issued = yield* http.auth.webSocketTicket({
    headers: { authorization: `Bearer ${token}` },
  });
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("wsTicket", issued.ticket);
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION));
  const context = yield* Layer.build(
    Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          Socket.layerWebSocket(url.toString()).pipe(
            Layer.provide(Socket.layerWebSocketConstructorGlobal),
          ),
          RpcSerialization.layerJson,
        ),
      ),
    ),
  );
  return yield* RpcClient.make(WsRpcGroup).pipe(Effect.provide(context));
}, Effect.provide(FetchHttpClient.layer));

const printJson = (value: unknown) =>
  Effect.flatMap(encodeAudit(value), (text) => Console.log(text));

const readPinned = Effect.fn("factoryCli.readPinned")(function* (
  operation: string,
  file: string,
  expected: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* fs.readFile(file);
  const actual = sha256(bytes);
  if (actual !== expected.trim().toLowerCase()) {
    return yield* new FactoryCliError({
      operation,
      reason: `${file} has sha256 ${actual}, not the expected ${expected}`,
    });
  }
  return { text: new TextDecoder().decode(bytes), sha256: actual };
});

const currentRevision = (
  overview: Effect.Success<ReturnType<FactoryClient["factory.overview"]>>,
  factoryId: string,
) =>
  overview.factories.find((factory) => factory.factoryId === factoryId)?.state
    .configurationRevision ?? 0;

const stateCommand = Command.make("state", {
  ...authLocationFlags,
  factory: factoryIdFlag.pipe(Flag.optional),
}).pipe(
  Command.withDescription("Print every factory's state, as the server reads it back."),
  Command.withHandler((flags) =>
    withHostAdmin(flags, { operation: "state", request: {} }, (client) =>
      Effect.map(client[WS_METHODS.factoryOverview]({}), (overview) => {
        const only = Option.getOrUndefined(flags.factory);
        return only === undefined
          ? overview
          : { factories: overview.factories.filter((factory) => factory.factoryId === only) };
      }),
    ).pipe(Effect.flatMap(printJson)),
  ),
);

const installCommand = Command.make("install", {
  ...authLocationFlags,
  document: fileArgument("document", "The factory's configuration document (JSON)."),
  expectSha256: expectSha256Flag,
  expectRevision: Flag.Int("expect-revision").pipe(
    Flag.withDescription(
      "The configuration revision being replaced (0 when the factory is new). A different current revision is refused, so a stale or repeated install changes nothing.",
    ),
  ),
}).pipe(
  Command.withDescription(
    "Install or replace a factory's configuration. `enabled` in the document pauses or starts it.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const document = yield* readPinned("install", flags.document, flags.expectSha256);
      const { factoryId } = yield* decodeDocumentFactory(document.text);
      return yield* withHostAdmin(
        flags,
        {
          operation: "install",
          request: { factoryId, expectRevision: flags.expectRevision },
          documentSha256: document.sha256,
        },
        (client) =>
          Effect.gen(function* () {
            const revision = currentRevision(
              yield* client[WS_METHODS.factoryOverview]({}),
              factoryId,
            );
            if (revision !== flags.expectRevision) {
              return yield* new FactoryCliError({
                operation: "install",
                reason: `${factoryId} is at revision ${revision}, not ${flags.expectRevision}: nothing installed`,
              });
            }
            return yield* client[WS_METHODS.factoryConfigure]({ configuration: document.text });
          }),
      );
    }).pipe(Effect.flatMap(printJson)),
  ),
);

const observeCommand = Command.make("observe", {
  ...authLocationFlags,
  factory: factoryIdFlag,
}).pipe(
  Command.withDescription(
    "Record other writers' claims on the factory's tracker as held work. Decides nothing, even while paused.",
  ),
  Command.withHandler((flags) =>
    withHostAdmin(
      flags,
      { operation: "observe", request: { factoryId: flags.factory } },
      (client) => client[WS_METHODS.factoryObserveClaims]({ factoryId: flags.factory }),
    ).pipe(Effect.flatMap(printJson)),
  ),
);

const transferCommand = Command.make("transfer", {
  ...authLocationFlags,
  request: fileArgument(
    "request",
    "The transfer request (JSON): factoryId, transferId, job, items.",
  ),
  expectSha256: expectSha256Flag,
}).pipe(
  Command.withDescription(
    "Transfer a legacy command job's items: raises its writer fence, and adopts once its last pass stopped. Ask again with the same transferId to finish.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const request = yield* readPinned("transfer", flags.request, flags.expectSha256);
      const input = yield* decodeTransfer(request.text);
      return yield* withHostAdmin(
        flags,
        { operation: "transfer", request: input, documentSha256: request.sha256 },
        (client) => client[WS_METHODS.factoryTransfer](input),
      );
    }).pipe(Effect.flatMap(printJson)),
  ),
);

const recoverCommand = Command.make("recover", {
  ...authLocationFlags,
  factory: factoryIdFlag,
  reservation: Flag.String("reservation").pipe(
    Flag.withSchema(FactoryReservationId),
    Flag.withDescription("The held reservation whose interrupted run to resume."),
  ),
  run: Flag.String("run").pipe(
    Flag.withSchema(RunId),
    Flag.withDescription(
      "The reservation's admitted run, which someone interrupted before it started.",
    ),
  ),
  reason: Flag.String("reason").pipe(
    Flag.withDescription("The owner's reason, recorded in the audit."),
  ),
}).pipe(
  Command.withDescription(
    "Resume a factory stage run that someone interrupted before it ever started, on the same run and attempt, after fresh checks. Refuses anything else and changes nothing then.",
  ),
  Command.withHandler((flags) =>
    withHostAdmin(
      flags,
      {
        operation: "recover",
        request: {
          factoryId: flags.factory,
          reservationId: flags.reservation,
          runId: flags.run,
          reason: flags.reason,
        },
      },
      (client) =>
        client[WS_METHODS.factoryRecoverRun]({
          factoryId: flags.factory,
          reservationId: flags.reservation,
          runId: flags.run,
          reason: flags.reason,
        }),
    ).pipe(Effect.flatMap(printJson)),
  ),
);

export const factoryCommand = Command.make("factory").pipe(
  Command.withDescription(
    "Administer this environment's factories as its host administrator: install, observe, transfer and recover.",
  ),
  Command.withSubcommands([
    stateCommand,
    installCommand,
    observeCommand,
    transferCommand,
    recoverCommand,
  ]),
);
