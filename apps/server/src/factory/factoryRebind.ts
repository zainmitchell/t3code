// @effect-diagnostics nodeBuiltinImport:off - pins and successors are sha256 digests.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { FactoryGitObject, FactoryGitReadbackError } from "./FactoryGitReadback.ts";
import { canonical } from "./factoryOutcomes.ts";

/** A pinned verification input an authorized correction invalidates: the predecessor T3 rereads. */
export interface RebindPin {
  readonly root: string;
  readonly path: string;
  readonly sha256: string;
}

/**
 * A rebind a decision asks for: the exact scope evidence the owner approved (a
 * `factory-correction-scope/1` document, or the owner question carrying one as `evidence`) and the
 * predecessors it names.
 */
export interface RebindRequest {
  readonly evidence: string;
  readonly pins: ReadonlyArray<RebindPin>;
}

/** An owner decision as T3 recorded it: only its identity, evidence digest and settled answer count. */
export interface RebindApproval {
  readonly itemKey: string;
  readonly kind?: "gate" | "grant" | undefined;
  readonly state: string;
  readonly evidenceDigest: string;
  readonly resolution?:
    | { readonly answer: string; readonly grantId?: string | undefined }
    | undefined;
}

export interface RebindDeps {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly insideRoot: (root: string, file: string) => Effect.Effect<boolean>;
  readonly objectsAt: (input: {
    readonly commit: string;
    readonly paths: ReadonlyArray<string>;
  }) => Effect.Effect<
    {
      readonly commit: string;
      readonly tree: string;
      readonly objects: ReadonlyArray<FactoryGitObject>;
    },
    FactoryGitReadbackError
  >;
}

export interface RebindInput {
  readonly request: RebindRequest;
  readonly itemKey: string;
  readonly itemVersion: string;
  /** The engine-verified head the successor is derived at. */
  readonly head: string;
  /** The Root-adopted root predecessors may come from; none configured refuses every rebind. */
  readonly pinRoot: string | undefined;
  readonly artifactRoot: string;
  readonly approvals: ReadonlyArray<RebindApproval>;
}

export type RebindResult =
  | { readonly basis: string; readonly note: string; readonly successor: string }
  | {
      readonly what: string;
      readonly actor: string;
      readonly action: string;
      readonly held: boolean;
    };

const SCOPE_SCHEMA = "factory-correction-scope/1";
const PIN_SCHEMA = "factory-source-pin/1";
const MAX_PINS = 16;
const MAX_OBJECTS = 2_000;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;

const sha256 = (data: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(data).digest("hex");

const canonicalPath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.split("/").every((part) => SEGMENT.test(part) && part !== "." && part !== "..");

const within = (path: string, scope: ReadonlyArray<string>) =>
  scope.some((allowed) => path === allowed || (allowed.endsWith("/") && path.startsWith(allowed)));

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const parse = (text: string): unknown => Option.getOrUndefined(decodeJson(text));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The scope the evidence carries: the document itself, or the one an owner question asked on. */
const scopeOf = (evidence: string) => {
  const parsed = parse(evidence);
  const scope =
    isRecord(parsed) && parsed.schema === SCOPE_SCHEMA
      ? parsed
      : isRecord(parsed)
        ? parsed.evidence
        : undefined;
  return isRecord(scope) && scope.schema === SCOPE_SCHEMA ? scope : undefined;
};

const approvedBy = (
  approvals: ReadonlyArray<RebindApproval>,
  itemKey: string,
  evidence: string,
) => {
  const digest = sha256(evidence);
  return approvals.some((decision) => {
    const answer = decision.resolution?.answer.trim().toLowerCase() ?? "";
    return (
      decision.itemKey === itemKey &&
      decision.state === "resolved" &&
      decision.evidenceDigest === digest &&
      ((decision.kind ?? "gate") === "gate"
        ? answer === "approve"
        : (answer === "grant" || answer === "approve") &&
          decision.resolution?.grantId !== undefined)
    );
  });
};

/**
 * The first component below the root that is not a plain directory or regular file (a link, junction
 * or other reparse point, or unreadable), read without following links, so an in-root alias is refused
 * even when its target is inside the root. Metadata is read before the bytes: a swap between the two
 * reads is not excluded by this API, so a derivation is reviewed, never trusted.
 */
const linkedComponent = Effect.fnUntraced(function* (
  path: Path.Path,
  root: string,
  relative: string,
) {
  const parts = relative.split("/");
  // The OS's own final path for an opened handle (GetFinalPathNameByHandle on Windows): a component
  // that redirects anywhere, whatever its reparse tag, resolves away from its lexical place. Node's
  // lstat alone misses mount points it cannot express as links (volume-GUID junctions).
  const finalPath = (target: string) =>
    Effect.try(() => NodeFS.realpathSync.native(target)).pipe(Effect.option);
  // Windows paths compare case-insensitively; elsewhere a case change is another entry.
  const same = (left: string, right: string) =>
    path.sep === "\\"
      ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
      : path.normalize(left) === path.normalize(right);
  let current = path.resolve(root);
  let resolved = yield* finalPath(current);
  if (Option.isNone(resolved)) return "the pin root: unreadable";
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const info = yield* Effect.tryPromise(() => NodeFS.promises.lstat(current)).pipe(Effect.option);
    if (Option.isNone(info)) return `${part}: unreadable`;
    if (info.value.isSymbolicLink()) return `${part}: link`;
    const last = index === parts.length - 1;
    if (last ? !info.value.isFile() : !info.value.isDirectory()) {
      return `${part}: not a ${last ? "regular file" : "directory"}`;
    }
    const actual = yield* finalPath(current);
    if (Option.isNone(actual)) return `${part}: unreadable`;
    if (!same(actual.value, path.join(resolved.value, part))) return `${part}: reparse point`;
    resolved = actual;
  }
  return undefined;
});

