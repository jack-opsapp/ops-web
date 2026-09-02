import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  SALES_TRUTH_MAX_SUPPORTING_RECORDS,
  SALES_TRUTH_SCHEMA_REVISION,
  SALES_TRUTH_WINDOW_DAYS,
  AnalyzeSalesTruthInputSchema,
} from "@/lib/agent-control-plane/contracts/sales-truth";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const ANALYZE_SALES_TRUTH_CAPABILITY_DEFINITION = Object.freeze({
  name: "analyze_sales_truth",
  schemaRevision: SALES_TRUTH_SCHEMA_REVISION,
  operation: "read",
  description:
    "Explain recent lead close rate, attribution, recorded loss reasons, first-response time, and pipeline velocity, then rank the first supportable repair. Read-only. Stores nothing.",
  inputSchema: AnalyzeSalesTruthInputSchema,
  authorization: {
    variants: [
      {
        key: "company_sales_truth",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.correspondence.read", "ops.operations.read"],
        permissionRequirementGroups: [
          [permission("email.view"), permission("pipeline.view")],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 1_024,
    maxOutputCharacters: 120_000,
    maxResultItems: SALES_TRUTH_MAX_SUPPORTING_RECORDS,
    maxWindowDays: SALES_TRUTH_WINDOW_DAYS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: SALES_TRUTH_MAX_SUPPORTING_RECORDS,
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
  rolloutFlag: "agent_control_plane.capability.analyze_sales_truth",
} as const satisfies ImplementationOnlyCapabilityDefinition);
