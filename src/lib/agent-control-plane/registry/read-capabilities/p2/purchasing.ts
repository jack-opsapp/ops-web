import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  GetPurchaseOrderInputSchema,
  ListPurchaseOrdersInputSchema,
  PURCHASE_ORDER_MAX_PAGE_ITEMS,
  PURCHASE_ORDER_READ_SCHEMA_REVISION,
  type GetPurchaseOrderInput,
  type ListPurchaseOrdersInput,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const PURCHASE_ORDER_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "orders",
  "costs",
] as const);
export type PurchaseOrderAuthorizationVariantKey =
  (typeof PURCHASE_ORDER_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permissionName: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

const ORDER_PERMISSION_GROUPS = Object.freeze([
  Object.freeze([permission("catalog.orders.view")]),
]);
const COST_PERMISSION_GROUPS = Object.freeze([
  Object.freeze([
    permission("catalog.products.view"),
    permission("finances.view"),
  ]),
]);

function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

function variants() {
  return [
    {
      key: "orders",
      selector: { kind: "always" },
      requiredOAuthScopes: ["ops.purchasing.read"],
      permissionRequirementGroups: ORDER_PERMISSION_GROUPS,
    },
    {
      key: "costs",
      selector: pendingSelector({
        kind: "input_array_contains",
        field: "sections",
        value: "costs",
      }),
      requiredOAuthScopes: ["ops.catalog_costs.read"],
      permissionRequirementGroups: COST_PERMISSION_GROUPS,
    },
  ] as const;
}

const LIST_DEFINITION = {
  name: "list_purchase_orders",
  schemaRevision: PURCHASE_ORDER_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "List bounded purchase orders by status, exact supplier, and delivery window with safe line snapshots and separately authorized costs.",
  inputSchema: ListPurchaseOrdersInputSchema,
  authorization: { variants: variants() },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: PURCHASE_ORDER_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: PURCHASE_ORDER_MAX_PAGE_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.list_purchase_orders",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

const DETAIL_DEFINITION = {
  name: "get_purchase_order",
  schemaRevision: PURCHASE_ORDER_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one exact purchase order with safe ordered line snapshots and separately authorized costs.",
  inputSchema: GetPurchaseOrderInputSchema,
  authorization: { variants: variants() },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 60_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: 1,
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
  rolloutFlag: "agent_control_plane.capability.get_purchase_order",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_PURCHASE_ORDERS_CANDIDATE =
  mintP2CandidateCapability(LIST_DEFINITION);
export const GET_PURCHASE_ORDER_CANDIDATE =
  mintP2CandidateCapability(DETAIL_DEFINITION);

function selectedVariantKeys(sections: readonly string[]) {
  return sections.includes("costs")
    ? Object.freeze(["orders", "costs"] as const)
    : Object.freeze(["orders"] as const);
}

export function selectedListPurchaseOrdersVariantKeys(
  input: ListPurchaseOrdersInput | unknown
): readonly ["orders"] | readonly ["orders", "costs"] {
  return selectedVariantKeys(
    ListPurchaseOrdersInputSchema.parse(input).sections
  );
}

export function selectedGetPurchaseOrderVariantKeys(
  input: GetPurchaseOrderInput | unknown
): readonly ["orders"] | readonly ["orders", "costs"] {
  return selectedVariantKeys(GetPurchaseOrderInputSchema.parse(input).sections);
}
