import { assert, it } from "@effect/vitest";
import { SourceControlProviderKind } from "@t3tools/contracts";
import {
  GitHubCredentials,
  GitHubPullRequestApi,
  GitHubRequestPolicy,
  GitHubRest,
} from "@t3tools/source-control-github/server/api";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as FactoryTracker from "./FactoryTracker.ts";

const host = "github.com";
const operation = "factory.createComment";

it("a create is provably not applied only on the documented rejections", () => {
  const classify = (error: GitHubRequestPolicy.GitHubApiError) =>
    FactoryTracker.classifyCreateFailure(error).type === "rejected"
      ? FactoryTracker.classifyCreateFailure(error).type +
        ((FactoryTracker.classifyCreateFailure(error) as { transient: boolean }).transient
          ? ":transient"
          : ":permanent")
      : FactoryTracker.classifyCreateFailure(error).type;
  const response = (status: number) =>
    new GitHubRequestPolicy.GitHubApiResponseError({ host, operation, status });
  assert.deepStrictEqual(
    [
      new GitHubRequestPolicy.GitHubApiNotFoundError({ host, operation }),
      new GitHubRequestPolicy.GitHubApiAuthenticationError({ host, operation }),
      response(403),
      response(410),
      response(422),
      new GitHubRequestPolicy.GitHubApiRateLimitError({ host, operation }),
      new SourceControlRateLimit.SourceControlRateLimitPausedError({
        provider: SourceControlProviderKind.make("github"),
        host,
        retryAt: 0,
      }),
      new GitHubCredentials.GitHubNotSignedInError({ host }),
      // Anything else may have applied.
      response(408),
      response(409),
      response(429),
      response(500),
      response(502),
      new GitHubRequestPolicy.GitHubApiRequestError({ host, operation, cause: "timeout" }),
    ].map(classify),
    [
      "rejected:permanent",
      "rejected:permanent",
      "rejected:permanent",
      "rejected:permanent",
      "rejected:permanent",
      "rejected:transient",
      "rejected:transient",
      "rejected:transient",
      "ambiguous",
      "ambiguous",
      "ambiguous",
      "ambiguous",
      "ambiguous",
      "ambiguous",
    ],
  );
});

/** A tracker session over canned REST answers, with one verified account pinned. */
const withSession = <A>(
  answer: (
    input: GitHubRest.GitHubRestInput,
  ) => Effect.Effect<unknown, GitHubRequestPolicy.GitHubApiError>,
  use: (
    session: FactoryTracker.TrackerSession,
  ) => Effect.Effect<A, FactoryTracker.FactoryTrackerError>,
) =>
  Effect.gen(function* () {
    const tracker = yield* FactoryTracker.FactoryTracker;
    return yield* tracker.withSession({ host, cwd: "/workspace" }, use);
  }).pipe(
    Effect.provide(
      FactoryTracker.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              GitHubRest.GitHubRest,
              GitHubRest.GitHubRest.of({
                credential: () =>
                  Effect.die("the claim adapter must not read the ambient credential"),
                rest: (input) =>
                  Effect.map(answer(input), (body) => ({
                    status: 200,
                    headers: {},
                    body: JSON.stringify(body),
                    truncated: false,
                    invalidUtf8: false,
                  })),
              }),
            ),
            Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({
              withVerifiedCredential: (_input, run) =>
                run({ accountId: "9001", viewer: "t3-factory", credentialFingerprint: "fp" }),
            }),
          ),
        ),
      ),
    ),
  );

it.effect("an issue read follows every page of comments", () =>
  Effect.gen(function* () {
    const comments = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1,
      body: `comment ${index + 1}`,
      user: { id: 7 },
    }));
    const issue = yield* withSession(
      (input) =>
        Effect.succeed(
          input.path.includes("/dependencies/blocked_by")
            ? []
            : input.path.endsWith("/parent")
              ? { number: 1 }
              : input.path.includes("/comments")
                ? comments.slice(
                    (Number(/[?&]page=(\d+)/.exec(input.path)![1]) - 1) * 100,
                    Number(/[?&]page=(\d+)/.exec(input.path)![1]) * 100,
                  )
                : { state: "open", title: "T", body: null, labels: [{ name: "ready" }] },
        ),
      (session) => session.readIssue({ repository: "acme/web", issueNumber: 1 }),
    );
    assert.strictEqual(issue.comments.length, 150);
    assert.strictEqual(issue.comments[149]?.authorId, "7");
    assert.deepStrictEqual([issue.body, issue.labels], ["", ["ready"]]);
  }),
);

it.effect("a deleted comment reads as absent, never as an error", () =>
  Effect.gen(function* () {
    const found = yield* withSession(
      () => Effect.fail(new GitHubRequestPolicy.GitHubApiNotFoundError({ host, operation })),
      (session) => session.readComment({ repository: "acme/web", commentId: 5 }),
    );
    assert.isTrue(Option.isNone(found));
  }),
);

