import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  COMPANY_OPERATIONS_SCHEMA_REVISION,
  GetIntegrationHealthInputSchema,
  INTEGRATION_HEALTH_MAX_ITEMS,
  type GetIntegrationHealthInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const INTEGRATION_HEALTH_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "accounting",
  "mailbox",
] as const);
export type IntegrationHealthAuthorizationVariantKey =
  (typeof INTEGRATION_HEALTH_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  name: CapabilityPermissionRequirement["permission"],
  scopes: readonly ("all" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze([...scopes]),
  });
}

function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

const DEFINITION = {
  name: "get_integration_health",
  schemaRevision: COMPANY_OPERATIONS_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return bounded coarse connection, sync, progress, reason, and calendar-consent health for explicitly selected integrations.",
  inputSchema: GetIntegrationHealthInputSchema,
  authorization: {
    variants: [
      {
        key: "accounting",
        selector: pendingSelector({
          kind: "input_array_object_discriminator",
          field: "integrations",
          discriminator: "integration_type",
          value: "accounting",
        }),
        requiredOAuthScopes: ["ops.integrations.read"],
        permissionRequirementGroups: [
          [
            permission("accounting.view", ["all"]),
            permission("settings.integrations", ["all"]),
          ],
        ],
      },
      {
        key: "mailbox",
        selector: pendingSelector({
          kind: "input_array_object_discriminator",
          field: "integrations",
          discriminator: "integration_type",
          value: "mailbox",
        }),
        requiredOAuthScopes: ["ops.integrations.read"],
        permissionRequirementGroups: [
          [
            permission("email.view", ["all", "own"]),
            permission("settings.integrations", ["all"]),
          ],
        ],
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 60_000,
    maxResultItems: INTEGRATION_HEALTH_MAX_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: INTEGRATION_HEALTH_MAX_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.get_integration_health",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const GET_INTEGRATION_HEALTH_CANDIDATE =
  mintP2CandidateCapability(DEFINITION);

export function selectedIntegrationHealthVariantKeys(
  input: GetIntegrationHealthInput | unknown
):
  | readonly ["accounting"]
  | readonly ["mailbox"]
  | readonly ["accounting", "mailbox"] {
  const parsed = GetIntegrationHealthInputSchema.parse(input);
  const accounting = parsed.integrations.some(
    (selection) => selection.integration_type === "accounting"
  );
  const mailbox = parsed.integrations.some(
    (selection) => selection.integration_type === "mailbox"
  );
  if (accounting && mailbox) {
    return Object.freeze(["accounting", "mailbox"] as const);
  }
  if (accounting) return Object.freeze(["accounting"] as const);
  return Object.freeze(["mailbox"] as const);
}
