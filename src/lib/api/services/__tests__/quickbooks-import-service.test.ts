import { describe, it, expect, vi, beforeEach } from "vitest";
import customers from "../../../../../tests/fixtures/qbo/customer.json";
import invoices from "../../../../../tests/fixtures/qbo/invoice.json";
import estimates from "../../../../../tests/fixtures/qbo/estimate.json";
import payments from "../../../../../tests/fixtures/qbo/payment.json";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";

// ── Mock the pull service (A1) so no network happens ───────────────────────
const pullInstance = {
  pullCustomers: vi.fn().mockResolvedValue(customers),
  pullInvoices: vi.fn().mockResolvedValue(invoices),
  pullEstimates: vi.fn().mockResolvedValue(estimates),
  pullPayments: vi.fn().mockResolvedValue(payments),
  pullItems: vi.fn().mockResolvedValue([]),
  qbWriteCalls: 0,
};
vi.mock("../quickbooks-pull-service", () => ({
  QuickBooksPullService: vi.fn().mockImplementation(() => pullInstance),
}));

vi.mock("../accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: vi.fn().mockResolvedValue({ accessToken: "tok", realmId: "realm-1" }),
  },
}));

// ── In-memory Supabase fake ────────────────────────────────────────────────
type Row = Record<string, unknown>;
function makeSupabase() {
  const tables: Record<string, Row[]> = {
    accounting_connections: [
      { id: "conn-1", company_id: COMPANY_ID, provider: "quickbooks", realm_id: "realm-1", is_connected: true },
    ],
    qbo_import_runs: [],
    qbo_staging_customers: [],
    qbo_staging_invoices: [],
    qbo_staging_estimates: [],
    qbo_staging_line_items: [],
    qbo_staging_payments: [],
    qbo_customer_matches: [],
    clients: [
      { id: "client-cool", company_id: COMPANY_ID, name: "Cool Cars", email: "cool_cars@intuit.com",
        phone_number: null, deleted_at: null, merged_into_client_id: null },
    ],
  };

  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filters: Array<(r: Row) => boolean> = [];
    const api: Record<string, unknown> = {
      insert: (payload: Row | Row[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        for (const it of items) {
          tables[table].push({ id: it.id ?? `${table}-${tables[table].length + 1}`, ...it });
        }
        const inserted = items.map((it, i) => tables[table][tables[table].length - items.length + i]);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted[0], error: null }),
          }),
          then: (res: (v: { data: null; error: null }) => void) => res({ data: null, error: null }),
        };
      },
      upsert: (payload: Row | Row[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        tables[table].push(...items);
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: Row) => ({
        eq: (col: string, val: unknown) => {
          for (const r of tables[table]) if (r[col] === val) Object.assign(r, patch);
          return Promise.resolve({ data: null, error: null });
        },
      }),
      select: () => api,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return api; },
      single: () => {
        const r = rows.filter((row) => filters.every((f) => f(row)))[0] ?? null;
        return Promise.resolve({ data: r, error: r ? null : { message: "not found" } });
      },
      maybeSingle: () => {
        const r = rows.filter((row) => filters.every((f) => f(row)))[0] ?? null;
        return Promise.resolve({ data: r, error: null });
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows.filter((row) => filters.every((f) => f(row))), error: null }),
    };
    return api;
  }

  function rpc(_fn: string, _args: Row) {
    // No fuzzy candidates by default in this fixture set.
    return Promise.resolve({ data: [], error: null });
  }

  return { from, rpc, _tables: tables } as unknown as import("@supabase/supabase-js").SupabaseClient & { _tables: Record<string, Row[]> };
}

import { QuickBooksImportService } from "../quickbooks-import-service";

let supabase: ReturnType<typeof makeSupabase>;
let svc: QuickBooksImportService;

beforeEach(() => {
  vi.clearAllMocks();
  pullInstance.qbWriteCalls = 0;
  supabase = makeSupabase();
  svc = new QuickBooksImportService(supabase);
});

describe("QuickBooksImportService.startImportRun", () => {
  it("creates a pending run scoped to the company", async () => {
    const run = await svc.startImportRun(COMPANY_ID);
    expect(run.status).toBe("pending");
    expect(supabase._tables.qbo_import_runs).toHaveLength(1);
    expect(supabase._tables.qbo_import_runs[0].company_id).toBe(COMPANY_ID);
  });
});

