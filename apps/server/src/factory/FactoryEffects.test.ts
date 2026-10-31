// @effect-diagnostics nodeBuiltinImport:off - a disposable bare remote built with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  FactoryId,
  FactoryItemKey,
  FactoryPoolId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as FactoryEffects from "./FactoryEffects.ts";
import * as FactoryIntegrator from "./FactoryIntegrator.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";
import * as FactoryStore from "./FactoryStore.ts";
import * as FactoryTracker from "./FactoryTracker.ts";

const factoryId = FactoryId.make("effects");
const repository = "example-org/effects";
const itemKey = FactoryItemKey.make(`github:${repository}#142`);
const projectId = ProjectId.make("project:effects");
const prBranch = "t3-factory/effects/142";
const acceptance = { context: "t3/acceptance", description: "accepted" };

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=Worker", "-c", "user.email=worker@example.invalid", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const commitFile = (cwd: string, file: string, text: string, message: string) => {
  NodeFS.writeFileSync(NodePath.join(cwd, file), text);
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
};

interface Pull {
  readonly number: number;
  readonly head: string;
  readonly base: string;
  state: "open" | "closed";
  draft: boolean;
  merged: { readonly head: string; readonly commit: string } | undefined;
}

/**
 * A bare remote and the GitHub in front of it. A pull request's head is whatever its branch holds
 * in the bare remote; its protection wants green checks, an approval and the acceptance status on
 * exactly that head, with no changes requested on it. Faults are armed per write.
 */
class Hub extends Context.Service<
  Hub,
  {
    readonly root: string;
    readonly origin: string;
    readonly cwd: string;
    readonly base: string;
    readonly pulls: Array<Pull>;
    readonly checksDone: Set<string>;
    readonly approved: Set<string>;
    readonly changesRequested: Array<{ readonly commit: string; readonly body: string }>;
    readonly statuses: Set<string>;
    readonly writes: Array<string>;
    readonly issues: Map<
      number,
      { readonly body: string; parent: number | null; readonly blockedBy: Array<number> }
    >;
    readonly relationWrites: Array<string>;
    readonly comments: Array<{
      readonly id: number;
      readonly issueNumber: number;
      readonly body: string;
      readonly authorId: string;
    }>;
    faults: {
      loseCreateAnswer?: boolean;
      /** A validation refusal of a create nothing was sent for before. */
      refuseCreate?: boolean;
      /** The process is lost after GitHub opened the pull request, or before the create left. */
      createThenDie?: boolean;
      dieBeforeCreate?: boolean;
      mergeThenLose?: "answer" | "process";
      publishThenLose?: boolean;
      issueCreateAmbiguous?: boolean;
      issueListingLags?: boolean;
      /** The next comment create lands but its answer is lost. */
      commentCreateAmbiguous?: boolean;
      /** GitHub stores a comment body's CRLF line endings as LF. */
      commentsStoredWithLf?: boolean;
    };
    markerSearch: Deferred.Deferred<void> | undefined;
    markerSearches: number;
    /** Listings of an existing pull request that still show nothing (an injected lag). */
    pullListLag: number;
    /** Concurrent attempts both list before either records its create. */
    pullSearch: Deferred.Deferred<void> | undefined;
    pullSearches: number;
    /**
     * A fixed schedule for two attempts on one operation: the first lists, the second lists and waits
     * until the first has cleared its refused create, and the first then waits to be released.
     */
    race:
      | {
          finds: number;
          notes: number;
          readonly firstListed: Deferred.Deferred<void>;
          readonly secondListed: Deferred.Deferred<void>;
          readonly cleared: Deferred.Deferred<void>;
          readonly release: Deferred.Deferred<void>;
        }
      | undefined;
  }
>()("t3/factory/FactoryEffects.test/Hub") {}

const tipOf = (hub: Hub["Service"], branch: string) => {
  try {
    return git(hub.origin, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
  } catch {
    return null;
  }
};

const factsOf = (hub: Hub["Service"], pull: Pull): FactoryTracker.TrackerPullRequest => {
  const headSha = pull.merged?.head ?? tipOf(hub, pull.head) ?? "0".repeat(40);
  const allowed =
    hub.checksDone.has(headSha) &&
    hub.approved.has(headSha) &&
    hub.statuses.has(`${headSha}:${acceptance.context}`) &&
    !hub.changesRequested.some((review) => review.commit === headSha);
  return {
    number: pull.number,
    state: pull.state,
    merged: pull.merged !== undefined,
    mergeCommit: pull.merged?.commit ?? null,
    headSha,
    draft: pull.draft,
    nodeId: `node-${pull.number}`,
    mergeableState: pull.merged !== undefined ? null : allowed ? "clean" : "blocked",
  };
};

const layerHub = Layer.effect(
  Hub,
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-factory-effects-"));
      const origin = NodePath.join(root, "origin.git");
      const cwd = NodePath.join(root, "project");
      git(root, "init", "--bare", "-b", "main", origin);
      // Every ref the remote accepts, so a test counts pushes rather than trusting answers.
      NodeFS.writeFileSync(
        NodePath.join(origin, "hooks", "post-receive"),
        "#!/bin/sh\ncat >> pushes.log\n",
      );
      git(root, "clone", origin, cwd);
      const base = commitFile(cwd, "a.txt", "one\n", "base");
      git(cwd, "push", "origin", "HEAD:main");
      git(cwd, "checkout", "-b", "work");
      return {
        root,
        origin,
        cwd,
        base,
        pulls: [],
        checksDone: new Set<string>(),
        approved: new Set<string>(),
        changesRequested: [],
        statuses: new Set<string>(),
        writes: [],
        issues: new Map(),
        relationWrites: [],
        comments: [],
        faults: {},
        markerSearch: undefined,
        markerSearches: 0,
        pullListLag: 0,
        pullSearch: undefined,
        pullSearches: 0,
        race: undefined,
      } satisfies Hub["Service"];
    }),
    ({ root }) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
  ),
);

