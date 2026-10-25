# Review fixes after preview.1

These changes are on the review branch at source commit [`eaa1a4ebce0a8ef7565b69383dfe25c274379b9a`](https://github.com/zainmitchell/t3code/commit/eaa1a4ebce0a8ef7565b69383dfe25c274379b9a). [Fork review PR #1](https://github.com/zainmitchell/t3code/pull/1) remains the review record. The original preview.1 tag, ZIP, raw patch and checksum file are unchanged. Downloading preview.1 does not include these later fixes. Build the branch to try the corrected source while review continues.

## What changed

The review branch records connection outcomes before interpreting a peer tool result. A valid tool refusal or an incompatible tool-result schema still reaches the caller as an error, but clears an old connection error. HTTP, session, unreachable-route and expired-link failures still record a link problem. Local unknown-link failures do not become connection outcomes.

The regression first reproduced a mode refusal appearing as the link's `lastError`. The corrected peer tests cover that refusal, `thread_not_found`, stale-error clearing, decode mismatch and a revoked credential remaining visible as a link failure.

The installation guide now gives explicit `environment link` and `environment list` commands with the same `--base-dir` as `serve`. Built CLI help confirmed the options. That check did not perform a new remote pairing.

## Verification

The changed-file gate passed formatting, lint, knip, GraphQL checks, typechecking of two affected packages, and all 14 peer tests in two executed files. Four test paths were selected. This count overlaps the original preview evidence.

The earlier preview's broader Windows fixture failures and runtime limitations remain recorded in CHECKS.md and RUNTIME-VERIFICATION.json. A passing follow-up gate is not a full-suite, full-client, real-provider, physical-remote-route, other-OS, existing-state-upgrade or production acceptance claim. No deployment or upstream merge follows from these checks. CodeRabbit's previous review returned findings; assessment and fixes do not establish approval of the new head.

Implementation and validation of these fixes: GPT-6.1 Sol through Codex in T3 Code. Automated findings: CodeRabbit. The original Claude Opus 5.5 and inherited upstream authorship remain credited in README.md and UPSTREAM.md.
