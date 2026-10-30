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
  terminationRefusals,
  type NeverStartedEvidence,
  type QuarantineEvidence,
} from "./factoryDisposition.ts";
import type { HistoricalProvenance, HostBoot } from "./factoryHistoricalTermination.ts";
import type { HistoricalTermination } from "./FactoryStore.ts";

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
  // The wake's launch was claimed; the fence's own retained refusal says no provider ran for it.
  launches: [
    { runId, status: "succeeded", attempts: 1 },
    { runId: wakeRunId, status: "succeeded", attempts: 1 },
  ],
  outcomes: [
    { outcomeId: "outcome:142", state: "verified", kind: "review_passed", fromExecution: true },
  ],
  quarantine: null,
};
// A later launch of the same execution, claimed and failed, with no start and no retained refusal.
const laterRunId = RunId.make("run:142:3");
const laterUnproved: QuarantineEvidence = {
  ...historical,
  runs: [
    ...historical.runs,
    {
      ...run!,
      runId: laterRunId,
      status: "failed",
      started: false,
      obligation: "none",
      generations: [],
    },
  ],
  attempts: [
    ...historical.attempts,
    { ...attempt!, attemptId: RunAttemptId.make("attempt:3"), runId: laterRunId },
  ],
  launches: [...historical.launches, { runId: laterRunId, status: "failed", attempts: 1 }],
};
const [, , laterRun] = laterUnproved.runs;
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
    // A launch never claimed started nothing, whatever its run's failure.
    assert.deepStrictEqual(
      quarantineRefusals(
        {
          ...laterUnproved,
          launches: [
            ...historical.launches,
            { runId: laterRunId, status: "cancelled", attempts: 0 },
          ],
        },
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
    // An earlier report says nothing about a later launch whose outcome no record proves.
    ["launch_outcome_unproved", laterUnproved],
    // A failed session open is not a refusal before any provider work: the CLI may have started.
    [
      "launch_outcome_unproved",
      {
        ...laterUnproved,
        runs: [...historical.runs, { ...laterRun!, beforeTurn: "provider-session-open-failure" }],
      },
    ],
    [
      "launch_outcome_unproved",
      { ...laterUnproved, runs: historical.runs, attempts: historical.attempts },
    ],
  ])("refuses %s", (refusal, evidence) => {
    assert.include(quarantineRefusals(evidence, servingId), refusal);
  });
});

// The same historical review, bound to the restart Root will perform: captured on this boot of
// this host, then read again after a later boot of the same host.
const capturedBoot: HostBoot = {
  platform: "win32",
  machineId: "machine-a",
  bootId: "20",
  uptimeMs: 276_517_000,
};
const laterBoot: HostBoot = { ...capturedBoot, bootId: "21", uptimeMs: 120_000 };
const captured: HistoricalTermination = {
  capture: {
    by: "mcp-client:owner",
    reason: "planned full restart",
    operationRef: "restart:20261030",
    evidenceDigest: "capture-digest",
    evidence: "{}",
    executionDigest: "execution-digest",
    servingId: "serving:before-restart",
    host: capturedBoot,
    covers: { attempts: ["attempt:1"], launches: [], generations: ["generation:1"] },
    provenance: { digest: "provenance-digest", source: "synthetic-test-producer" },
    capturedAt: "2026-10-30T03:00:00Z",
  },
};
const proved: HistoricalTermination = {
  ...captured,
  proof: {
    by: "mcp-client:owner",
    reason: "restarted",
    evidenceDigest: "verify-digest",
    evidence: "{}",
    servingId,
    host: laterBoot,
    provedAt: "2026-10-30T04:00:00Z",
  },
};
// SYNTHETIC retained provenance, as a trusted producer would have recorded it for this exact
// execution and operation. No test here claims such a record exists for any real reservation.
const provenance: HistoricalProvenance = {
  reservationId: historical.reservation.reservationId,
  operationRef: "restart:20261030",
  source: "synthetic-test-producer",
  host: { platform: "win32", machineId: "machine-a" },
  runs: [runId, wakeRunId],
  attempts: ["attempt:1"],
  launches: [
    { runId, status: "succeeded", attemptCount: 1 },
    { runId: wakeRunId, status: "succeeded", attemptCount: 1 },
  ],
  providerSessions: ["session:142"],
  executors: [{ kind: "local_process", machineId: "machine-a" }],
};
const capture = {
  action: "capture",
  facts: historical,
  executionDigest: "execution-digest",
  evidenceDigest: "capture-digest",
  operationRef: "restart:20261030",
  servingId: "serving:before-restart",
  host: capturedBoot,
  recorded: undefined,
  provenance,
  provenanceDigest: "provenance-digest",
  providerSessions: ["session:142"],
} satisfies Parameters<typeof terminationRefusals>[0];
// After the restart every container of the execution reads ended.
const verify = {
  ...capture,
  action: "verify",
  evidenceDigest: "verify-digest",
  servingId,
  host: laterBoot,
  recorded: captured,
} satisfies Parameters<typeof terminationRefusals>[0];

