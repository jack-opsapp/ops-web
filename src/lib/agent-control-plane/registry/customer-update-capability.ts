import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CommitCustomerUpdateInputSchema,
  CUSTOMER_UPDATE_SCHEMA_REVISION,
  PrepareCustomerUpdateInputSchema,
} from "@/lib/agent-control-plane/contracts/customer-update";
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
      key: "owner_customer_update",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.jobs.read",
        "ops.customers.read",
        "ops.customers.prepare",
        "ops.correspondence.read",
        "ops.team.read",
      ]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([
          permission("agent.review"),
          permission("pipeline.view"),
          permission("pipeline.edit"),
          permission("team.view"),
        ]),
      ]),
    }),
  ]),
});

export const PREPARE_CUSTOMER_UPDATE_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_customer_update",
  schemaRevision: CUSTOMER_UPDATE_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "customer_update",
  description:
    "Prepare an exact before/after preview for one existing opportunity and optional linked customer notes, with attributed evidence. Business updates require approval inside OPS; no messages, provider drafts, schedules or accounting changes are authorized.",
  inputSchema: PrepareCustomerUpdateInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 32_768,
    maxOutputCharacters: 48_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 5,
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
  rolloutFlag: "agent_control_plane.capability.prepare_customer_update",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_CUSTOMER_UPDATE_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_customer_update",
  schemaRevision: CUSTOMER_UPDATE_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "customer_update",
  description:
    "Commit one exact customer/opportunity update approved inside OPS after current authority, policy and source revalidation; return the independently checked receipt.",
  inputSchema: CommitCustomerUpdateInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 32_768,
    maxOutputCharacters: 8_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: 5,
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
    prepareCapability: "prepare_customer_update",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_customer_update",
} as const satisfies ImplementationOnlyCapabilityDefinition);
