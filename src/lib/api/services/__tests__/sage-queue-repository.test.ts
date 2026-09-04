import { describe, expect, it } from "vitest";

import type { AccountingSyncQueueRow } from "../accounting-sync-queue-types";
import { SageQueueRepository } from "../sage-queue-repository";

type DbRow = Record<string, unknown>;
type State = Record<string, DbRow[]>;

function database(initial: State) {
  const state = structuredClone(initial);
  const from = (table: string) => {
    const filters: Array<[string, unknown, "eq" | "is"]> = [];
    let mode: "select" | "update" = "select";
    let patch: DbRow = {};
    let orderColumn: string | null = null;
    const matching = () =>
      (state[table] ?? [])
        .filter((row) =>
          filters.every(([column, expected, operator]) =>
            operator === "is"
              ? row[column] === expected
              : row[column] === expected
          )
        )
        .sort((a, b) =>
          orderColumn
            ? String(a[orderColumn] ?? "").localeCompare(
                String(b[orderColumn] ?? "")
              )
            : 0
        );
    const execute = () => {
      const rows = matching();
      if (mode === "update") rows.forEach((item) => Object.assign(item, patch));
      return { data: rows.map((item) => ({ ...item })), error: null };
    };
    const builder = {
      select: () => builder,
      update: (value: DbRow) => {
        mode = "update";
        patch = value;
        return builder;
      },
      eq: (column: string, expected: unknown) => {
        filters.push([column, expected, "eq"]);
        return builder;
      },
      is: (column: string, expected: unknown) => {
        filters.push([column, expected, "is"]);
        return builder;
      },
      order: (column: string) => {
        orderColumn = column;
        return builder;
      },
      maybeSingle: async () => {
        const result = execute();
        return { data: result.data[0] ?? null, error: null };
      },
      then: (
        resolve: (value: { data: DbRow[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  };
  return { client: { from }, state };
}

function queueRow(
  overrides: Partial<AccountingSyncQueueRow> = {}
): AccountingSyncQueueRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    companyId: "20000000-0000-4000-8000-000000000001",
    connectionId: "30000000-0000-4000-8000-000000000001",
    provider: "sage",
    entityType: "invoice",
    entityId: "40000000-0000-4000-8000-000000000001",
    externalId: null,
    operation: "create",
    sourceTable: "invoices",
    sourceAction: "insert",
    sourceUpdatedAt: "2026-09-04T08:00:00.000Z",
    idempotencyKey: "invoice:entity",
    status: "claimed",
    attempts: 1,
    maxAttempts: 5,
    runAfter: "2026-09-04T08:00:00.000Z",
    lockedAt: "2026-09-04T08:00:00.000Z",
    lockedBy: "worker",
    providerRequestId: null,
    providerAcceptedAt: null,
    idempotencyExpiresAt: null,
    lastError: null,
    payloadSnapshot: { providerEnvironment: "sandbox" },
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T08:00:00.000Z",
    ...overrides,
  };
}

function baseState(): State {
  return {
    accounting_connections: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        company_id: "20000000-0000-4000-8000-000000000001",
        provider: "sage",
        provider_environment: "sandbox",
        is_connected: true,
        sync_enabled: true,
        sync_direction: "bidirectional",
        sage_business_id: "encrypted-business",
      },
    ],
    clients: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        company_id: "20000000-0000-4000-8000-000000000001",
        name: "Acme",
        sage_id: "sage-contact-1",
      },
    ],
    invoices: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        company_id: "20000000-0000-4000-8000-000000000001",
        client_id: "50000000-0000-4000-8000-000000000001",
        invoice_number: "INV-100",
        issue_date: "2026-09-04",
        due_date: "2026-10-04",
        sage_id: null,
      },
    ],
    estimates: [],
    payments: [],
    line_items: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        company_id: "20000000-0000-4000-8000-000000000001",
        invoice_id: "40000000-0000-4000-8000-000000000001",
        sort_order: 1,
        description: "Labour",
        quantity: 2,
        unit_price: 80,
        line_total: 160,
        task_type_id: "70000000-0000-4000-8000-000000000001",
        tax_rate_id: "80000000-0000-4000-8000-000000000001",
        is_taxable: true,
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        company_id: "20000000-0000-4000-8000-000000000001",
        invoice_id: "40000000-0000-4000-8000-000000000001",
        sort_order: 2,
        description: "Membrane",
        quantity: 3,
        unit_price: 40,
        line_total: 120,
        product_id: "70000000-0000-4000-8000-000000000002",
        is_taxable: false,
      },
    ],
    sage_sales_account_mappings: [
      {
        company_id: "20000000-0000-4000-8000-000000000001",
        connection_id: "30000000-0000-4000-8000-000000000001",
        source_kind: "task_type",
        source_key: "70000000-0000-4000-8000-000000000001",
        sage_ledger_account_id: "ledger-labour",
      },
      {
        company_id: "20000000-0000-4000-8000-000000000001",
        connection_id: "30000000-0000-4000-8000-000000000001",
        source_kind: "product",
        source_key: "70000000-0000-4000-8000-000000000002",
        sage_ledger_account_id: "ledger-materials",
      },
    ],
    sage_tax_rate_mappings: [
      {
        company_id: "20000000-0000-4000-8000-000000000001",
        connection_id: "30000000-0000-4000-8000-000000000001",
        source_tax_key: "tax_rate:80000000-0000-4000-8000-000000000001",
        sage_tax_rate_id: "tax-gst",
      },
      {
        company_id: "20000000-0000-4000-8000-000000000001",
        connection_id: "30000000-0000-4000-8000-000000000001",
        source_tax_key: "non_taxable",
        sage_tax_rate_id: "tax-exempt",
      },
    ],
    sage_payment_method_mappings: [],
  };
}

