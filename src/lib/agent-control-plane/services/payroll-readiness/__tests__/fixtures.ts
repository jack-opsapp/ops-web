import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { PayrollReadinessSourceSnapshot } from "@/lib/agent-control-plane/contracts/payroll-readiness";

export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const SETTINGS_ID = "22222222-2222-4222-8222-222222222222";
export const PAYROLL_ID = "33333333-3333-4333-8333-333333333333";
export const RENT_ID = "44444444-4444-4444-8444-444444444444";
export const BATCH_ID = "55555555-5555-4555-8555-555555555555";
export const CLIENT_ID = "66666666-6666-4666-8666-666666666666";
export const OPEN_INVOICE_ID = "77777777-7777-4777-8777-777777777777";
export const PAYROLL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PAYROLL_GRANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PAYROLL_CLIENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const PAYROLL_SCOPES = [
  "ops.company.read",
  "ops.expenses.read",
  "ops.financial_documents.read",
  "ops.financials.read",
  "ops.payments.read",
] as const;
export const PAYROLL_PERMISSIONS = [
  "expenses.view",
  "invoices.view",
  "reports.view",
  "settings.company",
] as const;

const HISTORY_IDS = [
  "80000000-0000-4000-8000-000000000001",
  "80000000-0000-4000-8000-000000000002",
  "80000000-0000-4000-8000-000000000003",
  "80000000-0000-4000-8000-000000000004",
  "80000000-0000-4000-8000-000000000005",
] as const;

export function payrollReadinessSourceFixture(): PayrollReadinessSourceSnapshot {
  return {
    observed_at: "2026-09-01T16:00:00.000Z",
    business_date: "2026-09-01",
    target_date: "2026-09-15",
    context: {
      company_id: COMPANY_ID,
      timezone: "America/Vancouver",
      currency_code: "CAD",
    },
    source_revisions: { company: 7, payroll_readiness: 11 },
    settings: {
      id: SETTINGS_ID,
      cash_balance: "10000.00",
      cash_balance_updated_at: "2026-09-01T15:30:00.000Z",
      obligations_confirmed_through: "2026-09-30",
      obligations_confirmed_at: "2026-09-01T15:30:00.000Z",
    },
    recurring_obligations: [
      {
        id: PAYROLL_ID,
        amount: "6000.00",
        currency: "CAD",
        cadence: "monthly",
        next_due_date: "2026-09-15",
        end_date: null,
        obligation_kind: "payroll",
        due_time_local: "09:00:00",
        updated_at: "2026-08-30T12:00:00.000Z",
      },
      {
        id: RENT_ID,
        amount: "2000.00",
        currency: "CAD",
        cadence: "monthly",
        next_due_date: "2026-09-10",
        end_date: null,
        obligation_kind: "other",
        due_time_local: "17:00:00",
        updated_at: "2026-08-30T12:00:00.000Z",
      },
    ],
    reimbursement_batches: [
      {
        id: BATCH_ID,
        owed_amount: "500.00",
        line_count: 2,
        currency_codes: ["CAD"],
      },
    ],
    receivables: [
      {
        invoice_id: OPEN_INVOICE_ID,
        payer_id: CLIENT_ID,
        total_amount: "3000.00",
        stored_amount_paid: "0.00",
        stored_balance_due: "3000.00",
        calculated_balance: "3000.00",
        due_date: "2026-09-05",
        status: "sent",
        sent_at: "2026-08-20T18:00:00.000Z",
        identity_conflict: false,
      },
    ],
    payer_history: HISTORY_IDS.map((invoice_id, index) => ({
      invoice_id,
      payer_id: CLIENT_ID,
      due_date: "2026-07-01",
      settled_on: [
        "2026-06-29",
        "2026-07-01",
        "2026-07-03",
        "2026-07-05",
        "2026-07-07",
      ][index]!,
      delay_days: [-2, 0, 2, 4, 6][index]!,
      identity_conflict: false,
      amount_valid: true,
    })),
    source_counts: {
      recurring_obligations: 2,
      reimbursement_batches: 1,
      receivables: 1,
      payer_history: 5,
    },
    source_bounds: {
      recurring_obligations: false,
      reimbursement_batches: false,
      receivables: false,
      payer_history: false,
    },
  };
}

export function payrollReadinessAuthority(
  permissions: readonly string[] = PAYROLL_PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: PAYROLL_USER_ID,
    companyId: COMPANY_ID,
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

export async function payrollReadinessActorFixture(
  permissions: readonly string[] = PAYROLL_PERMISSIONS,
  capabilityManifestRevision = "2026-09-01.capability-manifest.v14"
) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    payrollReadinessAuthority(permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: PAYROLL_USER_ID,
      companyId: COMPANY_ID,
      oauthGrantId: PAYROLL_GRANT_ID,
      oauthClientId: PAYROLL_CLIENT_ID,
      validatedScopes: PAYROLL_SCOPES,
      tokenId: "token-payroll-readiness",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-payroll-readiness",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision,
  });
  return { actor, authorityClient };
}
