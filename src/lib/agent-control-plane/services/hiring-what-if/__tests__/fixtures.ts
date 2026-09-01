import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { HiringWhatIfSourceSnapshot } from "@/lib/agent-control-plane/contracts/hiring-what-if";
import { HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

export const HIRING_USER_ID = "11111111-1111-4111-8111-111111111111";
export const HIRING_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const HIRING_GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const HIRING_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const HIRING_ROLE_ID = "55555555-5555-4555-8555-555555555555";

export const HIRING_SCOPES = [
  "ops.company.read",
  "ops.expenses.read",
  "ops.financial_documents.read",
  "ops.financials.read",
  "ops.jobs.read",
  "ops.payments.read",
  "ops.schedule.read",
  "ops.site_visits.read",
  "ops.tasks.read",
  "ops.team.read",
] as const;

export const HIRING_PERMISSIONS = [
  "calendar.view",
  "expenses.view",
  "invoices.view",
  "projects.view",
  "projects.view_financials",
  "reports.view",
  "settings.company",
  "tasks.view",
  "team.view",
] as const;

export function hiringAuthority(
  permissions: readonly string[] = HIRING_PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: HIRING_USER_ID,
    companyId: HIRING_COMPANY_ID,
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

export async function hiringActorFixture(
  permissions: readonly string[] = HIRING_PERMISSIONS
) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    hiringAuthority(permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: HIRING_USER_ID,
      companyId: HIRING_COMPANY_ID,
      oauthGrantId: HIRING_GRANT_ID,
      oauthClientId: HIRING_CLIENT_ID,
      validatedScopes: HIRING_SCOPES,
      tokenId: "token-hiring-what-if",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-hiring-what-if",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION,
  });
  return { actor, authorityClient };
}

export function hiringSourceFixture(): HiringWhatIfSourceSnapshot {
  return {
    observed_at: "2026-09-01T04:00:00.000Z",
    business_date: "2026-08-31",
    timezone: "America/Vancouver",
    currency: "CAD",
    currency_minor_exponent: 2,
    window: {
      starts_on: "2026-06-01",
      ends_on: "2026-08-31",
      complete_weeks: 13,
      next_week_starts_on: "2026-09-07",
      workdays: [1, 2, 3, 4, 5],
      standard_daily_capacity_minutes: 480,
    },
    role: {
      state: "resolved",
      role_ref: { kind: "role", id: HIRING_ROLE_ID },
      name: "Installer",
      active_member_count: 1,
      multi_role_member_count: 0,
      content_kind: "untrusted_business_data",
    },
    weeks: Array.from({ length: 13 }, (_, index) => ({
      starts_on: new Date(Date.UTC(2026, 5, 1 + index * 7))
        .toISOString()
        .slice(0, 10),
      capacity_minutes: 2_400,
      productive_minutes: 1_800,
      attributed_revenue_minor: 500_000 + index * 10_000,
      attributed_direct_cost_minor: 200_000,
      role_project_count: 1,
    })),
    completeness: {
      source_state: "complete",
      role_project_count: 8,
      financially_observed_project_count: 8,
      source_counts: {
        members: 1,
        tasks: 50,
        site_visits: 5,
        projects: 8,
        payments: 20,
        expenses: 12,
      },
      omitted_counts: {
        supporting_records: 0,
        invalid_schedule_records: 0,
        invalid_currency_expenses: 0,
      },
      reasons: [],
    },
    source_revisions: [
      { domain: "availability", revision: 3 },
      { domain: "company", revision: 1 },
      { domain: "expenses", revision: 8 },
      { domain: "payments", revision: 13 },
      { domain: "sales_documents", revision: 9 },
      { domain: "site_visits", revision: 5 },
      { domain: "tasks", revision: 21 },
      { domain: "team", revision: 2 },
    ],
    supporting_records: [
      {
        kind: "project",
        id: "66666666-6666-4666-8666-666666666666",
        observed_on: "2026-08-30",
      },
    ],
  };
}
