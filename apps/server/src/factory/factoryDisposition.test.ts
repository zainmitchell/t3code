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
  residualRefusals,
  residualScopeOf,
  terminationRefusals,
  type NeverStartedEvidence,
  type QuarantineEvidence,
  type ResidualFacts,
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

// The four held executions' structural records, as Root read them from the immutable backup
// (ids, instances, drivers, hosts; no payload). Ids follow the allocator's own encoding.
const HOST = { platform: "win32" as const, machineId: "a63c8b86-e9c0-4567-9e26-9eab1ac36f80" };
const SERVING = "fb0b1c30-6b5c-4542-86f0-ab4ad767962a";
const OWNER_HOST = "98659ce8-a0c7-49ee-9532-e5b0fa9ac2de";
const threadOf = (factory: string, key: string) => `thread:factory:${factory}:${key}`;
const runOf = (thread: string, ordinal: number) =>
  `run:thread:${encodeURIComponent(thread)}:ordinal:${ordinal}`;
const attemptOf = (run: string) => `run-attempt:run:${encodeURIComponent(run)}:attempt:1`;
const pendingProviderThread = (driver: string, run: string) =>
  `provider-thread:provider:${driver}:native-thread:${encodeURIComponent(`pending:${run}`)}`;
const sessionOf = (instance: string, thread: string, uuid: string) =>
  `provider-session:provider-instance:${instance}:thread:${encodeURIComponent(thread)}:${uuid}`;

interface HeldExecution {
  readonly factory: string;
  readonly key: string;
  readonly instance: "claudeAgent" | "codex_cli";
  readonly driver: "claudeAgent" | "codex";
  readonly generationId: string;
  readonly sessionUuid: string;
  readonly nativeThreadId: string;
  /** Runs after the first, none started (BTC142's second attempt never started). */
  readonly laterRuns?: number;
}

const heldExecutions = {
  hsa137: {
    factory: "hsa-native-pilot-20261024",
    key: "edc9a93c4c24bbd19cb5d2623d20fec450ab8e2f7b3ead3f93f1c7e568887833",
    instance: "claudeAgent",
    driver: "claudeAgent",
    generationId: "90464fb7-195d-4046-9ebb-db305429e80d",
    sessionUuid: "de02eea4-492e-4efc-8526-d872daf964f6",
    nativeThreadId: "20e2b00e-0b61-4697-bc50-8fb429277d24",
  },
  connector93: {
    factory: "connector-native-factory-20261028",
    key: "63f41bcda6adcbcfed13e4a23e47e1d1f225a648632fa49ebe15e6037520f1f4",
    instance: "codex_cli",
    driver: "codex",
    generationId: "d941fd99-4363-44e8-93c3-a9b46f0184fc",
    sessionUuid: "3dcc6298-d1f9-4779-9613-dfbc30dccd7f",
    nativeThreadId: "01a18908-bc09-7ad3-8e82-25f527cb3dca",
  },
  btc142: {
    factory: "btc-native-pilot-20261024",
    key: "d360d72e3df165bcf13b072a5dcfc922334710bbaed1bb900ef5e2dabfc80e28",
    instance: "codex_cli",
    driver: "codex",
    generationId: "d8150448-394c-4349-ae68-64441bda0d3a",
    sessionUuid: "8411ce5e-0a95-4ac1-9780-25f4ddf839ad",
    nativeThreadId: "01a18908-7111-7c11-8fff-e2dd4dd1ae20",
    laterRuns: 1,
  },
  btc145: {
    factory: "btc-native-pilot-20261024",
    key: "df6add5f7c528ab2351e8414d3f7fb4ec04da617c0f6cc3ae5f37aef2e7d74e9",
    instance: "claudeAgent",
    driver: "claudeAgent",
    generationId: "7733e50f-4f49-47cd-9498-8295b2e723a6",
    sessionUuid: "a2a8f90b-cf36-435d-aa81-2bd76e5d8170",
    nativeThreadId: "a374b88d-e5f2-4c98-a175-a6535ed4dd7d",
  },
} satisfies Record<string, HeldExecution>;

