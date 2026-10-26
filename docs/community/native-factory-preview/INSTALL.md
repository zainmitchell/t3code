# Evaluate the source in a disposable environment

Use the source archive or the complete ordered patch series, and verify them against `SHA256SUMS`. Only the complete final source is installable. Messaging, command-job/tick and factory module patches are not separate supported installations; they require the final shared runtime integration patch. This is source, with no signed installer or built desktop/mobile binary.

## Obtain and install

For the complete source archive:

```sh
tar -xzf native-factory-nightly3669-preview.1-source.tar.gz
cd t3code-native-factory-nightly3669-preview.1
vp i --frozen-lockfile -- --yes
```

Use Node 26.12.1, pnpm 12.14.0 and Vite+ 1.4.0 as pinned in the source. If Vite+ is not on PATH, the pinned pnpm can bootstrap the same dependency installation with `pnpm install --frozen-lockfile --yes`. Do not update the lockfile merely to make an installation pass.

Alternatively, start from a clean checkout of official commit `5f64c5eb299a23d278ef043c416bd4dc801bc53c` and apply all four patches in the order and at the exact intermediate revisions recorded in `PATCH-SERIES.json`:

```sh
git apply 01-native-messaging-modules-nightly3669.patch
git apply 02-native-command-job-modules-nightly3669.patch
git apply 03-native-factory-modules-nightly3669.patch
git apply 04-shared-native-runtime-integration-nightly3669.patch
vp i --frozen-lockfile -- --yes
```

The complete archive includes upstream source and notices. The series includes the full dependency set and cannot be reduced to the factory module patch or migrations 070–073. The intermediate trees are review/apply boundaries, not build or install targets. See [DEPENDENCIES.md](DEPENDENCIES.md).

## A paused synthetic factory

Use a new absolute directory for the T3 home and another new directory for a synthetic Git workspace. Explicit `--base-dir` selects that home. Do not use an existing T3 home, provider configuration or tracker repository for this exercise.

Before starting the server, write `userdata/settings.json` inside the new home with every built-in provider disabled:

```json
{
  "providerInstances": {
    "codex": { "driver": "codex", "enabled": false, "config": {} },
    "claudeAgent": { "driver": "claudeAgent", "enabled": false, "config": {} },
    "cursor": { "driver": "cursor", "enabled": false, "config": {} },
    "grok": { "driver": "grok", "enabled": false, "config": {} },
    "opencode": { "driver": "opencode", "enabled": false, "config": {} },
    "antigravity": { "driver": "antigravity", "enabled": false, "config": {} },
    "pi": { "driver": "pi", "enabled": false, "config": {} },
    "muse": { "driver": "muse", "enabled": false, "config": {} },
    "acpRegistry": { "driver": "acpRegistry", "enabled": false, "config": {} }
  }
}
```

Add the synthetic workspace through the source CLI and retain the returned project ID. In these examples, replace angle-bracket placeholders with your newly created absolute paths and project ID:

```sh
node apps/server/src/bin.ts project add "<synthetic-workspace>" --base-dir "<new-home>" --title "Synthetic factory preview"
node apps/server/src/bin.ts serve --host 127.0.0.1 --port 43773 --base-dir "<new-home>"
```

Choose a free port. The CLI requires 1–65535 and does not accept port 0. Keep this process's PID so you can stop only the server you started. The headless output includes a pairing credential; keep it private. No browser is needed.

In a second shell, write a new `factory.json`:

```json
{
  "factoryId": "preview-example",
  "projectId": "<returned-project-id>",
  "policyRevision": "synthetic-v1",
  "enabled": false,
  "pools": [{ "poolId": "workers", "capacityUnits": 0 }],
  "execution": {
    "modelSelection": { "instanceId": "codex", "model": "synthetic-unused" },
    "runtimeMode": "approval-required",
    "interactionMode": "default"
  },
  "packet": { "briefSchemaVersion": "brief-v1", "helper": null },
  "artifactRoot": "<new-absolute-artifact-directory>"
}
```

Compute the SHA-256 of the exact file. Pass that lowercase digest in place of `<sha256>`:

```sh
node apps/server/src/bin.ts factory state --base-dir "<new-home>"
node apps/server/src/bin.ts factory install factory.json --expect-sha256 <sha256> --expect-revision 0 --base-dir "<new-home>"
node apps/server/src/bin.ts factory state --factory preview-example --base-dir "<new-home>"
```

Expect the installed factory to be paused at configuration revision 1, with zero occupied units and no reservations. Repeating the install with expected revision 0 must fail and preserve that state. A changed checksum must also be refused. No claim, policy, integration target or clock is configured, so this exercise admits no agent work and makes no tracker request.

For this release, the administrative installation/refusal exercise and its evidence scope are recorded in [VERIFICATION.md](VERIFICATION.md). It is not a full lifecycle run.

## Configure, reuse and stop

Operational configuration is host-owned code and authority. The full schema is `apps/server/src/factory/FactoryStore.ts`, and the typed one-shot policy boundary is `FactoryCommandPolicy.ts`. Choose permitted provider/model executions, stage-specific reviewers, capacity pools, a trusted pinned policy, tracker claim rules and an integration target deliberately. The release ships no operational configuration. The fixture policy is only a synthetic test process.

Keep each environment's contracts and clients at the same source version. A local factory needs no peer link. Remote links and their permissions are separate configuration, with unproved connection/client journeys listed in the main brief.

To pause admissions, replace the configuration with `enabled: false`, its exact checksum and the current configuration revision. Read back the resulting revision and existing reservations. Pausing does not terminate work already running. Resolve custody and results before disposing reservations or retiring an old writer.

Stop only the disposable server PID you captured. Keep its home separate if you need to inspect the result. Do not open its migrated database with an older build, copy it back to another environment or treat deleting it as a process shutdown mechanism.
