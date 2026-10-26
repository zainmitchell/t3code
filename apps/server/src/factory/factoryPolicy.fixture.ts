// @effect-diagnostics nodeBuiltinImport:off - a disposable one-shot policy process.
/**
 * A one-shot project policy using synthetic tracker labels: item facts on stdin, one decision
 * per item on stdout in priority order. Labels: `priority:first`, `policy:owner` (owner answer
 * on exact evidence), `policy:gate-fail`, `policy:medium` (`builder-medium`), `policy:supervised`
 * (finite grant), `policy:blocked` (nothing proposed); `policy:garbage`/`policy:exit` break it.
 */
import * as NodeCrypto from "node:crypto";

interface Item {
  readonly decisionKey: string;
  readonly stage: { readonly type: string; readonly head?: string };
  readonly item: { readonly itemKey: string; readonly labels: ReadonlyArray<string> };
  readonly reserved: ReadonlyArray<{
    readonly evidenceDigest: string;
    readonly state: string;
    readonly resolution?: { readonly answer: string };
  }>;
}

const digest = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const decide = (entry: Item): unknown => {
  const labels = new Set(entry.item.labels);
  if (labels.has("policy:blocked")) {
    return { decision: "none", reason: "blocked by unfinished dependency" };
  }
  const stage = entry.stage.type;
  if (stage === "integrate" || stage === "close") {
    if (labels.has("policy:gate-fail") && stage === "integrate") {
      return {
        decision: "fail",
        failure: `new privacy finding against base for ${entry.stage.head}`,
      };
    }
    if (labels.has("policy:owner") && stage === "integrate") {
      const evidence = `Synthetic owner decision for ${entry.stage.head}`;
      const approved = entry.reserved.some(
        (decision) =>
          decision.evidenceDigest === digest(evidence) &&
          decision.state === "resolved" &&
          decision.resolution?.answer === "approve",
      );
      if (!approved) {
        return { decision: "reserve", reason: "The owner decides this release.", evidence };
      }
    }
    return { decision: "proceed" };
  }
  return {
    decision: "admit",
    title: `${stage} ${entry.item.itemKey}`,
    brief: `Do the ${stage} stage of ${entry.item.itemKey}; work key ${entry.decisionKey}.`,
    poolId: "builders",
    units: 1,
    ...(labels.has("policy:medium") ? { execution: "builder-medium" } : {}),
    ...(labels.has("policy:supervised")
      ? {
          grant: {
            reason: "Supervised ticket: the owner grants each start.",
            evidence: `supervised start of ${entry.item.itemKey}`,
          },
        }
      : {}),
  };
};

const chunks: Array<Buffer> = [];
process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
process.stdin.on("end", () => {
  const facts = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    readonly items: ReadonlyArray<Item>;
  };
  const labels = new Set(facts.items.flatMap((entry) => entry.item.labels));
  if (labels.has("policy:exit")) {
    process.stderr.write("policy checkout is missing\n");
    process.exit(3);
  }
  if (labels.has("policy:garbage")) {
    process.stdout.write("not a decision\n");
    return;
  }
  const ordered = [
    ...facts.items.filter((entry) => entry.item.labels.includes("priority:first")),
    ...facts.items.filter((entry) => !entry.item.labels.includes("priority:first")),
  ];
  process.stdout.write(
    `${JSON.stringify({
      decisions: ordered.map((entry) => ({ itemKey: entry.item.itemKey, decision: decide(entry) })),
    })}\n`,
  );
});
