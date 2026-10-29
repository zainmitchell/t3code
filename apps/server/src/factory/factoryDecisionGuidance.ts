import { factoryDecisionChoices } from "@t3tools/contracts";

const shellWord = (value: string) =>
  /^[\w.:/@=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

// Matches powershellWord in cli/invocation.ts, which renders host commands on Windows.
const powershellWord = (value: string) =>
  `"${value
    .replaceAll("`", "``")
    .replaceAll("$", "`$")
    .replace(/["“”„]/g, "$&$&")}"`;

/**
 * How the owner can answer a reserved decision, for its durable tracker record. It names every
 * route that can answer on this server: the reader may be on a client without Factories settings
 * or the owner's thread, and the installed host-admin CLI works from the server host regardless.
 */
export const decisionGuidance = (
  decision: {
    readonly decisionId: string;
    readonly itemKey: string;
    readonly stage: string;
    readonly kind?: "gate" | "grant" | undefined;
  },
  configuration: { readonly factoryId: string; readonly ownerThreadId?: string | undefined },
  platform: NodeJS.Platform,
): string => {
  const powershell = platform === "win32";
  const word = powershell ? powershellWord : shellWord;
  const answers = factoryDecisionChoices(decision).map((choice) => choice.answer);
  // The CLI takes --units only with approving a grant request, which is its first answer.
  const command = [
    "t3 factory decide",
    `--factory ${word(configuration.factoryId)}`,
    `--decision ${word(decision.decisionId)}`,
    `--item ${word(decision.itemKey)}`,
    `--stage ${word(decision.stage)}`,
    `--answer ${answers[0]}`,
    ...(decision.kind === "grant" ? ["--units 1"] : []),
  ].join(" ");
  const routes = [
    ...(configuration.ownerThreadId === undefined
      ? []
      : [`in the owner's thread ${configuration.ownerThreadId}, where T3 asked it`]),
    "in Settings → Factories in a T3 app that has it",
    "with t3_factory_decide from the owner's own MCP session",
  ];
  return [
    `Decision ${decision.decisionId}: only the owner can answer it; agents in threads cannot. Answer it ${routes.join(", ")}, or on the server host${powershell ? " in PowerShell" : ""} with the installed T3 CLI:`,
    `    ${command}`,
    `--answer takes ${answers.join(" or ")}.`,
  ].join("\n\n");
};
