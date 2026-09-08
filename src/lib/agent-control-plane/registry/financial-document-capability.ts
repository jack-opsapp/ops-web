import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CommitFinancialDocumentInputSchema,
  InspectFinancialDocumentInputSchema,
  FINANCIAL_DOCUMENT_SCHEMA_REVISION,
  PrepareFinancialDocumentInputSchema,
} from "@/lib/agent-control-plane/contracts/financial-document";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

const AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "owner_financial_document",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.company.read",
        "ops.customers.read",
        "ops.financial_documents.prepare",
        "ops.financial_documents.read",
        "ops.jobs.read",
      ]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([
          permission("agent.review"),
          permission("clients.view"),
          permission("estimates.create"),
          permission("estimates.view"),
          permission("pipeline.view"),
          permission("projects.view"),
        ]),
      ]),
    }),
  ]),
});

export const PREPARE_FINANCIAL_DOCUMENT_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_financial_document",
  schemaRevision: FINANCIAL_DOCUMENT_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "financial_document",
  description:
    "Prepare one exact estimate or additional-scope change-order draft from authoritative OPS or explicitly attributed prices. Show every line, tax, terms, source and revision difference. Saving requires named-operator approval inside OPS. No customer acceptance, delivery, accounting export or work authorization.",
  inputSchema: PrepareFinancialDocumentInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 65_536,
    maxOutputCharacters: 262_144,
    maxResultItems: 100,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 220,
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
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.prepare_financial_document",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_FINANCIAL_DOCUMENT_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_financial_document",
  schemaRevision: FINANCIAL_DOCUMENT_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "financial_document",
  description:
    "Save the exact private financial draft approved inside OPS after current authority, pricing, source and policy revalidation; return the independently checked receipt.",
  inputSchema: CommitFinancialDocumentInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 65_536,
    maxOutputCharacters: 262_144,
    maxResultItems: 100,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: 220,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_commit",
  rateLimitBucket: "commit",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "confirmation_receipt",
    prepareCapability: "prepare_financial_document",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_financial_document",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const INSPECT_FINANCIAL_DOCUMENT_CAPABILITY_DEFINITION = Object.freeze({
  ...PREPARE_FINANCIAL_DOCUMENT_CAPABILITY_DEFINITION,
  name: "inspect_financial_document",
  operation: "read",
  writeFamily: undefined,
  description:
    "Read the exact target's authoritative financial policy, terms and requested source identities/hashes before preparing a private draft. Missing or conflicting policy blocks preparation.",
  inputSchema: InspectFinancialDocumentInputSchema,
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
  rolloutFlag: "agent_control_plane.capability.inspect_financial_document",
} as const satisfies ImplementationOnlyCapabilityDefinition);
