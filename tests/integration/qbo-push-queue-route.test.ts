import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountingSyncQueueRow } from "@/lib/api/services/accounting-sync-queue-types";

const claimDue = vi.fn();
const markSucceeded = vi.fn();
const scheduleRetry = vi.fn();
const markBlocked = vi.fn();
const markNeedsReview = vi.fn();
const record = vi.fn();
const getValidToken = vi.fn();
const writeCreate = vi.fn();
const writeUpdate = vi.fn();
const writeVoid = vi.fn();
const writeFetchCurrent = vi.fn();

vi.mock("@/lib/api/services/accounting-sync-queue-service", () => ({
  AccountingSyncQueueService: vi.fn(() => ({
    claimDue,
    markSucceeded,
    scheduleRetry,
    markBlocked,
    markNeedsReview,
  })),
}));

vi.mock("@/lib/api/services/accounting-sync-audit-service", () => ({
  AccountingSyncAuditService: vi.fn(() => ({ record })),
}));

class MockReconnectRequiredError extends Error {
  readonly code = "reconnect_required" as const;
}

vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: { getValidToken },
  ReconnectRequiredError: MockReconnectRequiredError,
}));

vi.mock("@/lib/api/services/quickbooks-write-service", () => ({
  QuickBooksWriteService: vi.fn(() => ({
    create: writeCreate,
    update: writeUpdate,
    void: writeVoid,
    fetchCurrent: writeFetchCurrent,
  })),
}));

type Row = Record<string, unknown>;

interface MockState {
  accounting_connections: Row[];
  clients: Row[];
  sub_clients: Row[];
  invoices: Row[];
  estimates: Row[];
  payments: Row[];
  line_items: Row[];
  companies: Row[];
  notifications: Row[];
  accounting_sync_queue: Row[];
  updateErrors: Record<string, string>;
  calls: Array<{ table?: string; method: string; args: unknown[] }>;
}

let state: MockState;

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    accounting_connections: [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        provider: "quickbooks",
        is_connected: true,
        sync_enabled: true,
        sync_direction: "bidirectional",
      },
    ],
    clients: [],
    sub_clients: [],
    invoices: [],
    estimates: [],
    payments: [],
    line_items: [],
    companies: [{ id: COMPANY_ID, admin_ids: [ADMIN_ID] }],
    notifications: [],
    accounting_sync_queue: [],
    updateErrors: {},
    calls: [],
    ...overrides,
  };
}

function rowsFor(table: string): Row[] {
  const key = table as keyof MockState;
  const rows = state[key];
  if (Array.isArray(rows)) return rows as Row[];
  return [];
}

