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
    fetchCurrent: writeFetchCurrent,
  })),
}));

type Row = Record<string, unknown>;

interface MockState {
  clients: Row[];
  sub_clients: Row[];
  invoices: Row[];
  estimates: Row[];
  payments: Row[];
  line_items: Row[];
  companies: Row[];
  notifications: Row[];
  calls: Array<{ table?: string; method: string; args: unknown[] }>;
}

let state: MockState;

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    clients: [],
    sub_clients: [],
    invoices: [],
    estimates: [],
    payments: [],
    line_items: [],
    companies: [{ id: COMPANY_ID, admin_ids: [ADMIN_ID] }],
    notifications: [],
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
  let mode: "select" | "update" | null = null;
  let patch: Row | null = null;
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
    order: (...args: unknown[]) => {
      state.calls.push({ table, method: "order", args });
      return builder;
    },
    limit: (...args: unknown[]) => {
      state.calls.push({ table, method: "limit", args });
      return builder;
    },
    maybeSingle: async () => {
      state.calls.push({ table, method: "maybeSingle", args: [] });
      const matched = rowsFor(table).find((row) => matchesFilters(row, filters)) ?? null;
      return { data: matched, error: null };
    },
    single: async () => {
      state.calls.push({ table, method: "single", args: [] });
      const matched = rowsFor(table).find((row) => matchesFilters(row, filters)) ?? null;
      return matched ? { data: matched, error: null } : { data: null, error: { message: "not found" } };
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      const result = (() => {
        if (mode === "update" && patch) {
          for (const row of rowsFor(table)) {
            if (matchesFilters(row, filters)) Object.assign(row, patch);
          }
          return { data: null, error: null };
        }
        return { data: rowsFor(table).filter((row) => matchesFilters(row, filters)), error: null };
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
    vi.clearAllMocks();
    state = makeState();
    process.env.CRON_SECRET = "cron-secret";
    process.env.ACCOUNTING_WRITE_ENABLED = "false";
    process.env.QB_ENVIRONMENT = "sandbox";
    delete process.env.QBO_FALLBACK_SERVICE_ITEM_ID;
    delete process.env.QBO_FALLBACK_SERVICE_ITEM_NAME;
    claimDue.mockResolvedValue([]);
    getValidToken.mockResolvedValue({ accessToken: "access-token", realmId: "462081636529" });
    writeCreate.mockResolvedValue({ qbId: "123", syncToken: "0", metaUpdatedAt: "2026-06-05T10:01:00Z" });
    writeUpdate.mockResolvedValue({ qbId: "90", syncToken: "6", metaUpdatedAt: "2026-06-05T10:02:00Z" });
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
    expect(state.notifications).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID,
        user_id: ADMIN_ID,
        persistent: true,
        action_url: "/settings?tab=accounting",
      }),
    ]);
  });

  it("writes a returned customer qb_id only after suppressing the concrete OPS entity", async () => {
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
    expect(suppressIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(suppressIndex);
    expect(state.clients[0].qb_id).toBe("123");
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "123", workerId: expect.any(String) });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", decision: "ops_won", externalId: "123" }),
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

    const POST = await loadPost();
    const res = await POST(authorizedRequest());

    expect(res.status).toBe(200);
    expect(writeFetchCurrent).toHaveBeenCalledWith("Invoice", "90");
    expect(writeUpdate).toHaveBeenCalledWith(
      "Invoice",
      expect.objectContaining({ Id: "90", SyncToken: "5", CustomerRef: { value: "44" } }),
    );
    expect(writeCreate).not.toHaveBeenCalled();
    expect(markSucceeded).toHaveBeenCalledWith("q-1", { externalId: "90", workerId: expect.any(String) });
  });
});
