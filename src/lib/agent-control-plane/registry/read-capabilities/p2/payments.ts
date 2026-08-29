import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  ListPaymentsInputSchema,
  PAYMENT_MAX_PAGE_ITEMS,
  PAYMENT_READ_SCHEMA_REVISION,
  type ListPaymentsInput,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const PAYMENT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "payment",
] as const);
export type PaymentAuthorizationVariantKey =
  (typeof PAYMENT_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permissionName: CapabilityPermissionRequirement["permission"],
  allowedScopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze([...allowedScopes]),
  });
}

const PAYMENT_POLICY_GROUPS = Object.freeze([
  Object.freeze([
    permission("finances.view", ["all"]),
    permission("invoices.view", ["all", "assigned"]),
    permission("pipeline.view", ["all", "assigned"]),
  ]),
  Object.freeze([
    permission("finances.view", ["all"]),
    permission("invoices.view", ["all", "assigned"]),
    permission("projects.view", ["all", "assigned"]),
  ]),
  Object.freeze([
    permission("finances.view", ["all"]),
    permission("invoices.view", ["all"]),
  ]),
]);

const LIST_DEFINITION = {
  name: "list_payments",
  schemaRevision: PAYMENT_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "List a bounded visible payment ledger with canonical money, normalized method categories, and exact invoice and job authority.",
  inputSchema: ListPaymentsInputSchema,
  authorization: {
    variants: [
      {
        key: "payment",
        selector: {
          kind: "input_always",
        } as unknown as CapabilityAuthorizationSelector,
        requiredOAuthScopes: ["ops.payments.read"],
        permissionRequirementGroups: PAYMENT_POLICY_GROUPS,
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: PAYMENT_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: PAYMENT_MAX_PAGE_ITEMS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "sensitive_read",
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
  rolloutFlag: "agent_control_plane.capability.list_payments",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_PAYMENTS_CANDIDATE =
  mintP2CandidateCapability(LIST_DEFINITION);

export function selectedListPaymentsVariantKeys(
  input: ListPaymentsInput | unknown
): readonly [PaymentAuthorizationVariantKey] {
  ListPaymentsInputSchema.parse(input);
  return PAYMENT_AUTHORIZATION_VARIANT_KEYS;
}
