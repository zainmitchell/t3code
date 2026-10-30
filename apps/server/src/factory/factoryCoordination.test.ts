import { assert, describe, it } from "@effect/vitest";
import { FactoryId, FactoryItemKey } from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  criterionToken,
  decodeCriteria,
  decodeVerificationDocument,
  defectChild,
  type ItemRecord,
  landingOf,
  namesPolicy,
  outputRootName,
  reconcileCriteria,
} from "./factoryCoordination.ts";
import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";

const repository = "example-org/btc";
const head = "4ead000000000000000000000000000000000145";
const merge = "3e70000000000000000000000000000000000145";
const tree = "7ee0000000000000000000000000000000000145";
const base = "ba5e000000000000000000000000000000000145";

const outcome = (
  outcomeId: string,
  itemKey: string,
  stage: FactoryOutcomeStore.FactoryOutcome["stage"],
  report: FactoryOutcomeStore.FactoryOutcome["report"],
): FactoryOutcomeStore.FactoryOutcome => ({
  outcomeId,
  factoryId: FactoryId.make("btc"),
  itemKey: FactoryItemKey.make(itemKey),
  origin: { type: "native" },
  stage,
  report,
  reportDigest: outcomeId,
  reportedAt: "2026-10-30T00:00:00.000Z",
  state: "verified",
  receipt: { verifiedAt: "2026-10-30T00:00:00.000Z" },
});

/** A child built, independently reviewed and landed by a receipt T3 matched (`proved`). */
const landedRecord = (issue: number, proved = true): ItemRecord => {
  const itemKey = `github:${repository}#${issue}`;
  return {
    itemKey,
    outcomes: [
      outcome(`${issue}-implement`, itemKey, "implement", {
        outcome: "implemented",
        subject: { repository, baseCommit: base, headCommit: head },
        summary: "Built.",
      }),
      outcome(`${issue}-review`, itemKey, "review", {
        outcome: "review_passed",
        subject: { repository, headCommit: head },
        summary: "Reviewed.",
      }),
      {
        ...outcome(`${issue}-integrate`, itemKey, "integrate", {
          outcome: "integrated",
          summary: "Landed.",
          integration: {
            targetBranch: "main",
            mergeCommit: merge,
            parents: [base, head],
            tree,
            attribution: "operation",
          },
        }),
        ...(proved
          ? { landingOrigin: { type: "native" as const, operationId: `integrate:${issue}` } }
          : {}),
      },
    ],
  };
};

describe("landingOf", () => {
  it("proves a landing only from a receipt-proved integration of the reviewed head", () => {
    const found = landingOf(landedRecord(145));
    assert.deepStrictEqual("landing" in found ? found.landing : found, {
      itemKey: `github:${repository}#145`,
      operationId: "integrate:145",
      commit: merge,
      tree,
      parents: [base, head],
      branch: "main",
      reviewedHead: head,
      reviewOutcomeId: "145-review",
      integratedOutcomeId: "145-integrate",
    });
  });

  it.each<[string, ItemRecord, string]>([
    ["a report with no matched receipt", landedRecord(146, false), "no applied receipt"],
    [
      "accepted but unlanded",
      { ...landedRecord(147), outcomes: landedRecord(147).outcomes.slice(0, 2) },
      "accepted",
    ],
    [
      "a rejected review",
      { ...landedRecord(148), events: [{ type: "rejected", outcomeId: "148-review" }] },
      "no verified independent review_passed",
    ],
    [
      "a reopened closure after landing",
      {
        ...landedRecord(149),
        outcomes: [
          ...landedRecord(149).outcomes,
          outcome("149-close", `github:${repository}#149`, "close", {
            outcome: "closed",
            summary: "Closed.",
          }),
        ],
        events: [{ type: "reopened", closureOutcomeId: "149-close" }],
      },
      "reopened",
    ],
  ])("refuses %s", (_name, record, why) => {
    const found = landingOf(record);
    assert.include("why" in found ? found.why : "", why);
  });
});

describe("shared identities with the policy", () => {
  // Vectors computed with the frozen r3b helper (sha256 516cf8d4…): digest(...)[:12].
  it("derives the defect child by the policy's basis token", () => {
    const itemKey = `github:${repository}#139`;
    const failed = outcome("139-verify", itemKey, "rework", {
      outcome: "failed",
      failure: "settlement check failed",
      summary: "Failed.",
    });
    const ticket = (outcomeId: string, token: string, number: number) =>
      outcome(outcomeId, itemKey, "rework", {
        outcome: "ticket_opened",
        summary: `Opened ${repository}#${number} (Correct #139 product defect ${token}).`,
        ticket: { repository, number },
      });
    const outcomes = [
      ticket("before", "[defect 1c9674f844ae]", 140),
      failed,
      ticket("other", "[defect 000000000000]", 141),
      ticket("first", "[defect 1c9674f844ae]", 145),
      ticket("second", "[defect 1c9674f844ae]", 146),
    ];
    assert.strictEqual(defectChild(itemKey, outcomes, failed), 145);
    assert.strictEqual(criterionToken(98, "C2"), "[criterion C2 b3ca1bc0feca]");
  });
});

