import {
  type FactoryDecideInput,
  FactoryDisposeClaimInput,
  FactoryObserveClaimsInput,
  type FactoryOverview,
  FactoryRollbackTransferInput,
  type FactoryStateResult,
  FactoryTransferInput,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/** One reserved decision as the owner surfaces list it, with the factory it belongs to. */
export type FactoryDecisionEntry = FactoryStateResult["reservedDecisions"][number] & {
  readonly factoryId: FactoryOverview["factories"][number]["factoryId"];
};

/** `github:owner/repo#12` reads as `owner/repo#12`; anything else is shown as it is. */
export function factoryItemLabel(itemKey: string): string {
  return itemKey.startsWith("github:") ? itemKey.slice("github:".length) : itemKey;
}

/** Every pending owner decision across factories, oldest first: the order they were asked. */
export function pendingFactoryDecisions(
  overview: FactoryOverview | null | undefined,
): ReadonlyArray<FactoryDecisionEntry> {
  if (overview === null || overview === undefined) return [];
  return overview.factories
    .flatMap(({ factoryId, state }) =>
      state.reservedDecisions
        .filter((decision) => decision.state === "pending")
        .map((decision) => ({ ...decision, factoryId })),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export type FactoryDecisionAnswer =
  | { readonly type: "approve" }
  | { readonly type: "decline"; readonly reason?: string }
  | { readonly type: "grant"; readonly units: number }
  | { readonly type: "answer"; readonly text: string };

/**
 * The owner's answer as the server records it. A grant is offered only for a grant request, in
 * whole positive units; an empty free-text answer is no answer.
 */
export function factoryDecisionAnswerInput(
  decision: Pick<FactoryDecisionEntry, "factoryId" | "decisionId" | "kind">,
  answer: FactoryDecisionAnswer,
): FactoryDecideInput | null {
  const target = { factoryId: decision.factoryId, decisionId: decision.decisionId };
  switch (answer.type) {
    case "approve":
      return { ...target, answer: "approve" };
    case "decline": {
      const reason = answer.reason?.trim();
      return {
        ...target,
        answer: reason === undefined || reason.length === 0 ? "decline" : `decline: ${reason}`,
      };
    }
    case "grant":
      if (decision.kind !== "grant" || !Number.isInteger(answer.units) || answer.units < 1) {
        return null;
      }
      return { ...target, answer: "grant", grantUnits: answer.units };
    case "answer": {
      const text = answer.text.trim();
      return text.length === 0 ? null : { ...target, answer: text };
    }
  }
}

/** One line on what the factory is doing now, for a summary row. */
export function factorySummary(state: FactoryStateResult): string {
  if (!state.configured) return "Not configured";
  const occupied = state.pools.reduce((total, pool) => total + pool.occupiedUnits, 0);
  const capacity = state.pools.reduce((total, pool) => total + pool.capacityUnits, 0);
  const pending = state.reservedDecisions.filter((decision) => decision.state === "pending");
  return [
    state.enabled === false ? "Paused" : "Running",
    `${occupied}/${capacity} units in use`,
    ...(pending.length === 0 ? [] : [`${pending.length} waiting for you`]),
    ...(state.issues.length === 0 ? [] : [`${state.issues.length} problem(s)`]),
  ].join(" · ");
}

/** What the owner can do to install a factory and take legacy work over. */
export type FactoryOwnerAction = "configure" | "observe" | "transfer" | "rollback" | "dispose";

export type FactoryOwnerActionInput =
  | { readonly action: "configure"; readonly input: { readonly configuration: string } }
  | { readonly action: "observe"; readonly input: typeof FactoryObserveClaimsInput.Type }
  | { readonly action: "transfer"; readonly input: typeof FactoryTransferInput.Type }
  | { readonly action: "rollback"; readonly input: typeof FactoryRollbackTransferInput.Type }
  | {
      readonly action: "dispose";
      readonly inputs: ReadonlyArray<typeof FactoryDisposeClaimInput.Type>;
    };

const decodeObserve = Schema.decodeUnknownResult(Schema.fromJsonString(FactoryObserveClaimsInput));
const decodeTransfer = Schema.decodeUnknownResult(Schema.fromJsonString(FactoryTransferInput));
const decodeRollback = Schema.decodeUnknownResult(
  Schema.fromJsonString(FactoryRollbackTransferInput),
);
const decodeDisposals = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Union([FactoryDisposeClaimInput, Schema.Array(FactoryDisposeClaimInput)]),
  ),
);

/**
 * The owner's pasted document as the action's exact input, or why it is not one. A
 * configuration is sent as written: the server validates it whole against the factory schema.
 */
export function factoryOwnerActionInput(
  action: FactoryOwnerAction,
  text: string,
): FactoryOwnerActionInput | { readonly error: string } {
  switch (action) {
    case "configure":
      return text.trim().length === 0
        ? { error: "Paste the factory configuration document." }
        : { action, input: { configuration: text } };
    case "observe": {
      const result = decodeObserve(text);
      return Result.isFailure(result)
        ? { error: result.failure.message }
        : { action, input: result.success };
    }
    case "transfer": {
      const result = decodeTransfer(text);
      return Result.isFailure(result)
        ? { error: result.failure.message }
        : { action, input: result.success };
    }
    case "rollback": {
      const result = decodeRollback(text);
      return Result.isFailure(result)
        ? { error: result.failure.message }
        : { action, input: result.success };
    }
    case "dispose": {
      const result = decodeDisposals(text);
      if (Result.isFailure(result)) return { error: result.failure.message };
      const decoded = result.success;
      return { action, inputs: Array.isArray(decoded) ? decoded : [decoded] };
    }
  }
}