// connector93's two provider-native Codex children, exactly as Root's cross-binding read shows.
const connectorChildren = [
  { call: "call_710d676612a34c81b2892699c4c408f0", native: "01a18909-c009-77e1-92d3-e9d505d5b9d2" },
  { call: "call_fa16ab68fd4d43e8a53945fef47815a1", native: "01a18909-d700-7b91-b9df-167c76c0d76c" },
];
const forkTurn = "provider-turn:provider:codex:native-turn:01a18908-bf45-7ee0-8d85-dbbd9e8de1b9";

type Loose = Record<string, unknown>;
interface FactsFixture {
  containers: Array<{
    generationId: string;
    runId: string;
    machine: string;
    session: number;
    ownerHost: string;
    providerJoins: number;
  }>;
  projection: {
    thread: Loose;
    runs: Array<Loose>;
    attempts: Array<Loose>;
    providerThreads: Array<Loose>;
    providerSessions: Array<Loose>;
    providerTurns: Array<Loose>;
    subagents: Array<Loose>;
  };
  unreadableThreads: number;
  descendants: Array<{
    threadId: string;
    projection: {
      thread: Loose;
      runs: Array<Loose>;
      attempts: Array<Loose>;
      providerThreads: Array<Loose>;
      providerSessions: Array<Loose>;
      providerTurns: Array<Loose>;
      subagents: Array<Loose>;
    } | null;
  }>;
}
// Fixtures carry only the fields the predicates read; the cast is to the projection's full type.
const asFacts = (fixture: FactsFixture) => fixture as unknown as ResidualFacts;

const residualFactsOf = (execution: HeldExecution): FactsFixture => {
  const thread = threadOf(execution.factory, execution.key);
  const firstRun = runOf(thread, 1);
  const providerThread = pendingProviderThread(execution.driver, firstRun);
  const session = sessionOf(execution.instance, thread, execution.sessionUuid);
  const runs = [
    firstRun,
    ...Array.from({ length: execution.laterRuns ?? 0 }, (_, i) => runOf(thread, i + 2)),
  ];
  const children = execution === heldExecutions.connector93 ? connectorChildren : [];
  return {
    containers: [
      {
        generationId: execution.generationId,
        runId: firstRun,
        machine: HOST.machineId,
        session: 1,
        ownerHost: OWNER_HOST,
        providerJoins: 0,
      },
    ],
    projection: {
      thread: {
        id: thread,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: thread },
      },
      runs: runs.map((id, index) => ({
        id,
        startedAt: index === 0 ? "2026-10-29T19:00:00Z" : null,
      })),
      attempts: runs.map((runId, index) => ({
        id: attemptOf(runId),
        runId,
        startedAt: index === 0 ? "2026-10-29T19:00:00Z" : null,
        providerInstanceId: execution.instance,
        providerThreadId: providerThread,
        nativeThreadId: `pending:${runId}`,
      })),
      providerThreads: [
        {
          id: providerThread,
          driver: execution.driver,
          providerInstanceId: execution.instance,
          providerSessionId: session,
          forkedFrom: null,
          nativeThreadRef: {
            driver: execution.driver,
            nativeId: execution.nativeThreadId,
            strength: "strong",
          },
        },
      ],
      providerSessions: [
        { id: session, driver: execution.driver, providerInstanceId: execution.instance },
      ],
      providerTurns: [{ id: forkTurn, providerThreadId: providerThread }],
      subagents: children.map((child) => ({
        id: `node:provider:codex:native-item:${child.call}%3A${child.native}`,
        threadId: thread,
        origin: "provider_native",
        driver: "codex",
        providerInstanceId: execution.instance,
        providerThreadId: `provider-thread:provider:codex:native-thread:${child.native}`,
        childThreadId: `thread:provider:codex:native-thread:${child.native}`,
        nativeTaskRef: {
          driver: "codex",
          nativeId: `${child.call}:${child.native}`,
          strength: "strong",
        },
      })),
    },
    unreadableThreads: 0,
    descendants: children.map((child) => {
      const childThread = `thread:provider:codex:native-thread:${child.native}`;
      return {
        threadId: childThread,
        projection: {
          thread: {
            id: childThread,
            lineage: {
              parentThreadId: thread,
              relationshipToParent: "subagent",
              rootThreadId: thread,
            },
          },
          runs: [],
          attempts: [],
          providerSessions: [],
          providerTurns: [],
          subagents: [],
          providerThreads: [
            {
              id: `provider-thread:provider:codex:native-thread:${child.native}`,
              driver: "codex",
              providerInstanceId: execution.instance,
              providerSessionId: session,
              forkedFrom: { providerThreadId: providerThread, providerTurnId: forkTurn },
              nativeThreadRef: { driver: "codex", nativeId: child.native, strength: "strong" },
            },
          ],
        },
      };
    }),
  };
};

