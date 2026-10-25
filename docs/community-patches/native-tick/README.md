# Native model-free ticks for T3 Code v0.1.2

This standalone community patch lets a scheduled task execute a trusted host-configured command instead of starting a model turn for every check. The command can finish with `{"requests":[]}` and T3 records completion without creating a thread or provider session. When work is needed, it can return validated requests to launch a worker, send a follow-up, or interrupt work it manages. Requested agent work can still consume provider usage.

## Why this exists

Many coordination decisions are deterministic: a build is still pending, a known worker has finished, or nothing has changed. A model does not need to reread unchanged status at every interval. A command can inspect those facts and involve an agent only when there is a concrete next action.

T3 already owns scheduled tasks, projects, permissions, recorded runs and thread actions. Running the check through that service preserves task lifecycle and action validation in the same environment. An external script can still be useful, but by itself it must arrange those T3 bindings and recovery rules separately. This patch adds a service path, not a complete software factory or a replacement provider runtime.

## When to use it

- A deterministic status/build/worker check has useful work to do between meaningful agent turns.
- A host owner is willing to configure and trust the executable and bind it to specific tasks/projects.
- A controller needs durable work/send identities and recorded failures when a check cannot run.

Use an ordinary scheduled prompt when the scheduled activity is itself a model task. Native ticks still consume host resources and may poll an external service. No measured monetary or performance saving is claimed.

## How it changes T3

A scheduled task references a named job, such as `command-job:check-work`. The host-owned configuration fixes the executable, arguments, working directory, timeout, bound project/tasks and action limits. The task prompt cannot choose an arbitrary executable.

T3 writes a snapshot with recorded workers, launch receipts, run information and previous rejections. It passes input/output paths as `T3_JOB_INPUT` and `T3_JOB_OUTPUT`. The command writes fresh UTF-8 JSON to the new output file. A stale file from another pass must not replay earlier actions.

T3 validates requests before dispatch. Launches need configured permission/model aliases. Sends and interrupts address managed work. Accepted orchestration receipts and the job's durable receipt records support launch recovery; separate send identities suppress repeated follow-ups. The command and arbitrary external side effects are not guaranteed to execute exactly once.

Timers and known worker-state changes can request another pass. Triggers during a pass coalesce into a follow-up rather than overlap the same job; long jobs do not block unrelated due tasks. Pausing, changing or removing the bound task can stop its pass. An unrelated task cannot stop it merely by naming the job. Missing configuration, invalid/missing output, failure or timeout records failure instead of falling through to a model prompt. Run-now acknowledges queueing; observe terminal status separately.

For a software factory, this is a place to run deterministic checks between worker turns. The package does not supply issue intake, claims, capacity accounting, stage acceptance, integration, or a factory connector.

## T3 and host dependencies

These are the patch's direct integration dependencies. Their transitive package graph is fixed by the exact official base and its [root manifest](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/package.json), [server manifest](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/package.json), and [lockfile](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/pnpm-lock.yaml). Existing base capabilities do not require their historical PRs to be applied again.

