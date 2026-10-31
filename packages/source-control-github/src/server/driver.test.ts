import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import { apiServicesOf, driver, makeIsRepositoryStarred } from "./driver.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

describe("makeIsRepositoryStarred", () => {
  it.effect("is true only when GitHub answers 204 for the repository", () => {
    const paths: Array<string> = [];
    const starred = new Set(["user/starred/pingdotgg/t3code"]);
    const api = Layer.mock(GitHubRest.GitHubRest)({
      rest: (input) => {
        paths.push(input.path);
        return starred.has(input.path)
          ? Effect.succeed({
              status: 204,
              headers: {},
              body: "",
              truncated: false,
              invalidUtf8: false,
            })
          : Effect.fail(
              new GitHubRequestPolicy.GitHubApiNotFoundError({
                host: input.host,
                operation: input.operation,
              }),
            );
      },
    });
    return Effect.gen(function* () {
      const isStarred = yield* makeIsRepositoryStarred;
      assert.isTrue(yield* isStarred("github.com", "pingdotgg/t3code"));
      assert.isFalse(yield* isStarred("github.com", "pingdotgg/uploadthing"));
      assert.isFalse(yield* isStarred("github.com", "pingdotgg/t3code/../../user"));
      assert.deepStrictEqual(paths, [
        "user/starred/pingdotgg/t3code",
        "user/starred/pingdotgg/uploadthing",
      ]);
    }).pipe(Effect.provide(api));
  });
});

it.effect("hands out the services the driver reads through, not a second copy of them", () => {
  let tokenLookups = 0;
  const authorizations: Array<string | undefined> = [];
  return Effect.gen(function* () {
    const instance = yield* driver.make;
    const services = apiServicesOf(instance);
    assert.isDefined(services);
    assert.isUndefined(apiServicesOf({ ...instance }));

    yield* instance.fetchMedia!({
      url: "https://raw.githubusercontent.com/owner/repo/main/shot.png",
      headers: {},
    });
    yield* Context.get(services!, GitHubRest.GitHubRest).rest({
      host: "github.com",
      operation: "test.readIssue",
      path: "repos/owner/repo/issues/1",
    });

    // One credential cache: the REST call reuses the token the driver's media read fetched.
    assert.strictEqual(tokenLookups, 1);
    assert.deepStrictEqual(authorizations, ["Bearer gh-token", "Bearer gh-token"]);
  }).pipe(
    Effect.scoped,
    Effect.provideService(HostProcess.Environment, {}),
    Effect.provide(
      Layer.mergeAll(
        TestSourceControlHost.layer({
          process: {
            run: () =>
              Effect.sync(() => {
                tokenLookups += 1;
                return TestSourceControlHost.processOutput("gh-token\n");
              }),
          },
        }),
        SourceControlRateLimit.layer,
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              authorizations.push(request.headers.authorization);
              return HttpClientResponse.fromWeb(
                request,
                new Response("{}", { headers: { "content-type": "application/json" } }),
              );
            }),
          ),
        ),
        NodeServices.layer,
      ),
    ),
  );
});
