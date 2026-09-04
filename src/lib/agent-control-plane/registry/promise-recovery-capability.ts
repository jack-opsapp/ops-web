import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CheckCustomerReplyInputSchema,
  PROMISE_RECOVERY_MAX_ATTACHMENT_REFS,
  PROMISE_RECOVERY_MAX_CHRONOLOGY_ITEMS,
  PROMISE_RECOVERY_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/promise-recovery";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const PROMISE_RECOVERY_CAPABILITY_DEFINITION = Object.freeze({
  name: "check_customer_reply",
  schemaRevision: PROMISE_RECOVERY_SCHEMA_REVISION,
  operation: "read",
  description:
    "Check whether the current operator replied to one exact customer about one topic. Returns delivered correspondence, exact chronology, and any evidence gaps. Creates no draft and changes nothing.",
  inputSchema: CheckCustomerReplyInputSchema,
  authorization: {
    variants: [
      {
        key: "customer_correspondence",
        selector: { kind: "always" },
        requiredOAuthScopes: [
          "ops.correspondence.read",
          "ops.customer_contacts.read",
          "ops.customers.read",
        ],
        permissionRequirementGroups: [
          [permission("clients.view"), permission("email.view")],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 120_000,
    maxResultItems: PROMISE_RECOVERY_MAX_CHRONOLOGY_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs:
      PROMISE_RECOVERY_MAX_CHRONOLOGY_ITEMS * 2 +
      PROMISE_RECOVERY_MAX_ATTACHMENT_REFS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "evidence_read",
  rateLimitBucket: "evidence_search",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: { kind: "not_required" },
  idempotencyPolicy: { kind: "inherent" },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.check_customer_reply",
} as const satisfies ImplementationOnlyCapabilityDefinition);
