# Evaluate the source in a disposable environment

This is source, with no signed installer or built desktop or mobile binary. Check every patch against `SHA256SUMS` before applying it.

## Get the source

This is an unpublished local candidate pending the verification gate. Download names below describe the prepared asset set, not existing public downloads. Use the complete source archive or all four ordered patches. Only the complete final source is the factory installation unit; module-only revisions are not supported installations.

For the complete source archive:

```sh
tar -xzf native-factory-nightly3717-preview.1-source.tar.gz
cd t3code-native-factory-nightly3717-preview.1
```

Alternatively, start at exact official commit `1316d48b0c68151afd8b47eb0c11a114cf0b4daa` and apply these in `PATCH-SERIES.json` order:

```sh
git apply 00-native-messaging-nightly3717.patch
git apply 01-native-command-job-modules-nightly3717.patch
git apply 02-native-factory-modules-nightly3717.patch
git apply 03-shared-native-factory-integration-nightly3717.patch
```

The complete combined patch and the factory-over-messaging patch are alternative applications of the same final source, not extra steps to apply after the series. The exact parent/tree and dependencies are in the series manifest. Verify `SHA256SUMS` before applying. No existing patched-home upgrade is supported; use a new T3 home.

Install the pinned dependencies and build the server:

```sh
vp i --frozen-lockfile
vp run --filter t3 build:bundle
```

Use Node 26.12.1, pnpm 12.14.0 and Vite+ 1.4.0. If Vite+ is not on PATH, the pinned pnpm can run the same installation with `pnpm install --frozen-lockfile --yes`. Do not update the lockfile to make an installation pass; the Muse SDK patch and its lockfile hash must match.

## A paused synthetic factory

Use a new absolute directory for the T3 home and another new directory for a synthetic Git repository. Do not use an existing T3 home, provider configuration or tracker repository for this exercise.

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
    "ollama": { "driver": "ollama", "enabled": false, "config": {} },
    "acpRegistry": { "driver": "acpRegistry", "enabled": false, "config": {} }
  }
}
```

Add the synthetic repository as a project, then start the server. Replace each placeholder in angle brackets with your own absolute path:

```sh
node apps/server/dist/bin.mjs project add "<synthetic-repository>" --title "Synthetic factory preview" --base-dir "<new-home>"
node apps/server/dist/bin.mjs serve --host 127.0.0.1 --port 43773 --base-dir "<new-home>" --no-browser
```

Choose a free port between 1 and 65535. Keep the server's PID so you can stop only the process you started. The server prints a pairing credential when it is ready; keep it private. `project add` prints `Added project <project-id> (<title>) at <path>`; keep that ID.

In a second shell, write a new `factory.json`:

```json
{
  "factoryId": "preview-example",
  "projectId": "<project-id>",
  "policyRevision": "synthetic-v1",
  "enabled": false,
  "pools": [{ "poolId": "workers", "capacityUnits": 0 }],
  "execution": {
    "modelSelection": { "instanceId": "codex", "model": "synthetic-unused" },
    "runtimeMode": "approval-required",
    "interactionMode": "default"
  },
  "packet": { "briefSchemaVersion": "brief-v1", "helper": null },
  "artifactRoot": "<new-artifact-directory>"
}
```

Compute the SHA-256 of that exact file and pass the lowercase digest as `<sha256>`:

```sh
node apps/server/dist/bin.mjs factory state --base-dir "<new-home>"
node apps/server/dist/bin.mjs factory install factory.json --expect-sha256 <sha256> --expect-revision 0 --base-dir "<new-home>"
node apps/server/dist/bin.mjs factory state --factory preview-example --base-dir "<new-home>"
```

The installed factory is paused at configuration revision 1, with no occupied units and no reservations. Repeating the install with `--expect-revision 0` fails with "is at revision 1, not 0: nothing installed" and changes nothing. A wrong checksum is refused before the CLI contacts the server. The factory CLI signs in as the host administrator and appends each operation to `factory-admin-audit.jsonl` in the home's state directory. No claim, policy, integration target or clock is configured, so this exercise admits no agent work and makes no tracker request.

## Configure, reuse and stop

Operational configuration is host-owned code and authority. The full schema is in `apps/server/src/factory/FactoryStore.ts`, and the one-shot policy boundary is `FactoryCommandPolicy.ts`. Choose permitted provider and model executions, stage-specific reviewers, capacity pools, a trusted pinned policy, tracker claim rules and an integration target deliberately. The release ships no operational configuration. The fixture policy is only a synthetic test process.

Keep each environment's server and clients on the same source. A local factory needs no peer link.

To pause admissions, install the configuration again with `enabled: false`, its exact checksum and the current revision, then read the state back. Pausing does not stop work that is already running. Resolve custody and results before disposing of reservations or retiring an old writer.

Stop only the server PID you captured. Do not open a migrated database with an older build, copy it into another environment, or treat deleting it as a way to stop processes. A database whose migration history differs from this series is refused at startup; start such an environment with a new home.
