/**
 * GET /api/admin/company/[id] — bug 2577ac54.
 *
 * The route ran four inline queries against columns and a table that do not
 * exist (pipeline_references, estimates.total_amount, invoices.total_amount,
 * payments.deleted_at) and destructured only { data }, so every failure was
 * served to the admin as an empty array. It must read the live schema and it
 * must answer 500 when a read fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DatabaseError = { code?: string; message: string };
type DatabaseResult = { data: unknown; error: DatabaseError | null };

interface RecordedQuery {
  table: string;
  columns?: string;
  filters: { op: string; column: string; value: unknown }[];
}

const { verifyAdminAuthMock, isAdminEmailMock, getCompanyDetailMock, getCompanyUsageTimelineMock, listAllAuthUsersMock, getAdminSupabaseMock } =
  vi.hoisted(() => ({
    verifyAdminAuthMock: vi.fn(),
    isAdminEmailMock: vi.fn(),
    getCompanyDetailMock: vi.fn(),
    getCompanyUsageTimelineMock: vi.fn(),
    listAllAuthUsersMock: vi.fn(),
    getAdminSupabaseMock: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAdminAuthMock }));
vi.mock("@/lib/firebase/admin-sdk", () => ({ listAllAuthUsers: listAllAuthUsersMock }));
vi.mock("@/lib/admin/admin-queries", () => ({
  isAdminEmail: isAdminEmailMock,
  getCompanyDetail: getCompanyDetailMock,
  getCompanyUsageTimeline: getCompanyUsageTimelineMock,
}));
vi.mock("@/lib/supabase/admin-client", () => ({ getAdminSupabase: getAdminSupabaseMock }));

import { GET } from "@/app/api/admin/company/[id]/route";

let queries: RecordedQuery[];
let tableRows: Record<string, unknown[]>;
let erroringTables: Record<string, DatabaseError>;

function makeBuilder(table: string) {
  const query: RecordedQuery = { table, filters: [] };
  queries.push(query);

  const builder = {
    select(columns?: string) {
      query.columns = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      query.filters.push({ op: "eq", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      query.filters.push({ op: "is", column, value });
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    then<TResult1 = DatabaseResult, TResult2 = never>(
      onFulfilled?: ((value: DatabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      const error = erroringTables[table];
      const result: DatabaseResult = error
        ? { data: null, error }
        : { data: tableRows[table] ?? [], error: null };
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

const request = () => ({}) as unknown as Parameters<typeof GET>[0];
const params = { params: Promise.resolve({ id: "co-1" }) };

const queryFor = (table: string) => queries.find((q) => q.table === table);
const hasFilter = (query: RecordedQuery | undefined, op: string, column: string, value?: unknown) =>
  !!query?.filters.some(
    (f) => f.op === op && f.column === column && (value === undefined || f.value === value)
  );

beforeEach(() => {
  queries = [];
  erroringTables = {};
  tableRows = {
    opportunities: [
      { id: "o1", stage: "quoting", estimated_value: 4200, created_at: "2026-08-01T00:00:00Z" },
    ],
    estimates: [{ id: "e1", status: "approved", total: 900, created_at: "2026-08-01T00:00:00Z" }],
    invoices: [{ id: "i1", status: "paid", total: 750, created_at: "2026-08-01T00:00:00Z" }],
    payments: [{ id: "p1", amount: 750, created_at: "2026-08-02T00:00:00Z" }],
  };

  verifyAdminAuthMock.mockResolvedValue({ uid: "fb-1", email: "admin@ops.com" });
  isAdminEmailMock.mockResolvedValue(true);
  getCompanyDetailMock.mockResolvedValue({
    company: { id: "co-1", name: "Canpro" },
    users: [{ id: "u1", email: "crew@canpro.com" }],
    projects: [],
    taskCount: 3,
    clientCount: 2,
    pipelineCount: 1,
    estimateCount: 1,
    invoiceCount: 1,
  });
  getCompanyUsageTimelineMock.mockResolvedValue({ projects: [], tasks: [], clients: [] });
  listAllAuthUsersMock.mockResolvedValue([]);
  getAdminSupabaseMock.mockReset();
  getAdminSupabaseMock.mockImplementation(() => ({ from: (table: string) => makeBuilder(table) }));
});

afterEach(() => vi.clearAllMocks());

describe("GET /api/admin/company/[id] — live schema reads", () => {
  it("reads opportunities with the product base filters and projects estimated_value as value", async () => {
    const res = await GET(request(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(queries.map((q) => q.table)).not.toContain("pipeline_references");

    const opportunities = queryFor("opportunities");
    expect(opportunities).toBeDefined();
    expect(opportunities?.columns).toContain("estimated_value");
    expect(hasFilter(opportunities, "eq", "company_id", "co-1")).toBe(true);
    expect(hasFilter(opportunities, "is", "deleted_at", null)).toBe(true);
    expect(hasFilter(opportunities, "is", "archived_at", null)).toBe(true);

    expect(body.pipeline).toEqual([
      { id: "o1", stage: "quoting", value: 4200, created_at: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("selects estimates/invoices totals and filters payments by voided_at", async () => {
    const res = await GET(request(), params);
    const body = await res.json();

    const estimates = queryFor("estimates");
    const invoices = queryFor("invoices");
    const payments = queryFor("payments");

    expect(estimates?.columns).toContain("total");
    expect(estimates?.columns).not.toContain("total_amount");
    expect(invoices?.columns).toContain("total");
    expect(invoices?.columns).not.toContain("total_amount");

    expect(hasFilter(payments, "is", "voided_at", null)).toBe(true);
    expect(hasFilter(payments, "is", "deleted_at")).toBe(false);

    expect(body.estimates[0].total).toBe(900);
    expect(body.invoices[0].total).toBe(750);
    expect(body.recentPayments[0].amount).toBe(750);
  });

  it("answers 500 with the failure message instead of serving empty arrays", async () => {
    erroringTables.invoices = {
      code: "42703",
      message: "column invoices.total_amount does not exist",
    };

    const res = await GET(request(), params);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("invoices");
    expect(body.pipeline).toBeUndefined();
  });

  it("answers 500 when the opportunities read fails", async () => {
    erroringTables.opportunities = { code: "PGRST205", message: "relation does not exist" };

    const res = await GET(request(), params);

    expect(res.status).toBe(500);
  });
});
