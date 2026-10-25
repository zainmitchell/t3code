# Native messaging verification summary

This summary describes the prepared source patch for official T3 Code `v0.1.2`. The current GitHub publication contains documentation only. It does not include the downloadable patch or an application installer.

## Exact source target

- Upstream base commit: `044f07257c9684ae4543bd1e1ebf9c394e9e3830`.
- Prepared patch filename: `t3-v0.1.2-native-messaging.patch`.
- Prepared patch SHA-256: `7e4564c13a86f167eac91ec1fe3604b6eee83a029c5d2e4b7caed2f3deec4dbb`.
- Verification host: Windows x64, Node 26.12.1, Vite+ 1.3.0.

The patch contains 48 changed source and test files. The prepared package retains the MIT notice and records resulting changed-file hashes in its manifest. No fork history, private project information, credentials, real database copies, or unfiltered logs are part of the intended source package.

## Executed checks

The standalone messaging source passed 196 focused tests across eight files. They exercise peer links and forwarding, MCP access and HTTP handling, project launch handling, launch preparation, Stop behavior, and RPC contracts.

Another 31 tests across five files passed for migration reconciliation, WebSocket handling, core tool registration, and shared tool presentation. These are separate from the 196 focused tests.

After the final small extraction cleanup, the two peer test files were rerun with 14 passing tests. Those 14 are a subset of the focused set, not an additional unique total.

Relevant typechecks passed for contracts, shared code, provider core, client runtime, and the server. Formatting, lint, unused-code checks, and server bundling passed. Lint and typecheck emitted advisory warnings and suggestions, so this is not a warning-free repository claim.

The native messaging patch was also checked with the separate native tick patch against the same stable base. Each patch applied independently. Both combined application orders produced the same source tree. The combined source passed 242 focused tests across 12 files, relevant typechecks, and server bundling. Those tests overlap the standalone checks and are not an additional unique total. The tick package is outside this native messaging documentation publication.

The prepared source archive's internal file checksums and patch checksum were read back and verified. This binds the package contents to the verification record; it does not establish an independently reproduced application build.

## What these results establish

The checks support the implementation paths covered by the fixtures and compilation of the prepared source. They give concrete evidence for request handling, retry behavior, mode limits, and stopping semantics under those tested conditions.

Synthetic provider and transport boundaries were used. The checks did not spend real model calls or exercise the owner's production data. A successful bundle is a build result, not a live deployment or a tested desktop installer.

## Not verified

- Physical communication between separate machines or a real T3 Connect route.
- Actual provider/model execution through the patch.
- Complete browser, desktop, or mobile runtime behavior.
- Other operating systems.
- The full repository test suite.
- Installation or migration against an existing production data directory.

These limits belong alongside the feature description and source download when it becomes available. No full factory lifecycle acceptance, cross-platform parity, or upstream maintainer approval follows from these results.
