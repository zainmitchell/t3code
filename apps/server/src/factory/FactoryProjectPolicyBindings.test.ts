import { assert, it } from "@effect/vitest";
import { GitHubPullRequestApi, GitHubRest } from "@t3tools/source-control-github/server/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as FactoryTracker from "./FactoryTracker.ts";

/** Lists open issues over canned REST pages, recording every path the tracker asked for. */
const listOpenIssues = (input: { readonly repository: string }) => {
  const paths: Array<string> = [];
  return Effect.gen(function* () {
    const tracker = yield* FactoryTracker.FactoryTracker;
    const numbers = yield* tracker.withSession(
      { host: "github.com", cwd: "/workspace" },
      (session) => session.listOpenIssues(input),
    );
    return { numbers, paths };
  }).pipe(
    Effect.provide(
      FactoryTracker.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              GitHubRest.GitHubRest,
              GitHubRest.GitHubRest.of({
                credential: () => Effect.die("discovery must not read the ambient credential"),
                rest: (request) => {
                  paths.push(request.path);
                  return Effect.succeed({
                    status: 200,
                    headers: {},
                    body: JSON.stringify([
                      { number: 30, labels: [{ name: "needs-owner" }], comments: 6 },
                      { number: 14 },
                      { number: 101, pull_request: {}, labels: [], comments: 0 },
                    ]),
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
      ),
    ),
  );
};

it.effect("discovery lists every open issue with what tells a claim could hold it", () =>
  Effect.gen(function* () {
    const listed = yield* listOpenIssues({ repository: "example-org/beta-tracker" });
    // Never filtered by readiness, never a pull request; what the listing omits stays unknown.
    assert.deepStrictEqual(listed.paths, [
      "repos/example-org/beta-tracker/issues?state=open&per_page=100&page=1",
    ]);
    assert.deepStrictEqual(listed.numbers, [
      { number: 14, labels: undefined, comments: undefined },
      { number: 30, labels: ["needs-owner"], comments: 6 },
    ]);
  }),
);
