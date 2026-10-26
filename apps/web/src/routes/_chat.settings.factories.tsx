import { createFileRoute } from "@tanstack/react-router";

import { FactoriesSettings } from "../components/settings/FactoriesSettings";

export const Route = createFileRoute("/_chat/settings/factories")({
  component: FactoriesSettings,
});
