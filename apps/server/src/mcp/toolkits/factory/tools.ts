import {
  FactoryDecideInput,
  FactoryDecideResult,
  FactoryDisposeClaimInput,
  FactoryDisposeClaimResult,
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
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as FactoryLifecycle from "../../../factory/FactoryLifecycle.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  FactoryLifecycle.FactoryLifecycle,
];

const FactoryReportTool = Tool.make("t3_factory_report", {
  description:
    "Needs an agent running a T3 factory lifecycle stage. Report this stage's outcome once its work is done: implemented (with subject.baseCommit and subject.headCommit), failed (with failure), review_passed or review_failed (with the reviewed subject.headCommit, and failure for the findings), correction_spec, integrated (with integration), or closed. T3 binds the report to this thread's own execution and verifies it by reading the repository and tracker back before the next stage starts. Reporting the same outcome again returns the first report.",
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

const FactoryStateTool = Tool.make("t3_factory_state", {
  description:
    "Read a T3 factory's capacity, its held and released reservations with their execution custody, its pending and answered owner decisions, and what its latest collection decided for each item and why.",
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
    "For the factory owner only: answer a pending reserved factory decision (see t3_factory_state). The answer is recorded once and starts the factory's next reconciliation. For a decision of kind grant, grantUnits issues that many supervised starts for exactly that request. Agents running inside T3 threads cannot answer.",
  parameters: FactoryDecideInput,
  success: FactoryDecideResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Answer a factory decision")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const FactoryDisposeClaimTool = Tool.make("t3_factory_dispose_claim", {
  description:
    "For the factory owner only: dispose of custody the factory holds as unknown (an observed legacy or outside claim, or a transferred item's legacy custody), once you have checked its writer is stopped and its work is gone. That exact claim or custody is then neither charged nor counted again. Agents running inside T3 threads cannot dispose.",
  parameters: FactoryDisposeClaimInput,
  success: FactoryDisposeClaimResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Dispose of an unattributed factory claim")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

const FactoryRejectOutcomeTool = Tool.make("t3_factory_reject_outcome", {
  description:
    "For the factory owner only: explicitly reject a verified factory outcome (an implementation, review or spec). It is never consumed again, however often it is reported, and the item goes to correction. Agents running inside T3 threads cannot reject.",
  parameters: FactoryRejectOutcomeInput,
  success: FactoryRejectOutcomeResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Reject a factory outcome")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

const FactoryRevokeGrantTool = Tool.make("t3_factory_revoke_grant", {
  description:
    "For the factory owner only: revoke what remains of a finite factory grant (see t3_factory_state). Agents running inside T3 threads cannot revoke.",
  parameters: FactoryRevokeGrantInput,
  success: FactoryRevokeGrantResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Revoke a factory grant")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

const FactoryTransferTool = Tool.make("t3_factory_transfer", {
  description:
    "For the factory owner only: hand a legacy command job's work on the named items to the factory. The job's writer is fenced at once (it starts no pass and applies no request), and the items are adopted once its last pass has stopped: answer draining means ask again with the same transferId. Each item keeps its original job, task, work, thread, run and receipt identities, and its legacy custody stays held until you dispose of it with t3_factory_dispose_claim after checking the legacy work yourself. Agents running inside T3 threads cannot transfer.",
  parameters: FactoryTransferInput,
  success: FactoryTransferResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Transfer legacy factory work")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const FactoryRollbackTransferTool = Tool.make("t3_factory_rollback_transfer", {
  description:
    "For the factory owner only: give a transfer's items and writes back to its legacy command job, as long as no native work began on them. The job's writer is unfenced once no other transfer holds it. Agents running inside T3 threads cannot roll back.",
  parameters: FactoryRollbackTransferInput,
  success: FactoryTransferResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Roll back a legacy factory transfer")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

export const FactoryToolkit = Toolkit.make(
  FactoryReportTool,
  FactoryStateTool,
  FactoryDecideTool,
  FactoryDisposeClaimTool,
  FactoryRejectOutcomeTool,
  FactoryRevokeGrantTool,
  FactoryTransferTool,
  FactoryRollbackTransferTool,
);
