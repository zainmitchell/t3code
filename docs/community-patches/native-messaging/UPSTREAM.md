# Upstream work and integration scope

This community preview integrates existing T3 work with selected reliability changes on the exact stable v0.1.2 source base. It does not originate the underlying native thread-control or linked-environment design. The complete delivered code delta is identified by MANIFEST.json and the source-patch checksum.

## Existing upstream PRs

The core upstream route is the original stack, checked on 2026-10-25:

| PR                                                       | Role                                                                     | Observed status |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| [#16653](https://github.com/pingdotgg/t3code/pull/16653) | Forwarded runtime and interaction ceilings through `T3-Mode-Limit`.      | Open, unmerged. |
| [#16654](https://github.com/pingdotgg/t3code/pull/16654) | Caller-scoped `clientRequestId` for native top-level launches.           | Open, unmerged. |
| [#16655](https://github.com/pingdotgg/t3code/pull/16655) | Outgoing environment links, OAuth pairing, storage, CLI, and MCP client. | Open, unmerged. |
| [#16684](https://github.com/pingdotgg/t3code/pull/16684) | Native tool targeting and forwarding to a linked environment.            | Open, unmerged. |

The later replacement stack [#21670](https://github.com/pingdotgg/t3code/pull/21670), [#21671](https://github.com/pingdotgg/t3code/pull/21671), [#21672](https://github.com/pingdotgg/t3code/pull/21672), and [#21673](https://github.com/pingdotgg/t3code/pull/21673) was closed without merge. The [closure explanation](https://github.com/pingdotgg/t3code/pull/21673#issuecomment-6301888964) says the maintainer retained the original stack. Existing support PRs [#22445](https://github.com/pingdotgg/t3code/pull/22445), [#22446](https://github.com/pingdotgg/t3code/pull/22446), [#22447](https://github.com/pingdotgg/t3code/pull/22447), and [#22448](https://github.com/pingdotgg/t3code/pull/22448) target those original layers. This preview creates no replacement PR and requests no merge of the older closed stack.

The package is a reduced source integration, not a byte-for-byte copy of the current PR heads or the full cross-environment stack. It includes launch-retry, forwarded-limit, Stop-retry, and peer response/cleanup changes present in its recorded source snapshot. Tests and runtime evidence here apply to this package, not to every upstream PR revision.

## What must be applied

For the exact official v0.1.2 base, all supporting changes in this package are bundled in one patch. Do not apply the linked PR stack in addition to this ZIP. It needs no native tick or software factory patch and introduces no new dependency manifest or lockfile.

Both participating servers need compatible code for forwarded limits. Link access caps runtime and interaction modes. Use owner-trusted environments; this reduced package does not provide the later link-origin ownership layer or per-project grant configuration. Peer-link migration 68 must fit the destination's migration history.

The later [link-origin layer #16695](https://github.com/pingdotgg/t3code/pull/16695), linked-environment UI, remote `delegate_task`, conversation import, and thread handoff are outside this package. A remote top-level launch does not become a delegated child with automatic result delivery. A separate 3669 package remains a different, unfinished target.

Original upstream design and implementation are credited through the PRs above. The owner reports Opus-generated additions; this preparation used GPT-6.1 Sol through Codex for extraction, small cleanup, verification, examples, and documentation. The full upstream MIT copyright and permission notice is retained in LICENSE. This community release carries no maintainer endorsement.

Related feature discussions include [launch request keys #16186](https://github.com/pingdotgg/t3code/discussions/16186) and [Claude-specific cross-machine messaging #16230](https://github.com/pingdotgg/t3code/discussions/16230). This version-pinned preview shares integration and verification evidence; it does not open a competing feature PR.
