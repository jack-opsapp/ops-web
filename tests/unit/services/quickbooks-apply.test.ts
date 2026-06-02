// tests/unit/services/quickbooks-apply.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TEMP_COMPANY_ID, RUN_ID,
  stagedCustomers, stagedEstimates, stagedInvoices,
  stagedLineItems, stagedPayments, customerMatches, decisions,
} from "../../fixtures/qbo/apply-run.fixture";

// Token service is never allowed to be hit for a GET-only/no-network apply,
// but the service imports it; stub to a fixed token.
vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: vi.fn(async () => ({ accessToken: "stub", realmId: "realm-1" })),
  },
}));

type Row = Record<string, any>;
function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * In-memory Supabase double. Tables are arrays of rows. Supports the exact
 * builder calls applyImport uses: from().select().eq()....maybeSingle(),
 * from().upsert(rows,{onConflict}), from().insert(rows), from().delete().eq(),
 * from().update(patch).eq(). The payments insert path recomputes the parent
 * invoice exactly like trg_payment_balance -> update_invoice_balance().
 */
function makeSupabase() {
  const db: Record<string, Row[]> = {
    qbo_import_runs: [{ id: RUN_ID, company_id: TEMP_COMPANY_ID, status: "staged", qb_write_calls: 0, totals: {} }],
    qbo_staging_customers: structuredClone(stagedCustomers),
    qbo_staging_estimates: structuredClone(stagedEstimates),
    qbo_staging_invoices: structuredClone(stagedInvoices),
    qbo_staging_line_items: structuredClone(stagedLineItems),
    qbo_staging_payments: structuredClone(stagedPayments),
    qbo_customer_matches: structuredClone(customerMatches),
    clients: [],
    estimates: [],
    invoices: [],
    line_items: [],
    payments: [],
    notifications: [],
  };
  let seq = 0;
  const uid = (p: string) => `${p}-${++seq}`;

  function recomputeInvoiceBalance(invoiceId: string) {
    const inv = db.invoices.find((r) => r.id === invoiceId);
    if (!inv) return;
    const paid = db.payments
      .filter((p) => p.invoice_id === invoiceId && !p.voided_at)
      .reduce((s, p) => s + Number(p.amount), 0);
    inv.amount_paid = round2(paid);
    inv.balance_due = round2(Number(inv.total) - paid);
    if (paid >= Number(inv.total)) { inv.status = "paid"; inv.paid_at = new Date().toISOString(); }
    else if (paid > 0) { inv.status = "partially_paid"; }
  }

  function builder(table: string) {
    let rows = db[table];
    const filters: Array<(r: Row) => boolean> = [];
    const api: any = {
      select() { return api; },
      eq(col: string, val: any) { filters.push((r) => r[col] === val); return api; },
      in(col: string, vals: any[]) { filters.push((r) => vals.includes(r[col])); return api; },
      order() { return api; },
      _match() { return rows.filter((r) => filters.every((f) => f(r))); },
      async maybeSingle() { return { data: api._match()[0] ?? null, error: null }; },
      async single() { const m = api._match(); return { data: m[0] ?? null, error: m.length ? null : { message: "no rows" } }; },
      then(resolve: any) { return Promise.resolve({ data: api._match(), error: null }).then(resolve); },
      async upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
        const list = Array.isArray(payload) ? payload : [payload];
        const keys = (opts?.onConflict ?? "id").split(",");
        for (const incoming of list) {
          const existing = db[table].find((r) => keys.every((k) => r[k] === incoming[k]));
          if (existing) {
            // Real upsert keys on the conflict target; the row keeps its
            // primary key identity — never clobber `id` with a fresh value.
            const { id: _ignoredId, ...rest } = incoming;
            Object.assign(existing, rest);
          } else {
            db[table].push({ id: incoming.id ?? uid(table), ...incoming });
          }
        }
        return { data: list, error: null };
      },
      async insert(payload: Row | Row[]) {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const incoming of list) {
          if (table === "line_items" && "line_total" in incoming) {
            throw new Error("line_total is GENERATED — must not be inserted");
          }
          const row: Row = { id: incoming.id ?? uid(table), ...incoming };
          if (table === "line_items") {
            row.line_total = round2(
              Number(row.quantity) * Number(row.unit_price) *
              (1 - (Number(row.discount_percent ?? 0)) / 100)
            );
          }
          db[table].push(row);
          if (table === "payments" && row.invoice_id) recomputeInvoiceBalance(row.invoice_id);
        }
        return { data: list, error: null };
      },
      delete() {
        return {
          eq(col: string, val: any) {
            db[table] = db[table].filter((r) => r[col] !== val);
            return Promise.resolve({ data: null, error: null });
          },
          in(col: string, vals: any[]) {
            db[table] = db[table].filter((r) => !vals.includes(r[col]));
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      update(patch: Row) {
        return {
          eq(col: string, val: any) {
            for (const r of db[table]) if (r[col] === val) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
          in(col: string, vals: any[]) {
            for (const r of db[table]) if (vals.includes(r[col])) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return api;
  }
  return { from: (t: string) => builder(t), __db: db } as any;
}

describe("QuickBooksImportService.applyImport", () => {
  let supabase: any;
  beforeEach(() => { supabase = makeSupabase(); });

  it("applies a staged run: creates client, headers, line items, payments, reconciles to QB Balance", async () => {
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    const result = await svc.applyImport(RUN_ID, decisions);

    // Client created
    expect(result.clientsCreated).toBe(1);
    const client = supabase.__db.clients[0];
    expect(client.qb_id).toBe("QB-CUST-1");
    expect(client.name).toBe("Acme Decks");

    // Estimate + invoice headers (QB-authoritative totals)
    expect(result.estimatesUpserted).toBe(1);
    expect(result.invoicesUpserted).toBe(1);
    const est = supabase.__db.estimates[0];
    const inv = supabase.__db.invoices[0];
    expect(est.subtotal).toBe(335.25);
    expect(inv.total).toBe(362.07);
    expect(inv.client_id).toBe(client.id);
    expect(inv.estimate_id).toBe(est.id); // estimate→invoice linkage

    // Line items: 2 inserted, NONE carried line_total in, Σ line_total == subtotal
    expect(result.lineItemsInserted).toBe(2);
    const invLines = supabase.__db.line_items.filter((l: any) => l.invoice_id === inv.id);
    expect(invLines).toHaveLength(2);
    const sumLineTotal = round2(invLines.reduce((s: number, l: any) => s + Number(l.line_total), 0));
    expect(sumLineTotal).toBe(Number(inv.subtotal)); // 335.25

    // Payment applied + trigger recomputed amount_paid to 200
    expect(result.paymentsUpserted).toBe(1);
    expect(supabase.__db.payments[0].amount).toBe(200);

    // RECONCILE ran AFTER payments: balance_due == QB Balance to the cent
    expect(result.invoicesReconciled).toBe(1);
    expect(inv.balance_due).toBe(162.07);          // == staged QB Balance
    expect(round2(Number(inv.amount_paid) + Number(inv.balance_due))).toBe(362.07);
    expect(inv.status).toBe("partially_paid");

    // Read-only guarantee
    expect(result.qb_write_calls).toBe(0);
  });

  it("is idempotent — second apply produces no duplicate clients/invoices/lines", async () => {
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    await svc.applyImport(RUN_ID, decisions);
    await svc.applyImport(RUN_ID, decisions);
    expect(supabase.__db.clients).toHaveLength(1);
    expect(supabase.__db.invoices).toHaveLength(1);
    expect(supabase.__db.estimates).toHaveLength(1);
    expect(supabase.__db.line_items).toHaveLength(2); // delete-by-parent then reinsert
    expect(supabase.__db.payments).toHaveLength(1);
  });

  it("link decision writes ONLY qb_id onto the existing client", async () => {
    supabase.__db.clients.push({
      id: "existing-1", company_id: TEMP_COMPANY_ID, name: "Acme Decks Ltd",
      email: "billing@acme.test", phone_number: "555-9999", address: "old addr", qb_id: null,
    });
    supabase.__db.qbo_customer_matches[0].proposed_action = "link";
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    await svc.applyImport(RUN_ID, [{ customer_qb_id: "QB-CUST-1", action: "link", client_id: "existing-1" }]);
    const c = supabase.__db.clients.find((r: any) => r.id === "existing-1");
    expect(c.qb_id).toBe("QB-CUST-1");
    expect(c.name).toBe("Acme Decks Ltd");          // never overwritten
    expect(c.email).toBe("billing@acme.test");
    expect(c.phone_number).toBe("555-9999");
    expect(supabase.__db.clients).toHaveLength(1);  // no new client created
  });

  it("skip decision drops the customer and its dependent invoice/lines/payments", async () => {
    supabase.__db.qbo_customer_matches[0].proposed_action = "skip";
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    const result = await svc.applyImport(RUN_ID, [{ customer_qb_id: "QB-CUST-1", action: "skip" }]);
    expect(result.clientsSkipped).toBe(1);
    expect(supabase.__db.clients).toHaveLength(0);
    expect(supabase.__db.invoices).toHaveLength(0);
    expect(supabase.__db.line_items).toHaveLength(0);
    expect(supabase.__db.payments).toHaveLength(0);
  });
});
