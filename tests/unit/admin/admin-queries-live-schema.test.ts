/**
 * Bug 2577ac54 — the admin data layer must read the live schema and must never
 * downgrade a Supabase error into a false zero.
 *
 * Every assertion here is anchored to a column/table verified against the live
 * database on 2026-08-28: estimates/invoices carry `total` (not `total_amount`),
 * payments are voided (`voided_at`) rather than soft-deleted, audit_log stamps
 * `changed_at`, promo codes use discount_type/discount_value/current_uses/
 * is_active, and the pipeline lives in `opportunities` — `pipeline_references`,
 * `photos` and `notes` do not exist at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DatabaseError = { code?: string; message: string };

type DatabaseResult = {
  data: unknown;
  error: DatabaseError | null;
  count?: number | null;
};

interface RecordedQuery {
  table: string;
  columns?: string;
  head: boolean;
  filters: { op: string; column: string; value: unknown }[];
  orders: { column: string; ascending?: boolean }[];
  limit?: number;
  single: boolean;
}

const mocks = vi.hoisted(() => ({
  getAdminSupabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: mocks.getAdminSupabase,
}));

let queries: RecordedQuery[];
let respond: (query: RecordedQuery) => DatabaseResult;

/** Rows served per table unless the test overrides `respond`. */
let tableRows: Record<string, unknown[]>;
/** Tables whose queries resolve with an error instead of data. */
let erroringTables: Record<string, DatabaseError>;

function defaultRespond(query: RecordedQuery): DatabaseResult {
  const error = erroringTables[query.table];
  if (error) return { data: null, error, count: null };
  const rows = tableRows[query.table] ?? [];
  if (query.single) {
    return { data: rows[0] ?? null, error: null };
  }
  return { data: rows, error: null, count: rows.length };
}

