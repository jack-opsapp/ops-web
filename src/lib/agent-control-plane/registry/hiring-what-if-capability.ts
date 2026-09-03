import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  HIRING_WHAT_IF_MAX_SUPPORTING_RECORDS,
  HIRING_WHAT_IF_SCHEMA_REVISION,
  HIRING_WHAT_IF_WINDOW_WEEKS,
  AnalyzeHiringBreakEvenInputSchema,
} from "@/lib/agent-control-plane/contracts/hiring-what-if";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const ANALYZE_HIRING_BREAK_EVEN_CAPABILITY_DEFINITION = Object.freeze({
  name: "analyze_hiring_break_even",
  schemaRevision: HIRING_WHAT_IF_SCHEMA_REVISION,
  operation: "read",
  description:
    "Calculate when a second member in one exact current role covers a standard week of all-in employer cost, using OPS-owned capacity and cash-contribution definitions. Read-only. Stores nothing.",
  inputSchema: AnalyzeHiringBreakEvenInputSchema,
  authorization: {
    variants: [
      {
        key: "company_hiring_analysis",
        selector: { kind: "always" },
        requiredOAuthScopes: [
          "ops.company.read",
          "ops.expenses.read",
          "ops.financial_documents.read",
          "ops.financials.read",
          "ops.jobs.read",
          "ops.payments.read",
          "ops.schedule.read",
          "ops.site_visits.read",
          "ops.tasks.read",
          "ops.team.read",
        ],
        permissionRequirementGroups: [
          [
            permission("calendar.view"),
            permission("expenses.view"),
            permission("invoices.view"),
            permission("projects.view"),
            permission("projects.view_financials"),
            permission("reports.view"),
            permission("settings.company"),
            permission("team.view"),
            permission("tasks.view"),
          ],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 120_000,
    maxResultItems: HIRING_WHAT_IF_MAX_SUPPORTING_RECORDS,
    maxWindowDays: HIRING_WHAT_IF_WINDOW_WEEKS * 7,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: HIRING_WHAT_IF_MAX_SUPPORTING_RECORDS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "sensitive_read",
  rateLimitBucket: "lightweight_read",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: { kind: "not_required" },
  idempotencyPolicy: { kind: "inherent" },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.analyze_hiring_break_even",
} as const satisfies ImplementationOnlyCapabilityDefinition);
