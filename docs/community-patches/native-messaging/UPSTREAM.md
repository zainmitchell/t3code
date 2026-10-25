# Upstream work and integration scope

This community preview integrates existing T3 work with selected reliability changes on the exact stable v0.1.2 source base. It does not originate the underlying native thread-control or linked-environment design. The complete delivered code delta is identified by MANIFEST.json and the source-patch checksum.

## Upstream PR dependencies and support fixes

| Required feature layer          | Original feature PR                                      | Support/integration PR                                   | What the layer supplies                                                              |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Caller mode limits              | [#16653](https://github.com/pingdotgg/t3code/pull/16653) | [#22445](https://github.com/pingdotgg/t3code/pull/22445) | Runtime and interaction ceilings for forwarded calls.                                |
| Launch request keys             | [#16654](https://github.com/pingdotgg/t3code/pull/16654) | [#22446](https://github.com/pingdotgg/t3code/pull/22446) | Recover accepted launches on retry, with caller and worktree validation.             |
| Peer links                      | [#16655](https://github.com/pingdotgg/t3code/pull/16655) | [#22447](https://github.com/pingdotgg/t3code/pull/22447) | Pairing, credentials, storage, MCP client, migration 68, and response/cleanup fixes. |
| Native linked-environment tools | [#16684](https://github.com/pingdotgg/t3code/pull/16684) | [#22448](https://github.com/pingdotgg/t3code/pull/22448) | Native-tool forwarding plus Stop, validation, and wire-codec fixes.                  |

The original feature order is mode limits → launch request keys → peer links → native-tool forwarding. Each support PR targets its matching original feature branch. These are paired feature/support routes, not eight independent patches to apply sequentially. Current PR heads can advance independently; this table is not a verified cherry-pick recipe for current main.

For the published v0.1.2 preview, the selected supporting changes are already bundled in the single source patch. No separate PR application is required. Do not apply these PRs on top of that download. The preview is a reduced, version-pinned integration, not an assertion that it contains every change in the latest PR heads. The evidence attached to a newer PR head does not automatically validate this stable package.

The later replacement stack [#21670](https://github.com/pingdotgg/t3code/pull/21670), [#21671](https://github.com/pingdotgg/t3code/pull/21671), [#21672](https://github.com/pingdotgg/t3code/pull/21672), and [#21673](https://github.com/pingdotgg/t3code/pull/21673) was closed without merge. The [closure explanation](https://github.com/pingdotgg/t3code/pull/21673#issuecomment-6301888964) says the maintainer retained the original stack. This preview creates no replacement PR and requests no merge of the older closed stack.

The package is a reduced source integration, not a byte-for-byte copy of the current PR heads or the full cross-environment stack. It includes launch-retry, forwarded-limit, Stop-retry, and peer response/cleanup changes present in its recorded source snapshot. Tests and runtime evidence here apply to this package, not to every upstream PR revision.

## What must be applied

For the exact official v0.1.2 base, all supporting changes in this package are bundled in one patch. Do not apply the linked PR stack in addition to this ZIP. It needs no native tick or software factory patch and introduces no new dependency manifest or lockfile.

Both participating servers need compatible code for forwarded limits. Link access caps runtime and interaction modes. Use owner-trusted environments; this reduced package does not provide the later link-origin ownership layer or per-project grant configuration. Peer-link migration 68 must fit the destination's migration history.

The later [link-origin layer #16695](https://github.com/pingdotgg/t3code/pull/16695), linked-environment UI, remote `delegate_task`, conversation import, and thread handoff are outside this package. A remote top-level launch does not become a delegated child with automatic result delivery. A separate 3669 package remains a different, unfinished target.

Original upstream design and implementation are credited through the PRs above. The owner reports Opus-generated additions; this preparation used GPT-6.1 Sol through Codex for extraction, small cleanup, verification, examples, and documentation. The full upstream MIT copyright and permission notice is retained in LICENSE. This community release carries no maintainer endorsement.

Related feature discussions include [launch request keys #16186](https://github.com/pingdotgg/t3code/discussions/16186) and [Claude-specific cross-machine messaging #16230](https://github.com/pingdotgg/t3code/discussions/16230). This version-pinned preview shares integration and verification evidence; it does not open a competing feature PR.