describe("QuickBooksImportService.pullAndStage", () => {
  it("stages customers/invoices/estimates/lines/payments and keeps qb_write_calls at 0", async () => {
    const run = await svc.startImportRun(COMPANY_ID);
    await svc.pullAndStage(run.id);

    const t = supabase._tables;
    expect(t.qbo_staging_customers.length).toBe(2);
    expect(t.qbo_staging_invoices.length).toBe(2); // includes the zero-total (flagged) row
    expect(t.qbo_staging_estimates.length).toBe(1);
    // invoice 130 → 2 sales lines; estimate 98 → 1 flattened line; zero-total invoice → 0 lines
    expect(t.qbo_staging_line_items.length).toBe(3);
    // payment 200 → 1 staged row (one row per payment; applied_lines holds the split)
    expect(t.qbo_staging_payments.length).toBe(1);
    const finished = t.qbo_import_runs[0];
    expect(finished.status).toBe("staged");
    expect(finished.qb_write_calls).toBe(0);
  });
});

describe("QuickBooksImportService.pullAndStage item-type resolution", () => {
  it("resolves ItemRef.value → QB Item.Type so staged lines carry real qb_item_type", async () => {
    // Realistic Item catalog: invoice 130 lines reference ItemRef 5 (Inventory)
    // and 11 (Service); estimate 98's nested line references ItemRef 19
    // (NonInventory). These flow through pullItems → buildItemTypeMap → staging.
    pullInstance.pullItems.mockResolvedValueOnce([
      { Id: "5", Type: "Inventory", Name: "Rock Fountain" },
      { Id: "11", Type: "Service", Name: "Pump" },
      { Id: "19", Type: "NonInventory", Name: "Installation" },
    ]);

    const run = await svc.startImportRun(COMPANY_ID);
    await svc.pullAndStage(run.id);

    const staged = supabase._tables.qbo_staging_line_items;
    // Resolution is NOT hand-set on the staged row — it comes from the catalog.
    const rockFountain = staged.find((l) => l.name === "Rock Fountain");
    const pump = staged.find((l) => l.name === "Pump Hours"); // Description, not ItemRef.name
    const install = staged.find((l) => l.name === "Garden Install");
    expect(rockFountain?.qb_item_type).toBe("Inventory"); // → MATERIAL at apply
    expect(pump?.qb_item_type).toBe("Service"); // → OTHER at apply
    expect(install?.qb_item_type).toBe("NonInventory"); // → MATERIAL at apply
  });

  it("leaves qb_item_type null (→ OTHER) when the Item catalog is empty", async () => {
    pullInstance.pullItems.mockResolvedValueOnce([]);
    const run = await svc.startImportRun(COMPANY_ID);
    await svc.pullAndStage(run.id);
    const staged = supabase._tables.qbo_staging_line_items;
    expect(staged.length).toBeGreaterThan(0);
    expect(staged.every((l) => l.qb_item_type === null)).toBe(true);
  });
});

describe("QuickBooksImportService.computeCustomerMatches", () => {
  it("writes one match row per staged customer (email link for Cool Cars)", async () => {
    const run = await svc.startImportRun(COMPANY_ID);
    await svc.pullAndStage(run.id);
    await svc.computeCustomerMatches(run.id);

    const matches = supabase._tables.qbo_customer_matches;
    expect(matches.length).toBe(2);
    const cool = matches.find((m) => m.customer_qb_id === "58");
    expect(cool?.proposed_action).toBe("link");
    expect(cool?.match_basis).toBe("email");
    expect(cool?.matched_client_id).toBe("client-cool");
    const diego = matches.find((m) => m.customer_qb_id === "12");
    expect(diego?.proposed_action).toBe("create");
  });
});

describe("QuickBooksImportService.getImportReview", () => {
  it("returns the aggregate with reconciliation + counts", async () => {
    const run = await svc.startImportRun(COMPANY_ID);
    await svc.pullAndStage(run.id);
    await svc.computeCustomerMatches(run.id);

    const review = await svc.getImportReview(run.id);
    expect(review.run.id).toBe(run.id);
    expect(review.matches.length).toBe(2);
    expect(review.matchCounts.link).toBe(1);
    expect(review.matchCounts.create).toBe(1);
    expect(review.stagedCounts.invoices).toBe(2);
    expect(review.stagedCounts.skippedInvoices).toBe(1);
    expect(review.reconciliation.qbOpenAr).toBe(362.07);
    expect(review.reconciliation.openInvoiceCount).toBe(1);
    expect(review.reconciliation.collectedInWindow).toBe(362.07);
    expect(review.reconciliation.arMatched).toBe(true);
  });
});
