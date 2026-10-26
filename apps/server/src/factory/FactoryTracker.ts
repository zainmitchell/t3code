import {
  apiServicesOf,
  GitHubPullRequestApi,
  type GitHubRequestPolicy,
  GitHubRest,
} from "@t3tools/source-control-github/server/api";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import type { TrackerComment, TrackerIssue } from "./factoryClaimPolicy.ts";

export class FactoryTrackerError extends Schema.TaggedError<FactoryTrackerError>()(
  "FactoryTrackerError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Tracker ${this.operation} failed.`;
  }
}

/**
 * What one create request did. GitHub offers no compare-and-set or idempotency key for a
 * comment, so anything not positively known is `ambiguous`.
 */
export type CreateCommentOutcome =
  | { readonly type: "written"; readonly commentId: number }
  /** Provably not applied: refused before sending, or a documented create rejection. */
  | { readonly type: "rejected"; readonly transient: boolean; readonly cause: string }
  | { readonly type: "ambiguous"; readonly cause: string };

export interface TrackerAccount {
  readonly accountId: string;
}

export interface TrackerPullRequest {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly mergeCommit: string | null;
  readonly headSha: string;
  readonly draft: boolean;
  /** GitHub's node id, which its GraphQL mutations address; null when the answer omitted it. */
  readonly nodeId: string | null;
  /** GitHub's own verdict on its protection; null while GitHub is still computing it. */
  readonly mergeableState: string | null;
}

/** A reviewer's latest changes-requested review of a pull request. */
interface TrackerChangesRequested {
  readonly id: string;
  readonly author: string;
  /** The commit the review was submitted on; null when GitHub no longer has it. */
  readonly commit: string | null;
  readonly body: string;
  readonly url: string;
}

/** An unresolved review conversation, by its opening comment. */
interface TrackerReviewThread {
  readonly id: string;
  /** GitHub's own verdict that the lines it was left on changed since. */
  readonly outdated: boolean;
  readonly path: string;
  readonly line: number | null;
  readonly author: string;
  readonly body: string;
  readonly url: string;
}

export interface TrackerReviewFindings {
  readonly headSha: string;
  readonly changesRequested: ReadonlyArray<TrackerChangesRequested>;
  readonly unresolvedThreads: ReadonlyArray<TrackerReviewThread>;
}

export type CreatePullRequestOutcome =
  | { readonly type: "written"; readonly number: number }
  | Exclude<CreateCommentOutcome, { readonly type: "written" }>;

/** What one merge request did; anything not positively known is read back later. */
export type MergeOutcome =
  | { readonly type: "merged" }
  | { readonly type: "refused"; readonly status: number }
  | { readonly type: "ambiguous"; readonly cause: string };

export interface TrackerCommit {
  readonly parents: ReadonlyArray<string>;
  readonly tree: string;
  readonly message: string;
}

/** An open issue as the tracker lists it; a field the listing did not include is undefined. */
export interface ListedIssue {
  readonly number: number;
  readonly labels: ReadonlyArray<string> | undefined;
  readonly comments: number | undefined;
}

