import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  COMPANY_OPERATIONS_SCHEMA_REVISION,
  CompanyContextInputSchema,
  type CompanyContextInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import type { ImplementationOnlyCapabilityDefinition } from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const COMPANY_CONTEXT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "company",
] as const);
export type CompanyContextAuthorizationVariantKey =
  (typeof COMPANY_CONTEXT_AUTHORIZATION_VARIANT_KEYS)[number];

function companyPermission(): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: "settings.company",
    allowedScopes: Object.freeze(["all"] as const),
  });
}

const DEFINITION = {
  name: "get_company_context",
  schemaRevision: COMPANY_OPERATIONS_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return the current company operating profile, work window, catalog state, and public assets.",
  inputSchema: CompanyContextInputSchema,
  authorization: {
    variants: [
      {
        key: "company",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.company.read"],
        permissionRequirementGroups: [[companyPermission()]],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 1_024,
    maxOutputCharacters: 60_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: 0,
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
  rolloutFlag: "agent_control_plane.capability.get_company_context",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const COMPANY_CONTEXT_CANDIDATE = mintP2CandidateCapability(DEFINITION);

export function selectedCompanyContextVariantKeys(
  input: CompanyContextInput | unknown
): readonly CompanyContextAuthorizationVariantKey[] {
  CompanyContextInputSchema.parse(input);
  return COMPANY_CONTEXT_AUTHORIZATION_VARIANT_KEYS;
}
