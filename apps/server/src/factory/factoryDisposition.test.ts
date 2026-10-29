import {
  CommandId,
  ThreadId,
  NodeId,
  FactoryId,
  FactoryItemKey,
  FactoryReservationId,
  ProviderDriverKind,
  RunAttemptId,
  RunId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { PreparationOwnerId } from "../orchestration-v2/preparationOwner.ts";
import { GenerationId } from "./FactoryExecutionGenerations.ts";
import {
  neverStartedRefusals,
  quarantineRefusals,
  type NeverStartedEvidence,
  type QuarantineEvidence,
} from "./factoryDisposition.ts";

const runId = RunId.make("run:14");
const ownerId = PreparationOwnerId.make("owner:1");

// BTC #14's shape: failed before any launch, obligation settled, container ended.
const neverStarted: NeverStartedEvidence = {
  reservation: {
    reservationId: FactoryReservationId.make("reservation:14"),
    factoryId: FactoryId.make("btc"),
    itemKey: FactoryItemKey.make("github:example/btc#14"),
    taskKind: "implement",
    execution: {
      commandId: CommandId.make("command:14"),
      threadId: ThreadId.make("thread:14"),
      runId,
      taskNodeId: NodeId.make("node:14"),
    },
    admittedIn: null,
  },
  runs: [
    {
      runId,
      status: "failed",
      started: false,
      beforeTurn: null,
      driver: ProviderDriverKind.make("codex"),
      obligation: { state: "settled", ownerId, openedIn: null },
      generations: [
        { generationId: GenerationId.make("generation:1"), state: "ended", providerJoins: 0 },
      ],
    },
  ],
  attempts: [
    {
      attemptId: RunAttemptId.make("attempt:1"),
      runId,
      status: "failed",
      started: false,
      providerTurnId: null,
    },
  ],
  providerTurns: 0,
  launches: [],
  custody: { state: "unknown", reasons: ["process_containment_unsupported"] },
};
const [run] = neverStarted.runs;
const [attempt] = neverStarted.attempts;

// Connector #49's shape: the start launch was claimed five times, every provider session open
// failed, and the run's container ended with no provider ever joining it.
const sessionNeverOpened: NeverStartedEvidence = {
  ...neverStarted,
  runs: [{ ...run!, beforeTurn: "provider-session-open-failure" }],
  launches: [{ runId, status: "succeeded", attempts: 5 }],
};
const [failedOpen] = sessionNeverOpened.runs;

describe("neverStartedRefusals", () => {
  it("admits only a stage nothing proves never started", () => {
    assert.deepStrictEqual(neverStartedRefusals(neverStarted), []);
  });

  it.each<[string, NeverStartedEvidence]>([
    ["provider_started", { ...neverStarted, runs: [{ ...run!, started: true }] }],
    ["provider_started", { ...neverStarted, attempts: [{ ...attempt!, started: true }] }],
    ["provider_started", { ...neverStarted, providerTurns: 1 }],
    [
      "launch_claimed",
      { ...neverStarted, launches: [{ runId, status: "succeeded", attempts: 1 }] },
    ],
    ["launch_claimed", { ...neverStarted, launches: [{ runId, status: "pending", attempts: 0 }] }],
    ["run_not_terminal", { ...neverStarted, runs: [{ ...run!, status: "preparing" }] }],
    [
      "workspace_obligation_open",
      {
        ...neverStarted,
        runs: [{ ...run!, obligation: { state: "open", ownerId, openedIn: null } }],
      },
    ],
    ["workspace_obligation_open", { ...neverStarted, runs: [{ ...run!, obligation: "missing" }] }],
    [
      "container_not_ended",
      {
        ...neverStarted,
        runs: [
          {
            ...run!,
            generations: [
              { generationId: GenerationId.make("generation:1"), state: "held", providerJoins: 0 },
            ],
          },
        ],
      },
    ],
    [
      "custody_not_unproved",
      { ...neverStarted, custody: { state: "live", reasons: ["contained_processes"] } },
    ],
    [
      "custody_not_unproved",
      {
        ...neverStarted,
        custody: {
          state: "unknown",
          reasons: ["process_containment_unsupported", "container_unreadable"],
        },
      },
    ],
    ["no_run", { ...neverStarted, runs: [] }],
  ])("refuses %s", (refusal, evidence) => {
    assert.include(neverStartedRefusals(evidence), refusal);
  });

  it("admits a claimed launch whose run the runtime recorded ending before any provider turn", () => {
    assert.deepStrictEqual(neverStartedRefusals(sessionNeverOpened), []);
    // The start fence refused the next run before any session: no container was needed.
    const runId2 = RunId.make("run:14:2");
    assert.deepStrictEqual(
      neverStartedRefusals({
        ...sessionNeverOpened,
        runs: [
          failedOpen!,
          {
            ...failedOpen!,
            runId: runId2,
            beforeTurn: "factory-custody-unknown",
            obligation: "none",
            generations: [],
          },
        ],
        launches: [
          ...sessionNeverOpened.launches,
          { runId: runId2, status: "succeeded", attempts: 1 },
        ],
      }),
      [],
    );
  });

  it.each<[string, NeverStartedEvidence["runs"][number]]>([
    ["no record of ending before a turn", { ...failedOpen!, beforeTurn: null }],
    [
      "a provider joined the container",
      {
        ...failedOpen!,
        generations: [
          { generationId: GenerationId.make("generation:1"), state: "ended", providerJoins: 1 },
        ],
      },
    ],
    ["a session open with no container", { ...failedOpen!, generations: [] }],
    ["an uncontained driver", { ...failedOpen!, driver: ProviderDriverKind.make("opencode") }],
    ["an unknown driver", { ...failedOpen!, driver: null }],
  ])("keeps a claimed launch refused with %s", (_case, failedRun) => {
    assert.include(
      neverStartedRefusals({ ...sessionNeverOpened, runs: [failedRun] }),
      "launch_claimed",
    );
  });

  it("keeps a pending launch refused whatever its run recorded", () => {
    assert.include(
      neverStartedRefusals({
        ...sessionNeverOpened,
        launches: [{ runId, status: "pending", attempts: 0 }],
      }),
      "launch_claimed",
    );
  });
});

// A historical review's shape: it ran on a build whose provider never joined its container,
// reported and verified, then a wake the start fence refused before any provider work.
const servingId = "serving:candidate";
const wakeRunId = RunId.make("run:142:2");
const historical: QuarantineEvidence = {
  ...neverStarted,
  reservation: { ...neverStarted.reservation, taskKind: "review", admittedIn: "serving:deployed" },
  runs: [
    {
      ...run!,
      status: "completed",
      started: true,
      driver: ProviderDriverKind.make("codex"),
      generations: [
        { generationId: GenerationId.make("generation:1"), state: "ended", providerJoins: 0 },
      ],
    },
    {
      ...run!,
      runId: wakeRunId,
      status: "failed",
      started: false,
      beforeTurn: "factory-custody-unknown",
      obligation: "none",
      generations: [],
    },
  ],
  attempts: [{ ...attempt!, status: "completed", started: true }],
  providerTurns: 1,
  launches: [{ runId, status: "succeeded", attempts: 1 }],
  outcomes: [
    { outcomeId: "outcome:142", state: "verified", kind: "review_passed", fromExecution: true },
  ],
  quarantine: null,
};
const [reviewRun, wakeRun] = historical.runs;

describe("quarantineRefusals", () => {
  it("admits a reported historical stage whose provider never joined a container", () => {
    assert.deepStrictEqual(quarantineRefusals(historical, servingId), []);
    // An older build recorded no serving process at all.
    assert.deepStrictEqual(
      quarantineRefusals(
        { ...historical, reservation: { ...historical.reservation, admittedIn: null } },
        servingId,
      ),
      [],
    );
  });

  it.each<[string, QuarantineEvidence]>([
    [
      "already_quarantined",
      {
        ...historical,
        quarantine: { by: "owner", evidenceDigest: "d", quarantinedAt: "2026-10-29T00:00:00Z" },
      },
    ],
    // Live or still-running work is never quarantined, however old.
    ["run_not_terminal", { ...historical, runs: [{ ...reviewRun!, status: "running" }, wakeRun!] }],
    [
      "custody_not_unproved",
      { ...historical, custody: { state: "live", reasons: ["run_active"] } },
    ],
    [
      "launch_pending",
      { ...historical, launches: [{ runId: wakeRunId, status: "pending", attempts: 0 }] },
    ],
    // An interrupted start, or one with no report, may have left its writer mid-work.
    [
      "started_run_not_completed",
      { ...historical, runs: [{ ...reviewRun!, status: "interrupted" }, wakeRun!] },
    ],
    ["no_verified_report", { ...historical, outcomes: [] }],
    [
      "no_verified_report",
      {
        ...historical,
        outcomes: [
          {
            outcomeId: "outcome:142",
            state: "reported",
            kind: "review_passed",
            fromExecution: true,
          },
        ],
      },
    ],
    [
      "no_verified_report",
      {
        ...historical,
        outcomes: [
          { outcomeId: "native:142", state: "verified", kind: "failed", fromExecution: false },
        ],
      },
    ],
    // A provider that joined is judged by its container, never quarantined.
    [
      "provider_joined",
      {
        ...historical,
        runs: [
          {
            ...reviewRun!,
            generations: [
              { generationId: GenerationId.make("generation:1"), state: "ended", providerJoins: 1 },
            ],
          },
          wakeRun!,
        ],
      },
    ],
    // This serving process admitted it, so its provider started through the join seam.
    [
      "admitted_by_this_process",
      { ...historical, reservation: { ...historical.reservation, admittedIn: servingId } },
    ],
    ["not_started", { ...historical, runs: [{ ...reviewRun!, started: false }] }],
    [
      "workspace_obligation_open",
      {
        ...historical,
        runs: [{ ...reviewRun!, obligation: { state: "open", ownerId, openedIn: null } }, wakeRun!],
      },
    ],
    [
      "custody_not_unproved",
      {
        ...historical,
        custody: {
          state: "unknown",
          reasons: ["process_containment_unsupported", "container_unverified"],
        },
      },
    ],
    [
      "custody_not_unproved",
      { ...historical, custody: { state: "quiescent", reasons: ["contained_quiet"] } },
    ],
    ["no_run", { ...historical, runs: [] }],
  ])("refuses %s", (refusal, evidence) => {
    assert.include(quarantineRefusals(evidence, servingId), refusal);
  });
});
