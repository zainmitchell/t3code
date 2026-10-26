# Factory lifecycle

A factory turns eligible tracker issues into agent work, review, integration and closure without a coordinator agent. Its state lives in the server database next to orchestration (`apps/server/src/factory`). This page records the constraints that span those pieces.

## Decisions and stages

- An item's stage comes from its native facts alone: `factoryStages.ts` folds admitted stages and verified outcomes, in commit order, into the next stage. There is no retry counter: every new failure gets one correction, and an unchanged basis never yields a second decision. Do not port a project's generated attempt cap as a gate; a cap is policy only if the project's owner says so.
- Each agent stage is its own admitted execution. Only the first stage claims the issue; later stages carry `continues` and run under that claim. A carrier the factory's own claim produced stays attributed after `outcome_verified`; any other release leaves a claim nobody owns, which the next observation charges as unknown custody.
- Integration and closure are T3's own stages, never a worker's. They run only when the policy answers `proceed`, and a product gate that finds the work at fault answers `fail`, which records the integration's failure and sends the item to correction.

## External writes

Every write outside T3 (a tracker comment, closing an issue, landing reviewed work) is an operation: its intent commits first, an outbox effect applies it, and the effect reads back by the operation's stable identity (a marker, an expected tip, the pull request) before writing. A write whose answer was lost is found, not repeated. Anything not positively known stays intended and is retried a minute later, so a lost answer never becomes a second comment or a second merge.

- Direct integration moves the target branch only by compare-and-set from the tip it was decided on (`FactoryIntegrator`).
- Pull request integration publishes the reviewed head (create or fast-forward only), opens one pull request that refers to the issue without closing it, and merges at exactly the reviewed head once the host's protection allows. T3 reads the host's verdict and never decides mergeability itself. A required acceptance status is posted on the reviewed head only after T3's own review passed.

## Outcomes and evidence

- A worker reports through `t3_factory_report`. T3 takes the calling thread from the MCP invocation, never from the report.
- Reports are verified (Git and tracker readback, one marked tracker comment) inside the factory's collector pass. A stage releases its reservation only after a verified outcome and proved quiescence; time never releases it. A run that ends quiet without a verified result is recorded as that stage's typed failure.
- An item's evidence is every comment except T3's own records. A comment is T3's only when a native write record (an operation receipt or intent, or a claim attempt's nonce) proves T3 wrote exactly that body. The factory's account alone proves nothing, since people and tools share it (`factoryBookkeeping.ts`).

## Policy

The project policy is a pinned one-shot command (`FactoryCommandPolicy.ts`). Each pass sends every decidable item, plus the work under way, in one call; the answer's order is the order capacity is spent in. It chooses content, gates and a configured execution by name (a builder's effort), never a stage or a transition, and it keeps no state. Anything it needs to decide on must reach it as an input fact: issue relations (author, blockers, parent, sub-issues) come from T3's tracker read, so a policy never reads the tracker itself. Readiness is the claim's label when one is configured. Without a label, every open issue reaches the policy, which decides what may start: one project's ready label is never another's prerequisite. Issues that another claim holds reach the policy as work under way, so it schedules around them.

## Owner authority

- A `reserve` answer becomes a reserved decision identified by its exact evidence, recorded once with one marked tracker comment. Rewording does not ask again; a later pass on fresh facts that no longer asks for it supersedes it.
- Owner decisions are answered through one service record from every surface: Settings → Factories on web and desktop, the mobile settings sheet, and the owner-only MCP tools. Agent threads and clients relaying for an agent are refused, because they could answer the gate they wait on.
- A finite grant authorizes one exact item, stage and request evidence, and is spent inside the admission commit that revalidates all three, so it never falls through to another subject.

## Legacy writers

A legacy command job's work moves to a factory only by an owner's transfer (`factoryTransfers.ts`). The transfer raises the job's writer fence (`CommandJobFence`), which the job runner checks at every effect boundary, and adopts only after the job's last pass stopped. That proves T3 applies nothing more for the old writer. It proves nothing about what the job's own process or its descendants did outside T3, so every transferred worker's custody stays held, one reservation per worker, until the owner disposes of it. Each worker's thread is bound to its reservation, and the start boundaries refuse anything sourced from it. A rollback gives the items and the writer back unless native work began.

## Containment

A factory run on a contained driver (`CONTAINED_DRIVERS`) starts its provider process inside the run's container, or not at all. Each driver joins differently:

- **Claude** joins once per thread query, naming the run that opened the query and its provider session.
- **Muse** joins once per session; its sessions are per thread already.
- **Codex** runs one app server per session, and a session normally serves every thread on its instance. A process shared like that can't sit in one execution's container, so a factory execution's thread always gets a session of its own (`providerSessionIdFor` in the orchestrator). Only such an exclusive session joins.

A Codex thread that a factory worker delegates still shares its instance's session, so its custody stays unknown. Test providers must join the same way as their driver, or every stage after the first reads as uncontained.

One process can serve several runs of one execution: a cached query answers a follow-up, and Claude re-invokes the model inside the live process when a background task finishes. So custody is judged per execution (reservation and thread), not per run: `readExecutionCustody` reads every generation recorded for the reservation on its thread, and a provider is proved gone when it joined the run's own container, a sibling container of the same execution (all of them gone), or a container its own session joined. A generation records the sessions whose provider joined it for that reason. A provider-native wake continues the execution inside the live process only when that session is live, holds the execution's only live containers and nothing else keeps it live; a refused wake is delivered again, once, as a server message after the execution is proved quiet, and the stage is not disposed as missing its result while one is owed.
