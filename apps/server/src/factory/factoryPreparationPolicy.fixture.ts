// @effect-diagnostics nodeBuiltinImport:off - a disposable one-shot policy process.
/**
 * A one-shot policy that prepares items before their build, in BTC, HSA and connector shapes keyed
 * by factory id. Only the latest verified proposal for the current item version is adopted, once its
 * blockers' work is integrated; a `decision:` blocker is asked once on its exact text.
 */
import * as NodeCrypto from "node:crypto";

interface Report {
  readonly outcome: string;
  readonly failure?: string;
  readonly proposal?: {
    readonly basis: string;
    readonly unit: string;
    readonly ownedFiles: ReadonlyArray<string>;
    readonly splits?: ReadonlyArray<string>;
  };
}

interface Outcome {
  readonly outcomeId: string;
  readonly stage?: string;
  readonly state: string;
  readonly report: Report;
  readonly itemVersion?: string;
}

interface Issue {
  readonly itemKey: string;
  readonly issueNumber?: number;
  readonly body: string;
  readonly labels: ReadonlyArray<string>;
  readonly blockedBy: ReadonlyArray<{ readonly number: number; readonly state: string }> | null;
  readonly subIssueCount?: number;
}

interface Item {
  readonly decisionKey: string;
  readonly stage: { readonly type: string };
  readonly itemVersion: string;
  readonly item: Issue;
  readonly outcomes: ReadonlyArray<Outcome>;
  readonly blockers?: ReadonlyArray<{
    readonly itemKey: string;
    readonly outcomes: ReadonlyArray<Outcome>;
  }>;
  readonly reserved: ReadonlyArray<{ readonly evidenceDigest: string; readonly state: string }>;
}

interface Facts {
  readonly factoryId: string;
  readonly items: ReadonlyArray<Item>;
  readonly active: ReadonlyArray<{ readonly item: Issue }>;
}

/** What each project's configuration allows: how a proposal is adopted, and whether a parent may yield a child. */
const PROFILES: Record<string, { readonly adopt: "auto" | "owner"; readonly children: boolean }> = {
  btc: { adopt: "auto", children: false },
  hsa: { adopt: "auto", children: true },
  connector: { adopt: "owner", children: false },
};

const HELD = ["permission", "private_data", "ownership", "hold"];

const digest = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const ownedFiles = (body: string) => {
  const section = /^## Owned files\n([\s\S]*?)(?:\n## |$)/m.exec(body)?.[1];
  return section === undefined
    ? undefined
    : [...section.matchAll(/^- `?([^`\n]+?)`?$/gm)].map((match) => match[1]!);
};

const nothing = (cls: string, reason: string) => ({ decision: "none", class: cls, reason });

const admit = (entry: Item, brief: string, grantEvidence?: string) => ({
  decision: "admit",
  title: `${entry.stage.type} ${entry.item.itemKey}`,
  brief,
  poolId: "builders",
  units: 1,
  ...(grantEvidence === undefined
    ? {}
    : {
        grant: {
          reason: "The owner adopts each prepared unit before its build starts.",
          evidence: grantEvidence,
        },
      }),
});

/** The first unmet dependency, or undefined once every blocker's work is integrated. */
const unmetDependency = (entry: Item) => {
  if (entry.item.blockedBy === null) return "the tracker could not say what blocks this item";
  const open = entry.item.blockedBy.find((blocker) => blocker.state !== "closed");
  if (open !== undefined) return `waits on #${open.number}; resumes when it closes integrated`;
  const unintegrated = (entry.blockers ?? []).find(
    (blocker) =>
      !blocker.outcomes.some(
        (outcome) => outcome.state === "verified" && outcome.report.outcome === "integrated",
      ),
  );
  return unintegrated === undefined
    ? undefined
    : `waits on ${unintegrated.itemKey}: closed without integrated work`;
};

