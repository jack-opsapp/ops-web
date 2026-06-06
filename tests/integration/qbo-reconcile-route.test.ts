import { beforeEach, describe, expect, it, vi } from "vitest";

const auditRecord = vi.fn();
const applyEntity = vi.fn();
const getValidToken = vi.fn();
const fetchEntityById = vi.fn();
const qbWriteCalls = { value: 0 };

type Row = Record<string, unknown>;

interface State {
  accounting_connections: Row[];
  clients: Row[];
  invoices: Row[];
  estimates: Row[];
  payments: Row[];
  accounting_sync_events: Row[];
  accounting_sync_queue: Row[];
}

let state: State;

function rowsFor(table: string): Row[] {
  return (state[table as keyof State] as Row[] | undefined) ?? [];
}

function matches(row: Row, filters: Array<{ column: string; op: "eq" | "not"; value: unknown }>) {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    return row[filter.column] !== null && row[filter.column] !== undefined;
  });
}

function makeBuilder(table: string) {
  const filters: Array<{ column: string; op: "eq" | "not"; value: unknown }> = [];
  const orders: Array<{ column: string; ascending: boolean }> = [];

  function selectedRows() {
    return rowsFor(table)
      .filter((row) => matches(row, filters))
      .sort((a, b) => {
        for (const order of orders) {
          const aValue = String(a[order.column] ?? "");
          const bValue = String(b[order.column] ?? "");
          const comparison = aValue.localeCompare(bValue);
          if (comparison !== 0) return order.ascending ? comparison : -comparison;
        }
        return 0;
      });
  }

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push({ column, op: "eq", value });
      return builder;
    },
    not: (column: string) => {
      filters.push({ column, op: "not", value: null });
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orders.push({ column, ascending: options?.ascending !== false });
      return builder;
    },
    limit: () => builder,
    maybeSingle: async () => ({ data: selectedRows()[0] ?? null, error: null }),
    insert: async (value: Row) => {
      rowsFor(table).push(value);
      return { data: value, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: selectedRows(), error: null }).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

vi.mock("@/lib/api/services/accounting-sync-audit-service", () => ({
  AccountingSyncAuditService: vi.fn(() => ({ record: auditRecord })),
}));

vi.mock("@/lib/api/services/quickbooks-webhook-apply-service", () => ({
  QuickBooksWebhookApplyService: vi.fn(() => ({ applyEntity })),
}));

vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: (...args: unknown[]) => getValidToken(...args),
  },
}));

vi.mock("@/lib/api/services/quickbooks-pull-service", () => ({
  QuickBooksPullService: vi.fn(() => ({
    get qbWriteCalls() {
      return qbWriteCalls.value;
    },
    fetchEntityById: (...args: unknown[]) => fetchEntityById(...args),
  })),
}));

const COMPANY_ID = "7a88c7d6-d4e3-49be-9d21-0a989e0f3222";
const CONNECTION_ID = "91d98e28-36ec-4060-b047-3cb5cc342a12";
const INVOICE_ID = "d9f024cf-f8b0-4e0c-9930-459e3b49660b";

