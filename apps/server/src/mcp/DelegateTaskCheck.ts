import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

// An operator names a verifier argv (a JSON string array) here. Once set, a new delegate_task starts
// only after the verifier exits 0 for the exact task and its dispatch context on stdin; the verifier
// owns which workspaces it enforces. Any failure to run it refuses the task rather than skipping it.
export const DELEGATE_TASK_CHECK_ENV = "T3CODE_DELEGATE_TASK_CHECK";

export const DelegateTaskCheckRequest = Schema.Struct({
  task: Schema.String,
  workspaceRoot: Schema.String,
  checkoutPath: Schema.String,
  isolation: Schema.Literals(["shared", "worktree"]),
  baseCommit: Schema.NullOr(Schema.String),
  driver: Schema.String,
  providerInstanceId: Schema.String,
});
export type DelegateTaskCheckRequest = typeof DelegateTaskCheckRequest.Type;

const rejectionMessages = {
  misconfigured: `${DELEGATE_TASK_CHECK_ENV} must be a JSON array of strings.`,
  unavailable: `${DELEGATE_TASK_CHECK_ENV} is set but this server cannot run the verifier.`,
  failed_to_run: "The dispatch verifier could not be run.",
  timed_out: "The dispatch verifier timed out.",
  refused: "The dispatch verifier refused this task.",
} as const;

// The message reaches the calling agent; verifier output stays in `cause` for server logs only.
export class DelegateTaskCheckRejected extends Schema.TaggedError<DelegateTaskCheckRejected>()(
  "DelegateTaskCheckRejected",
  {
    category: Schema.Literals([
      "misconfigured",
      "unavailable",
      "failed_to_run",
      "timed_out",
      "refused",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return rejectionMessages[this.category];
  }
}

export class DelegateTaskCheck extends Context.Service<
  DelegateTaskCheck,
  {
    readonly check: (
      request: DelegateTaskCheckRequest,
    ) => Effect.Effect<void, DelegateTaskCheckRejected>;
  }
>()("t3/mcp/DelegateTaskCheck") {}

const decodeArgv = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.NonEmptyArray(Schema.String)),
);
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(DelegateTaskCheckRequest));

const make = Effect.gen(function* () {
  const configured = yield* Config.String(DELEGATE_TASK_CHECK_ENV).pipe(Config.option);
  if (Option.isNone(configured)) {
    return { check: () => Effect.void };
  }
  const argv = decodeArgv(configured.value);
  if (Option.isNone(argv)) {
    const misconfigured = new DelegateTaskCheckRejected({ category: "misconfigured" });
    return { check: () => Effect.fail(misconfigured) };
  }
  const [command, ...args] = argv.value;
  const runner = yield* ProcessRunner.ProcessRunner;
  return {
    check: Effect.fn("DelegateTaskCheck.check")(function* (request: DelegateTaskCheckRequest) {
      const output = yield* runner
        .run({
          command,
          args,
          stdin: encodeRequest(request),
          timeout: "60 seconds",
          timeoutBehavior: "timedOutResult",
          maxOutputBytes: 64 * 1024,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError(
            (error) => new DelegateTaskCheckRejected({ category: "failed_to_run", cause: error }),
          ),
        );
      if (output.timedOut) {
        return yield* new DelegateTaskCheckRejected({ category: "timed_out" });
      }
      if (output.code !== 0) {
        return yield* new DelegateTaskCheckRejected({ category: "refused", cause: output });
      }
    }),
  };
});

export const layer = Layer.effect(DelegateTaskCheck, make);

// Hosts and tests without a configured verifier keep delegation unchanged. A composition that omits the
// layer while the operator set the variable refuses every new task instead of silently skipping it.
export const fromContext = Effect.gen(function* () {
  const provided = yield* Effect.serviceOption(DelegateTaskCheck);
  if (Option.isSome(provided)) {
    return provided;
  }
  const configured = yield* Effect.orDie(
    Config.String(DELEGATE_TASK_CHECK_ENV).pipe(Config.option),
  );
  const unavailable = new DelegateTaskCheckRejected({ category: "unavailable" });
  return Option.map(configured, () => ({ check: () => Effect.fail(unavailable) }));
});
