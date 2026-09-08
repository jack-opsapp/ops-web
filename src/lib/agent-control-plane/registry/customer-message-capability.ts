import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CustomerMessageCommitInputSchema,
  CustomerMessagePrepareInputSchema,
  CUSTOMER_MESSAGE_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/customer-message";
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
      key: "individual_customer_reply",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.communications.prepare",
        "ops.correspondence.read",
        "ops.customers.read",
        "ops.jobs.read",
      ]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([
          permission("agent.review"),
          permission("clients.view"),
          permission("inbox.send"),
          permission("inbox.view"),
          permission("pipeline.view"),
        ]),
      ]),
    }),
  ]),
});

export const PREPARE_CUSTOMER_MESSAGE_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_customer_message",
  schemaRevision: CUSTOMER_MESSAGE_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "customer_message",
  description:
    "Prepare one exact reply in an existing customer email thread. OPS resolves the individual sender and single recipient from current correspondence; approval and sending remain inside OPS.",
  inputSchema: CustomerMessagePrepareInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "critical",
  bounds: {
    maxInputBytes: 32_768,
    maxOutputCharacters: 48_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 1,
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
  rolloutFlag: "agent_control_plane.capability.prepare_customer_message",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_CUSTOMER_MESSAGE_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_customer_message",
  schemaRevision: CUSTOMER_MESSAGE_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "customer_message",
  description:
    "Execute one exact customer email approved inside OPS and return the durable provider and reconciliation state.",
  inputSchema: CustomerMessageCommitInputSchema,
  authorization: AUTHORIZATION,
  riskTier: "critical",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 8_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: 1,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "external_commit",
  rateLimitBucket: "commit",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  confirmationPolicy: {
    kind: "confirmation_receipt",
    prepareCapability: "prepare_customer_message",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_customer_message",
} as const satisfies ImplementationOnlyCapabilityDefinition);
