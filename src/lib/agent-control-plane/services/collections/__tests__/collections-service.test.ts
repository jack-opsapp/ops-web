import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { COLLECTIONS_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import type { OpsAgentReadCatalogueService } from "@/lib/agent-control-plane/services/read-catalogue-service";
import {
  createCollectionsRepository,
  type CollectionsRpcClient,
} from "../collections-repository";
import { createCollectionsService } from "../collections-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
const ACTION_ID = "77777777-7777-4777-8777-777777777777";
const CHANGE_SET_ID = "88888888-8888-4888-8888-888888888888";
const SCOPES = [
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.financial_documents.read",
  "ops.operations.prepare",
  "ops.operations.read",
] as const;
const PERMISSIONS = [
  "clients.view",
  "email.view",
  "invoices.view",
  "reports.view",
] as const;

function authority(
  permissions: readonly string[] = PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: USER_ID,
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

function invoice(daysPastDue: number, index: number) {
  const due = new Date("2026-08-31T00:00:00.000Z");
  due.setUTCDate(due.getUTCDate() - daysPastDue);
  const issue = new Date(due);
  issue.setUTCDate(issue.getUTCDate() - 30);
  const hex = (index + 10).toString(16).padStart(12, "0");
  return {
    document_ref: {
      kind: "invoice" as const,
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`,
    },
    customer_ref: { kind: "customer" as const, id: CUSTOMER_ID },
    job_ref: null,
    document_number: `INV-${String(index).padStart(4, "0")}`,
    title: null,
    status: "past_due" as const,
    issue_date: issue.toISOString().slice(0, 10),
    due_date: due.toISOString().slice(0, 10),
    paid_at: null,
    total: { amount_minor: 10_000, currency: "CAD" as const },
    amount_paid: { amount_minor: 0, currency: "CAD" as const },
    balance_due: { amount_minor: 10_000, currency: "CAD" as const },
    updated_at: "2026-08-31T17:00:00.000Z",
    content_kind: "untrusted_business_data" as const,
  };
}

async function fixture(input?: {
  permissions?: readonly string[];
  days?: readonly number[];
  contacts?: Array<Record<string, unknown>>;
  duplicateState?: "clear" | "review_required";
  correspondence?: Record<string, unknown>;
  fifthPage?: boolean;
}) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    authority(input?.permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: USER_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      validatedScopes: SCOPES,
      tokenId: "token-collections",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-collections",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
  });
  const invoices = (input?.days ?? [31]).map(invoice);
  let page = 0;
  const listSalesDocuments = vi.fn(async () => {
    const currentPage = page++;
    const pageItems = currentPage === 0 ? invoices : [];
    const hasMore = input?.fifthPage === true && currentPage < 4;
    return {
      items: pageItems,
      evidence: pageItems.map((_item, itemIndex) => ({
        evidence_ref: `ops_evidence:v1:${String(currentPage * 10 + itemIndex).padStart(32, "A")}`,
      })),
      item_proofs: [],
      collection_proof: {
        source_revisions: [{ domain: "sales_documents", source_revision: 9 }],
        read_at: "2026-08-31T18:00:00.000Z",
        returned_count: pageItems.length,
        has_more: hasMore,
      },
      next_cursor: hasMore ? `cursor-page-${currentPage + 1}` : null,
    };
  });
  const primaryContact = {
    contact_ref: { kind: "client", id: CUSTOMER_ID },
    relationship: "primary_client",
    display_name: "Baxter Homes",
    title: null,
    email: { state: "contactable", address: "accounts@baxter.example" },
    phone: { state: "unavailable" },
    content_kind: "untrusted_business_data",
  };
  const contacts = input?.contacts ?? [primaryContact];
  const getCustomerContext = vi.fn(async () => ({
    customer: {
      requested_ref: { kind: "client", id: CUSTOMER_ID },
      canonical_ref: { kind: "client", id: CUSTOMER_ID },
      relationship: "primary_client",
    },
    sections: {
      profile: {
        display_name: "Baxter Homes",
        parent_display_name: null,
        content_kind: "untrusted_business_data",
      },
      contacts: {
        purpose: "communication",
        source_count: contacts.length,
        source_has_more: false,
        returned_count: contacts.length,
        result_budget_omitted_count: 0,
        contacts,
      },
      duplicate_state: {
        state: input?.duplicateState ?? "clear",
        source_count: 0,
        source_has_more: false,
        returned_count: 0,
        result_budget_omitted_count: 0,
        candidates: [],
      },
    },
    proof: {
      proof_ref: `ops_proof:v1:${"P".repeat(32)}`,
      read_at: "2026-08-31T18:00:00.000Z",
      source_revisions: [{ domain: "customers", source_revision: 4 }],
    },
  }));
  const readService = {
    listSalesDocuments,
    getCustomerContext,
  } as unknown as OpsAgentReadCatalogueService;

  const rpc = vi.fn<CollectionsRpcClient["rpc"]>((functionName, args) => {
    if (functionName === "resolve_agent_collections_timezone_as_system") {
      return Promise.resolve({ data: "America/Vancouver", error: null });
    }
    if (functionName === "inspect_agent_collections_correspondence_as_system") {
      return Promise.resolve({
        data: [
          {
            customer_id: CUSTOMER_ID,
            coverage_state: "complete",
            total_count: 1,
            readable_count: 1,
            unreadable_count: 0,
            latest_direction: "outbound",
            latest_delivered_at: "2026-08-10T18:00:00.000Z",
            fresh_at: "2026-08-31T18:00:00.000Z",
            normalization_revision: "ops.correspondence.normalized-text.v2",
            ...(input?.correspondence ?? {}),
          },
        ],
        error: null,
      });
    }
    if (functionName === "persist_agent_collections_as_system") {
      const base = args.p_result_base as {
        debtors: Array<
          Record<string, unknown> & { draft: Record<string, unknown> }
        >;
        receipt: Record<string, unknown>;
      } & Record<string, unknown>;
      return Promise.resolve({
        data: {
          replayed: false,
          result: {
            ...base,
            run_id: RUN_ID,
            debtors: base.debtors.map((debtor) => ({
              ...debtor,
              draft:
                debtor.draft.kind === "prepared"
                  ? {
                      kind: "approval_required",
                      action_id: ACTION_ID,
                      change_set_id: CHANGE_SET_ID,
                      approval_url: "/agent/queue",
                      preview: debtor.draft.preview,
                      preview_sha256: `sha256:${"c".repeat(64)}`,
                      expires_at: "2026-09-03T18:00:00.000Z",
                    }
                  : debtor.draft,
            })),
            receipt: { ...base.receipt, replayed: false },
          },
        },
        error: null,
      });
    }
    throw new Error(`unexpected RPC: ${functionName}`);
  });
  const service = createCollectionsService({
    readService,
    repository: createCollectionsRepository({ rpc }),
    authorityRepository: authorityClient.repository,
    now: () => new Date("2026-08-31T18:00:00.000Z"),
  });
  return {
    actor,
    authorityClient,
    getCustomerContext,
    listSalesDocuments,
    rpc,
    service,
  };
}

describe("collections service", () => {
  it("computes every exact aging edge and one consolidated debtor draft", async () => {
    const { actor, rpc, service } = await fixture({
      days: [0, 1, 30, 31, 60, 61, 90, 91],
    });

    const result = await service.prepareCollections(actor, {
      as_of_date: "2026-08-31",
      idempotency_key: "collections-aging-edges",
    });

    expect(result.debtors).toHaveLength(1);
    expect(
      result.debtors[0]!.invoices.map((item) => item.aging_bucket)
    ).toEqual([
      "91_plus",
      "61_90",
      "61_90",
      "31_60",
      "31_60",
      "1_30",
      "1_30",
      "current",
    ]);
    expect(result.debtors[0]!.balances).toEqual([
      {
        currency: "CAD",
        amount_minor: 80_000,
        invoice_count: 8,
        buckets: {
          current: { amount_minor: 10_000, invoice_count: 1 },
          "1_30": { amount_minor: 20_000, invoice_count: 2 },
          "31_60": { amount_minor: 20_000, invoice_count: 2 },
          "61_90": { amount_minor: 20_000, invoice_count: 2 },
          "91_plus": { amount_minor: 10_000, invoice_count: 1 },
        },
      },
    ]);
    expect(result.debtors[0]!.draft).toMatchObject({
      kind: "approval_required",
      preview: {
        escalation_tier: "91_plus",
        recipient: { address: "accounts@baxter.example" },
      },
    });
    if (result.debtors[0]!.draft.kind !== "approval_required") {
      throw new Error("expected approval draft");
    }
    expect(result.debtors[0]!.draft.preview.body).toContain("91 days overdue");
    expect(result.debtors[0]!.draft.preview.body).not.toMatch(
      /lien|lawyer|legal|collection agency|credit report/i
    );
    expect(
      rpc.mock.calls.find(
        ([name]) => name === "persist_agent_collections_as_system"
      )?.[1]
    ).toMatchObject({
      p_actor_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_oauth_grant_id: GRANT_ID,
      p_oauth_client_id: CLIENT_ID,
      p_exposure_revision: "2026-08-31.mcp-exposure.v4",
      p_capability_manifest_revision: COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
    });
  });

  it("blocks a debtor instead of guessing when the recipient is ambiguous", async () => {
    const sub = (id: string, address: string) => ({
      contact_ref: { kind: "sub_client", id },
      relationship: "sub_client",
      display_name: "Accounts payable",
      title: null,
      email: { state: "contactable", address },
      phone: { state: "unavailable" },
      content_kind: "untrusted_business_data",
    });
    const { actor, service } = await fixture({
      contacts: [
        {
          contact_ref: { kind: "client", id: CUSTOMER_ID },
          relationship: "primary_client",
          display_name: "Baxter Homes",
          title: null,
          email: { state: "unavailable" },
          phone: { state: "unavailable" },
          content_kind: "untrusted_business_data",
        },
        sub("99999999-9999-4999-8999-999999999991", "ap1@baxter.example"),
        sub("99999999-9999-4999-8999-999999999992", "ap2@baxter.example"),
      ],
    });

    const result = await service.prepareCollections(actor, {
      idempotency_key: "collections-ambiguous-recipient",
    });
    expect(result.debtors[0]).toMatchObject({
      recipient: { state: "blocked", reason: "recipient_ambiguous" },
      draft: { kind: "blocked", reason: "recipient_ambiguous" },
    });
    expect(result.receipt.approvals_created).toBe(0);
  });

  it("blocks approval when delivered correspondence is unreadable or too recent", async () => {
    const { actor, service } = await fixture({
      correspondence: {
        coverage_state: "unavailable",
        readable_count: 0,
        unreadable_count: 1,
        gate_reason: "correspondence_unavailable",
      },
    });
    const result = await service.prepareCollections(actor, {
      idempotency_key: "collections-correspondence-gate",
    });
    expect(result.debtors[0]).toMatchObject({
      correspondence: {
        coverage_state: "unavailable",
        gate_reason: "correspondence_unavailable",
      },
      draft: { kind: "blocked", reason: "correspondence_unavailable" },
    });
  });

  it("fails closed before persistence when the invoice source exceeds 100 rows", async () => {
    const { actor, rpc, service } = await fixture({ fifthPage: true });
    await expect(
      service.prepareCollections(actor, {
        idempotency_key: "collections-source-bound",
      })
    ).rejects.toThrow("COLLECTIONS_INVOICE_SOURCE_BOUND");
    expect(
      rpc.mock.calls.some(
        ([name]) => name === "persist_agent_collections_as_system"
      )
    ).toBe(false);
  });

  it("rejects stale authority before any collections read or RPC", async () => {
    const { actor, listSalesDocuments, rpc, service } = await fixture({
      permissions: PERMISSIONS.filter(
        (permission) => permission !== "email.view"
      ),
    });
    await expect(
      service.prepareCollections(actor, {
        idempotency_key: "collections-missing-email-view",
      })
    ).rejects.toThrow();
    expect(listSalesDocuments).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("threads cancellation through current-authority reauthorization", async () => {
    const { actor, authorityClient, service } = await fixture();
    const signal = new AbortController().signal;
    await service.prepareCollections(
      actor,
      { idempotency_key: "collections-authority-deadline" },
      { signal }
    );
    expect(authorityClient.actorSignals).toEqual([signal, signal]);
  });
});
