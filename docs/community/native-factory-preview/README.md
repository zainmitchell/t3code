# Native software factory source preview for nightly 3669

This community extension connects tracker work to native T3 execution, a separate review of an implementation head, correction and rework, and guarded integration. Models do the reasoning and coding. The T3 server records ownership, capacity, outcomes and operations between those stages.

This is an experimental source preview over [official nightly 3669](https://github.com/pingdotgg/t3code/tree/5f64c5eb299a23d278ef043c416bd4dc801bc53c), commit `5f64c5eb299a23d278ef043c416bd4dc801bc53c`. It is intended for developers evaluating the mechanism in disposable environments. Full lifecycle acceptance is unfinished. It is separate from the stable v0.1.2 messaging and tick previews.

Only the complete final source is installable. The four ordered patches separate messaging modules, command-job/tick modules, factory modules and shared runtime integration for review and application. Module patches are not separate supported installations. The series manifest records every exact base, intermediate revision and dependency.

The distribution contains the complete source tree, the ordered component patches and checksums. [Installation](INSTALL.md), [dependencies](DEPENDENCIES.md), [PR lineage](PR-LINEAGE.md), and [verification](VERIFICATION.md) describe what is included and what has actually been checked. Release notes identify the exact final commit and tree.

## Who this helps

Several coding threads still need someone to track which issue owns each worker, whether background work occupies capacity, which commit a reviewer accepted, and whether an interrupted merge already happened. Reconstructing those relationships through repeated coordinator prompts can lose facts or duplicate work.

The connector puts those relationships in native server state. A generic eligible tracker item can reserve capacity, verify a claim and start a worker in a worktree. A separately admitted reviewer reports about the implementation head it was given. Failed review produces a correction specification and rework. A passing review permits the configured integration path. Closing a tracker item is a separate native operation.

These are implemented relationships. A reported verdict does not prove review quality or that a bounded work unit satisfies an entire issue. Do not treat this preview as an accepted unattended deployment.

## Events, stages and workspaces

The factory reconciles at startup, on server events and, if configured, on a clock. Its collector reads tracker facts and recorded outcomes, derives the next stage and invokes a pinned one-shot policy command. That command receives structured facts on stdin and returns structured decisions on stdout. It may admit work, reserve an owner decision, decline work, or answer an integration/closure gate.

Agent stages are implementation, review, correction specification and rework. Integration and closure are T3 operations. Decisions bind the observation, policy/configuration revision, brief, capacity pool, model selection and workspace strategy. Changed facts require another decision basis. The shared launch and preparation paths carry that identity into ordinary T3 threads and worktrees.

Native stores retain observations, decisions, reservations, claims, execution generations, outcomes, transfers and external-operation receipts. The event sink commits orchestration facts and effects before the effect worker performs I/O. Reconciliation uses those records to find an operation whose response was lost.

## Claims and capacity

GitHub claims bind a verified account, request nonce, comment identity and body to native evidence. The first provider start revalidates the claim. An ambiguous comment-create response holds work until readback resolves it. A label or the account name alone does not establish ownership.

Capacity is a reservation in the local database. Native descendants, observed foreign claims and transferred legacy workers can occupy units. A turn ending does not free a unit while process custody or a required result remains unresolved. Local transactional reservation tests do not make GitHub a global compare-and-set lock. Use one claim writer per repository unless a handover has been proved.

The generic transfer service fences a legacy command job and waits for its last pass to stop before adopting recorded work. That does not prove that an external process or its descendants stopped. Unknown custody stays held. Deployment-specific receipt import and retirement parsing is omitted from this public derivative. Legacy controller retirement remains open.

## Review and integration

Workers report through `t3_factory_report`; the caller's thread comes from the MCP invocation. The server verifies the outcome against its admitted execution and applicable Git/tracker readback. Review reports must name the admitted head. Later work, explicit rejection and typed failure affect the recorded next stage.

Direct Git integration uses the expected target tip in a compare-and-set update. PR integration publishes the reviewed head, opens or reads the corresponding PR, observes host protection and requests merge at that head. A configured acceptance status is posted on the reviewed head after native review passes. Integration intent and readback are separate from the worker's prose and from issue closure.

When host protection blocks a PR and no pending or failed check explains it, the current source reads review findings. A changes-requested review on exactly the admitted head becomes a correctable failure. It includes bounded excerpts of current unresolved conversations and excludes collapsed tooling logs. Stale-head requests, missing approvals, unreadable responses and partial review pages keep waiting. Fixtures prove this routing; the available live observation does not complete a rework/review/integration cycle.

An externally reopened tracker item now displays as reopened and waits for its owner; the factory preserves the recorded closure and does not restart its lineage. Rejecting an outcome that already affected integration still does not undo that effect, although a tool description overstates the behavior. This remains a product limitation.

## Work without an idle coordinator model

Native reconciliation can read tracker state, account for reservations and receipts, select the next stage and reconcile integration or closure without a model turn asking whether a worker finished. An idle configured clock still causes host work and tracker API calls. Policy commands remain trusted executable code.

Implementation, review, correction and rework use the configured providers and models. Owner decisions still require owners. This preview does not establish final-source enabled-idle behavior, restart/no-duplicate behavior or all lifecycle journeys.

## Controls and trust boundaries

Owners can inspect and act through Settings → Factories on web/desktop, the mobile settings route, or owner-authorized MCP methods. Agent threads cannot answer their own owner gates. Finite grants name an item, stage and evidence, and are consumed in the admission commit. RPC permission checks apply at the destination environment.

The policy executable, repository setup commands and permitted provider tools run with the host authority configured for them. A pinned policy digest detects changed bytes; it does not sandbox the policy. Tracker comments and model reports are inputs, not permission grants. Keep credentials in the environment's supported secret store. No credentials, project policies, real tracker state or databases are included in this release.

The containment implementation uses Windows job objects. Existing demonstrations establish Windows descendant containment for their tested source and cases. They do not establish cross-platform containment. Claude, Codex and Muse have explicit process-join hooks; other providers do not acquire an equivalent guarantee merely because they appear in a model picker. Remote, relay, tunnel, multi-device and every client path have not all been proved.

## Reuse and disabling

Apply the whole ordered series to its exact base, or use the complete source archive. The dependency manifest names the contract, service, migration and client changes. Do not assemble the preview by cherry-picking every PR in the lineage catalog. Official 3669 already includes merged MCP support; the patch carries the additional behavior it needs. The preview has the earlier explicit forwarding handlers for supported thread calls, project listing and capabilities. Later upstream work broadens forwarding to project create/clone and tools declaring thread/project/queue environment targets. That later work is not silently included here; [PR lineage](PR-LINEAGE.md) identifies its authors and current unmerged heads.

The standalone tick remains independently useful. This factory has its own reconciliation loop and does not require the stable tick preview as another scheduler. Shared command-job fences and transfer support are included in the patch. The latest stable messaging/tick fixes have not been qualified as one combined runtime with this frozen factory.

Configure factories paused initially. Replace a factory document with `enabled: false`, its exact checksum and the current expected revision to pause new admissions. Read back state and account for existing reservations before retiring processes or removing an environment. Pausing is not proof that already-running workers stopped. [Installation](INSTALL.md) describes a disposable setup and its refusal checks.

## Existing work and useful feedback

The [original-solutions factory fork](https://github.com/original-solutions/t3code-factory/tree/050bf7c8ed0cfa68fc2b6e3b3b8bce2a5ce2a9dd) already runs a native factory over the same official base. Its [guide](https://github.com/original-solutions/t3code-factory/blob/050bf7c8ed0cfa68fc2b6e3b3b8bce2a5ce2a9dd/factory/README.md) and source are useful prior work. No code from that fork was copied for this derivative, and it is not an installation dependency.

Both approaches avoid an idle coordinator model. That fork has a sessions adapter, approval-history rules, clean merged-tree command gates, a JSONL ledger and operating views. This connector retains native database reservations, custody, explicit review/correction stages and native integration operations. Those models have different assumptions and maintenance costs. Neither comparison nor a closed upstream PR proves quality rejection, abandonment or complete product acceptance. All 18 related closed PRs are listed as history in the catalog.

Related proposals include [configurable pipelines #6818](https://github.com/pingdotgg/t3code/discussions/6818) and [persistent initiatives #16269](https://github.com/pingdotgg/t3code/discussions/16269). Feedback on the smallest useful integration boundary, competing claims, held capacity, stale reviewed heads, ambiguous remote writes, restart during integration and owner refusal would help. Full lifecycle acceptance, final-source restart/no-duplicate/idle proof, web/mobile verification and legacy-loop retirement remain open.

Feature proposals belong in T3's Ideas discussions under its current [contribution policy](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md). An upstream feature PR needs explicit maintainer agreement on direction and scope. This community publication creates no upstream PR or endorsement.

## Attribution and license

Prepared for publication by [zainmitchell](https://github.com/zainmitchell). The owner reports that Claude Opus 5.5 through T3 Code's Claude provider authored the additions on T3 source. GPT-6.1 Sol through Codex in T3 Code performed source review, privacy scrubbing, focused verification and release preparation. The linked-environment stack also has original upstream work by Julius Marminge, with Claude Opus 5.5 attribution in the current public commits. Those current heads are identified separately from the earlier implementation included in this patch. These credits do not claim an independent review of every commit or any new bot review.

The source retains T3 Tools Inc.'s MIT notice and upstream notices. [NOTICES.md](NOTICES.md) identifies the patched SDK and source distribution boundary. This is a free, self-hosted community preview, maintained only while it is useful ahead of an upstream capability or a better replacement.