const scopeInput = (execution: HeldExecution) => ({
  reservationId: `reservation:factory:${execution.factory}:decision:${execution.key}`,
  admittedIn: SERVING,
  operationRef: "restart:20261030",
  host: HOST,
});

describe("residualScopeOf: the four held executions", () => {
  it("composes Root's exact ids", () => {
    const hsa = threadOf(heldExecutions.hsa137.factory, heldExecutions.hsa137.key);
    const connector = threadOf(heldExecutions.connector93.factory, heldExecutions.connector93.key);
    assert.strictEqual(
      attemptOf(runOf(hsa, 1)),
      "run-attempt:run:run%3Athread%3Athread%253Afactory%253Ahsa-native-pilot-20261024%253Aedc9a93c4c24bbd19cb5d2623d20fec450ab8e2f7b3ead3f93f1c7e568887833%3Aordinal%3A1:attempt:1",
    );
    assert.strictEqual(
      pendingProviderThread("codex", runOf(connector, 1)),
      "provider-thread:provider:codex:native-thread:pending%3Arun%3Athread%3Athread%253Afactory%253Aconnector-native-factory-20261028%253A63f41bcda6adcbcfed13e4a23e47e1d1f225a648632fa49ebe15e6037520f1f4%3Aordinal%3A1",
    );
    assert.strictEqual(
      sessionOf("codex_cli", connector, "3dcc6298-d1f9-4779-9613-dfbc30dccd7f"),
      "provider-session:provider-instance:codex_cli:thread:thread%3Afactory%3Aconnector-native-factory-20261028%3A63f41bcda6adcbcfed13e4a23e47e1d1f225a648632fa49ebe15e6037520f1f4:3dcc6298-d1f9-4779-9613-dfbc30dccd7f",
    );
  });

  it.each(Object.entries(heldExecutions))("%s scopes exactly its records", (_name, execution) => {
    const { scope, refusals } = residualScopeOf(
      asFacts(residualFactsOf(execution)),
      scopeInput(execution),
    );
    assert.deepStrictEqual(refusals, []);
    assert.deepStrictEqual(scope?.servingProcess, { admittedIn: SERVING, ownerHost: OWNER_HOST });
    assert.deepStrictEqual(scope?.host, HOST);
    // The started attempt only: BTC142's second attempt never started.
    assert.deepStrictEqual(
      scope?.attempts.map((attempt) => [attempt.driver, attempt.nativeThreadId]),
      [[execution.driver, execution.nativeThreadId]],
    );
    assert.deepStrictEqual(
      scope?.nativeDescendants.map((child) => child.nativeThreadId),
      execution === heldExecutions.connector93
        ? connectorChildren.map((child) => child.native)
        : [],
    );
  });

  it("binds connector93's children to the parent's session, provider thread and fork turn", () => {
    const { scope } = residualScopeOf(
      asFacts(residualFactsOf(heldExecutions.connector93)),
      scopeInput(heldExecutions.connector93),
    );
    assert.strictEqual(scope?.nativeDescendants.length, 2);
    for (const child of scope?.nativeDescendants ?? []) {
      assert.strictEqual(child.providerSessionId, scope?.attempts[0]?.providerSessionId);
      assert.strictEqual(child.forkedFromProviderThreadId, scope?.attempts[0]?.providerThreadId);
      assert.strictEqual(child.forkedFromProviderTurnId, forkTurn);
    }
  });
});

