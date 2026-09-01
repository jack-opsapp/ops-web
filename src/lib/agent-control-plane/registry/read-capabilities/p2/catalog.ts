import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CATALOG_MAX_PAGE_ITEMS,
  CATALOG_READ_SCHEMA_REVISION,
  GetCatalogItemInputSchema,
  SearchCatalogItemsInputSchema,
  type GetCatalogItemInput,
  type SearchCatalogItemsInput,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const CATALOG_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "catalog",
  "supplier_costs",
] as const);
export type CatalogAuthorizationVariantKey =
  (typeof CATALOG_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permissionName: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

const BASE_PERMISSION_GROUPS = Object.freeze([
  Object.freeze([
    permission("catalog.products.view"),
    permission("catalog.view"),
  ]),
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

const SEARCH_DEFINITION = {
  name: "search_catalog_items",
  schemaRevision: CATALOG_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "Search bounded current catalogue variants by family, SKU, category, tag, active state, and stock state.",
  inputSchema: SearchCatalogItemsInputSchema,
  authorization: {
    variants: [
      {
        key: "catalog",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.catalog.read"],
        permissionRequirementGroups: BASE_PERMISSION_GROUPS,
      },
    ],
  },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: CATALOG_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: CATALOG_MAX_PAGE_ITEMS,
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
  rolloutFlag: "agent_control_plane.capability.search_catalog_items",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

const DETAIL_DEFINITION = {
  name: "get_catalog_item",
  schemaRevision: CATALOG_READ_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one exact catalogue family or variant with safe options, recipes, selling price, stock, and separately authorized supplier costs.",
  inputSchema: GetCatalogItemInputSchema,
  authorization: {
    variants: [
      {
        key: "catalog",
        selector: { kind: "always" },
        requiredOAuthScopes: ["ops.catalog.read"],
        permissionRequirementGroups: BASE_PERMISSION_GROUPS,
      },
      {
        key: "supplier_costs",
        selector: pendingSelector({
          kind: "input_array_contains",
          field: "sections",
          value: "supplier_costs",
        }),
        requiredOAuthScopes: ["ops.catalog_costs.read"],
        permissionRequirementGroups: COST_PERMISSION_GROUPS,
      },
    ],
  },
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
  rolloutFlag: "agent_control_plane.capability.get_catalog_item",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const SEARCH_CATALOG_ITEMS_CANDIDATE =
  mintP2CandidateCapability(SEARCH_DEFINITION);
export const GET_CATALOG_ITEM_CANDIDATE =
  mintP2CandidateCapability(DETAIL_DEFINITION);

export function selectedSearchCatalogItemsVariantKeys(
  input: SearchCatalogItemsInput | unknown
): readonly ["catalog"] {
  SearchCatalogItemsInputSchema.parse(input);
  return Object.freeze(["catalog"]);
}

export function selectedGetCatalogItemVariantKeys(
  input: GetCatalogItemInput | unknown
): readonly ["catalog"] | readonly ["catalog", "supplier_costs"] {
  const parsed = GetCatalogItemInputSchema.parse(input);
  return parsed.sections.includes("supplier_costs")
    ? Object.freeze(["catalog", "supplier_costs"] as const)
    : Object.freeze(["catalog"] as const);
}
