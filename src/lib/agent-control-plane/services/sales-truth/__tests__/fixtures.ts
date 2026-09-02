import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { SalesTruthSourceSnapshot } from "@/lib/agent-control-plane/contracts/sales-truth";
import { SALES_TRUTH_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

export const SALES_TRUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
export const SALES_TRUTH_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const SALES_TRUTH_GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const SALES_TRUTH_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const SALES_TRUTH_OPPORTUNITY_ID =
  "55555555-5555-4555-8555-555555555555";

export const SALES_TRUTH_SCOPES = [
  "ops.correspondence.read",
  "ops.operations.read",
] as const;
export const SALES_TRUTH_PERMISSIONS = ["email.view", "pipeline.view"] as const;

export function salesTruthAuthority(
  permissions: readonly string[] = SALES_TRUTH_PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: SALES_TRUTH_USER_ID,
    companyId: SALES_TRUTH_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [...permissions],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all",
    })),
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

export async function salesTruthActorFixture(
  permissions: readonly string[] = SALES_TRUTH_PERMISSIONS,
  capabilityManifestRevision = SALES_TRUTH_CAPABILITY_MANIFEST_REVISION
) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    salesTruthAuthority(permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: SALES_TRUTH_USER_ID,
      companyId: SALES_TRUTH_COMPANY_ID,
      oauthGrantId: SALES_TRUTH_GRANT_ID,
      oauthClientId: SALES_TRUTH_CLIENT_ID,
      validatedScopes: SALES_TRUTH_SCOPES,
      tokenId: "token-sales-truth",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-sales-truth",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision,
  });
  return { actor, authorityClient };
}

export function salesTruthSourceFixture(): SalesTruthSourceSnapshot {
  return {
    observed_at: "2026-09-01T12:00:00.000Z",
    business_date: "2026-09-01",
    context: { timezone: "America/Vancouver", currency_code: "CAD" },
    window: { starts_on: "2026-03-06", ends_on: "2026-09-01", days: 180 },
    source_revisions: { company: 2, sales_truth: 3 },
    source_counts: {
      opportunities: 1,
      transitions: 0,
      dispositions: 0,
      activities: 0,
    },
    source_bounds: {
      opportunities: false,
      transitions: false,
      dispositions: false,
      activities: false,
    },
    opportunities: [
      {
        id: SALES_TRUTH_OPPORTUNITY_ID,
        created_at: "2026-08-20T12:00:00.000Z",
        stage: "new_lead",
        source: "website",
        legacy_loss_reason: null,
      },
    ],
    transitions: [],
    dispositions: [],
    activities: [],
  };
}
