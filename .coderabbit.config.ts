import { defineConfig, type CodeRabbitConfig, type CodeRabbitContext } from "@coderabbitai/config";

// The SDK requires unexported enums here; these literals match the service's configuration schema.
type KnowledgeBase = NonNullable<CodeRabbitConfig["knowledge_base"]>;
const localScope = "local" as NonNullable<KnowledgeBase["issues"]>["scope"];
const disabledIntegration = "disabled" as NonNullable<KnowledgeBase["mcp"]>["usage"];

const UNGATED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const isGated = ({ pr }: CodeRabbitContext) => !UNGATED_AUTHORS.has(pr?.authorAssociation ?? "");

export default defineConfig((ctx) => ({
  inheritance: false,
  reviews: {
    high_level_summary: false,
    review_status: false,
    request_changes_workflow: false,
    related_issues: false,
    related_prs: false,
    allow_author_approval: !isGated(ctx),
    auto_review: {
      enabled: false,
    },
    pre_merge_checks: {
      docstrings: { mode: "off" },
      override_requested_reviewers_only: isGated(ctx),
    },
    path_filters: ["!.repos/**"],
    path_instructions: [
      {
        path: "{apps,packages,infra}/**/*.ts",
        instructions: "Hold changed code to the rules in docs/internals/effect-services.md.",
      },
      {
        path: "apps/web/src/**/*.{tsx,css}",
        instructions: "Hold changed code to the rules in docs/internals/web-ui.md.",
      },
    ],
  },
  knowledge_base: {
    automatic_linking_mode: "disabled",
    linked_repositories: [],
    issues: { scope: localScope },
    pull_requests: { scope: localScope },
    learnings: { scope: localScope },
    jira: { usage: disabledIntegration },
    linear: { usage: disabledIntegration },
    mcp: { usage: disabledIntegration },
    web_search: { enabled: false },
    code_guidelines: {
      filePatterns: [
        { files: "docs/internals/effect-services.md", applyTo: "{apps,packages,infra}/**/*.ts" },
        { files: "docs/internals/web-ui.md", applyTo: "apps/web/src/**/*.{tsx,css}" },
      ],
    },
  },
}));