const pushesTo = (hub: Hub["Service"], branch: string) => {
  const log = NodePath.join(hub.origin, "pushes.log");
  return NodeFS.existsSync(log)
    ? NodeFS.readFileSync(log, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.endsWith(` refs/heads/${branch}`)).length
    : 0;
};

/** Refuses pushes to `branch`, as a protection or a missing permission does; null lifts it. */
const protect = (hub: Hub["Service"], branch: string | null) => {
  const hook = NodePath.join(hub.origin, "hooks", "pre-receive");
  if (branch === null) return NodeFS.rmSync(hook, { force: true });
  NodeFS.writeFileSync(
    hook,
    `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/${branch}" ]; then\n    echo "protected branch ${branch}: this account may not push" >&2\n    exit 1\n  fi\ndone\n`,
  );
};

const layerTracker = Layer.effect(
  FactoryTracker.FactoryTracker,
  Effect.map(Hub, (hub) => {
    const pullFor = (number: number) => hub.pulls.find((pull) => pull.number === number)!;
    const session: Partial<FactoryTracker.TrackerSession> = {
      account: { accountId: "9001" },
      findPullRequest: ({ head, base }) =>
        Effect.gen(function* () {
          const race = hub.race;
          if (race !== undefined) {
            race.finds += 1;
            if (race.finds === 1) yield* Deferred.succeed(race.firstListed, undefined);
            if (race.finds === 2) {
              yield* Deferred.succeed(race.secondListed, undefined);
              yield* Deferred.await(race.cleared);
            }
          }
          hub.pullSearches += 1;
          if (hub.pullSearch !== undefined) {
            if (hub.pullSearches === 2) yield* Deferred.succeed(hub.pullSearch, undefined);
            yield* Deferred.await(hub.pullSearch);
          }
          const found = hub.pulls.findLast((pull) => pull.head === head && pull.base === base);
          if (found !== undefined && hub.pullListLag > 0) {
            hub.pullListLag -= 1;
            return Option.none();
          }
          return Option.fromNullishOr(found).pipe(Option.map((pull) => factsOf(hub, pull)));
        }),
      readPullRequest: ({ number }) => Effect.sync(() => factsOf(hub, pullFor(number))),
      createPullRequest: ({ head, base }) =>
        Effect.suspend(() => {
          if (hub.faults.dieBeforeCreate === true) {
            hub.faults.dieBeforeCreate = false;
            return Effect.die("the process was lost before the create was sent");
          }
          hub.writes.push("create pull request");
          const open = hub.pulls.some((pull) => pull.head === head && pull.state === "open");
          // GitHub's 422 is a general validation refusal: it names no cause (github-api-proof-boundaries.json).
          if (tipOf(hub, head) === null || open || hub.faults.refuseCreate === true) {
            hub.faults.refuseCreate = false;
            return Effect.succeed<FactoryTracker.CreatePullRequestOutcome>({
              type: "rejected",
              transient: false,
              cause: '{"status":422}',
            });
          }
          const number = 143 + hub.pulls.length;
          hub.pulls.push({ number, head, base, state: "open", draft: false, merged: undefined });
          if (hub.faults.createThenDie === true) {
            hub.faults.createThenDie = false;
            return Effect.die("the process was lost after the create was sent");
          }
          if (hub.faults.loseCreateAnswer === true) {
            hub.faults.loseCreateAnswer = false;
            return Effect.succeed<FactoryTracker.CreatePullRequestOutcome>({
              type: "ambiguous",
              cause: "GitHubApiRequestError",
            });
          }
          return Effect.succeed<FactoryTracker.CreatePullRequestOutcome>({
            type: "written",
            number,
          });
        }),
      markReadyForReview: ({ nodeId }) =>
        Effect.sync(() => {
          hub.writes.push("mark ready");
          const pull = hub.pulls.find((candidate) => `node-${candidate.number}` === nodeId);
          if (pull !== undefined) pull.draft = false;
        }),
      ensureSuccessStatus: ({ sha, context }) =>
        Effect.sync(() => {
          if (!hub.statuses.has(`${sha}:${context}`)) hub.writes.push(`status ${sha}`);
          hub.statuses.add(`${sha}:${context}`);
          return true;
        }),
      readChecks: ({ sha }) =>
        Effect.succeed(
          hub.checksDone.has(sha)
            ? { pending: [], failed: [] }
            : { pending: ["ci / test"], failed: [] },
        ),
      readReviewFindings: ({ number }) =>
        Effect.sync(() =>
          Option.some({
            headSha: factsOf(hub, pullFor(number)).headSha,
            changesRequested: hub.changesRequested.map((review, index) => ({
              id: `review-${index}`,
              author: "example-reviewer",
              commit: review.commit,
              body: review.body,
              url: `https://example.invalid/review-${index}`,
            })),
            unresolvedThreads: [],
          }),
        ),
      mergePullRequest: ({ number, sha, message }) =>
        Effect.suspend(() => {
          hub.writes.push(`merge ${sha}`);
          const pull = pullFor(number);
          const facts = factsOf(hub, pull);
          if (facts.headSha !== sha) {
            return Effect.succeed<FactoryTracker.MergeOutcome>({ type: "refused", status: 409 });
          }
          if (facts.mergeableState !== "clean") {
            return Effect.succeed<FactoryTracker.MergeOutcome>({ type: "refused", status: 405 });
          }
          const baseTip = tipOf(hub, pull.base)!;
          const tree = git(hub.origin, "merge-tree", "--write-tree", baseTip, sha).split(
            /\r?\n/,
          )[0]!;
          const commit = git(
            hub.origin,
            "commit-tree",
            tree,
            "-p",
            baseTip,
            "-p",
            sha,
            "-m",
            message,
          );
          git(hub.origin, "update-ref", `refs/heads/${pull.base}`, commit, baseTip);
          pull.state = "closed";
          pull.merged = { head: sha, commit };
          const lost = hub.faults.mergeThenLose;
          delete hub.faults.mergeThenLose;
          if (lost === "process")
            return Effect.die("the process was lost after the merge was sent");
          return Effect.succeed<FactoryTracker.MergeOutcome>(
            lost === "answer"
              ? { type: "ambiguous", cause: "GitHubApiRequestError" }
              : { type: "merged" },
          );
        }),
      readCommit: ({ sha }) =>
        Effect.sync(() => ({
          parents: git(hub.origin, "rev-list", "--parents", "-n", "1", sha).split(" ").slice(1),
          tree: git(hub.origin, "rev-parse", `${sha}^{tree}`),
          message: git(hub.origin, "log", "-1", "--format=%B", sha),
        })),
      // Issues: what a correction ticket's create, search and relations write and read.
      createIssue: ({ body }) =>
        Effect.sync((): FactoryTracker.CreateIssueOutcome => {
          hub.writes.push("create issue");
          const number = 200 + hub.issues.size;
          hub.issues.set(number, { body, parent: null, blockedBy: [] });
          return hub.faults.issueCreateAmbiguous === true
            ? { type: "ambiguous", cause: "GitHubApiRequestError" }
            : { type: "written", issue: { number, id: number * 10, body, authorId: "9001" } };
        }),
      findIssueByMarker: ({ marker }) =>
        Effect.gen(function* () {
          // Concurrent attempts both search before either records its create.
          hub.markerSearches += 1;
          if (hub.markerSearch !== undefined) {
            if (hub.markerSearches === 2) yield* Deferred.succeed(hub.markerSearch, undefined);
            yield* Deferred.await(hub.markerSearch);
          }
          if (hub.faults.issueListingLags === true) return Option.none();
          for (const [number, issue] of hub.issues) {
            if (issue.body.includes(marker)) {
              return Option.some({ number, id: number * 10, body: issue.body, authorId: "9001" });
            }
          }
          return Option.none();
        }),
      readIssue: ({ issueNumber }) =>
        Effect.sync(() => {
          const issue = hub.issues.get(issueNumber);
          const parent = issue?.parent ?? null;
          return {
            title: `#${issueNumber}`,
            body: issue?.body ?? "",
            state: "open" as const,
            labels: [],
            comments: hub.comments.filter((comment) => comment.issueNumber === issueNumber),
            author: { id: "9001", login: "t3-factory" },
            parent: parent === null ? null : { repository, number: parent },
            blockedBy: (issue?.blockedBy ?? []).map((number) => ({
              repository,
              number,
              state: "open" as const,
            })),
          };
        }),
      addSubIssue: ({ parentIssueNumber, issueId }) =>
        Effect.sync((): FactoryTracker.RelationOutcome => {
          const issue = hub.issues.get(issueId / 10)!;
          hub.relationWrites.push(`parent ${parentIssueNumber}`);
          if (issue.parent !== null) return { type: "refused", detail: "duplicate" };
          issue.parent = parentIssueNumber;
          return { type: "written" };
        }),
      addBlockedBy: ({ issueNumber, issueId }) =>
        Effect.sync((): FactoryTracker.RelationOutcome => {
          hub.relationWrites.push(`blocks ${issueNumber}`);
          const blocked = hub.issues.get(issueNumber) ?? { body: "", parent: null, blockedBy: [] };
          hub.issues.set(issueNumber, blocked);
          if (blocked.blockedBy.includes(issueId / 10))
            return { type: "refused", detail: "duplicate" };
          blocked.blockedBy.push(issueId / 10);
          return { type: "written" };
        }),
      // Comments: what a record's find-before-write reads and its create writes.
      createComment: ({ issueNumber, body }) =>
        Effect.sync((): FactoryTracker.CreateCommentOutcome => {
          hub.writes.push("create comment");
          const id = 300 + hub.comments.length;
          const stored =
            hub.faults.commentsStoredWithLf === true ? body.replaceAll("\r\n", "\n") : body;
          hub.comments.push({ id, issueNumber, body: stored, authorId: "9001" });
          if (hub.faults.commentCreateAmbiguous === true) {
            hub.faults.commentCreateAmbiguous = false;
            return { type: "ambiguous", cause: "GitHubApiRequestError" };
          }
          return { type: "written", commentId: id };
        }),
      readComment: ({ commentId }) =>
        Effect.sync(() =>
          Option.fromNullishOr(hub.comments.find((comment) => comment.id === commentId)),
        ),
    };
    return FactoryTracker.FactoryTracker.of({
      withSession: (_input, use) => use(session as FactoryTracker.TrackerSession),
    });
  }),
);

