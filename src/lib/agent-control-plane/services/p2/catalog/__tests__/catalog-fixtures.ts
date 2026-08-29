import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  CatalogSearchItemSchema,
  GetCatalogItemInputSchema,
  SearchCatalogItemsInputSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  GET_CATALOG_ITEM_CANDIDATE,
  SEARCH_CATALOG_ITEMS_CANDIDATE,
  selectedGetCatalogItemVariantKeys,
  selectedSearchCatalogItemsVariantKeys,
  type CatalogAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/catalog";
import type { PermissionScope } from "@/lib/types/permissions";
import {
  authorizeGetCatalogItemRead,
  authorizeSearchCatalogItemsRead,
} from "../catalog-authorization";

export const CATALOG_ACTOR_ID = "18100000-0000-4000-8000-000000000001";
export const CATALOG_COMPANY_ID = "18100000-0000-4000-8000-000000000002";
export const CATALOG_FAMILY_ID = "18100000-0000-4000-8000-000000000003";
export const CATALOG_VARIANT_ID = "18100000-0000-4000-8000-000000000004";
export const CATALOG_CATEGORY_ID = "18100000-0000-4000-8000-000000000005";
export const CATALOG_PRODUCT_ID = "18100000-0000-4000-8000-000000000006";
export const CATALOG_GRANT_ID = "18100000-0000-4000-8000-000000000007";
export const CATALOG_CLIENT_ID = "18100000-0000-4000-8000-000000000008";
export const CATALOG_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const CATALOG_READ_AT = "2026-08-28T20:00:00.000Z";
export const CATALOG_SOURCE_REVISIONS = Object.freeze([
  { domain: "catalog", source_revision: 17 },
] as const);

export type CatalogPermissions = Readonly<
  Partial<
    Record<
      "catalog.products.view" | "catalog.view" | "finances.view",
      PermissionScope | null
    >
  >
>;

const DEFAULT_PERMISSIONS: CatalogPermissions = Object.freeze({
  "catalog.products.view": "all",
  "catalog.view": "all",
  "finances.view": "all",
});

function authority(input: {
  readonly actorUserId: string;
  readonly permissions: CatalogPermissions;
}): ActorAuthoritySnapshot {
  const entries = Object.entries(input.permissions).filter(
    (entry): entry is [string, PermissionScope] => entry[1] !== null
  );
  return {
    actorUserId: input.actorUserId,
    companyId: CATALOG_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["18100000-0000-4000-8000-000000000009"],
    configuredPermissions: entries.map(([permission]) => permission),
    effectivePermissions: entries.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: CATALOG_PERMISSION_REVISION,
  };
}

async function actorContext(input: {
  readonly actorUserId?: string;
  readonly permissions?: CatalogPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const actorUserId = input.actorUserId ?? CATALOG_ACTOR_ID;
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId,
      companyId: CATALOG_COMPANY_ID,
      oauthGrantId: CATALOG_GRANT_ID,
      oauthClientId: CATALOG_CLIENT_ID,
      validatedScopes: input.oauthScopes ?? [
        "ops.catalog.read",
        "ops.catalog_costs.read",
      ],
      tokenId: "18100000-0000-4000-8000-000000000010",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority({
        actorUserId,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
      })
    ),
    requestId: "request-catalog-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function catalogCandidateAuthorizations(input: {
  readonly candidate:
    | typeof SEARCH_CATALOG_ITEMS_CANDIDATE
    | typeof GET_CATALOG_ITEM_CANDIDATE;
  readonly keys: readonly CatalogAuthorizationVariantKey[];
  readonly actorUserId?: string;
  readonly permissions?: CatalogPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const context = await actorContext(input);
  const policies = new Map(
    input.candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  return Object.fromEntries(
    input.keys.flatMap((key) => {
      try {
        return [
          [
            key,
            authorizeCapability({
              actorContext: context,
              policy: policies.get(key)!,
            }),
          ],
        ];
      } catch {
        return [];
      }
    })
  );
}

export async function searchCatalogAuthorization(rawQuery: unknown = {}) {
  const query = SearchCatalogItemsInputSchema.parse(rawQuery);
  const keys = selectedSearchCatalogItemsVariantKeys(query);
  return authorizeSearchCatalogItemsRead({
    query,
    authorizations: await catalogCandidateAuthorizations({
      candidate: SEARCH_CATALOG_ITEMS_CANDIDATE,
      keys,
    }),
  });
}

export async function getCatalogAuthorization(input?: {
  readonly refKind?: "catalog_family" | "catalog_variant";
  readonly includeCosts?: boolean;
  readonly permissions?: CatalogPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const query = GetCatalogItemInputSchema.parse({
    item_ref: {
      kind: input?.refKind ?? "catalog_family",
      id:
        (input?.refKind ?? "catalog_family") === "catalog_family"
          ? CATALOG_FAMILY_ID
          : CATALOG_VARIANT_ID,
    },
    sections: input?.includeCosts ? ["supplier_costs"] : [],
  });
  const keys = selectedGetCatalogItemVariantKeys(query);
  return authorizeGetCatalogItemRead({
    query,
    authorizations: await catalogCandidateAuthorizations({
      candidate: GET_CATALOG_ITEM_CANDIDATE,
      keys,
      permissions: input?.permissions,
      oauthScopes: input?.oauthScopes,
    }),
  });
}

export function catalogSearchItem(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return CatalogSearchItemSchema.parse({
    family_ref: { kind: "catalog_family", id: CATALOG_FAMILY_ID },
    family_label: "Guardrail",
    variant_ref: { kind: "catalog_variant", id: CATALOG_VARIANT_ID },
    variant_label: "Black · Topmount",
    category: {
      category_ref: { kind: "catalog_category", id: CATALOG_CATEGORY_ID },
      label: "Railings",
    },
    sku: "RAIL-BLK-TOP",
    quantity_milliunits: 12_500,
    unit: { label: "Linear foot", abbreviation: "LF" },
    thresholds: {
      warning_milliunits: 20_000,
      critical_milliunits: 8_000,
      warning_origin: "family",
      critical_origin: "category",
    },
    stock_state: "warning",
    tags: ["Exterior", "Railing"],
    active: true,
    updated_at: CATALOG_READ_AT,
    content_kind: "untrusted_business_data",
    ...overrides,
  });
}
