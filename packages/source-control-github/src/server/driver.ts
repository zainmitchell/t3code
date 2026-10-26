import type { SourceControlDriverInstance } from "@t3tools/source-control-core/server/driver";
import {
  defineSourceControlDriver,
  withOwnServices,
} from "@t3tools/source-control-core/server/driver";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { definition } from "../shared/definition.ts";

import * as GitHubMediaFetch from "./gitHubMediaFetch.ts";
import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

// `GitHubRest.layerWithDependencies` carries the quota reserve every GitHub reader shares, so it
// must be built once; the driver is.
const services = GitHubPullRequestApi.layer.pipe(
  Layer.provideMerge(GitHubRest.layerWithDependencies),
);

export type GitHubApiServices = GitHubRest.GitHubRest | GitHubPullRequestApi.GitHubPullRequestApi;

const apiServicesByInstance = new WeakMap<
  SourceControlDriverInstance,
  Context.Context<GitHubApiServices>
>();

/**
 * The REST transport and pull request API this driver instance built, for server features that
 * call GitHub outside the driver interface. Reading them here rather than building them again
 * keeps one quota reserve and credential cache per server.
 */
export const apiServicesOf = (
  instance: SourceControlDriverInstance,
): Context.Context<GitHubApiServices> | undefined => apiServicesByInstance.get(instance);

const makeInstance = Effect.gen(function* () {
  const instance = yield* Effect.all({
    sourceControl: GitHubSourceControlProvider.make,
    discovery: GitHubSourceControlProvider.makeDiscovery,
    pullRequests: GitHubPullRequestProvider.make,
    fetchMedia: GitHubMediaFetch.make,
  });
  apiServicesByInstance.set(
    instance,
    Context.make(GitHubRest.GitHubRest, yield* GitHubRest.GitHubRest).pipe(
      Context.add(
        GitHubPullRequestApi.GitHubPullRequestApi,
        yield* GitHubPullRequestApi.GitHubPullRequestApi,
      ),
    ),
  );
  return instance;
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: withOwnServices(makeInstance, services),
});
