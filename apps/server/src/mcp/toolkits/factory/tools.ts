import {
  FactoryDecideInput,
  FactoryDecideResult,
  FactoryDisposeClaimInput,
  FactoryDisposeClaimResult,
  FactoryEnterInput,
  FactoryEnterResult,
  FactoryRejectOutcomeInput,
  FactoryRejectOutcomeResult,
  FactoryReportFailure,
  FactoryReportInput,
  FactoryReportResult,
  FactoryRevokeGrantInput,
  FactoryRevokeGrantResult,
  FactoryRollbackTransferInput,
  FactoryTransferInput,
  FactoryTransferResult,
  FactoryStateInput,
  FactoryStateResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
];

/** `McpSchema.EnabledWhen` for owner-only tools: an agent thread is refused them, so not shown them. */
export const hiddenFromAgents = (): boolean => {
  const fiber = Fiber.getCurrent();
  const scope =
    fiber && Context.getOrUndefined(fiber.context, McpInvocationContext.McpInvocationContext);
  return scope?.thread === undefined;
};

const FactoryReportTool = Tool.make("t3_factory_report", {
  description:
    "Needs an agent running a T3 factory lifecycle stage. Report this stage's outcome once its work is done: implemented (with subject.baseCommit and subject.headCommit), failed (with failure), review_passed or review_failed (the reviewed subject.headCommit; failure holds findings), correction_spec, or for triage unit_proposed (proposal: basis = the brief's item version, unit, ownedFiles, resources) or not_actionable (with failure). T3 binds it to this thread's execution and verifies it against the repository and tracker. A repeated report returns the first.",
  parameters: FactoryReportInput,
  success: FactoryReportResult,
  failure: Schema.Union([FactoryReportFailure, OrchestratorMcpFailure]),
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Report a factory stage outcome")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const FactoryEnterTool = Tool.make("t3_factory_enter", {
  description:
    "Ask a T3 factory to take one tracker issue now, instead of launching a thread to build it. Name the factory, repository (owner/name) and issue number. Its readiness, policy, claim and capacity decide; its native stages then implement, review, integrate and close it. Asking again never starts a second worker. status started or active: a stage holds it (threadId); held: waits on an owner decision or claim; not_ready: reason says what is missing; refused: this factory cannot take it. nextAction says who acts. Never makes an issue ready, answers a decision or reports a stage.",
  parameters: FactoryEnterInput,
  success: FactoryEnterResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Enter an issue into a factory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const FactoryStateTool = Tool.make("t3_factory_state", {
  description:
    "Read a T3 factory's capacity, held and released reservations with custody, pending and answered owner decisions, and its latest collection decision per item with reasons.",
  parameters: FactoryStateInput,
  success: FactoryStateResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read factory state")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const FactoryDecideTool = Tool.make("t3_factory_decide", {
  description:
    "Owner only: answer a pending factory decision (see t3_factory_state). Recorded once; starts the next reconciliation. kind grant: answer grant (or approve) with grantUnits for that many supervised starts; grantUnits with another answer settles nothing. A ticket question (stage ticket) takes approve or abandon; other answers ask again. Agents are refused.",
  parameters: FactoryDecideInput,
  success: FactoryDecideResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Answer a factory decision")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, hiddenFromAgents);

const FactoryDisposeClaimTool = Tool.make("t3_factory_dispose_claim", {
  description:
    "Owner only: dispose of custody held as unknown (an observed legacy or outside claim, or a transferred item's legacy custody) after checking its writer is stopped and its work gone. It is then never charged or counted again. Agents are refused.",
  parameters: FactoryDisposeClaimInput,
  success: FactoryDisposeClaimResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Dispose of an unattributed factory claim")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, hiddenFromAgents);

const FactoryRejectOutcomeTool = Tool.make("t3_factory_reject_outcome", {
  description:
    "Owner only: reject a verified outcome (implementation, review or spec). It is never consumed again, however often reported, and the item goes to correction. Agents are refused.",
  parameters: FactoryRejectOutcomeInput,
  success: FactoryRejectOutcomeResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Reject a factory outcome")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, hiddenFromAgents);

const FactoryRevokeGrantTool = Tool.make("t3_factory_revoke_grant", {
  description:
    "Owner only: revoke the rest of a finite grant (see t3_factory_state). Agents are refused.",
  parameters: FactoryRevokeGrantInput,
  success: FactoryRevokeGrantResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Revoke a factory grant")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, hiddenFromAgents);

const FactoryTransferTool = Tool.make("t3_factory_transfer", {
  description:
    "Owner only: hand a legacy command job's work on the named items to the factory. Its writer is fenced at once (no new pass or request); items are adopted once its last pass stops: on draining, ask again with the same transferId. Items keep their job, task, work, thread, run and receipt identities; legacy custody stays held until you check it and call t3_factory_dispose_claim. Agents are refused.",
  parameters: FactoryTransferInput,
  success: FactoryTransferResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Transfer legacy factory work")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, hiddenFromAgents);

const FactoryRollbackTransferTool = Tool.make("t3_factory_rollback_transfer", {
  description:
    "Owner only: return a transfer's items and writes to its legacy command job if no native work began on them. Its writer is unfenced once no other transfer holds it. Agents are refused.",
  parameters: FactoryRollbackTransferInput,
  success: FactoryTransferResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Roll back a legacy factory transfer")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, hiddenFromAgents);

export const FactoryToolkit = Toolkit.make(
  FactoryReportTool,
  FactoryEnterTool,
  FactoryStateTool,
  FactoryDecideTool,
  FactoryDisposeClaimTool,
  FactoryRejectOutcomeTool,
  FactoryRevokeGrantTool,
  FactoryTransferTool,
  FactoryRollbackTransferTool,
);