it.effect("a successful create without a readable id is ambiguous", () =>
  Effect.gen(function* () {
    const outcome = yield* withSession(
      () => Effect.succeed({ unexpected: true }),
      (session) => session.createComment({ repository: "acme/web", issueNumber: 1, body: "b" }),
    );
    assert.strictEqual(outcome.type, "ambiguous");
  }),
);

it.effect(
  "PR integration: a listed pull request is merged by merged_at, never by its trial merge",
  () =>
    Effect.gen(function* () {
      const listed = (merged_at: string | null) => [
        {
          number: 41,
          state: merged_at === null ? "open" : "closed",
          merged_at,
          merge_commit_sha: "trial0001",
          head: { sha: "c0000002" },
          draft: false,
        },
      ];
      const find = (merged_at: string | null) =>
        withSession(
          (input) => {
            assert.include(input.path, "head=acme%3Abeta%2F12-parse-dates");
            return Effect.succeed(listed(merged_at));
          },
          (session) =>
            session.findPullRequest({
              repository: "acme/web",
              head: "beta/12-parse-dates",
              base: "main",
            }),
        );
      const open = Option.getOrThrow(yield* find(null));
      assert.deepStrictEqual(
        [open.merged, open.mergeCommit, open.mergeableState],
        [false, null, null],
      );
      const merged = Option.getOrThrow(yield* find("2026-10-24T00:00:00Z"));
      assert.deepStrictEqual([merged.merged, merged.mergeCommit], [true, "trial0001"]);
    }),
);

it.effect("PR integration: a failed or running check of either kind holds the merge", () =>
  Effect.gen(function* () {
    const checks = yield* withSession(
      (input) =>
        Effect.succeed(
          input.path.includes("/check-runs")
            ? {
                check_runs: [
                  { name: "build", status: "completed", conclusion: "success" },
                  { name: "test", status: "completed", conclusion: "timed_out" },
                  { name: "e2e", status: "queued", conclusion: null },
                  { name: "docs", status: "completed", conclusion: "skipped" },
                ],
              }
            : {
                state: "failure",
                statuses: [
                  { context: "deploy-preview", state: "pending" },
                  { context: "legacy-ci", state: "error" },
                  { context: "license", state: "success" },
                ],
              },
        ),
      (session) => session.readChecks({ repository: "acme/web", sha: "c0000002" }),
    );
    assert.deepStrictEqual(checks, {
      pending: ["e2e", "deploy-preview"],
      failed: ["test", "legacy-ci"],
    });
  }),
);

