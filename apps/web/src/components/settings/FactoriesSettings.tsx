import { useAtomValue } from "@effect/atom-react";
import {
  type FactoryDecisionAnswer,
  type FactoryDecisionEntry,
  type FactoryOwnerAction,
  factoryDecisionAnswerInput,
  factoryItemLabel,
  factoryOwnerActionInput,
  factorySummary,
  pendingFactoryDecisions,
} from "@t3tools/client-runtime/factory-decisions";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type FactoryOverview,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { useState } from "react";

import { readEnvironmentScope } from "~/state/session";
import type { EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

/**
 * Factories' state and the decisions only their owner can make, read from and answered through
 * the same service record the MCP owner tools use. Nothing here waits in a model turn.
 */
export function FactoriesSettings() {
  const { environments } = useSettingsScope();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Factories" variant="plain">
        {environments.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No environments available</EmptyTitle>
              <EmptyDescription>Connect an environment to see its factories.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-8">
            {environments.map((environment) => (
              <FactoryEnvironmentSection
                key={environment.environmentId}
                environment={environment}
                showHeading={environments.length > 1}
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function FactoryEnvironmentSection({
  environment,
  showHeading,
}: {
  readonly environment: EnvironmentPresentation;
  readonly showHeading: boolean;
}) {
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const overview = useEnvironmentQuery(
    connected
      ? serverEnvironment.factoryOverview({ environmentId: environment.environmentId, input: {} })
      : null,
  );
  return (
    <SettingsSection
      title={environment.label}
      hideTitle={!showHeading}
      icon={
        <EnvironmentMachineIcon
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          className="size-3.5"
        />
      }
    >
      {!connected ? (
        <SettingsRow
          title="Environment disconnected"
          description={`Reconnect ${environment.label} to see its factories.`}
        />
      ) : overview.error ? (
        <SettingsRow title="Could not load factories" description={overview.error} />
      ) : overview.data === null ? (
        <SettingsRow title="Loading factories…" role="status" />
      ) : overview.data.factories.length === 0 ? (
        <SettingsRow
          title="No factories"
          description="No factory is configured in this environment."
        />
      ) : (
        <FactoryOverviewRows
          environmentId={environment.environmentId}
          overview={overview.data}
          onChanged={overview.refresh}
        />
      )}
      {connected ? (
        <FactoryOwnerActions
          environmentId={environment.environmentId}
          onChanged={overview.refresh}
        />
      ) : null}
    </SettingsSection>
  );
}

function FactoryOverviewRows({
  environmentId,
  overview,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly overview: FactoryOverview;
  readonly onChanged: () => void;
}) {
  const pending = pendingFactoryDecisions(overview);
  return (
    <>
      {overview.factories.map(({ factoryId, state }) => (
        <SettingsRow
          key={factoryId}
          title={factoryId}
          description={factorySummary(state)}
          status={
            state.issues.length === 0 ? undefined : (
              <span className="text-destructive">
                {state.issues.map((issue) => `${issue.kind}: ${issue.detail}`).join(" · ")}
              </span>
            )
          }
        />
      ))}
      {pending.length === 0 ? (
        <SettingsRow title="Nothing is waiting for you" />
      ) : (
        pending.map((decision) => (
          <FactoryDecisionRow
            key={decision.decisionId}
            environmentId={environmentId}
            decision={decision}
            onAnswered={onChanged}
          />
        ))
      )}
      {overview.factories.flatMap(({ factoryId, state }) =>
        state.grants
          .filter((grant) => grant.state === "active")
          .map((grant) => (
            <FactoryGrantRow
              key={grant.grantId}
              environmentId={environmentId}
              factoryId={factoryId}
              grant={grant}
              onRevoked={onChanged}
            />
          )),
      )}
    </>
  );
}

const failureToast = (title: string, description: string) =>
  toastManager.add(stackedThreadToast({ type: "error", title, description }));

function FactoryDecisionRow({
  environmentId,
  decision,
  onAnswered,
}: {
  readonly environmentId: EnvironmentId;
  readonly decision: FactoryDecisionEntry;
  readonly onAnswered: () => void;
}) {
  const canAnswer = useAtomValue(
    serverEnvironment.answerFactoryDecision.permissionAtom(environmentId),
  );
  const answer = useAtomCommand(serverEnvironment.answerFactoryDecision, {
    label: "factory decision answer",
  });
  const [busy, setBusy] = useState(false);
  const submit = async (choice: FactoryDecisionAnswer) => {
    const input = factoryDecisionAnswerInput(decision, choice);
    if (
      busy ||
      input === null ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }
    setBusy(true);
    const result = await answer({ environmentId, input });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      failureToast("Could not answer the factory", String(squashAtomCommandFailure(result)));
      return;
    }
    onAnswered();
  };
  const disabled = busy || !canAnswer;
  return (
    <SettingsRow
      title={`${factoryItemLabel(decision.itemKey)} · ${decision.stage}`}
      description={decision.reason}
      status={`${decision.factoryId} · waiting since ${new Date(decision.createdAt).toLocaleString()}`}
      control={
        <div className="flex flex-wrap items-center gap-2">
          {decision.kind === "grant" ? (
            <Button
              size="xs"
              variant="default"
              disabled={disabled}
              onClick={() => void submit({ type: "grant", units: 1 })}
            >
              Grant one start
            </Button>
          ) : (
            <Button
              size="xs"
              variant="default"
              disabled={disabled}
              onClick={() => void submit({ type: "approve" })}
            >
              Approve
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void submit({ type: "decline" })}
          >
            Decline
          </Button>
        </div>
      }
    />
  );
}

function FactoryGrantRow({
  environmentId,
  factoryId,
  grant,
  onRevoked,
}: {
  readonly environmentId: EnvironmentId;
  readonly factoryId: FactoryOverview["factories"][number]["factoryId"];
  readonly grant: FactoryOverview["factories"][number]["state"]["grants"][number];
  readonly onRevoked: () => void;
}) {
  const canRevoke = useAtomValue(
    serverEnvironment.revokeFactoryGrant.permissionAtom(environmentId),
  );
  const revoke = useAtomCommand(serverEnvironment.revokeFactoryGrant, {
    label: "factory grant revoke",
  });
  const [busy, setBusy] = useState(false);
  return (
    <SettingsRow
      title={`Grant for ${factoryItemLabel(grant.itemKey)} · ${grant.stage}`}
      description={`${grant.remaining} of ${grant.units} supervised start(s) left`}
      control={
        <Button
          size="xs"
          variant="destructive-outline"
          disabled={busy || !canRevoke}
          onClick={() => {
            setBusy(true);
            void revoke({ environmentId, input: { factoryId, grantId: grant.grantId } }).then(
              (result) => {
                setBusy(false);
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  failureToast(
                    "Could not revoke the grant",
                    String(squashAtomCommandFailure(result)),
                  );
                  return;
                }
                onRevoked();
              },
            );
          }}
        >
          Revoke
        </Button>
      }
    />
  );
}

const OWNER_ACTIONS: ReadonlyArray<{
  readonly action: FactoryOwnerAction;
  readonly label: string;
  readonly placeholder: string;
}> = [
  {
    action: "configure",
    label: "Install configuration",
    placeholder:
      'The factory\'s configuration document. Install it with "enabled": false; start it by installing it again with "enabled": true.',
  },
  {
    action: "observe",
    label: "Observe claims",
    placeholder:
      '{ "factoryId": "…" } records other writers\x27 claims as held work and starts nothing.',
  },
  {
    action: "transfer",
    label: "Transfer legacy work",
    placeholder: '{ "factoryId": "…", "transferId": "…", "job": "…", "items": [...] }',
  },
  {
    action: "rollback",
    label: "Roll back transfer",
    placeholder: '{ "factoryId": "…", "transferId": "…", "reason": "…" }',
  },
  {
    action: "dispose",
    label: "Dispose of claims",
    placeholder: 'One or a list of { "factoryId": "…", "reservationId": "…", "reason": "…" }',
  },
];

const readback = (result: AtomCommandResult<unknown, unknown>) =>
  result._tag === "Success" ? JSON.stringify(result.value, null, 2) : undefined;

/**
 * Installing a factory and taking legacy work over, through the same service record the owner
 * MCP tools use. Each request is checked against the factory's schema here and again on the server.
 */
function FactoryOwnerActions({
  environmentId,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly onChanged: () => void;
}) {
  const canConfigure = useAtomValue(
    serverEnvironment.installFactoryConfiguration.permissionAtom(environmentId),
  );
  const canOperate = useAtomValue(
    serverEnvironment.disposeFactoryClaim.permissionAtom(environmentId),
  );
  const install = useAtomCommand(serverEnvironment.installFactoryConfiguration, {
    label: "factory configuration install",
  });
  const observe = useAtomCommand(serverEnvironment.observeFactoryClaims, {
    label: "factory claims observe",
  });
  const transfer = useAtomCommand(serverEnvironment.transferFactoryWork, {
    label: "factory transfer",
  });
  const rollback = useAtomCommand(serverEnvironment.rollbackFactoryTransfer, {
    label: "factory transfer rollback",
  });
  const dispose = useAtomCommand(serverEnvironment.disposeFactoryClaim, {
    label: "factory claim disposal",
  });
  const [action, setAction] = useState<FactoryOwnerAction>("configure");
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = OWNER_ACTIONS.find((entry) => entry.action === action)!;
  const allowed = action === "configure" ? canConfigure : canOperate;

  const apply = async () => {
    const parsed = factoryOwnerActionInput(action, text);
    if ("error" in parsed) {
      failureToast("Not a valid request", parsed.error);
      return;
    }
    setBusy(true);
    const settled: Array<AtomCommandResult<unknown, unknown>> = [];
    switch (parsed.action) {
      case "configure":
        settled.push(await install({ environmentId, input: parsed.input }));
        break;
      case "observe":
        settled.push(await observe({ environmentId, input: parsed.input }));
        break;
      case "transfer":
        settled.push(await transfer({ environmentId, input: parsed.input }));
        break;
      case "rollback":
        settled.push(await rollback({ environmentId, input: parsed.input }));
        break;
      case "dispose":
        // One at a time, in the order given, stopping at the first the server refuses.
        for (const input of parsed.inputs) {
          const outcome = await dispose({ environmentId, input });
          settled.push(outcome);
          if (outcome._tag === "Failure") break;
        }
        break;
    }
    setBusy(false);
    const failure = settled.find((outcome) => outcome._tag === "Failure");
    if (failure !== undefined && !isAtomCommandInterrupted(failure)) {
      failureToast(
        `Could not ${selected.label.toLowerCase()}`,
        String(squashAtomCommandFailure(failure)),
      );
    }
    setResult(
      settled
        .map(readback)
        .filter((entry) => entry !== undefined)
        .join("\n"),
    );
    onChanged();
  };

  return (
    <SettingsRow
      title="Owner actions"
      description="Install a factory, record and dispose of other writers' claims, and transfer legacy work."
      control={
        <div className="flex w-full max-w-xl flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {OWNER_ACTIONS.map((entry) => (
              <Button
                key={entry.action}
                size="xs"
                variant={entry.action === action ? "default" : "outline"}
                onClick={() => setAction(entry.action)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
          <Textarea
            aria-label={selected.label}
            placeholder={selected.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
          />
          <div className="flex items-center gap-2">
            <Button size="xs" disabled={busy || !allowed} onClick={() => void apply()}>
              {selected.label}
            </Button>
            {allowed ? null : (
              <span className="text-muted-foreground text-xs">
                This session cannot do that here.
              </span>
            )}
          </div>
          {result === null || result.length === 0 ? null : (
            <pre className="max-h-64 overflow-auto text-xs" aria-label="Owner action result">
              {result}
            </pre>
          )}
        </div>
      }
    />
  );
}
