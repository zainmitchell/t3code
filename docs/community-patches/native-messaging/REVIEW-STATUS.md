# PR status and revision-specific evidence

PR metadata snapshot: **2026-10-25T20:07:06.624342+00:00**. CI-run lookup: **2026-10-25T20:18:39.720240+00:00**. Follow each checks/CI link for later changes. This page records a snapshot, not continuous monitoring.

| PR                                                       | Head checked                                                                                       | Merge status                            | Build/test CI observed                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [#16653](https://github.com/pingdotgg/t3code/pull/16653) | [`d868b6296`](https://github.com/pingdotgg/t3code/commit/d868b6296c8a24bbc150ebb4d96d264316206099) | Open, unmerged; merge conflicts         | [Build/test jobs present and passing](https://github.com/pingdotgg/t3code/pull/16653/checks)    |
| [#16654](https://github.com/pingdotgg/t3code/pull/16654) | [`071e66164`](https://github.com/pingdotgg/t3code/commit/071e6616495613844a1ff062446e41b4fc586d22) | Open, unmerged; clean merge calculation | [Build/test jobs present and passing](https://github.com/pingdotgg/t3code/pull/16654/checks)    |
| [#16655](https://github.com/pingdotgg/t3code/pull/16655) | [`197930788`](https://github.com/pingdotgg/t3code/commit/197930788c33a086de927374a30e02da4c6336c4) | Open, unmerged; merge conflicts         | [Build/test jobs present and passing](https://github.com/pingdotgg/t3code/pull/16655/checks)    |
| [#16684](https://github.com/pingdotgg/t3code/pull/16684) | [`641ee467a`](https://github.com/pingdotgg/t3code/commit/641ee467aa5ceb9126f7c52e2b8b002bf258e0a4) | Open, unmerged; BLOCKED                 | [No build/test jobs in retrieved rollup](https://github.com/pingdotgg/t3code/pull/16684/checks) |
| [#22445](https://github.com/pingdotgg/t3code/pull/22445) | [`c6f7adcec`](https://github.com/pingdotgg/t3code/commit/c6f7adcecf5dd1e6e4b9e8beab2bc3c364b4249c) | Open, unmerged; UNSTABLE                | [No build/test jobs in retrieved rollup](https://github.com/pingdotgg/t3code/pull/22445/checks) |
| [#22446](https://github.com/pingdotgg/t3code/pull/22446) | [`6d84a1e53`](https://github.com/pingdotgg/t3code/commit/6d84a1e536c1418ea0ff459806e4bd08a5a0b606) | Open, unmerged; UNSTABLE                | [CI: action_required](https://github.com/pingdotgg/t3code/actions/runs/39736203342); 0 jobs     |
| [#22447](https://github.com/pingdotgg/t3code/pull/22447) | [`fc5325405`](https://github.com/pingdotgg/t3code/commit/fc53254058e72f5f262176b6475a75c09033803c) | Open, unmerged; UNSTABLE                | [CI: action_required](https://github.com/pingdotgg/t3code/actions/runs/39736209630); 0 jobs     |
| [#22448](https://github.com/pingdotgg/t3code/pull/22448) | [`c49288085`](https://github.com/pingdotgg/t3code/commit/c49288085b726e96c0d0002936977dc671590dff) | Open, unmerged; UNSTABLE                | [CI: action_required](https://github.com/pingdotgg/t3code/actions/runs/39736215022); 0 jobs     |

All eight PRs were open and unmerged in this snapshot. GitHub's green rollup on the four support PRs includes labeling/CodeRabbit status; it does not establish that build/test CI ran. Their CI workflow results above must be read separately. `action_required` with zero jobs is not an executed test failure. `UNSTABLE` and `BLOCKED` are GitHub merge-state values, not diagnoses of a functional defect. Some original-PR jobs were skipped. A `vouch:unvouched` label concerns contributor trust under upstream policy, not whether a feature works.

## What evidence covers the current support heads?

These are reported results from the linked PR records, not new tests performed by the stable-package publication task:

| Support PR                                                                       | Revision-specific evidence and limits                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#22445](https://github.com/pingdotgg/t3code/pull/22445)                         | Its description identifies current `c6f7adce` as the automatic merge; reports 110 passing checks and two Windows fixture failures also reproduced on pristine main, plus typecheck/static checks.                                             |
| [#22446](https://github.com/pingdotgg/t3code/pull/22446#issuecomment-6334626735) | Current `6d84a1e53`: reports 114 focused tests, typecheck and static checks. The retained existing-worktree membership safeguard is an explicit maintainer review point; no new two-machine claim.                                            |
| [#22447](https://github.com/pingdotgg/t3code/pull/22447#issuecomment-6334627047) | Current `fc5325405`: reports 138 focused tests, typecheck/static checks, and the two relevant replay regressions checked on the combined candidate. No new two-machine claim.                                                                 |
| [#22448](https://github.com/pingdotgg/t3code/pull/22448#issuecomment-6334627496) | Current `c49288085`: reports 264 server tests, four contracts tests, typechecks/static checks, and independent checks of two overlapping launch regressions. Historical two-machine results do not establish runtime acceptance of this head. |

The [top PR description](https://github.com/pingdotgg/t3code/pull/22448) scopes its eight two-machine scenarios to `820e789c3d08b51612a1f244bd829561c8808bbc`. A [later Nightly integration report](https://github.com/pingdotgg/t3code/pull/22448#issuecomment-6324259910) names a different tested integration revision and limits. Preserve those revision boundaries.

The stable v0.1.2 preview is another source target. Its own manifest, checksums, focused tests, three disclosed Windows fixture failures, and disposable backend exercise are the evidence for that download. Neither its results nor historical runtime results automatically validate the latest upstream PR heads.

## How to judge a suspected failure

Use the exact head and a reproducible failed behavior or executed check to identify a defect. An open or closed PR, missing CI execution, a conflict, or a green administrative status alone cannot establish whether the feature works. Maintainer approval and merge acceptance remain separate from functional verification.