describe("residualScopeOf: refusals", () => {
  const connector = heldExecutions.connector93;
  const refusalsOf = (change: (facts: FactsFixture) => void) => {
    const facts = residualFactsOf(connector);
    change(facts);
    return residualScopeOf(asFacts(facts), scopeInput(connector)).refusals;
  };
  const child = (facts: FactsFixture) => facts.descendants[0]!.projection!;

  it.each<[string, (facts: FactsFixture) => void]>([
    // T2: a copied database, a joined container, an uncontained started run.
    [
      "residual_container_foreign_host",
      (f) => void (f.containers[0] = { ...f.containers[0]!, machine: "machine:copy" }),
    ],
    [
      "residual_joined_use_custody",
      (f) => void (f.containers[0] = { ...f.containers[0]!, providerJoins: 1 }),
    ],
    ["residual_run_uncontained", (f) => void (f.containers.length = 0)],
    // T3: two serving processes.
    [
      "residual_serving_process_split",
      (f) =>
        void f.containers.push({ ...f.containers[0]!, generationId: "g2", ownerHost: "other" }),
    ],
    // T4: an attempt whose thread, session, instance, adapter or native id does not bind.
    ["residual_attempt_unbound", (f) => void (f.projection.providerSessions = [])],
    [
      "residual_attempt_foreign_instance",
      (f) => void (f.projection.providerSessions[0]!.providerInstanceId = "claudeAgent"),
    ],
    [
      "residual_attempt_foreign_instance",
      (f) => void (f.projection.providerSessions[0]!.driver = "cursor"),
    ],
    [
      "residual_native_id_unrecorded",
      (f) =>
        void (f.projection.providerThreads[0]!.nativeThreadRef = {
          driver: "codex",
          nativeId: "pending:run",
          strength: "strong",
        }),
    ],
    [
      "residual_native_id_unrecorded",
      (f) =>
        void (f.projection.providerThreads[0]!.nativeThreadRef = {
          driver: "codex",
          nativeId: connector.nativeThreadId,
          strength: "weak",
        }),
    ],
    [
      "residual_native_id_conflict",
      (f) =>
        void (f.projection.attempts[0]!.nativeThreadId = "01a18900-0000-7000-8000-000000000000"),
    ],
    ["residual_no_started_attempt", (f) => void (f.projection.attempts = [])],
    // T5: incomplete, unreadable, remote, delegated, separately launched or unbound children.
    ["residual_lineage_unreadable", (f) => void (f.unreadableThreads = 1)],
    [
      "residual_descendant_unreadable",
      (f) => void (f.descendants[0] = { ...f.descendants[0]!, projection: null }),
    ],
    [
      "residual_descendant_remote",
      (f) => void (f.projection.subagents[0]!.remoteChild = { environmentId: "remote" }),
    ],
    [
      "residual_descendant_delegated",
      (f) => void (child(f).thread.delegatedFrom = { environmentId: "remote" }),
    ],
    ["residual_descendant_t3_launched", (f) => void (child(f).runs = [{ id: "run:child" }])],
    [
      "residual_descendant_t3_launched",
      (f) =>
        void (child(f).thread.lineage = {
          parentThreadId: f.projection.thread.id,
          relationshipToParent: "fork",
        }),
    ],
    [
      "residual_descendant_unbound",
      (f) => void (f.projection.subagents[0]!.providerInstanceId = "claudeAgent"),
    ],
    ["residual_descendant_unbound", (f) => void (f.projection.subagents[0]!.origin = "app_owned")],
    [
      "residual_descendant_unbound",
      (f) => void (child(f).providerThreads[0]!.providerSessionId = "provider-session:other"),
    ],
    [
      "residual_descendant_unbound",
      (f) =>
        void (child(f).providerThreads[0]!.forkedFrom = {
          providerThreadId: "provider-thread:other",
        }),
    ],
    [
      "residual_descendant_unbound",
      (f) =>
        void (child(f).providerThreads[0]!.forkedFrom = {
          providerThreadId: f.projection.providerThreads[0]!.id,
          providerTurnId: "provider-turn:other",
        }),
    ],
    [
      "residual_descendant_unbound",
      (f) =>
        void (f.projection.subagents[0]!.nativeTaskRef = {
          driver: "codex",
          nativeId: "call_1:other",
          strength: "strong",
        }),
    ],
    [
      "residual_descendant_unbound",
      (f) => void (f.projection.subagents[0]!.childThreadId = "thread:other"),
    ],
    [
      "residual_descendant_unbound",
      (f) =>
        void (child(f).thread.lineage = {
          parentThreadId: "thread:elsewhere",
          relationshipToParent: "subagent",
        }),
    ],
    // One adapter throughout: a child thread, native ref or subagent of another driver is foreign.
    [
      "residual_descendant_unbound",
      (f) => void (child(f).providerThreads[0]!.driver = "claudeAgent"),
    ],
    [
      "residual_descendant_unbound",
      (f) =>
        void (child(f).providerThreads[0]!.nativeThreadRef = {
          driver: "claudeAgent",
          nativeId: connectorChildren[0]!.native,
          strength: "strong",
        }),
    ],
    [
      "residual_descendant_unbound",
      (f) => void (f.projection.subagents[0]!.driver = "claudeAgent"),
    ],
    // The parent's fork turn is required, not merely checked when present.
    [
      "residual_descendant_unbound",
      (f) =>
        void (child(f).providerThreads[0]!.forkedFrom = {
          providerThreadId: f.projection.providerThreads[0]!.id,
        }),
    ],
  ])("refuses %s", (refusal, change) => {
    assert.include(refusalsOf(change), refusal);
  });

  it("accepts the second Codex producer's item shape only with the same binding", () => {
    // subAgentActivity.started names its item `<activity id>:<child>`, as spawnAgent does.
    const activityShape = (f: FactsFixture) => {
      f.projection.subagents[0]!.nativeTaskRef = {
        driver: "codex",
        nativeId: `activity_1:${connectorChildren[0]!.native}`,
        strength: "strong",
      };
    };
    assert.deepStrictEqual(refusalsOf(activityShape), []);
    // The same driver and fork-turn bindings hold for that shape too.
    assert.include(
      refusalsOf((f) => {
        activityShape(f);
        child(f).providerThreads[0]!.driver = "claudeAgent";
      }),
      "residual_descendant_unbound",
    );
    assert.include(
      refusalsOf((f) => {
        activityShape(f);
        child(f).providerThreads[0]!.forkedFrom = {
          providerThreadId: f.projection.providerThreads[0]!.id,
        };
      }),
      "residual_descendant_unbound",
    );
  });
});