function request(secret = "cron-secret") {
  return new Request("http://localhost/api/cron/accounting/quickbooks/reconcile", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function loadPost() {
  return (await import("@/app/api/cron/accounting/quickbooks/reconcile/route")).POST;
}

describe("POST /api/cron/accounting/quickbooks/reconcile", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    qbWriteCalls.value = 0;
    process.env.CRON_SECRET = "cron-secret";
    process.env.QB_ENVIRONMENT = "production";
    delete process.env.QB_ACTIVE_PROFILE;
    delete process.env.ACCOUNTING_WRITE_ENABLED;
    state = {
      accounting_connections: [
        {
          id: CONNECTION_ID,
          company_id: COMPANY_ID,
          provider: "quickbooks",
          provider_environment: "production",
          is_connected: true,
          sync_enabled: true,
          sync_direction: "bidirectional",
          last_sync_at: "2026-06-05T10:00:00.000Z",
        },
      ],
      clients: [],
      invoices: [
        {
          id: INVOICE_ID,
          company_id: COMPANY_ID,
          qb_id: "130",
          updated_at: "2026-06-05T10:05:00.000Z",
        },
      ],
      estimates: [],
      payments: [],
      accounting_sync_events: [
        {
          id: "evt-1",
          company_id: COMPANY_ID,
          connection_id: CONNECTION_ID,
          provider: "quickbooks",
          entity_type: "invoice",
          external_id: "130",
          ops_updated_at: "2026-06-05T10:00:00.000Z",
          qb_updated_at: "2026-06-05T10:01:00.000Z",
          created_at: "2026-06-05T10:01:00.000Z",
        },
      ],
      accounting_sync_queue: [],
    };
    auditRecord.mockResolvedValue("evt-new");
    getValidToken.mockResolvedValue({
      accessToken: "tok",
      realmId: "realm-1",
      providerEnvironment: "production",
    });
    fetchEntityById.mockResolvedValue({
      Id: "130",
      MetaData: { LastUpdatedTime: "2026-06-05T10:01:00.000Z" },
    });
    applyEntity.mockResolvedValue({
      status: "success",
      logEntityType: "estimate",
      qbId: "estimate-qb-1",
      entityId: "estimate-1",
      detail: null,
    });
  });

  it("rejects unauthorized cron calls", async () => {
    const POST = await loadPost();
    const res = await POST(new Request("http://localhost/api/cron/accounting/quickbooks/reconcile"));

    expect(res.status).toBe(401);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("blocks reconcile enqueueing when accounting writes are disabled", async () => {
    const POST = await loadPost();
    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("ACCOUNTING_WRITE_DISABLED");
    expect(state.accounting_sync_queue).toEqual([]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "system",
        status: "blocked",
        decision: "blocked",
        error: "Accounting writes are disabled",
      }),
    );
  });

  it("enqueues an OPS-won linked record when writes are enabled", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    const POST = await loadPost();
    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({ processed: 1, opsWon: 1 }));
    expect(state.accounting_sync_queue).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider: "quickbooks",
        entity_type: "invoice",
        entity_id: INVOICE_ID,
        external_id: "130",
        operation: "update",
        source_table: "invoices",
        source_action: "update",
      }),
    ]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "reconcile",
        entityType: "invoice",
        entityId: INVOICE_ID,
        status: "succeeded",
        decision: "ops_won",
      }),
    );
  });

  it("treats an existing pending reconcile row as an idempotent enqueue", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    state.accounting_sync_queue.push({
      id: "queue-existing",
      company_id: COMPANY_ID,
      connection_id: CONNECTION_ID,
      provider: "quickbooks",
      entity_type: "invoice",
      entity_id: INVOICE_ID,
      external_id: "130",
      operation: "update",
      idempotency_key: `invoice:${INVOICE_ID}`,
      status: "pending",
    });
    const POST = await loadPost();
    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({ processed: 1, opsWon: 1 }));
    expect(state.accounting_sync_queue).toHaveLength(1);
  });

  it("refreshes linked QuickBooks estimates through the inbound apply path during reconcile", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    state.invoices = [];
    state.estimates = [
      {
        id: "estimate-1",
        company_id: COMPANY_ID,
        qb_id: "estimate-qb-1",
        updated_at: "2026-06-05T10:05:00.000Z",
      },
    ];
    state.accounting_sync_events = [
      {
        id: "evt-estimate",
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider: "quickbooks",
        entity_type: "estimate",
        external_id: "estimate-qb-1",
        ops_updated_at: "2026-06-05T10:00:00.000Z",
        qb_updated_at: "2026-06-05T10:01:00.000Z",
        created_at: "2026-06-05T10:01:00.000Z",
      },
    ];
    fetchEntityById.mockResolvedValueOnce({
      Id: "estimate-qb-1",
      MetaData: { LastUpdatedTime: "2026-06-05T10:06:00.000Z" },
    });
    applyEntity.mockResolvedValueOnce({
      status: "success",
      logEntityType: "estimate",
      qbId: "estimate-qb-1",
      entityId: "estimate-1",
      detail: null,
      afterSnapshot: {
        acceptance: { status: "succeeded", project_id: "project-1" },
      },
    });

    const POST = await loadPost();
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(applyEntity).toHaveBeenCalledWith(
      { id: CONNECTION_ID, company_id: COMPANY_ID },
      "Estimate",
      "estimate-qb-1",
      "Update",
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "qb_to_ops",
        source: "reconcile",
        entityType: "estimate",
        entityId: "estimate-1",
        decision: "qb_won",
        afterSnapshot: expect.objectContaining({
          acceptance: expect.objectContaining({ status: "succeeded" }),
        }),
      }),
    );
  });
});