export interface TrackerSession {
  readonly account: TrackerAccount;
  readonly readIssue: (input: {
    readonly repository: string;
    readonly issueNumber: number;
  }) => Effect.Effect<TrackerIssue, FactoryTrackerError>;
  /** Open issues in issue-number order, never pull requests. */
  readonly listOpenIssues: (input: {
    readonly repository: string;
  }) => Effect.Effect<ReadonlyArray<ListedIssue>, FactoryTrackerError>;
  readonly readComment: (input: {
    readonly repository: string;
    readonly commentId: number;
  }) => Effect.Effect<Option.Option<TrackerComment>, FactoryTrackerError>;
  readonly createComment: (input: {
    readonly repository: string;
    readonly issueNumber: number;
    readonly body: string;
  }) => Effect.Effect<CreateCommentOutcome>;
  /** Asks to close the issue; only a later read of the issue says whether it is closed. */
  readonly closeIssue: (input: {
    readonly repository: string;
    readonly issueNumber: number;
  }) => Effect.Effect<void, FactoryTrackerError>;
  /** The newest pull request from the repository's own `head` branch into `base`, if any. */
  readonly findPullRequest: (input: {
    readonly repository: string;
    readonly head: string;
    readonly base: string;
  }) => Effect.Effect<Option.Option<TrackerPullRequest>, FactoryTrackerError>;
  readonly readPullRequest: (input: {
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<TrackerPullRequest, FactoryTrackerError>;
  readonly createPullRequest: (input: {
    readonly repository: string;
    readonly head: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }) => Effect.Effect<CreatePullRequestOutcome>;
  /** Asks to take a draft out of draft; only a later read of the pull request says it did. */
  readonly markReadyForReview: (input: { readonly nodeId: string }) => Effect.Effect<void>;
  /** Merges only at `sha`: GitHub refuses if the pull request's head is anything else. */
  readonly mergePullRequest: (input: {
    readonly repository: string;
    readonly number: number;
    readonly sha: string;
    readonly method: "merge" | "squash" | "rebase";
    readonly title: string;
    readonly message: string;
  }) => Effect.Effect<MergeOutcome>;
  /** The commit's checks and statuses that are still running, and those that failed. */
  readonly readChecks: (input: {
    readonly repository: string;
    readonly sha: string;
  }) => Effect.Effect<
    { readonly pending: ReadonlyArray<string>; readonly failed: ReadonlyArray<string> },
    FactoryTrackerError
  >;
  /** The changes requested and conversations left open on it; none when the answer is partial. */
  readonly readReviewFindings: (input: {
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<Option.Option<TrackerReviewFindings>, FactoryTrackerError>;
  readonly readCommit: (input: {
    readonly repository: string;
    readonly sha: string;
  }) => Effect.Effect<TrackerCommit, FactoryTrackerError>;
  /**
   * The commit's success status in `context`, posted if it is not there yet and read back; false
   * when the readback does not show it.
   */
  readonly ensureSuccessStatus: (input: {
    readonly repository: string;
    readonly sha: string;
    readonly context: string;
    readonly description: string;
  }) => Effect.Effect<boolean, FactoryTrackerError>;
}

export interface FactoryTrackerShape {
  /**
   * Runs `use` with one verified credential pinned across every request it makes, so a read,
   * a write and a read back all act as the same account.
   */
  readonly withSession: <A, E, R>(
    input: { readonly host: string; readonly cwd: string },
    use: (session: TrackerSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | FactoryTrackerError, R>;
}

/**
 * The tracker a factory claims items on. A runtime the server has not given a tracker fails
 * every session, so a factory that requires a claim starts nothing there.
 */
export const FactoryTracker = Context.Reference<FactoryTrackerShape>("t3/factory/FactoryTracker", {
  defaultValue: () => ({
    withSession: () =>
      Effect.fail(
        new FactoryTrackerError({ operation: "session", cause: "No tracker is configured." }),
      ),
  }),
});

const IssueJson = Schema.fromJsonString(
  Schema.Struct({
    state: Schema.Literals(["open", "closed"]),
    title: Schema.String,
    body: Schema.NullOr(Schema.String),
    labels: Schema.Array(Schema.Struct({ name: Schema.String })),
    user: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Int, login: Schema.String }))),
    sub_issues_summary: Schema.optional(Schema.NullOr(Schema.Struct({ total: Schema.Int }))),
  }),
);
const RelatedIssue = Schema.Struct({
  number: Schema.Int,
  state: Schema.optional(Schema.Literals(["open", "closed"])),
  repository_url: Schema.optional(Schema.String),
});
const decodeRelated = Schema.decodeUnknownEffect(Schema.fromJsonString(RelatedIssue));
const decodeRelatedList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(RelatedIssue)),
);
/** `https://api.github.com/repos/owner/repo` names `owner/repo`; absent, the asking repository. */
const repositoryOf = (related: typeof RelatedIssue.Type, fallback: string) =>
  /\/repos\/([^/]+\/[^/]+)$/.exec(related.repository_url ?? "")?.[1] ?? fallback;
