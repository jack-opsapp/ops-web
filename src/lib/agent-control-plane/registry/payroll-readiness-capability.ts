import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CheckPayrollReadinessInputSchema,
  PAYROLL_READINESS_MAX_HORIZON_DAYS,
  PAYROLL_READINESS_MAX_OUTPUT_CHARACTERS,
  PAYROLL_READINESS_MAX_RESULT_ITEMS,
  PAYROLL_READINESS_MAX_SUPPORTING_RECORDS,
  PAYROLL_READINESS_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/payroll-readiness";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const CHECK_PAYROLL_READINESS_CAPABILITY_DEFINITION = Object.freeze({
  name: "check_payroll_readiness",
  schemaRevision: PAYROLL_READINESS_SCHEMA_REVISION,
  operation: "read",
  description:
    "Check whether current OPS-recorded cash can cover payroll on one exact company-local date. Returns sourced obligations, actual payer-delay evidence, conservative scenarios, freshness, and precise gaps. Read-only. Stores nothing.",
  inputSchema: CheckPayrollReadinessInputSchema,
  authorization: {
    variants: [
      {
        key: "company_payroll_readiness",
        selector: { kind: "always" },
        requiredOAuthScopes: [
          "ops.company.read",
          "ops.expenses.read",
          "ops.financial_documents.read",
          "ops.financials.read",
          "ops.payments.read",
        ],
        permissionRequirementGroups: [
          [
            permission("expenses.view"),
            permission("invoices.view"),
            permission("reports.view"),
            permission("settings.company"),
          ],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 1_024,
    maxOutputCharacters: PAYROLL_READINESS_MAX_OUTPUT_CHARACTERS,
    maxResultItems: PAYROLL_READINESS_MAX_RESULT_ITEMS,
    maxWindowDays: PAYROLL_READINESS_MAX_HORIZON_DAYS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: PAYROLL_READINESS_MAX_SUPPORTING_RECORDS,
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
  rolloutFlag: "agent_control_plane.capability.check_payroll_readiness",
} as const satisfies ImplementationOnlyCapabilityDefinition);