it.effect("PR integration: review findings are read whole or not at all", () =>
  Effect.gen(function* () {
    const requests: Array<GitHubRest.GitHubRestInput> = [];
    const answer = (more: boolean) => ({
      data: {
        repository: {
          pullRequest: {
            headRefOid: "c0000002",
            latestOpinionatedReviews: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  id: "R1",
                  state: "CHANGES_REQUESTED",
                  body: "Fix it",
                  url: "u1",
                  author: { login: "coderabbitai" },
                  commit: { oid: "c0000002" },
                },
                {
                  id: "R2",
                  state: "APPROVED",
                  body: "",
                  url: "u2",
                  author: { login: "owner" },
                  commit: { oid: "c0000002" },
                },
              ],
            },
            reviewThreads: {
              pageInfo: { hasNextPage: more },
              nodes: [
                {
                  id: "T1",
                  isResolved: false,
                  isOutdated: false,
                  path: "a.py",
                  line: 3,
                  comments: { nodes: [{ body: "here", url: "u3", author: null }] },
                },
                {
                  id: "T2",
                  isResolved: true,
                  isOutdated: false,
                  path: "b.py",
                  line: null,
                  comments: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    });
    const read = (more: boolean) =>
      withSession(
        (input) => {
          requests.push(input);
          return Effect.succeed(answer(more));
        },
        (session) => session.readReviewFindings({ repository: "acme/web", number: 41 }),
      );
    assert.deepStrictEqual(Option.getOrThrow(yield* read(false)), {
      headSha: "c0000002",
      changesRequested: [
        { id: "R1", author: "coderabbitai", commit: "c0000002", body: "Fix it", url: "u1" },
      ],
      unresolvedThreads: [
        { id: "T1", outdated: false, path: "a.py", line: 3, author: "", body: "here", url: "u3" },
      ],
    });
    const [request] = requests;
    assert.deepStrictEqual(
      [request!.method, request!.path, (request!.body as { variables: unknown }).variables],
      ["POST", "graphql", { owner: "acme", name: "web", number: 41 }],
    );
    // A conversation on a page not read could be the one that matters.
    assert.isTrue(Option.isNone(yield* read(true)));
  }),
);

it.effect("Policy facts: an issue read carries its author, blockers and parent issue", () =>
  Effect.gen(function* () {
    const read = (relations: boolean) =>
      withSession(
        (input) => {
          if (input.path.includes("/comments")) return Effect.succeed([]);
          if (input.path.includes("/dependencies/blocked_by")) {
            return relations
              ? Effect.succeed([
                  {
                    number: 11,
                    state: "closed",
                    repository_url: "https://api.github.com/repos/acme/web",
                  },
                  {
                    number: 3,
                    state: "open",
                    repository_url: "https://api.github.com/repos/acme/api",
                  },
                ])
              : Effect.fail(new GitHubRequestPolicy.GitHubApiNotFoundError({ host, operation }));
          }
          if (input.path.endsWith("/parent")) {
            return relations
              ? Effect.succeed({
                  number: 6,
                  repository_url: "https://api.github.com/repos/acme/web",
                })
              : Effect.fail(new GitHubRequestPolicy.GitHubApiNotFoundError({ host, operation }));
          }
          return Effect.succeed({
            state: "open",
            title: "T",
            body: "B",
            labels: [],
            user: { id: 42, login: "example-user" },
          });
        },
        (session) => session.readIssue({ repository: "acme/web", issueNumber: 12 }),
      );
    const related = yield* read(true);
    assert.deepStrictEqual(
      [related.author, related.blockedBy, related.parent],
      [
        { id: "42", login: "example-user" },
        [
          { repository: "acme/web", number: 11, state: "closed" },
          { repository: "acme/api", number: 3, state: "open" },
        ],
        { repository: "acme/web", number: 6 },
      ],
    );
    // Without the relations API, blockers are unknown rather than none, and there is no parent.
    const unrelated = yield* read(false);
    assert.deepStrictEqual([unrelated.blockedBy, unrelated.parent], [null, null]);
  }),
);

it.effect("Quota: a pass over unchanged issues revalidates every read and is charged nothing", () =>
  Effect.gen(function* () {
    // GitHub's answer per path, its version in the ETag; a 304 is free, a 200 is charged.
    const answers = new Map<string, { readonly version: number; readonly body: unknown }>([
      [
        "repos/acme/web/issues?state=open&per_page=100&page=1",
        { version: 1, body: [{ number: 12 }] },
      ],
      [
        "repos/acme/web/issues/12",
        { version: 1, body: { state: "open", title: "T", body: "B", labels: [] } },
      ],
      ["repos/acme/web/issues/12/dependencies/blocked_by?per_page=100", { version: 1, body: [] }],
      ["repos/acme/web/issues/12/parent", { version: 1, body: { number: 6 } }],
      [
        "repos/acme/web/issues/12/comments?per_page=100&page=1",
        { version: 1, body: [{ id: 1, body: "first", user: { id: 7 } }] },
      ],
    ]);
    const charged: Array<string> = [];
    const revalidated: Array<string> = [];
    const pass = Effect.gen(function* () {
      const tracker = yield* FactoryTracker.FactoryTracker;
      return yield* tracker.withSession({ host, cwd: "/workspace" }, (session) =>
        Effect.all([
          session.listOpenIssues({ repository: "acme/web" }),
          session.readIssue({ repository: "acme/web", issueNumber: 12 }),
        ]),
      );
    });
    const layer = FactoryTracker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            GitHubRest.GitHubRest,
            GitHubRest.GitHubRest.of({
              credential: () =>
                Effect.die("the claim adapter must not read the ambient credential"),
              rest: (input) => {
                const answer = answers.get(input.path)!;
                const etag = `"${input.path}@${answer.version}"`;
                const unchanged = input.ifNoneMatch === etag;
                (unchanged ? revalidated : charged).push(input.path);
                return Effect.succeed({
                  status: unchanged ? 304 : 200,
                  headers: { etag },
                  body: unchanged ? "" : JSON.stringify(answer.body),
                  truncated: false,
                  invalidUtf8: false,
                });
              },
            }),
          ),
          Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({
            withVerifiedCredential: (_input, run) =>
              run({ accountId: "9001", viewer: "t3-factory", credentialFingerprint: "fp" }),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const [listed, issue] = yield* pass;
      assert.strictEqual(charged.length, answers.size);
      charged.length = 0;
      // Nothing changed: every read is a free 304 and the answer is the same.
      assert.deepStrictEqual(yield* pass, [listed, issue]);
      assert.deepStrictEqual([charged, revalidated.length], [[], answers.size]);
      // A new comment is read in full, and only its own answer is charged.
      answers.set("repos/acme/web/issues/12/comments?per_page=100&page=1", {
        version: 2,
        body: [
          { id: 1, body: "first", user: { id: 7 } },
          { id: 2, body: "second", user: { id: 7 } },
        ],
      });
      const [, changed] = yield* pass;
      assert.deepStrictEqual(
        changed.comments.map((comment) => comment.body),
        ["first", "second"],
      );
      assert.deepStrictEqual(charged, ["repos/acme/web/issues/12/comments?per_page=100&page=1"]);
    }).pipe(Effect.provide(layer));
  }),
);
