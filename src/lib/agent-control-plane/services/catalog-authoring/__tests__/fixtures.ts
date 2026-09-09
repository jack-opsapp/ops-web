import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
export const GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const SCOPES = [
  "ops.catalog.read",
  "ops.catalog.prepare",
  "ops.catalog_prices.write",
  "ops.catalog_costs.read",
  "ops.catalog_costs.write",
  "ops.inventory.adjust",
] as const;
export const PERMISSIONS = [
  "agent.review",
  "catalog.view",
  "catalog.manage",
  "catalog.import",
  "catalog.products.manage",
  "catalog.products.view",
  "catalog.stock.adjust",
  "finances.view",
] as const;
function authority(
  permissions: readonly string[] = PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [
      ...permissions,
    ] as ActorAuthoritySnapshot["configuredPermissions"],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all" as const,
    })) as ActorAuthoritySnapshot["effectivePermissions"],
    permissionSnapshotRevision: `sha256:${"9".repeat(64)}`,
  };
}

export async function actorFixture(input?: {
  permissions?: readonly string[];
  scopes?: readonly string[];
}) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    authority(input?.permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      validatedScopes: input?.scopes ?? SCOPES,
      tokenId: "dispatch-token",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "8".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-catalog",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-09-08.capability-manifest.v24",
  });
  authorityClient.actorLookups.length = 0;
  return { actor, authorityClient };
}

import {
  CATALOG_AUTHORING_SAFETY,
  type CatalogAuthoringRequest,
  type CatalogAuthoringResult,
} from "../../../contracts/catalog-authoring";
export const HASH = "sha256:" + "a".repeat(64);
export const REQUEST: CatalogAuthoringRequest = {
  operation: "catalog",
  currency: "CAD",
  source: {
    key: "supplier-sheet",
    sha256: HASH,
    name: "Supplier sheet",
    kind: "file",
  },
  rows: [
    {
      row_key: "service",
      source_row: "2",
      entity: "product",
      existing_id: null,
      expected_sha256: null,
      values: {
        name: "Installation",
        kind: "service",
        unit: "hour",
        pricing_unit: "hour",
        price: "15.00",
        taxable: true,
      },
    },
  ],
  skipped_rows: [],
  idempotency_key: "catalog-import-001",
};
export function resultFixture(): CatalogAuthoringResult {
  return {
    request_id: "request-catalog",
    schema_revision: "2026-09-08.v1",
    status: "approval_required",
    proposal: {
      operation: "catalog",
      currency: "CAD",
      source: REQUEST.source,
      rows: [
        {
          row_key: "service",
          source_row: "2",
          entity: "product",
          id: CLIENT_ID,
          display_name: "Installation",
          reference_labels: {},
          before_reference_labels: {},
          status: "create",
          before: null,
          after: {
            name: "Installation",
            kind: "service",
            unit: "hour",
            pricing_unit: "hour",
            price: 15,
            taxable: true,
          },
          expected_sha256: null,
          issues: [],
          candidates: [],
        },
      ],
      skipped_rows: [],
      ready: true,
      effects: {
        creates: 1,
        updates: 0,
        unchanged: 0,
        stock_adjustments: 0,
        provider_writes: 0,
        purchases_created: 0,
        accounting_records_created: 0,
      },
      source_sha256: HASH,
      content_kind: "untrusted_business_data",
    },
    action_id: CLIENT_ID,
    change_set_id: GRANT_ID,
    preview_sha256: HASH,
    expires_at: "2026-09-08T23:00:00.000Z",
    replayed: false,
    prompt_safety: CATALOG_AUTHORING_SAFETY,
  };
}

export function receiptFixture() {
  const p = resultFixture();
  return {
    ok: true as const,
    effect: "catalog_saved" as const,
    actor_user_id: ACTOR_ID,
    company_id: COMPANY_ID,
    action_id: CLIENT_ID,
    change_set_id: GRANT_ID,
    confirmation_receipt_id: CLIENT_ID,
    preview_sha256: HASH,
    receipt_sha256: HASH,
    source: REQUEST.source,
    skipped_rows: [],
    committed_at: "2026-09-08T22:00:00.000Z",
    replayed: false,
    effects: p.proposal.effects,
    records: [],
  };
}
