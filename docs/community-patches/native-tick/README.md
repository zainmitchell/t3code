# Native model-free ticks for T3 Code v0.1.2

Native ticks let a scheduled task run a deterministic, host-configured command instead of starting a model turn. A check can read recorded worker state, decide that nothing needs attention, and finish without creating a thread or opening a provider session.

When work is needed, the command can return structured requests to launch a worker, send a follow-up, or interrupt work it manages. T3 validates those requests before acting. Requested agent work can use a model and incur provider usage.

This is a standalone community source patch for free, self-hosted open-source use. It has no factory lifecycle or native messaging patch dependency. It does not imply upstream endorsement or a promised merge.

## Why use a native tick?

A script can check build status or another service without asking a model to read unchanged status on every pass. The original example demonstrates the idle case by returning no requests. A separate included build monitor demonstrates a useful local status check.

Timers and known worker-state changes can request another pass. Triggers arriving during a pass can coalesce into a follow-up rather than run overlapping copies. A missing or failed command job records a failure instead of becoming an ordinary scheduled prompt.

Scheduled prompts are related infrastructure with a different purpose: they start agent turns. Native ticks add a command execution path that can finish without one. Commands still consume host resources and may poll external services. No measured cost saving is claimed.

## Version and source availability

The package targets [official T3 Code `v0.1.2`](https://github.com/pingdotgg/t3code/tree/044f07257c9684ae4543bd1e1ebf9c394e9e3830), commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Compatibility with other versions is not established.

The [feature branch](https://github.com/zainmitchell/t3code/tree/community/native-tick-v0.1.2) contains the applied source. The [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-tick-v0.1.2-preview.1) provides the source patch, guide, evidence, examples, and checksums. No application binary is supplied. MANIFEST.json identifies the delivered patch bytes.

To build the source, use [Apply the source patch and try an idle tick](INSTALL.md). This requires a source build. It does not update an installed desktop app and cannot be installed by importing a skill or pasting a prompt.

## How commands interact with T3

A scheduled task refers to a configured job, such as `command-job:check-work`. The host configuration supplies the executable, arguments, working directory, timeout, project, and allowed tasks. The task prompt does not supply an arbitrary executable.

T3 provides a snapshot through `T3_JOB_INPUT`. The command writes fresh UTF-8 JSON to `T3_JOB_OUTPUT`, with a `requests` array. The snapshot includes recorded workers, launch receipts, current run information, and previous rejections.

Launches require configured permission and model aliases. Sends and interrupts address work managed by the job. Stable work identifiers and send identifiers support durable deduplication. Receipts do not guarantee exactly-once execution for arbitrary external side effects.

The executable is trusted host code. Limits on requested T3 actions do not sandbox the executable's filesystem, process, or network access.

## Existing verification and limits

Package preparation recorded these results on Windows x64, using Node 26.12.1 and Vite+ 1.3.0:

- 46 focused command-job and scheduler tests passed across four files.
- Server typecheck, format, knip, and server bundling passed.
- Lint passed with warnings.
- The example smoke check returned an empty request list.

The integration evidence checks that an idle tick creates no thread or provider session. Tests use synthetic boundaries and include real local child-process execution. See [VERIFICATION.json](VERIFICATION.json) for the recorded scope. These source checks are recorded separately from the later disposable backend exercise.

The additional Windows backend exercise reconstructed the standalone archive, installed pinned dependencies offline, built the server, and observed idle success, missing-job failure without model fallback, and task disablement through authenticated application RPC. Completion was observed through scheduler subscriptions, after run-now acknowledged queueing. All providers stayed disabled and thread/session projections stayed empty. See [RUNTIME-VERIFICATION.json](RUNTIME-VERIFICATION.json).

The [build-monitor example](examples/build-monitor/README.md) recorded notification counts 0, 1, and 1 for pending, passed, and repeated passed results. It requests no worker action. Real model calls, worker-directed actions, external CI integration, physical routes, full client UI/device acceptance, other operating systems, desktop installation, and production-state upgrades remain unverified.

On POSIX, a command-job process can survive a hard server crash. Restart reconciliation for that process is not implemented in this version. Normal stop and timeout tests do not prove that arbitrary descendants stop after a hard crash.

## Reuse and license

The package includes the MIT license and required upstream notice in [LICENSE](LICENSE). Keep those notices with copies or substantial portions. Preserve applicable dependency notices when distributing a built app. The license includes no warranty.

The additional [publication checks](CHECKS.md) passed 178 selected tests, typechecks, and static checks. Final example import cleanup passed lint/format and a [direct replay](DIRECT-EXAMPLE-VERIFICATION.json); these counts overlap the focused evidence above.
