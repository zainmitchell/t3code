# Build and try the Native model-free tick source preview

The current branch includes [review fixes after preview.1](BRANCH-UPDATES.md). The preview.1 download remains frozen and does not include those fixes. Its MANIFEST.json describes that original patch. Use the branch build below to try the corrected source while review continues.

This preview targets official T3 Code v0.1.2, commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Windows backend setup was exercised with Node 26.12.1 and Vite+ 1.3.0. It provides source code, not a desktop installer or automatic app update. Use disposable state for the first trial.

## Build the already-patched branch

Install Node and Vite+ using the [upstream development setup](https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/docs/operations/development.md#first-checkout). The recorded exercise used the versions named above. Clone the [feature branch](https://github.com/zainmitchell/t3code/tree/community/native-tick-v0.1.2), then install its pinned dependencies and build the server:

```sh
git clone --branch community/native-tick-v0.1.2 --single-branch https://github.com/zainmitchell/t3code.git t3-native-tick-example
cd t3-native-tick-example
vp i --frozen-lockfile
vp run --filter t3 build:bundle
```

The branch already contains the patch. This path needs no additional `git apply` step.

## Apply only the patch to an existing clean source checkout

Alternatively, download the source-patch ZIP from the [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-tick-v0.1.2-preview.1), check its SHA-256 against the Release's checksum file, and extract it outside the checkout. In a clean official source checkout:

```sh
git checkout --detach v0.1.2
git rev-parse HEAD
git apply --check /path/to/t3-v0.1.2-native-tick.patch
git apply /path/to/t3-v0.1.2-native-tick.patch
vp i --frozen-lockfile
vp run --filter t3 build:bundle
```

The HEAD output before application must be `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Replace `/path/to` with the extracted package directory. MANIFEST.json binds the delivered patch and resulting source-file hashes. The full MIT notice must accompany copies or substantial portions.

## Start with a new T3 home

Choose an unused loopback port and new disposable directories. Create the example project directory, then register it in the disposable T3 home before starting the server:

```sh
node apps/server/dist/bin.mjs project add /path/to/example-project --title "Tick example" --base-dir /path/to/new-example-home
```

Record the project ID printed by `project add`. The `serve` command's final directory argument sets the working directory and does not create a project. From the same source checkout, start the server with the same home and project directory:

```sh
node apps/server/dist/bin.mjs serve --host 127.0.0.1 --port 47831 --base-dir /path/to/new-example-home --no-browser /path/to/example-project
```

On Windows, replace both paths with absolute paths. The built CLI uses `--base-dir`; the development runner's `--home-dir` is a different interface. Runtime state lives below `<example-home>/userdata`. The headless server prints its readiness and pairing details. Those details are credentials and stay private. The source retains upstream package-version metadata; this preview is identified by its source base and patch checksum, not an official application release stamp.

The recorded exercise used fresh homes, synthetic projects, disabled providers, authenticated application APIs, and scheduler subscriptions. Exact manual UI navigation, a desktop installer, production-state upgrades, real provider actions, physical remote routes, and other operating systems remain unverified. See RUNTIME-VERIFICATION.json and VERIFICATION.json.

## Try the idle example

The executable is trusted host code. T3's action limits do not sandbox its filesystem, process, or network access.

1. In the disposable environment, create a disabled scheduled task for the project registered above with prompt `command-job:check-work`. Record its task ID and use the recorded project ID. The ordinary task model selection remains part of its record, but command-job dispatch does not send this reference as a model prompt.
2. Copy `examples/check-work.mjs` and `examples/command-jobs.example.json` to an example area. Put the configuration at `<example-home>/userdata/command-jobs.json`.
3. Replace the ID placeholders. Set the actual Node executable, script argument, and `cwd` to absolute paths. Use forward slashes or valid JSON escaping on Windows. `.cmd` and `.bat` launchers are not accepted.
4. Enable or manually run the bound task. Inspect its recorded terminal result. Run-now acknowledges queueing before the pass completes; use the scheduler's status/subscription to observe completion.

The example reads the supplied snapshot and returns `{"requests":[]}`. The recorded Windows backend exercise observed success without a thread. A missing configured job recorded failure without model fallback. Disabling the task also passed. These were application RPC checks, not manual UI assertions.

## Try the useful local build monitor

The `examples/build-monitor/` directory adds a separate deterministic example. Copy its sample build result as `build-result.json` into a writable example directory and use its configuration template. Set the executable to actual Node, the argument to `watch-build.mjs`, and `cwd` to that directory.

For pending, passed, and repeated passed results, the recorded scheduler runs produced notification counts 0, 1, and 1 in `build-notifications.jsonl`. The example always returns an empty T3 request list. It neither launches nor messages a worker. A separate build service would need to produce the input file. A crash between append and state persistence can repeat a notification; no exactly-once external-side-effect guarantee is made.

Disable the task when finished and stop the disposable server through the normal procedure used to start it. On POSIX, a command-job process can survive a hard server crash and restart reconciliation for it is not implemented. Normal stop/timeout evidence does not establish arbitrary descendant termination after a hard crash.
