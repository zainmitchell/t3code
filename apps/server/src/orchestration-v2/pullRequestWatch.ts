import type {
  OrchestrationV2Notification,
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail,
  ThreadPullRequestWatch,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Bounds consecutive comment-only wakes to stop bot reply loops; check, conflict, or push news resets it. */
export const PULL_REQUEST_WATCH_WAKE_LIMIT = 10;
/** How long a head may go without any check before the agent is told none reported. */
const PULL_REQUEST_WATCH_NO_CHECKS_MS = 15 * 60_000;
const LISTED_ITEMS = 10;
const SNIPPET_LENGTH = 200;
/** Told checks kept while reads leave them out; a push clears them anyway. */
const REMEMBERED_CHECKS = 100;

export type PullRequestWatchChange =
  | { readonly kind: "checks-failed"; readonly failed: ReadonlyArray<PullRequestCheck> }
  | { readonly kind: "awaiting-approval"; readonly checks: ReadonlyArray<PullRequestCheck> }
  | { readonly kind: "checks-passed"; readonly count: number; readonly required: boolean }
  | { readonly kind: "remarks"; readonly remarks: ReadonlyArray<PullRequestComment> }
  | { readonly kind: "no-checks"; readonly minutes: number }
  | { readonly kind: "conflicting" };

export interface PullRequestWatchReport {
  readonly changes: ReadonlyArray<PullRequestWatchChange>;
  readonly next: ThreadPullRequestWatch;
  readonly exhausted: boolean;
}

// action-required is a finished check needing human input.
const isFailedCheck = (check: PullRequestCheck) =>
  check.status === "failure" || check.status === "cancelled" || check.status === "action-required";

// A told check is kept with its URL, so a rerun that fails again is news, and a wait on approval
// is kept apart, so the same run failing later is news too. Saved watches, and checks without a
// URL, hold the bare name.
const APPROVAL = "approval: ";
const toldKey = (check: PullRequestCheck) => {
  const key = check.url === null ? check.name : `${check.name} ${check.url}`;
  return check.status === "action-required" ? `${APPROVAL}${key}` : key;
};

/** Whether a read shows the check a told key names: the same name, or a job of its run. */
function shows(checks: ReadonlyArray<PullRequestCheck>, told: string): boolean {
  const key = told.startsWith(APPROVAL) ? told.slice(APPROVAL.length) : told;
  const at = key.lastIndexOf(" ");
  const url = at > 0 && key.includes("://", at) ? key.slice(at + 1) : null;
  const name = url === null ? key : key.slice(0, at);
  return checks.some(
    (check) => check.name === name || (url !== null && (check.url?.startsWith(`${url}/`) ?? false)),
  );
}

export function evaluatePullRequestWatch(
  watch: ThreadPullRequestWatch,
  detail: Pick<
    PullRequestDetail,
    "capabilities" | "headSha" | "checks" | "mergeability" | "viewer" | "author"
  >,
  remarks: ReadonlyArray<PullRequestComment> | null,
  now: number,
): PullRequestWatchReport {
  const changes: Array<PullRequestWatchChange> = [];
  // A read that does not know the head is not a push, so it forgets nothing.
  const headSha = detail.headSha ?? watch.headSha;
  const headMoved = headSha !== watch.headSha;

  // Hosts can return no checks on read failure; preserve prior state.
  let failedChecks = headMoved ? [] : watch.failedChecks;
  let passed = headMoved ? false : watch.passed;
  let passedChecks = headMoved ? [] : watch.passedChecks;
  let owedChecks = headMoved ? [] : (watch.owedChecks ?? []);
  if (detail.checks.length > 0) {
    const failed = detail.checks.filter(isFailedCheck);
    const newlyFailed = failed.filter(
      (check) => !failedChecks.includes(toldKey(check)) && !failedChecks.includes(check.name),
    );
    const broken = newlyFailed.filter((check) => check.status !== "action-required");
    const waiting = newlyFailed.filter((check) => check.status === "action-required");
    if (broken.length > 0) changes.push({ kind: "checks-failed", failed: broken });
    if (waiting.length > 0) changes.push({ kind: "awaiting-approval", checks: waiting });
    // A read can leave out a told check, such as an approval run the host stops listing between
    // reads. That is no news, so it stays told until the read shows that check again.
    const leftOut = failedChecks.filter((key) => !shows(detail.checks, key));
    failedChecks = [...new Set([...leftOut, ...failed.map(toldKey)])].slice(-REMEMBERED_CHECKS);

    // Only required checks show that CI passed. Optional ones can be only bots, such as labelers
    // that run while CI waits on a maintainer, so they report a pass only as the one owed wake
    // after a required pass. A read that leaves required checks out is no news either: a told
    // pass stands until one is pending or fails.
    const required = detail.checks.filter((check) => check.required === true);
    if (required.length > 0) {
      const passedNow = required.every(
        (check) => check.status !== "pending" && !isFailedCheck(check),
      );
      const requiredNames = required.map((check) => check.name);
      const told = passed && passedChecks.length === 0 ? requiredNames : passedChecks;
      // A required job created and finished between two passes is never seen pending.
      const grew = requiredNames.some((name) => !told.includes(name));
      // Other checks still pending when required ones passed are owed one wake when all settle.
      // Only those are owed, so later advisory churn never wakes. One turned required is gate news.
      const owed =
        passedNow && passed
          ? detail.checks
              .filter((check) => check.required !== true && owedChecks.includes(check.name))
              .map((check) => check.name)
          : [];
      const settled =
        failed.length === 0 && detail.checks.every((check) => check.status !== "pending");
      owedChecks = owed;
      if (passedNow && (!passed || grew)) {
        changes.push({ kind: "checks-passed", count: required.length, required: true });
        owedChecks = detail.checks
          .filter((check) => check.required !== true && check.status === "pending")
          .map((check) => check.name);
      } else if (settled && owed.length > 0) {
        changes.push({ kind: "checks-passed", count: detail.checks.length, required: false });
        owedChecks = [];
      }
      passed = passedNow;
      passedChecks = passedNow
        ? [...new Set([...told, ...requiredNames])].slice(-REMEMBERED_CHECKS)
        : [];
    }
  }

  // Only a head never read with checks waits for them: an empty read after checks were seen is
  // the failed read above. A watch saved before this field may have seen pending checks on its
  // head, so its clock starts only at the next push. Where a host's empty list can mean the
  // repository runs no checks at all, nothing waits.
  let checksAwaitedSince = watch.checksAwaitedSince;
  if (detail.capabilities.checksAlwaysReport === true) {
    const awaitedBefore = headMoved
      ? DateTime.formatIso(DateTime.makeUnsafe(now))
      : (watch.checksAwaitedSince ?? null);
    checksAwaitedSince = detail.checks.length > 0 ? null : awaitedBefore;
    const awaitedMs = checksAwaitedSince === null ? 0 : now - Date.parse(checksAwaitedSince);
    if (awaitedMs >= PULL_REQUEST_WATCH_NO_CHECKS_MS) {
      changes.push({ kind: "no-checks", minutes: Math.round(awaitedMs / 60_000) });
      checksAwaitedSince = null;
    }
  }

  const own = (detail.viewer ?? detail.author?.login)?.toLowerCase();
  const through = Date.parse(watch.remarksThrough);
  const activeAt = (remark: PullRequestComment) => remark.editedAt ?? remark.createdAt;
  // Hosts can stamp remarks to the second, so remarks at the boundary time are told apart by ID.
  const fresh = (remarks ?? []).filter((remark) => {
    const at = Date.parse(activeAt(remark));
    return (
      (at > through || (at === through && !watch.remarkIds.includes(remark.id))) &&
      remark.author?.login.toLowerCase() !== own
    );
  });
  if (fresh.length > 0) changes.push({ kind: "remarks", remarks: fresh });
  const latest = Math.max(through, ...fresh.map((remark) => Date.parse(activeAt(remark))));
  const atLatest = fresh.filter((remark) => Date.parse(activeAt(remark)) === latest);
  const remarksThrough = latest === through ? watch.remarksThrough : activeAt(atLatest[0]!);
  const remarkIds = [
    ...(latest === through ? watch.remarkIds : []),
    ...atLatest.map((remark) => remark.id),
  ];

  if (detail.mergeability === "conflicting" && !watch.conflicting) {
    changes.push({ kind: "conflicting" });
  }
  // "unknown" is a host still computing after a push; only a clean answer clears a conflict.
  const conflicting =
    detail.mergeability === "unknown" ? watch.conflicting : detail.mergeability === "conflicting";

  const commentsOnly = changes.length > 0 && changes.every((change) => change.kind === "remarks");
  const progress = headMoved || (changes.length > 0 && !commentsOnly);
  const wakes = (progress ? 0 : watch.wakes) + (commentsOnly ? 1 : 0);
  return {
    changes,
    next: {
      startedAt: watch.startedAt,
      headSha,
      failedChecks,
      passed,
      passedChecks,
      owedChecks,
      remarksThrough,
      remarkIds,
      conflicting,
      wakes,
      checksAwaitedSince,
    },
    exhausted: commentsOnly && wakes >= PULL_REQUEST_WATCH_WAKE_LIMIT,
  };
}

function snippet(body: string): string {
  const text = body
    .replaceAll(/<!--[\s\S]*?-->/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return text.length <= SNIPPET_LENGTH ? text : `${text.slice(0, SNIPPET_LENGTH - 3)}...`;
}

function listed<T>(items: ReadonlyArray<T>, line: (item: T) => string): Array<string> {
  const lines = items.slice(0, LISTED_ITEMS).map(line);
  if (items.length > LISTED_ITEMS) lines.push(`  - and ${items.length - LISTED_ITEMS} more`);
  return lines;
}

function changeLines(
  change: PullRequestWatchChange,
  context: { readonly baseBranch: string; readonly commit: string },
): Array<string> {
  switch (change.kind) {
    case "checks-failed":
      return [
        `- Checks failed${context.commit}:`,
        ...listed(
          change.failed,
          (check) =>
            `  - ${check.name}${check.status === "failure" ? "" : ` (${check.status})`}${check.url ? ` ${check.url}` : ""}`,
        ),
      ];
    case "awaiting-approval":
      return [
        `- Waiting on a maintainer to approve${context.commit}, so these have not run:`,
        ...listed(change.checks, (check) => `  - ${check.name}${check.url ? ` ${check.url}` : ""}`),
      ];
    case "checks-passed":
      return [
        `- All ${change.count} ${change.required ? "required " : ""}${change.count === 1 ? "check" : "checks"} passed${context.commit}.`,
      ];
    case "remarks":
      return [
        `- ${change.remarks.length} new ${change.remarks.length === 1 ? "comment" : "comments"}:`,
        ...listed(change.remarks, (remark) => {
          const where = remark.path === null ? "" : ` on ${remark.path}`;
          const body = snippet(remark.body);
          const said = body.length === 0 ? (remark.reviewState ?? "reviewed") : `"${body}"`;
          return `  - ${remark.author?.login ?? "someone"}${where}: ${said}${remark.url ? ` ${remark.url}` : ""}`;
        }),
      ];
    case "no-checks":
      return [
        `- No checks have reported${context.commit} after ${change.minutes} minutes. None may be configured to run on this change.`,
      ];
    case "conflicting":
      return [`- The branch now conflicts with ${context.baseBranch}.`];
  }
}

const SUMMARY: Record<PullRequestWatchChange["kind"], string> = {
  "checks-failed": "checks failed",
  "awaiting-approval": "awaiting approval",
  "checks-passed": "checks passed",
  remarks: "new comments",
  "no-checks": "no checks reported",
  conflicting: "merge conflict",
};

export function pullRequestWatchMessage(input: {
  readonly number: number;
  readonly url: string;
  readonly baseBranch: string;
  readonly headSha: string | null;
  readonly report: PullRequestWatchReport;
}): { readonly text: string; readonly notification: OrchestrationV2Notification } {
  const { changes, exhausted } = input.report;
  const context = {
    baseBranch: input.baseBranch,
    commit: input.headSha === null ? "" : ` on ${input.headSha.slice(0, 7)}`,
  };
  const text = [
    `Update on pull request #${input.number} (${input.url}), which T3 Code is watching for you:`,
    ...changes.flatMap((change) => changeLines(change, context)),
    "",
    exhausted
      ? `T3 Code stopped watching after ${PULL_REQUEST_WATCH_WAKE_LIMIT} comment-only updates in a row. Call watch_pull_request to watch it again.`
      : "Look into each item and act on it as your task requires. This PR stays linked and watched, so do not link, watch, or list it again. End your turn when you are done, and T3 Code wakes you on the next change. When you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox.",
  ].join("\n");
  const failed = changes.some(
    (change) => change.kind === "checks-failed" || change.kind === "conflicting",
  );
  const summary = changes.map((change) => SUMMARY[change.kind]);
  if (exhausted) summary.push("stopped watching");
  return {
    text,
    notification: {
      source: { kind: "monitor" },
      outcome: failed
        ? "failed"
        : changes.every((change) => change.kind === "checks-passed")
          ? "completed"
          : "updated",
      summary: `#${input.number}: ${summary.join(", ")}`,
    },
  };
}
