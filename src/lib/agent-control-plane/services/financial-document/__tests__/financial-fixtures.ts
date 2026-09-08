import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type {
  FinancialDocumentResult,
  PrepareFinancialDocumentInput,
  FinancialDocumentReceipt,
} from "@/lib/agent-control-plane/contracts/financial-document";
import { FINANCIAL_DOCUMENT_PROMPT_SAFETY } from "@/lib/agent-control-plane/contracts/financial-document";

export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
export const GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const SCOPES = [
  "ops.company.read",
  "ops.customers.read",
  "ops.financial_documents.prepare",
  "ops.financial_documents.read",
  "ops.jobs.read",
] as const;
export const PERMISSIONS = [
  "agent.review",
  "clients.view",
  "estimates.create",
  "estimates.view",
  "pipeline.view",
  "projects.view",
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
    requestId: "request-financial-document",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-09-07.capability-manifest.v23",
  });
  authorityClient.actorLookups.length = 0;
  return { actor, authorityClient };
}

export const HASH = "sha256:" + "a".repeat(64);
export const REQUEST: PrepareFinancialDocumentInput = {
  document_kind: "estimate",
  operation: "create",
  client_id: CLIENT_ID,
  opportunity_id: CLIENT_ID,
  project_id: null,
  revises_estimate_id: null,
  expected_revision_sha256: null,
  baseline_estimate_id: null,
  policy_id: CLIENT_ID,
  policy_sha256: HASH,
  currency: "CAD",
  issue_date: "2026-09-07",
  expiration_date: "2026-10-07",
  title: "Deck repair",
  client_message: "",
  terms: "Payment on completion",
  inclusions: "Replace damaged boards",
  exclusions: "Railing",
  scope_evidence: {
    kind: "operator",
    reference_id: null,
    sha256: null,
    statement: "Price the measured repair scope",
  },
  increase_percent: "8",
  adjustment_base: "unit_prices_and_minimum_charges",
  lines: [
    {
      name: "Board installation",
      description: "",
      quantity: "1.125",
      unit: "hour",
      type: "LABOR",
      source: {
        kind: "operator",
        reference_id: null,
        sha256: null,
        unit_price: "12.50",
        minimum_charge: "0.00",
      },
      discount_percent: "0",
      is_taxable: true,
    },
  ],
  idempotency_key: "financial-test-001",
};

export const EFFECTS = {
  estimates_created: 1,
  official_numbers_allocated: 1,
  existing_documents_changed: 0,
  distribution: "held_private",
  customer_messages_sent: 0,
  customer_acceptances: 0,
  project_totals_changed: 0,
  invoices_created: 0,
  provider_writes: 0,
} as const;
export function resultFixture(): FinancialDocumentResult {
  return {
    contract_version: "2026-08-07.v1",
    schema_revision: "2026-09-07.v1",
    request_id: "request-financial-document",
    status: "approval_required",
    run_id: GRANT_ID,
    action_id: ACTOR_ID,
    change_set_id: COMPANY_ID,
    preview_sha256: HASH,
    replayed: false,
    prompt_safety: FINANCIAL_DOCUMENT_PROMPT_SAFETY,
    proposal: {
      operation: "save_private_financial_draft",
      policy_revision: "financial-document-draft:2026-09-07.v1",
      request: structuredClone(REQUEST),
      client_name: "Fictional client",
      target_name: "Deck repair",
      source_sha256: HASH,
      pricing_policy_sha256: HASH,
      baseline_total: null,
      previous_total: null,
      previous_revision: null,
      document_version: 1,
      tax_rate: "0.0500",
      tax_name: "GST",
      lines: [
        {
          position: 0,
          product_id: null,
          source_kind: "operator",
          source_sha256: null,
          source_unit_price: "12.50",
          source_minimum_charge: "0.00",
          unit_price: "13.50",
          minimum_charge: "0.00",
          line_total: "15.19",
          tax_amount: "0.76",
        },
      ],
      subtotal: "15.19",
      tax_amount: "0.76",
      total: "15.95",
      effects: EFFECTS,
      expires_at: "2026-09-07T12:30:00Z",
      content_kind: "untrusted_business_data",
    },
  };
}
export function receiptFixture(): FinancialDocumentReceipt {
  return {
    ok: true,
    effect: "private_financial_draft_saved",
    action_id: ACTOR_ID,
    change_set_id: COMPANY_ID,
    run_id: GRANT_ID,
    confirmation_receipt_id: CLIENT_ID,
    preview_sha256: HASH,
    estimate_id: "55555555-5555-4555-8555-555555555555",
    estimate_number: "EST-2026-00001",
    document_kind: "estimate",
    document_version: 1,
    readback_sha256: HASH,
    receipt_sha256: HASH,
    effects: EFFECTS,
    committed_at: "2026-09-07T12:05:00Z",
    replayed: false,
  };
}
