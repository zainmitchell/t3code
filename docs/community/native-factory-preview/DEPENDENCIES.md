# Dependency and migration manifest

The only supported base is official nightly 3717, commit `1316d48b0c68151afd8b47eb0c11a114cf0b4daa`. The factory needs the native messaging patch for that base. Apply the four parts in order. Only the last revision is installable; the earlier revisions are review and apply boundaries, not build targets.

The four component patches are messaging, command-job/tick modules, factory modules, and shared integration. `PATCH-SERIES.json` in the release assets records their exact public base, intermediate commits/trees, patch checksums and order. The complete combined patch from the official base and factory-over-messaging patch reproduce the same final tree. The manifest identifies the exact public source and every review/apply boundary; it does not establish validation acceptance.

The messaging layer preserves the pinned public candidate's behavior, including its nine-tool forwarding limit. The factory module and shared integration layers add verified-artifact review bases and owner-decision cards. The series retains shared runtime coupling. Module-only revisions are not supported installations.

## Why the parts cannot be installed separately

Parts 1 and 2 add new files only. Nothing registers them until part 3, so a build of those revisions does not start the factory. Part 3 edits shared files that the messaging patch also changes, such as tool access, orchestration, the event sink and launch preparation, so it applies only on top of messaging. The command-job modules are generic, but this series wires them only for the factory's fences and transfers. A standalone tick still needs its own patch.

## Migrations

| ID  | Name                        | Source                                                |
| --- | --------------------------- | ----------------------------------------------------- |
| 68  | ShellStopRequestIndex       | Official 3717                                         |
| 69  | ThreadMessageSearch         | Official 3717                                         |
| 70  | PeerLinks                   | Messaging patch, the same number upstream #16684 uses |
| 71  | FactoryLifecycle            | Factory                                               |
| 72  | FactoryExecutionGenerations | Factory                                               |
| 73  | FactoryOutcomes             | Factory                                               |
| 74  | FactoryTransfers            | Factory                                               |

The historical [3669 preview](https://github.com/zainmitchell/t3code/releases/tag/community-native-factory-nightly3669-preview.1) numbered these differently: 68 PeerLinks, 69 ShellStopRequestIndex, 70 to 73 factory and 74 ThreadMessageSearch. The migrator skips every ID up to the highest one recorded, so 3717 refuses a database with that history at startup instead of skipping schema. There is no in-place upgrade from a 3669 preview database or a stable v0.1.2 messaging database. An official 3669 or 3717 database records 68 and 69 the same way as this series, so migrations 70 to 74 would run on it, but that upgrade was not exercised. Start with a new T3 home, back up anything older, and keep it separately.

## Dependency closure

| Area                     | What the series needs                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factory domain           | Everything under `apps/server/src/factory/`. Claims, reservations, collection, policy, execution generations, custody, outcomes, transfers and native operations share persisted identities.                                             |
| Launch and orchestration | The orchestrator, event sink, projections, outbox and effect worker, launch and preparation, provider start and recovery, Stop and PR watch changes keep execution ownership through retries and descendants.                            |
| Command jobs             | The runner, writer fence, scheduled tasks and CLI wiring provide the fences and transfers. They do not install the separate stable tick preview.                                                                                         |
| MCP and authorization    | Invocation context, tool access, toolkits, RPC authorization and WebSocket handlers carry caller authority and expose the factory services. A factory-owned thread cannot start executions in a linked environment.                      |
| Process containment      | `process/custody`, the Claude, Codex and Muse joins, the shared `ExecutionJoin`, and terminal and checkpoint ownership. Supported containment is Windows-only.                                                                           |
| Contracts                | Factory contracts, orchestration schema changes, RPC methods, guarded permissions and tool summaries. Keep server and clients on the same source.                                                                                        |
| Clients                  | Client-runtime state and factory decisions. The web Settings route, sidebar, search and generated router, and the mobile settings, navigation and search use those contracts. Desktop wraps the web client and needs no separate change. |
| GitHub adapter           | Typed merge and readback support in `source-control-github` for PR integration.                                                                                                                                                          |
| Packaging                | Workspace exports, knip entries, the Muse SDK patch and its matching lockfile patch hash. The patch and its lockfile entry must move together. No package version changes.                                                               |

Use Node 26.12.1, pnpm 12.14.0 and Vite+ 1.4.0. Effect and its platform and test packages stay at 4.0.5. `@muse-code/sdk` stays at 1.4.6; its patch adds process-spawn observation alongside the existing process-exit observation.

## What the 3717 port changed from the 3669 source

- The 3669 integration carried an older fork version of native messaging. The port keeps the 3717 messaging patch instead and applies only the factory and command-job changes in the files both touch.
- The factory migrations moved from 70 to 73 to 71 to 74.
- Claude's query runner keeps 3717's Windows spawn and process-exit tracking and gains the factory's container join.
- Factory code follows 3717's newer Effect rules: `Effect.fn` for reusable service methods, `Effect.succeedNone` and `Effect.asSome`, and `Effect.filterOrElse`.
- Left out because they are not factory work: a change to the repository's `check-changed` script, a Windows path fix in an unrelated integration test, rewritten upstream test fixture text, and fork wording in messaging tool descriptions.

There are no shipped project policies, factory configurations, accounts, tracker repositories, provider credentials or deployment scripts. The fixture policy is test input, not an operational recommendation. Deployment-specific legacy retirement parsing is not included; the generic transfer and owner recovery paths are.