const CommentFields = Schema.Struct({
  id: Schema.Int,
  body: Schema.NullOr(Schema.String),
  user: Schema.NullOr(Schema.Struct({ id: Schema.Int })),
});
const decodeIssue = Schema.decodeUnknownEffect(IssueJson);
const decodeIssueList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        number: Schema.Int,
        pull_request: Schema.optional(Schema.Unknown),
        labels: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
        comments: Schema.optional(Schema.Int),
      }),
    ),
  ),
);
const decodeComment = Schema.decodeUnknownEffect(Schema.fromJsonString(CommentFields));
const decodeComments = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(CommentFields)),
);

const PullFields = Schema.Struct({
  number: Schema.Int,
  state: Schema.Literals(["open", "closed"]),
  /** Only a single pull request's read says `merged`; a listing says `merged_at`. */
  merged: Schema.optional(Schema.Boolean),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
  merge_commit_sha: Schema.NullOr(Schema.String),
  head: Schema.Struct({ sha: Schema.String }),
  node_id: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  mergeable_state: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodePull = Schema.decodeUnknownEffect(Schema.fromJsonString(PullFields));
const decodePulls = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(PullFields)));
const decodeCheckRuns = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      check_runs: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          status: Schema.String,
          conclusion: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
);
const decodeStatuses = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      statuses: Schema.Array(Schema.Struct({ context: Schema.String, state: Schema.String })),
    }),
  ),
);
const decodeCommit = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      parents: Schema.Array(Schema.Struct({ sha: Schema.String })),
      commit: Schema.Struct({
        message: Schema.String,
        tree: Schema.Struct({ sha: Schema.String }),
      }),
    }),
  ),
);

const REVIEW_FINDINGS_QUERY =
  "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid latestOpinionatedReviews(first:100){pageInfo{hasNextPage} nodes{id state body url author{login} commit{oid}}} reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved isOutdated path line comments(first:1){nodes{body url author{login}}}}}}}}";
const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }));
const Page = Schema.Struct({ hasNextPage: Schema.Boolean });
const ReviewFindingsPull = Schema.Struct({
  headRefOid: Schema.String,
  latestOpinionatedReviews: Schema.Struct({
    pageInfo: Page,
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        state: Schema.String,
        body: Schema.String,
        url: Schema.String,
        author: Login,
        commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
      }),
    ),
  }),
  reviewThreads: Schema.Struct({
    pageInfo: Page,
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        isResolved: Schema.Boolean,
        isOutdated: Schema.Boolean,
        path: Schema.String,
        line: Schema.NullOr(Schema.Int),
        comments: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({ body: Schema.String, url: Schema.String, author: Login }),
          ),
        }),
      }),
    ),
  }),
});
const decodeReviewFindings = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      data: Schema.Struct({ repository: Schema.Struct({ pullRequest: ReviewFindingsPull }) }),
    }),
  ),
);

const toReviewFindings = (
  pull: typeof ReviewFindingsPull.Type,
): Option.Option<TrackerReviewFindings> => {
  const { latestOpinionatedReviews: reviews, reviewThreads: threads } = pull;
  // A conversation past the first page could be the one that matters: decide nothing on a part.
  if (reviews.pageInfo.hasNextPage || threads.pageInfo.hasNextPage) return Option.none();
  return Option.some({
    headSha: pull.headRefOid,
    changesRequested: reviews.nodes
      .filter((review) => review.state === "CHANGES_REQUESTED")
      .map((review) => ({
        id: review.id,
        author: review.author?.login ?? "",
        commit: review.commit?.oid ?? null,
        body: review.body,
        url: review.url,
      })),
    unresolvedThreads: threads.nodes
      .filter((thread) => !thread.isResolved)
      .map((thread) => {
        const opening = thread.comments.nodes[0];
        return {
          id: thread.id,
          outdated: thread.isOutdated,
          path: thread.path,
          line: thread.line,
          author: opening?.author?.login ?? "",
          body: opening?.body ?? "",
          url: opening?.url ?? "",
        };
      }),
  });
};