const coordinator = (what: string, action: string): RebindResult => ({
  what,
  actor: "Root coordinator",
  action,
  held: false,
});

/**
 * Each approved pin's successor at the verified head, recorded content-addressed beside an untouched
 * predecessor; any change outside the scope's authorized writes refuses. Deriving accepts nothing.
 */
export const derivePinRebind = Effect.fnUntraced(function* (deps: RebindDeps, input: RebindInput) {
  const { fs, path } = deps;
  const { request } = input;
  const scope = scopeOf(request.evidence);
  if (scope === undefined || scope.itemKey !== input.itemKey) {
    return coordinator(
      "the rebind names no correction scope of this item",
      "propose the rebind on the scope the owner approved",
    );
  }
  if (scope.itemVersion !== input.itemVersion) {
    return coordinator(
      `the approved scope is for item version ${String(scope.itemVersion)}, not the current ${input.itemVersion}`,
      "ask the owner on the current item version",
    );
  }
  if (!approvedBy(input.approvals, input.itemKey, request.evidence)) {
    return {
      what: "no owner approval of exactly this scope names its pinned inputs",
      actor: "owner",
      action: "approve the correction scope that names them, or decline it",
      held: true,
    } satisfies RebindResult;
  }
  const authorized = Array.isArray(scope.paths) ? scope.paths.filter(canonicalPath) : [];
  const named = Array.isArray(scope.pinnedInputs) ? scope.pinnedInputs.filter(isRecord) : [];
  if (request.pins.length === 0 || request.pins.length > MAX_PINS || authorized.length === 0) {
    return coordinator(
      "the rebind names no pins, too many, or a scope with no writes",
      "name each pin once",
    );
  }
  if (input.pinRoot === undefined) {
    return coordinator(
      "no pin root is adopted in the factory's verification configuration",
      "adopt verification.templateRoot for pinned inputs",
    );
  }
  // The head is an engine-verified commit, possibly abbreviated; the successor records its full id.
  if (!/^[0-9a-f]{7,40}$/.test(input.head)) {
    return coordinator(`head ${input.head} is not a commit`, "rebind at a verified head");
  }
  const notes: Array<string> = [];
  const digests: Array<string> = [];
  for (const pin of request.pins) {
    const joined = `${pin.root.replace(/\\/g, "/").replace(/\/$/, "")}/${pin.path}`;
    if (
      path.resolve(pin.root) !== path.resolve(input.pinRoot) ||
      !SHA256.test(pin.sha256) ||
      !canonicalPath(pin.path) ||
      !named.some(
        (entry) =>
          entry.sha256 === pin.sha256 && (entry.path === pin.path || entry.path === joined),
      )
    ) {
      return coordinator(
        `pin ${pin.path} (sha256 ${pin.sha256}) is not one the approved scope names inside the adopted pin root`,
        "propose only pins the approved scope names, under the adopted root",
      );
    }
    const file = path.resolve(input.pinRoot, pin.path);
    const inside = yield* deps.insideRoot(input.pinRoot, file);
    const linked = inside ? yield* linkedComponent(path, input.pinRoot, pin.path) : undefined;
    if (linked !== undefined) {
      return coordinator(
        `predecessor ${pin.path} is, or lies under, a link or reparse point (${linked}) inside the pin root`,
        "pin the predecessor at its real path; a linked predecessor is never read",
      );
    }
    const bytes = inside ? yield* fs.readFile(file).pipe(Effect.option) : Option.none<Uint8Array>();
    if (Option.isNone(bytes) || sha256(bytes.value) !== pin.sha256) {
      return coordinator(
        `predecessor ${pin.path} is unreadable, outside the pin root or not sha256 ${pin.sha256}`,
        "restore the exact predecessor the scope names",
      );
    }
    const document = parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes.value));
    const objects = isRecord(document) && Array.isArray(document.objects) ? document.objects : [];
    const listed = objects.flatMap((entry) =>
      isRecord(entry) &&
      canonicalPath(entry.path) &&
      typeof entry.sha256 === "string" &&
      SHA256.test(entry.sha256)
        ? [{ path: entry.path, sha256: entry.sha256 }]
        : [],
    );
    const paths = listed.map((entry) => entry.path);
    if (
      !isRecord(document) ||
      !COMMIT.test(String(document.commit)) ||
      listed.length === 0 ||
      listed.length !== objects.length ||
      listed.length > MAX_OBJECTS ||
      new Set(paths).size !== paths.length
    ) {
      return coordinator(
        `predecessor ${pin.path} is not a source pin T3 reads (commit, then objects of unique canonical paths with sha256)`,
        "pin a source-object document",
      );
    }
    const read = yield* deps.objectsAt({ commit: input.head, paths }).pipe(Effect.result);
    if (read._tag === "Failure") {
      return coordinator(
        `T3 could not read the pinned objects at ${input.head}`,
        "retry once the repository reads back",
      );
    }
    const at = new Map(read.success.objects.map((object) => [object.path, object]));
    const unreadable = paths.filter((entry) => at.get(entry)?.kind !== "blob");
    if (unreadable.length > 0) {
      return coordinator(
        `${unreadable.length} pinned object(s) are not readable files at ${input.head}: ${unreadable.slice(0, 5).join(", ")}`,
        "correct the pin or the head; a missing, linked or binary object is never rebound",
      );
    }
    const successorObjects = listed.map((entry) => ({
      path: entry.path,
      sha256: at.get(entry.path)!.sha256!,
    }));
    const delta = listed.flatMap((entry) => {
      const now = at.get(entry.path)!.sha256!;
      return now === entry.sha256 ? [] : [{ path: entry.path, from: entry.sha256, to: now }];
    });
    const outside = delta.filter((entry) => !within(entry.path, authorized));
    if (outside.length > 0) {
      return coordinator(
        `${outside.length} pinned object(s) changed outside the authorized writes: ${outside
          .slice(0, 5)
          .map((entry) => entry.path)
          .join(", ")}`,
        "nothing is rebound; correct the change or ask the owner for that scope",
      );
    }
    const text = `${canonical({
      schema: PIN_SCHEMA,
      predecessor: { path: pin.path, sha256: pin.sha256 },
      commit: read.success.commit,
      tree: read.success.tree,
      objects: successorObjects,
      delta,
    })}\n`;
    const digest = sha256(text);
    const target = path.join(path.resolve(input.artifactRoot), "rebind", `${digest}.json`);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.ignore);
    let existing = yield* fs.readFile(target).pipe(Effect.option);
    if (Option.isNone(existing)) {
      // Written whole under a private name, then linked into place: never a torn or overwritten record.
      const temp = `${target}.${NodeCrypto.randomUUID()}.tmp`;
      yield* fs
        .writeFileString(temp, text, { flag: "wx" })
        .pipe(Effect.andThen(fs.link(temp, target)), Effect.ignore);
      yield* fs.remove(temp).pipe(Effect.ignore);
      existing = yield* fs.readFile(target).pipe(Effect.option);
    }
    if (Option.isNone(existing) || sha256(existing.value) !== digest) {
      return coordinator(
        `the successor pin T3 records at ${target} does not read back`,
        "restore or remove it",
      );
    }
    digests.push(digest);
    notes.push(
      `Pinned input ${pin.path}: predecessor sha256 ${pin.sha256} (unchanged); successor ${target} sha256 ${digest}, derived at ${read.success.commit} (tree ${read.success.tree}); ${delta.length} changed object(s): ${delta.map((entry) => `${entry.path} ${entry.from.slice(0, 12)}->${entry.to.slice(0, 12)}`).join(", ") || "none"}.`,
    );
  }
  const record = sha256(digests.join("\n"));
  return {
    basis: `|rb:${record.slice(0, 32)}`,
    successor: digests.join(","),
    note: [
      ...notes,
      "T3 derived these successors; deriving them accepts nothing. Reproduce each from the head and judge every changed object against the approved correction.",
    ].join("\n"),
  } satisfies RebindResult;
});