/** The real Git integrator; `publishThenLose` loses the process right after a push lands. */
const layerIntegrator = Layer.effect(
  FactoryIntegrator.FactoryIntegrator,
  Effect.gen(function* () {
    const real = yield* FactoryIntegrator.FactoryIntegrator;
    const hub = yield* Hub;
    return FactoryIntegrator.FactoryIntegrator.of({
      ...real,
      publish: (input) =>
        Effect.flatMap(real.publish(input), (published) => {
          if (hub.faults.publishThenLose !== true) return Effect.succeed(published);
          hub.faults.publishThenLose = false;
          return Effect.die("the process was lost after the push was sent");
        }),
    });
  }),
).pipe(
  Layer.provide(
    FactoryIntegrator.layer.pipe(
      Layer.provide(
        GitVcsDriver.layer.pipe(
          Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-factory-effects-" })),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  ),
);

const layerProjects = Layer.effect(
  ProjectService.ProjectService,
  Effect.map(
    Hub,
    (hub) =>
      ({
        getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: hub.cwd }),
      }) as unknown as ProjectService.ProjectService["Service"],
  ),
);

/** The real store, holding the first attempt's create record and refusal at the race's fixed points. */
const layerOperations = Layer.effect(
  FactoryOperationStore.FactoryOperationStore,
  Effect.gen(function* () {
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    const hub = yield* Hub;
    return FactoryOperationStore.FactoryOperationStore.of({
      ...operations,
      notePullRequestCreate: (operationId) =>
        Effect.gen(function* () {
          const race = hub.race;
          if (race !== undefined && race.notes++ === 0) yield* Deferred.await(race.secondListed);
          return yield* operations.notePullRequestCreate(operationId);
        }),
      clearPullRequestCreate: (input) =>
        Effect.gen(function* () {
          const cleared = yield* operations.clearPullRequestCreate(input);
          const race = hub.race;
          if (race !== undefined) {
            yield* Deferred.succeed(race.cleared, undefined);
            yield* Deferred.await(race.release);
          }
          return cleared;
        }),
    });
  }),
).pipe(Layer.provide(FactoryOperationStore.layer));

const layerTest = FactoryEffects.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerOperations,
      FactoryStore.layer,
      EffectOutbox.layer,
      FactoryEffects.layerWakes,
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(layerIntegrator, layerTracker, layerProjects)),
  Layer.provideMerge(layerHub),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

const configure = Effect.flatMap(FactoryStore.FactoryStore, (store) =>
  store.configure({
    factoryId,
    projectId,
    policyRevision: "policy-r1",
    enabled: true,
    pools: [{ poolId: FactoryPoolId.make("builders"), capacityUnits: 1 }],
    execution: {
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    packet: { briefSchemaVersion: "brief-v1", helper: null },
    artifactRoot: process.cwd(),
    claim: {
      host: "github.com",
      accountId: "9001",
      foreignClaimLabels: [],
      foreignClaimCommentPatterns: [],
      observedClaimPool: { poolId: FactoryPoolId.make("builders"), units: 1 },
    },
    integration: {
      mode: "pull_request",
      repository,
      remote: "origin",
      branch: "main",
      method: "merge",
    },
  }),
);

/** As planIntegration records it: one operation per accepted review of one exact head. */
const intendMerge = (review: string, reviewedHead: string) =>
  Effect.flatMap(FactoryOperationStore.FactoryOperationStore, (operations) =>
    operations.intend({
      operationId: `integrate:${review}`,
      factoryId,
      itemKey,
      intent: {
        kind: "pull_request_merge",
        projectId,
        repository,
        remote: "origin",
        base: "main",
        head: prBranch,
        reviewedHead,
        method: "merge",
        marker: `T3-Factory-Operation: integrate:${review}`,
        title: "Successor",
        body: "Refs #142",
        acceptanceStatus: acceptance,
      },
    }),
  );

const apply = (operationId: string) =>
  Effect.flatMap(FactoryEffects.FactoryEffects, (effects) => effects.apply(operationId));

const recordOf = (operationId: string) =>
  Effect.map(
    Effect.flatMap(FactoryOperationStore.FactoryOperationStore, (operations) =>
      operations.get(operationId),
    ),
    Option.getOrThrow,
  );

/** What the factory's state shows for an integrating item: FactoryLifecycle's own excerpt. */
const shownDetail = (operation: FactoryOperationStore.FactoryOperation) =>
  operation.state === "intended" && operation.lastError !== undefined
    ? `waiting: ${operation.lastError.slice(0, 500)}`
    : undefined;

it.live(
  "Publication/97.A1-A4: an accepted successor replaces its old head on the one pull request and lands once",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const old = commitFile(hub.cwd, "b.txt", "first\n", "first attempt");
      // The old head is published and opened, then waits on its checks.
      yield* intendMerge("old", old);
      yield* apply("integrate:old");
      const waitingOld = yield* recordOf("integrate:old");
      assert.strictEqual(waitingOld.state, "intended");
      assert.strictEqual(waitingOld.wait?.kind, "dependency");
      assert.strictEqual(waitingOld.wait?.actor, "the required checks");
      // Its checks pass and one reviewer approves it, but another requests changes on it.
      hub.checksDone.add(old);
      hub.approved.add(old);
      hub.changesRequested.push({ commit: old, body: "Compare complete fixture values." });
      yield* apply("integrate:old");
      const rejected = yield* recordOf("integrate:old");
      assert.strictEqual(rejected.state, "failed");
      assert.include(
        rejected.state === "failed" ? rejected.reason : "",
        `review_changes_requested: pull request #143 at ${old}`,
      );

      // The accepted successor goes onto the same branch and pull request.
      const successor = commitFile(hub.cwd, "b.txt", "corrected\n", "correct the findings");
      yield* intendMerge("successor", successor);
      yield* apply("integrate:successor");
      assert.strictEqual(tipOf(hub, prBranch), successor);
      assert.strictEqual(hub.pulls.length, 1);
      // The old head's green checks and approval are no acceptance of the successor.
      const awaitingChecks = yield* recordOf("integrate:successor");
      assert.strictEqual(awaitingChecks.wait?.actor, "the required checks");
      assert.include(awaitingChecks.lastError ?? "", successor);
      hub.checksDone.add(successor);
      yield* apply("integrate:successor");
      const awaitingReview = yield* recordOf("integrate:successor");
      assert.strictEqual(awaitingReview.state, "intended");
      assert.deepStrictEqual(
        [awaitingReview.wait?.kind, awaitingReview.wait?.actor],
        ["dependency", "the repository's required reviewers"],
      );
      const detail = shownDetail(awaitingReview) ?? "";
      for (const part of ["who acts: ", "action: approve pull request #143 at", "resumes when: "]) {
        assert.include(detail, part);
      }
      // The same facts read again are the same wait: the record is not rewritten.
      yield* apply("integrate:successor");
      assert.deepStrictEqual(yield* recordOf("integrate:successor"), awaitingReview);
      assert.isFalse(hub.writes.some((write) => write.startsWith("merge")));

      // Approved on exactly the successor; the merge applies but the process is lost with it.
      hub.approved.add(successor);
      hub.faults.mergeThenLose = "process";
      yield* apply("integrate:successor");
      assert.strictEqual((yield* recordOf("integrate:successor")).state, "intended");
      // After a restart, the readback finds the merge: nothing is sent again.
      const restarted = yield* Effect.scoped(
        Effect.map(Layer.build(Layer.fresh(FactoryEffects.layer)), (context) =>
          Context.get(context, FactoryEffects.FactoryEffects),
        ),
      );
      yield* restarted.apply("integrate:successor");
      yield* restarted.apply("integrate:successor");
      const landed = yield* recordOf("integrate:successor");
      const main = tipOf(hub, "main")!;
      assert.deepStrictEqual(landed.state === "applied" ? landed.receipt : landed, {
        kind: "pull_request_merge",
        repository,
        number: 143,
        branch: "main",
        commit: main,
        parents: [hub.base, successor],
        tree: git(hub.origin, "rev-parse", `${main}^{tree}`),
        attribution: "operation",
      });
      assert.isUndefined(landed.lastError);
      assert.isUndefined(landed.wait);
      assert.deepStrictEqual(
        hub.writes.filter((write) => write.startsWith("merge") || write.startsWith("create")),
        [`create pull request`, `merge ${successor}`],
      );
      assert.strictEqual(pushesTo(hub, prBranch), 2);
      // Lineage: the rejected head and the accepted successor both stay recorded.
      const lineage = yield* Effect.flatMap(
        FactoryOperationStore.FactoryOperationStore,
        (operations) => operations.forItem({ factoryId, itemKey }),
      );
      assert.deepStrictEqual(
        lineage.map((operation) => [operation.operationId, operation.state]),
        [
          ["integrate:old", "failed"],
          ["integrate:successor", "applied"],
        ],
      );
    }).pipe(Effect.provide(layerTest)),
);

