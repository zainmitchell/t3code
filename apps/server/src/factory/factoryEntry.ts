import type { FactoryEnterResult, FactoryItemKey } from "@t3tools/contracts";

import type * as FactoryOutcomeStore from "./FactoryOutcomeStore.ts";
import * as FactoryStore from "./FactoryStore.ts";

/** The disposition record a pass left for one item; see `FactoryItemDispositionRecord`. */
export interface EntryRecord {
  readonly stage: string | null;
  readonly disposition: string;
  readonly detail?: string;
  readonly reasonClass?: string;
}

const STAGE_REPORTS =
  "Nothing from this chat: the stage reports with t3_factory_report from its own thread, and the factory moves the item on. Read progress with t3_factory_state.";

const ownerAnswers = (decisionId: string) =>
  `The factory owner answers decision ${decisionId} from their own client (t3_factory_decide or \`t3 factory decide\`). This route never answers it.`;

/**
 * What an entry request found, from durable native facts first: a held native reservation, then a
 * pending owner decision, then what the pass that read the item decided. A pass that coalesced
 * into one already running leaves no fresh record, so it says the item is waiting rather than
 * guess.
 */
export const entryView = (input: {
  readonly itemKey: FactoryItemKey;
  readonly startedReservationIds: ReadonlySet<string>;
  readonly held: FactoryStore.FactoryReservation | undefined;
  readonly pending: FactoryOutcomeStore.ReservedDecision | undefined;
  readonly record: EntryRecord | undefined;
}): FactoryEnterResult => {
  const { itemKey, held, pending, record } = input;
  if (held !== undefined && FactoryStore.isNativeReservation(held)) {
    const stage = held.origin === "admitted" ? held.taskKind : undefined;
    return {
      itemKey,
      status: input.startedReservationIds.has(held.reservationId) ? "started" : "active",
      ...(stage === undefined ? {} : { stage }),
      threadId: held.execution.threadId,
      reason: `A native ${stage ?? "factory"} stage holds the item under the factory's claim.`,
      nextAction: STAGE_REPORTS,
    };
  }
  if (pending !== undefined) {
    return {
      itemKey,
      status: "held",
      stage: pending.stage,
      decisionId: pending.decisionId,
      reason: pending.reason,
      nextAction: ownerAnswers(pending.decisionId),
    };
  }
  const stage = record?.stage ?? undefined;
  const view = (
    status: FactoryEnterResult["status"],
    reason: string,
    nextAction: string,
  ): FactoryEnterResult => ({
    itemKey,
    status,
    ...(stage === undefined ? {} : { stage }),
    reason,
    nextAction,
  });
  if (record === undefined) {
    return view(
      "waiting",
      "A collection pass already running reads the item next.",
      "Enter it again, or read t3_factory_state, for what that pass decided.",
    );
  }
  const detail = record.detail;
  switch (record.disposition) {
    case "done":
      return view("done", "The factory integrated the item and its closure is recorded.", "None.");
    case "admitted":
    case "existing":
    case "in_progress":
      return view("active", "Native work holds the item.", STAGE_REPORTS);
    case "integrating":
    case "closing":
      return view(
        "active",
        `T3 is ${record.disposition} the item's reviewed head itself.`,
        "None: integration and closure are the factory's own effects.",
      );
    case "not_eligible":
      return view(
        "not_ready",
        `The factory does not take it: ${detail ?? "it is not ready"}.`,
        detail?.startsWith("it lacks the readiness label") === true
          ? "The issue's owner applies that label on the tracker, then enters it again. This route does not change readiness."
          : detail === "the issue is closed"
            ? "Reopen the issue if work remains, then enter it again."
            : "That claim's writer releases it, or the factory owner disposes of an unattributed claim (`t3 factory dispose`).",
      );
    case "nothing_proposed":
      return view(
        "not_ready",
        detail ?? "The project policy proposed no work for this version of the issue.",
        "Supply what the policy names in the issue itself; the factory reads the new version on its next pass. This route does not change readiness.",
      );
    case "foreign_claim":
    case "not_owned":
      return view(
        "held",
        record.disposition === "foreign_claim"
          ? "Another writer's claim holds an item this factory began."
          : "The factory began this item but no longer finds its own claim on it.",
        "The factory owner reads t3_factory_state and settles that claim.",
      );
    case "reserved_decision":
      return view(
        "held",
        detail ?? "The item waits on an owner decision.",
        "The factory owner answers it from their own client (t3_factory_decide or `t3 factory decide`). This route never answers it.",
      );
    case "refused:factory_paused":
      return view(
        "refused",
        "The factory is paused: it finishes what it owns and starts nothing new.",
        "The factory owner enables it, then enters the issue again.",
      );
    case "unavailable":
      return view(
        "refused",
        detail ?? "The tracker cannot answer for this issue.",
        record.reasonClass === "not_an_issue"
          ? "Enter the issue the pull request belongs to; the factory takes only issues."
          : record.reasonClass === "gone"
            ? "Enter an issue that exists; this one cannot be taken."
            : "Check the repository and number. If the issue exists, the factory owner gives the factory's tracker account read access, then enters it again.",
      );
    case "read_failed":
    case "read_deadline":
      // The pass leaves the request pending, and the factory's retry reads it again.
      return view(
        "waiting",
        "The tracker could not be read just now; the factory reads the issue again shortly.",
        "None: the request stays pending until a pass reads it. Read t3_factory_state if it keeps failing.",
      );
    default:
      return view(
        "waiting",
        `The pass that read it decided ${record.disposition}${detail === undefined ? "" : `: ${detail}`}.`,
        "The factory decides it again on its next pass; read t3_factory_state for the cause.",
      );
  }
};
