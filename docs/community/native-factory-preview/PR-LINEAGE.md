# Public PR lineage

GitHub primary metadata checked at 2026-10-26T17:23:46.007506+00:00. All47 prior links are retained, with no new PR links added in this update. These are capability relationships and history, not a blanket cherry-pick list. The complete final source is the factory installation unit; module-only revisions are not supported installations.

## Required capability lineage

The separate 3717 messaging patch carries this layer: the implementation from six original commits of #16653 to #16684 with public attribution, the support diff from #16684 to #22448, two later fixes from the stable branch, and one commit that limits linked-environment targeting to nine messaging tools. The support PRs 22445 to 22448 target their originals 16653, 16654, 16655 and 16684. They support those heads; they are not four extra layers to apply.

| PR                                                       | Purpose                                                                  | Current state      | Head                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------ | ------------------------------------------ |
| [#16653](https://github.com/pingdotgg/t3code/pull/16653) | feat(server): /mcp narrows a client's modes from T3-Mode-Limit           | Open, not merged | `56f88be97c37c5241b13bea95721049aa02fe049` |
| [#16654](https://github.com/pingdotgg/t3code/pull/16654) | feat(server): t3_thread_launch takes clientRequestId                     | Open, not merged | `8a5f64e971a8aac57c6c87c263857e7d22d17f84` |
| [#16655](https://github.com/pingdotgg/t3code/pull/16655) | feat(server): link to another environment                                | Open, not merged | `25835af4375ebc2a7eaff8643ad6102ba22a7800` |
| [#16684](https://github.com/pingdotgg/t3code/pull/16684) | feat(server): agents use linked environments through any T3 tool         | Open, not merged | `7c2dfcb51981eea652abe6514208bc3dc40ba4d6` |
| [#22445](https://github.com/pingdotgg/t3code/pull/22445) | fix(server): integrate mode limits with current main                     | Closed, not merged | `c6f7adcecf5dd1e6e4b9e8beab2bc3c364b4249c` |
| [#22446](https://github.com/pingdotgg/t3code/pull/22446) | fix(server): integrate launch retry keys with current main               | Open, not merged | `b81fe3355762be5341e3a3640e4374e8d90fc822` |
| [#22447](https://github.com/pingdotgg/t3code/pull/22447) | fix(server): integrate peer links with current main                      | Open, not merged | `2205c04d8c1f59c7cd6f33acbbc17ace9d5a4edc` |
| [#22448](https://github.com/pingdotgg/t3code/pull/22448) | fix(server): integrate native linked-environment tools with current main | Open, not merged | `b795bc23883fd0c1670470e895af9473bf23a951` |

## Already in official 3669 and 3717

These changes are ancestors of official 3669, which 3717 contains. Do not reapply them as unmerged dependencies.

| PR                                                       | Purpose                                                          | Current state | Head                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------- | ------------------------------------------ |
| [#24737](https://github.com/pingdotgg/t3code/pull/24737) | fix(server): use Codex native collaboration modes                | Merged | `d123ca6a5d4caa9e6168c2087922930dcfeec652` |
| [#24782](https://github.com/pingdotgg/t3code/pull/24782) | fix(server): running task results tell the agent to end its turn | Merged | `314236a7b266845b8b3d1f649a8b4150db9a3fe2` |
| [#24784](https://github.com/pingdotgg/t3code/pull/24784) | feat(server): thread tools return a ready t3-thread link         | Merged | `d2bcefc3cc0d1407dcaa008843f81160b728258e` |
| [#24836](https://github.com/pingdotgg/t3code/pull/24836) | fix(server): publish committed events before writer cancellation | Merged | `94563487b31a358e9ff24b4ef7350bf3f66403bc` |
| [#24850](https://github.com/pingdotgg/t3code/pull/24850) | feat(server): cut T3's agent instructions and tool copy by 60%   | Merged | `80053974a161d23cd337ac70ccfbadd8099efef3` |

## Optional UI and wider workflow proposals

These are related remote UI, delegation, transfer and handoff proposals. They are not all required to evaluate a local factory, and their newest heads are not promised to merge unchanged.

| PR                                                       | Purpose                                                                 | Current state    | Head                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | ------------------------------------------ |
| [#16695](https://github.com/pingdotgg/t3code/pull/16695) | feat(server): work a linked environment starts stays within its link    | Open, not merged | `47ede02f8832b3b9a08283ca672fbade49a05bf0` |
| [#16698](https://github.com/pingdotgg/t3code/pull/16698) | feat(web,mobile): linked environments in Connections                    | Open, not merged | `ab3252d2bd4d32722a88ee641006c0b8ebc03f65` |
| [#16719](https://github.com/pingdotgg/t3code/pull/16719) | feat(server): delegate_task to a linked environment                     | Open, not merged | `8674123e797a459f16f15b911445227348ca7e2d` |
| [#16731](https://github.com/pingdotgg/t3code/pull/16731) | feat(server): t3_thread_import, conversation only                       | Open, not merged | `9367e9b73aa4787e225de708b775fe53765265b6` |
| [#16734](https://github.com/pingdotgg/t3code/pull/16734) | feat(server): package and apply a thread's git work                     | Open, not merged | `9b213565f4af48659c8e4641f4d5448c266b7155` |
| [#16751](https://github.com/pingdotgg/t3code/pull/16751) | feat(server): hand a thread off to a linked environment                 | Open, not merged | `f38d31b7117a37df23ff435b5a702c31cde743d4` |
| [#16758](https://github.com/pingdotgg/t3code/pull/16758) | feat(web,mobile): Continue on… a linked environment                     | Open, not merged | `7fddea06d7aa41b05c2e9d91b13d464747861a3b` |
| [#17129](https://github.com/pingdotgg/t3code/pull/17129) | feat(server,web,mobile): an agent sets up a link to another environment | Open, not merged | `c208865cedad1f5300b0a80a230d955f7acf5ae8` |
| [#17130](https://github.com/pingdotgg/t3code/pull/17130) | feat(web,mobile): @-mention a machine as a context chip                 | Open, not merged | `e783aa06406112d9c1dfa62905754f5b5e169e77` |

## Closed replacement lineage

Closed without merge means historical lineage. Use the current source delta, not a stack of replaced PR heads.

| PR                                                       | Purpose                                                          | Current state      | Head                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| [#21459](https://github.com/pingdotgg/t3code/pull/21459) | fix(server): reuse caller-scoped thread launch receipts          | Closed, not merged | `744e01f99528891fc638aeb2fb12ee73b93654d4` |
| [#21670](https://github.com/pingdotgg/t3code/pull/21670) | feat(server): cap outside MCP calls to the forwarded agent modes | Closed, not merged | `48c6bf4ce66fe11dca0597c6a4a4aa59c65a2fb8` |
| [#21671](https://github.com/pingdotgg/t3code/pull/21671) | fix(server): replay accepted keyed MCP thread launches           | Closed, not merged | `ebba131607e20705643a10a79e2afc483962af00` |
| [#21672](https://github.com/pingdotgg/t3code/pull/21672) | feat(server): persist outgoing links to peer environments        | Closed, not merged | `84a4f73b9ec721840534d00b15084f7c997a7441` |
| [#21673](https://github.com/pingdotgg/t3code/pull/21673) | feat(server): route agent tools through linked environments      | Closed, not merged | `001ecbed8a0214b4d3788563a3a3d01488841bbc` |

## Other factory history

All 18 PRs below belong to the existing original-solutions public effort. They are source context, not dependencies or code copied into this preview. Closure does not establish quality rejection or abandonment.

| PR                                                       | Purpose                                                                                | Current state      | Head                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| [#19850](https://github.com/pingdotgg/t3code/pull/19850) | Factory skeleton: an empty FactoryLayer wired in through one seam                      | Closed, not merged | `0aadcf1c74203661b2723ce5be04b5af60c63eb8` |
| [#19865](https://github.com/pingdotgg/t3code/pull/19865) | Adapter: find a project, launch a thread and read its status in-process                | Closed, not merged | `24a0161ce9f5de2d98b3c38a92e163dc0ac32a6e` |
| [#19866](https://github.com/pingdotgg/t3code/pull/19866) | Config: the factory's machine config and a repo's factory block                        | Closed, not merged | `7265e29d6768876bfaf88f3a6ec691acd63bd74a` |
| [#19873](https://github.com/pingdotgg/t3code/pull/19873) | Daily sync merges upstream's newest nightly tag through a pull request                 | Closed, not merged | `159886a614e1d9bbb9d82ddd1e26c6cbf7747022` |
| [#19884](https://github.com/pingdotgg/t3code/pull/19884) | Adapter: tell the factory when a thread's run changes status                           | Closed, not merged | `5b213043c1a662f08a24a5797497c6b431290e0e` |
| [#19886](https://github.com/pingdotgg/t3code/pull/19886) | GitHub: issue reads and writes through the gh CLI                                      | Closed, not merged | `4d396f53c9dcb384a3cce6893c59f9c82ccda13d` |
| [#19893](https://github.com/pingdotgg/t3code/pull/19893) | GitHub: pull request reads and writes                                                  | Closed, not merged | `44cd981e314586d49e96b3bc63d3a1987330b42a` |
| [#20040](https://github.com/pingdotgg/t3code/pull/20040) | GitHub: the approval rule and blockers                                                 | Closed, not merged | `f96097b2e0865aaa6c23cf5145b509060a8addf4` |
| [#20083](https://github.com/pingdotgg/t3code/pull/20083) | Pass loop: claim ready issues fairly                                                   | Closed, not merged | `641145bfcf592dcbdd718c9fd10094e87c7d987f` |
| [#20136](https://github.com/pingdotgg/t3code/pull/20136) | A cut-short release comments unless this claim was already explained                   | Closed, not merged | `af3aa00b271135f7f0075193b30b0ccec646a913` |
| [#20137](https://github.com/pingdotgg/t3code/pull/20137) | Cut-short scan stops re-reading label history for issues it never acts on              | Closed, not merged | `ac95256fd044ac61b7c46aed63aba52d0a95218c` |
| [#20168](https://github.com/pingdotgg/t3code/pull/20168) | Gating: a passing gate opens the PR for review, a failing one goes back to the session | Closed, not merged | `7d727fcf96ce8bbf883385ebcff5da390ede39c2` |
| [#20176](https://github.com/pingdotgg/t3code/pull/20176) | Factory route layer behind T3's authentication                                         | Closed, not merged | `dfe3aa5f89e53183853fbf3c338ed8aa0e8750fb` |
| [#20179](https://github.com/pingdotgg/t3code/pull/20179) | Recovery: roll back an install that does not come up, and a hand-back runbook          | Closed, not merged | `51fe118b362ec0e31f54c3ee355d774e45e5acc7` |
| [#20181](https://github.com/pingdotgg/t3code/pull/20181) | Needs attention: keep a list of what needs a person and notify on the Mac              | Closed, not merged | `85a781742dbf8deb52aaf775626ae7301d6018a4` |
| [#20197](https://github.com/pingdotgg/t3code/pull/20197) | Design doc: record the settled seams, decisions and issue list                         | Closed, not merged | `5aa7daa3b25a7b5fd678608a772a97087a78a57e` |
| [#20202](https://github.com/pingdotgg/t3code/pull/20202) | Rotate the t3fac log so it stops growing                                               | Closed, not merged | `40b0e2efef2a700750f374cf88696f969dd41706` |
| [#20381](https://github.com/pingdotgg/t3code/pull/20381) | CI: run Linux jobs on Jog runners                                                      | Closed, not merged | `333230dad8390639c1c1e592e8b0d6397cbe66b7` |

## Separate stable previews

These fork-local review PRs target v0.1.2. They are separate from this nightly 3717 factory. Their latest fixes and the versioned preview asset bytes must not be conflated. No combined runtime or all-green remote CI is claimed.

| PR                                                  | Purpose                                                      | Current state    | Head                                       |
| --------------------------------------------------- | ------------------------------------------------------------ | ---------------- | ------------------------------------------ |
| [#1](https://github.com/zainmitchell/t3code/pull/1) | feat(server): review native messaging integration for v0.1.2 | Open, not merged | `40947bc8f55f4ac918bf16febb1be56856bf8cee` |
| [#2](https://github.com/zainmitchell/t3code/pull/2) | feat(server): review native model-free ticks for v0.1.2      | Open, not merged | `79be1b2d558969bc7c17d2a0b878fad970c74725` |

## Current linked-environment work in the 3717 series

Original [PR #16684](https://github.com/pingdotgg/t3code/pull/16684) remains open at `7c2dfcb51981eea652abe6514208bc3dc40ba4d6`. The sequence [54f81682](https://github.com/pingdotgg/t3code/commit/54f81682dca57213d34a325db4a4686f0d6cf7ff), [94785ca8](https://github.com/pingdotgg/t3code/commit/94785ca8a627c6700a3884e29cb17f57c4a2a64a) and [7c2dfcb5](https://github.com/pingdotgg/t3code/commit/7c2dfcb51981eea652abe6514208bc3dc40ba4d6) is public work by Julius Marminge, with Claude Opus 5.5 co-author notices. It has not merged into main.

Unlike the 3669 preview, which pinned an earlier explicit-forwarding implementation, the 3717 messaging patch includes code from all three commits, with Julius/Claude attribution retained. It keeps the central routing for tools that declare a linked-environment target, then a separate commit declares that target only on the nine messaging tools the stable patch reviewed. Linked project create and clone, and the broader set of thread, queue, schedule, pull request and worktree tools, are later upstream lineage and are not enabled here. The new release history is reconstructed as four public-base component commits; it does not claim those original commits as new ancestors.

[Support #22445](https://github.com/pingdotgg/t3code/pull/22445) was closed because its candidate had no remaining change against the author's updated mode-limit base. That closure is not an upstream merge or a maintainer approval. The other originals and supports remained open when checked.

[PR #17129](https://github.com/pingdotgg/t3code/pull/17129) adds agent-assisted link setup through an owner card, plus unlinking. [PR #17130](https://github.com/pingdotgg/t3code/pull/17130) adds machine context chips on web/mobile. They are optional later layers. Neither is required for a local factory, and neither is included merely because it descends from the linked-environment stack.

The catalog now retains 47 links, including these two later layers. It is a dated, scoped catalog, not a permanently complete list. The 18 other-fork closed upstream PRs remain history, not evidence of quality rejection or abandonment. Stable messaging and tick keep their separate v0.1.2 source identities.