function makeBuilder(table: string) {
  const query: RecordedQuery = {
    table,
    head: false,
    filters: [],
    orders: [],
    single: false,
  };
  queries.push(query);

  const builder = {
    select(columns?: string, options?: { count?: string; head?: boolean }) {
      query.columns = columns;
      if (options?.head) query.head = true;
      return builder;
    },
    eq(column: string, value: unknown) {
      query.filters.push({ op: "eq", column, value });
      return builder;
    },
    neq(column: string, value: unknown) {
      query.filters.push({ op: "neq", column, value });
      return builder;
    },
    in(column: string, value: unknown) {
      query.filters.push({ op: "in", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      query.filters.push({ op: "is", column, value });
      return builder;
    },
    not(column: string, op: string, value: unknown) {
      query.filters.push({ op: `not.${op}`, column, value });
      return builder;
    },
    gte(column: string, value: unknown) {
      query.filters.push({ op: "gte", column, value });
      return builder;
    },
    lte(column: string, value: unknown) {
      query.filters.push({ op: "lte", column, value });
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) {
      query.orders.push({ column, ascending: options?.ascending });
      return builder;
    },
    limit(value: number) {
      query.limit = value;
      return builder;
    },
    single() {
      query.single = true;
      return builder;
    },
    then<TResult1 = DatabaseResult, TResult2 = never>(
      onFulfilled?:
        | ((value: DatabaseResult) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(respond(query)).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

function makeClient() {
  return {
    from: (table: string) => makeBuilder(table),
  };
}

const queriesFor = (table: string) => queries.filter((q) => q.table === table);
const tablesQueried = () => queries.map((q) => q.table);

const hasFilter = (query: RecordedQuery, op: string, column: string, value?: unknown) =>
  query.filters.some(
    (f) =>
      f.op === op &&
      f.column === column &&
      (value === undefined || f.value === value)
  );

const isoNow = new Date().toISOString();

beforeEach(() => {
  queries = [];
  tableRows = {};
  erroringTables = {};
  respond = defaultRespond;
  mocks.getAdminSupabase.mockReset();
  mocks.getAdminSupabase.mockImplementation(() => makeClient());
});

describe("getFinancialStats — live money columns", () => {
  beforeEach(() => {
    tableRows.estimates = [
      { id: "e1", status: "approved", total: 100, created_at: isoNow },
      { id: "e2", status: "converted", total: 200, created_at: isoNow },
      { id: "e3", status: "declined", total: 50, created_at: isoNow },
      { id: "e4", status: "sent", total: 50, created_at: isoNow },
    ];
    tableRows.invoices = [
      { id: "i1", status: "paid", total: 500, balance_due: 0, due_date: isoNow, created_at: isoNow },
      { id: "i2", status: "void", total: 400, balance_due: 400, due_date: isoNow, created_at: isoNow },
      { id: "i3", status: "partially_paid", total: 300, balance_due: 120, due_date: isoNow, created_at: isoNow },
      { id: "i4", status: "awaiting_payment", total: 200, balance_due: null, due_date: isoNow, created_at: isoNow },
    ];
    tableRows.payments = [{ id: "p1", amount: 75, created_at: isoNow }];
  });

  it("selects total (never total_amount) and filters payments by voided_at", async () => {
    const { getFinancialStats } = await import("@/lib/admin/admin-queries");
    await getFinancialStats();

    const estimates = queriesFor("estimates")[0];
    const invoices = queriesFor("invoices")[0];
    const payments = queriesFor("payments")[0];

    expect(estimates.columns).toContain("total");
    expect(estimates.columns).not.toContain("total_amount");
    expect(invoices.columns).not.toContain("total_amount");
    expect(invoices.columns).toContain("balance_due");

    expect(hasFilter(payments, "is", "voided_at", null)).toBe(true);
    expect(hasFilter(payments, "is", "deleted_at")).toBe(false);
  });

  it("computes outstanding from balance_due ?? total and counts converted as approved", async () => {
    const { getFinancialStats } = await import("@/lib/admin/admin-queries");
    const stats = await getFinancialStats();

    expect(stats.estimateTotal).toBe(400);
    // approved + converted = 2 of 4
    expect(stats.estimateApprovalRate).toBe(50);
    // open = partially_paid (balance 120) + awaiting_payment (no balance -> total 200)
    expect(stats.outstandingInvoices).toBe(320);
    expect(stats.paymentsThisMonth).toBe(75);
  });

  it("throws when any of the three reads carries an error", async () => {
    const { getFinancialStats } = await import("@/lib/admin/admin-queries");
    erroringTables.invoices = { code: "42703", message: "column invoices.total_amount does not exist" };

    await expect(getFinancialStats()).rejects.toThrow(/invoices/i);
  });
});

describe("getPortalStats — derived from real integration tables", () => {
  beforeEach(() => {
    tableRows.companies = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    tableRows.portal_branding = [{ company_id: "c1" }, { company_id: "c2" }, { company_id: "c2" }];
    tableRows.portal_tokens = [{ company_id: "c1" }];
    tableRows.email_connections = [{ company_id: "c3" }];
    tableRows.accounting_connections = [{ company_id: "c2" }];
  });

  it("reads portal_branding, portal_tokens, email_connections and accounting_connections", async () => {
    const { getPortalStats } = await import("@/lib/admin/admin-queries");
    const stats = await getPortalStats();

    expect(tablesQueried()).toEqual(
      expect.arrayContaining([
        "portal_branding",
        "portal_tokens",
        "email_connections",
        "accounting_connections",
      ])
    );
    // The four company flags do not exist on companies.
    for (const q of queriesFor("companies")) {
      expect(q.columns ?? "").not.toContain("portal_enabled");
      expect(q.columns ?? "").not.toContain("portal_branding_configured");
      expect(q.columns ?? "").not.toContain("gmail_connected");
      expect(q.columns ?? "").not.toContain("accounting_connected");
    }

    expect(hasFilter(queriesFor("portal_tokens")[0], "not.is", "is_preview", true)).toBe(true);
    expect(hasFilter(queriesFor("email_connections")[0], "eq", "status", "active")).toBe(true);
    expect(hasFilter(queriesFor("accounting_connections")[0], "eq", "is_connected", true)).toBe(true);

    expect(stats).toEqual({
      portalInUse: 1,
      brandingConfigured: 2,
      emailConnected: 1,
      accountingConnected: 1,
      total: 3,
    });
  });

  it("throws when an integration read carries an error", async () => {
    const { getPortalStats } = await import("@/lib/admin/admin-queries");
    erroringTables.email_connections = { code: "PGRST205", message: "relation does not exist" };

    await expect(getPortalStats()).rejects.toThrow(/email connections/i);
  });
});

describe("getPromoCodes — live promo columns", () => {
  it("selects discount_type/discount_value/current_uses/max_uses/is_active", async () => {
    const { getPromoCodes } = await import("@/lib/admin/admin-queries");
    await getPromoCodes();

    const columns = queriesFor("promo_codes")[0].columns ?? "";
    for (const column of [
      "id",
      "code",
      "discount_type",
      "discount_value",
      "current_uses",
      "max_uses",
      "is_active",
      "created_at",
    ]) {
      expect(columns).toContain(column);
    }
    expect(columns).not.toContain("discount_percent");
    expect(columns).not.toContain("discount_amount");
    expect(columns).not.toContain("usage_count");
  });

  it("throws on error", async () => {
    const { getPromoCodes } = await import("@/lib/admin/admin-queries");
    erroringTables.promo_codes = { code: "42703", message: "column promo_codes.active does not exist" };

    await expect(getPromoCodes()).rejects.toThrow(/promo codes/i);
  });
});

describe("getAuditLog — changed_at is the live timestamp", () => {
  it("selects and orders by changed_at", async () => {
    const { getAuditLog } = await import("@/lib/admin/admin-queries");
    await getAuditLog(10);

    const query = queriesFor("audit_log")[0];
    expect(query.columns).toContain("changed_at");
    expect(query.columns).not.toContain("created_at");
    expect(query.orders[0]).toMatchObject({ column: "changed_at", ascending: false });
    expect(query.limit).toBe(10);
  });

  it("throws on error", async () => {
    const { getAuditLog } = await import("@/lib/admin/admin-queries");
    erroringTables.audit_log = { code: "42703", message: "column audit_log.created_at does not exist" };

    await expect(getAuditLog()).rejects.toThrow(/audit log/i);
  });
});

describe("getPipelineStats — opportunities replace the retired pipeline_references table", () => {
  beforeEach(() => {
    tableRows.opportunities = [
      { id: "o1", stage: "new_lead", estimated_value: 1000, stage_entered_at: isoNow, created_at: isoNow, updated_at: isoNow },
      { id: "o2", stage: "quoting", estimated_value: 2000, stage_entered_at: isoNow, created_at: isoNow, updated_at: isoNow },
      { id: "o3", stage: "won", estimated_value: 3000, stage_entered_at: isoNow, created_at: isoNow, updated_at: isoNow },
      { id: "o4", stage: "lost", estimated_value: 500, stage_entered_at: isoNow, created_at: isoNow, updated_at: isoNow },
      { id: "o5", stage: "discarded", estimated_value: 999, stage_entered_at: isoNow, created_at: isoNow, updated_at: isoNow },
    ];
  });

  it("applies the product base filters and excludes terminal stages from live pipeline math", async () => {
    const { getPipelineStats } = await import("@/lib/admin/admin-queries");
    const stats = await getPipelineStats();

    expect(tablesQueried()).toContain("opportunities");
    expect(tablesQueried()).not.toContain("pipeline_references");

    const query = queriesFor("opportunities")[0];
    expect(hasFilter(query, "is", "deleted_at", null)).toBe(true);
    expect(hasFilter(query, "is", "archived_at", null)).toBe(true);
    expect(query.columns).toContain("estimated_value");

    expect(stats.activeDeals).toBe(2);
    expect(stats.pipelineValue).toBe(3000);
    expect(stats.wonThisMonth).toBe(1);
    // won / (won + lost) — discarded never counts as a loss
    expect(stats.winRate).toBe(50);
    expect(stats.stageDistribution.map((s) => s.stage).sort()).toEqual([
      "lost",
      "new_lead",
      "quoting",
      "won",
    ]);
    expect(stats.stageDistribution.find((s) => s.stage === "won")?.totalValue).toBe(3000);
  });

  it("throws on error", async () => {
    const { getPipelineStats } = await import("@/lib/admin/admin-queries");
    erroringTables.opportunities = { code: "PGRST205", message: "relation pipeline_references does not exist" };

    await expect(getPipelineStats()).rejects.toThrow(/pipeline/i);
  });
});

describe("getFeatureAdoption — live tables only", () => {
  beforeEach(() => {
    tableRows.companies = [{ id: "c1" }];
  });

  it("counts opportunities, project_photos and project_notes and voids payments", async () => {
    const { getFeatureAdoption } = await import("@/lib/admin/admin-queries");
    await getFeatureAdoption();

    const tables = tablesQueried();
    expect(tables).toEqual(
      expect.arrayContaining(["opportunities", "project_photos", "project_notes"])
    );
    expect(tables).not.toContain("pipeline_references");
    expect(tables).not.toContain("photos");
    expect(tables).not.toContain("notes");

    for (const query of queriesFor("payments")) {
      expect(hasFilter(query, "is", "voided_at", null)).toBe(true);
      expect(hasFilter(query, "is", "deleted_at")).toBe(false);
    }
  });

  it("propagates a query error instead of recording a zero row", async () => {
    const { getFeatureAdoption } = await import("@/lib/admin/admin-queries");
    erroringTables.project_photos = { code: "PGRST205", message: "relation photos does not exist" };

    await expect(getFeatureAdoption()).rejects.toThrow(/project_photos/i);
  });
});

describe("company + table inventory read opportunities", () => {
  it("getCompanyList counts pipeline from opportunities", async () => {
    tableRows.companies = [{ id: "c1", name: "Canpro", created_at: isoNow }];
    tableRows.opportunities = [{ company_id: "c1" }, { company_id: "c1" }];

    const { getCompanyList } = await import("@/lib/admin/admin-queries");
    const list = await getCompanyList();

    expect(tablesQueried()).toContain("opportunities");
    expect(tablesQueried()).not.toContain("pipeline_references");
    expect(hasFilter(queriesFor("opportunities")[0], "is", "archived_at", null)).toBe(true);
    expect(list[0].pipelineCount).toBe(2);
  });

  it("getCompanyDetail counts pipeline from opportunities", async () => {
    tableRows.companies = [{ id: "c1", name: "Canpro" }];

    const { getCompanyDetail } = await import("@/lib/admin/admin-queries");
    await getCompanyDetail("c1");

    expect(tablesQueried()).toContain("opportunities");
    expect(tablesQueried()).not.toContain("pipeline_references");
    const query = queriesFor("opportunities")[0];
    expect(hasFilter(query, "eq", "company_id", "c1")).toBe(true);
    expect(hasFilter(query, "is", "archived_at", null)).toBe(true);
  });

  it("getTableStats inventories the live tables", async () => {
    const { getTableStats } = await import("@/lib/admin/admin-queries");
    await getTableStats();

    const tables = tablesQueried();
    expect(tables).toEqual(
      expect.arrayContaining(["opportunities", "project_photos", "project_notes"])
    );
    expect(tables).not.toContain("pipeline_references");
    expect(tables).not.toContain("photos");
    expect(tables).not.toContain("notes");
  });
});

describe("every admin read surfaces its error", () => {
  it("getTotalCompanies throws instead of returning 0", async () => {
    const { getTotalCompanies } = await import("@/lib/admin/admin-queries");
    erroringTables.companies = { code: "42501", message: "permission denied" };

    await expect(getTotalCompanies()).rejects.toThrow(/companies/i);
  });

  it("getRecentSignups throws instead of returning []", async () => {
    const { getRecentSignups } = await import("@/lib/admin/admin-queries");
    erroringTables.companies = { code: "42501", message: "permission denied" };

    await expect(getRecentSignups()).rejects.toThrow(/signups/i);
  });

  it("getDataQualityChecks throws instead of reporting all checks passed", async () => {
    const { getDataQualityChecks } = await import("@/lib/admin/admin-queries");
    erroringTables.users = { code: "42703", message: "column users.company_id does not exist" };

    await expect(getDataQualityChecks()).rejects.toThrow(/users/i);
  });

  it("getAlerts throws instead of reporting an all-clear", async () => {
    const { getAlerts } = await import("@/lib/admin/admin-queries");
    erroringTables.feature_requests = { code: "PGRST205", message: "relation does not exist" };

    await expect(getAlerts()).rejects.toThrow(/feature requests/i);
  });
});
