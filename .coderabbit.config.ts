import {
  defineConfig,
  type CodeRabbitConfig,
  type CodeRabbitContext,
} from "@coderabbitai/config";

// The SDK requires unexported enums here; these literals match the service's configuration schema.
type KnowledgeBase = NonNullable<CodeRabbitConfig["knowledge_base"]>;
const localScope = "local" as NonNullable<KnowledgeBase["issues"]>["scope"];
const disabledIntegration = "disabled" as NonNullable<
  KnowledgeBase["mcp"]
>["usage"];

const UNGATED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const isGated = ({ pr }: CodeRabbitContext) =>
  !UNGATED_AUTHORS.has(pr?.authorAssociation ?? "");

export default defineConfig((ctx) => ({
  inheritance: false,
  reviews: {
    profile: "assertive",
    enable_prompt_for_ai_agents: true,
    suggested_reviewers: true,
    suggested_labels: true,
    assess_linked_issues: true,
    estimate_code_review_effort: true,
    sequence_diagrams: true,
    changed_files_summary: true,
    review_details: true,
    review_info: true,
    high_level_summary: true,
    review_status: true,
    request_changes_workflow: false,
    related_issues: true,
    related_prs: true,
    allow_author_approval: !isGated(ctx),
    auto_review: {
      ignore_title_keywords: ["chore:", "chore(", "docs:", "docs(", "test:", "test(", "ci:", "ci(", "build:", "build(", "style:", "style(", "WIP"],
      enabled: true,
      auto_incremental_review: false,
      auto_pause_after_reviewed_commits: 0,
      base_branches: [".*"],
      drafts: false,
    },
    tools: {
      gitleaks: { enabled: true },
      shellcheck: { enabled: true },
      markdownlint: { enabled: true },
      "github-checks": { enabled: true },
      yamllint: { enabled: true },
      semgrep: { enabled: true },
      opengrep: { enabled: true },
      osvScanner: { enabled: true },
      presidio: { enabled: true },
      oxc: { enabled: true },
      reactDoctor: { enabled: true },
      hadolint: { enabled: true },
      checkov: { enabled: true },
      trivy: { enabled: true },
      clippy: { enabled: true },
      psscriptanalyzer: { enabled: true },
      actionlint: { enabled: true },
      zizmor: { enabled: true },
    },
    finishing_touches: {
      docstrings: {
        enabled: true,
      },
      autofix: {
        enabled: true,
      },
      unit_tests: {
        enabled: false,
      },
      fix_ci: {
        enabled: false,
      },
      resolve_merge_conflict: {
        enabled: false,
      },
      simplify: {
        enabled: false,
      },
    },
    pre_merge_checks: {
      title: { mode: "warning" },
      description: { mode: "warning" },
      issue_assessment: { mode: "warning" },
      docstrings: { mode: "warning" },
      override_requested_reviewers_only: isGated(ctx),
    },
    path_filters: ["!.repos/**"],
    path_instructions: [
      {
        path: "{apps,packages,infra}/**/*.ts",
        instructions:
          "Hold changed code to the rules in docs/internals/effect-services.md.",
      },
      {
        path: "apps/web/src/**/*.{tsx,css}",
        instructions:
          "Hold changed code to the rules in docs/internals/web-ui.md.",
      },
    ],
  },
  chat: { auto_reply: true },
  knowledge_base: {
    opt_out: false,
    automatic_linking_mode: "disabled",
    linked_repositories: [],
    issues: { scope: localScope },
    pull_requests: { scope: localScope },
    learnings: { scope: localScope },
    jira: { usage: disabledIntegration },
    linear: { usage: disabledIntegration },
    mcp: { usage: disabledIntegration },
    web_search: { enabled: true },
    code_guidelines: {
      filePatterns: [
        {
          files: "docs/internals/effect-services.md",
          applyTo: "{apps,packages,infra}/**/*.ts",
        },
        {
          files: "docs/internals/web-ui.md",
          applyTo: "apps/web/src/**/*.{tsx,css}",
        },
      ],
    },
  },
}));
