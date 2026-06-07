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
  // table -> id that appears only after the first lookup, simulating a
  // duplicate webhook winning the insert race between the initial lookup and
  // the attempted write.
  lateExistingIds?: Record<string, string>;
  insertErrors?: Record<string, { code?: string; message: string }>;
  rows?: Record<string, Array<Record<string, unknown>>>;
}) {
  const captured: Captured = { upserts: [], inserts: [], updates: [], deletes: [], rpcs: [] };
  const existingIds = opts.existingIds ?? {};
  const lateExistingIds = opts.lateExistingIds ?? {};
  const insertErrors = opts.insertErrors ?? {};
  const rows = opts.rows ?? {};
  const maybeSingleCalls: Record<string, number> = {};
  // After an upsert, subsequent maybeSingle should resolve a fresh id.
  const resolvedAfterUpsert: Record<string, string> = {};

  function client() {
    return {
      rpc(fn: string, args: Record<string, unknown>) {
        captured.rpcs.push({ fn, args });
        if (fn === "ensure_qbo_estimate_opportunity") {
          return Promise.resolve({ data: "opportunity-99", error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      from(table: string) {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        builder.eq = (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return builder;
        };
        builder.in = (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return builder;
        };
        builder.gte = () => builder;
        builder.or = () => builder;
        builder.is = () => builder;
        builder.limit = () => builder;
        builder.order = () => builder;
        builder.maybeSingle = async () => {
          const matched = (rows[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
          if (matched.length > 0) {
            return { data: matched[0], error: null };
          }
          maybeSingleCalls[table] = (maybeSingleCalls[table] ?? 0) + 1;
          const lateId =
            maybeSingleCalls[table] > 1 ? lateExistingIds[table] : undefined;
          const id = existingIds[table] ?? lateId ?? resolvedAfterUpsert[table];
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
          if (insertErrors[table]) {
            return { error: insertErrors[table] };
          }
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
        ) =>
          Promise.resolve({
            data: (rows[table] ?? []).filter((row) => filters.every((fn) => fn(row))),
            error: null,
          }).then(resolve, reject);
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

const SANDBOX_PAYMENT = {
  Id: "77",
  CustomerRef: { value: "1" },
  TxnDate: "2024-09-02",
  TotalAmt: 25,
  PaymentRefNum: "CHK-77",
  Line: [
    {
      Amount: 25,
      LinkedTxn: [{ TxnId: "130", TxnType: "Invoice" }],
      LineEx: { any: [{ name: "txnReferenceNumber", value: "1037" }] },
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

    const invoiceInsert = captured.inserts.find((u) => u.table === "invoices");
    expect(invoiceInsert).toBeDefined();
    expect(captured.upserts.some((u) => u.table === "invoices")).toBe(false);
    expect(invoiceInsert!.row).toMatchObject({
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
        p_entity_id: invoiceInsert!.row.id,
        p_source: "quickbooks",
      }),
    });
    expect(captured.rpcs.some((c) => c.fn === "set_ops_sync_source")).toBe(false);
    // line_total must NEVER be inserted (GENERATED column).
    const lineReplace = captured.rpcs.find((i) => i.fn === "replace_qbo_line_items_locked");
    expect(lineReplace).toBeDefined();
    expect(lineReplace!.args).toMatchObject({ p_company_id: CO });
    expect(lineReplace!.args.p_lines).toEqual([
      expect.objectContaining({ name: "Rock Fountain", unit_price: 275 }),
    ]);
    expect(JSON.stringify(lineReplace!.args.p_lines)).not.toContain("line_total");

    // STEP 5 reconcile to QB Balance: balance 0 → paid + amount_paid = total.
    const reconcile = captured.updates.find((u) => u.table === "invoices");
    expect(reconcile).toBeDefined();
    expect(reconcile!.patch).toMatchObject({ balance_due: 0, amount_paid: 362.07, status: "paid" });
  });

  it("keeps the invoice primary key stable when a duplicate webhook wins the insert race", async () => {
    const { client, captured } = makeSupabase({
      existingIds: { clients: "client-1" },
      lateExistingIds: { invoices: "invoice-existing-after-race" },
      insertErrors: {
        invoices: { code: "23505", message: "duplicate key value violates unique constraint" },
      },
    });
    fetchEntityById.mockResolvedValue(SANDBOX_INVOICE);

    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Invoice", "130", "Create");

    expect(result.status).toBe("success");
    expect(result.entityId).toBe("invoice-existing-after-race");
    expect(captured.upserts.some((u) => u.table === "invoices")).toBe(false);

    const invoiceInsert = captured.inserts.find((i) => i.table === "invoices");
    expect(invoiceInsert).toBeDefined();
    expect(invoiceInsert!.row.id).not.toBe("invoice-existing-after-race");

    const invoiceUpdate = captured.updates.find((u) => u.table === "invoices");
    expect(invoiceUpdate).toBeDefined();
    expect(invoiceUpdate!.patch).not.toHaveProperty("id");

    const lineReplace = captured.rpcs.find((i) => i.fn === "replace_qbo_line_items_locked");
    expect(lineReplace?.args).toMatchObject({
      p_company_id: CO,
      p_invoice_id: "invoice-existing-after-race",
      p_estimate_id: null,
    });
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
    const clientInsert = captured.inserts.find((u) => u.table === "clients");
    expect(clientInsert).toBeDefined();
    expect(captured.upserts.some((u) => u.table === "clients")).toBe(false);
    expect(clientInsert!.row).toMatchObject({
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
            company_id: CO,
            connection_id: CONN.id,
            provider: "quickbooks",
            direction: "ops_to_qb",
            entity_type: "customer",
            external_id: "1",
            status: "succeeded",
            source: "worker",
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

    const clientInsert = captured.inserts.find((u) => u.table === "clients");
    expect(clientInsert!.row).toMatchObject({ qb_id: "42", name: "Acme Corp", email: null, phone_number: null });

    const subInsert = captured.inserts.find((u) => u.table === "sub_clients");
    expect(subInsert).toBeDefined();
    expect(subInsert!.row).toMatchObject({ qb_id: "42", name: "John Smith", email: "john@acme.com", phone_number: "555" });
    expect(captured.upserts.some((u) => u.table === "sub_clients")).toBe(false);
  });

  it("an individual webhook stays flat (no sub_client)", async () => {
    const { client, captured } = makeSupabase({});
    fetchEntityById.mockResolvedValue({
      Id: "9", DisplayName: "Jane Doe", GivenName: "Jane", FamilyName: "Doe",
      PrimaryEmailAddr: { Address: "jane@doe.com" },
    });
    const svc = new QuickBooksWebhookApplyService(client as never);
    await svc.applyEntity(CONN, "Customer", "9", "Update");
    const clientInsert = captured.inserts.find((u) => u.table === "clients");
    expect(clientInsert!.row).toMatchObject({ qb_id: "9", name: "Jane Doe", email: "jane@doe.com" });
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
    const estimateUpdate = captured.updates.find((u) => u.table === "estimates");
    expect(estimateUpdate).toBeDefined();
    expect(estimateUpdate!.patch).not.toHaveProperty("id");
    expect(estimateUpdate!.patch).toMatchObject({
      company_id: CO,
      qb_id: "99",
      client_id: "client-1",
      opportunity_id: "opportunity-99",
      estimate_number: "1001",
      status: "approved",
    });
    expect(captured.rpcs).toContainEqual({
      fn: "ensure_qbo_estimate_opportunity",
      args: {
        p_company_id: CO,
        p_connection_id: CONN.id,
        p_client_id: "client-1",
        p_qb_estimate_id: "99",
        p_estimate_id: "estimate-99",
        p_estimate_number: "1001",
        p_title: "QuickBooks estimate 1001",
        p_total: 500,
      },
    });
    expect(captured.rpcs.find((i) => i.fn === "replace_qbo_line_items_locked")?.args).toMatchObject({
      p_company_id: CO,
      p_estimate_id: "estimate-99",
      p_invoice_id: null,
      p_lines: [
        expect.objectContaining({
          name: "Install rail",
          quantity: 2,
          unit_price: 250,
          type: "LABOR",
        }),
      ],
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
        missingQboItemMappings: [
          {
            qb_item_id: "7",
            qb_item_name: "Install rail",
            line_name: "Install rail",
          },
        ],
        acceptance: expect.objectContaining({ status: "needs_review" }),
      })
    );
  });

  it("maps QBO estimate ItemRef lines to OPS product, task type, and unit before acceptance", async () => {
    const { client, captured } = makeSupabase({
      existingIds: { clients: "client-1", estimates: "estimate-99" },
      rows: {
        qbo_item_product_mappings: [
          {
            id: "qbo-map-1",
            company_id: CO,
            connection_id: CONN.id,
            qb_item_id: "7",
            qb_item_name: "Install rail",
            qb_item_type: "Service",
            product_id: "product-1",
            deleted_at: null,
          },
        ],
        products: [
          {
            id: "product-1",
            company_id: CO,
            name: "Install rail",
            type: "LABOR",
            task_type_ref: "task-type-1",
            task_type_id: "legacy-task-type",
            unit: "hour",
            unit_id: "unit-1",
            deleted_at: null,
          },
        ],
      },
    });
    fetchEntityById.mockResolvedValue(SANDBOX_ACCEPTED_ESTIMATE);

    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Estimate", "99", "Update");

    expect(result.status).toBe("needs_review");
    const lineReplace = captured.rpcs.find((i) => i.fn === "replace_qbo_line_items_locked");
    expect(lineReplace).toBeDefined();
    expect(lineReplace!.args.p_lines).toEqual([
      expect.objectContaining({
        name: "Install rail",
        qb_item_id: "7",
        qb_item_name: "Install rail",
        product_id: "product-1",
        task_type_ref: "task-type-1",
        task_type_id: "legacy-task-type",
        unit: "hour",
        unit_id: "unit-1",
        type: "LABOR",
      }),
    ]);
    expect(result.afterSnapshot).toEqual(
      expect.objectContaining({
        missingQboItemMappings: [],
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
            company_id: CO,
            estimate_id: "estimate-99",
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
    expect(captured.rpcs.some((entry) => entry.fn === "replace_qbo_line_items_locked")).toBe(false);
    expect(result.afterSnapshot).toEqual(
      expect.objectContaining({
        lineItemWriteMode: "preserved_existing_linked_lines",
      })
    );
  });
});

describe("QuickBooksWebhookApplyService.applyEntity — Payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbWriteCalls.value = 0;
    getValidToken.mockResolvedValue({ accessToken: "tok", realmId: "4620816365" });
  });

  it("updates a legacy raw payment row to the canonical payment:invoice id on delayed webhook replay", async () => {
    const { client, captured } = makeSupabase({
      existingIds: { clients: "client-1", invoices: "invoice-130" },
      rows: {
        payments: [
          {
            id: "payment-existing",
            company_id: CO,
            qb_id: "77",
            invoice_id: "invoice-130",
          },
        ],
      },
    });
    fetchEntityById.mockResolvedValue(SANDBOX_PAYMENT);
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Payment", "77", "Create");

    expect(result.status).toBe("success");
    expect(result.entityId).toBe("payment-existing");
    expect(captured.inserts.some((entry) => entry.table === "payments")).toBe(false);
    const paymentUpdate = captured.updates.find((entry) => entry.table === "payments");
    expect(paymentUpdate?.patch).toMatchObject({
      qb_id: "77:130",
      invoice_id: "invoice-130",
      amount: 25,
    });
    expect(paymentUpdate?.patch).not.toHaveProperty("id");
  });

  it("replays a duplicate linked payment webhook without creating a second payment", async () => {
    const { client, captured } = makeSupabase({
      existingIds: { clients: "client-1", invoices: "invoice-130" },
      rows: {
        payments: [
          {
            id: "payment-existing",
            company_id: CO,
            qb_id: "77:130",
            invoice_id: "invoice-130",
          },
        ],
      },
    });
    fetchEntityById.mockResolvedValue(SANDBOX_PAYMENT);
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Payment", "77", "Update");

    expect(result.status).toBe("success");
    expect(result.entityId).toBe("payment-existing");
    expect(captured.inserts.some((entry) => entry.table === "payments")).toBe(false);
    expect(captured.updates.find((entry) => entry.table === "payments")?.patch).toMatchObject({
      qb_id: "77:130",
      amount: 25,
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

  it("Void on a Payment marks matching OPS payments voided and suppresses invoice echo", async () => {
    const { client, captured } = makeSupabase({
      rows: {
        payments: [
          {
            id: "payment-1",
            company_id: CO,
            qb_id: "77",
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

  it("skips Payment Void webhooks that echo a just-recorded OPS-to-QBO void", async () => {
    const { client, captured } = makeSupabase({
      rows: {
        accounting_sync_events: [
          {
            id: "evt-payment-void",
            company_id: CO,
            connection_id: CONN.id,
            provider: "quickbooks",
            direction: "ops_to_qb",
            entity_type: "payment",
            external_id: "77",
            status: "succeeded",
            source: "worker",
            entity_id: "payment-1",
            operation: "void",
          },
        ],
        payments: [
          {
            id: "payment-1",
            company_id: CO,
            qb_id: "77",
            invoice_id: "invoice-1",
          },
        ],
      },
    });
    const svc = new QuickBooksWebhookApplyService(client as never);
    const result = await svc.applyEntity(CONN, "Payment", "77", "Void");

    expect(result).toMatchObject({
      status: "skipped",
      logEntityType: "payment",
      entityId: "payment-1",
      detail: "outbound void echo skipped",
      afterSnapshot: { echoEventId: "evt-payment-void" },
    });
    expect(fetchEntityById).not.toHaveBeenCalled();
    expect(captured.rpcs).toEqual([]);
    expect(captured.updates).toEqual([]);
  });
});
