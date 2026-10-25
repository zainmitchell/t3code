# Native agent messaging for T3 Code v0.1.2

Native agent messaging lets coding agents coordinate through T3's own threads. This community patch adds reliable top-level launches, permission limits that follow forwarded requests, and a full Stop operation. It also supports selected native tools across explicitly linked T3 environments.

For example, a coding agent can start a reviewer, send an existing worker a changed requirement, follow its run, and request a stop. If the answer to a launch request is lost, the caller can retry the same request without blindly creating another worker and worktree.

**Publication status:** this page publishes the documentation first. The stable source patch has been prepared and checked locally. Its downloadable patch package is not published here yet. The [verification summary](VERIFICATION.md) records what was checked and what remains unverified.

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

## Version and reuse direction

The prepared source patch targets the official T3 Code `v0.1.2` source at commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. Other releases and modified forks need their own compatibility checks. A nightly 3669 package is a separate target and is not part of this stable publication.

Reuse requires the matching source patch, a clean checkout of that base, dependency installation, and a source build. The checked preparation used Node 26.12.1 and Vite+ 1.3.0. Building the server bundle does not install or update an existing desktop application. No application installer was produced.

The patch adds the `PeerLinks` migration at id 68 after the official v0.1.2 history. A fork that already used that id needs a deliberate migration integration. Start any manual exercise with disposable state and a throwaway repository. Before changing an existing installation, stop its server and keep a complete backup. Reversing a source patch does not restore an earlier database.

When the source package is published, it needs to include the exact patch, its setup instructions, license notice, manifest, checksums, and verification summary. This documentation does not provide a download link before that artifact is available.

## Current verification limits

The source package passed focused tests, relevant typechecks, static checks, and server bundling on Windows x64. The tests use synthetic boundaries. They do not establish physical host-to-host operation, real T3 Connect routes, actual provider/model execution, other operating systems, or full web, desktop, and mobile runtime behavior.

Pending local uploads cannot be forwarded as attachments. Environment targeting applies only to the explicitly supported tool set. The complete repository test suite and installation against existing production state were not exercised. See the [verification summary](VERIFICATION.md) for the counts and evidence boundaries.

## Feedback and upstream context

Useful feedback includes which coordination failure matters most in your workflow, how retry and Stop behavior should be presented, and which host-to-host scenario would make the best first real-route demonstration.

[Native thread control, #8433](https://github.com/pingdotgg/t3code/discussions/8433), records related upstream capabilities. [Cross-computer threads, #6935](https://github.com/pingdotgg/t3code/discussions/6935), covers a related use case. Those discussions are context for the individual behaviors described here. This page does not claim that local thread messaging is new to T3.

This is community fork work, with no upstream endorsement or merge commitment claimed. The documentation is shared under the repository's [MIT license](../../LICENSE). A source release must retain its required copyright and permission notice and applicable upstream dependency notices.
