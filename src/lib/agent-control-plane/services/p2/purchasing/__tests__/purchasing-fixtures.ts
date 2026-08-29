import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetPurchaseOrderInputSchema,
  ListPurchaseOrdersInputSchema,
  PurchaseOrderSchema,
  PurchaseOrderWithCostsSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  GET_PURCHASE_ORDER_CANDIDATE,
  LIST_PURCHASE_ORDERS_CANDIDATE,
  selectedGetPurchaseOrderVariantKeys,
  selectedListPurchaseOrdersVariantKeys,
  type PurchaseOrderAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/purchasing";
import type { PermissionScope } from "@/lib/types/permissions";
import {
  authorizeGetPurchaseOrderRead,
  authorizeListPurchaseOrdersRead,
} from "../purchase-order-authorization";

export const PURCHASING_ACTOR_ID = "18200000-0000-4000-8000-000000000001";
export const PURCHASING_COMPANY_ID = "18200000-0000-4000-8000-000000000002";
export const PURCHASE_ORDER_ID = "18200000-0000-4000-8000-000000000003";
export const PURCHASE_ORDER_LINE_ID = "18200000-0000-4000-8000-000000000004";
export const PURCHASING_VARIANT_ID = "18200000-0000-4000-8000-000000000005";
export const PURCHASING_GRANT_ID = "18200000-0000-4000-8000-000000000006";
export const PURCHASING_CLIENT_ID = "18200000-0000-4000-8000-000000000007";
export const PURCHASING_PERMISSION_REVISION = `sha256:${"b".repeat(64)}`;
export const PURCHASING_READ_AT = "2026-08-29T08:00:00.000Z";
export const PURCHASING_BASE_REVISIONS = Object.freeze([
  { domain: "purchasing", source_revision: 9 },
] as const);
export const PURCHASING_COST_REVISIONS = Object.freeze([
  { domain: "catalog", source_revision: 17 },
  { domain: "purchasing", source_revision: 9 },
] as const);

export type PurchasingPermissions = Readonly<
  Partial<
    Record<
      "catalog.orders.view" | "catalog.products.view" | "finances.view",
      PermissionScope | null
    >
  >
>;

const DEFAULT_PERMISSIONS: PurchasingPermissions = Object.freeze({
  "catalog.orders.view": "all",
  "catalog.products.view": "all",
  "finances.view": "all",
});

function authority(input: {
  readonly actorUserId: string;
  readonly permissions: PurchasingPermissions;
}): ActorAuthoritySnapshot {
  const entries = Object.entries(input.permissions).filter(
    (entry): entry is [string, PermissionScope] => entry[1] !== null
  );
  return {
    actorUserId: input.actorUserId,
    companyId: PURCHASING_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["18200000-0000-4000-8000-000000000008"],
    configuredPermissions: entries.map(([permission]) => permission),
    effectivePermissions: entries.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: PURCHASING_PERMISSION_REVISION,
  };
}

async function actorContext(input: {
  readonly actorUserId?: string;
  readonly permissions?: PurchasingPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const actorUserId = input.actorUserId ?? PURCHASING_ACTOR_ID;
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId,
      companyId: PURCHASING_COMPANY_ID,
      oauthGrantId: PURCHASING_GRANT_ID,
      oauthClientId: PURCHASING_CLIENT_ID,
      validatedScopes: input.oauthScopes ?? [
        "ops.catalog_costs.read",
        "ops.purchasing.read",
      ],
      tokenId: "18200000-0000-4000-8000-000000000009",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority({
        actorUserId,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
      })
    ),
    requestId: "request-purchase-order-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function purchasingCandidateAuthorizations(input: {
  readonly candidate:
    | typeof LIST_PURCHASE_ORDERS_CANDIDATE
    | typeof GET_PURCHASE_ORDER_CANDIDATE;
  readonly keys: readonly PurchaseOrderAuthorizationVariantKey[];
  readonly actorUserId?: string;
  readonly permissions?: PurchasingPermissions;
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

export async function listPurchaseOrdersAuthorization(rawQuery: unknown = {}) {
  const query = ListPurchaseOrdersInputSchema.parse(rawQuery);
  const keys = selectedListPurchaseOrdersVariantKeys(query);
  return authorizeListPurchaseOrdersRead({
    query,
    authorizations: await purchasingCandidateAuthorizations({
      candidate: LIST_PURCHASE_ORDERS_CANDIDATE,
      keys,
    }),
  });
}

export async function getPurchaseOrderAuthorization(input?: {
  readonly includeCosts?: boolean;
  readonly permissions?: PurchasingPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const query = GetPurchaseOrderInputSchema.parse({
    purchase_order_ref: { kind: "purchase_order", id: PURCHASE_ORDER_ID },
    sections: input?.includeCosts ? ["costs"] : [],
  });
  const keys = selectedGetPurchaseOrderVariantKeys(query);
  return authorizeGetPurchaseOrderRead({
    query,
    authorizations: await purchasingCandidateAuthorizations({
      candidate: GET_PURCHASE_ORDER_CANDIDATE,
      keys,
      permissions: input?.permissions,
      oauthScopes: input?.oauthScopes,
    }),
  });
}

function orderCore() {
  return {
    purchase_order_ref: {
      kind: "purchase_order" as const,
      id: PURCHASE_ORDER_ID,
    },
    display_label: "Back deck railing order",
    supplier_label: "CanPro",
    status: "sent" as const,
    expected_delivery_date: "2026-09-03",
    line_count: 1,
    created_at: "2026-08-28T18:00:00.000Z",
    updated_at: PURCHASING_READ_AT,
    sent_at: "2026-08-28T19:00:00.000Z",
    fulfilled_at: null,
    cancelled_at: null,
    content_kind: "untrusted_business_data" as const,
  };
}

function lineCore() {
  return {
    line_ref: {
      kind: "purchase_order_line" as const,
      id: PURCHASE_ORDER_LINE_ID,
    },
    variant_ref: {
      kind: "catalog_variant" as const,
      id: PURCHASING_VARIANT_ID,
    },
    family_label: "Guardrail",
    variant_label: "Black / Topmount",
    sku: "RAIL-BLK-TOP",
    quantity_milliunits: 24_500,
    unit: { label: "Linear foot", abbreviation: "LF" },
    content_kind: "untrusted_business_data" as const,
  };
}

export function purchaseOrder(
  includeCosts: false
): ReturnType<typeof PurchaseOrderSchema.parse>;
export function purchaseOrder(
  includeCosts: true
): ReturnType<typeof PurchaseOrderWithCostsSchema.parse>;
export function purchaseOrder(
  includeCosts: boolean
):
  | ReturnType<typeof PurchaseOrderSchema.parse>
  | ReturnType<typeof PurchaseOrderWithCostsSchema.parse>;
export function purchaseOrder(includeCosts: boolean) {
  if (!includeCosts) {
    return PurchaseOrderSchema.parse({ ...orderCore(), lines: [lineCore()] });
  }
  return PurchaseOrderWithCostsSchema.parse({
    ...orderCore(),
    lines: [
      {
        ...lineCore(),
        unit_cost: { amount_minor: 13_888, currency: "CAD" },
        line_total: { amount_minor: 340_256, currency: "CAD" },
      },
    ],
    costs: {
      subtotal: { amount_minor: 340_256, currency: "CAD" },
      priced_line_count: 1,
      unpriced_line_count: 0,
    },
  });
}
