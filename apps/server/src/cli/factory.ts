// @effect-diagnostics nodeBuiltinImport:off - audit records carry sha256 digests and the host user.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentHttpApi,
  type FactoryDecideInput,
  factoryDecisionChoices,
  FactoryHistoricalTerminationInput,
  FactoryId,
  FactoryReservationId,
  type FactoryStateResult,
  type FactorySwitchProviderResult,
  FactoryTransferInput,
  PositiveInt,
  ProviderInstanceId,
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
import type * as Scope from "effect/Scope";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as CommandJobs from "../commandJobs/CommandJobs.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

/**
 * Base-directory access can already issue sessions, so a host-admin call uses a short session it
 * revokes after (or one issued on `--server`). The server checks scopes and records the session as
 * the actor; each call is also appended to the local `factory-admin-audit.jsonl`.
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

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeDocumentFactory = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ factoryId: FactoryId })),
);
const decodeTransfer = Schema.decodeUnknownEffect(Schema.fromJsonString(FactoryTransferInput));
// Exact: a key the server does not take, such as an actor, is refused, never silently dropped.
const decodeHistoricalTermination = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FactoryHistoricalTerminationInput),
  { onExcessProperty: "error" },
);
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

const factoryLocationFlags = {
  ...authLocationFlags,
  server: Flag.String("server").pipe(
    Flag.withDescription(
      "Another host's T3 server origin to act on, instead of this base directory's. Needs --token-file.",
    ),
    Flag.optional,
  ),
  tokenFile: Flag.String("token-file").pipe(
    Flag.withDescription(
      "A file holding a bearer session issued on the --server host (`t3 auth session issue` with orchestration:read, orchestration:operate and, for install, dispose or historical-termination, settings:write).",
    ),
    Flag.optional,
  ),
} as const;

interface FactoryLocationFlags extends CliAuthLocationFlags {
  readonly server: Option.Option<string>;
  readonly tokenFile: Option.Option<string>;
}

interface HostAdminCall {
  readonly operation: string;
  readonly request: unknown;
  readonly documentSha256?: string;
  readonly receiptSha256?: string;
}

type FactoryClient = Effect.Success<ReturnType<typeof makeClient>>;

/** Where the calls go, the bearer session they carry, and who the audit records as acting. */
export interface FactoryDestination {
  readonly origin: string;
  readonly token: string;
  readonly actor: Readonly<Record<string, unknown>>;
}

const hostActor = () => ({ osUser: NodeOS.userInfo().username, pid: process.pid });

/** This host's running server, through a short host-admin session revoked when the scope closes. */
export const hostAdminDestination = Effect.fn("factoryCli.hostAdminDestination")(function* (
  operation: string,
  serverRuntimeStatePath: string,
) {
  const runtimeState = yield* readPersistedServerRuntimeState(serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return yield* new FactoryCliError({
      operation,
      reason: "no running T3 server for this base directory; start it first",
    });
  }
  const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const issued = yield* Effect.acquireRelease(
    environmentAuth.issueSession({
      subject: HOST_ADMIN_SUBJECT,
      label: "t3 factory cli",
      ttl: SESSION_TTL,
      scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope, AuthSettingsWriteScope],
    }),
    (issued) => environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore),
  );
  return {
    origin: runtimeState.value.origin,
    token: issued.token,
    actor: {
      kind: "host-admin-cli",
      subject: issued.subject,
      sessionId: issued.sessionId,
      ...hostActor(),
    },
  } satisfies FactoryDestination;
});

/**
 * Another host's server, with a bearer session issued there (`t3 auth session issue`). Nothing is
 * issued or revoked here; the token is read from a file so it never appears in an argument list.
 */
