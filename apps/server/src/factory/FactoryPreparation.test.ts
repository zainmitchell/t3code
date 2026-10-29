// @effect-diagnostics nodeBuiltinImport:off - pins the real preparation policy fixture on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  FactoryDecisionKey,
  FactoryId,
  FactoryItemKey,
  FactoryObservationId,
  FactoryPoolId,
  FactoryReadGeneration,
  FactoryReservationId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProcessRunner from "../processRunner.ts";
import type { TrackerIssue } from "./factoryClaimPolicy.ts";
import * as FactoryCommandPolicy from "./FactoryCommandPolicy.ts";
import * as FactoryLifecycle from "./FactoryLifecycle.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import type * as FactoryStore from "./FactoryStore.ts";

const sha256 = (content: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

const fixturePath = NodePath.join(import.meta.dirname, "factoryPreparationPolicy.fixture.ts");
const fixtureSha256 = sha256(NodeFS.readFileSync(fixturePath));
const repository = "example-org/alpha";
const itemKey = FactoryItemKey.make(`github:${repository}#12`);
const decisionKey = FactoryDecisionKey.make("d".repeat(64));

type Project = "btc" | "hsa" | "connector";

const configuration = (project: Project): FactoryStore.FactoryConfiguration => ({
  factoryId: FactoryId.make(project),
  projectId: ProjectId.make(`project:${project}`),
  policyRevision: "policy-r1",
  enabled: true,
  pools: [{ poolId: FactoryPoolId.make("builders"), capacityUnits: 1 }],
  execution: {
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-test" },
    runtimeMode: "full-access",
    interactionMode: "default",
  },
  packet: { briefSchemaVersion: "brief-v1", helper: null },
  artifactRoot: process.cwd(),
  policy: { executable: process.execPath, script: fixturePath, sha256: fixtureSha256 },
  revision: 1,
  createdAt: "2026-10-29T00:00:00.000Z",
});

type Report = FactoryOutcomeStore.FactoryOutcome["report"];

const outcome = (
  outcomeId: string,
  report: Report,
  options: {
    readonly state?: "reported" | "verified" | "rejected";
    readonly stage?: FactoryLifecycle.FactoryPolicyOutcome["stage"];
    readonly itemVersion?: string;
    readonly itemKey?: FactoryItemKey;
    readonly policyRevision?: string;
  } = {},
): FactoryLifecycle.FactoryPolicyOutcome => {
  const fields = {
    outcomeId,
    factoryId: FactoryId.make("btc"),
    itemKey: options.itemKey ?? itemKey,
    origin: {
      type: "execution" as const,
      reservationId: FactoryReservationId.make(`reservation:${outcomeId}`),
      threadId: ThreadId.make(`thread:${outcomeId}`),
      runId: RunId.make(`run:${outcomeId}`),
    },
    stage: options.stage ?? "triage",
    report,
    reportDigest: sha256(JSON.stringify(report)),
    reportedAt: "2026-10-29T00:00:00.000Z",
    itemVersion: options.itemVersion ?? "v2",
    policyRevision: options.policyRevision ?? "policy-r1",
  };
  switch (options.state ?? "verified") {
    case "reported":
      return { ...fields, state: "reported" };
    case "verified":
      return { ...fields, state: "verified", receipt: { verifiedAt: "2026-10-29T00:00:01.000Z" } };
    case "rejected":
      return {
        ...fields,
        state: "rejected",
        rejection: "base 0000000 does not exist",
        rejectedAt: "2026-10-29T00:00:01.000Z",
      };
  }
};

const unit = "## Owned files\n- apps/server/src/a.ts\n\n## Checks\n- vp test run src/a.test.ts";

const proposed = (basis = "v2", splits?: ReadonlyArray<string>): Report => ({
  outcome: "unit_proposed",
  summary: "One bounded unit.",
  proposal: {
    basis,
    unit,
    ownedFiles: ["apps/server/src/a.ts"],
    ...(splits === undefined ? {} : { splits }),
  },
  subject: { repository, baseCommit: "1234567" },
});

const notActionable = (failure: string): Report => ({
  outcome: "not_actionable",
  summary: "Nothing bounded to build yet.",
  failure,
});

interface ItemInput {
  readonly body?: string;
  readonly labels?: ReadonlyArray<string>;
  readonly itemVersion?: string;
  readonly blockedBy?: TrackerIssue["blockedBy"];
  readonly subIssueCount?: number;
  readonly outcomes?: ReadonlyArray<FactoryLifecycle.FactoryPolicyOutcome>;
  readonly blockers?: FactoryLifecycle.FactoryPolicyItem["blockers"];
}

const issueOf = (input: ItemInput): TrackerIssue => ({
  state: "open",
  title: "Issue",
  body: input.body ?? "Make the importer count each row once.",
  labels: input.labels ?? [],
  comments: [],
  blockedBy: input.blockedBy === undefined ? [] : input.blockedBy,
  parent: null,
  ...(input.subIssueCount === undefined ? {} : { subIssueCount: input.subIssueCount }),
});

/** One pass of the project's policy over one item, through the engine's own translation. */
const decide = (
  project: Project,
  input: ItemInput,
  active: ReadonlyArray<{ readonly key: string; readonly body: string }> = [],
) =>
  Effect.gen(function* () {
    const config = configuration(project);
    const policy = yield* FactoryLifecycle.FactoryAdmissionPolicy;
    const proposer = Option.getOrThrow(
      policy.forFactory({
        factoryId: config.factoryId,
        policyRevision: config.policyRevision,
        configuration: config,
      }),
    );
    const answer = yield* proposer.decide({
      configuration: config,
      items: [
        {
          observation: {
            factoryId: config.factoryId,
            itemKey,
            itemVersion: input.itemVersion ?? "v2",
            generation: FactoryReadGeneration.make(1),
            complete: true,
            evidence: [],
            sources: [],
            claims: [],
            observationId: FactoryObservationId.make(1),
            basisDigest: "basis",
            observedAt: "2026-10-29T00:00:00.000Z",
          },
          issue: issueOf(input),
          stage: { type: "implement" },
          reserved: [],
          grants: [],
          outcomes: input.outcomes ?? [],
          ...(input.blockers === undefined ? {} : { blockers: input.blockers }),
          decisionKey,
        },
      ],
      active: active.map((work) => ({
        itemKey: FactoryItemKey.make(work.key),
        stage: "implement",
        custody: "native",
        issue: issueOf({ body: work.body }),
      })),
    });
    if (!Array.isArray(answer))
      return assert.fail(`expected decisions, got ${JSON.stringify(answer)}`);
    assert.strictEqual(answer.length, 1);
    return answer[0]!.decision;
  });

const admission = (decision: FactoryLifecycle.FactoryPolicyDecision) => {
  if (decision === undefined || "type" in decision) {
    return assert.fail(`expected an admission, got ${JSON.stringify(decision)}`);
  }
  return decision;
};

const layer = FactoryCommandPolicy.layer.pipe(
  Layer.provide(ProcessRunner.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.live(
  "Prepare: a ready issue builds as it stands; one without a unit is prepared, then adopted",
  () =>
    Effect.gen(function* () {
      // An issue that already carries its unit goes straight to the build, never through triage.
      const ready = admission(
        yield* decide("btc", { body: "## Owned files\n- apps/server/src/a.ts" }),
      );
      assert.strictEqual(ready.taskKind, "implement");

      for (const project of ["btc", "hsa", "connector"] as const) {
        const triage = admission(yield* decide(project, {}));
        assert.strictEqual(triage.taskKind, "triage", project);
        assert.include(triage.packet.text, "at item version v2");
        // T3's footer binds the proposal to the exact version the worker read.
        assert.include(triage.packet.text, "Item version: v2. Report it as proposal.basis");
        // The worker prepares from verified evidence and settles routine gaps, never authority.
        assert.include(
          triage.packet.text,
          "the project's rules and the repository at its integration base",
        );
        assert.include(
          triage.packet.text,
          "a missing permission, product decision or owner hold is never yours to settle",
        );
        assert.include(triage.packet.text, "subject.baseCommit = the commit the unit starts from");
        assert.include(
          triage.packet.text,
          "`decision:` (the one question, its consequence and the exact action that answers it)",
        );
        assert.include(triage.packet.text, "- unit_proposed with proposal.basis");
      }

      const prepared = [outcome("triage-1", proposed())];
      const auto = admission(yield* decide("btc", { outcomes: prepared }));
      assert.strictEqual(auto.taskKind, "implement");
      assert.include(auto.packet.text, `Build the prepared unit triage-1 of ${itemKey}`);
      assert.include(auto.packet.text, unit);
      assert.isUndefined(auto.requiresGrant);
      // An unchanged pass decides the same start, so the engine admits it once.
      const again = admission(yield* decide("btc", { outcomes: prepared }));
      assert.strictEqual(again.packet.sha256, auto.packet.sha256);

      // The connector's configuration adopts a proposal only through the owner's grant for it.
      const owned = admission(yield* decide("connector", { outcomes: prepared }));
      assert.deepStrictEqual(owned.requiresGrant, {
        reason: "The owner adopts each prepared unit before its build starts.",
        evidenceDigest: sha256(`adopt triage-1 at v2: ${sha256(unit)}`),
      });
    }).pipe(Effect.provide(layer)),
);

it.live("Prepare: an umbrella yields only the bounded child its project permits", () =>
  Effect.gen(function* () {
    const split = "Count each imported row once in the CSV importer.";
    assert.deepStrictEqual(yield* decide("btc", { subIssueCount: 2 }), {
      type: "none",
      class: "parent",
      reason: "an umbrella is not a unit; its bounded children are filed by a person",
    });
    // A project that permits children prepares the parent and spawns its first split once.
    assert.strictEqual(admission(yield* decide("hsa", { subIssueCount: 2 })).taskKind, "triage");
    const prepared = outcome("triage-parent", proposed("v2", [split, "Second split."]));
    assert.deepStrictEqual(yield* decide("hsa", { subIssueCount: 2, outcomes: [prepared] }), {
      type: "spawn",
      reason: `the prepared split of ${itemKey}`,
      ticket: { title: split, body: split, labels: [], parentIssueNumber: 12, blocks: [] },
    });
    const opened = outcome(
      "ticket-1",
      { outcome: "ticket_opened", summary: "Opened #13." },
      { stage: "implement" },
    );
    // The parent itself is never built or closed from its preparation.
    assert.deepStrictEqual(
      yield* decide("hsa", { subIssueCount: 2, outcomes: [prepared, opened] }),
      {
        type: "none",
        class: "parent",
        reason: "an umbrella is not built; its prepared child carries the work",
      },
    );
  }).pipe(Effect.provide(layer)),
);

it.live(
  "Prepare: a person-gated blocker is asked once or held, and a hold outlasts a proposal",
  () =>
    Effect.gen(function* () {
      const question =
        "decision: export totals in EUR or the account currency? Consequence: the report format. Action: comment the choice on the issue.";
      const asked = yield* decide("connector", {
        outcomes: [outcome("triage-q", notActionable(question))],
      });
      assert.deepStrictEqual(asked, {
        type: "reserve",
        reason: question,
        evidenceDigest: sha256(question),
      });
      // The same blocker on a later pass is the same question, never a second one.
      assert.deepStrictEqual(
        yield* decide("connector", { outcomes: [outcome("triage-q", notActionable(question))] }),
        asked,
      );
      for (const kind of ["permission", "private_data", "ownership", "hold"]) {
        const failure = `${kind}: the unit needs what only the owner can give`;
        assert.deepStrictEqual(
          yield* decide("btc", { outcomes: [outcome(`triage-${kind}`, notActionable(failure))] }),
          { type: "none", class: "held", reason: failure },
          kind,
        );
      }
      assert.deepStrictEqual(
        yield* decide("btc", { outcomes: [outcome("triage-x", notActionable("unclear scope"))] }),
        { type: "none", class: "not_actionable", reason: "unclear scope" },
      );
      assert.deepStrictEqual(
        yield* decide("btc", { labels: ["hold"], outcomes: [outcome("triage-1", proposed())] }),
        { type: "none", class: "held", reason: "an owner hold is on this item" },
      );
    }).pipe(Effect.provide(layer)),
);

it.live(
  "Prepare: a prepared unit waits on its dependency and starts once its work is integrated",
  () =>
    Effect.gen(function* () {
      const prepared = outcome("triage-1", proposed());
      assert.deepStrictEqual(
        yield* decide("hsa", {
          outcomes: [prepared],
          blockedBy: [{ repository, number: 7, state: "open" }],
        }),
        {
          type: "none",
          class: "waiting",
          reason: "waits on #7; resumes when it closes integrated",
        },
      );
      const blocker = FactoryItemKey.make(`github:${repository}#7`);
      const closed = [{ repository, number: 7, state: "closed" as const }];
      assert.deepStrictEqual(
        yield* decide("hsa", {
          outcomes: [prepared],
          blockedBy: closed,
          blockers: [{ itemKey: blocker, outcomes: [] }],
        }),
        {
          type: "none",
          class: "waiting",
          reason: `waits on ${blocker}: closed without integrated work`,
        },
      );
      const integrated = outcome(
        "integrated-7",
        { outcome: "integrated", summary: "Landed." },
        { stage: "integrate", itemKey: blocker },
      );
      const resumed = admission(
        yield* decide("hsa", {
          outcomes: [prepared],
          blockedBy: closed,
          blockers: [{ itemKey: blocker, outcomes: [integrated] }],
        }),
      );
      assert.strictEqual(resumed.taskKind, "implement");
      assert.include(resumed.packet.text, "Build the prepared unit triage-1");
    }).pipe(Effect.provide(layer)),
);

it.live("Prepare: a stale, rejected, unverified or contested proposal never starts the build", () =>
  Effect.gen(function* () {
    // A proposal for older text is no unit for the current one: the item is prepared again.
    const stale = admission(
      yield* decide("btc", { itemVersion: "v3", outcomes: [outcome("triage-1", proposed())] }),
    );
    assert.strictEqual(stale.taskKind, "triage");
    assert.include(stale.packet.text, "Item version: v3.");

    // The latest result for the version decides: a later rejection withdraws an earlier proposal.
    assert.deepStrictEqual(
      yield* decide("btc", {
        outcomes: [
          outcome("triage-1", proposed()),
          outcome("triage-2", proposed(), { state: "rejected" }),
        ],
      }),
      {
        type: "none",
        class: "not_actionable",
        reason:
          "the preparation of this version was rejected; it is prepared again when the issue changes",
      },
    );
    assert.deepStrictEqual(
      yield* decide("btc", { outcomes: [outcome("triage-1", proposed(), { state: "reported" })] }),
      { type: "none", class: "triage_pending", reason: "the proposal is not verified yet" },
    );
    const other = `github:${repository}#30`;
    assert.deepStrictEqual(
      yield* decide("btc", { outcomes: [outcome("triage-1", proposed())] }, [
        { key: other, body: "## Owned files\n- apps/server/src/a.ts" },
      ]),
      { type: "none", class: "waiting", reason: `its owned files are in use by ${other}` },
    );
  }).pipe(Effect.provide(layer)),
);

it.live(
  "Prepare: T3 refuses a build that adopts a stale preparation, and a new policy prepares again",
  () =>
    Effect.gen(function* () {
      const adopt = ["adopt:triage-1"];
      const fresh = outcome("triage-1", proposed());
      assert.strictEqual(
        admission(yield* decide("btc", { labels: adopt, outcomes: [fresh] })).taskKind,
        "implement",
      );
      const stale = (reason: string) => ({
        type: "none",
        class: "prepared_stale",
        reason: `prepared unit is stale: ${reason}`,
      });
      const cases: ReadonlyArray<readonly [string, ItemInput, string]> = [
        [
          "a newer preparation of the same text",
          { outcomes: [fresh, outcome("triage-2", proposed())] },
          "triage-1 is not the latest preparation of item version v2",
        ],
        [
          "a proposal for older text",
          { itemVersion: "v3", outcomes: [fresh] },
          "triage-1 is not the latest preparation of item version v3",
        ],
        [
          "a rejected proposal",
          { outcomes: [outcome("triage-1", proposed(), { state: "rejected" })] },
          "triage-1 is not a verified proposal",
        ],
        [
          "a result that proposed nothing",
          { outcomes: [outcome("triage-1", notActionable("hold: the owner paused it"))] },
          "triage-1 is not a verified proposal",
        ],
        [
          "a proposal made under another policy",
          { outcomes: [outcome("triage-1", proposed(), { policyRevision: "policy-r0" })] },
          "triage-1 was prepared under policy policy-r0, not policy-r1",
        ],
      ];
      for (const [name, input, reason] of cases) {
        assert.deepStrictEqual(
          yield* decide("btc", { ...input, labels: adopt }),
          stale(reason),
          name,
        );
      }
      // The project's own policy reads the same fact and prepares the item again instead.
      const revalidated = admission(
        yield* decide("btc", {
          outcomes: [outcome("triage-1", proposed(), { policyRevision: "policy-r0" })],
        }),
      );
      assert.strictEqual(revalidated.taskKind, "triage");
    }).pipe(Effect.provide(layer)),
);
