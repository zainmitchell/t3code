import * as GuestShareService from "../guest/GuestShareService.ts";
import * as UsageLimitRecoveryWorker from "./UsageLimitRecoveryWorker.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as OrchestrationCommandReceipts from "../persistence/OrchestrationCommandReceipts.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as McpAppModelContext from "../mcpApps/McpAppModelContext.ts";
import * as PreviewAgentActivity from "../preview/PreviewAgentActivity.ts";
import * as McpAppRequests from "../mcpApps/McpAppRequests.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProviderAuthService from "../provider/ProviderAuthService.ts";
import * as AgentSessionImporter from "../project/AgentSessionImporter.ts";
import * as AgentSessionScanner from "../project/AgentSessionScanner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as CheckpointCaptureService from "./CheckpointCaptureService.ts";
import * as CheckpointService from "./CheckpointService.ts";
import * as CheckpointRollbackService from "./CheckpointRollbackService.ts";
import * as CommandPolicy from "./CommandPolicy.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as ContextHandoffService from "./ContextHandoffService.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as FactoryClaimService from "../factory/FactoryClaimService.ts";
import * as FactoryRunPreparation from "../factory/FactoryRunPreparation.ts";
import * as FactoryClaimStore from "../factory/FactoryClaimStore.ts";
import * as FactoryCommandPolicy from "../factory/FactoryCommandPolicy.ts";
import * as FactoryEffects from "../factory/FactoryEffects.ts";
import * as FactoryOperationStore from "../factory/FactoryOperationStore.ts";
import * as FactoryLifecycle from "../factory/FactoryLifecycle.ts";
import * as FactoryStore from "../factory/FactoryStore.ts";
import * as FactoryTransferStore from "../factory/FactoryTransferStore.ts";
import * as FactoryGitReadback from "../factory/FactoryGitReadback.ts";
import * as FactoryExecutionGenerations from "../factory/FactoryExecutionGenerations.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as LegacyV1ThreadImporter from "./legacy/LegacyV1ThreadImporter.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProviderContinuationService from "./ProviderContinuationService.ts";
import * as ThreadTitleRegenerationService from "./ThreadTitleRegenerationService.ts";
import * as ProviderEventIngestor from "./ProviderEventIngestor.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as CommandOutputHub from "./CommandOutputHub.ts";
import * as ProviderRuntimeRecoveryService from "./ProviderRuntimeRecoveryService.ts";
import * as ProviderSwitchService from "./ProviderSwitchService.ts";
import * as ProviderTurnControlService from "./ProviderTurnControlService.ts";
import * as ProviderTurnStartService from "./ProviderTurnStartService.ts";
import * as RunExecutionService from "./RunExecutionService.ts";
import * as RunFinalizationService from "./RunFinalizationService.ts";
import * as ResourceCleanupService from "./ResourceCleanupService.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import * as RuntimeRequestService from "./RuntimeRequestService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ThreadLaunchService from "./ThreadLaunchService.ts";
import * as ThreadLifecycleService from "./ThreadLifecycleService.ts";
import * as ThreadForkService from "./ThreadForkService.ts";
import * as TurnItemPositionStore from "./TurnItemPositionStore.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as CommandJobFence from "../commandJobs/CommandJobFence.ts";
import * as CommandJobs from "../commandJobs/CommandJobs.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";

export const layerEventInfrastructure = Layer.mergeAll(
  OrchestrationEventStore.layer,
  OrchestrationCommandReceipts.layer,
);

const layerRuntimePolicyProvided = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(ProjectStore.layer),
);

const layerEventStoreProvided = EventStore.layerFromOrchestrationEventStore.pipe(
  Layer.provide(layerEventInfrastructure),
);
const layerCommandReceiptStoreProvided = CommandReceiptStore.layerFromApplicationReceipts.pipe(
  Layer.provide(layerEventInfrastructure),
);

const layerStores = Layer.mergeAll(
  layerEventInfrastructure,
  layerEventStoreProvided,
  ProjectionStore.layer,
  ProjectStore.layer,
  layerCommandReceiptStoreProvided,
  EffectOutbox.layer,
  TurnItemPositionStore.layer,
);

