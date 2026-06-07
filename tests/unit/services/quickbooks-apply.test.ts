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

// Live tables the apply engine upserts on (company_id, qb_id). Prod has NO
// unique index on that pair yet, so PostgREST .upsert({onConflict:"company_id,
// qb_id"}) would 42P10 without one — the double throws if the conflict key is
// absent so the tests would have caught C1.
const QB_CONFLICT_TABLES = new Set(["clients", "estimates", "invoices", "payments", "sub_clients"]);
// NOT NULL columns with no DB default — sending null throws (would have caught C3).
const NOT_NULL_COLUMNS: Record<string, string[]> = {
  invoices: ["due_date", "invoice_number"],
  estimates: ["estimate_number"],
};

/**
 * In-memory Supabase double. Tables are arrays of rows. Supports the exact
 * builder calls applyImport uses: from().select().eq()....maybeSingle(),
 * from().upsert(rows,{onConflict}), from().insert(rows), from().delete().eq(),
 * from().update(patch).eq(). The payments insert path recomputes the parent
 * invoice exactly like trg_payment_balance -> update_invoice_balance().
 */
function makeSupabase(inject: { failUpsertOn?: string } = {}) {
  const db: Record<string, Row[]> = {
    qbo_import_runs: [{ id: RUN_ID, company_id: TEMP_COMPANY_ID, status: "staged", qb_write_calls: 0, totals: {} }],
    qbo_staging_customers: structuredClone(stagedCustomers),
    qbo_staging_estimates: structuredClone(stagedEstimates),
    qbo_staging_invoices: structuredClone(stagedInvoices),
    qbo_staging_line_items: structuredClone(stagedLineItems),
    qbo_staging_payments: structuredClone(stagedPayments),
    qbo_customer_matches: structuredClone(customerMatches),
    clients: [],
    sub_clients: [],
    estimates: [],
    invoices: [],
    line_items: [],
    payments: [],
    notifications: [],
    accounting_sync_suppressions: [],
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
        // Simulate a DB write rejection (e.g. 42P10) surfaced by supabase-js as
        // { error } rather than a throw — to verify applyImport fails loudly.
        if (inject.failUpsertOn === table) {
          return { data: null, error: { message: `injected write failure on ${table}`, code: "42P10" } };
        }
        const list = Array.isArray(payload) ? payload : [payload];
        // C1: live tables upserted on (company_id, qb_id) REQUIRE that exact
        // conflict target — without a matching unique index PostgREST 42P10s.
        if (QB_CONFLICT_TABLES.has(table) && opts?.onConflict !== "company_id,qb_id") {
          throw new Error(
            `42P10: ${table}.upsert requires onConflict "company_id,qb_id" (got "${opts?.onConflict ?? "<none>"}")`
          );
        }
        const keys = (opts?.onConflict ?? "id").split(",");
        for (const incoming of list) {
          // C3: enforce NOT NULL columns that have no DB default.
          for (const col of NOT_NULL_COLUMNS[table] ?? []) {
            if (incoming[col] === null || incoming[col] === undefined) {
              throw new Error(`null value in column "${col}" of relation "${table}" violates not-null constraint`);
            }
          }
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
        // Chainable eq()/in() that accumulates filters and applies on await
        // (supports company-scoped multi-eq updates, e.g. .eq(id).eq(company)).
        const upFilters: Array<(r: Row) => boolean> = [];
        const apply = () => {
          for (const r of db[table]) if (upFilters.every((f) => f(r))) Object.assign(r, patch);
          return { data: null, error: null };
        };
        const chain: any = {
          eq(col: string, val: any) { upFilters.push((r) => r[col] === val); return chain; },
          in(col: string, vals: any[]) { upFilters.push((r) => vals.includes(r[col])); return chain; },
          then(resolve: any) { return Promise.resolve(apply()).then(resolve); },
        };
        return chain;
      },
    };
    return api;
  }
  return {
    from: (t: string) => builder(t),
    async rpc(name: string, args: Row) {
      if (name !== "suppress_accounting_sync") {
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
      db.accounting_sync_suppressions.push({ id: uid("suppression"), ...args });
      return { data: null, error: null };
    },
    __db: db,
  } as any;
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

    // Locked decision: qb_item_type Inventory/NonInventory → MATERIAL, else OTHER.
    // Staged fixture lines carry NonInventory ("Cedar deck boards") and Service
    // ("Labor"); the resolved values must drive the OPS line `type`.
    const cedar = invLines.find((l: any) => l.name === "Cedar deck boards"); // NonInventory
    const labor = invLines.find((l: any) => l.name === "Labor"); // Service
    expect(cedar.type).toBe("MATERIAL");
    expect(labor.type).toBe("OTHER");

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

    // Applying QB data into OPS must suppress outbound echo writes for every
    // live entity touched by the import window.
    const suppressions = supabase.__db.accounting_sync_suppressions;
    expect(suppressions.length).toBeGreaterThan(0);
    expect(suppressions.every((s: Row) => s.p_provider === "quickbooks")).toBe(true);
    expect(suppressions.every((s: Row) => s.p_ttl_seconds === 600)).toBe(true);
    expect(suppressions.map((s: Row) => s.p_entity_type)).toEqual(
      expect.arrayContaining(["customer", "estimate", "invoice", "payment"])
    );
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

  it("C2: a voided/zero-total (derived_status='skipped') invoice is never written", async () => {
    // Flag the staged invoice as skipped (as normalizeInvoice does for void /
    // zero-total). Its line items + payment line reference it, so nothing
    // dependent should land either.
    supabase.__db.qbo_staging_invoices[0].derived_status = "skipped";
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    const result = await svc.applyImport(RUN_ID, decisions);

    // Customer + estimate still apply; the skipped invoice does not.
    expect(result.clientsCreated).toBe(1);
    expect(result.estimatesUpserted).toBe(1);
    expect(result.invoicesUpserted).toBe(0);
    expect(result.invoicesReconciled).toBe(0);
    expect(supabase.__db.invoices).toHaveLength(0);

    // No invoice-parented line items, and the payment line had nowhere to land.
    const invoiceLines = supabase.__db.line_items.filter((l: any) => l.invoice_id);
    expect(invoiceLines).toHaveLength(0);
    expect(result.paymentsUpserted).toBe(0);
    expect(supabase.__db.payments).toHaveLength(0);
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

  it("aborts the run (status=error) and throws when a live-table write fails — no false success", async () => {
    // Regression for the prod 42P10 bug: a failed upsert must NOT be swallowed
    // and reported as a successful 'applied' run. Inject a write failure on the
    // clients upsert (decisions create QB-CUST-1 → clients.create runs).
    const sb = makeSupabase({ failUpsertOn: "clients" });
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(sb);
    await expect(svc.applyImport(RUN_ID, decisions)).rejects.toThrow(/clients\.create/);
    const run = sb.__db.qbo_import_runs.find((r: Row) => r.id === RUN_ID);
    expect(run.status).toBe("error"); // never 'applied'
    expect(sb.__db.clients.filter((c: Row) => c.qb_id).length).toBe(0);
  });
});

describe("applyImport — company → client + contact → sub_client", () => {
  let supabase: any;
  // Seed a staged QB customer (snake columns as qbo_staging_customers stores them).
  function seedCustomer(over: Row) {
    supabase.__db.qbo_staging_customers.push({
      id: `sc-${over.qb_id}`, run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
      display_name: null, company_name: null, contact_name: null, contact_title: null,
      parent_qb_id: null, is_job: false, email: null, phone: null, address: null,
      active: true, raw: {}, ...over,
    });
  }
  async function apply(decisions: Array<{ customer_qb_id: string; action: string; client_id?: string }>) {
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    return new QuickBooksImportService(supabase).applyImport(RUN_ID, decisions as any);
  }
  beforeEach(() => {
    supabase = makeSupabase();
    // Remove the fixture's QB-CUST-1 staged customer so only seeded rows apply.
    supabase.__db.qbo_staging_customers.length = 0;
  });

  it("creates a parent client (name=CompanyName) and one sub_client contact", async () => {
    seedCustomer({
      qb_id: "42", display_name: "Acme Corp", company_name: "Acme Corp", contact_name: "John Smith",
      email: "john@acme.com", phone: "555", address: "1 Main St, Reno, NV 89501",
    });
    const res = await apply([{ customer_qb_id: "42", action: "create" }]);
    const client = supabase.__db.clients.find((c: Row) => c.qb_id === "42");
    expect(client.name).toBe("Acme Corp");
    expect(client.email).toBeNull();
    expect(client.phone_number).toBeNull();
    expect(client.address).toBe("1 Main St, Reno, NV 89501");
    const sub = supabase.__db.sub_clients.find((s: Row) => s.qb_id === "42");
    expect(sub.client_id).toBe(client.id);
    expect(sub.name).toBe("John Smith");
    expect(sub.email).toBe("john@acme.com");
    expect(sub.phone_number).toBe("555");
    expect(res.subClientsCreated).toBe(1);
  });

  it("creates a sub_client under a LINKED existing client without overwriting it", async () => {
    supabase.__db.clients.push({
      id: "C1", company_id: TEMP_COMPANY_ID, name: "Acme Corp", email: "existing@acme.com",
      phone_number: null, address: null, deleted_at: null, merged_into_client_id: null,
    });
    seedCustomer({
      qb_id: "42", display_name: "Acme Corp", company_name: "Acme Corp", contact_name: "John Smith",
      email: "john@acme.com", phone: "555",
    });
    await apply([{ customer_qb_id: "42", action: "link", client_id: "C1" }]);
    const sub = supabase.__db.sub_clients.find((s: Row) => s.qb_id === "42");
    expect(sub.client_id).toBe("C1");
    const client = supabase.__db.clients.find((c: Row) => c.id === "C1");
    expect(client.name).toBe("Acme Corp");
    expect(client.email).toBe("existing@acme.com"); // link never overwrites
  });

  it("is idempotent — re-apply does not duplicate the sub_client", async () => {
    seedCustomer({ qb_id: "42", display_name: "Acme Corp", company_name: "Acme Corp", contact_name: "John Smith", email: "john@acme.com" });
    await apply([{ customer_qb_id: "42", action: "create" }]);
    await apply([{ customer_qb_id: "42", action: "create" }]);
    expect(supabase.__db.sub_clients.filter((s: Row) => s.qb_id === "42").length).toBe(1);
  });

  it("does NOT create a sub_client for an individual (no CompanyName)", async () => {
    seedCustomer({ qb_id: "9", display_name: "Jane Doe", contact_name: "Jane Doe", email: "jane@doe.com" });
    const res = await apply([{ customer_qb_id: "9", action: "create" }]);
    expect(supabase.__db.sub_clients.some((s: Row) => s.qb_id === "9")).toBe(false);
    const client = supabase.__db.clients.find((c: Row) => c.qb_id === "9");
    expect(client.name).toBe("Jane Doe");
    expect(client.email).toBe("jane@doe.com");
    expect(res.subClientsCreated).toBe(0);
  });

  it("does NOT create a sub_client for a company with no contact person", async () => {
    seedCustomer({ qb_id: "7", display_name: "Globex", company_name: "Globex", email: "info@globex.com" });
    const res = await apply([{ customer_qb_id: "7", action: "create" }]);
    expect(supabase.__db.sub_clients.some((s: Row) => s.qb_id === "7")).toBe(false);
    const client = supabase.__db.clients.find((c: Row) => c.qb_id === "7");
    expect(client.name).toBe("Globex");
    expect(client.email).toBe("info@globex.com");
    expect(res.subClientsCreated).toBe(0);
  });
});