describe("the owner's residual decision in terminationRefusals", () => {
  const exact = ["non_t3_side_effects_unrecordable", "provider_executor_locality_unrecorded"];
  it.each<[string, ReadonlyArray<string>, ReadonlyArray<string>]>([
    ["the exact set", [...exact].reverse(), []],
    ["an incomplete set", ["provider_executor_locality_unrecorded"], ["residual_mismatch"]],
    ["a repeated entry", [...exact, "non_t3_side_effects_unrecordable"], ["residual_mismatch"]],
    ["nothing", [], ["residual_mismatch"]],
  ])("accepts only %s", (_name, accepted, expected) => {
    assert.deepStrictEqual(residualRefusals({ accepted, refusals: [] }), expected);
  });

  const unproved = { ...capture, provenance: "missing" as const, provenanceDigest: null };
  const decided = {
    ...unproved,
    residual: { accepted: exact, refusals: [], scopeDigest: "scope-1" },
  };
  const residualCapture: HistoricalTermination = {
    capture: {
      ...unboundCapture,
      residual: {
        accepted: ["non_t3_side_effects_unrecordable", "provider_executor_locality_unrecorded"],
        scopeDigest: "scope-1",
        scope: "{}",
      },
    },
  };

  it("never captures an unproved execution without the owner's exact decision", () => {
    assert.deepStrictEqual(terminationRefusals(unproved), ["historical_provenance_missing"]);
    assert.deepStrictEqual(terminationRefusals(decided), []);
    assert.include(
      terminationRefusals({
        ...decided,
        residual: { ...decided.residual, refusals: ["residual_descendant_remote"] },
      }),
      "residual_descendant_remote",
    );
    // A decision never stands beside provenance.
    assert.include(
      terminationRefusals({ ...capture, residual: decided.residual }),
      "residual_with_provenance",
    );
  });

  it("verifies only the very scope and set its capture recorded, on a later boot", () => {
    const verifyDecided = {
      ...verify,
      provenance: "missing" as const,
      provenanceDigest: null,
      residual: decided.residual,
      recorded: residualCapture,
    };
    assert.deepStrictEqual(terminationRefusals(verifyDecided), []);
    assert.include(
      terminationRefusals({
        ...verifyDecided,
        residual: { ...decided.residual, scopeDigest: "scope-2" },
      }),
      "residual_scope_changed",
    );
    // A capture that bound provenance, or nothing, is not this decision.
    assert.include(
      terminationRefusals({ ...verifyDecided, recorded: captured }),
      "residual_scope_changed",
    );
    assert.include(terminationRefusals({ ...verifyDecided, host: capturedBoot }), "same_boot");
  });
});