export const layerEventSink = EventSink.layerFromStores.pipe(Layer.provide(layerStores));
const layerEventSinkProvided = layerEventSink;
const layerProjectionMaintenanceProvided = ProjectionMaintenance.layer.pipe(
  Layer.provide(layerStores),
);
const layerLegacyV1ThreadImporterProvided = LegacyV1ThreadImporter.layer.pipe(
  Layer.provide(layerEventSinkProvided),
);

export const layerProjectService = ProjectService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      ProjectStore.layer,
      ProjectionStore.layer,
      layerEventSinkProvided,
      IdAllocator.layer,
      layerLegacyV1ThreadImporterProvided,
    ),
  ),
);

const layerProviderEventIngestorProvided = ProviderEventIngestor.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerEventSinkProvided,
      IdAllocator.layer,
      ProjectionStore.layer,
      ThreadCommandExecutor.layer,
      GitVcsDriver.layer,
    ),
  ),
);

const layerCheckpointServiceProvided = CheckpointService.layer.pipe(
  Layer.provide(IdAllocator.layer),
);
const layerContextHandoffServiceProvided = ContextHandoffService.layer.pipe(
  Layer.provide(IdAllocator.layer),
);

const layerProviderAdapterRegistryProvided =
  ProviderAdapterRegistry.layerFromProviderInstanceRegistry;
const layerProviderSwitchServiceProvided = ProviderSwitchService.layer.pipe(
  Layer.provide(layerProviderAdapterRegistryProvided),
);

const layerCommandOutputHubProvided = CommandOutputHub.layer.pipe(
  Layer.provide(Layer.merge(layerEventSinkProvided, ProjectionStore.layer)),
);

const layerProviderSessionManagerProvided = ProviderSessionManager.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerCommandOutputHubProvided,
      layerProviderAdapterRegistryProvided,
      layerEventSinkProvided,
      IdAllocator.layer,
      layerProviderEventIngestorProvided,
      ProjectionStore.layer,
    ),
  ),
);

const layerProviderAuthServiceProvided = ProviderAuthService.layer.pipe(
  Layer.provide(Layer.merge(ProjectionStore.layer, layerProviderSessionManagerProvided)),
);

const layerRunExecutionServiceProvided = RunExecutionService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      McpAppModelContext.layer,
      PreviewAgentActivity.layer,
      layerCheckpointServiceProvided,
      layerEventSinkProvided,
      IdAllocator.layer,
      layerProviderEventIngestorProvided,
      TurnItemPositionStore.layer,
    ),
  ),
);

const layerProviderTurnControlServiceProvided = ProviderTurnControlService.layer.pipe(
  Layer.provide(Layer.merge(ProjectionStore.layer, layerProviderSessionManagerProvided)),
);
const layerRuntimeRequestServiceProvided = RuntimeRequestService.layer.pipe(
  Layer.provide(Layer.merge(ProjectionStore.layer, layerProviderSessionManagerProvided)),
);
const layerCheckpointRollbackServiceProvided = CheckpointRollbackService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      ProjectStore.layer,
      layerCheckpointServiceProvided,
      layerEventSinkProvided,
      IdAllocator.layer,
      ProjectionStore.layer,
      layerProviderSessionManagerProvided,
      ThreadCommandExecutor.layer,
      layerRuntimePolicyProvided,
    ),
  ),
);
const layerCheckpointCaptureServiceProvided = CheckpointCaptureService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerCheckpointServiceProvided,
      layerEventSinkProvided,
      IdAllocator.layer,
      ProjectionStore.layer,
    ),
  ),
);
const layerRunFinalizationServiceProvided = RunFinalizationService.layer.pipe(
  Layer.provide(Layer.merge(layerCheckpointCaptureServiceProvided, ProjectionStore.layer)),
);

const layerOrchestratorProvided = Orchestrator.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerCheckpointServiceProvided,
      CommandPolicy.layer,
      layerStores,
      layerEventSinkProvided,
      layerCommandReceiptStoreProvided,
      layerContextHandoffServiceProvided,
      IdAllocator.layer,
      ProjectStore.layer,
      layerProviderAdapterRegistryProvided,
      // Reuse the continuation worker's layer reference so memoization shares one request queue.
      ProviderContinuationRequests.layer,
      layerProviderEventIngestorProvided,
      layerRuntimePolicyProvided,
      layerProviderSessionManagerProvided,
      layerProviderSwitchServiceProvided,
      layerRunExecutionServiceProvided,
      ThreadForkService.layer,
    ),
  ),
);

