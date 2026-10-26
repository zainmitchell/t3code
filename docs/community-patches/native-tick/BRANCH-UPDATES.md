# Review fixes after preview.1

These changes are on the review branch at source commit [`25ab7ae764471316da5fe74532c159a5cc718fa6`](https://github.com/zainmitchell/t3code/commit/25ab7ae764471316da5fe74532c159a5cc718fa6). [Fork review PR #2](https://github.com/zainmitchell/t3code/pull/2) remains the review record. The original preview.1 tag, ZIP, raw patch and checksum file are unchanged. Downloading preview.1 does not include these later fixes. Build the branch to try the corrected source while review continues.

## What changed

The review branch preserves a new launch intent when the orchestrator accepted it before a later launch step failed. The next pass can recover the same work with its pinned launch facts. An unaccepted launch failure still discards the intent. A regression reproduced the accepted-intent loss before the fix.

A failed pass now examines its coalesced follow-up before finishing. A pending follow-up runs unless the job is stopping or reaches the existing pass cap. With no follow-up, the failure still propagates. Another regression reproduced the lost follow-up before the fix. The scheduler also rechecks coalescing before each busy-task retry, with a separate regression that failed before that change.

Command-job errors now carry an operation and relevant job/path attributes, preserving the immediate cause. Messages do not copy underlying error text or raw stderr. Nonzero-exit stderr stays in `last-run.log` and `status.json`. Tests verify cause preservation and the separation of the error message from diagnostics. The reviewed I/O helpers use named spans.

The Windows timeout fixture waits for the captured grandchild through the operating system before probing it. It adds no sleep or polling loop. The crash-harness caller explicitly enables Node type stripping; older supported Node versions were not independently executed in this follow-up.

The local build-monitor example writes a temporary state file and renames it after the write completes. Direct replay still produced notification counts 0, 1, 1 and no worker requests. This does not make notification appends exactly once or add hard-crash reconciliation.

The installation guide now explicitly registers the example project with `project add` before `serve` and scheduled-task setup. The built CLI successfully created it in a fresh disposable home. On Windows, use short disposable paths if temporary-directory creation reports `ENAMETOOLONG`.

## Receipt-read and project-edit follow-up

The shared `ThreadManagementService.hasReceipt` lookup now preserves receipt-read failures. The command-job runner retains a pending launch intent when the lookup fails, records the recovery error and waits for readable state before replaying it. It deletes intent only after a successful lookup confirms absence. A fresh launch also stops when receipt state is unreadable. MCP delegation and batch-creation callers return an operation error rather than treating unreadable state as confirmed acceptance or absence.

Editing a running task into another project now stops the old pass using the original task binding. The existing stop conditions for disabling a task or changing its job remain intact.

Seven targeted regressions failed before these fixes and passed afterward. The final changed-file gate passed all 151 tests in eight executed files, with 12 test paths selected. Formatting, lint, knip, GraphQL checks and typechecking of two affected packages also passed. These counts overlap the earlier 100-test run and must not be added to it.

The current messaging and tick source/test diffs apply to the official base in either order and produce the same source tree. This was checked using disposable Git indexes. It is source-application proof, not combined runtime acceptance.

## Earlier verification

The changed-file gate passed formatting, lint, knip, GraphQL checks, typechecking of two affected packages, and all 100 tests in five executed files. Seven test paths were selected. This includes scheduler and command-job coverage and overlaps the original preview evidence.

The preview's earlier checks and runtime limitations remain recorded in CHECKS.md and RUNTIME-VERIFICATION.json. A passing follow-up gate is not a full-suite, full-client, real-provider, physical-remote-route, other-OS, existing-state-upgrade or production acceptance claim. No deployment or upstream merge follows from these checks. CodeRabbit's previous review returned findings; assessment and fixes do not establish approval of the new head.

Implementation and validation of these fixes: GPT-6.1 Sol through Codex in T3 Code. Automated findings: CodeRabbit. The original Claude Opus 5.5 and inherited upstream authorship remain credited in README.md and UPSTREAM.md.