| Dependency                                                    | Why the tick needs it                                                                                       | Where it comes from                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduler and scheduled-task persistence/service              | Due/manual runs, task binding, run history, enable/disable/edit/delete lifecycle.                           | Existing [ScheduledTaskService](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/src/scheduledTasks/ScheduledTaskService.ts), extended by this patch.                                                                                                        |
| Command-job runner and runtime wiring                         | Choose the command path, coalesce wakeups, validate requests, and wire the service.                         | Bundled `CommandJobs.ts`, scheduler changes and `runtimeLayer.ts`.                                                                                                                                                                                                                                        |
| ProjectService                                                | Check the bound project and workspace used by the job.                                                      | Existing [ProjectService](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/src/project/ProjectService.ts).                                                                                                                                                   |
| ThreadLaunchService                                           | Launch requested workers and use accepted command receipts for recovery/deduplication.                      | Existing [ThreadLaunchService](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/src/orchestration-v2/ThreadLaunchService.ts).                                                                                                                                |
| ThreadManagementService                                       | Read managed workers/runs, send follow-ups and request interrupts.                                          | Existing [ThreadManagementService](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/src/orchestration-v2/ThreadManagementService.ts).                                                                                                                        |
| Contracts and DispatchModeLimit                               | Validate project/task/model identities and requested runtime/interaction ceilings.                          | Existing [contracts](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/packages/contracts/src/index.ts) and [DispatchModeLimit](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/src/orchestration-v2/DispatchModeLimit.ts). |
| ProcessRunner                                                 | Execute the configured command and apply timeout/stop behavior.                                             | Existing [processRunner](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/server/src/processRunner.ts).                                                                                                                                                             |
| ServerConfig, Effect FileSystem/Path/Crypto and atomic writes | Locate host config and preserve per-job input/output/receipt state.                                         | Existing server/runtime dependencies and [atomicWrite](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/packages/shared/src/atomicWrite.ts).                                                                                                                             |
| Host job configuration and executable                         | Supply `command-jobs.json`, a permitted task/project, executable, arguments, working directory and timeout. | Supplied by the host owner; see [INSTALL.md](INSTALL.md).                                                                                                                                                                                                                                                 |
| Provider/model selection for requested agent work             | Needed when the job requests worker actions. An idle pass opens no provider session.                        | Existing T3 provider configuration and configured model aliases. Real provider actions were not exercised here.                                                                                                                                                                                           |

The complete six-file delta is the command-job service, its two test files, scheduler integration, runtime wiring, and the crash fixture, as listed in [MANIFEST.json](MANIFEST.json). It uses existing Effect/platform/test dependencies. **No native messaging PR, #22445–#22448 stack, factory package, new npm dependency, lockfile change, or database migration is required.** That standalone property was exercised against the clean official base.

## A useful example and observed behavior

The original idle example reads the snapshot and returns no requests. The included [build monitor](examples/build-monitor/README.md) reads a local synthetic build-result file, records a notification when a terminal result changes, and persists its fingerprint. Actual scheduler runs for pending, passed, repeated passed inputs produced notification counts **0, 1, 1**. It always returns an empty request list; no worker was launched or messaged and no external CI service was connected.

A separate build service would need to supply the input file. A crash between appending a notification and saving its fingerprint can repeat a notification. The example demonstrates useful local work without idle model turns, not production CI acceptance or complete autonomy.

## Verification and limitations

Windows x64 preparation used Node 26.12.1 and Vite+ 1.3.0. The package passed 46 focused tests across four files, server typecheck/static checks and server bundling. A later selected run passed 178 tests and relevant typechecks. Those counts overlap and must not be added as unique coverage. Final lint/format passed after example import cleanup; the exact final examples also passed a direct replay.

A disposable installation exercise reconstructed the standalone archive on the exact official base, installed pinned dependencies, built the server, and observed idle success, missing-job failure without model fallback, task disablement, and the monitor sequence through authenticated application RPC and scheduler subscriptions. All providers stayed disabled and thread/session projections stayed empty. See [VERIFICATION.json](VERIFICATION.json), [RUNTIME-VERIFICATION.json](RUNTIME-VERIFICATION.json), [CHECKS.md](CHECKS.md), and [DIRECT-EXAMPLE-VERIFICATION.json](DIRECT-EXAMPLE-VERIFICATION.json).

The executable is trusted host code. T3 action limits do not sandbox its filesystem, process or network access. On POSIX, a job can survive a hard server crash; restart reconciliation is not implemented. Normal stop/timeout checks do not establish arbitrary descendant termination after a hard crash.

Real model calls, worker-directed actions, external CI integration, other operating systems, full web/desktop/mobile acceptance, desktop installation and production-state upgrades remain unverified. Focused backend evidence is not a full application-acceptance claim. CodeRabbit/fork-local PR review is a separate state, not implied by publishing the release.

## Source and installation