it.live(
  "Publication/97.A1: a branch someone else moved is never overwritten, whatever it now holds",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const old = commitFile(hub.cwd, "b.txt", "first\n", "first attempt");
      git(hub.cwd, "push", "origin", `${old}:refs/heads/${prBranch}`);
      const successor = commitFile(hub.cwd, "b.txt", "corrected\n", "correct the findings");
      // Someone else pushes their own commit onto the pull request's branch.
      git(hub.cwd, "checkout", "-b", "intruder", old);
      const foreign = commitFile(hub.cwd, "c.txt", "foreign\n", "someone else's change");
      git(hub.cwd, "push", "origin", `${foreign}:refs/heads/${prBranch}`);
      yield* intendMerge("successor", successor);
      yield* apply("integrate:successor");
      const refused = yield* recordOf("integrate:successor");
      assert.strictEqual(refused.state, "failed");
      assert.include(
        refused.state === "failed" ? refused.reason : "",
        `not_fast_forward: ${prBranch} holds ${foreign}`,
      );
      assert.strictEqual(tipOf(hub, prBranch), foreign);
      assert.deepStrictEqual(hub.pulls, []);
    }).pipe(Effect.provide(layerTest)),
);

it.live(
  "Publication/97.A3: a push and a pull request whose answers were lost are read back, never repeated",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
      yield* intendMerge("lost", head);
      hub.faults.publishThenLose = true;
      yield* apply("integrate:lost");
      assert.strictEqual(tipOf(hub, prBranch), head);
      assert.deepStrictEqual(hub.pulls, []);
      hub.faults.loseCreateAnswer = true;
      yield* apply("integrate:lost");
      yield* apply("integrate:lost");
      assert.strictEqual(pushesTo(hub, prBranch), 1);
      assert.strictEqual(hub.pulls.length, 1);
      assert.strictEqual(hub.writes.filter((write) => write === "create pull request").length, 1);
      // The lost merge answer, too, is read back as the landing.
      hub.checksDone.add(head);
      hub.approved.add(head);
      hub.faults.mergeThenLose = "answer";
      yield* apply("integrate:lost");
      const landed = yield* recordOf("integrate:lost");
      assert.strictEqual(landed.state, "applied");
      assert.strictEqual(hub.writes.filter((write) => write.startsWith("merge")).length, 1);
    }).pipe(Effect.provide(layerTest)),
);

