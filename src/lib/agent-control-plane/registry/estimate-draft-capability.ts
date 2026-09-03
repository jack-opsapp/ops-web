import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  ESTIMATE_DRAFT_MAX_EVIDENCE_REFS,
  ESTIMATE_DRAFT_MAX_LINE_ITEMS,
  ESTIMATE_DRAFT_MAX_OUTPUT_CHARACTERS,
  ESTIMATE_DRAFT_SCHEMA_REVISION,
  PrepareEstimateFromPastJobInputSchema,
} from "@/lib/agent-control-plane/contracts/estimate-draft";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const PREPARE_ESTIMATE_FROM_PAST_JOB_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "prepare_estimate_from_past_job",
    schemaRevision: ESTIMATE_DRAFT_SCHEMA_REVISION,
    operation: "prepare",
    writeFamily: "estimate_draft",
    description:
      "Prepare an exact draft-estimate preview from one authorized completed job and a deterministic percentage increase. Returns auditable source facts, derived line pricing, current tax, deposit terms, totals, and an exact preview hash. Creates no estimate, reserves no number, and never issues, approves, publishes, sends, or commits pricing. Ordinary transport audit and rate-limit metadata is still recorded.",
    inputSchema: PrepareEstimateFromPastJobInputSchema,
    authorization: {
      variants: [
        {
          key: "owner_estimate_draft",
          selector: { kind: "always" },
          requiredOAuthScopes: [
            "ops.company.read",
            "ops.customers.read",
            "ops.financial_documents.read",
            "ops.financials.prepare",
            "ops.jobs.read",
          ],
          permissionRequirementGroups: [
            [
              permission("clients.view"),
              permission("estimates.create"),
              permission("estimates.view"),
              permission("pipeline.view"),
              permission("projects.view"),
              permission("settings.company"),
            ],
          ],
        },
      ],
    },
    riskTier: "high",
    bounds: {
      maxInputBytes: 512,
      maxOutputCharacters: ESTIMATE_DRAFT_MAX_OUTPUT_CHARACTERS,
      maxResultItems: ESTIMATE_DRAFT_MAX_LINE_ITEMS,
      maxBatchItems: ESTIMATE_DRAFT_MAX_LINE_ITEMS,
    },
    evidencePolicy: {
      input: "not_required",
      output: "required",
      maxEvidenceRefs: ESTIMATE_DRAFT_MAX_EVIDENCE_REFS,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: "mutation_prepare",
    rateLimitBucket: "prepare",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    confirmationPolicy: {
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    },
    idempotencyPolicy: { kind: "inherent" },
    availability: { implementation: "available" },
    rolloutFlag:
      "agent_control_plane.capability.prepare_estimate_from_past_job",
  } as const satisfies ImplementationOnlyCapabilityDefinition);
