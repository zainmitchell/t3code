# Native software factory source preview for nightly 3717

This community extension connects tracker work to native T3 execution, a separate review of an implementation head, correction and rework, and guarded integration. Models do the reasoning and coding. The T3 server records ownership, capacity, outcomes and operations between those stages.

It is an experimental source preview over [official nightly 3717](https://github.com/pingdotgg/t3code/tree/1316d48b0c68151afd8b47eb0c11a114cf0b4daa), commit `1316d48b0c68151afd8b47eb0c11a114cf0b4daa`. It ports the [nightly 3669 preview](https://github.com/zainmitchell/t3code/releases/tag/community-native-factory-nightly3669-preview.1) to that newer base. It is for developers evaluating the mechanism in disposable environments. Full lifecycle acceptance is unfinished.

The factory builds on the separate native messaging patch for 3717. Apply messaging first, then the three factory components. Only the complete final source is installable. [Dependencies](DEPENDENCIES.md), [installation](INSTALL.md), [PR lineage](PR-LINEAGE.md) and [verification](VERIFICATION.md) give the exact revisions, order and checks.

This local candidate has not been published or qualified as a new release. The required affected-file gate is blocked by the preparation host's Application Control rejection of the installed Vite+ native module. See [verification](VERIFICATION.md). Prospective download names are not live URLs.

## Who this helps

Several coding threads still need someone to track which issue owns each worker, whether background work occupies capacity, which commit a reviewer accepted, and whether an interrupted merge already happened. Reconstructing those facts through repeated coordinator prompts can lose them or duplicate work.

The factory keeps those relationships in native server state. An eligible tracker item can reserve capacity, verify a claim and start a worker in a worktree. A separately admitted reviewer reports on the implementation head it was given. A failed review produces a correction specification and rework. A passing review permits the configured integration path. Closing a tracker item is a separate native operation.

These relationships are implemented. A reported verdict does not prove review quality, or that a bounded work unit satisfies a whole issue. Do not treat this preview as an accepted unattended deployment.

## Events, stages and workspaces

The factory reconciles at startup, on server events and, if configured, on a clock. Its collector reads tracker facts and recorded outcomes, derives the next stage and runs a pinned one-shot policy command. That command receives structured facts on stdin and returns structured decisions on stdout. It may admit work, reserve an owner decision, decline work, or answer an integration or closure gate.

The agent stages are implementation, review, correction specification and rework. Integration and closure are T3 operations. Each decision binds the observation, the policy and configuration revision, the brief, the capacity pool, the model selection and the workspace strategy. Changed facts need another decision. The shared launch and preparation paths carry that identity into ordinary T3 threads and worktrees.

Native stores keep observations, decisions, reservations, claims, execution generations, outcomes, transfers and external-operation receipts. The event sink commits orchestration facts and effects before the effect worker performs any I/O. Reconciliation uses those records to find an operation whose response was lost.

## Claims and capacity

A GitHub claim binds a verified account, a request nonce, a comment identity and its body to native evidence. The first provider start checks the claim again. An ambiguous comment-create response holds the work until a readback resolves it. A label or an account name alone does not establish ownership.

Capacity is a reservation in the local database. Native descendants, observed foreign claims and transferred legacy workers can occupy units. A turn ending does not free a unit while process custody or a required result is unresolved. Local transactional reservation tests do not make GitHub a global compare-and-set lock. Use one claim writer per repository unless a handover has been proved.

The generic transfer service fences a legacy command job and waits for its last pass to stop before adopting recorded work. That does not prove that an external process or its descendants stopped. Unknown custody stays held. Deployment-specific receipt import is not part of this source. Retiring a legacy controller remains open.

## Review and integration

Workers report through `t3_factory_report`. The server takes the caller's thread from the MCP invocation, then checks the outcome against its admitted execution and the applicable Git and tracker readback. A review report must name the admitted head. Later work, explicit rejection and typed failures change the recorded next stage.

Direct Git integration updates the target with a compare-and-set against its expected tip. PR integration publishes the reviewed head, opens or reads the matching PR, observes host protection and requests a merge at that head. When native review passes, the factory posts a configured acceptance status on the reviewed head. Integration intent and readback are separate from the worker's own description and from issue closure.

When host protection blocks a PR and no pending or failed check explains it, the factory reads review findings. A changes-requested review on exactly the admitted head becomes a correctable failure, with bounded excerpts of the current unresolved conversations. Stale-head requests, missing approvals, unreadable responses and partial review pages keep it waiting. Fixtures cover this routing. No live run has yet completed a full rework, fresh review and integration cycle.

An externally reopened tracker item shows as reopened and waits for its owner; the factory keeps the recorded closure and does not restart its lineage. Rejecting an outcome that already affected integration does not undo that effect, although a tool description says it does. This is a known product limitation.

At a previously reviewed head, a rework report can earn a fresh review basis when T3 reads every reported artifact inside the configured artifact root and verifies its SHA-256. Repeating the same evidence keeps the same decision basis. Changed evidence earns another independent review, never an automatic integration pass. A policy packet tells implementation and rework stages where to write this evidence and directs the reviewer to judge the earlier findings against it.

## Work without an idle coordinator model

Native reconciliation reads tracker state, accounts for reservations and receipts, selects the next stage and reconciles integration or closure without a model turn asking whether a worker finished. A configured clock still causes host work and tracker API calls while idle. Policy commands are trusted executable code.

Implementation, review, correction and rework use the configured providers and models. Owner decisions still need owners. This preview does not establish idle behavior, restart without duplicates, or every lifecycle journey on the final source.

## Controls and trust boundaries

Owners inspect and act through the Factories page in Settings on web and desktop, the Factories page in mobile settings, or owner-authorized MCP methods. Agent threads cannot answer their own owner gates. A finite grant names an item, a stage and its evidence, and the admission commit spends it. RPC permission checks apply at the destination environment.

The policy executable, repository setup commands and permitted provider tools run with the host authority you give them. A pinned policy digest detects changed bytes. It does not sandbox the policy. Tracker comments and model reports are inputs, not permission grants. Keep credentials in the environment's secret store. This source ships no credentials, project policies, tracker state or databases.

Process containment uses Windows job objects through a small helper the server compiles from C# with the system .NET compiler. Earlier demonstrations established Windows descendant containment for their tested source and cases. They do not establish containment on other platforms. Claude, Codex and Muse have explicit process-join hooks. Other providers get no equivalent guarantee from appearing in a model picker. Hosts that block freshly compiled unsigned executables, such as Windows Smart App Control, cannot run that helper until a trusted copy is provisioned. [Verification](VERIFICATION.md) records what that means for this port's checks.

A factory-owned thread may read a linked environment but cannot start work there, because capacity and item ownership are reserved per environment. Remote, relay, tunnel, multi-device and every client path have not all been proved.

A factory may configure `ownerThreadId` to show pending gates, one-start grants and stalled-result questions in an existing owner thread. The owner thread must already have a run. An authenticated client answer goes through the owner service; an agent cannot answer it through ordinary runtime-request commands. Dismissing a card authorizes nothing and may cause another card on the next pass. Keeping a result stops that question; rejecting needs a reason and does not undo already-consumed integration effects. These are source mechanisms with synthetic fixtures awaiting matching final-candidate execution, not verified client parity. Without `ownerThreadId`, decisions stay in Settings.

## Reuse and disabling

Apply the messaging patch and the three factory patches in order to the exact base, or use the combined patch. Do not assemble the preview by cherry-picking the PRs in the lineage catalog. Official 3717 already includes the merged MCP support the factory builds on.

The factory has its own reconciliation loop and does not need the separate stable tick preview as another scheduler. The command-job modules it uses for fences and transfers are part 1 of this series.

Configure factories paused at first. To pause new admissions, replace the factory document with `enabled: false`, its exact checksum and the current expected revision. Read back the state and account for existing reservations before retiring processes or removing an environment. Pausing does not stop workers that are already running. [Installation](INSTALL.md) describes a disposable setup and its refusal checks.

## Existing work and useful feedback

The [original-solutions factory fork](https://github.com/original-solutions/t3code-factory/tree/050bf7c8ed0cfa68fc2b6e3b3b8bce2a5ce2a9dd) already runs a native factory over an earlier official base. Its [guide](https://github.com/original-solutions/t3code-factory/blob/050bf7c8ed0cfa68fc2b6e3b3b8bce2a5ce2a9dd/factory/README.md) and source are useful prior work. No code from that fork was copied, and it is not an installation dependency.

Both approaches avoid an idle coordinator model. That fork has a sessions adapter, approval-history rules, clean merged-tree command gates, a JSONL ledger and operating views. This preview keeps native database reservations, custody, explicit review and correction stages, and native integration operations. They make different assumptions and cost different amounts to maintain. Neither the comparison nor a closed upstream PR shows that either was rejected for quality.

Related proposals include [configurable pipelines #6818](https://github.com/pingdotgg/t3code/discussions/6818) and [persistent initiatives #16269](https://github.com/pingdotgg/t3code/discussions/16269). Feedback on the smallest useful integration boundary, competing claims, held capacity, stale reviewed heads, ambiguous remote writes, restart during integration and owner refusal would help. Report problems in [the fork's issues](https://github.com/zainmitchell/t3code/issues) with the base, patch checksum, steps, expected and observed behavior, and credentials removed.

Feature proposals belong in T3's Ideas discussions under its [contribution policy](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md). An upstream feature PR needs maintainer agreement on direction and scope first. This preview carries no upstream endorsement.

## Attribution and license

Prepared by [zainmitchell](https://github.com/zainmitchell). The owner reports that Claude Opus 5.5, through T3 Code's Claude provider, wrote the factory additions on T3 source. GPT-6.1 Sol, through Codex in T3 Code, reviewed and scrubbed the 3669 source and prepared its release. Claude Opus 5.5, through T3 Code's Claude provider, ported it to 3717 and wrote these documents. The linked-environment stack in the messaging patch is original upstream work by Julius Marminge, credited with Claude Opus 5.5 in the public commits. The release's component commit and lineage retain that attribution. GPT-6.1 Sol through Codex in T3 Code reconciled the generic follow-up changes, scrubbed the new fixtures and prepared this3717 candidate. Its final required toolchain checks remain blocked as recorded. These credits do not claim an independent review of every commit or a new CodeRabbit review.

The source keeps T3 Tools Inc.'s MIT notice and the upstream notices. [NOTICES.md](NOTICES.md) covers the patched SDK. This is a free, self-hosted community preview, kept only while it is useful ahead of an upstream capability or a better replacement.