it.live(
  "Publication/97.A5: a missing base or a refused push holds one precise wait until it is fixed",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
      git(hub.origin, "update-ref", "-d", "refs/heads/main");
      yield* intendMerge("blocked", head);
      yield* apply("integrate:blocked");
      const missing = yield* recordOf("integrate:blocked");
      assert.deepStrictEqual(
        [missing.wait?.kind, missing.wait?.actor, missing.wait?.resume],
        ["dependency", `the owner of ${repository}`, "main exists on origin"],
      );
      assert.strictEqual(tipOf(hub, prBranch), null);

      // The base comes back, but this account may not push the pull request's branch.
      git(hub.origin, "update-ref", "refs/heads/main", hub.base);
      protect(hub, prBranch);
      yield* apply("integrate:blocked");
      const refused = yield* recordOf("integrate:blocked");
      assert.strictEqual(refused.state, "intended");
      assert.deepStrictEqual(
        [refused.wait?.kind, refused.wait?.actor],
        ["dependency", `whoever controls push access to ${prBranch} on origin`],
      );
      const detail = shownDetail(refused) ?? "";
      assert.include(detail, "this account may not push");
      assert.include(detail, "action: let this account create or fast-forward");
      assert.include(detail, "resumes when: origin accepts the push");
      assert.deepStrictEqual(hub.pulls, []);
      // Unchanged, it is the same wait from the same moment, and opens nothing.
      yield* apply("integrate:blocked");
      assert.deepStrictEqual(yield* recordOf("integrate:blocked"), refused);
      assert.deepStrictEqual(hub.pulls, []);
      // Lifted: the next attempt publishes and opens the one pull request.
      protect(hub, null);
      yield* apply("integrate:blocked");
      assert.strictEqual(tipOf(hub, prBranch), head);
      assert.strictEqual(hub.pulls.length, 1);
      assert.strictEqual((yield* recordOf("integrate:blocked")).wait?.actor, "the required checks");
    }).pipe(Effect.provide(layerTest)),
);

