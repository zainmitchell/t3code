import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Who may write for a command job. Its own runner, until a native owner takes the job's work
 * over; from then on the runner starts no pass and applies nothing, until every holder has given
 * the work back. The generation changes at each hand-over, so a pass that started under an
 * earlier one cannot write after it, whatever it had queued.
 */
export const CommandJobWriter = Schema.Struct({
  job: Schema.String,
  generation: Schema.Int,
  /** The native owners holding the job's work instead of its runner; empty while it writes. */
  holders: Schema.Array(Schema.String),
});
export type CommandJobWriter = typeof CommandJobWriter.Type;

export class CommandJobFenceError extends Schema.TaggedError<CommandJobFenceError>()(
  "CommandJobFenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Command job fence ${this.operation} failed.`;
  }
}

export class CommandJobFence extends Context.Service<
  CommandJobFence,
  {
    readonly current: (job: string) => Effect.Effect<CommandJobWriter, CommandJobFenceError>;
    /** Takes the job's writes from its runner for `holder`; raising again changes nothing. */
    readonly raise: (input: {
      readonly job: string;
      readonly holder: string;
    }) => Effect.Effect<CommandJobWriter, CommandJobFenceError>;
    /** Gives `holder`'s share back; the runner writes again once no holder is left. */
    readonly lift: (input: {
      readonly job: string;
      readonly holder: string;
    }) => Effect.Effect<CommandJobWriter, CommandJobFenceError>;
  }
>()("t3/commandJobs/CommandJobFence") {}

const WriterJson = Schema.fromJsonString(CommandJobWriter);
const encodeWriter = Schema.encodeEffect(WriterJson);
const decodeWriter = Schema.decodeUnknownEffect(WriterJson);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) =>
    new CommandJobFenceError({ operation, cause });

  const read = (job: string) =>
    sql<{ readonly record_json: string }>`
      SELECT record_json FROM command_job_fences WHERE job_name = ${job}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed<CommandJobWriter>({ job, generation: 0, holders: [] })
          : decodeWriter(rows[0].record_json),
      ),
    );

  const change = (job: string, next: (writer: CommandJobWriter) => CommandJobWriter) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const writer = yield* read(job);
        const changed = next(writer);
        if (changed === writer) return writer;
        // A hand-over between the runner and native owners starts a new generation.
        const handedOver = (writer.holders.length === 0) !== (changed.holders.length === 0);
        const stored = handedOver ? { ...changed, generation: writer.generation + 1 } : changed;
        const json = yield* encodeWriter(stored);
        yield* sql`
          INSERT INTO command_job_fences (job_name, generation, record_json)
          VALUES (${job}, ${stored.generation}, ${json})
          ON CONFLICT(job_name) DO UPDATE SET
            generation = excluded.generation, record_json = excluded.record_json
        `;
        return stored;
      }),
    );

  return CommandJobFence.of({
    current: Effect.fn("CommandJobFence.current")(function (job) {
      return read(job).pipe(Effect.mapError(fail("current")));
    }),
    raise: Effect.fn("CommandJobFence.raise")(function ({ job, holder }) {
      return change(job, (writer) =>
        writer.holders.includes(holder)
          ? writer
          : { ...writer, holders: [...writer.holders, holder] },
      ).pipe(Effect.mapError(fail("raise")));
    }),
    lift: Effect.fn("CommandJobFence.lift")(function ({ job, holder }) {
      return change(job, (writer) =>
        writer.holders.includes(holder)
          ? { ...writer, holders: writer.holders.filter((held) => held !== holder) }
          : writer,
      ).pipe(Effect.mapError(fail("lift")));
    }),
  });
});

export const layer = Layer.effect(CommandJobFence, make);
