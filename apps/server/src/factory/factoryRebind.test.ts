// @effect-diagnostics nodeBuiltinImport:off - disposable pin roots and their digests, set up directly.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { FactoryGitReadbackError, type FactoryGitObject } from "./FactoryGitReadback.ts";
import { makeInsideRoot } from "./FactoryLifecycle.ts";
import { derivePinRebind, type RebindApproval } from "./factoryRebind.ts";
import { createVolumeJunction } from "./reparse.fixture.ts";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const head = "a".repeat(40);
const itemKey = "github:example-org/alpha#152";
const itemVersion = "v".repeat(32);

/** Files at the head the fake repository answers for; a `{ link }` is a symbolic link. */
type Files = Record<string, string | { readonly link: string }>;

const setup = (options: {
  readonly predecessor?: Record<string, unknown>;
  readonly files?: Files;
  readonly scope?: Record<string, unknown>;
  readonly approval?: "approve" | "reject" | "grant-without-units" | "none";
  readonly unreadable?: boolean;
  /** The predecessor is reached through an in-root junction: as an ancestor, or in the file's own place. */
  readonly link?: "ancestor" | "final" | "volume";
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "rebind-"));
    // Each test owns its fixture root alone; a junction inside it is unlinked, never followed.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
    );
    const pinRoot = NodePath.join(root, "pins");
    const artifactRoot = NodePath.join(root, "artifacts");
    NodeFS.mkdirSync(NodePath.join(pinRoot, "real"), { recursive: true });
    const predecessor = options.predecessor ?? {
      commit: "b".repeat(40),
      objects: [
        { path: "btclink/route/run.py", sha256: sha256("old run") },
        { path: "btclink/tests/test_a.py", sha256: sha256("test a") },
      ],
    };
    const bytes = JSON.stringify(predecessor);
    NodeFS.writeFileSync(NodePath.join(pinRoot, "real", "units.json"), bytes);
    let relative = "real/units.json";
    if (options.link === "volume") {
      createVolumeJunction(NodePath.join(pinRoot, "real"), NodePath.join(pinRoot, "alias"));
      relative = "alias/units.json";
    } else if (options.link === "ancestor") {
      NodeFS.symlinkSync(
        NodePath.join(pinRoot, "real"),
        NodePath.join(pinRoot, "alias"),
        "junction",
      );
      relative = "alias/units.json";
    } else if (options.link === "final") {
      NodeFS.symlinkSync(
        NodePath.join(pinRoot, "real"),
        NodePath.join(pinRoot, "units.json"),
        "junction",
      );
      relative = "units.json";
    }
    const pin = { root: pinRoot, path: relative, sha256: sha256(bytes) };
    const scope = {
      schema: "factory-correction-scope/1",
      itemKey,
      itemVersion,
      paths: ["btclink/route/run.py", "btclink/tests/test_pilot.py"],
      pinnedInputs: [
        { path: `${pinRoot.replace(/\\/g, "/")}/${relative}`, sha256: pin.sha256, by: "builder" },
      ],
      ...options.scope,
    };
    const evidence = JSON.stringify(scope);
    const approval = options.approval ?? "approve";
    const approvals: Array<RebindApproval> =
      approval === "none"
        ? []
        : approval === "grant-without-units"
          ? [
              {
                itemKey,
                kind: "grant",
                state: "resolved",
                evidenceDigest: sha256(evidence),
                resolution: { answer: "grant" },
              },
            ]
          : [
              {
                itemKey,
                kind: "gate",
                state: "resolved",
                evidenceDigest: sha256(evidence),
                resolution: { answer: approval },
              },
            ];
    const files: Files = options.files ?? {
      "btclink/route/run.py": "new run",
      "btclink/tests/test_a.py": "test a",
    };
    const reads: Array<ReadonlyArray<string>> = [];
    const derive = derivePinRebind(
      {
        fs,
        path,
        insideRoot: makeInsideRoot(fs, path),
        objectsAt: ({ paths }) => {
          reads.push(paths);
          if (options.unreadable === true) {
            return Effect.fail(
              new FactoryGitReadbackError({ operation: "objectsAt", cause: "unreadable" }),
            );
          }
          return Effect.succeed({
            commit: head,
            tree: "c".repeat(40),
            objects: paths.map((entry): FactoryGitObject => {
              const file = files[entry];
              return file === undefined
                ? { path: entry, kind: "missing" }
                : typeof file === "string"
                  ? { path: entry, kind: "blob", sha256: sha256(file) }
                  : { path: entry, kind: "link" };
            }),
          });
        },
      },
      {
        request: { evidence, pins: [pin] },
        itemKey,
        itemVersion,
        head,
        pinRoot,
        artifactRoot,
        approvals,
      },
    );
    return { derive, pin, pinRoot, artifactRoot, bytes, reads };
  });

const waits = (result: Record<string, unknown>) =>
  "what" in result ? String(result.what) : "derived";