Use the [applied source branch](https://github.com/zainmitchell/t3code/tree/community/native-tick-v0.1.2) or [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-tick-v0.1.2-preview.1). The exact base is official v0.1.2 at `044f07257c9684ae4543bd1e1ebf9c394e9e3830`; other versions need separate compatibility checks. The release supplies source, manifest, license, examples, guides, evidence and checksums. It requires a source build and host job configuration, not a skill import, prompt, desktop installer or automatic update. Follow [INSTALL.md](INSTALL.md) with disposable state first.

## Related proposals and public history

This publication has not opened an upstream native-tick PR, so it has no upstream open/merged/closed tick PR history to claim. The existing capabilities it uses are already in the pinned T3 base. No closed messaging PR is a tick prerequisite.

[Scheduled prompts #6748](https://github.com/pingdotgg/t3code/discussions/6748) and [recurring thread runs #11654](https://github.com/pingdotgg/t3code/discussions/11654) are related discussions, not prerequisite PRs. They wake agent turns. This command path can complete without one. A bounded search of related public PR text is not an exhaustive claim that no one else has proposed similar work.

| Public milestone                          | Record                                                                                                            | Scope                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Official source baseline                  | [v0.1.2 / 044f0725](https://github.com/pingdotgg/t3code/tree/044f07257c9684ae4543bd1e1ebf9c394e9e3830)            | Existing scheduler, orchestration, project, provider and host-runtime dependencies.                                 |
| Standalone source preview                 | [a2f8cd1e](https://github.com/zainmitchell/t3code/commit/a2f8cd1ef36d456c64b9f298b71f5364deaea742)                | Six-file patch, build guide, idle/build-monitor examples and evidence.                                              |
| Attribution and maintenance clarification | [4cc20cab](https://github.com/zainmitchell/t3code/commit/4cc20cabdcd5c4f4ab634c63a37d8617ec4ac050)                | Documentation; production patch unchanged.                                                                          |
| Dependency/history consolidation          | This guide and its Git history.                                                                                   | Documentation; original release bytes remain unchanged.                                                             |
| Fork-local code review                    | [Feature PR queue](https://github.com/zainmitchell/t3code/pulls?q=is%3Apr+head%3Acommunity%2Fnative-tick-v0.1.2). | Review is separate from upstream contribution; requested/completed states and exact reviewed head must be reported. |

Useful feedback is a deterministic check you want to run, a configuration/recovery concern, or a reproducible failure at a named revision. Feature direction and any eventual upstream PR split still need maintainer agreement.

## Maintenance, upstream intent, and bug reports

This is a temporary community patch fork for free, self-hosted open-source use. The owner maintains the patches and tracks bugs in [the fork's Issues](https://github.com/zainmitchell/t3code/issues) until T3 ships the capability or a better replacement. The intent is to retire these fork-specific changes as upstream meets the need.

We welcome upstream adoption through maintainer-approved direction and focused contributions. The stable bundle is a distribution unit, not a demand to merge that entire bundle as one upstream PR. This work carries no upstream endorsement, approval, or merge commitment. Reports should identify the source base, patch/version, reproduction, expected and observed behavior, and suitably redacted evidence.

The [MIT notice](LICENSE) must accompany copies or substantial portions. Retain applicable dependency notices when distributing a built application. No paid hosting or application installer is provided by this preview.

## AI models and roles

| Model           | Work credited here                                                                                                                                                                                           | Harness                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Claude Opus 5.5 | Fork implementation/integration work; original T3 source retains its upstream authorship.                                                                                                                    | T3 Code's Claude provider. |
| GPT-6.1 Sol     | Source extraction, limited cleanup, source/evidence and documentation review, focused verification, examples, and publication preparation. Native tick also received a documentation review with this model. | Codex in T3 Code.          |

These credits do not claim a new independent audit of every upstream revision. Historical upstream model credits remain attached to their own PRs. CodeRabbit review of this fork's source has not yet been established; a review request, a bot status, and a completed review are different states.
