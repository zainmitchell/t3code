import {
  type FactorySwitchProviderInput,
  type FactorySwitchProviderResult,
  isProviderAvailable,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { invalidOptionSelections } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as FactoryStore from "./FactoryStore.ts";

type Executions = Pick<
  FactoryStore.FactoryConfigurationInput,
  "execution" | "stageExecution" | "executionChoices"
>;

const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Every execution a configuration routes work through, by the JSON pointer to its selection. */
const executionsOf = (configuration: Executions) => [
  { path: "/execution", execution: configuration.execution },
  ...Object.entries(configuration.stageExecution ?? {}).flatMap(([stage, execution]) =>
    execution === undefined ? [] : [{ path: `/stageExecution/${pointer(stage)}`, execution }],
  ),
  ...Object.entries(configuration.executionChoices ?? {}).map(([name, execution]) => ({
    path: `/executionChoices/${pointer(name)}`,
    execution,
  })),
];

export const planProviderSwitch = (
  configuration: Executions,
  from: ProviderInstanceId,
  to: ProviderInstanceId,
) => {
  const executions = executionsOf(configuration);
  const instancePath = (path: string) => `${path}/modelSelection/instanceId`;
  return {
    changes: executions
      .filter(({ execution }) => execution.modelSelection.instanceId === from)
      .map(({ path, execution }) => ({
        path: instancePath(path),
        modelSelection: execution.modelSelection,
      })),
    alreadyOnTarget: executions
      .filter(({ execution }) => execution.modelSelection.instanceId === to)
      .map(({ path }) => instancePath(path)),
  };
};

/** Why `target` cannot run each moving selection as it is, model and options unchanged. */
export const targetRefusals = (
  target: ServerProvider | undefined,
  to: ProviderInstanceId,
  changes: ReturnType<typeof planProviderSwitch>["changes"],
): ReadonlyArray<string> => {
  if (target === undefined) return [`Provider instance ${to} is not registered.`];
  if (!target.enabled) return [`Provider instance ${to} is disabled.`];
  const problems: Array<string> = [];
  if (!isProviderAvailable(target)) {
    problems.push(target.unavailableReason ?? `Provider instance ${to} is unavailable.`);
  }
  if (!target.installed) problems.push(`Provider instance ${to} is not installed.`);
  if (target.status === "error" || target.status === "disabled") {
    problems.push(target.message ?? `Provider instance ${to} status is ${target.status}.`);
  }
  if (target.auth.status === "unauthenticated") {
    problems.push(`Provider instance ${to} is not authenticated.`);
  }
  for (const { path, modelSelection } of changes) {
    const model = target.models.find((candidate) => candidate.slug === modelSelection.model);
    if (model === undefined) {
      problems.push(`${path}: ${to} does not offer model ${modelSelection.model}.`);
      continue;
    }
    for (const problem of invalidOptionSelections(
      modelSelection.options ?? [],
      model.capabilities?.optionDescriptors,
    )) {
      problems.push(`${path}: ${problem}`);
    }
  }
  return problems;
};

const switched = <C extends Executions>(
  configuration: C,
  from: ProviderInstanceId,
  to: ProviderInstanceId,
): C => {
  const swap = <E extends FactoryStore.FactoryExecution | undefined>(execution: E): E =>
    execution?.modelSelection.instanceId === from
      ? { ...execution, modelSelection: { ...execution.modelSelection, instanceId: to } }
      : execution;
  const swapAll = <R extends Record<string, FactoryStore.FactoryExecution | undefined>>(
    record: R | undefined,
  ): R | undefined =>
    record === undefined
      ? undefined
      : (Object.fromEntries(Object.entries(record).map(([key, value]) => [key, swap(value)])) as R);
  return {
    ...configuration,
    execution: swap(configuration.execution),
    ...(configuration.stageExecution === undefined
      ? {}
      : { stageExecution: swapAll(configuration.stageExecution) }),
    ...(configuration.executionChoices === undefined
      ? {}
      : { executionChoices: swapAll(configuration.executionChoices) }),
  };
};

/**
 * Plans, or installs, a factory's next configuration with every selection on `from` moved to `to`.
 * The write is a new revision only while the one read is still the latest, so a concurrent install
 * is reported and never overwritten. Admitted work keeps the revision it was admitted under.
 */
export const makeSwitchProvider = (store: FactoryStore.FactoryStore["Service"]) =>
  // FactoryLifecycle.switchProvider owns the span.
  Effect.fnUntraced(function* (
    input: FactorySwitchProviderInput,
    providers: ReadonlyArray<ServerProvider>,
  ): Effect.fn.Return<FactorySwitchProviderResult, FactoryStore.FactoryStoreError> {
    const named = (instanceId: ProviderInstanceId) => ({
      instanceId,
      displayName:
        providers.find((provider) => provider.instanceId === instanceId)?.displayName ?? null,
    });
    const base = {
      factoryId: input.factoryId,
      from: named(input.from),
      to: named(input.to),
      changes: [],
      alreadyOnTarget: [],
    };
    if (input.from === input.to) {
      return { ...base, outcome: "refused", reason: "from and to are the same instance" };
    }
    const configuration = yield* store.getConfiguration(input.factoryId);
    if (Option.isNone(configuration)) {
      return { ...base, outcome: "refused", reason: "the factory is not configured" };
    }
    const { revision, createdAt: _createdAt, ...current } = configuration.value;
    const plan = planProviderSwitch(current, input.from, input.to);
    const read = {
      ...base,
      revision,
      changes: plan.changes.map(({ path, modelSelection }) => ({
        path,
        model: modelSelection.model,
      })),
      alreadyOnTarget: plan.alreadyOnTarget,
    };
    if (plan.changes.length === 0) {
      return {
        ...read,
        outcome: plan.alreadyOnTarget.length > 0 ? "already_switched" : "no_match",
      };
    }
    const refusals = targetRefusals(
      providers.find((provider) => provider.instanceId === input.to),
      input.to,
      plan.changes,
    );
    if (refusals.length > 0) {
      return { ...read, outcome: "refused", reason: refusals.join(" ") };
    }
    if (!input.apply) return { ...read, outcome: "planned" };
    const written = yield* store.configureAtRevision(
      switched(current, input.from, input.to),
      revision,
    );
    if (written.type === "conflict") {
      return {
        ...read,
        outcome: "conflict",
        reason: `revision ${written.revision} was installed after revision ${revision} was read: nothing switched`,
      };
    }
    return {
      ...read,
      outcome: "switched",
      switchedRevision: written.configuration.revision,
    };
  });
