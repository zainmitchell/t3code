import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  bootBoundaryRefusals,
  coveredAttempts,
  decodeHistoricalProvenance,
  type HostBoot,
  provedCoverage,
  registryValue,
  type TerminationCoverage,
} from "./factoryHistoricalTermination.ts";

const windows: HostBoot = {
  platform: "win32",
  machineId: "machine-a",
  bootId: "20",
  uptimeMs: 276_517_000,
};
const linux: HostBoot = {
  platform: "linux",
  machineId: "machine-a",
  bootId: "boot-a",
  uptimeMs: 90_000_000,
};

describe("bootBoundaryRefusals", () => {
  it("accepts only a later boot of the same host", () => {
    assert.deepStrictEqual(
      bootBoundaryRefusals(windows, { ...windows, bootId: "21", uptimeMs: 120_000 }),
      [],
    );
    assert.deepStrictEqual(
      bootBoundaryRefusals(linux, { ...linux, bootId: "boot-b", uptimeMs: 60_000 }),
      [],
    );
  });

  it.each<[string, HostBoot, HostBoot, ReadonlyArray<string>]>([
    // The same boot read again, however much later by the wall clock.
    [
      "same boot",
      windows,
      { ...windows, uptimeMs: windows.uptimeMs + 86_400_000 },
      ["same_boot", "uptime_not_reset"],
    ],
    // A resume from sleep or hibernation keeps its boot and its counter.
    [
      "resume",
      linux,
      { ...linux, uptimeMs: linux.uptimeMs + 1 },
      ["same_boot", "uptime_not_reset"],
    ],
    // A new boot id whose counter never restarted is no proof the OS started again.
    [
      "counter not reset",
      linux,
      { ...linux, bootId: "boot-b", uptimeMs: linux.uptimeMs },
      ["uptime_not_reset"],
    ],
    // Windows' boot counter only moves forward; an older or rolled-back one proves nothing.
    ["earlier counter", windows, { ...windows, bootId: "19", uptimeMs: 1_000 }, ["boot_not_later"]],
    [
      "unparsable counter",
      windows,
      { ...windows, bootId: "x", uptimeMs: 1_000 },
      ["boot_not_later"],
    ],
    [
      "foreign host",
      windows,
      { ...windows, machineId: "machine-b", bootId: "21", uptimeMs: 1_000 },
      ["foreign_host"],
    ],
    ["other platform", windows, { ...linux, uptimeMs: 1_000 }, ["foreign_host"]],
  ])("refuses %s", (_name, captured, current, refusals) => {
    assert.deepStrictEqual(bootBoundaryRefusals(captured, current), refusals);
  });
});

const covers: TerminationCoverage = {
  attempts: ["attempt:1", "attempt:2"],
  launches: [
    { runId: "run:1", status: "succeeded", attemptCount: 1 },
    { runId: "run:2", status: "succeeded", attemptCount: 1 },
  ],
  generations: ["generation:1"],
};

describe("coveredAttempts", () => {
  it("covers exactly the proved attempts while nothing it did not name appeared", () => {
    assert.deepStrictEqual(
      [...coveredAttempts(covers, { launches: covers.launches.toReversed(), generations: [] })],
      ["attempt:1", "attempt:2"],
    );
    assert.strictEqual(coveredAttempts(undefined, { launches: [], generations: [] }).size, 0);
  });

  it.each<[string, Pick<TerminationCoverage, "launches" | "generations">]>([
    [
      "a later launch",
      {
        launches: [...covers.launches, { runId: "run:3", status: "pending", attemptCount: 0 }],
        generations: ["generation:1"],
      },
    ],
    [
      "a launch claimed again",
      {
        launches: [covers.launches[0]!, { runId: "run:2", status: "succeeded", attemptCount: 2 }],
        generations: ["generation:1"],
      },
    ],
    ["a launch gone", { launches: [covers.launches[0]!], generations: ["generation:1"] }],
    [
      "a new container",
      { launches: covers.launches, generations: ["generation:1", "generation:2"] },
    ],
  ])("covers nothing after %s", (_name, current) => {
    assert.strictEqual(coveredAttempts(covers, current).size, 0);
  });
});

describe("provedCoverage", () => {
  const bound = { covers, provenance: { digest: "d", source: "synthetic" } };
  it("covers only a proof whose capture bound retained provenance", () => {
    assert.strictEqual(provedCoverage({ capture: bound, proof: {} }), covers);
    // Unproved, or proved by a build that bound no provenance (R1): nothing is covered.
    assert.strictEqual(provedCoverage({ capture: bound }), undefined);
    assert.strictEqual(provedCoverage({ capture: { covers }, proof: {} }), undefined);
    assert.strictEqual(provedCoverage(undefined), undefined);
  });
});

describe("decodeHistoricalProvenance", () => {
  const valid = {
    reservationId: "reservation:1",
    operationRef: "restart:1",
    source: "synthetic",
    host: { platform: "win32", machineId: "machine-a" },
    runs: ["run:1"],
    attempts: ["attempt:1"],
    launches: [{ runId: "run:1", status: "succeeded", attemptCount: 1 }],
    providerSessions: [],
    executors: [{ kind: "local_process", machineId: "machine-a" }],
  };
  it("decodes only a complete record; anything else is not provenance", () => {
    assert.isTrue(Option.isSome(decodeHistoricalProvenance(valid)));
    for (const value of [
      null,
      "restart:1",
      JSON.stringify(valid),
      { ...valid, executors: undefined },
      { ...valid, host: { platform: "darwin", machineId: "machine-a" } },
      { ...valid, executors: [{ kind: "container", machineId: "machine-a" }] },
    ]) {
      assert.isTrue(Option.isNone(decodeHistoricalProvenance(value)));
    }
  });
});

describe("registryValue", () => {
  it("reads one value of a reg query listing", () => {
    const listing = [
      "",
      "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters",
      "    BootId    REG_DWORD    0x14",
      "    BootIdPrevious    REG_DWORD    0x13",
      "",
    ].join("\r\n");
    assert.strictEqual(registryValue(listing, "BootId"), "0x14");
    assert.strictEqual(Number(registryValue(listing, "BootId")), 20);
    assert.strictEqual(registryValue(listing, "MachineGuid"), undefined);
  });
});