it.layer(NodeServices.layer)("factoryRebind", (it) => {
  it.effect(
    "E1: an approved rebind records the successor beside the untouched predecessor, the same every time",
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup({});
        const first = yield* fixture.derive;
        assert.isTrue("basis" in first, waits(first));
        if (!("basis" in first)) return;
        assert.match(first.basis, /^\|rb:[0-9a-f]{32}$/);
        const written = NodeFS.readdirSync(NodePath.join(fixture.artifactRoot, "rebind"));
        assert.deepStrictEqual(written, [`${first.successor}.json`]);
        const successor = JSON.parse(
          NodeFS.readFileSync(NodePath.join(fixture.artifactRoot, "rebind", written[0]!), "utf8"),
        );
        assert.deepStrictEqual(successor.delta, [
          { from: sha256("old run"), path: "btclink/route/run.py", to: sha256("new run") },
        ]);
        assert.strictEqual(successor.commit, head);
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(fixture.pinRoot, "real", "units.json"), "utf8"),
          fixture.bytes,
        );
        assert.include(first.note, "deriving them accepts nothing");
        const again = yield* (yield* setup({})).derive;
        assert.isTrue("basis" in again);
        // Retry: the record is content-addressed, so a second derivation names the same bytes.
        assert.deepStrictEqual(yield* fixture.derive, first);
      }).pipe(Effect.scoped),
  );

  it.effect("E1: every unproven or unauthorized rebind refuses, and nothing is recorded", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, Parameters<typeof setup>[0], RegExp]> = [
        ["no owner approval", { approval: "none" }, /no owner approval/],
        ["declined", { approval: "reject" }, /no owner approval/],
        ["grant answered without units", { approval: "grant-without-units" }, /no owner approval/],
        ["another item version", { scope: { itemVersion: "w".repeat(32) } }, /item version/],
        [
          "pin not in the approved scope",
          { scope: { pinnedInputs: [] } },
          /not one the approved scope names/,
        ],
        [
          "an object changed outside the authorized writes",
          { files: { "btclink/route/run.py": "new run", "btclink/tests/test_a.py": "edited" } },
          /changed outside the authorized writes/,
        ],
        [
          "a missing object",
          { files: { "btclink/route/run.py": "new run" } },
          /not readable files/,
        ],
        [
          "a linked object",
          {
            files: {
              "btclink/route/run.py": "new run",
              "btclink/tests/test_a.py": { link: "../x" },
            },
          },
          /not readable files/,
        ],
        ["an unreadable repository", { unreadable: true }, /could not read/],
        [
          "a predecessor with a traversing path",
          {
            predecessor: {
              commit: "b".repeat(40),
              objects: [{ path: "../etc/passwd", sha256: sha256("x") }],
            },
          },
          /not a source pin/,
        ],
        [
          "a predecessor naming an object twice",
          {
            predecessor: {
              commit: "b".repeat(40),
              objects: [
                { path: "btclink/route/run.py", sha256: sha256("old run") },
                { path: "btclink/route/run.py", sha256: sha256("old run") },
              ],
            },
          },
          /not a source pin/,
        ],
      ];
      for (const [label, options, expected] of cases) {
        const fixture = yield* setup(options);
        const result = yield* fixture.derive;
        assert.match(waits(result), expected, label);
        assert.isFalse(NodeFS.existsSync(NodePath.join(fixture.artifactRoot, "rebind")), label);
      }
      // A stale pin: the predecessor no longer has the bytes the decision names.
      const stale = yield* setup({});
      NodeFS.writeFileSync(NodePath.join(stale.pinRoot, "real", "units.json"), `${stale.bytes} `);
      assert.match(waits(yield* stale.derive), /not sha256/);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "E1: a predecessor reached through an in-root junction is refused before it is read",
    () =>
      Effect.gen(function* () {
        for (const link of ["ancestor", "final", "volume"] as const) {
          const fixture = yield* setup({ link });
          if (link === "volume") {
            // Windows uses a mount point; the POSIX fixture uses a directory symlink.
            assert.strictEqual(
              NodeFS.lstatSync(NodePath.join(fixture.pinRoot, "alias")).isSymbolicLink(),
              process.platform !== "win32",
            );
          }
          if (link !== "final") {
            // The alias resolves inside the root and its bytes match: containment alone would admit it.
            assert.strictEqual(
              sha256(NodeFS.readFileSync(NodePath.join(fixture.pinRoot, fixture.pin.path), "utf8")),
              fixture.pin.sha256,
            );
          }
          assert.match(waits(yield* fixture.derive), /link or reparse point/, link);
          assert.deepStrictEqual(
            fixture.reads,
            [],
            `${link}: no object is read for a linked predecessor`,
          );
          assert.isFalse(NodeFS.existsSync(NodePath.join(fixture.artifactRoot, "rebind")), link);
        }
      }).pipe(Effect.scoped),
  );
});