export const remoteDestination = Effect.fn("factoryCli.remoteDestination")(function* (
  operation: string,
  server: string,
  tokenFile: string,
) {
  const origin = URL.canParse(server) ? new URL(server) : undefined;
  if (origin === undefined || (origin.protocol !== "https:" && origin.protocol !== "http:")) {
    return yield* new FactoryCliError({
      operation,
      reason: `--server ${server} is not an http(s) origin`,
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const token = (yield* fs
    .readFileString(tokenFile)
    .pipe(
      Effect.mapError(
        () => new FactoryCliError({ operation, reason: `cannot read --token-file ${tokenFile}` }),
      ),
    )).trim();
  if (token.length === 0) {
    return yield* new FactoryCliError({ operation, reason: `--token-file ${tokenFile} is empty` });
  }
  return {
    origin: origin.origin,
    token,
    actor: { kind: "remote-session", origin: origin.origin, ...hostActor() },
  } satisfies FactoryDestination;
});

/**
 * Opens the destination, runs `use` on a client connected to it, then appends one audit line to
 * `<stateDir>/factory-admin-audit.jsonl` recording the actor and outcome, never the token.
 */
export const runAudited = Effect.fn("factoryCli.runAudited")(function* <C, A, E, E2, R, R2, E3>(
  input: {
    readonly stateDir: string;
    readonly call: HostAdminCall;
    readonly destination: Effect.Effect<FactoryDestination, E2, R2 | Scope.Scope>;
    readonly connect: (origin: string, token: string) => Effect.Effect<C, E3, Scope.Scope>;
  },
  use: (client: C) => Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { call } = input;
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
    yield* fs.writeFileString(path.join(input.stateDir, "factory-admin-audit.jsonl"), `${line}\n`, {
      flag: "a",
    });
  });
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const destination = yield* input.destination;
      return yield* input.connect(destination.origin, destination.token).pipe(
        Effect.flatMap(use),
        Effect.tap((result) => audit({ actor: destination.actor, outcome: "succeeded", result })),
        Effect.tapError((error) =>
          audit({ actor: destination.actor, outcome: "failed", error: String(error) }).pipe(
            Effect.ignore,
          ),
        ),
      );
    }),
  );
});

