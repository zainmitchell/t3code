# Publication checks

The repository's changed-file check was run against the exact v0.1.2 base on Windows x64, Node 26.12.1, Vite+ 1.3.0:

```sh
vp run check:changed 044f07257c9684ae4543bd1e1ebf9c394e9e3830
```

Its Windows runner first needed a local Node launcher adapter: spawning the pnpm `vp.cmd` wrapper directly as `vp` returned ENOENT. The adapter resolved that one invocation to Node and the installed Vite+ entry point. It is verification tooling, not a feature-source change.

The running check passed lint (warnings), knip, generated GraphQL checks, and typechecks for the selected 29 packages. It ran 30 test files: 536 tests passed and three failed. Two failures in OrchestratorMcpToolkit.integration.test.ts convert a file URL pathname into a malformed Windows drive path. One ServerEnvironment.test.ts fixture cannot create its symlink under the current Windows permissions. Those fixture operations are present in the official v0.1.2 code; this preview does not change them or enable machine-wide privileges. The aggregate changed-file test gate remains nonzero on this host.

One peer test needed formatter whitespace and a trailing comma. The preview patch includes that presentation-only cleanup; production code matches the earlier focused/runtime package. Format and lint then passed on all delivered source/docs, and the 14 peer tests passed after formatting. Their count overlaps earlier focused tests.

Earlier focused and fresh-home runtime evidence remains separately identified in VERIFICATION.json and RUNTIME-VERIFICATION.json. No full-suite, physical network, other-platform, or client UI acceptance is claimed. The download is a community source preview with known validation limits.
