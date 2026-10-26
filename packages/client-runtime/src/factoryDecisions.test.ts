import { FactoryId, type FactoryOverview, type FactoryStateResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  factoryDecisionAnswerInput,
  factorySummary,
  pendingFactoryDecisions,
} from "./factoryDecisions.ts";

const state = (overrides: Partial<FactoryStateResult> = {}): FactoryStateResult => ({
  configured: true,
  enabled: true,
  pools: [{ poolId: "builders", capacityUnits: 2, occupiedUnits: 1 }],
  issues: [],
  reservations: [],
  reservedDecisions: [],
  grants: [],
  lastCollection: [],
  ...overrides,
});

const decision = (
  decisionId: string,
  createdAt: string,
  overrides: Partial<FactoryStateResult["reservedDecisions"][number]> = {},
): FactoryStateResult["reservedDecisions"][number] => ({
  decisionId,
  itemKey: "github:example-org/alpha#69",
  stage: "integrate",
  kind: "gate",
  reason: "Privacy check has new findings.",
  state: "pending",
  createdAt,
  ...overrides,
});

describe("pendingFactoryDecisions", () => {
  it("lists only pending decisions across factories, in the order they were asked", () => {
    const overview: FactoryOverview = {
      factories: [
        {
          factoryId: FactoryId.make("alpha"),
          state: state({
            reservedDecisions: [
              decision("late", "2026-10-24T10:00:00.000Z"),
              decision("answered", "2026-10-24T08:00:00.000Z", { state: "resolved" }),
            ],
          }),
        },
        {
          factoryId: FactoryId.make("beta"),
          state: state({ reservedDecisions: [decision("early", "2026-10-24T09:00:00.000Z")] }),
        },
      ],
    };
    expect(
      pendingFactoryDecisions(overview).map((entry) => [entry.factoryId, entry.decisionId]),
    ).toEqual([
      ["beta", "early"],
      ["alpha", "late"],
    ]);
    expect(pendingFactoryDecisions(null)).toEqual([]);
  });
});

describe("factoryDecisionAnswerInput", () => {
  const gate = { factoryId: FactoryId.make("alpha"), decisionId: "d1", kind: "gate" } as const;
  const grant = { ...gate, kind: "grant" } as const;

  it("offers finite grants only for grant requests, in whole positive units", () => {
    expect(factoryDecisionAnswerInput(grant, { type: "grant", units: 2 })).toEqual({
      factoryId: "alpha",
      decisionId: "d1",
      answer: "grant",
      grantUnits: 2,
    });
    expect(factoryDecisionAnswerInput(gate, { type: "grant", units: 1 })).toBeNull();
    expect(factoryDecisionAnswerInput(grant, { type: "grant", units: 0 })).toBeNull();
    expect(factoryDecisionAnswerInput(grant, { type: "grant", units: 1.5 })).toBeNull();
  });

  it("keeps a decline's reason and refuses an empty answer", () => {
    expect(
      factoryDecisionAnswerInput(gate, { type: "decline", reason: " not now " }),
    ).toMatchObject({ answer: "decline: not now" });
    expect(factoryDecisionAnswerInput(gate, { type: "decline" })).toMatchObject({
      answer: "decline",
    });
    expect(factoryDecisionAnswerInput(gate, { type: "answer", text: "   " })).toBeNull();
  });
});

describe("factorySummary", () => {
  it("says what needs the owner and what stops the factory", () => {
    expect(
      factorySummary(
        state({
          enabled: false,
          reservedDecisions: [decision("d", "2026-10-24T09:00:00.000Z")],
          issues: [{ kind: "policy", detail: "pin mismatch" }],
        }),
      ),
    ).toBe("Paused · 1/2 units in use · 1 waiting for you · 1 problem(s)");
  });
});