const toPullRequest = (pull: typeof PullFields.Type): TrackerPullRequest => {
  const merged = pull.merged ?? (pull.merged_at !== undefined && pull.merged_at !== null);
  return {
    number: pull.number,
    state: pull.state,
    merged,
    // An open pull request's merge_commit_sha is only GitHub's trial merge.
    mergeCommit: merged ? pull.merge_commit_sha : null,
    headSha: pull.head.sha,
    draft: pull.draft ?? false,
    nodeId: pull.node_id ?? null,
    mergeableState: pull.mergeable_state ?? null,
  };
};

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

/** Merge refusals GitHub documents: not mergeable, head moved, or invalid; nothing merged. */
const REFUSED_MERGE_STATUSES = new Set([405, 409, 422]);

const toComment = (comment: typeof CommentFields.Type): TrackerComment => ({
  id: comment.id,
  body: comment.body ?? "",
  authorId: comment.user === null ? "" : String(comment.user.id),
});

/** Documented create-comment rejections; anything else from GitHub may have applied. */
const REJECTED_CREATE_STATUSES = new Set([403, 410, 422]);

/** Classifies a create failure from the typed errors `GitHubRest` actually raises. */
export const classifyCreateFailure = (
  error: GitHubRequestPolicy.GitHubApiError,
): Exclude<CreateCommentOutcome, { readonly type: "written" }> => {
  const cause = JSON.stringify({
    tag: error._tag,
    ...("status" in error ? { status: error.status } : {}),
  });
  switch (error._tag) {
    case "SourceControlRateLimitPausedError":
    case "GitHubCliMissingError":
    case "GitHubNotSignedInError":
    case "GitHubHostDisabledError":
    case "GitHubCliFailedError":
    case "GitHubApiRateLimitError":
      return { type: "rejected", transient: true, cause };
    case "GitHubApiAuthenticationError":
    case "GitHubApiNotFoundError":
      return { type: "rejected", transient: false, cause };
    case "GitHubApiResponseError":
      return REJECTED_CREATE_STATUSES.has(error.status)
        ? { type: "rejected", transient: false, cause }
        : { type: "ambiguous", cause };
    case "GitHubApiRequestError":
      return { type: "ambiguous", cause };
  }
};