const layerAgentSessionImporterProvided = AgentSessionImporter.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      AgentSessionScanner.layer,
      layerProjectService,
      layerOrchestratorProvided,
      layerEventSinkProvided,
      IdAllocator.layer,
      ProviderSessionRuntime.layer,
    ),
  ),
);

/**
 * Exported so a harness can build services over the same instance the runtime uses; layers are
 * memoized by reference within one build.
 */
export const layerThreadManagementProvided = ThreadManagementService.layerWithLegacyImporter.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerOrchestratorProvided,
      layerLegacyV1ThreadImporterProvided,
      layerCommandReceiptStoreProvided,
      layerProviderSessionManagerProvided,
    ),
  ),
);
export const layerProjectSetupScriptRunner = ProjectSetupScriptRunner.layer.pipe(
  Layer.provide(layerProjectService),
);
const layerManagedProjectFoldersProvided = ManagedProjectFolders.layer.pipe(
  Layer.provide(layerProjectService),
);
const layerThreadLaunchProvided = ThreadLaunchService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerProjectService,
      layerProjectSetupScriptRunner,
      layerManagedProjectFoldersProvided,
      layerThreadManagementProvided,
      layerCommandReceiptStoreProvided,
      IdAllocator.layer,
    ),
  ),
);
const layerThreadLifecycleProvided = ThreadLifecycleService.layer.pipe(
  Layer.provide(layerThreadManagementProvided),
);
const layerSecretRequestsProvided = SecretRequests.layer.pipe(
  Layer.provide(layerThreadManagementProvided),
);
// One instance for the scheduler that runs the jobs and the factory that takes their work over,
// so a transfer sees the passes actually running. Both read the same durable writer fence.
const layerCommandJobsProvided = CommandJobs.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerThreadLaunchProvided,
      layerThreadManagementProvided,
      layerProjectService,
      ProcessRunner.layer,
      CommandJobFence.layer,
    ),
  ),
);
const layerScheduledTaskProvided = ScheduledTaskService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerThreadLaunchProvided,
      layerThreadManagementProvided,
      layerManagedProjectFoldersProvided,
      layerSecretRequestsProvided,
      layerCommandJobsProvided,
    ),
  ),
);
const layerProviderContinuationWorkerProvided = ProviderContinuationService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      ProviderContinuationRequests.layer,
      layerThreadManagementProvided,
      IdAllocator.layer,
    ),
  ),
);
const layerThreadTitleRegenerationProvided = ThreadTitleRegenerationService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(layerThreadManagementProvided, ProjectStore.layer, TextGeneration.layer),
  ),
);
// The claim service writes and reads back tracker claims through the tracker the server gives the
// runtime (`FactoryTracker`); without one, a factory that must claim starts nothing.
const layerFactoryClaimServiceProvided = FactoryClaimService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerOrchestratorProvided,
      FactoryClaimStore.layer.pipe(Layer.provideMerge(FactoryStore.layer)),
      FactoryExecutionGenerations.layer,
      FactoryOperationStore.layer,
      layerCommandReceiptStoreProvided,
    ),
  ),
);
const layerProviderTurnStartServiceProvided = ProviderTurnStartService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerContextHandoffServiceProvided,
      layerEventSinkProvided,
      IdAllocator.layer,
      ProjectionStore.layer,
      layerProviderSessionManagerProvided,
      layerProviderAuthServiceProvided,
      layerRunExecutionServiceProvided,
      layerRuntimePolicyProvided,
      layerStores,
      layerProviderAdapterRegistryProvided,
      FactoryStore.layer,
      layerFactoryClaimServiceProvided,
      // The same value the server provides, so both resolve to its one set of containers.
      FactoryExecutionGenerations.layer,
    ),
  ),
);
// Factory operations are applied by the same worker as every other effect, after their intent
// committed. The integrator and the wake queue come from the server, shared with the lifecycle.
// One wake queue for the effect worker and the lifecycle's driver, so a finished factory write
// reaches the driver: both layers below provide this same value.
const layerFactoryWakes = FactoryEffects.layerWakes;
const layerFactoryEffectsProvided = FactoryEffects.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      FactoryOperationStore.layer,
      FactoryStore.layer,
      EffectOutbox.layer,
      layerFactoryWakes,
    ),
  ),
);
const layerEffectExecutorProvided = EffectWorker.layerExecutor.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerFactoryClaimServiceProvided,
      layerFactoryEffectsProvided,
      layerRunFinalizationServiceProvided,
      layerCheckpointRollbackServiceProvided,
      layerProviderSessionManagerProvided,
      layerProviderTurnControlServiceProvided,
      layerProviderTurnStartServiceProvided,
      layerRuntimeRequestServiceProvided,
      layerThreadTitleRegenerationProvided,
      layerThreadManagementProvided,
    ),
  ),
);
const layerEffectWorkerProvided = EffectWorker.layer.pipe(
  Layer.provide(Layer.merge(layerStores, layerEffectExecutorProvided)),
);
const layerProviderRuntimeRecoveryProvided = ProviderRuntimeRecoveryService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerEffectWorkerProvided,
      layerStores,
      layerEventSinkProvided,
      IdAllocator.layer,
      ProjectionStore.layer,
    ),
  ),
);

