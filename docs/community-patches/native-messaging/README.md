# Native agent messaging for T3 Code v0.1.2

Native agent messaging lets coding agents coordinate through T3's own threads. This community patch adds reliable top-level launches, permission limits that follow forwarded requests, and a full Stop operation. It also supports selected native tools across explicitly linked T3 environments.

For example, a coding agent can start a reviewer, send an existing worker a changed requirement, follow its run, and request a stop. If the answer to a launch request is lost, the caller can retry the same request without blindly creating another worker and worktree.

**Source preview:** the [feature branch](https://github.com/zainmitchell/t3code/tree/community/native-messaging-v0.1.2) contains the applied code. The [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-messaging-v0.1.2-preview.1) provides the source patch, setup guide, evidence, and checksums. No desktop installer is supplied.

This preview integrates T3's existing coordination work with selected reliability changes. [Upstream PR attribution and package scope](UPSTREAM.md) identifies the original and support PRs; this release does not replace that contribution route.

## Upstream PR dependencies and support fixes

| Required feature layer          | Original feature PR                                      | Support/integration PR                                   | What the layer supplies                                                              |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Caller mode limits              | [#16653](https://github.com/pingdotgg/t3code/pull/16653) | [#22445](https://github.com/pingdotgg/t3code/pull/22445) | Runtime and interaction ceilings for forwarded calls.                                |
| Launch request keys             | [#16654](https://github.com/pingdotgg/t3code/pull/16654) | [#22446](https://github.com/pingdotgg/t3code/pull/22446) | Recover accepted launches on retry, with caller and worktree validation.             |
| Peer links                      | [#16655](https://github.com/pingdotgg/t3code/pull/16655) | [#22447](https://github.com/pingdotgg/t3code/pull/22447) | Pairing, credentials, storage, MCP client, migration 68, and response/cleanup fixes. |
| Native linked-environment tools | [#16684](https://github.com/pingdotgg/t3code/pull/16684) | [#22448](https://github.com/pingdotgg/t3code/pull/22448) | Native-tool forwarding plus Stop, validation, and wire-codec fixes.                  |

The original feature order is mode limits → launch request keys → peer links → native-tool forwarding. Each support PR targets its matching original feature branch. These are paired feature/support routes, not eight independent patches to apply sequentially. Current PR heads can advance independently; this table is not a verified cherry-pick recipe for current main.

For the published v0.1.2 preview, the selected supporting changes are already bundled in the single source patch. No separate PR application is required. Do not apply these PRs on top of that download. The preview is a reduced, version-pinned integration, not an assertion that it contains every change in the latest PR heads. The evidence attached to a newer PR head does not automatically validate this stable package.

## What the patch adds

T3 v0.1.2 already provides local thread messaging and the queue, steer, and restart send modes. The patch extends those existing tools with the following behavior.

### Recover an unanswered launch

A top-level launch can carry a `clientRequestId`. Retrying the same operation with the same key can return the thread the server already accepted. An accepted launch is recognized before changed base references or model defaults can cause it to be treated as a fresh request.

This helps a controller recover from a lost response without starting duplicate work. Request keys are scoped to the caller. A new operation needs a new key.

Receiving a thread id does not establish that its workspace is ready or its task succeeded. The caller follows the recorded thread and run to learn the outcome.

### Keep the caller's permission limits

A forwarded request carries the originating agent's runtime permission level and plan or execution setting. The destination also applies the access granted to the connection. Broader access on the connection does not grant broader access to the agent making that request.

Both participating servers need compatible patches so the destination understands and enforces the forwarded limits. These checks govern operations through T3. They do not sandbox arbitrary programs or replace the operating system's permissions.

### Request a complete Stop

The native thread tool accepts `stop: true` for the full Stop operation. It requests interruption of the current turn, holds queued messages, ends associated pull-request watches, and stops app-owned delegated tasks.

Retrying that operation keeps delegated-task cancellation bounded to the original recorded task history. An old retry should not cancel a task delegated afterward. An accepted Stop is not proof that every arbitrary process outside T3 has ended.

### Address an authorized environment

An owner can create a server-owned link to another T3 environment. Supported native tools can then discover its projects and models, launch a thread, read or message a thread, wait for a run, and interrupt work there.

The servers handle authentication and keep connection credentials in the server secret store. Forwarded retry keys are scoped to the caller. A forwarded wait uses bounded requests while remaining attached to the run it first selected.

The destination owns its threads and execution. A remotely launched top-level thread remains a top-level thread. It does not automatically gain delegated-child lineage or completion delivery.

## How this helps T3 users

Users can keep coordination in visible T3 conversations instead of copying updates between tools or addressing a worker through a provider-specific session name. A controller can recover an unanswered launch and distinguish a current-turn interrupt from the broader Stop operation.

These controls are useful when implementation and review run in separate threads, when several providers participate in one workflow, or when work needs an authorized environment's capabilities. Local launch and Stop improvements do not require another computer.

For a software factory controller, messaging provides ways to address and control workers. Issue selection, capacity accounting, result acceptance, and integration remain separate responsibilities. This messaging patch does not include a factory lifecycle or a model-free tick service.

Sending a message can start a model turn on the receiver and consume provider allowance. No monetary or performance saving is claimed for this patch.

## Dependencies and integration scope

All support changes are bundled for the exact v0.1.2 source base: launch contracts and persistence, caller limits, full Stop requests, peer-link storage and migration 68, the MCP client/forwarder, CLI/service wiring, and matching transport/tool guidance. No tick or factory patch is required. Both servers need compatible code for forwarded calls. The [upstream PR map](UPSTREAM.md) distinguishes this reduced package from the larger cross-environment stack.

## Version and reuse direction

The prepared source patch targets the official T3 Code `v0.1.2` source at commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Other releases and modified forks need their own compatibility checks. A nightly 3669 package is a separate target and is not part of this stable publication.

Reuse requires the matching source patch, a clean checkout of that base, dependency installation, and a source build. The checked preparation used Node 26.12.1 and Vite+ 1.3.0. Building the server bundle does not install or update an existing desktop application. No application installer was produced.

The patch adds the `PeerLinks` migration at id 68 after the official v0.1.2 history. A fork that already used that id needs a deliberate migration integration. Start any manual exercise with disposable state and a throwaway repository. Before changing an existing installation, stop its server and keep a complete backup. Reversing a source patch does not restore an earlier database.

Use [INSTALL.md](INSTALL.md) for the already-patched branch or source-patch ZIP. The [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-messaging-v0.1.2-preview.1) includes the versioned code patch, full license notice, manifest, verification records, and checksums.

## Current verification limits

The source package passed 196 focused tests and 31 supplementary tests, relevant typechecks, static checks, and server bundling on Windows x64. The 14 peer tests rerun after cleanup are an overlapping subset. A fresh-home backend exercise also passed startup, peer-link migration, authenticated project API and client RPC checks with every provider disabled and no thread/session projections. The proof server stopped. See [RUNTIME-VERIFICATION.json](RUNTIME-VERIFICATION.json). The tool tests use synthetic boundaries. They do not establish physical host-to-host operation, real T3 Connect routes, actual provider/model execution, other operating systems, or full web, desktop, and mobile runtime behavior.

Pending local uploads cannot be forwarded as attachments. Environment targeting applies only to the explicitly supported tool set. The complete repository test suite and installation against existing production state were not exercised. See the [verification summary](VERIFICATION.json) for the counts and evidence boundaries.

## Feedback and upstream context

Useful feedback includes which coordination failure matters most in your workflow, how retry and Stop behavior should be presented, and which host-to-host scenario would make the best first real-route demonstration.

[Native thread control, #8433](https://github.com/pingdotgg/t3code/discussions/8433), records related upstream capabilities. [Cross-computer threads, #6935](https://github.com/pingdotgg/t3code/discussions/6935), covers a related use case. Those discussions are context for the individual behaviors described here. This page does not claim that local thread messaging is new to T3.

This is community fork work, with no upstream endorsement or merge commitment claimed. The source and documentation retain the [MIT notice](LICENSE). A source release must retain its required copyright and permission notice and applicable upstream dependency notices.

The additional [publication checks](CHECKS.md) passed static checks and 536 selected tests but recorded three Windows fixture failures. The aggregate test gate is not green on this host. The preview adds only formatter cleanup in one test to the previously exercised code.
