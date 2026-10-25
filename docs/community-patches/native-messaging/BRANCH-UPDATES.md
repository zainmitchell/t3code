# Review fixes after preview.1

These changes are on the review branch at source commit [`6a42c2359072b859c4cc57d1ac3e70f851f8d744`](https://github.com/zainmitchell/t3code/commit/6a42c2359072b859c4cc57d1ac3e70f851f8d744). [Fork review PR #1](https://github.com/zainmitchell/t3code/pull/1) remains the review record. The original preview.1 tag, ZIP, raw patch and checksum file are unchanged. Downloading preview.1 does not include these later fixes. Build the branch to try the corrected source while review continues.

## What changed

The review branch records connection outcomes before interpreting a peer tool result. A valid tool refusal or an incompatible tool-result schema still reaches the caller as an error, but clears an old connection error. HTTP, session, unreachable-route and expired-link failures still record a link problem. Local unknown-link failures do not become connection outcomes.

The regression first reproduced a mode refusal appearing as the link's `lastError`. The corrected peer tests cover that refusal, `thread_not_found`, stale-error clearing, decode mismatch and a revoked credential remaining visible as a link failure.

The installation guide now gives explicit `environment link` and `environment list` commands with the same `--base-dir` as `serve`. Built CLI help confirmed the options. That check did not perform a new remote pairing.

## Stop-boundary and idle-launch follow-up

A retried delegated Stop now selects runs recorded before the original Stop boundary, including a queued run that started later. It reaches their known background work even when a newer run exists. Interruption and settlement preserve newer runs, queued work, watches, background items and provider task lists. The settlement callback follows the same ownership bound. Work without a recorded run association is not inferred to belong to an older Stop.

An accepted idle thread receiving its first message now validates a requested worktree base before starting preparation. A missing base returns an actionable error while the accepted thread remains idle. Ordinary message replays keep the stored preparation and skip mutable base checks. An idle replay without a message also remains unchanged.

The regression checks reproduced the Stop and first-message defects before correction. All 59 focused Stop and project-handler tests passed after correction. The final changed-file gate passed all 70 tests in four executed files, with six test paths selected, plus formatting, lint, knip, GraphQL checks and typechecking of two affected packages. Counts overlap earlier coverage.

The current messaging and tick source/test diffs apply in either order to the official base and produce the same tree. This was checked in disposable Git indexes. Combined runtime acceptance remains unverified.

## Earlier verification

The changed-file gate passed formatting, lint, knip, GraphQL checks, typechecking of two affected packages, and all 14 peer tests in two executed files. Four test paths were selected. This count overlaps the original preview evidence.

The earlier preview's broader Windows fixture failures and runtime limitations remain recorded in CHECKS.md and RUNTIME-VERIFICATION.json. A passing follow-up gate is not a full-suite, full-client, real-provider, physical-remote-route, other-OS, existing-state-upgrade or production acceptance claim. No deployment or upstream merge follows from these checks. CodeRabbit's previous review returned findings; assessment and fixes do not establish approval of the new head.

Implementation and validation of these fixes: GPT-6.1 Sol through Codex in T3 Code. Automated findings: CodeRabbit. The original Claude Opus 5.5 and inherited upstream authorship remain credited in README.md and UPSTREAM.md.