const make = Effect.gen(function* () {
  const rest = yield* GitHubRest.GitHubRest;
  const pullRequests = yield* GitHubPullRequestApi.GitHubPullRequestApi;
  // A pass re-reads every subject each minute, past an hour's quota; each read's ETag and body
  // turn an unchanged answer into a 304, which GitHub does not charge. Keyed by credential, so
  // no validator revalidates another account's body; a 304 writes its entry back.
  const validators = yield* Cache.make({
    capacity: 1024,
    timeToLive: "1 hour",
    lookup: (_key: string) =>
      Effect.succeed(Option.none<{ readonly etag: string; readonly body: string }>()),
  });

  const withSession: FactoryTrackerShape["withSession"] = (input, use) =>
    pullRequests
      .withVerifiedCredential({ cwd: input.cwd, host: input.host }, (identity) => {
        const host = input.host;
        const fail = (operation: string) => (cause: unknown) =>
          new FactoryTrackerError({ operation, cause });
        // GitHubRest.send already spans each request.
        const get = Effect.fnUntraced(function* (operation: string, path: string) {
          const key = `${identity.credentialFingerprint}\0${host}\0${path}`;
          const previous = yield* Cache.get(validators, key);
          const response = yield* rest.rest({
            host,
            operation,
            path,
            ...(Option.isSome(previous) ? { ifNoneMatch: previous.value.etag } : {}),
          });
          if (response.status === 304 && Option.isSome(previous)) {
            yield* Cache.set(validators, key, previous);
            return previous.value.body;
          }
          const etag = response.headers["etag"]?.trim();
          yield* etag
            ? Cache.set(validators, key, Option.some({ etag, body: response.body }))
            : Cache.invalidate(validators, key);
          return response.body;
        });

        const readComments = Effect.fn("FactoryTracker.readComments")(function* (
          repository: string,
          issueNumber: number,
        ) {
          const comments: Array<TrackerComment> = [];
          for (let page = 1; ; page++) {
            const body = yield* get(
              "factory.readComments",
              `repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
            );
            const decoded = yield* decodeComments(body);
            comments.push(...decoded.map(toComment));
            if (decoded.length < 100) return comments;
          }
        });

        const session: TrackerSession = {
          account: { accountId: identity.accountId },
          readIssue: Effect.fn("FactoryTracker.readIssue")(
            function* (input: { readonly repository: string; readonly issueNumber: number }) {
              const issue = yield* decodeIssue(
                yield* get(
                  "factory.readIssue",
                  `repos/${input.repository}/issues/${input.issueNumber}`,
                ),
              );
              const path = `repos/${input.repository}/issues/${input.issueNumber}`;
              // A tracker without the relation answers not found: blockers are then unknown, and
              // the issue is nobody's sub-issue.
              const blockedBy = yield* get(
                "factory.readBlockedBy",
                `${path}/dependencies/blocked_by?per_page=100`,
              ).pipe(
                Effect.flatMap(decodeRelatedList),
                Effect.map((related) =>
                  related.map((blocker) => ({
                    repository: repositoryOf(blocker, input.repository),
                    number: blocker.number,
                    state: blocker.state ?? ("open" as const),
                  })),
                ),
                Effect.catchTags({ GitHubApiNotFoundError: () => Effect.succeed(null) }),
              );
              const parent = yield* get("factory.readParent", `${path}/parent`).pipe(
                Effect.flatMap(decodeRelated),
                Effect.map((related) => ({
                  repository: repositoryOf(related, input.repository),
                  number: related.number,
                })),
                Effect.catchTags({ GitHubApiNotFoundError: () => Effect.succeed(null) }),
              );
              return {
                state: issue.state,
                title: issue.title,
                body: issue.body ?? "",
                labels: issue.labels.map((label) => label.name),
                comments: yield* readComments(input.repository, input.issueNumber),
                ...(issue.user == null
                  ? {}
                  : { author: { id: String(issue.user.id), login: issue.user.login } }),
                ...(issue.sub_issues_summary == null
                  ? {}
                  : { subIssueCount: issue.sub_issues_summary.total }),
                blockedBy,
                parent,
              };
            },
            Effect.mapError(fail("read-issue")),
          ),
          listOpenIssues: Effect.fn("FactoryTracker.listOpenIssues")(
            function* (input: { readonly repository: string }) {
              const listed: Array<ListedIssue> = [];
              for (let page = 1; ; page++) {
                const decoded = yield* decodeIssueList(
                  yield* get(
                    "factory.listOpenIssues",
                    `repos/${input.repository}/issues?state=open&per_page=100&page=${page}`,
                  ),
                );
                for (const issue of decoded) {
                  if (issue.pull_request !== undefined) continue;
                  listed.push({
                    number: issue.number,
                    labels: issue.labels?.map((label) => label.name),
                    comments: issue.comments,
                  });
                }
                if (decoded.length < 100) {
                  return listed.toSorted((left, right) => left.number - right.number);
                }
              }
            },
            Effect.mapError(fail("list-open-issues")),
          ),
          readComment: ({ repository, commentId }) =>
            get("factory.readComment", `repos/${repository}/issues/comments/${commentId}`).pipe(
              Effect.flatMap(decodeComment),
              Effect.map((comment) => Option.some(toComment(comment))),
              Effect.catchTags({ GitHubApiNotFoundError: () => Effect.succeedNone }),
              Effect.mapError(fail("read-comment")),
            ),
          closeIssue: ({ repository, issueNumber }) =>
            rest
              .rest({
                host,
                operation: "factory.closeIssue",
                method: "PATCH",
                path: `repos/${repository}/issues/${issueNumber}`,
                body: { state: "closed", state_reason: "completed" },
              })
              .pipe(Effect.asVoid, Effect.mapError(fail("close-issue"))),
          createComment: ({ repository, issueNumber, body }) =>
            rest
              .rest({
                host,
                operation: "factory.createComment",
                method: "POST",
                path: `repos/${repository}/issues/${issueNumber}/comments`,
                body: { body },
              })
              .pipe(
                Effect.flatMap((response) =>
                  decodeComment(response.body).pipe(
                    Effect.map((comment): CreateCommentOutcome => ({
                      type: "written",
                      commentId: comment.id,
                    })),
                    // A success we cannot read may still have created the comment.
                    Effect.orElseSucceed((): CreateCommentOutcome => ({
                      type: "ambiguous",
                      cause: "unreadable create response",
                    })),
                  ),
                ),
                Effect.catch((error) => Effect.succeed(classifyCreateFailure(error))),
              ),
          findPullRequest: Effect.fn("FactoryTracker.findPullRequest")(
            function* (input: {
              readonly repository: string;
              readonly head: string;
              readonly base: string;
            }) {
              const owner = input.repository.split("/")[0]!;
              const pulls = yield* decodePulls(
                yield* get(
                  "factory.findPullRequest",
                  `repos/${input.repository}/pulls?state=all&sort=created&direction=desc&per_page=100&head=${encodeURIComponent(`${owner}:${input.head}`)}&base=${encodeURIComponent(input.base)}`,
                ),
              );
              return Option.map(Option.fromNullishOr(pulls[0]), toPullRequest);
            },
            Effect.mapError(fail("find-pull-request")),
          ),
          readPullRequest: ({ repository, number }) =>
            get("factory.readPullRequest", `repos/${repository}/pulls/${number}`).pipe(
              Effect.flatMap(decodePull),
              Effect.map(toPullRequest),
              Effect.mapError(fail("read-pull-request")),
            ),
          createPullRequest: ({ repository, head, base, title, body }) =>
            rest
              .rest({
                host,
                operation: "factory.createPullRequest",
                method: "POST",
                path: `repos/${repository}/pulls`,
                body: { title, head, base, body, draft: false },
              })
              .pipe(
                Effect.flatMap((response) =>
                  decodePull(response.body).pipe(
                    Effect.map((pull): CreatePullRequestOutcome => ({
                      type: "written",
                      number: pull.number,
                    })),
                    Effect.orElseSucceed((): CreatePullRequestOutcome => ({
                      type: "ambiguous",
                      cause: "unreadable create response",
                    })),
                  ),
                ),
                Effect.catch((error) => Effect.succeed(classifyCreateFailure(error))),
              ),
          // REST cannot take a pull request out of draft; GitHub's GraphQL mutation can.
          markReadyForReview: ({ nodeId }) =>
            rest
              .rest({
                host,
                operation: "factory.markReadyForReview",
                method: "POST",
                path: "graphql",
                body: {
                  query:
                    "mutation($pullRequestId:ID!){markPullRequestReadyForReview(input:{pullRequestId:$pullRequestId}){clientMutationId}}",
                  variables: { pullRequestId: nodeId },
                },
              })
              .pipe(Effect.ignore),
          mergePullRequest: ({ repository, number, sha, method, title, message }) =>
            rest
              .rest({
                host,
                operation: "factory.mergePullRequest",
                method: "PUT",
                path: `repos/${repository}/pulls/${number}/merge`,
                body: { sha, merge_method: method, commit_title: title, commit_message: message },
              })
              .pipe(
                Effect.as<MergeOutcome>({ type: "merged" }),
                Effect.catch((error) =>
                  Effect.succeed<MergeOutcome>(
                    error._tag === "GitHubApiResponseError" &&
                      REFUSED_MERGE_STATUSES.has(error.status)
                      ? { type: "refused", status: error.status }
                      : { type: "ambiguous", cause: error._tag },
                  ),
                ),
              ),
          readReviewFindings: ({ repository, number }) =>
            rest
              .rest({
                host,
                operation: "factory.readReviewFindings",
                method: "POST",
                path: "graphql",
                body: {
                  query: REVIEW_FINDINGS_QUERY,
                  variables: {
                    owner: repository.split("/")[0],
                    name: repository.split("/")[1],
                    number,
                  },
                },
              })
              .pipe(
                Effect.flatMap((response) => decodeReviewFindings(response.body)),
                Effect.map((decoded) => toReviewFindings(decoded.data.repository.pullRequest)),
                Effect.mapError(fail("read-review-findings")),
              ),
          readChecks: Effect.fn("FactoryTracker.readChecks")(
            function* (input: { readonly repository: string; readonly sha: string }) {
              const runs = yield* decodeCheckRuns(
                yield* get(
                  "factory.readCheckRuns",
                  `repos/${input.repository}/commits/${input.sha}/check-runs?per_page=100`,
                ),
              );
              const statuses = yield* decodeStatuses(
                yield* get(
                  "factory.readStatuses",
                  `repos/${input.repository}/commits/${input.sha}/status`,
                ),
              );
              return {
                pending: [
                  ...runs.check_runs
                    .filter((run) => run.status !== "completed")
                    .map((run) => run.name),
                  ...statuses.statuses
                    .filter((status) => status.state === "pending")
                    .map((status) => status.context),
                ],
                failed: [
                  ...runs.check_runs
                    .filter(
                      (run) =>
                        run.status === "completed" &&
                        run.conclusion !== null &&
                        FAILED_CONCLUSIONS.has(run.conclusion),
                    )
                    .map((run) => run.name),
                  ...statuses.statuses
                    .filter((status) => status.state === "failure" || status.state === "error")
                    .map((status) => status.context),
                ],
              };
            },
            Effect.mapError(fail("read-checks")),
          ),
          ensureSuccessStatus: Effect.fn("FactoryTracker.ensureSuccessStatus")(
            function* (input: {
              readonly repository: string;
              readonly sha: string;
              readonly context: string;
              readonly description: string;
            }) {
              const succeeded = Effect.map(
                Effect.flatMap(
                  get(
                    "factory.readStatuses",
                    `repos/${input.repository}/commits/${input.sha}/status`,
                  ),
                  decodeStatuses,
                ),
                (combined) =>
                  combined.statuses.some(
                    (status) => status.context === input.context && status.state === "success",
                  ),
              );
              if (yield* succeeded) return true;
              // Statuses only append: posting again after a lost answer changes nothing.
              yield* rest
                .rest({
                  host,
                  operation: "factory.postStatus",
                  method: "POST",
                  path: `repos/${input.repository}/statuses/${input.sha}`,
                  body: {
                    state: "success",
                    context: input.context,
                    description: input.description.slice(0, 140),
                  },
                })
                .pipe(Effect.ignore);
              return yield* succeeded;
            },
            Effect.mapError(fail("ensure-status")),
          ),
          readCommit: ({ repository, sha }) =>
            get("factory.readCommit", `repos/${repository}/commits/${sha}`).pipe(
              Effect.flatMap(decodeCommit),
              Effect.map((commit): TrackerCommit => ({
                parents: commit.parents.map((parent) => parent.sha),
                tree: commit.commit.tree.sha,
                message: commit.commit.message,
              })),
              Effect.mapError(fail("read-commit")),
            ),
        };
        // The inner exit keeps the caller's own failures apart from the credential's.
        return Effect.exit(use(session));
      })
      .pipe(
        Effect.mapError((cause) => new FactoryTrackerError({ operation: "session", cause })),
        Effect.flatMap((exit) => exit),
      );

  return { withSession } satisfies FactoryTrackerShape;
});

export const layer = Layer.effect(FactoryTracker, make);

/**
 * The tracker over the services the GitHub driver built, so factory calls share the driver's quota
 * reserve and credential cache instead of keeping a second view of each.
 */
export const layerFromSourceControlDrivers = layer.pipe(
  Layer.provide(
    Layer.effectContext(
      Effect.gen(function* () {
        const drivers = yield* SourceControlBuiltInDrivers.SourceControlDrivers;
        for (const { instance } of drivers) {
          const services = apiServicesOf(instance);
          if (services !== undefined) return services;
        }
        return yield* Effect.die("The GitHub source control driver is not built.");
      }),
    ),
  ),
);
