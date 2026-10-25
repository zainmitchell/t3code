# Build and try the Native messaging source preview

This preview targets official T3 Code v0.1.2, commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Windows backend setup was exercised with Node 26.12.1 and Vite+ 1.3.0. It provides source code, not a desktop installer or automatic app update. Use disposable state for the first trial.

## Build the already-patched branch

Install Node and Vite+ using the [upstream development setup](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/docs/operations/development.md#first-checkout). The recorded exercise used the versions named above. Clone the [feature branch](https://github.com/zainmitchell/t3code/tree/community/native-messaging-v0.1.2), then install its pinned dependencies and build the server:

```sh
git clone --branch community/native-messaging-v0.1.2 --single-branch https://github.com/zainmitchell/t3code.git t3-native-messaging-example
cd t3-native-messaging-example
vp i --frozen-lockfile
vp run --filter t3 build:bundle
```

The branch already contains the patch. This path needs no additional `git apply` step.

## Apply only the patch to an existing clean source checkout

Alternatively, download the source-patch ZIP from the [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-messaging-v0.1.2-preview.1), check its SHA-256 against the Release's checksum file, and extract it outside the checkout. In a clean official source checkout:

```sh
git checkout --detach v0.1.2
git rev-parse HEAD
git apply --check /path/to/t3-v0.1.2-native-messaging.patch
git apply /path/to/t3-v0.1.2-native-messaging.patch
vp i --frozen-lockfile
vp run --filter t3 build:bundle
```

The HEAD output before application must be `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Replace `/path/to` with the extracted package directory. MANIFEST.json binds the delivered patch and resulting source-file hashes. The full MIT notice must accompany copies or substantial portions.

## Start with a new T3 home

Choose an unused loopback port and new disposable directories. From the source checkout:

```sh
node apps/server/dist/bin.mjs serve --host 127.0.0.1 --port 47831 --base-dir /path/to/new-example-home --no-browser /path/to/example-project
```

On Windows, replace both paths with absolute paths. The built CLI uses `--base-dir`; the development runner's `--home-dir` is a different interface. Runtime state lives below `<example-home>/userdata`. The headless server prints its readiness and pairing details. Those details are credentials and stay private. The source retains upstream package-version metadata; this preview is identified by its source base and patch checksum, not an official application release stamp.

The recorded exercise used fresh homes, synthetic projects, disabled providers, authenticated application APIs, and scheduler subscriptions. Exact manual UI navigation, a desktop installer, production-state upgrades, real provider actions, physical remote routes, and other operating systems remain unverified. See RUNTIME-VERIFICATION.json and VERIFICATION.json.

## Use messaging and linked environments

The launch and Stop improvements also work locally. Supply a stable `clientRequestId` for one top-level launch and reuse it when recovering that same unanswered request. Follow the returned thread and run to determine actual preparation and execution success. `t3_thread_interrupt` with `stop: true` requests the broader Stop operation; acceptance does not prove every arbitrary process ended.

For another environment, run the built CLI's `environment link --help` and use its destination pairing code and access options. The agent discovers links with `t3_environment_links` and uses `environmentId` only on supported native tools. Both servers need compatible code. Keep pairing details private and use owner-trusted environments. The destination can revoke its connection.

The patch adds peer-link migration 68 after the official stable history. A custom fork that already used that number requires integration. Before any existing-state upgrade, stop the server and retain a complete backup. Reversing source code does not restore an earlier database. This preview does not include the later link-origin ownership, remote delegation, or handoff layers described in UPSTREAM.md.
