# Native Software Factory for T3 Code 0.1.6

This community source patch ports the native factory from the earlier 0.1.5-based development line to official **T3 Code 0.1.6 stable**. The stable version describes the upstream base, not a production qualification of this custom extension. The distribution is an experimental source preview, with no executable installer.

The factory connects tracker issues to native implementation, review, correction, verification and guarded integration. T3 records ownership, capacity, execution identity and outcomes; the configured models and project policy decide what work to do. It is useful when several coding agents must work without losing the connection between an issue, its implementation commit, its review and its landing evidence.

## What changed

The port retains factory claims, shared capacity, contained setup and worker execution, restart reconciliation, durable outcomes and guarded integration. Later repairs include artifact SHA-256 validation, immutable failed-execution identity, environment wait handling, safe CLI presentation of failures, and correction after a review failure for a unit that verifies existing code without editing it. An optional post-integration command supports rebuilding a development app; configuration alone does not prove a successful subsequent build.

Official linked-environment messaging is already in upstream 0.1.6. Do not apply the old standalone messaging patch or nightly 3717 component patches on top of this release. Use this complete source tree, or apply its single patch to the exact official base. The old module split is historical.

## Evaluate it

1. Start with a fresh checkout of official `v0.1.6`, commit `2359643cffa6ba9ee84d6f2694b935de54a8013e`. Verify the release assets against `SHA256SUMS`.
2. Apply `native-factory-stable016.patch` using `git apply --check` followed by `git apply`. Alternatively extract the complete source ZIP into a new directory. These are alternative routes to the same source.
3. Follow upstream's contributor setup using its pinned Node version and Vite+ toolchain: `vp install --frozen-lockfile`. Run the affected-file checks and the factory tests before starting it.
4. Use an isolated T3 home and a disposable test repository. Follow the upstream [development procedure](../../../operations/development.md). Do not point a development server at an existing production database.
5. Keep your first factory disabled. Read `t3 factory --help`, `t3 factory install --help` and `t3 factory state --help` from your built launcher. Installation uses a JSON configuration document, its expected SHA-256 and the expected current configuration revision; a new factory uses revision zero. Set `enabled: false` in that document until its project policy and permissions have been checked.
6. Configure your own tracker, project, execution choices, capacity pools, policy command and integration gates. The authoritative configuration is in [FactoryStore.ts](../../../../apps/server/src/factory/FactoryStore.ts), requests are in [factoryMcp.ts](../../../../packages/contracts/src/factoryMcp.ts), and the policy protocol is in [FactoryCommandPolicy.ts](../../../../apps/server/src/factory/FactoryCommandPolicy.ts). The policy fixtures are synthetic test programs, not a ready-to-run production policy.
7. Read back the installed state, admit one disposable issue, then verify its claim, native outcome, review of the exact implementation head and integration evidence. Exercise Stop, restart, failed setup and retry before increasing capacity. Keep external publishing and protected operations gated by your own policy.

To pause a factory, install a new configuration with `enabled: false` and the current expected revision. Pausing admissions does not establish that existing workers have stopped. Use the supported state and lifecycle commands to inspect and reconcile them.

## Compatibility and privacy

This is not an automatic upgrade package for an existing patched home. The source includes custom database migrations; private and public preview histories can differ. Migration compatibility, backup and rollback must be established separately for any existing database. A rollback across migrations can require restoring a matching stopped snapshot before starting the older build.

Only upstream public history and this scrubbed source projection are distributed. Project policies, accounts, credentials, databases, home paths, machine and execution identities, deployment records and private review material are excluded. Legacy receipt source labels and regression fixtures use generic project names and synthetic identifiers. Do not import private takeover receipts expecting their previous project-specific labels to match this public projection.

Web and desktop retain upstream clients; mobile retains its own upstream client. This release adds server, CLI, contracts and MCP paths, not a new factory administration UI on every client. Provider adapters and native containment are platform dependent. No all-client, all-provider or all-network acceptance claim is made.

## Evidence and limits

See [VALIDATION.md](VALIDATION.md) for checks performed on the public projection. Review and operational evidence for its private predecessor are not tests of this scrubbed tree. Full native lifecycle, real tracker/model execution, existing-home upgrades and the next automatic application build remain outside the public acceptance claim. Preview coalescing and additional sorting proposals are not included.

This is a free, self-hosted community extension under the repository's existing MIT license, not an upstream feature or maintainer endorsement. Upstream T3 Code authors retain their attribution. Earlier factory work and the stable port were developed with Claude Opus; GPT-6.1 Sol through Codex prepared this public source projection and documentation.

## History

- [Official T3 Code 0.1.6 release](https://github.com/pingdotgg/t3code/releases/tag/v0.1.6)
- [Factory Ideas discussion](https://github.com/pingdotgg/t3code/discussions/25487)
- [Historical nightly 3717 source preview](https://github.com/zainmitchell/t3code/releases/tag/community-native-factory-nightly3717-preview.1)
- [Historical dependency and PR lineage](https://github.com/zainmitchell/t3code/blob/c3420fceee60dc8f9a06b7a4324fca552a46403b/docs/community/native-factory-preview/PR-LINEAGE.md)

The 0.1.5-based source work was superseded by this 0.1.6 port; a separate public 0.1.5 factory release was not completed. Earlier preview links remain available as history, not as installation prerequisites.