const layerMcpAppRequestsProvided = McpAppRequests.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      McpAppModelContext.layer,
      layerOrchestratorProvided,
      layerThreadManagementProvided,
      layerProviderSessionManagerProvided,
    ),
  ),
);

const layerFactoryLifecycleProvided = FactoryLifecycle.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerOrchestratorProvided,
      layerStores,
      layerProviderAdapterRegistryProvided,
      layerProviderSessionManagerProvided,
      FactoryGitReadback.layer.pipe(Layer.provide(layerProjectService)),
      FactoryCommandPolicy.layer.pipe(Layer.provide(ProcessRunner.layer)),
      layerProjectService,
      layerCommandJobsProvided,
      CommandJobFence.layer,
      FactoryTransferStore.layer,
      layerFactoryWakes,
    ),
  ),
);

export const layer = Layer.mergeAll(
  layerCommandOutputHubProvided,
  layerOrchestratorProvided,
  layerMcpAppRequestsProvided,
  layerThreadManagementProvided,
  layerEffectWorkerProvided,
  layerProviderSessionManagerProvided,
  layerProviderAuthServiceProvided,
  layerProviderRuntimeRecoveryProvided,
  layerProjectionMaintenanceProvided,
  layerLegacyV1ThreadImporterProvided,
  layerFactoryClaimServiceProvided,
);

// Claimed factory runs prepare their workspace through the same launch service as every other
// thread, provided before the claim service is built so its handoff can use it. The minimal
// `layer` above has none, and prepares nothing.
const layerFactoryRunPreparationProvided = Layer.effect(
  FactoryRunPreparation.FactoryRunPreparation,
  Effect.map(ThreadLaunchService.ThreadLaunchService, (launches) => ({
    available: true,
    startOwned: launches.prepareRunOwned,
    currentOwner: launches.currentPreparationOwner,
  })),
).pipe(Layer.provide(layerThreadLaunchProvided));

export const layerProduction = Layer.mergeAll(
  layer.pipe(Layer.provide(layerProjectService), Layer.provide(layerFactoryRunPreparationProvided)),
  layerProjectService,
  layerManagedProjectFoldersProvided,
  layerThreadLaunchProvided,
  layerThreadLifecycleProvided,
  layerScheduledTaskProvided,
  // Read-state custody attributes live preparation only through the same adapter.
  layerFactoryLifecycleProvided.pipe(Layer.provide(layerFactoryRunPreparationProvided)),
  layerSecretRequestsProvided,
  GuestShareService.layer.pipe(
    Layer.provide(Layer.merge(layerOrchestratorProvided, layerCommandOutputHubProvided)),
  ),
  UsageLimitRecoveryWorker.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ProjectionStore.layer,
        layerThreadManagementProvided,
        layerOrchestratorProvided,
      ),
    ),
  ),
  layerProviderContinuationWorkerProvided,
  layerAgentSessionImporterProvided,
  EffectOutbox.layerPruneWorker.pipe(Layer.provide(EffectOutbox.layer)),
).pipe(
  Layer.provide(ResourceCleanupService.layer.pipe(Layer.provide(layerScheduledTaskProvided))),
  Layer.provide(Scheduler.layer),
  Layer.provideMerge(layerEventInfrastructure),
);