it.live(
  "Defect/98.A1: concurrent attempts and a restart after an ambiguous create open one ticket with one of each relation",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const operations = yield* FactoryOperationStore.FactoryOperationStore;
      const marker = "<!-- t3-factory-ticket:ticket:defect -->";
      yield* operations.intend({
        operationId: "ticket:defect",
        factoryId,
        itemKey,
        intent: {
          kind: "tracker_create_issue",
          repository,
          issueNumber: 142,
          marker,
          title: "Correct the importer",
          body: `The proof failed on a product defect.\n\n${marker}\n`,
          labels: [],
          parentIssueNumber: 2,
          blocks: [142],
          since: "2026-10-29T00:00:00.000Z",
          stage: "implement",
        },
      });
      hub.faults.issueCreateAmbiguous = true;
      hub.faults.issueListingLags = true;
      hub.markerSearch = yield* Deferred.make<void>();
      yield* Effect.all([apply("ticket:defect"), apply("ticket:defect")], { concurrency: 2 });
      hub.markerSearch = undefined;
      assert.strictEqual(hub.writes.filter((write) => write === "create issue").length, 1);
      // Restarted while GitHub still lists nothing: it is held, never sent again.
      yield* apply("ticket:defect");
      yield* apply("ticket:defect");
      assert.strictEqual(hub.writes.filter((write) => write === "create issue").length, 1);
      const held = yield* recordOf("ticket:defect");
      assert.strictEqual(held.state, "intended");
      assert.strictEqual(held.wait?.kind, "uncertain");
      assert.include(held.lastError ?? "", "unconfirmed_create");
      assert.include(held.lastError ?? "", `search ${repository} for ${marker}`);
      // Listed at last: the ticket is the issue that was created, and its relations are written once.
      hub.faults.issueListingLags = false;
      yield* Effect.all([apply("ticket:defect"), apply("ticket:defect")], { concurrency: 2 });
      yield* apply("ticket:defect");
      const opened = yield* recordOf("ticket:defect");
      assert.deepStrictEqual(opened.state === "applied" ? opened.receipt : opened, {
        kind: "tracker_create_issue",
        repository,
        number: 200,
        bodyDigest:
          opened.state === "applied" && opened.receipt.kind === "tracker_create_issue"
            ? opened.receipt.bodyDigest
            : "",
        parentLinked: true,
        blocking: [142],
      });
      assert.strictEqual(hub.writes.filter((write) => write === "create issue").length, 1);
      assert.deepStrictEqual(hub.issues.get(200)?.parent, 2);
      assert.deepStrictEqual(hub.issues.get(142)?.blockedBy, [200]);
    }).pipe(Effect.provide(layerTest)),
);

const createsSent = (hub: Hub["Service"]) =>
  hub.writes.filter((write) => write === "create pull request").length;

/** A fresh FactoryEffects over the same store and remote, as after a restart. */
const restartedEffects = Effect.scoped(
  Effect.map(Layer.build(Layer.fresh(FactoryEffects.layer)), (context) =>
    Context.get(context, FactoryEffects.FactoryEffects),
  ),
);

