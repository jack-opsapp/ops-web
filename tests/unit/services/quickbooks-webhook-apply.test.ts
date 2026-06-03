import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the QB read path: a decrypted token + a single-entity fetch ──────────
const getValidToken = vi.fn();
const fetchEntityById = vi.fn();
const qbWriteCalls = { value: 0 };

vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: (...a: unknown[]) => getValidToken(...a),
  },
}));

vi.mock("@/lib/api/services/quickbooks-pull-service", () => ({
  QuickBooksPullService: class {
    get qbWriteCalls() {
      return qbWriteCalls.value;
    }
    fetchEntityById = (...a: unknown[]) => fetchEntityById(...a);
  },
}));

import { QuickBooksWebhookApplyService } from "@/lib/api/services/quickbooks-webhook-apply-service";

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const CONN = { id: "conn-1", company_id: CO };

// ── In-memory supabase double ─────────────────────────────────────────────────
// Records every upsert/insert/update/delete and answers maybeSingle lookups from
// a small fixture map. Enough to assert webhook-apply field mapping.
interface Captured {
  upserts: Array<{ table: string; row: Record<string, unknown>; onConflict?: string }>;
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
  deletes: Array<{ table: string }>;
}

function makeSupabase(opts: {
  // table -> resolved id for maybeSingle on (company_id, qb_id) lookups
  existingIds?: Record<string, string>;
}) {
  const captured: Captured = { upserts: [], inserts: [], updates: [], deletes: [] };
  const existingIds = opts.existingIds ?? {};
  // After an upsert, subsequent maybeSingle should resolve a fresh id.
  const resolvedAfterUpsert: Record<string, string> = {};

  function client() {
    return {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => {
          const id = existingIds[table] ?? resolvedAfterUpsert[table];
          return { data: id ? { id } : null, error: null };
        };
        builder.upsert = async (row: Record<string, unknown>, cfg?: { onConflict?: string }) => {
          captured.upserts.push({ table, row, onConflict: cfg?.onConflict });
          // Mimic the row now existing so the post-upsert maybeSingle resolves.
          resolvedAfterUpsert[table] = `${table}-id`;
          return { error: null };
        };
        builder.insert = async (row: Record<string, unknown>) => {
          captured.inserts.push({ table, row });
          return { error: null };
        };
        builder.update = (patch: Record<string, unknown>) => {
          captured.updates.push({ table, patch });
          return { eq: () => ({ eq: () => ({ error: null }), error: null }) };
        };
        builder.delete = () => {
          captured.deletes.push({ table });
          return { eq: () => ({ error: null }) };
        };
        return builder;
      },
    };
  }

  return { client: client(), captured };
}

const SANDBOX_INVOICE = {
  Id: "130",
  DocNumber: "1037",
  CustomerRef: { value: "1", name: "Amy's Bird Sanctuary" },
  TxnDate: "2024-09-01",
  DueDate: "2024-10-01",
  TotalAmt: 362.07,
  Balance: 0,
  Line: [
    {
      Id: "1",
      LineNum: 1,
      Description: "Rock Fountain",
      Amount: 275,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "5", name: "Rock Fountain" }, Qty: 1, UnitPrice: 275, TaxCodeRef: { value: "TAX" } },
    },
    { Amount: 335.25, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
  ],
  TxnTaxDetail: { TotalTax: 26.82, TaxLine: [{ TaxLineDetail: { TaxPercent: 8 } }] },
};

const SANDBOX_CUSTOMER = {
  Id: "1",
  DisplayName: "Amy's Bird Sanctuary",
  PrimaryEmailAddr: { Address: "Birds@Intuit.com" },
  PrimaryPhone: { FreeFormNumber: "(650) 555-3311" },
  BillAddr: { Line1: "4581 Finch St.", City: "Bayshore", CountrySubDivisionCode: "CA", PostalCode: "94326" },
  Active: true,
};

