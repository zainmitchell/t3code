/**
 * GitHub's REST transport, pull request API and their errors, for server features that call
 * GitHub outside the driver interface. Take the services from the driver instance with
 * `apiServicesOf`; building `GitHubRest.layerWithDependencies` again would split the quota reserve.
 */
export * as GitHubCredentials from "./GitHubCredentials.ts";
export * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
export * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
export * as GitHubRest from "./GitHubRest.ts";
export { apiServicesOf, type GitHubApiServices } from "./driver.ts";