it.live(
  "Publication/97.A3: a lost create, a lagging listing and a later 422 leave one unresolved create, then land",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
      yield* intendMerge("lagging", head);
      hub.faults.loseCreateAnswer = true;
      hub.pullListLag = 3;
      for (let attempt = 0; attempt < 3; attempt++) yield* apply("integrate:lagging");
      const unresolved = yield* recordOf("integrate:lagging");
      // A 422 or an empty listing says nothing about the earlier create: it may have applied.
      assert.strictEqual(unresolved.state, "intended");
      assert.strictEqual(createsSent(hub), 1);
      assert.strictEqual(hub.pulls.length, 1);
      assert.strictEqual(unresolved.wait?.kind, "uncertain");
      for (const part of ["who acts:", "action:", "resumes when:"]) {
        assert.include(unresolved.lastError ?? "", part);
      }
      // GitHub lists it at last: the operation continues on that one pull request and lands it.
      yield* apply("integrate:lagging");
      hub.checksDone.add(head);
      hub.approved.add(head);
      yield* apply("integrate:lagging");
      const landed = yield* recordOf("integrate:lagging");
      const main = tipOf(hub, "main")!;
      assert.deepStrictEqual(landed.state === "applied" ? landed.receipt : landed, {
        kind: "pull_request_merge",
        repository,
        number: 143,
        branch: "main",
        commit: main,
        parents: [hub.base, head],
        tree: git(hub.origin, "rev-parse", `${main}^{tree}`),
        attribution: "operation",
      });
      assert.strictEqual(createsSent(hub), 1);
    }).pipe(Effect.provide(layerTest)),
);

it.live("Publication/97.A3: a fresh create GitHub refuses still fails as not created", () =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    yield* configure;
    const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
    yield* intendMerge("refused", head);
    hub.faults.refuseCreate = true;
    yield* apply("integrate:refused");
    const refused = yield* recordOf("integrate:refused");
    assert.strictEqual(refused.state, "failed");
    assert.include(
      refused.state === "failed" ? refused.reason : "",
      "refused: the pull request was not created",
    );
    assert.strictEqual(createsSent(hub), 1);
  }).pipe(Effect.provide(layerTest)),
);

it.live(
  "Publication/97.A3: a create lost with the process, before or after it left, is never sent again unresolved",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      // Lost after GitHub opened it, with the listing lagging: a restart reads back and finds it.
      const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
      yield* intendMerge("after", head);
      hub.faults.createThenDie = true;
      hub.pullListLag = 2;
      yield* apply("integrate:after");
      const restarted = yield* restartedEffects;
      yield* restarted.apply("integrate:after");
      yield* restarted.apply("integrate:after");
      yield* restarted.apply("integrate:after");
      assert.strictEqual(createsSent(hub), 1);
      assert.strictEqual(hub.pulls.length, 1);
      assert.strictEqual((yield* recordOf("integrate:after")).wait?.actor, "the required checks");
      // Lost before it left: nothing exists, and nothing more is sent; the wait says who can act.
      git(hub.cwd, "checkout", "-q", "-b", "second", hub.base);
      const second = commitFile(hub.cwd, "c.txt", "second\n", "second");
      yield* Effect.flatMap(FactoryOperationStore.FactoryOperationStore, (operations) =>
        operations.intend({
          operationId: "integrate:before",
          factoryId,
          itemKey: FactoryItemKey.make(`github:${repository}#150`),
          intent: {
            kind: "pull_request_merge",
            projectId,
            repository,
            remote: "origin",
            base: "main",
            head: "t3-factory/effects/150",
            reviewedHead: second,
            method: "merge",
            marker: "T3-Factory-Operation: integrate:before",
            title: "Second",
            body: "Refs #150",
            acceptanceStatus: acceptance,
          },
        }),
      );
      hub.faults.dieBeforeCreate = true;
      yield* apply("integrate:before");
      yield* restarted.apply("integrate:before");
      yield* restarted.apply("integrate:before");
      const held = yield* recordOf("integrate:before");
      assert.strictEqual(held.state, "intended");
      assert.strictEqual(createsSent(hub), 1);
      assert.isFalse(hub.pulls.some((pull) => pull.head === "t3-factory/effects/150"));
      assert.include(held.lastError ?? "", "t3-factory/effects/150");
      // Its owner opens the pull request; the operation continues on it.
      hub.pulls.push({
        number: 150,
        head: "t3-factory/effects/150",
        base: "main",
        state: "open",
        draft: false,
        merged: undefined,
      });
      yield* restarted.apply("integrate:before");
      assert.strictEqual((yield* recordOf("integrate:before")).wait?.actor, "the required checks");
      assert.strictEqual(createsSent(hub), 1);
    }).pipe(Effect.provide(layerTest)),
);

it.live("Publication/97.A3: concurrent attempts send one create", () =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    yield* configure;
    const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
    yield* intendMerge("concurrent", head);
    hub.faults.loseCreateAnswer = true;
    hub.pullListLag = 4;
    hub.pullSearch = yield* Deferred.make<void>();
    yield* Effect.all([apply("integrate:concurrent"), apply("integrate:concurrent")], {
      concurrency: 2,
    });
    hub.pullSearch = undefined;
    yield* apply("integrate:concurrent");
    yield* apply("integrate:concurrent");
    assert.strictEqual(createsSent(hub), 1);
    assert.strictEqual(hub.pulls.length, 1);
    assert.strictEqual((yield* recordOf("integrate:concurrent")).state, "intended");
  }).pipe(Effect.provide(layerTest)),
);

