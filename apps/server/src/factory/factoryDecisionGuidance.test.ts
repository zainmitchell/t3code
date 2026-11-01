import { assert, it } from "@effect/vitest";

import { decisionGuidance } from "./factoryDecisionGuidance.ts";

const gate = {
  decisionId: "d0001",
  itemKey: "github:example-org/beta#7",
  stage: "integrate",
  kind: "gate" as const,
};

it("names the host CLI command for this exact decision beside every other route", () => {
  assert.strictEqual(
    decisionGuidance(gate, { factoryId: "beta" }, "linux"),
    [
      "Decision d0001: only the owner can answer it; agents in threads cannot. Answer it in Settings → Factories in a T3 app that has it, with t3_factory_decide from the owner's own MCP session, or on the server host with the installed T3 CLI:",
      "    t3 factory decide --factory beta --decision d0001 --item 'github:example-org/beta#7' --stage integrate --answer approve",
      "--answer takes approve or decline.",
    ].join("\n\n"),
  );
});

it("names the owner's thread first when the factory asks there", () => {
  const guidance = decisionGuidance(
    gate,
    { factoryId: "beta", ownerThreadId: "thread-owner" },
    "linux",
  );
  assert.include(
    guidance,
    "Answer it in the owner's thread thread-owner, where T3 asked it, in Settings → Factories in a T3 app that has it, with t3_factory_decide",
  );
});

it("grants one start from the CLI only for a grant request", () => {
  assert.include(
    decisionGuidance({ ...gate, kind: "grant" }, { factoryId: "beta" }, "linux"),
    "--stage integrate --answer approve --units 1\n",
  );
  assert.notInclude(decisionGuidance(gate, { factoryId: "beta" }, "linux"), "--units");
});

it("offers the answers a ticket question takes", () => {
  const ticket = { ...gate, stage: "ticket", kind: undefined };
  const guidance = decisionGuidance(ticket, { factoryId: "beta" }, "linux");
  assert.include(guidance, "--stage ticket --answer approve\n");
  assert.isTrue(guidance.endsWith("--answer takes approve or abandon."));
});

it("quotes a value the shell would split or read", () => {
  assert.include(
    decisionGuidance({ ...gate, itemKey: "github:o/r#1 it's" }, { factoryId: "beta" }, "linux"),
    `--item 'github:o/r#1 it'\\''s'`,
  );
});

it("quotes an apostrophe the POSIX shell would read", () => {
  assert.include(
    decisionGuidance(gate, { factoryId: "owner's factory" }, "linux"),
    `--factory 'owner'\\''s factory'`,
  );
});

it("renders the command for PowerShell on a Windows host", () => {
  const guidance = decisionGuidance(gate, { factoryId: "owner's factory" }, "win32");
  assert.include(guidance, ", or on the server host in PowerShell with the installed T3 CLI:\n\n");
  assert.include(
    guidance,
    `\n    t3 factory decide --factory "owner's factory" --decision "d0001" --item "github:example-org/beta#7" --stage "integrate" --answer approve\n`,
  );
});

it("escapes what PowerShell would expand or end a string at", () => {
  assert.include(
    decisionGuidance(gate, { factoryId: 'a$b`c"d\u201Ce' }, "win32"),
    '--factory "a`$b``c""d\u201C\u201Ce"',
  );
});

it("grants one start from the PowerShell command only for a grant request", () => {
  assert.include(
    decisionGuidance({ ...gate, kind: "grant" }, { factoryId: "beta" }, "win32"),
    `--stage "integrate" --answer approve --units 1\n`,
  );
  assert.notInclude(decisionGuidance(gate, { factoryId: "beta" }, "win32"), "--units");
});