describe("binding naming", () => {
  it("names the installed policy whole or without its configuration pin", () => {
    assert.isTrue(
      namesPolicy("btc-policy:0123456789abcdef", "btc-policy:0123456789abcdef:fedcba9876543210"),
    );
    assert.isTrue(namesPolicy("connector-r3", "connector-r3"));
    assert.isFalse(
      namesPolicy("btc-policy:0123456789abcdef", "btc-policy:0123456789abcdee:fedcba9876543210"),
    );
    assert.isFalse(namesPolicy("btc-policy", "btc-policy:x"));
  });

  it("gives each failure, landing and template its own output root", () => {
    const at = {
      issue: 139,
      itemKey: `github:${repository}#139`,
      failedOutcomeId: "139-verify",
      commit: merge,
      templateSha256: "a".repeat(64),
    };
    const roots = new Set(
      [
        at,
        { ...at, failedOutcomeId: "139-verify-2" },
        { ...at, commit: head },
        { ...at, templateSha256: "b".repeat(64) },
      ].map(outputRootName),
    );
    assert.strictEqual(roots.size, 4);
    assert.match(outputRootName(at), /^139-[0-9a-f]{16}$/);
  });

  it("reads a template or a whole binding, and nothing else", () => {
    const template = {
      schema: "factory-verification-template/1",
      issue: 139,
      worker: { execution: "verifier" },
      auth: { identity: "verifier@example.invalid" },
      inputs: [{ path: "inputs/a.json", sha256: "a".repeat(64) }],
      consumer: { contract: "settlement-proof", version: "1" },
      policyIdentity: "btc-policy:0123456789abcdef",
      ownership: { owned: [] },
    };
    assert.isTrue(Option.isSome(decodeVerificationDocument(JSON.stringify(template))));
    for (const value of [
      { ...template, schema: "factory-verification-template/2" },
      { ...template, worker: {} },
      { schema: "factory-verification-binding/1", issue: 139 },
    ]) {
      assert.isTrue(Option.isNone(decodeVerificationDocument(JSON.stringify(value))));
    }
  });
});

describe("reconcileCriteria", () => {
  const parentKey = `github:${repository}#98`;
  const criteria = (clauses: ReadonlyArray<unknown>) =>
    Option.getOrThrow(
      decodeCriteria(
        JSON.stringify({
          schema: "factory-parent-criteria/1",
          issue: 98,
          version: "v1",
          bodySha256: "b".repeat(64),
          clauses,
        }),
      ),
    );
  const source = { kind: "issue-body", ref: "## Acceptance" };
  const records = new Map<string, ItemRecord>([
    [`github:${repository}#145`, landedRecord(145)],
    [
      `github:${repository}#146`,
      { ...landedRecord(146), outcomes: landedRecord(146).outcomes.slice(0, 2) },
    ],
    [`github:${repository}#150`, landedRecord(150)],
  ]);
  // T3 opened the clause C5 child itself; the criteria never name it.
  const parentOutcomes = [
    outcome("98-ticket", parentKey, "implement", {
      outcome: "ticket_opened",
      summary: `Opened ${repository}#150 (#98 ${criterionToken(98, "C5")} Add the export).`,
      ticket: { repository, number: 150 },
    }),
  ];

  it("judges every clause from landed records, never from membership or counts", () => {
    const clauses = reconcileCriteria({
      criteria: criteria([
        {
          id: "C1",
          required: true,
          source,
          evidence: [{ itemKey: `github:${repository}#145`, scope: "settlement" }],
        },
        {
          id: "C2",
          required: true,
          source,
          evidence: [{ itemKey: `github:${repository}#146`, scope: "export" }],
        },
        { id: "C3", required: true, source, state: "reserved" },
        { id: "C4", required: true, source, state: "revised" },
        { id: "C5", required: true, source },
        {
          id: "C6",
          required: true,
          source,
          evidence: [{ itemKey: `github:${repository}#777`, scope: "x" }],
        },
        { id: "C7", required: false, source },
      ]),
      repository,
      parentOutcomes,
      records,
    });
    assert.deepStrictEqual(
      clauses.map((clause) => [clause.id, clause.status, clause.landed.map((each) => each.scope)]),
      [
        ["C1", "satisfied", ["settlement"]],
        ["C2", "missing", []],
        ["C3", "reserved", []],
        ["C4", "revised", []],
        ["C5", "satisfied", ["criterion C5 child"]],
        ["C6", "unknown_source", []],
        ["C7", "missing", []],
      ],
    );
    assert.include(clauses[1]!.why ?? "", "accepted");
    assert.strictEqual(clauses[0]!.landed[0]!.commit, merge);
  });
});