/** Runs `use` with a factory client for the chosen destination, as its administrator, audited. */
const withHostAdmin = Effect.fn("factoryCli.withHostAdmin")(function* <A, E>(
  flags: FactoryLocationFlags,
  call: HostAdminCall,
  use: (client: FactoryClient) => Effect.Effect<A, E>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const server = Option.getOrUndefined(flags.server);
  const tokenFile = Option.getOrUndefined(flags.tokenFile);
  if ((server === undefined) !== (tokenFile === undefined)) {
    return yield* new FactoryCliError({
      operation: call.operation,
      reason: "--server and --token-file go together: name both for another host, or neither",
    });
  }
  const run = <E2, R>(destination: Effect.Effect<FactoryDestination, E2, R>) =>
    runAudited({ stateDir: config.stateDir, call, destination, connect: makeClient }, use);
  return yield* server !== undefined && tokenFile !== undefined
    ? run(remoteDestination(call.operation, server, tokenFile))
    : run(hostAdminDestination(call.operation, config.serverRuntimeStatePath)).pipe(
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
  ...factoryLocationFlags,
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
  ...factoryLocationFlags,
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

const ceilingCommand = Command.make("ceiling", {
  ...factoryLocationFlags,
  agents: Flag.Int("agents").pipe(
    Flag.withSchema(PositiveInt),
    Flag.withDescription(
      "The most agents every project and role may run at once, together. Pools then no longer subdivide it.",
    ),
    Flag.optional,
  ),
  clear: Flag.Boolean("clear").pipe(
    Flag.withDescription("Remove the ceiling, so each factory's pools limit it again."),
    Flag.withDefault(false),
  ),
  expectRevision: Flag.Int("expect-revision").pipe(
    Flag.withDescription(
      "The ceiling revision being replaced (0 when none was ever set). A different current revision is refused.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Print the environment's shared agent ceiling and every execution it counts, or set it with --agents or --clear. Over the ceiling nothing new starts; nothing running is stopped.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const agents = Option.getOrUndefined(flags.agents);
      const expectRevision = Option.getOrUndefined(flags.expectRevision);
      if (agents !== undefined && flags.clear) {
        return yield* new FactoryCliError({
          operation: "ceiling",
          reason: "--agents and --clear are exclusive",
        });
      }
      const changing = agents !== undefined || flags.clear;
      if (changing !== (expectRevision !== undefined)) {
        return yield* new FactoryCliError({
          operation: "ceiling",
          reason: changing
            ? "--expect-revision is required to set or clear the ceiling"
            : "--expect-revision only goes with --agents or --clear",
        });
      }
      const set =
        expectRevision === undefined ? undefined : { agents: agents ?? null, expectRevision };
      const result = yield* withHostAdmin(
        flags,
        { operation: "ceiling", request: set === undefined ? {} : { set } },
        (client) => client[WS_METHODS.factoryAgentCeiling](set === undefined ? {} : { set }),
      );
      if (set !== undefined && !result.applied) {
        return yield* new FactoryCliError({
          operation: "ceiling",
          reason: `the ceiling is at revision ${result.occupancy.revision}, not ${set.expectRevision}: nothing changed`,
        });
      }
      return result;
    }).pipe(Effect.flatMap(printJson)),
  ),
);

const instanceFlag = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withSchema(ProviderInstanceId), Flag.withDescription(description));

/** What each factory's switch left unfinished; empty when every factory is on `to` and read back. */
export const unfinishedSwitches = (
  factories: ReadonlyArray<{
    readonly factoryId: string;
    readonly outcome: FactorySwitchProviderResult["outcome"] | "failed";
    readonly readback?: { readonly verified: boolean } | undefined;
  }>,
  applied: boolean,
) =>
  factories.flatMap(({ factoryId, outcome, readback }) =>
    outcome === "already_switched" ||
    (applied ? outcome === "switched" && readback?.verified === true : outcome === "planned")
      ? []
      : [
          `${factoryId}: ${outcome}${readback?.verified === false ? " (read back differently)" : ""}`,
        ],
  );

const switchProviderCommand = Command.make("switch-provider", {
  ...factoryLocationFlags,
  factory: factoryIdFlag.pipe(
    Flag.withDescription("A factory to switch; repeat for each. No factory is switched unnamed."),
    Flag.atLeast(1),
  ),
  from: instanceFlag(
    "from",
    "The provider instance its future work leaves, such as claude_second.",
  ),
  to: instanceFlag("to", "The provider instance its future work moves to, such as claudeAgent."),
  apply: Flag.Boolean("apply").pipe(
    Flag.withDescription("Write the switch. Without it, only print what would change."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Move a factory's future work from one provider instance to another, keeping each model, option, stage and everything else. Running work is untouched. Each factory is written only at the revision it was read at, then read back; repeating a finished switch changes nothing. Exits nonzero unless every named factory ends on --to.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const factoryIds = [...new Set(flags.factory)];
      const report = yield* withHostAdmin(
        flags,
        {
          operation: flags.apply ? "switch-provider" : "switch-provider-plan",
          request: { factoryIds, from: flags.from, to: flags.to },
        },
        (client) =>
          Effect.forEach(factoryIds, (factoryId) => {
            const call = (apply: boolean) =>
              client[WS_METHODS.factorySwitchProvider]({
                factoryId,
                from: flags.from,
                to: flags.to,
                apply,
              });
            return call(flags.apply).pipe(
              // A switch reads back as already switched, at exactly the revision it wrote.
              Effect.filterOrElse(
                (result) => result.outcome !== "switched",
                (result) =>
                  Effect.map(call(false), (after) => ({
                    ...result,
                    readback: {
                      revision: after.revision,
                      outcome: after.outcome,
                      verified:
                        after.outcome === "already_switched" &&
                        after.revision === result.switchedRevision,
                    },
                  })),
              ),
              // One factory's failure is reported with the rest; nothing is retried.
              Effect.catch((error) =>
                Effect.succeed({ factoryId, outcome: "failed" as const, reason: String(error) }),
              ),
            );
          }).pipe(
            Effect.map((factories) => ({
              applied: flags.apply,
              from: flags.from,
              to: flags.to,
              factories,
            })),
          ),
      );
      yield* printJson(report);
      const unfinished = unfinishedSwitches(report.factories, flags.apply);
      // Stdout stays one JSON report for the caller to parse; the exit status says whether it is done.
      if (unfinished.length > 0) {
        yield* Console.error(`factory switch-provider: not finished: ${unfinished.join("; ")}`);
        yield* Effect.sync(() => {
          process.exitCode = 1;
        });
      }
    }),
  ),
);

const observeCommand = Command.make("observe", {
  ...factoryLocationFlags,
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

const enterCommand = Command.make("enter", {
  ...factoryLocationFlags,
  factory: factoryIdFlag,
  repository: Flag.String("repository").pipe(
    Flag.withDescription("The issue's repository, owner/name, one the factory collects."),
  ),
  issue: Flag.Int("issue").pipe(
    Flag.withSchema(PositiveInt),
    Flag.withDescription("The issue number."),
  ),
}).pipe(
  Command.withDescription(
    "Ask the factory to take one issue now. Its readiness, policy and claim decide; existing native work is printed, never started twice. Prints status, reason and the next action.",
  ),
  Command.withHandler((flags) => {
    const request = {
      factoryId: flags.factory,
      repository: flags.repository,
      issueNumber: flags.issue,
    };
    return withHostAdmin(flags, { operation: "enter", request }, (client) =>
      client[WS_METHODS.factoryEnter](request),
    ).pipe(Effect.flatMap(printJson));
  }),
);

const transferCommand = Command.make("transfer", {
  ...factoryLocationFlags,
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

/** What an owner's takeover receipt authorizes: exact carriers by id and body, and their workers. */
interface Authorized {
  readonly reply: string;
  readonly bodies: ReadonlyMap<string, string>;
  readonly workers: ReadonlySet<string>;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/**
 * A carrier row's legacy worker. HSA rows name it at the top level. A BTC tick names it in its
 * original task's record, with the job as that task's prompt (`command-job:<name>`).
 */
const carrierWorker = (row: Readonly<Record<string, unknown>>): string | undefined => {
  if (typeof row.job === "string" && typeof row.work_id === "string") {
    return `${row.job}\n${row.work_id}`;
  }
  const original = asRecord(row.original);
  const job =
    typeof original?.native_command_job === "string"
      ? CommandJobs.commandJobName(original.native_command_job)
      : null;
  return job !== null && typeof original?.workId === "string"
    ? `${job}\n${original.workId}`
    : undefined;
};

/**
 * The receipt names the carriers it authorizes per source (`hsa_carrier_ids`, `btc_carrier_ids`).
 * Each one's body digest and legacy worker come only from its own row in that source's evidence,
 * `sources.<source>.evidence.carriers`. A carrier without a recorded body digest is not
 * authorized, and neither is its worker.
 */
export const authorizedByReceipt = (receipt: unknown): Authorized => {
  const root = asRecord(receipt) ?? {};
  const bodies = new Map<string, string>();
  const workers = new Set<string>();
  for (const source of ["hsa", "btc"] as const) {
    const listed = root[`${source}_carrier_ids`];
    const ids = new Set((Array.isArray(listed) ? listed : []).map((id) => String(id)));
    const rows = asRecord(asRecord(asRecord(root.sources)?.[source])?.evidence)?.carriers;
    for (const row of Array.isArray(rows) ? rows : []) {
      const entry = asRecord(row);
      const id = entry?.tracker_comment_id ?? entry?.carrier;
      const body = entry?.tracker_body_sha256 ?? entry?.body_sha256;
      if (entry === undefined || typeof body !== "string") continue;
      if ((typeof id !== "number" && typeof id !== "string") || !ids.has(String(id))) continue;
      bodies.set(String(id), body.toLowerCase());
      const worker = carrierWorker(entry);
      if (worker !== undefined) workers.add(worker);
    }
  }
  return {
    reply: typeof root.owner_exact_reply === "string" ? root.owner_exact_reply : "",
    bodies,
    workers,
  };
};

const COMMENT_CARRIER = /^github:[^#]+#\d+:comment:(\d+):([0-9a-f]+)$/;

/** Which held reservations the receipt authorizes retiring, and why any other stays held. */
export const retirementPlan = (
  reservations: ReadonlyArray<{
    readonly reservationId: string;
    readonly itemKey: string;
    readonly origin: string;
    readonly state: string;
    readonly carrierKey?: string | undefined;
    readonly job?: string | undefined;
    readonly workId?: string | undefined;
  }>,
  authorized: Authorized,
) => {
  const retire: Array<{
    readonly reservationId: string;
    readonly itemKey: string;
    readonly unit: string;
  }> = [];
  const held: Array<{
    readonly reservationId: string;
    readonly itemKey: string;
    readonly reason: string;
  }> = [];
  for (const reservation of reservations) {
    if (reservation.state !== "held") continue;
    if (reservation.origin === "observed" && reservation.carrierKey !== undefined) {
      const match = COMMENT_CARRIER.exec(reservation.carrierKey);
      const body = match === null ? undefined : authorized.bodies.get(match[1]!);
      if (match !== null && body !== undefined && body.startsWith(match[2]!)) {
        retire.push({ ...reservation, unit: reservation.carrierKey });
      } else {
        held.push({
          ...reservation,
          reason:
            match === null || body === undefined
              ? `carrier ${reservation.carrierKey} is not authorized`
              : `carrier ${reservation.carrierKey} changed since it was authorized`,
        });
      }
    } else if (reservation.origin === "transferred") {
      const unit = `${reservation.job}\n${reservation.workId}`;
      if (reservation.workId !== undefined && authorized.workers.has(unit)) {
        retire.push({ ...reservation, unit: `${reservation.job}:${reservation.workId}` });
      } else {
        held.push({
          ...reservation,
          reason: `worker ${reservation.job}:${reservation.workId} is not authorized`,
        });
      }
    }
  }
  return { retire, held };
};

const retireCommand = Command.make("retire", {
  ...factoryLocationFlags,
  factory: factoryIdFlag,
  receipt: Flag.String("receipt").pipe(
    Flag.withDescription("The owner's takeover authorization receipt."),
  ),
  receiptSha256: Flag.String("receipt-sha256").pipe(
    Flag.withDescription("The receipt's sha256; any other receipt is refused."),
  ),
  expect: Flag.Int("expect").pipe(
    Flag.withDescription(
      "How many held units the receipt must match; any other count retires nothing.",
    ),
    Flag.optional,
  ),
  apply: Flag.Boolean("apply").pipe(
    Flag.withDescription("Retire the matched units. Without it, only print what would be retired."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Retire exactly the held claims and legacy workers an owner's receipt authorizes, matched by full carrier key (comment id and body digest) or by job and work id. Everything else stays held.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const receipt = yield* readPinned("retire", flags.receipt, flags.receiptSha256);
      const authorized = authorizedByReceipt(yield* decodeUnknownJson(receipt.text));
      return yield* withHostAdmin(
        flags,
        {
          operation: flags.apply ? "retire" : "retire-plan",
          request: { factoryId: flags.factory, expect: Option.getOrNull(flags.expect) },
          receiptSha256: receipt.sha256,
        },
        (client) =>
          Effect.gen(function* () {
            const overview = yield* client[WS_METHODS.factoryOverview]({});
            const factory = overview.factories.find((entry) => entry.factoryId === flags.factory);
            if (factory === undefined) {
              return yield* new FactoryCliError({
                operation: "retire",
                reason: `${flags.factory} is not configured`,
              });
            }
            const plan = retirementPlan(factory.state.reservations, authorized);
            if (Option.isSome(flags.expect) && plan.retire.length !== flags.expect.value) {
              return yield* new FactoryCliError({
                operation: "retire",
                reason: `the receipt matches ${plan.retire.length} held units, not ${flags.expect.value}: nothing retired`,
              });
            }
            if (!flags.apply) return { applied: false, ...plan };
            const retired: Array<string> = [];
            for (const unit of plan.retire) {
              const result = yield* client[WS_METHODS.factoryDisposeClaim]({
                factoryId: flags.factory,
                reservationId: FactoryReservationId.make(unit.reservationId),
                reason: `owner takeover authorization ${receipt.sha256} ("${authorized.reply}"), retiring ${unit.unit}`,
              });
              if (!result.disposed) {
                return yield* new FactoryCliError({
                  operation: "retire",
                  reason: `${unit.reservationId} was no longer held after retiring ${retired.length}; stopped`,
                });
              }
              retired.push(unit.reservationId);
            }
            return { applied: true, retired, held: plan.held };
          }),
      );
    }).pipe(Effect.flatMap(printJson)),
  ),
);

const recoverCommand = Command.make("recover", {
  ...factoryLocationFlags,
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

const disposeCommand = Command.make("dispose", {
  ...factoryLocationFlags,
  factory: factoryIdFlag,
  reservation: Flag.String("reservation").pipe(
    Flag.withSchema(FactoryReservationId),
    Flag.withDescription("The held admitted reservation whose stage never started."),
  ),
  reason: Flag.String("reason").pipe(
    Flag.withDescription("The owner's reason, recorded with the attestation and in the audit."),
  ),
  expectDigest: Flag.String("expect-digest").pipe(
    Flag.withDescription(
      "The evidence digest a read printed. Without it nothing is recorded; with it, only if the evidence is still exactly that.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Attest, as the owner, that an admitted stage never started when nothing can prove its preparation history. Read first; then repeat with --expect-digest to record the attestation, failure and release together.",
  ),
  Command.withHandler((flags) =>
    withHostAdmin(
      flags,
      {
        operation: "dispose",
        request: {
          factoryId: flags.factory,
          reservationId: flags.reservation,
          reason: flags.reason,
          expectDigest: Option.getOrNull(flags.expectDigest),
        },
      },
      (client) =>
        client[WS_METHODS.factoryDisposeNeverStarted]({
          factoryId: flags.factory,
          reservationId: flags.reservation,
          reason: flags.reason,
          ...(Option.isSome(flags.expectDigest) ? { expectDigest: flags.expectDigest.value } : {}),
        }),
    ).pipe(Effect.flatMap(printJson)),
  ),
);

/**
 * A response that names any refusal is the command's failure: its structured result is printed
 * once, then the call fails, so the exit status and the audit say refused. A clean read, applied
 * or not, is a success.
 */
export const refusedHistoricalTermination = <
  A extends { readonly refusals: ReadonlyArray<string> },
>(
  result: A,
) =>
  result.refusals.length === 0
    ? Effect.succeed(result)
    : printJson(result).pipe(
        Effect.andThen(
          Effect.fail(
            new FactoryCliError({
              operation: "historical-termination",
              reason: `refused: ${result.refusals.join(", ")}`,
            }),
          ),
        ),
      );

const historicalTerminationCommand = Command.make("historical-termination", {
  ...factoryLocationFlags,
  request: fileArgument(
    "request",
    "The request (JSON), exactly the t3_factory_historical_termination input: factoryId, reservationId, action, operationRef, reason, and optionally acceptResidual and expectDigest.",
  ),
  expectSha256: expectSha256Flag,
}).pipe(
  Command.withDescription(
    "Read or record, as the owner, a held historical stage's capture before a full host restart or its verification after. Without expectDigest in the request it only reads, and prints the evidence: where no provenance exists, the residual uncertainty, its exact scope and refusals. With it, only that exact evidence is recorded. Prints the server's response; nothing is retried or accepted for you.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const request = yield* readPinned(
        "historical-termination",
        flags.request,
        flags.expectSha256,
      );
      const input = yield* decodeHistoricalTermination(request.text).pipe(
        Effect.mapError(
          (error) =>
            new FactoryCliError({
              operation: "historical-termination",
              reason: `${flags.request} is not a historical termination request: ${error.message}`,
            }),
        ),
      );
      return yield* withHostAdmin(
        flags,
        {
          operation:
            input.expectDigest === undefined
              ? `historical-termination-${input.action}-read`
              : `historical-termination-${input.action}`,
          request: input,
          documentSha256: request.sha256,
        },
        (client) =>
          client[WS_METHODS.factoryHistoricalTermination](input).pipe(
            Effect.flatMap(refusedHistoricalTermination),
          ),
      );
    }).pipe(Effect.flatMap(printJson)),
  ),
);

type ReservedDecision = FactoryStateResult["reservedDecisions"][number];

/** Every pending decision, oldest first, with the answers its card and Settings offer. */
export const pendingDecisions = (
  factories: ReadonlyArray<{
    readonly factoryId: string;
    readonly state: { readonly reservedDecisions: ReadonlyArray<ReservedDecision> };
  }>,
) =>
  factories
    .flatMap(({ factoryId, state }) =>
      state.reservedDecisions
        .filter((decision) => decision.state === "pending")
        .map((decision) => ({
          factoryId,
          decisionId: decision.decisionId,
          itemKey: decision.itemKey,
          stage: decision.stage,
          kind: decision.kind,
          reason: decision.reason,
          createdAt: decision.createdAt,
          answers: factoryDecisionChoices(decision).map((choice) => ({
            answer: choice.answer,
            description: choice.description,
          })),
        })),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

export interface DecisionAnswerRequest {
  readonly factoryId: FactoryId;
  readonly decisionId: string;
  readonly itemKey: string;
  readonly stage: string;
  readonly answer: string;
  readonly reason?: string | undefined;
  readonly units?: number | undefined;
}

export type DecisionAnswerPlan =
  | { readonly type: "send"; readonly input: FactoryDecideInput }
  | {
      readonly type: "recorded";
      readonly answer: string;
      readonly answeredBy?: string;
      readonly grant?: Pick<
        FactoryStateResult["grants"][number],
        "grantId" | "units" | "remaining" | "state"
      >;
    }
  | { readonly type: "refused"; readonly reason: string };

/**
 * The exact answer Settings or the owner's card would record for this decision, or why none is.
 * The decision must still be the one the owner read (same item and stage). Repeating an answer
 * already recorded is reported as recorded; any other answer to a settled decision is refused.
 */
export const decisionAnswerPlan = (
  decisions: ReadonlyArray<ReservedDecision>,
  request: DecisionAnswerRequest,
  grants: ReadonlyArray<FactoryStateResult["grants"][number]> = [],
): DecisionAnswerPlan => {
  const decision = decisions.find((candidate) => candidate.decisionId === request.decisionId);
  if (decision === undefined) {
    return {
      type: "refused",
      reason: `${request.factoryId} has no decision ${request.decisionId}`,
    };
  }
  if (decision.itemKey !== request.itemKey || decision.stage !== request.stage) {
    return {
      type: "refused",
      reason: `decision ${request.decisionId} is for ${decision.itemKey} at ${decision.stage}, not ${request.itemKey} at ${request.stage}`,
    };
  }
  if (!factoryDecisionChoices(decision).some((choice) => choice.answer === request.answer)) {
    return {
      type: "refused",
      reason: `${request.answer} is not an answer to this decision; it takes ${factoryDecisionChoices(
        decision,
      )
        .map((choice) => choice.answer)
        .join(" or ")}`,
    };
  }
  const grant = decision.kind === "grant" && request.answer === "approve";
  if (request.units !== undefined && !grant) {
    return { type: "refused", reason: "--units goes only with approving a grant request" };
  }
  const reason = request.reason?.trim();
  if (reason !== undefined && request.answer !== "decline") {
    return { type: "refused", reason: "--reason goes only with decline" };
  }
  const target = { factoryId: request.factoryId, decisionId: decision.decisionId };
  const input: FactoryDecideInput = grant
    ? { ...target, answer: "grant", grantUnits: request.units ?? 1 }
    : {
        ...target,
        answer:
          reason === undefined || reason.length === 0
            ? request.answer
            : `${request.answer}: ${reason}`,
      };
  if (decision.state === "pending") return { type: "send", input };
  if (decision.state === "resolved" && decision.answer === input.answer) {
    const recordedGrant = grant
      ? grants.find((entry) => entry.grantId === decision.grantId)
      : undefined;
    if (
      grant &&
      (recordedGrant === undefined ||
        recordedGrant.itemKey !== decision.itemKey ||
        recordedGrant.stage !== decision.stage ||
        recordedGrant.units !== input.grantUnits)
    ) {
      return {
        type: "refused",
        reason: `decision ${decision.decisionId} has no matching recorded grant for ${input.grantUnits} original units; nothing changed`,
      };
    }
    return {
      type: "recorded",
      answer: decision.answer,
      ...(decision.answeredBy === undefined ? {} : { answeredBy: decision.answeredBy }),
      ...(recordedGrant === undefined
        ? {}
        : {
            grant: {
              grantId: recordedGrant.grantId,
              units: recordedGrant.units,
              remaining: recordedGrant.remaining,
              state: recordedGrant.state,
            },
          }),
    };
  }
  return {
    type: "refused",
    reason:
      decision.state === "resolved"
        ? `decision ${decision.decisionId} was already answered "${decision.answer}" by ${decision.answeredBy ?? "someone"}; nothing changed`
        : `decision ${decision.decisionId} is ${decision.state}, not pending; nothing changed`,
  };
};

const decisionsCommand = Command.make("decisions", {
  ...factoryLocationFlags,
  factory: factoryIdFlag.pipe(Flag.optional),
}).pipe(
  Command.withDescription(
    "Print every pending owner decision, oldest first: its factory, id, item, stage, reason and the answers it takes.",
  ),
  Command.withHandler((flags) =>
    withHostAdmin(flags, { operation: "decisions", request: {} }, (client) =>
      Effect.map(client[WS_METHODS.factoryOverview]({}), (overview) => {
        const only = Option.getOrUndefined(flags.factory);
        return {
          decisions: pendingDecisions(
            overview.factories.filter(
              (factory) => only === undefined || factory.factoryId === only,
            ),
          ),
        };
      }),
    ).pipe(Effect.flatMap(printJson)),
  ),
);

const decideCommand = Command.make("decide", {
  ...factoryLocationFlags,
  factory: factoryIdFlag,
  decision: Flag.String("decision").pipe(
    Flag.withDescription("The pending decision's id, as `decisions` printed it."),
  ),
  item: Flag.String("item").pipe(
    Flag.withDescription("The decision's item key; any other decision is refused."),
  ),
  stage: Flag.String("stage").pipe(
    Flag.withDescription("The decision's stage; any other decision is refused."),
  ),
  answer: Flag.String("answer").pipe(
    Flag.withDescription(
      "approve, decline or abandon, as the decision offers. Approving a grant request grants starts.",
    ),
  ),
  reason: Flag.String("reason").pipe(
    Flag.withDescription("Why you decline, recorded with the answer."),
    Flag.optional,
  ),
  units: Flag.Int("units").pipe(
    Flag.withSchema(PositiveInt),
    Flag.withDescription("Starts to grant when approving a grant request (default 1)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Answer one pending owner decision as Settings would, after checking it is still the decision you read. The first answer counts; repeating it changes nothing.",
  ),
  Command.withHandler((flags) => {
    const request: DecisionAnswerRequest = {
      factoryId: flags.factory,
      decisionId: flags.decision,
      itemKey: flags.item,
      stage: flags.stage,
      answer: flags.answer.trim().toLowerCase(),
      reason: Option.getOrUndefined(flags.reason),
      units: Option.getOrUndefined(flags.units),
    };
    return withHostAdmin(flags, { operation: "decide", request }, (client) =>
      Effect.gen(function* () {
        const plan = Effect.fn("factoryCli.decisionPlan")(function* () {
          const overview = yield* client[WS_METHODS.factoryOverview]({});
          const factory = overview.factories.find((entry) => entry.factoryId === flags.factory);
          return factory === undefined || !factory.state.configured
            ? ({
                type: "refused",
                reason: `${flags.factory} is not configured`,
              } satisfies DecisionAnswerPlan)
            : decisionAnswerPlan(factory.state.reservedDecisions, request, factory.state.grants);
        });
        const settle = (planned: DecisionAnswerPlan, resolved: boolean) =>
          planned.type === "refused"
            ? Effect.fail(new FactoryCliError({ operation: "decide", reason: planned.reason }))
            : planned.type === "recorded"
              ? Effect.succeed({ resolved, recorded: planned })
              : Effect.fail(
                  new FactoryCliError({
                    operation: "decide",
                    reason: `decision ${flags.decision} is still pending after the answer was not recorded`,
                  }),
                );
        const before = yield* plan();
        if (before.type !== "send") return yield* settle(before, false);
        const result = yield* client[WS_METHODS.factoryDecide](before.input);
        // Another answer may have settled it between the read and ours: say which one counts.
        return yield* settle(yield* plan(), result.resolved);
      }),
    ).pipe(Effect.flatMap(printJson));
  }),
);

export const factoryCommand = Command.make("factory").pipe(
  Command.withDescription(
    "Administer this environment's factories as its host administrator: install, set the shared agent ceiling, switch providers, enter issues, observe, transfer, retire, recover, dispose, settle historical stages and answer decisions.",
  ),
  Command.withSubcommands([
    stateCommand,
    installCommand,
    ceilingCommand,
    switchProviderCommand,
    enterCommand,
    observeCommand,
    transferCommand,
    retireCommand,
    recoverCommand,
    disposeCommand,
    historicalTerminationCommand,
    decisionsCommand,
    decideCommand,
  ]),
);
