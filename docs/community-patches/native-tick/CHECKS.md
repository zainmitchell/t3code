# Publication checks

The repository's changed-file check was run against the exact v0.1.2 base on Windows x64, Node 26.12.1, Vite+ 1.3.0:

```sh
vp run check:changed 044f07257c9684ae4543bd1e1ebf9c394e9e3830
```

The Windows runner needed a local Node adapter to resolve `vp` to the installed Vite+ JavaScript entry point. The running check passed format, knip, generated GraphQL checks, both selected package typechecks, and all 178 tests in six executed files. These tests overlap the earlier 46-test focused evidence; do not add them as unique coverage.

The initial lint check rejected named Node builtin imports in two documentation examples. The examples were changed to the repository's namespace import style. Final lint and format checks then passed on all delivered source and documents. A direct replay of the final example bytes confirmed idle output and build-monitor notification counts 0, 1, 1. DIRECT-EXAMPLE-VERIFICATION.json distinguishes that replay from the earlier actual scheduler exercise in RUNTIME-VERIFICATION.json.

The six-file production patch remains byte-identical to the previously exercised archive. No complete repository suite, provider action, other-platform, external CI, or full client acceptance is claimed.
