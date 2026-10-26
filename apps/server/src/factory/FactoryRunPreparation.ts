import type { CommandId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import type { JoinFor } from "@t3tools/shared/ExecutionJoin";

/**
 * The workspace preparation a claimed factory run uses: the existing launch service, narrowed to
 * what the claim handoff needs. A runtime without it (the minimal one tests and tools build)
 * prepares nothing, and says so before anything is authorized. Its production provision lives
 * with the launch service in the runtime layer, so custody can read this without importing it.
 */
export interface FactoryRunPreparationShape {
  readonly available: boolean;
  /**
   * Schedules the run's recorded workspace preparation for `ownerId`. The handle exists only when
   * this call reserved it, and reports how that preparation, and no other, ended.
   */
  readonly startOwned: (
    input: ThreadLaunchService.ThreadLaunchPreparationInput & {
      readonly ownerId: ThreadLaunchService.PreparationOwnerId;
      readonly join?: JoinFor;
    },
  ) => Effect.Effect<Option.Option<ThreadLaunchService.PreparationHandle>>;
  /** In-process only: none never proves that an earlier preparation stopped. */
  readonly currentOwner: (
    commandId: CommandId,
  ) => Effect.Effect<Option.Option<ThreadLaunchService.PreparationOwnerId>>;
}

export const FactoryRunPreparation = Context.Reference<FactoryRunPreparationShape>(
  "t3/factory/FactoryRunPreparation",
  {
    defaultValue: () => ({
      available: false,
      startOwned: () => Effect.succeed(Option.none()),
      currentOwner: () => Effect.succeed(Option.none()),
    }),
  },
);