const decide = (facts: Facts, entry: Item): unknown => {
  const profile = PROFILES[facts.factoryId] ?? { adopt: "owner", children: false };
  const labels = new Set(entry.item.labels);
  if (labels.has("hold")) return nothing("held", "an owner hold is on this item");
  if (entry.stage.type !== "implement") {
    return entry.stage.type === "integrate" || entry.stage.type === "close"
      ? { decision: "proceed" }
      : admit(entry, `Do the ${entry.stage.type} stage of ${entry.item.itemKey}.`);
  }
  const parent = (entry.item.subIssueCount ?? 0) > 0 || labels.has("umbrella");
  if (parent && !profile.children) {
    return nothing(
      "parent",
      "an umbrella is not a unit; its bounded children are filed by a person",
    );
  }
  const spec = ownedFiles(entry.item.body);
  if (spec !== undefined && !parent) {
    const waiting = unmetDependency(entry);
    return waiting === undefined
      ? admit(entry, `Build ${entry.item.itemKey} as its issue specifies.`)
      : nothing("waiting", waiting);
  }
  const triaged = entry.outcomes.filter(
    (outcome) => outcome.stage === "triage" && outcome.itemVersion === entry.itemVersion,
  );
  if (triaged.length === 0) {
    return {
      decision: "triage",
      title: `prepare ${entry.item.itemKey}`,
      brief: [
        `Prepare ${entry.item.itemKey} at item version ${entry.itemVersion} into one bounded unit.`,
        "Read the issue, its blockers, the repository at its integration base, the project rules and prior results; change nothing.",
        "Report the candidate base as subject.baseCommit, the checks in the unit, and a dependency in the unit, not as a blocker.",
        "Report not_actionable only for what a person must settle, its failure led by decision:, permission:, private_data:, ownership: or hold:.",
      ].join("\n"),
      poolId: "builders",
      units: 1,
    };
  }
  const latest = triaged.at(-1)!;
  if (latest.state === "reported")
    return nothing("triage_pending", "the proposal is not verified yet");
  if (latest.state !== "verified") {
    return nothing(
      "not_actionable",
      `the preparation of this version was rejected; it is prepared again when the issue changes`,
    );
  }
  if (latest.report.outcome === "not_actionable") {
    const failure = latest.report.failure ?? "";
    const kind = /^([a-z_]+):/.exec(failure)?.[1];
    if (kind === "decision") {
      return { decision: "reserve", reason: failure.slice(0, 2_000), evidence: failure };
    }
    if (kind !== undefined && HELD.includes(kind)) return nothing("held", failure.slice(0, 2_000));
    return nothing("not_actionable", failure.slice(0, 2_000));
  }
  const proposal = latest.report.proposal!;
  if (parent) {
    const [child] = proposal.splits ?? [];
    if (
      child === undefined ||
      entry.outcomes.some((outcome) => outcome.report.outcome === "ticket_opened")
    ) {
      return nothing("parent", "an umbrella is not built; its prepared child carries the work");
    }
    return {
      decision: "spawn",
      reason: `the prepared split of ${entry.item.itemKey}`,
      ticket: {
        title: child.slice(0, 200),
        body: child,
        labels: [],
        parentIssueNumber: entry.item.issueNumber ?? null,
        blocks: [],
      },
    };
  }
  const busy = facts.active.find((work) =>
    (ownedFiles(work.item.body) ?? []).some((file) => proposal.ownedFiles.includes(file)),
  );
  if (busy !== undefined) {
    return nothing("waiting", `its owned files are in use by ${busy.item.itemKey}`);
  }
  const waiting = unmetDependency(entry);
  if (waiting !== undefined) return nothing("waiting", waiting);
  const brief = `Build the prepared unit ${latest.outcomeId} of ${entry.item.itemKey}:\n\n${proposal.unit}`;
  return profile.adopt === "auto"
    ? admit(entry, brief)
    : admit(
        entry,
        brief,
        `adopt ${latest.outcomeId} at ${entry.itemVersion}: ${digest(proposal.unit)}`,
      );
};

const chunks: Array<Buffer> = [];
process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
process.stdin.on("end", () => {
  const facts = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Facts;
  process.stdout.write(
    `${JSON.stringify({
      decisions: facts.items.map((entry) => ({
        itemKey: entry.item.itemKey,
        decision: decide(facts, entry),
      })),
    })}\n`,
  );
});
