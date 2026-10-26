import {
  type FactoryDecisionAnswer,
  type FactoryDecisionEntry,
  factoryDecisionAnswerInput,
  factoryItemLabel,
  factorySummary,
  pendingFactoryDecisions,
} from "@t3tools/client-runtime/factory-decisions";
import { AuthOrchestrationOperateScope, type FactoryOverview } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "./components/SettingsActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

/**
 * Factories' state and the decisions only their owner can make, read from and answered through
 * the same service record the web settings and the MCP owner tools use.
 */
export function SettingsFactoriesRouteScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const operable = useEnvironmentsWithScope(selectedTargets, AuthOrchestrationOperateScope);
  const insets = useSafeAreaInsets();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Factories" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length === 0 ? (
            <Text className="text-foreground-muted">Select a connected environment.</Text>
          ) : (
            selectedTargets.map((environment) => (
              <FactoryEnvironmentSection
                key={environment.environmentId}
                environment={environment}
                canAct={operable.has(environment.environmentId)}
              />
            ))
          )}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function FactoryEnvironmentSection({
  environment,
  canAct,
}: {
  readonly environment: SettingsTarget;
  readonly canAct: boolean;
}) {
  const overview = useEnvironmentQuery(
    serverEnvironment.factoryOverview({ environmentId: environment.environmentId, input: {} }),
  );
  return (
    <SettingsSection title={environment.label}>
      {overview.error ? (
        <ListRowLayout label="Could not load factories" description={overview.error} />
      ) : overview.data === null ? (
        <ListRowLayout label="Loading factories…" />
      ) : overview.data.factories.length === 0 ? (
        <ListRowLayout
          label="No factories"
          description="No factory is configured in this environment."
        />
      ) : (
        <FactoryOverviewRows
          environment={environment}
          overview={overview.data}
          canAct={canAct}
          onChanged={overview.refresh}
        />
      )}
    </SettingsSection>
  );
}

function FactoryOverviewRows({
  environment,
  overview,
  canAct,
  onChanged,
}: {
  readonly environment: SettingsTarget;
  readonly overview: FactoryOverview;
  readonly canAct: boolean;
  readonly onChanged: () => void;
}) {
  const pending = pendingFactoryDecisions(overview);
  return (
    <>
      {overview.factories.map(({ factoryId, state }) => (
        <ListRowLayout
          key={factoryId}
          label={factoryId}
          description={factorySummary(state)}
          {...(state.issues.length === 0
            ? {}
            : {
                detail: state.issues.map((issue) => `${issue.kind}: ${issue.detail}`).join(" · "),
              })}
        />
      ))}
      {pending.length === 0 ? <ListRowLayout label="Nothing is waiting for you" /> : null}
      {pending.map((decision) => (
        <FactoryDecisionRows
          key={decision.decisionId}
          environment={environment}
          decision={decision}
          canAct={canAct}
          onAnswered={onChanged}
        />
      ))}
      {overview.factories.flatMap(({ factoryId, state }) =>
        state.grants
          .filter((grant) => grant.state === "active")
          .map((grant) => (
            <FactoryGrantRow
              key={grant.grantId}
              environment={environment}
              factoryId={factoryId}
              grant={grant}
              canAct={canAct}
              onRevoked={onChanged}
            />
          )),
      )}
    </>
  );
}

function FactoryDecisionRows({
  environment,
  decision,
  canAct,
  onAnswered,
}: {
  readonly environment: SettingsTarget;
  readonly decision: FactoryDecisionEntry;
  readonly canAct: boolean;
  readonly onAnswered: () => void;
}) {
  const answer = useAtomCommand(serverEnvironment.answerFactoryDecision, "factory decision answer");
  const [busy, setBusy] = useState(false);
  const submit = async (choice: FactoryDecisionAnswer) => {
    const input = factoryDecisionAnswerInput(decision, choice);
    if (busy || input === null) return;
    setBusy(true);
    const result = await answer({ environmentId: environment.environmentId, input });
    setBusy(false);
    if (result._tag === "Success") onAnswered();
    else if (!isAtomCommandInterrupted(result)) {
      Dialog.alert("The factory refused this answer", refusalOf(result));
    }
  };
  const disabled = busy || !canAct;
  return (
    <View>
      <ListRowLayout
        label={`${factoryItemLabel(decision.itemKey)} · ${decision.stage}`}
        description={decision.reason}
        detail={`${decision.factoryId} · waiting since ${new Date(decision.createdAt).toLocaleString()}`}
      />
      {decision.kind === "grant" ? (
        <SettingsActionRow
          label="Grant one start"
          disabled={disabled}
          onPress={() => void submit({ type: "grant", units: 1 })}
        />
      ) : (
        <SettingsActionRow
          label="Approve"
          disabled={disabled}
          onPress={() => void submit({ type: "approve" })}
        />
      )}
      <SettingsActionRow
        label="Decline"
        tone="danger"
        disabled={disabled}
        onPress={() => void submit({ type: "decline" })}
      />
    </View>
  );
}

function FactoryGrantRow({
  environment,
  factoryId,
  grant,
  canAct,
  onRevoked,
}: {
  readonly environment: SettingsTarget;
  readonly factoryId: FactoryOverview["factories"][number]["factoryId"];
  readonly grant: FactoryOverview["factories"][number]["state"]["grants"][number];
  readonly canAct: boolean;
  readonly onRevoked: () => void;
}) {
  const revoke = useAtomCommand(serverEnvironment.revokeFactoryGrant, "factory grant revoke");
  const [busy, setBusy] = useState(false);
  return (
    <SettingsActionRow
      label={`Revoke grant for ${factoryItemLabel(grant.itemKey)} · ${grant.stage}`}
      description={`${grant.remaining} of ${grant.units} supervised start(s) left`}
      tone="danger"
      loading={busy}
      disabled={!canAct}
      onPress={() => {
        setBusy(true);
        void revoke({
          environmentId: environment.environmentId,
          input: { factoryId, grantId: grant.grantId },
        }).then((result) => {
          setBusy(false);
          if (result._tag === "Success") onRevoked();
          else if (!isAtomCommandInterrupted(result)) {
            Dialog.alert("The factory refused to revoke this grant", refusalOf(result));
          }
        });
      }}
    />
  );
}

/** The destination's own reason: a missing permission there, or a decision already settled. */
function refusalOf(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error ? failure.message : String(failure);
}