// A capture an earlier build recorded, with no provenance bound.
const { provenance: _unbound, ...unboundCapture } = captured.capture;

describe("terminationRefusals", () => {
  it("binds a reported historical stage to a restart, and proves it on a later boot", () => {
    assert.deepStrictEqual(terminationRefusals(capture), []);
    // An unproved capture may be taken again on fresh evidence.
    assert.deepStrictEqual(
      terminationRefusals({ ...capture, recorded: captured, evidenceDigest: "fresh" }),
      [],
    );
    assert.deepStrictEqual(terminationRefusals(verify), []);
    // A quarantined stage is still the owner's to prove.
    assert.deepStrictEqual(
      terminationRefusals({
        ...verify,
        facts: {
          ...historical,
          quarantine: { by: "owner", evidenceDigest: "q", quarantinedAt: "2026-10-30T00:00:00Z" },
        },
      }),
      [],
    );
  });

  it.each<[string, Parameters<typeof terminationRefusals>[0]]>([
    // Confirming the same capture twice, or anything once proved, records nothing new.
    ["already_captured", { ...capture, recorded: captured }],
    ["already_proved", { ...capture, recorded: proved }],
    ["already_proved", { ...verify, recorded: proved }],
    ["host_boot_unreadable", { ...capture, host: null }],
    ["host_boot_unreadable", { ...verify, host: null }],
    // A provider that may run elsewhere is not ended by this host's restart.
    [
      "driver_not_local",
      {
        ...capture,
        facts: {
          ...historical,
          runs: [{ ...reviewRun!, driver: ProviderDriverKind.make("cursor") }, wakeRun!],
        },
      },
    ],
    [
      "driver_not_local",
      { ...capture, facts: { ...historical, runs: [{ ...reviewRun!, driver: null }, wakeRun!] } },
    ],
    // Live, unread, unreported or ambiguous work never binds, before or after the restart.
    [
      "custody_not_unproved",
      { ...capture, facts: { ...historical, custody: { state: "live", reasons: ["run_queued"] } } },
    ],
    [
      "custody_not_unproved",
      {
        ...verify,
        facts: { ...historical, custody: { state: "live", reasons: ["pending_request"] } },
      },
    ],
    [
      "launch_pending",
      {
        ...verify,
        facts: { ...historical, launches: [{ runId: wakeRunId, status: "pending", attempts: 0 }] },
      },
    ],
    ["launch_outcome_unproved", { ...capture, facts: laterUnproved }],
    ["no_verified_report", { ...capture, facts: { ...historical, outcomes: [] } }],
    [
      "admitted_by_this_process",
      {
        ...verify,
        facts: { ...historical, reservation: { ...historical.reservation, admittedIn: servingId } },
      },
    ],
    ["not_captured", { ...verify, recorded: undefined }],
    // The proof is for the operation the capture named, of the very execution it captured.
    ["operation_mismatch", { ...verify, operationRef: "restart:other" }],
    ["execution_changed", { ...verify, executionDigest: "later-launch" }],
    [
      "container_not_ended",
      {
        ...verify,
        facts: {
          ...historical,
          runs: [
            {
              ...reviewRun!,
              generations: [
                {
                  generationId: GenerationId.make("generation:1"),
                  state: "held",
                  providerJoins: 0,
                },
              ],
            },
            wakeRun!,
          ],
        },
      },
    ],
    // Only a later boot of the same host: not the capture's own boot, a resume, or another host.
    ["same_boot", { ...verify, host: { ...capturedBoot, uptimeMs: capturedBoot.uptimeMs + 1 } }],
    ["uptime_not_reset", { ...verify, host: { ...laterBoot, uptimeMs: capturedBoot.uptimeMs } }],
    ["foreign_host", { ...verify, host: { ...laterBoot, machineId: "machine-b" } }],
    ["foreign_host", { ...verify, host: { ...laterBoot, platform: "linux" } }],
    // R1: a local driver captured and verified on one host, with nothing retained about where its
    // writers ran, proves nothing; nor does a value the source could not decode.
    [
      "historical_provenance_missing",
      { ...capture, provenance: "missing", provenanceDigest: null },
    ],
    ["historical_provenance_missing", { ...verify, provenance: "missing", provenanceDigest: null }],
    ["historical_provenance_malformed", { ...capture, provenance: "malformed" }],
    // A database copied from another host: capture and verify agree, the writers ran elsewhere.
    [
      "historical_host_foreign",
      {
        ...verify,
        provenance: { ...provenance, host: { platform: "win32", machineId: "machine-b" } },
      },
    ],
    // A local provider that handed work to a remote, persistent or delegated writer.
    ...(["remote", "persistent", "delegated"] as const).map(
      (kind) =>
        [
          "executor_not_local",
          {
            ...capture,
            provenance: {
              ...provenance,
              executors: [...provenance.executors, { kind, machineId: "machine-a" }],
            },
          },
        ] as [string, Parameters<typeof terminationRefusals>[0]],
    ),
    [
      "executor_foreign_host",
      {
        ...capture,
        provenance: {
          ...provenance,
          executors: [{ kind: "local_process", machineId: "machine-b" }],
        },
      },
    ],
    ["provenance_executors_missing", { ...capture, provenance: { ...provenance, executors: [] } }],
    // Incomplete coverage: a provider session, launch, attempt or run it does not name.
    ["provenance_sessions_incomplete", { ...capture, providerSessions: ["session:142", "s:2"] }],
    [
      "provenance_launches_incomplete",
      { ...capture, provenance: { ...provenance, launches: provenance.launches.slice(0, 1) } },
    ],
    ["provenance_attempts_incomplete", { ...capture, provenance: { ...provenance, attempts: [] } }],
    ["provenance_runs_incomplete", { ...capture, provenance: { ...provenance, runs: [runId] } }],
    // A later launch than the provenance covers.
    ["provenance_launches_incomplete", { ...verify, facts: laterUnproved }],
    // Retained for another operation or execution: an owner's operationRef is not authorization.
    [
      "provenance_operation_mismatch",
      { ...verify, provenance: { ...provenance, operationRef: "restart:other" } },
    ],
    [
      "provenance_other_execution",
      { ...capture, provenance: { ...provenance, reservationId: "reservation:other" } },
    ],
    // The provenance read at verify is not the one the capture bound, or the capture bound none.
    ["provenance_changed", { ...verify, provenanceDigest: "other-digest" }],
    ["provenance_changed", { ...verify, recorded: { capture: unboundCapture } }],
  ])("refuses %s", (refusal, input) => {
    assert.include(terminationRefusals(input), refusal);
  });
});
