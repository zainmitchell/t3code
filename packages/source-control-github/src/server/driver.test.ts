import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import { apiServicesOf, driver } from "./driver.ts";
import * as GitHubRest from "./GitHubRest.ts";

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
