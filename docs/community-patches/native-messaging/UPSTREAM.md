# Dependencies and history

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
