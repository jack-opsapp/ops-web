import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const {
  auditRecord,
  createReadClient,
  getProviderRecord,
  getServiceRoleClient,
  getValidToken,
  forceRefresh,
  disconnectGrant,
  applyInbound,
  rpc,
} = vi.hoisted(() => ({
  auditRecord: vi.fn(),
  createReadClient: vi.fn(),
  getProviderRecord: vi.fn(),
  getServiceRoleClient: vi.fn(),
  getValidToken: vi.fn(),
  forceRefresh: vi.fn(),
  disconnectGrant: vi.fn(),
  applyInbound: vi.fn(),
  rpc: vi.fn(),
}));

const COMPANY_ID = "20000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "30000000-0000-4000-8000-000000000001";
const INVOICE_ID = "40000000-0000-4000-8000-000000000001";

let connections: Row[];
let queue: Row[];
let reconcileCandidates: Row[];

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const rows = table === "accounting_connections" ? connections : queue;
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({
      data: rows.find((row) => matches(row, filters)) ?? null,
      error: null,
    }),
    insert: async (value: Row) => {
      rows.push(value);
      return { data: value, error: null };
    },
  };
  return query;
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => {
    getServiceRoleClient();
    return {
      from: (table: string) => builder(table),
      rpc: (name: string, args: Row) => rpc(name, args),
    };
  },
}));

vi.mock("@/lib/api/services/accounting-sync-audit-service", () => ({
  AccountingSyncAuditService: vi.fn(() => ({ record: auditRecord })),
}));

vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken,
    forceRefresh,
    disconnectGrant,
  },
}));

vi.mock("@/lib/api/services/token-cipher", () => ({
  decryptToken: (value: string | null) =>
    value === "encrypted-business-1" ? "business-1" : null,
}));

vi.mock("@/lib/api/services/sage-api-client", () => ({
  createSageReadClient: (options: Row) => {
    createReadClient(options);
    return { get: getProviderRecord };
  },
}));

vi.mock("@/lib/api/services/sage-inbound-apply-service", () => ({
  SageInboundApplyService: vi.fn(() => ({ apply: applyInbound })),
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  runWithCronWorkloadControl: vi.fn(
    async ({ work }: { work: () => Promise<unknown> }) => ({
      status: "completed",
      value: await work(),
    })
  ),
}));

import { POST } from "@/app/api/cron/accounting/sage/reconcile/route";

function request(secret = "cron-secret") {
  return new Request("https://ops.test/api/cron/accounting/sage/reconcile", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

function candidate(overrides: Row = {}): Row {
  return {
    company_id: COMPANY_ID,
    connection_id: CONNECTION_ID,
    sync_direction: "bidirectional",
    propagate_deletes: true,
    entity_type: "invoice",
    source_table: "invoices",
    entity_id: INVOICE_ID,
    external_id: "sage-invoice-1",
    resource: "sales_invoices",
    ops_updated_at: "2026-09-04T08:00:00.000Z",
    money_touched: true,
    last_audit_ops_updated_at: "2026-09-04T08:00:00.000Z",
    last_audit_sage_updated_at: "2026-09-04T08:00:00.000Z",
    last_reconciled_at: "2026-09-04T08:00:00.000Z",
    ...overrides,
  };
}

function invoice(updatedAt = "2026-09-04T08:05:00.000Z") {
  return {
    id: "sage-invoice-1",
    updated_at: updatedAt,
    contact: { id: "sage-customer-1" },
    date: "2026-09-01",
    due_date: "2026-09-30",
    reference: "INV-1",
    status: { id: "UNPAID" },
    net_amount: 100,
    tax_amount: 12,
    total_amount: 112,
    outstanding_amount: 112,
    invoice_lines: [
      {
        description: "Panel",
        quantity: 1,
        unit_price: 100,
        net_amount: 100,
        tax_amount: 12,
        total_amount: 112,
        ledger_account: { id: "sales-1" },
        tax_rate: { id: "tax-1", percentage: 12 },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  process.env.SAGE_ACTIVE_PROFILE = "sandbox";
  process.env.ACCOUNTING_WRITE_ENABLED = "true";
  process.env.SAGE_WRITE_ENABLED = "true";
  connections = [
    {
      id: CONNECTION_ID,
      company_id: COMPANY_ID,
      provider: "sage",
      provider_environment: "sandbox",
      is_connected: true,
      sync_enabled: true,
      sync_direction: "bidirectional",
      propagate_deletes: true,
      sage_business_id: "encrypted-business-1",
    },
  ];
  queue = [];
  reconcileCandidates = [candidate()];
  rpc.mockImplementation(async (name: string, args: Row) => {
    if (name !== "list_sage_reconcile_candidates") {
      return { data: null, error: { message: `Unexpected RPC ${name}` } };
    }
    expect(args).toEqual({
      p_provider_environment: "sandbox",
      p_limit: 25,
    });
    return { data: reconcileCandidates, error: null };
  });
  auditRecord.mockResolvedValue("audit-1");
  getValidToken.mockResolvedValue({
    accessToken: "access-1",
    providerEnvironment: "sandbox",
  });
  forceRefresh.mockResolvedValue("access-2");
  disconnectGrant.mockResolvedValue(undefined);
  getProviderRecord.mockResolvedValue(invoice());
  applyInbound.mockResolvedValue({
    opsUpdatedAt: "2026-09-04T08:06:00.000Z",
  });
});

describe("Sage reconcile route", () => {
  it("rejects unauthorized callers before creating a service client", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("reads and applies the exact Sage business and document", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ processed: 1, sageWon: 1 })
    );
    expect(createReadClient).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "business-1" })
    );
    expect(getProviderRecord).toHaveBeenCalledWith(
      "sales_invoices",
      "sage-invoice-1"
    );
    expect(applyInbound).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: CONNECTION_ID }),
      expect.objectContaining({ externalId: "sage-invoice-1" })
    );
    expect(queue).toEqual([]);
  });

  it("fails closed instead of enqueueing an OPS win while provider writes are disabled", async () => {
    process.env.SAGE_WRITE_ENABLED = "false";
    reconcileCandidates = [
      candidate({ ops_updated_at: "2026-09-04T08:05:00.000Z" }),
    ];
    getProviderRecord.mockResolvedValue(invoice("2026-09-04T08:00:00.000Z"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ processed: 1, needsReview: 1, opsWon: 0 })
    );
    expect(queue).toEqual([]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "needs_review",
        error: expect.stringContaining("cannot write"),
      })
    );
  });

  it("quarantines a source/resource substitution before provider I/O", async () => {
    reconcileCandidates = [candidate({ source_table: "payments" })];

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(getProviderRecord).not.toHaveBeenCalled();
  });

  it("deduplicates an OPS-won pending update", async () => {
    reconcileCandidates = [
      candidate({ ops_updated_at: "2026-09-04T08:05:00.000Z" }),
    ];
    getProviderRecord.mockResolvedValue(invoice("2026-09-04T08:00:00.000Z"));
    queue.push({
      id: "queue-1",
      connection_id: CONNECTION_ID,
      provider: "sage",
      entity_type: "invoice",
      entity_id: INVOICE_ID,
      operation: "update",
      idempotency_key: `invoice:${INVOICE_ID}`,
      status: "pending",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ processed: 1, opsWon: 1 })
    );
    expect(queue).toHaveLength(1);
  });
});
