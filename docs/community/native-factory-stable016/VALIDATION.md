# Public source validation

This community patch targets official T3 Code 0.1.6 stable. It remains an **experimental source preview with a failing affected-file gate**, not a production-qualified factory release. No executable binaries are distributed.

## Passed checks

- Fresh full frozen-lockfile installation completed, including dependency lifecycle scripts, in isolated scratch directories.
- Formatting and lint passed for the affected source files.
- GraphQL consistency checks passed for server and GitHub source control.
- Typechecks passed across 39 affected packages and dependents.
- A focused six-file run passed 740 tests and exposed one anonymized fixture ordering mismatch. After correction, that fixture's 123 tests passed.
- Contract tests passed (3 tests).
- After correcting two additional synthetic fixture vectors, a lifecycle and coordination recheck passed all 532 tests (509 lifecycle and 23 coordination).

The broad affected-file test run covered 94 files: 2860 tests passed, 5 failed and 24 were skipped. Two of those failures were the synthetic fixture vectors corrected and rechecked above. These figures describe separate actual runs, not a newly invented combined passing total.

## Remaining failures

The affected-file gate has **not passed**. Knip reports five dynamically launched fixture files and eleven unused exports. Three publication-related tests remain failing in `apps/server/src/factory/FactoryEffects.test.ts`:

- `Publication/97.A1-A4`: successor replacement and landing;
- `Publication/97.A3`: readback after lost push and pull-request replies;
- `Publication/97.A5`: missing-base and refused-push waits.

Do not interpret a source publication, a passing typecheck or the focused lifecycle coverage as acceptance of those paths. No changes to those integration behaviors were made merely to obtain a green release check.

## Test environment and scope

Behavior checks ran in an isolated Linux/WSL source snapshot. That snapshot reused the exact locked dependency store with an offline installation that did not repeat dependency lifecycle scripts; the preceding full installation completed those scripts. An earlier mounted-drive test attempt was interrupted and supplies no passing evidence. Private predecessor reviews and deployment receipts are not counted as public-source acceptance.

Existing stock and patched homes have migration histories that differ from this source's custom ledger. Existing-home upgrades and rollback need separate qualification. No complete native Windows-helper, all-client/provider/network, real tracker/model lifecycle, or next automatic application-build acceptance is claimed. Evaluate this source in a fresh isolated home.
