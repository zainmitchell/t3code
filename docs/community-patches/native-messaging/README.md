# Native agent messaging for T3 Code v0.1.2

This community source preview extends T3's existing native thread tools with recoverable launches, full Stop/retry behavior, forwarded permission ceilings, and selected tools for explicitly linked environments. It is a reduced stable integration of existing T3 work and selected fixes, with the PR relationships and verification limits below.

## Why this exists

A controller can lose a launch response after T3 accepted it. Blindly retrying may start duplicate workers and worktrees. A permission-limited agent can also need another environment's tools without inheriting that environment's broader credential permissions. Cancellation needs to cover queued and delegated work, while a retry of an old Stop must not cancel newer work.

The goal is predictable control through visible T3 conversations. Provider-specific session names and manual relays do not provide the same T3 thread/run address. This is useful to a human supervising several agents and to a software factory controller, without making either controller the owner of every provider's internal protocol.

## When to use it

- Implementation and review run in separate T3 threads or providers, and need concrete follow-ups.
- A controller must recover an unanswered launch and follow the already accepted work.
- Cancellation needs full Stop semantics rather than only an interrupt of the current turn.
- A workflow needs an explicitly authorized environment's projects, models, or threads. This remote path is optional; local coordination remains useful on one machine.

Local thread control already exists upstream. [#8433](https://github.com/pingdotgg/t3code/discussions/8433) records that work; [#16186](https://github.com/pingdotgg/t3code/discussions/16186) covers launch retry keys. [#6935](https://github.com/pingdotgg/t3code/discussions/6935) and [#16230](https://github.com/pingdotgg/t3code/discussions/16230) cover related cross-computer/provider-specific use cases. This preview shares a stable integration, not a competing claim to originate those capabilities.

## How it changes T3

**Recover a launch.** A top-level launch can carry `clientRequestId`. Accepted receipts can recover the original thread before mutable base/default-model checks reinterpret it as new work. A new operation needs a new key. The key belongs to the invocation namespace, derived from the provider session or authenticated MCP client session; it is not a global identity guaranteed across replacement sessions. Retain the returned thread ID and follow preparation/run history. A returned ID alone does not prove the worker ran successfully.

**Carry the caller's limits.** Authenticated MCP requests propagate runtime and interaction ceilings through `T3-Mode-Limit`. A peer credential does not authorize a caller to widen its modes. Destination authorization and the link's access still apply. These checks govern T3 operations, not arbitrary host programs.

**Address another environment.** The server owns the configured link, OAuth pairing, stored credentials, MCP client, and forwarding. Supported tools can discover projects/models, launch ordinary threads, read/message them, wait for a run, and interrupt it at the destination. Forwarded retry identities are caller-scoped. Waits use bounded requests and remain attached to the selected run. Destination-local thread links are omitted from results because they would open in the wrong environment.

**Stop the intended work.** The broader native Stop operation requests interruption, holds queued messages, ends PR watches, and requests cancellation of app-owned delegated tasks. Replaying the accepted Stop stays bounded to its recorded task history. It does not prove every arbitrary external descendant process has ended.

For a software factory, this supplies worker addresses and control. It does not select issues, reserve capacity, accept results, integrate code, or provide the factory lifecycle. A remote top-level launch does not become a delegated child. Sending a message can start a model turn at the receiver; messaging is not free model execution or the separate model-free tick feature.

## Required PR layers and bundled dependencies

T3 already provides local launch/read/send tools, including queue, steer, and restart. These additions extend request reliability, full Stop behavior, and linked-environment targeting. The four feature layers below form the upstream linked-environment route; each support PR targets the corresponding original feature branch.

| Required layer and purpose                                                                         | Original feature                                         | Support/integration work                                 | Stable preview                                                     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Caller mode ceilings prevent a forwarding credential from widening an agent's permissions.         | [#16653](https://github.com/pingdotgg/t3code/pull/16653) | [#22445](https://github.com/pingdotgg/t3code/pull/22445) | Included.                                                          |
| Launch request keys recover accepted work after a lost response.                                   | [#16654](https://github.com/pingdotgg/t3code/pull/16654) | [#22446](https://github.com/pingdotgg/t3code/pull/22446) | Included, with the selected snapshot's replay/validation behavior. |
| Peer links provide authenticated pairing, credential storage, MCP transport, and migration 68.     | [#16655](https://github.com/pingdotgg/t3code/pull/16655) | [#22447](https://github.com/pingdotgg/t3code/pull/22447) | Included, with selected response/cleanup fixes.                    |
| Native tools target the linked environment; integration includes Stop, validation, and codec work. | [#16684](https://github.com/pingdotgg/t3code/pull/16684) | [#22448](https://github.com/pingdotgg/t3code/pull/22448) | Included in the reduced tool set described here.                   |

All eight were open and unmerged when checked on 2026-10-25. The feature order is mode ceilings, launch request keys, peer links, then forwarding. These are paired feature/support routes, not eight patches to apply sequentially. Support heads can advance independently; their latest heads are not all a single verified linear stack.

For the exact official v0.1.2 base, the download already bundles its selected changes in one 48-file patch. It includes contracts, RPC/MCP authorization, launch and Stop persistence, handlers, WebSocket/service wiring, CLI, peer storage/client/forwarder, migration registration, tool/provider guidance, and tests. **Do not apply the linked PRs on top of the stable download.** No native tick or factory patch, new package manifest, or lockfile change is required. The manifest identifies the complete source delta; it is not a claim to contain every later fix in current PR heads.

The package reuses T3's existing orchestration, thread/project services, authentication, secret storage, provider adapters, contracts, and Effect runtime. Those dependencies come from the pinned base and lockfile. Forwarding requires compatible code and an authorized link at both servers. Local launch/Stop improvements do not require another computer.

## PR history and later layers

The older replacement route was closed without merging when the original feature stack was retained. The [closure explanation](https://github.com/pingdotgg/t3code/pull/21673#issuecomment-6301888964) records that decision. Closed here is contribution history, not a diagnosis that the feature was broken.

| Closed replacement                                       | Capability                                    | Current original / support route                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#21670](https://github.com/pingdotgg/t3code/pull/21670) | Forwarded mode ceilings                       | [#16653](https://github.com/pingdotgg/t3code/pull/16653) / [#22445](https://github.com/pingdotgg/t3code/pull/22445)                                        |
| [#21671](https://github.com/pingdotgg/t3code/pull/21671) | Launch replay                                 | [#16654](https://github.com/pingdotgg/t3code/pull/16654) / [#22446](https://github.com/pingdotgg/t3code/pull/22446)                                        |
| [#21672](https://github.com/pingdotgg/t3code/pull/21672) | Peer links                                    | [#16655](https://github.com/pingdotgg/t3code/pull/16655) / [#22447](https://github.com/pingdotgg/t3code/pull/22447)                                        |
| [#21673](https://github.com/pingdotgg/t3code/pull/21673) | Native-tool forwarding                        | [#16684](https://github.com/pingdotgg/t3code/pull/16684) / [#22448](https://github.com/pingdotgg/t3code/pull/22448)                                        |
| [#21459](https://github.com/pingdotgg/t3code/pull/21459) | Earlier standalone launch-receipt replacement | Historical launch work; current route [#16654](https://github.com/pingdotgg/t3code/pull/16654) / [#22446](https://github.com/pingdotgg/t3code/pull/22446). |

The closed PRs are not additional prerequisites to apply again. Their own test evidence and implementation details apply to their named revisions. For example, #21459 documents key-encoding/length and replay work; this reduced preview must not inherit all of that PR's behavior or evidence by citation alone.

The larger upstream cross-environment effort also has these **related later layers, outside this package**:

| Open related PR                                          | Purpose                                                | Relationship to this preview                                        |
| -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| [#16695](https://github.com/pingdotgg/t3code/pull/16695) | Keep work started through a link within that link.     | Later ownership/lifetime layer; not supplied by this reduced patch. |
| [#16698](https://github.com/pingdotgg/t3code/pull/16698) | Linked-environment controls in web/mobile Connections. | UI layer; this preview uses its bundled CLI/service path.           |
| [#16719](https://github.com/pingdotgg/t3code/pull/16719) | Remote `delegate_task`.                                | Automatic delegated-child lineage/completion is not included here.  |
| [#16731](https://github.com/pingdotgg/t3code/pull/16731) | Import conversation history.                           | Not included.                                                       |
| [#16734](https://github.com/pingdotgg/t3code/pull/16734) | Package/apply a thread's Git work.                     | Not included.                                                       |
| [#16751](https://github.com/pingdotgg/t3code/pull/16751) | Hand a thread off to another environment.              | Not included.                                                       |
| [#16758](https://github.com/pingdotgg/t3code/pull/16758) | Web/mobile Continue-on controls.                       | Not included.                                                       |

These links preserve relevant context without turning later capabilities into prerequisites for the stable ZIP. Original design/implementation credit remains with the upstream authors. #21459 separately credits GPT-6.1 Sol implementation, GPT-6 Astra tests, and Claude Opus 5.5/GPT-6 Sol reviews. Those are historical upstream credits, not new reviews of this archive.

## What works, what is pending, and how to review it

The [PR status map](REVIEW-STATUS.md) separates each head, merge state, CI execution, reported local checks, and older runtime evidence. Open/unmerged, conflicts, a contributor-trust label, and a functional failure are different facts. A green labeling/CodeRabbit rollup is not proof that build/test CI ran. Current support-PR comments report local checks at their named heads; several CI runs require action and executed zero jobs. Historical two-machine results retain their exact tested revisions. None of that automatically validates this separate stable source package.

For this package, Windows preparation passed 196 focused tests and 31 supplementary tests, relevant typechecks/static checks, and server bundling. The 14 peer tests repeated after formatting overlap those totals. A disposable fresh-home backend exercise passed startup, peer migration, authenticated project API and application RPC with all providers disabled and zero thread/session projections. See [focused evidence](VERIFICATION.json), [runtime evidence](RUNTIME-VERIFICATION.json), and [publication checks](CHECKS.md).

The later selected check passed 536 tests and static checks but failed three Windows fixture operations already present in v0.1.2: two malformed fixture paths and one symlink-permission case. Its aggregate test gate is not green. The release includes formatting-only cleanup in one peer test; production code matches the earlier exercise.

Physical routes/T3 Connect, real provider turns, every client/device, other operating systems, desktop installation, and existing-state upgrades remain unverified for this stable preview. Pending uploads cannot be forwarded as attachments. Only the supported tool set accepts environment targeting. Use owner-trusted environments: later link-origin ownership and per-project grant configuration are not supplied here. Historical key edge-case results from other PR heads are not stable-package acceptance claims.

## Source, installation, and public history

Use the [applied source branch](https://github.com/zainmitchell/t3code/tree/community/native-messaging-v0.1.2) or the [preview Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-messaging-v0.1.2-preview.1). The release includes the patch, manifest, MIT notice, guides, evidence and checksums; GitHub's tag archive contains full patched source. [INSTALL.md](INSTALL.md) explains both paths.

The exact base is official T3 Code v0.1.2, `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. The exercised toolchain was Windows x64, Node 26.12.1 and Vite+ 1.3.0. It needs a source build, not a prompt/skill import, and supplies no desktop installer. PeerLinks adds migration 68 after the released stable history. Custom histories need deliberate integration. Try disposable state first; reversing a patch does not restore an older database.

| Public milestone                                | Record                                                                                             | Scope                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Initial documentation                           | [3a590cdb](https://github.com/zainmitchell/t3code/commit/3a590cdbcb09f759709e694a59affd8febe13966) | Documentation only.                                   |
| Stable source preview                           | [1f21af5c](https://github.com/zainmitchell/t3code/commit/1f21af5ca057b36a6f0fed38df84bb278cc3cfd8) | Source and preview download identity.                 |
| PR map, history, evidence and model attribution | [fb4df062](https://github.com/zainmitchell/t3code/commit/fb4df062d92e644cff7cecac436b22c20fc6e10a) | Documentation; source patch unchanged.                |
| Current explanation/history consolidation       | This guide and its Git history.                                                                    | Documentation; frozen release bytes remain unchanged. |

Useful feedback is a concrete coordination failure, its target revision, or a missing integration dependency. Upstream direction/scope and maintainer acceptance remain separate from fork testing.

## Maintenance, upstream intent, and bug reports

This is a temporary community patch fork for free, self-hosted open-source use. The owner maintains the patches and tracks bugs in [the fork's Issues](https://github.com/zainmitchell/t3code/issues) until T3 ships the capability or a better replacement. The intent is to retire these fork-specific changes as upstream meets the need.

We welcome upstream adoption through maintainer-approved direction and focused contributions. The stable bundle is a distribution unit, not a demand to merge that entire bundle as one upstream PR. This work carries no upstream endorsement, approval, or merge commitment. Reports should identify the source base, patch/version, reproduction, expected and observed behavior, and suitably redacted evidence.

The [MIT notice](LICENSE) must accompany copies or substantial portions. Retain applicable dependency notices when distributing a built application. No paid hosting or application installer is provided by this preview.

## AI models and roles

| Model           | Work credited here                                                                                                                                                                                           | Harness                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Claude Opus 5.5 | Fork implementation/integration work; original T3 source retains its upstream authorship.                                                                                                                    | T3 Code's Claude provider. |
| GPT-6.1 Sol     | Source extraction, limited cleanup, source/evidence and documentation review, focused verification, examples, and publication preparation. Native tick also received a documentation review with this model. | Codex in T3 Code.          |

These credits do not claim a new independent audit of every upstream revision. Historical upstream model credits remain attached to their own PRs. CodeRabbit review of this fork's source has not yet been established; a review request, a bot status, and a completed review are different states.