describe("Sage queue repository", () => {
  it("loads only the exact Sage connection boundary", async () => {
    const db = database(baseState());
    const repository = new SageQueueRepository(db.client as never);

    await expect(repository.loadConnection(queueRow())).resolves.toEqual({
      id: "30000000-0000-4000-8000-000000000001",
      companyId: "20000000-0000-4000-8000-000000000001",
      provider: "sage",
      providerEnvironment: "sandbox",
      isConnected: true,
      syncEnabled: true,
      syncDirection: "bidirectional",
      encryptedBusinessId: "encrypted-business",
    });
  });

  it("reloads and preserves every invoice line with exact account and tax mappings", async () => {
    const db = database(baseState());
    const repository = new SageQueueRepository(db.client as never);

    const prepared = await repository.prepare(
      queueRow(),
      (await repository.loadConnection(queueRow()))!
    );

    expect(prepared.resource).toBe("sales_invoices");
    expect(prepared.payload).toEqual(
      expect.objectContaining({
        contact_id: "sage-contact-1",
        reference: "INV-100",
        invoice_lines: [
          expect.objectContaining({
            description: "Labour",
            ledger_account_id: "ledger-labour",
            tax_rate_id: "tax-gst",
          }),
          expect.objectContaining({
            description: "Membrane",
            ledger_account_id: "ledger-materials",
            tax_rate_id: "tax-exempt",
          }),
        ],
      })
    );

    await prepared.finalize("sage-invoice-1");
    expect(db.state.invoices[0].sage_id).toBe("sage-invoice-1");
  });

  it("fails before provider construction when a line mapping is absent", async () => {
    const state = baseState();
    state.sage_tax_rate_mappings = [];
    const repository = new SageQueueRepository(database(state).client as never);

    await expect(
      repository.prepare(
        queueRow(),
        (await repository.loadConnection(queueRow()))!
      )
    ).rejects.toThrow(/tax mapping/i);
  });

  it.each([
    ["sales_estimate", "sales_estimates"],
    ["sales_quote", "sales_quotes"],
    [null, "sales_quotes"],
  ])("uses %s identity for estimates", async (kind, resource) => {
    const state = baseState();
    state.estimates = [
      {
        id: "41000000-0000-4000-8000-000000000001",
        company_id: "20000000-0000-4000-8000-000000000001",
        client_id: "50000000-0000-4000-8000-000000000001",
        estimate_number: "EST-100",
        issue_date: "2026-09-04",
        expiration_date: "2026-10-04",
        sage_document_kind: kind,
        sage_id: null,
      },
    ];
    state.line_items = state.line_items.map((line) => ({
      ...line,
      invoice_id: null,
      estimate_id: "41000000-0000-4000-8000-000000000001",
    }));
    const db = database(state);
    const repository = new SageQueueRepository(db.client as never);
    const estimateRow = queueRow({
      entityType: "estimate",
      entityId: "41000000-0000-4000-8000-000000000001",
      sourceTable: "estimates",
    });

    const prepared = await repository.prepare(
      estimateRow,
      (await repository.loadConnection(estimateRow))!
    );
    expect(prepared.resource).toBe(resource);
  });

  it("maps customer payments with exact bank, method, and invoice allocation", async () => {
    const state = baseState();
    state.invoices[0].sage_id = "sage-invoice-1";
    state.payments = [
      {
        id: "42000000-0000-4000-8000-000000000001",
        company_id: "20000000-0000-4000-8000-000000000001",
        client_id: "50000000-0000-4000-8000-000000000001",
        invoice_id: "40000000-0000-4000-8000-000000000001",
        payment_method: "eft",
        payment_date: "2026-09-04",
        amount: 125.25,
        reference_number: "PAY-100",
        sage_id: null,
      },
    ];
    state.sage_payment_method_mappings = [
      {
        company_id: "20000000-0000-4000-8000-000000000001",
        connection_id: "30000000-0000-4000-8000-000000000001",
        payment_method: "eft",
        sage_bank_account_id: "sage-bank-1",
        sage_payment_method_id: "sage-method-1",
      },
    ];
    const db = database(state);
    const repository = new SageQueueRepository(db.client as never);
    const paymentRow = queueRow({
      entityType: "payment",
      entityId: "42000000-0000-4000-8000-000000000001",
      sourceTable: "payments",
    });

    const prepared = await repository.prepare(
      paymentRow,
      (await repository.loadConnection(paymentRow))!
    );
    expect(prepared.payload).toEqual(
      expect.objectContaining({
        contact_id: "sage-contact-1",
        bank_account_id: "sage-bank-1",
        payment_method_id: "sage-method-1",
        allocated_artefacts: [
          { artefact_id: "sage-invoice-1", amount: 125.25 },
        ],
      })
    );
  });

  it("prepares a deleted invoice tombstone from durable queue identity", async () => {
    const state = baseState();
    state.invoices = [];
    const db = database(state);
    const repository = new SageQueueRepository(db.client as never);
    const tombstone = queueRow({
      operation: "void",
      externalId: "sage-deleted-invoice",
      payloadSnapshot: {
        providerEnvironment: "sandbox",
        snapshot: { invoice_number: "INV-DELETED" },
      },
    });

    const prepared = await repository.prepare(
      tombstone,
      (await repository.loadConnection(tombstone))!
    );
    expect(prepared).toEqual(
      expect.objectContaining({
        resource: "sales_invoices",
        externalId: "sage-deleted-invoice",
      })
    );
    await expect(
      prepared.finalize("sage-deleted-invoice")
    ).resolves.toBeUndefined();
  });
});
