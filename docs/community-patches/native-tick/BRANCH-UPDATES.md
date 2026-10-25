# Review fixes after preview.1

These changes are on the review branch at source commit [`1262f3c69522acbb5c6a7c498ad4e3481b3def91`](https://github.com/zainmitchell/t3code/commit/1262f3c69522acbb5c6a7c498ad4e3481b3def91). [Fork review PR #2](https://github.com/zainmitchell/t3code/pull/2) remains the review record. The original preview.1 tag, ZIP, raw patch and checksum file are unchanged. Downloading preview.1 does not include these later fixes. Build the branch to try the corrected source while review continues.

## What changed

The review branch preserves a new launch intent when the orchestrator accepted it before a later launch step failed. The next pass can recover the same work with its pinned launch facts. An unaccepted launch failure still discards the intent. A regression reproduced the accepted-intent loss before the fix.

A failed pass now examines its coalesced follow-up before finishing. A pending follow-up runs unless the job is stopping or reaches the existing pass cap. With no follow-up, the failure still propagates. Another regression reproduced the lost follow-up before the fix. The scheduler also rechecks coalescing before each busy-task retry, with a separate regression that failed before that change.

Command-job errors now carry an operation and relevant job/path attributes, preserving the immediate cause. Messages do not copy underlying error text or raw stderr. Nonzero-exit stderr stays in `last-run.log` and `status.json`. Tests verify cause preservation and the separation of the error message from diagnostics. The reviewed I/O helpers use named spans.

The Windows timeout fixture waits for the captured grandchild through the operating system before probing it. It adds no sleep or polling loop. The crash-harness caller explicitly enables Node type stripping; older supported Node versions were not independently executed in this follow-up.

The local build-monitor example writes a temporary state file and renames it after the write completes. Direct replay still produced notification counts 0, 1, 1 and no worker requests. This does not make notification appends exactly once or add hard-crash reconciliation.

The installation guide now explicitly registers the example project with `project add` before `serve` and scheduled-task setup. The built CLI successfully created it in a fresh disposable home. On Windows, use short disposable paths if temporary-directory creation reports `ENAMETOOLONG`.

## Verification

The changed-file gate passed formatting, lint, knip, GraphQL checks, typechecking of two affected packages, and all 100 tests in five executed files. Seven test paths were selected. This includes scheduler and command-job coverage and overlaps the original preview evidence.

The earlier preview's broader Windows fixture failures and runtime limitations remain recorded in CHECKS.md and RUNTIME-VERIFICATION.json. A passing follow-up gate is not a full-suite, full-client, real-provider, physical-remote-route, other-OS, existing-state-upgrade or production acceptance claim. No deployment or upstream merge follows from these checks. CodeRabbit's previous review returned findings; assessment and fixes do not establish approval of the new head.

Implementation and validation of these fixes: GPT-6.1 Sol through Codex in T3 Code. Automated findings: CodeRabbit. The original Claude Opus 5.5 and inherited upstream authorship remain credited in README.md and UPSTREAM.md.
