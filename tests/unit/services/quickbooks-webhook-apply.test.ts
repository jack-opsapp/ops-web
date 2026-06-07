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
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
}

function makeSupabase(opts: {
  // table -> resolved id for maybeSingle on (company_id, qb_id) lookups
  existingIds?: Record<string, string>;
  rows?: Record<string, Array<Record<string, unknown>>>;
}) {
  const captured: Captured = { upserts: [], inserts: [], updates: [], deletes: [], rpcs: [] };
  const existingIds = opts.existingIds ?? {};
  const rows = opts.rows ?? {};
  // After an upsert, subsequent maybeSingle should resolve a fresh id.
  const resolvedAfterUpsert: Record<string, string> = {};

  function client() {
    return {
      rpc(fn: string, args: Record<string, unknown>) {
        captured.rpcs.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
      from(table: string) {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.gte = () => builder;
        builder.or = () => builder;
        builder.is = () => builder;
        builder.limit = () => builder;
        builder.order = () => builder;
        builder.maybeSingle = async () => {
          const id = existingIds[table] ?? resolvedAfterUpsert[table];
          return { data: id ? { id } : null, error: null };
        };
        builder.upsert = async (row: Record<string, unknown>, cfg?: { onConflict?: string }) => {
          captured.upserts.push({ table, row, onConflict: cfg?.onConflict });
          // Mimic the row now existing so the post-upsert maybeSingle resolves.
          resolvedAfterUpsert[table] = (row.id as string | undefined) ?? `${table}-id`;
          return { error: null };
        };
        builder.insert = async (row: Record<string, unknown>) => {
          captured.inserts.push({ table, row });
          return { error: null };
        };
        builder.update = (patch: Record<string, unknown>) => {
          captured.updates.push({ table, patch });
          return builder;
        };
        builder.delete = () => {
          captured.deletes.push({ table });
          return { eq: () => ({ error: null }) };
        };
        builder.then = (
          resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject);
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

const SANDBOX_ACCEPTED_ESTIMATE = {
  Id: "99",
  DocNumber: "1001",
  CustomerRef: { value: "1", name: "Amy's Bird Sanctuary" },
  TxnDate: "2024-09-01",
  ExpirationDate: "2024-10-01",
  TxnStatus: "Accepted",
  TotalAmt: 500,
  Line: [
    {
      Id: "1",
      LineNum: 1,
      Description: "Install rail",
      Amount: 500,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: "7", name: "Install rail" },
        Qty: 2,
        UnitPrice: 250,
      },
    },
  ],
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
    expect(captured.rpcs).toContainEqual({
      fn: "suppress_accounting_sync",
      args: expect.objectContaining({
        p_company_id: CO,
        p_provider: "quickbooks",
        p_entity_type: "invoice",
        p_entity_id: invoiceUpsert!.row.id,
        p_source: "quickbooks",
      }),
    });
    expect(captured.rpcs.some((c) => c.fn === "set_ops_sync_source")).toBe(false);
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

  it("skips customer webhooks that echo a just-recorded OPS-to-QBO write", async () => {
    const { client, captured } = makeSupabase({
      rows: {
        accounting_sync_events: [
          {
            id: "evt-outbound-1",
            entity_id: "client-1",
            qb_updated_at: "2024-09-01T12:00:00.000Z",
          },
        ],
      },
    });
    fetchEntityById.mockResolvedValue({
      ...SANDBOX_CUSTOMER,
      MetaData: { LastUpdatedTime: "2024-09-01T05:00:00-07:00" },
    });

    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Customer", "1", "Update");

    expect(result).toMatchObject({
      status: "skipped",
      logEntityType: "client",
      entityId: "client-1",
      detail: "outbound echo skipped",
      afterSnapshot: { echoEventId: "evt-outbound-1" },
    });
    expect(captured.upserts).toEqual([]);
    expect(captured.rpcs).toEqual([]);
  });

  it("a company-customer webhook creates a CompanyName client + a contact sub_client", async () => {
    const { client, captured } = makeSupabase({});
    fetchEntityById.mockResolvedValue({
      Id: "42", DisplayName: "Acme Corp", CompanyName: "Acme Corp",
      GivenName: "John", FamilyName: "Smith",
      PrimaryEmailAddr: { Address: "john@acme.com" }, PrimaryPhone: { FreeFormNumber: "555" },
    });
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Customer", "42", "Update");
    expect(result.status).toBe("success");

    const clientUpsert = captured.upserts.find((u) => u.table === "clients");
    expect(clientUpsert!.row).toMatchObject({ qb_id: "42", name: "Acme Corp", email: null, phone_number: null });

    const subUpsert = captured.upserts.find((u) => u.table === "sub_clients");
    expect(subUpsert).toBeDefined();
    expect(subUpsert!.onConflict).toBe("company_id,qb_id");
    expect(subUpsert!.row).toMatchObject({ qb_id: "42", name: "John Smith", email: "john@acme.com", phone_number: "555" });
  });

  it("an individual webhook stays flat (no sub_client)", async () => {
    const { client, captured } = makeSupabase({});
    fetchEntityById.mockResolvedValue({
      Id: "9", DisplayName: "Jane Doe", GivenName: "Jane", FamilyName: "Doe",
      PrimaryEmailAddr: { Address: "jane@doe.com" },
    });
    const svc = new QuickBooksWebhookApplyService(client as never);
    await svc.applyEntity(CONN, "Customer", "9", "Update");
    const clientUpsert = captured.upserts.find((u) => u.table === "clients");
    expect(clientUpsert!.row).toMatchObject({ qb_id: "9", name: "Jane Doe", email: "jane@doe.com" });
    expect(captured.upserts.some((u) => u.table === "sub_clients")).toBe(false);
  });
});

describe("QuickBooksWebhookApplyService.applyEntity — Estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbWriteCalls.value = 0;
    getValidToken.mockResolvedValue({ accessToken: "tok", realmId: "4620816365" });
  });

  it("accepted QBO estimates call the acceptance bridge after the estimate is persisted", async () => {
    const { client, captured } = makeSupabase({
      existingIds: { clients: "client-1", estimates: "estimate-99" },
    });
    fetchEntityById.mockResolvedValue(SANDBOX_ACCEPTED_ESTIMATE);
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Estimate", "99", "Update");

    expect(result.status).toBe("needs_review");
    expect(result.detail).toBe("empty_bridge_response");
    const estimateUpsert = captured.upserts.find((u) => u.table === "estimates");
    expect(estimateUpsert).toBeDefined();
    expect(estimateUpsert!.row).toMatchObject({
      company_id: CO,
      qb_id: "99",
      client_id: "client-1",
      estimate_number: "1001",
      status: "approved",
    });
    expect(captured.inserts.find((i) => i.table === "line_items")?.row).toMatchObject({
      estimate_id: "estimate-99",
      name: "Install rail",
      quantity: 2,
      unit_price: 250,
      type: "LABOR",
    });
    expect(captured.rpcs).toContainEqual({
      fn: "accept_estimate_to_job_from_quickbooks",
      args: {
        p_company_id: CO,
        p_connection_id: CONN.id,
        p_estimate_id: "estimate-99",
        p_qb_estimate_id: "99",
        p_idempotency_key: "qbo:estimate:accepted:conn-1:99",
      },
    });
    expect(result.afterSnapshot).toEqual(
      expect.objectContaining({
        estimateStatus: "approved",
        quickbooksTxnStatus: "Accepted",
        lineItemWriteMode: "replaced",
        acceptance: expect.objectContaining({ status: "needs_review" }),
      })
    );
  });

  it("preserves existing linked estimate lines before accepting a QBO estimate", async () => {
    const { client, captured } = makeSupabase({
      existingIds: { clients: "client-1", estimates: "estimate-99" },
      rows: {
        line_items: [
          {
            id: "line-1",
            task_type_ref: "task-type-1",
            task_type_id: null,
            product_id: "product-1",
            unit_id: null,
          },
        ],
      },
    });
    fetchEntityById.mockResolvedValue(SANDBOX_ACCEPTED_ESTIMATE);
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Estimate", "99", "Update");

    expect(captured.deletes.some((entry) => entry.table === "line_items")).toBe(false);
    expect(captured.inserts.some((entry) => entry.table === "line_items")).toBe(false);
    expect(result.afterSnapshot).toEqual(
      expect.objectContaining({
        lineItemWriteMode: "preserved_existing_linked_lines",
      })
    );
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

  it("Void on a Payment marks matching OPS payments voided and suppresses invoice echo", async () => {
    const { client, captured } = makeSupabase({
      rows: {
        payments: [
          {
            id: "payment-1",
            invoice_id: "invoice-1",
          },
        ],
      },
    });
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Payment", "77", "Void");

    expect(result.status).toBe("success");
    expect(fetchEntityById).not.toHaveBeenCalled();
    expect(result.afterSnapshot).toEqual({ voidedPayments: 1 });
    expect(captured.rpcs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.objectContaining({ p_entity_type: "payment", p_entity_id: "payment-1" }),
        }),
        expect.objectContaining({
          args: expect.objectContaining({ p_entity_type: "invoice", p_entity_id: "invoice-1" }),
        }),
      ])
    );
    const upd = captured.updates.find((u) => u.table === "payments");
    expect(upd!.patch).toHaveProperty("voided_at");
  });
});