it.live(
  "Publication/97.A3: an earlier attempt's refusal never ends a newer create whose fate is unknown",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const head = commitFile(hub.cwd, "b.txt", "work\n", "work");
      yield* intendMerge("race", head);
      hub.race = {
        finds: 0,
        notes: 0,
        firstListed: yield* Deferred.make<void>(),
        secondListed: yield* Deferred.make<void>(),
        cleared: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      // The first create is refused; the second opens the pull request, its answer is lost and the
      // listing lags it.
      hub.faults.refuseCreate = true;
      hub.faults.loseCreateAnswer = true;
      hub.pullListLag = 2;
      const first = yield* Effect.forkChild(apply("integrate:race"));
      yield* Deferred.await(hub.race.firstListed);
      // Both attempts read the operation before either recorded a create.
      const second = yield* Effect.forkChild(apply("integrate:race"));
      yield* Fiber.join(second);
      yield* Deferred.succeed(hub.race.release, undefined);
      yield* Fiber.join(first);
      hub.race = undefined;
      const raced = yield* recordOf("integrate:race");
      assert.strictEqual(raced.state, "intended");
      assert.strictEqual(raced.pullRequestCreate?.attempt, 2);
      assert.isUndefined(raced.pullRequestCreate?.cleared);
      assert.strictEqual(createsSent(hub), 2);
      assert.strictEqual(hub.pulls.length, 1);
      // Replayed after a restart, the unresolved create is read back, never sent again, and lands once.
      const restarted = yield* restartedEffects;
      yield* restarted.apply("integrate:race");
      yield* restarted.apply("integrate:race");
      hub.checksDone.add(head);
      hub.approved.add(head);
      yield* restarted.apply("integrate:race");
      const landed = yield* recordOf("integrate:race");
      const main = tipOf(hub, "main")!;
      assert.deepStrictEqual(landed.state === "applied" ? landed.receipt : landed, {
        kind: "pull_request_merge",
        repository,
        number: 143,
        branch: "main",
        commit: main,
        parents: [hub.base, head],
        tree: git(hub.origin, "rev-parse", `${main}^{tree}`),
        attribution: "operation",
      });
      assert.strictEqual(createsSent(hub), 2);
      assert.strictEqual(hub.pulls.length, 1);
    }).pipe(Effect.provide(layerTest)),
);

const intendReport = (outcomeId: string, body: string) =>
  Effect.flatMap(FactoryOperationStore.FactoryOperationStore, (operations) =>
    operations.intend({
      operationId: `report:${outcomeId}`,
      factoryId,
      itemKey,
      intent: {
        kind: "tracker_comment",
        repository,
        issueNumber: 142,
        purpose: "report",
        ref: outcomeId,
        marker: `<!-- t3-factory-report:${outcomeId} -->`,
        body,
      },
    }),
  );

it.live(
  "a comment of the factory's account is adopted as a record only when it says exactly what the record says",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      yield* configure;
      const marker = "<!-- t3-factory-report:outcome-1 -->";
      const body = `${marker}\n\nFactory implement outcome: implemented.\n\nreport sha256: aaaa`;
      // Another record quoting this marker, or a worker posting it first, says something else.
      hub.comments.push({
        id: 1,
        issueNumber: 142,
        body: `${marker}\n\nFactory implement outcome: implemented.\n\nAll checks passed.`,
        authorId: "9001",
      });
      yield* intendReport("outcome-1", body);
      yield* apply("report:outcome-1");
      const written = yield* recordOf("report:outcome-1");
      assert.strictEqual(written.state, "applied");
      const receipt = written.state === "applied" ? written.receipt : undefined;
      assert.ok(receipt !== undefined && "commentId" in receipt);
      assert.notStrictEqual(receipt.commentId, 1);
      assert.strictEqual(
        hub.comments.find((comment) => comment.id === receipt.commentId)?.body,
        body,
      );
      assert.deepStrictEqual(hub.writes, ["create comment"]);

      // A record that landed before its answer was lost is found again by its exact text.
      const again = `${marker.replace("outcome-1", "outcome-2")}\n\nFactory review outcome: approved.`;
      hub.comments.push({ id: 2, issueNumber: 142, body: again, authorId: "9001" });
      yield* intendReport("outcome-2", again);
      yield* apply("report:outcome-2");
      const adopted = yield* recordOf("report:outcome-2");
      assert.deepStrictEqual(adopted.state === "applied" ? adopted.receipt : adopted, {
        kind: "tracker_comment",
        commentId: 2,
        bodyDigest: NodeCrypto.createHash("sha256").update(again).digest("hex"),
      });
      assert.deepStrictEqual(hub.writes, ["create comment"]);

      // GitHub kept a lost create's CRLF body with LF line endings: found again, not written twice.
      const crlf = `${marker.replace("outcome-1", "outcome-3")}\r\n\r\nFactory implement outcome: failed.`;
      hub.faults.commentsStoredWithLf = true;
      hub.faults.commentCreateAmbiguous = true;
      yield* intendReport("outcome-3", crlf);
      yield* apply("report:outcome-3");
      assert.strictEqual((yield* recordOf("report:outcome-3")).state, "intended");
      yield* apply("report:outcome-3");
      const stored = hub.comments.at(-1)!;
      assert.deepStrictEqual(hub.writes, ["create comment", "create comment"]);
      const found = yield* recordOf("report:outcome-3");
      assert.deepStrictEqual(found.state === "applied" ? found.receipt : found, {
        kind: "tracker_comment",
        commentId: stored.id,
        bodyDigest: NodeCrypto.createHash("sha256").update(stored.body).digest("hex"),
      });
      // Line endings are the only difference allowed: a trailing space makes another text.
      hub.faults.commentsStoredWithLf = false;
      const spaced = `${marker.replace("outcome-1", "outcome-4")}\n\nFactory review outcome: approved.`;
      hub.comments.push({ id: 4, issueNumber: 142, body: `${spaced} `, authorId: "9001" });
      yield* intendReport("outcome-4", spaced);
      yield* apply("report:outcome-4");
      const reposted = yield* recordOf("report:outcome-4");
      const repostedId =
        reposted.state === "applied" && "commentId" in reposted.receipt
          ? reposted.receipt.commentId
          : undefined;
      assert.notStrictEqual(repostedId, 4);
      assert.strictEqual(hub.comments.find((comment) => comment.id === repostedId)?.body, spaced);
    }).pipe(Effect.provide(layerTest)),
);