function matchesFilters(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const orders: Array<{ column: string; ascending: boolean }> = [];
  let mode: "select" | "update" | null = null;
  let patch: Row | null = null;
  const selectResult = () => {
    const rows = rowsFor(table).filter((row) => matchesFilters(row, filters));
    return rows.sort((a, b) => {
      for (const order of orders) {
        const aValue = a[order.column];
        const bValue = b[order.column];
        if (aValue === bValue) continue;
        if (aValue === null || aValue === undefined) return order.ascending ? 1 : -1;
        if (bValue === null || bValue === undefined) return order.ascending ? -1 : 1;
        return String(aValue).localeCompare(String(bValue)) * (order.ascending ? 1 : -1);
      }
      return 0;
    });
  };
  const builder = {
    select: (...args: unknown[]) => {
      state.calls.push({ table, method: "select", args });
      mode = "select";
      return builder;
    },
    update: (values: Row) => {
      state.calls.push({ table, method: "update", args: [values] });
      mode = "update";
      patch = values;
      return builder;
    },
    insert: (values: Row | Row[]) => {
      state.calls.push({ table, method: "insert", args: [values] });
      const inserts = Array.isArray(values) ? values : [values];
      rowsFor(table).push(...inserts);
      return Promise.resolve({ data: values, error: null });
    },
    eq: (column: string, value: unknown) => {
      state.calls.push({ table, method: "eq", args: [column, value] });
      filters.push([column, value]);
      return builder;
    },
    is: (column: string, value: unknown) => {
      state.calls.push({ table, method: "is", args: [column, value] });
      filters.push([column, value]);
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      const args: unknown[] = [column, options];
      state.calls.push({ table, method: "order", args });
      orders.push({ column, ascending: options?.ascending !== false });
      return builder;
    },
    limit: (...args: unknown[]) => {
      state.calls.push({ table, method: "limit", args });
      return builder;
    },
    maybeSingle: async () => {
      state.calls.push({ table, method: "maybeSingle", args: [] });
      const matched = selectResult()[0] ?? null;
      return { data: matched, error: null };
    },
    single: async () => {
      state.calls.push({ table, method: "single", args: [] });
      const matched = selectResult()[0] ?? null;
      return matched ? { data: matched, error: null } : { data: null, error: { message: "not found" } };
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      const result = (() => {
        if (mode === "update" && patch) {
          const updateError = state.updateErrors[table];
          if (updateError) return { data: null, error: { message: updateError } };

          for (const row of rowsFor(table)) {
            if (matchesFilters(row, filters)) Object.assign(row, patch);
          }
          return { data: null, error: null };
        }
        return { data: selectResult(), error: null };
      })();
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

function makeSupabase() {
  return {
    from: (table: string) => makeBuilder(table),
    rpc: vi.fn((name: string, args: Row) => {
      state.calls.push({ method: `rpc:${name}`, args: [args] });
      if (name === "suppress_accounting_sync" && state.accounting_connections[0].force_suppress_error) {
        return Promise.resolve({ data: null, error: { message: "suppress failed" } });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeSupabase(),
}));

const COMPANY_ID = "7a88c7d6-d4e3-49be-9d21-0a989e0f3222";
const CONNECTION_ID = "91d98e28-36ec-4060-b047-3cb5cc342a12";
const ADMIN_ID = "operator-1";
const CUSTOMER_ID = "2873266e-8d86-47e4-819b-7e570084f06f";
const INVOICE_ID = "d9f024cf-f8b0-4e0c-9930-459e3b49660b";

function queueRow(overrides: Partial<AccountingSyncQueueRow> = {}): AccountingSyncQueueRow {
  return {
    id: "q-1",
    companyId: COMPANY_ID,
    connectionId: CONNECTION_ID,
    provider: "quickbooks",
    entityType: "invoice",
    entityId: INVOICE_ID,
    externalId: null,
    operation: "create",
    sourceTable: "invoices",
    sourceAction: "insert",
    sourceUpdatedAt: "2026-06-05T10:00:00.000Z",
    idempotencyKey: `invoice:${INVOICE_ID}`,
    status: "claimed",
    attempts: 1,
    maxAttempts: 5,
    runAfter: "2026-06-05T10:00:00.000Z",
    lockedAt: "2026-06-05T10:00:01.000Z",
    lockedBy: "worker-1",
    lastError: null,
    payloadSnapshot: {},
    createdAt: "2026-06-05T09:59:00.000Z",
    updatedAt: "2026-06-05T10:00:01.000Z",
    ...overrides,
  };
}

function authorizedRequest(secret = "cron-secret") {
  return new Request("http://localhost/api/cron/accounting/quickbooks/push-queue", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  }) as never;
}

async function loadPost() {
  return (await import("@/app/api/cron/accounting/quickbooks/push-queue/route")).POST;
}

describe("POST /api/cron/accounting/quickbooks/push-queue", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of [
      claimDue,
      markSucceeded,
      scheduleRetry,
      markBlocked,
      markNeedsReview,
      record,
      getValidToken,
      writeCreate,
      writeUpdate,
      writeVoid,
      writeFetchCurrent,
    ]) {
      mock.mockReset();
    }
    state = makeState();
    process.env.CRON_SECRET = "cron-secret";
    process.env.ACCOUNTING_WRITE_ENABLED = "false";
    process.env.QB_ENVIRONMENT = "sandbox";
    delete process.env.QBO_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QBO_FALLBACK_SERVICE_ITEM_NAME;
    delete process.env.QB_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QB_FALLBACK_SERVICE_ITEM_NAME;
    delete process.env.QBO_SANDBOX_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QBO_SANDBOX_FALLBACK_SERVICE_ITEM_NAME;
    delete process.env.QB_SANDBOX_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QB_SANDBOX_FALLBACK_SERVICE_ITEM_NAME;
    delete process.env.QBO_PRODUCTION_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QBO_PRODUCTION_FALLBACK_SERVICE_ITEM_NAME;
    delete process.env.QB_PRODUCTION_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QB_PRODUCTION_FALLBACK_SERVICE_ITEM_NAME;
    claimDue.mockResolvedValue([]);
    getValidToken.mockResolvedValue({ accessToken: "access-token", realmId: "462081636529" });
    writeCreate.mockResolvedValue({ qbId: "123", syncToken: "0", metaUpdatedAt: "2026-06-05T10:01:00Z" });
    writeUpdate.mockResolvedValue({ qbId: "90", syncToken: "6", metaUpdatedAt: "2026-06-05T10:02:00Z" });
    writeVoid.mockResolvedValue({ qbId: "90", syncToken: "6", metaUpdatedAt: "2026-06-05T10:02:00Z" });
    writeFetchCurrent.mockResolvedValue({
      Invoice: { Id: "90", SyncToken: "5", MetaData: { LastUpdatedTime: "2026-06-05T10:00:00Z" } },
    });
    markSucceeded.mockResolvedValue(undefined);
    scheduleRetry.mockResolvedValue(null);
    markBlocked.mockResolvedValue(undefined);
    markNeedsReview.mockResolvedValue(undefined);
    record.mockResolvedValue("evt-1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 for unauthorized requests and does not claim", async () => {
    const POST = await loadPost();
    const res = await POST(new Request("http://localhost/api/cron/accounting/quickbooks/push-queue", { method: "POST" }) as never);

    expect(res.status).toBe(401);
    expect(claimDue).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(401);
    expect(claimDue).not.toHaveBeenCalled();
  });

  it("returns ACCOUNTING_WRITE_DISABLED when the write gate is not true and does not claim", async () => {
    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "ACCOUNTING_WRITE_DISABLED" }));
    expect(claimDue).not.toHaveBeenCalled();
  });

  it("claims QuickBooks rows with limit 25 when the write gate is true", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "quickbooks", limit: 25, workerId: expect.stringMatching(/^qbo-push-/) }),
    );
  });

  it("returns an empty bounded-batch summary when no rows are due", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ processed: 0, failed: 0, succeeded: 0 }),
    );
  });

  it("blocks an invoice row when the linked customer has no QuickBooks id", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([queueRow()]);
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      qb_id: null,
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "blocked",
        decision: "blocked",
        error: "QuickBooks customer link required",
      }),
    );
    expect(markBlocked).toHaveBeenCalledWith("q-1", "QuickBooks customer link required", expect.anything());
    expectConnectionWasChecked();
    expect(state.notifications).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID,
        user_id: ADMIN_ID,
        persistent: true,
        action_url: "/settings?tab=accounting",
      }),
    ]);
  });

  it("blocks an update row without any durable QuickBooks id and never creates a QBO record", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.QBO_FALLBACK_SERVICE_ITEM_ID = "1";
    claimDue.mockResolvedValue([
      queueRow({
        operation: "update",
        externalId: null,
      }),
    ]);
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({ id: CUSTOMER_ID, company_id: COMPANY_ID, name: "Maverick Projects", qb_id: "44" });
    state.line_items.push({
      id: "line-1",
      company_id: COMPANY_ID,
      invoice_id: INVOICE_ID,
      name: "Field work",
      quantity: 2,
      unit_price: 62.5,
      line_total: 125,
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(markBlocked).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks invoice update requires an existing qb_id or queue external_id",
      expect.anything(),
    );
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("writes a returned customer qb_id without creating a broad sync suppression", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "customer",
        entityId: CUSTOMER_ID,
        operation: "create",
        sourceTable: "clients",
        idempotencyKey: `customer:${CUSTOMER_ID}`,
      }),
    ]);
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      email: "office@maverick.test",
      phone_number: "778-555-0100",
      address: "12 Yard Rd",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledWith("Customer", expect.objectContaining({ DisplayName: "Maverick Projects" }));
    const suppressIndex = state.calls.findIndex((call) => call.method === "rpc:suppress_accounting_sync");
    const updateIndex = state.calls.findIndex((call) => call.table === "clients" && call.method === "update");
    expect(suppressIndex).toBe(-1);
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(state.clients[0].qb_id).toBe("123");
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "123", workerId: expect.any(String) });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", decision: "ops_won", externalId: "123" }),
    );
  });

  it("uses the queued external id to update a re-entered customer create without local qb_id", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "customer",
        entityId: CUSTOMER_ID,
        operation: "create",
        externalId: "123",
        sourceTable: "clients",
        idempotencyKey: `customer:${CUSTOMER_ID}`,
      }),
    ]);
    writeFetchCurrent.mockResolvedValueOnce({
      Customer: { Id: "123", SyncToken: "4", MetaData: { LastUpdatedTime: "2026-06-05T10:00:00Z" } },
    });
    writeUpdate.mockResolvedValueOnce({ qbId: "123", syncToken: "5", metaUpdatedAt: "2026-06-05T10:02:00Z" });
    let suppressCalledAtMarkSucceeded = false;
    let clientLinkedAtMarkSucceeded = false;
    markSucceeded.mockImplementationOnce(async () => {
      const suppressIndex = state.calls.findIndex((call) => call.method === "rpc:suppress_accounting_sync");

      suppressCalledAtMarkSucceeded = suppressIndex >= 0;
      clientLinkedAtMarkSucceeded = state.clients[0].qb_id === "123";
    });
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      email: "office@maverick.test",
      phone_number: "778-555-0100",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeFetchCurrent).toHaveBeenCalledWith("Customer", "123");
    expect(writeUpdate).toHaveBeenCalledWith(
      "Customer",
      expect.objectContaining({
        Id: "123",
        SyncToken: "4",
        DisplayName: "Maverick Projects",
      }),
    );
    expect(writeCreate).not.toHaveBeenCalled();
    expect(state.clients[0].qb_id).toBe("123");
    expect(suppressCalledAtMarkSucceeded).toBe(false);
    expect(clientLinkedAtMarkSucceeded).toBe(true);
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "123", workerId: expect.any(String) });
  });

  it("uses the earliest sub-client as the customer primary contact", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "customer",
        entityId: CUSTOMER_ID,
        operation: "create",
        sourceTable: "clients",
        idempotencyKey: `customer:${CUSTOMER_ID}`,
      }),
    ]);
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      email: "office@maverick.test",
      phone_number: "778-555-0100",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.sub_clients.push({
      id: "contact-late",
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      name: "Late Contact",
      email: "late@maverick.test",
      phone_number: "778-555-0999",
      created_at: "2026-06-05T11:00:00.000Z",
    });
    state.sub_clients.push({
      id: "contact-early",
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      name: "Early Contact",
      email: "early@maverick.test",
      phone_number: "778-555-0111",
      created_at: "2026-06-05T09:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledWith(
      "Customer",
      expect.objectContaining({
        PrimaryEmailAddr: { Address: "early@maverick.test" },
        PrimaryPhone: { FreeFormNumber: "778-555-0111" },
      }),
    );
    expect(state.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "sub_clients", method: "order", args: ["created_at", { ascending: true }] }),
      ]),
    );
  });

  it("does not schedule retry when success audit fails after QBO create succeeds", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "customer",
        entityId: CUSTOMER_ID,
        operation: "create",
        sourceTable: "clients",
        idempotencyKey: `customer:${CUSTOMER_ID}`,
      }),
    ]);
    record.mockRejectedValueOnce(new Error("audit insert failed"));
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks write succeeded but worker finalization failed: audit insert failed",
      expect.objectContaining({ externalId: "123" }),
    );
  });

  it("does not schedule retry when markSucceeded fails after QBO create succeeds", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "customer",
        entityId: CUSTOMER_ID,
        operation: "create",
        sourceTable: "clients",
        idempotencyKey: `customer:${CUSTOMER_ID}`,
      }),
    ]);
    markSucceeded.mockRejectedValueOnce(new Error("claim owner lost"));
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks write succeeded but worker finalization failed: claim owner lost",
      expect.objectContaining({ externalId: "123" }),
    );
  });

  it("makes a direct terminal queue update when markNeedsReview also fails after QBO create succeeds", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    const row = queueRow({
      entityType: "customer",
      entityId: CUSTOMER_ID,
      operation: "create",
      sourceTable: "clients",
      idempotencyKey: `customer:${CUSTOMER_ID}`,
      lockedBy: "worker-1",
    });
    claimDue.mockResolvedValue([row]);
    markSucceeded.mockRejectedValueOnce(new Error("claim owner lost"));
    markNeedsReview.mockRejectedValueOnce(new Error("needs review update failed"));
    state.accounting_sync_queue.push({
      id: row.id,
      status: "claimed",
      locked_by: row.lockedBy,
      external_id: null,
      last_error: null,
    });
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(state.accounting_sync_queue[0]).toEqual(
      expect.objectContaining({
        status: "needs_review",
        external_id: "123",
        locked_at: null,
        locked_by: null,
        last_error: "QuickBooks write succeeded but worker finalization failed: claim owner lost",
      }),
    );
  });

  it("does not schedule retry when qb_id writeback update fails after QBO create succeeds", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "customer",
        entityId: CUSTOMER_ID,
        operation: "create",
        sourceTable: "clients",
        idempotencyKey: `customer:${CUSTOMER_ID}`,
      }),
    ]);
    state.clients.push({
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: "Maverick Projects",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.updateErrors.clients = "client qb_id update failed";

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledTimes(1);
    expect(state.clients[0].qb_id).toBeNull();
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks write succeeded but worker finalization failed: OPS qb_id writeback failed: client qb_id update failed",
      expect.objectContaining({ externalId: "123" }),
    );
  });

  it("schedules retry and records retry audit for retryable QuickBooks write statuses", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.QBO_FALLBACK_SERVICE_ITEM_ID = "1";
    claimDue.mockResolvedValue([queueRow()]);
    writeCreate.mockRejectedValue(new Error("QuickBooks write failed: 429"));
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({ id: CUSTOMER_ID, company_id: COMPANY_ID, name: "Maverick Projects", qb_id: "44" });
    state.line_items.push({
      id: "line-1",
      company_id: COMPANY_ID,
      invoice_id: INVOICE_ID,
      name: "Field work",
      quantity: 2,
      unit_price: 62.5,
      line_total: 125,
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(scheduleRetry).toHaveBeenCalledWith(expect.objectContaining({ id: "q-1" }), "QuickBooks write failed: 429", expect.anything());
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        decision: "retry",
        error: "QuickBooks write failed: 429",
      }),
    );
  });

  it("does not retrieve a token or call QBO for pull-only connections", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([queueRow()]);
    state.accounting_connections[0].sync_direction = "pull_only";

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expectConnectionWasChecked();
    expect(getValidToken).not.toHaveBeenCalled();
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks connection is pull_only; outbound writes are disabled",
      expect.anything(),
    );
  });

  it("does not retrieve a token or call QBO for disconnected connections", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([queueRow()]);
    state.accounting_connections[0].is_connected = false;

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expectConnectionWasChecked();
    expect(getValidToken).not.toHaveBeenCalled();
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks connection is disconnected",
      expect.anything(),
    );
  });

  it("does not retrieve a token or call QBO for sync-disabled connections", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([queueRow()]);
    state.accounting_connections[0].sync_enabled = false;

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expectConnectionWasChecked();
    expect(getValidToken).not.toHaveBeenCalled();
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks connection sync is disabled",
      expect.anything(),
    );
  });

  it("treats invalid local QuickBooks ids as deterministic and does not schedule retry", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.QBO_FALLBACK_SERVICE_ITEM_ID = "1";
    writeFetchCurrent.mockRejectedValueOnce(new Error("Invalid QuickBooks id"));
    claimDue.mockResolvedValue([
      queueRow({
        operation: "update",
        externalId: null,
      }),
    ]);
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: "abc-90",
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({ id: CUSTOMER_ID, company_id: COMPANY_ID, name: "Maverick Projects", qb_id: "44" });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeFetchCurrent).toHaveBeenCalledWith("Invoice", "abc-90");
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(markBlocked).toHaveBeenCalledWith("q-1", "Invalid QuickBooks id", expect.anything());
  });

  it("fetches current SyncToken and uses the update payload path for linked invoices", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.QBO_FALLBACK_SERVICE_ITEM_ID = "1";
    claimDue.mockResolvedValue([
      queueRow({
        operation: "update",
        externalId: "90",
      }),
    ]);
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: "90",
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({ id: CUSTOMER_ID, company_id: COMPANY_ID, name: "Maverick Projects", qb_id: "44" });
    state.line_items.push({
      id: "line-1",
      company_id: COMPANY_ID,
      invoice_id: INVOICE_ID,
      name: "Field work",
      quantity: 2,
      unit_price: 62.5,
      line_total: 125,
    });
    state.line_items.push({
      id: "line-0",
      company_id: COMPANY_ID,
      invoice_id: INVOICE_ID,
      name: "Site prep",
      quantity: 1,
      unit_price: 25,
      line_total: 25,
      sort_order: 0,
    });
    state.line_items[0].sort_order = 1;

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeFetchCurrent).toHaveBeenCalledWith("Invoice", "90");
    expect(writeUpdate).toHaveBeenCalledWith(
      "Invoice",
      expect.objectContaining({
        Id: "90",
        SyncToken: "5",
        CustomerRef: { value: "44" },
        Line: [
          expect.objectContaining({ Description: "Site prep" }),
          expect.objectContaining({ Description: "Field work" }),
        ],
      }),
    );
    expect(writeCreate).not.toHaveBeenCalled();
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "90", workerId: expect.any(String) });
  });

  it("resolves stale QuickBooks review notifications after a later successful write for the same entity", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.QBO_FALLBACK_SERVICE_ITEM_ID = "1";
    claimDue.mockResolvedValue([
      queueRow({
        operation: "update",
        externalId: "90",
      }),
    ]);
    state.notifications.push(
      {
        id: "n-blocked",
        company_id: COMPANY_ID,
        is_read: false,
        resolved_at: null,
        dedupe_key: `qbo-sync:${COMPANY_ID}:invoice:${INVOICE_ID}:blocked`,
      },
      {
        id: "n-review",
        company_id: COMPANY_ID,
        is_read: false,
        resolved_at: null,
        dedupe_key: `qbo-sync:${COMPANY_ID}:invoice:${INVOICE_ID}:needs_review`,
      },
      {
        id: "n-other",
        company_id: COMPANY_ID,
        is_read: false,
        resolved_at: null,
        dedupe_key: `qbo-sync:${COMPANY_ID}:payment:payment-1:needs_review`,
      },
    );
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: "90",
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({ id: CUSTOMER_ID, company_id: COMPANY_ID, name: "Maverick Projects", qb_id: "44" });
    state.line_items.push({
      id: "line-1",
      company_id: COMPANY_ID,
      invoice_id: INVOICE_ID,
      name: "Field work",
      quantity: 2,
      unit_price: 62.5,
      line_total: 125,
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(state.notifications.find((row) => row.id === "n-blocked")).toEqual(
      expect.objectContaining({ is_read: true, resolved_at: expect.any(String) }),
    );
    expect(state.notifications.find((row) => row.id === "n-review")).toEqual(
      expect.objectContaining({ is_read: true, resolved_at: expect.any(String) }),
    );
    expect(state.notifications.find((row) => row.id === "n-other")).toEqual(
      expect.objectContaining({ is_read: false, resolved_at: null }),
    );
  });

  it("uses the sandbox fallback service item for sandbox invoice creates", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.QBO_FALLBACK_SERVICE_ITEM_ID = "1";
    process.env.QBO_SANDBOX_FALLBACK_SERVICE_ITEM_ID = "18";
    process.env.QBO_SANDBOX_FALLBACK_SERVICE_ITEM_NAME = "General services:Venue Rental";
    getValidToken.mockResolvedValueOnce({
      accessToken: "access-token",
      realmId: "462081636529",
      providerEnvironment: "sandbox",
    });
    claimDue.mockResolvedValue([queueRow()]);
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      client_id: CUSTOMER_ID,
      invoice_number: "INV-1001",
      total: 125,
      issue_date: "2026-06-05",
      due_date: "2026-06-20",
      qb_id: null,
      updated_at: "2026-06-05T10:00:00.000Z",
    });
    state.clients.push({ id: CUSTOMER_ID, company_id: COMPANY_ID, name: "Maverick Projects", qb_id: "44" });
    state.line_items.push({
      id: "line-1",
      company_id: COMPANY_ID,
      invoice_id: INVOICE_ID,
      name: "Field work",
      quantity: 2,
      unit_price: 62.5,
      line_total: 125,
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeCreate).toHaveBeenCalledWith(
      "Invoice",
      expect.objectContaining({
        Line: [
          expect.objectContaining({
            SalesItemLineDetail: expect.objectContaining({
              ItemRef: { value: "18", name: "General services:Venue Rental" },
            }),
          }),
        ],
      }),
    );
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "123", workerId: expect.any(String) });
  });

  it("voids linked invoices with the current SyncToken and does not require customer or line data", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        operation: "void",
        externalId: "90",
      }),
    ]);
    state.invoices.push({
      id: INVOICE_ID,
      company_id: COMPANY_ID,
      invoice_number: "INV-1001",
      qb_id: "90",
      updated_at: "2026-06-05T10:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeFetchCurrent).toHaveBeenCalledWith("Invoice", "90");
    expect(writeVoid).toHaveBeenCalledWith("Invoice", { Id: "90", SyncToken: "5" });
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "90", workerId: expect.any(String) });
  });

  it("voids linked payments as sparse QuickBooks void updates", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "payment",
        entityId: "payment-1",
        operation: "void",
        sourceTable: "payments",
        idempotencyKey: "payment:payment-1:void",
        externalId: "77",
      }),
    ]);
    writeFetchCurrent.mockResolvedValueOnce({
      Payment: { Id: "77", SyncToken: "1", MetaData: { LastUpdatedTime: "2026-06-05T10:00:00Z" } },
    });
    writeVoid.mockResolvedValueOnce({ qbId: "77", syncToken: "2", metaUpdatedAt: "2026-06-05T10:02:00Z" });
    state.payments.push({
      id: "payment-1",
      company_id: COMPANY_ID,
      amount: 25,
      qb_id: "77",
      voided_at: "2026-06-05T10:00:00.000Z",
      created_at: "2026-06-05T09:00:00.000Z",
    });

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeFetchCurrent).toHaveBeenCalledWith("Payment", "77");
    expect(writeVoid).toHaveBeenCalledWith("Payment", { Id: "77", SyncToken: "1", sparse: true });
    expect(writeCreate).not.toHaveBeenCalled();
    expect(writeUpdate).not.toHaveBeenCalled();
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "77", workerId: expect.any(String) });
  });

  it("keeps unsupported QuickBooks estimate voids in operator review", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    claimDue.mockResolvedValue([
      queueRow({
        entityType: "estimate",
        entityId: "estimate-1",
        operation: "void",
        sourceTable: "estimates",
        idempotencyKey: "estimate:estimate-1:void",
      }),
    ]);

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(getValidToken).not.toHaveBeenCalled();
    expect(writeVoid).not.toHaveBeenCalled();
    expect(markNeedsReview).toHaveBeenCalledWith(
      "q-1",
      "QuickBooks estimate void requires operator review",
      expect.anything(),
    );
  });
});

function expectConnectionWasChecked() {
  expect(state.calls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: "accounting_connections", method: "eq", args: ["id", CONNECTION_ID] }),
      expect.objectContaining({ table: "accounting_connections", method: "eq", args: ["company_id", COMPANY_ID] }),
      expect.objectContaining({ table: "accounting_connections", method: "eq", args: ["provider", "quickbooks"] }),
    ]),
  );
}