describe("QuickBooksWebhookApplyService.applyEntity — Invoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbWriteCalls.value = 0;
    getValidToken.mockResolvedValue({ accessToken: "tok", realmId: "4620816365" });
  });

  it("fetches the invoice read-only and upserts it into invoices with the import field mapping", async () => {
    // Customer already exists in OPS (so no nested customer fetch needed).
    const { client, captured } = makeSupabase({ existingIds: { clients: "client-1" } });
    fetchEntityById.mockResolvedValue(SANDBOX_INVOICE);

    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Invoice", "130", "Update");

    expect(result.status).toBe("success");
    expect(result.logEntityType).toBe("invoice");

    const invoiceUpsert = captured.upserts.find((u) => u.table === "invoices");
    expect(invoiceUpsert).toBeDefined();
    expect(invoiceUpsert!.onConflict).toBe("company_id,qb_id");
    expect(invoiceUpsert!.row).toMatchObject({
      company_id: CO,
      qb_id: "130",
      client_id: "client-1",
      invoice_number: "1037",
      total: 362.07,
      due_date: "2024-10-01",
    });
    // line_total must NEVER be inserted (GENERATED column).
    const lineInsert = captured.inserts.find((i) => i.table === "line_items");
    expect(lineInsert).toBeDefined();
    expect(lineInsert!.row).not.toHaveProperty("line_total");
    expect(lineInsert!.row).toMatchObject({ name: "Rock Fountain", unit_price: 275 });

    // STEP 5 reconcile to QB Balance: balance 0 → paid + amount_paid = total.
    const reconcile = captured.updates.find((u) => u.table === "invoices");
    expect(reconcile).toBeDefined();
    expect(reconcile!.patch).toMatchObject({ balance_due: 0, amount_paid: 362.07, status: "paid" });
  });

  it("skips a zero-total / voided invoice (never applied)", async () => {
    const { client, captured } = makeSupabase({ existingIds: { clients: "client-1" } });
    fetchEntityById.mockResolvedValue({ ...SANDBOX_INVOICE, TotalAmt: 0, Balance: 0 });
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Invoice", "130", "Update");
    expect(result.status).toBe("skipped");
    expect(captured.upserts.find((u) => u.table === "invoices")).toBeUndefined();
  });

  it("skips when the invoice's customer cannot be resolved", async () => {
    // No existing client, and the nested customer fetch returns nothing.
    const { client, captured } = makeSupabase({});
    fetchEntityById.mockImplementation(async (entity: string) => {
      if (entity === "Invoice") return SANDBOX_INVOICE;
      return null; // Customer fetch → not found
    });
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Invoice", "130", "Update");
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("customer unresolved");
    expect(captured.upserts.find((u) => u.table === "invoices")).toBeUndefined();
  });
});

describe("QuickBooksWebhookApplyService.applyEntity — Customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbWriteCalls.value = 0;
    getValidToken.mockResolvedValue({ accessToken: "tok", realmId: "4620816365" });
  });

  it("an Update fetches the customer and upserts a client by (company_id, qb_id)", async () => {
    const { client, captured } = makeSupabase({});
    fetchEntityById.mockResolvedValue(SANDBOX_CUSTOMER);
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Customer", "1", "Update");

    expect(result.status).toBe("success");
    expect(result.logEntityType).toBe("client");
    const clientUpsert = captured.upserts.find((u) => u.table === "clients");
    expect(clientUpsert).toBeDefined();
    expect(clientUpsert!.onConflict).toBe("company_id,qb_id");
    expect(clientUpsert!.row).toMatchObject({
      company_id: CO,
      qb_id: "1",
      name: "Amy's Bird Sanctuary",
      email: "Birds@Intuit.com",
      phone_number: "(650) 555-3311",
    });
  });
});

describe("QuickBooksWebhookApplyService.applyEntity — Delete / Void (soft)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbWriteCalls.value = 0;
    getValidToken.mockResolvedValue({ accessToken: "tok", realmId: "4620816365" });
  });

  it("Void on an Invoice marks the OPS invoice status void (no QB fetch)", async () => {
    const { client, captured } = makeSupabase({});
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Invoice", "130", "Void");
    expect(result.status).toBe("success");
    expect(fetchEntityById).not.toHaveBeenCalled();
    const upd = captured.updates.find((u) => u.table === "invoices");
    expect(upd!.patch).toMatchObject({ status: "void" });
  });

  it("Delete on a Customer soft-deletes the OPS client (deleted_at)", async () => {
    const { client, captured } = makeSupabase({});
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Customer", "1", "Delete");
    expect(result.status).toBe("success");
    expect(fetchEntityById).not.toHaveBeenCalled();
    const upd = captured.updates.find((u) => u.table === "clients");
    expect(upd!.patch).toHaveProperty("deleted_at");
  });
});
