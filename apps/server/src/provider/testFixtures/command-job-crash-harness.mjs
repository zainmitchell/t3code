// Stands in for a T3 server that starts one command-job pass and is then killed without running
// any shutdown code. Used by CommandJobs.test.ts to leave a real orphaned job behind.
// Usage: node command-job-crash-harness.mjs <stateDir> <task json>
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CommandJobFence from "../../commandJobs/CommandJobFence.ts";
import * as CommandJobs from "../../commandJobs/CommandJobs.ts";
import * as ServerConfig from "../../config.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ProjectService from "../../project/ProjectService.ts";

const [stateDir, taskJson] = process.argv.slice(2);
const layer = CommandJobs.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      CommandJobFence.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
      Layer.succeed(ServerConfig.ServerConfig, { stateDir }),
      ProcessRunner.layer,
      NodeCrypto.layer,
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(null),
        hasReceipt: () => Effect.succeed(false),
        streamDomainEvents: Stream.never,
      }),
    ),
  ),
  Layer.provide(NodeServices.layer),
);

Effect.runFork(
  Effect.scoped(
    Layer.build(layer).pipe(
      Effect.flatMap((context) =>
        Context.get(context, CommandJobs.CommandJobs).run({
          task: JSON.parse(taskJson),
          jobName: "tick",
        }),
      ),
    ),
  ),
);
