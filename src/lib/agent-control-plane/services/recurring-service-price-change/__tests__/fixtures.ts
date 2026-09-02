import {
  RecurringServicePriceChangeRecurrenceCatalogSchema,
  RecurringServicePriceChangeSourceSnapshotSchema,
  type RecurringServicePriceChangeRecurrenceCatalog,
  type RecurringServicePriceChangeSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/recurring-service-price-change";
import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";

export const PRICE_UUID = {
  company: "10000000-0000-4000-8000-000000000001",
  client: "10000000-0000-4000-8000-000000000002",
  taskType: "10000000-0000-4000-8000-000000000003",
  recurrence: "10000000-0000-4000-8000-000000000004",
  project: "10000000-0000-4000-8000-000000000005",
  policy: "10000000-0000-4000-8000-000000000006",
  lineItem: "10000000-0000-4000-8000-000000000007",
  document: "10000000-0000-4000-8000-000000000008",
  contact: "10000000-0000-4000-8000-000000000009",
  taxRate: "10000000-0000-4000-8000-000000000010",
  provider: "10000000-0000-4000-8000-000000000011",
  invoice: "10000000-0000-4000-8000-000000000012",
} as const;
export const PRICE_USER_ID = "10000000-0000-4000-8000-000000000013";
export const PRICE_GRANT_ID = "10000000-0000-4000-8000-000000000014";
export const PRICE_CLIENT_ID = "10000000-0000-4000-8000-000000000015";
export const PRICE_SCOPES = [
  "ops.catalog.read",
  "ops.company.read",
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.financial_documents.read",
  "ops.operations.prepare",
  "ops.schedule.read",
] as const;
export const PRICE_PERMISSIONS = [
  "calendar.view",
  "catalog.products.view",
  "catalog.view",
  "clients.view",
  "email.view",
  "estimates.view",
  "invoices.view",
  "settings.company",
] as const;

const A = "a".repeat(64);
const B = "b".repeat(64);

export function recurringPriceSourceFixture(): RecurringServicePriceChangeSourceSnapshot {
  return RecurringServicePriceChangeSourceSnapshotSchema.parse({
    schema_revision: "2026-09-01.v1",
    observed_at: "2026-09-01T12:00:00.000000Z",
    business_date: "2026-09-01",
    request: {
      service_selector: "Lawn maintenance",
      normalized_service_selector: "lawn maintenance",
      increase_percent: "8",
      effective_month: "2026-11",
    },
    context: {
      company_id: PRICE_UUID.company,
      company_name: "North Star Grounds",
      timezone: "America/Vancouver",
      currency_code: "CAD",
    },
    service_resolution: {
      state: "exact",
      match_count: 1,
      task_type_id: PRICE_UUID.taskType,
      service_name: "Lawn maintenance",
    },
    accounts: [
      {
        client_id: PRICE_UUID.client,
        client_name: "Cedar Place",
        task_type_id: PRICE_UUID.taskType,
        service_name: "Lawn maintenance",
        recurrence_match_count: 1,
        recurrence: {
          recurrence_id: PRICE_UUID.recurrence,
          project_id: PRICE_UUID.project,
          rrule: "FREQ=WEEKLY;BYDAY=MO",
          start_anchor: "2026-01-05",
          end_anchor: null,
          exceptions: [],
          source_sha256: A,
        },
        additional_recurrence_sources: [],
        policy: {
          policy_id: PRICE_UUID.policy,
          notice_period_days: 30,
          adjustment_allowed: true,
          authorized_increase_percent: "8",
          authorized_effective_month: "2026-11",
          grandfathered_until: null,
          price_source_line_item_id: PRICE_UUID.lineItem,
          price_source_sha256: B,
          notice_contact_kind: "client",
          notice_contact_id: PRICE_UUID.contact,
          policy_source_ref: "agreement:2026-01",
          policy_source_sha256: A,
          effective_from: "2026-01-01",
          effective_to: null,
        },
        pricing: {
          line_item_id: PRICE_UUID.lineItem,
          document_kind: "estimate",
          document_id: PRICE_UUID.document,
          document_status: "approved",
          unit_price: "100.00",
          unit_label: "visit",
          quantity: "1.000",
          discount_percent: "0",
          minimum_charge: null,
          is_taxable: true,
          tax_rate_id: PRICE_UUID.taxRate,
          tax_rate_name: "GST",
          tax_rate_percent: "5",
          tax_rate_source_sha256: A,
          source_sha256: B,
        },
        contact: {
          contact_kind: "client",
          contact_id: PRICE_UUID.contact,
          display_name: "Morgan Lee",
          normalized_email: "morgan@example.com",
          active_identity_count: 1,
          source_sha256: A,
        },
        correspondence: {
          normalization_revision: "ops.correspondence.normalized-text.v2",
          lookback_days: 365,
          total_count: 4,
          readable_count: 4,
          unreadable_count: 0,
          inbound_count: 3,
          outbound_count: 1,
          overflow: false,
          oversized_text_count: 0,
          latest_outbound_source_ref: `provider_delivery:${PRICE_UUID.provider}`,
          latest_outbound_source_sha256: A,
          risk_signals: [],
        },
        late_payment_evidence: [],
        source_revision: B,
      },
    ],
    account_count: 1,
    overflow: false,
  });
}

export function recurringPriceCatalogFixture(): RecurringServicePriceChangeRecurrenceCatalog {
  const source = recurringPriceSourceFixture();
  return RecurringServicePriceChangeRecurrenceCatalogSchema.parse({
    schema_revision: source.schema_revision,
    observed_at: source.observed_at,
    business_date: source.business_date,
    request: source.request,
    context: source.context,
    service_resolution: source.service_resolution,
    recurrences: source.accounts.map((account) => ({
      client_id: account.client_id,
      recurrence: account.recurrence,
    })),
    recurrence_count: source.accounts.length,
    overflow: false,
  });
}

export function recurringPriceAuthority(
  permissions: readonly string[] = PRICE_PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: PRICE_USER_ID,
    companyId: PRICE_UUID.company,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [...permissions],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all",
    })),
    permissionSnapshotRevision: `sha256:${"c".repeat(64)}`,
  };
}

export async function recurringPriceActorFixture(
  permissions: readonly string[] = PRICE_PERMISSIONS
) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    recurringPriceAuthority(permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: PRICE_USER_ID,
      companyId: PRICE_UUID.company,
      oauthGrantId: PRICE_GRANT_ID,
      oauthClientId: PRICE_CLIENT_ID,
      validatedScopes: PRICE_SCOPES,
      tokenId: "token-recurring-price-preview",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "d".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-recurring-price-preview",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-09-01.capability-manifest.v15",
  });
  return { actor, authorityClient };
}
