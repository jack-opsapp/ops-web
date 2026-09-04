import { describe, expect, it, vi } from "vitest";

import type { SupplierBillQueueRow } from "../supplier-bill-queue-processor";
import { SupplierBillProviderSyncService } from "../supplier-bill-provider-sync-service";

function fakeDb(rows: Record<string, Record<string, unknown> | null>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return builder;
        },
        maybeSingle: async () => {
          if (table === "supplier_bill_provider_links") {
            const key = `${filters.entity_type}:${filters.entity_id}`;
            return { data: rows[key] ?? null, error: null };
          }
          return { data: rows[`${table}:${filters.id}`] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

function relationalDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push((row: Record<string, unknown>) => row[key] === value);
          return builder;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row: Record<string, unknown>) =>
            values.includes(row[key])
          );
          return builder;
        },
        order: () => builder,
        maybeSingle: async () => ({
          data:
            (tables[table] ?? []).filter((row) =>
              filters.every((match) => match(row))
            )[0] ?? null,
          error: null,
        }),
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown
        ) =>
          Promise.resolve({
            data: (tables[table] ?? []).filter((row) =>
              filters.every((match) => match(row))
            ),
            error: null,
          }).then(resolve, reject),
      };
      return builder;
    },
  };
}

const ROW: SupplierBillQueueRow = {
  id: "10000000-0000-4000-8000-000000000001",
  companyId: "10000000-0000-4000-8000-000000000002",
  connectionId: "10000000-0000-4000-8000-000000000003",
  provider: "quickbooks",
  entityType: "supplier",
  entityId: "10000000-0000-4000-8000-000000000004",
  externalId: null,
  operation: "create",
  sourceTable: "suppliers",
  sourceAction: "insert",
  sourceUpdatedAt: "2026-09-03T00:00:00Z",
  idempotencyKey: "supplier",
  status: "claimed",
  attempts: 1,
  maxAttempts: 5,
  runAfter: "2026-09-03T00:00:00Z",
  lockedAt: "2026-09-03T00:00:00Z",
  lockedBy: "worker",
  providerRequestId: null,
  providerAcceptedAt: null,
  idempotencyExpiresAt: null,
  lastError: null,
  payloadSnapshot: {},
  createdAt: "2026-09-03T00:00:00Z",
  updatedAt: "2026-09-03T00:00:00Z",
};

describe("SupplierBillProviderSyncService", () => {
  it("creates a QuickBooks Vendor from the canonical supplier and queue identity", async () => {
    const create = vi.fn().mockResolvedValue({
      qbId: "501",
      syncToken: "0",
      metaUpdatedAt: "2026-09-03T00:01:00Z",
    });
    const service = new SupplierBillProviderSyncService(
      fakeDb({
        [`suppliers:${ROW.entityId}`]: {
          id: ROW.entityId,
          display_name: "Example Supply",
          email: "ap@example.test",
          phone: null,
          tax_number: null,
        },
      }) as never,
      ROW,
      {
        accessToken: "token",
        realmId: "realm",
        providerEnvironment: "sandbox",
        quickBooks: { create } as never,
      }
    );

    await expect(service.write()).resolves.toEqual({
      externalId: "501",
      syncToken: "0",
      providerUpdatedAt: "2026-09-03T00:01:00Z",
    });
    expect(create).toHaveBeenCalledWith(
      "Vendor",
      {
        DisplayName: "Example Supply",
        CompanyName: "Example Supply",
        PrimaryEmailAddr: { Address: "ap@example.test" },
      },
      ROW.id
    );
  });

  it("refreshes a missing QuickBooks sync token before updating a supplier", async () => {
    const fetchCurrent = vi.fn().mockResolvedValue({
      Vendor: { Id: "501", SyncToken: "7" },
    });
    const update = vi.fn().mockResolvedValue({
      qbId: "501",
      syncToken: "8",
      metaUpdatedAt: "2026-09-03T00:02:00Z",
    });
    const service = new SupplierBillProviderSyncService(
      fakeDb({
        [`suppliers:${ROW.entityId}`]: {
          id: ROW.entityId,
          display_name: "Example Supply",
          email: null,
          phone: null,
          tax_number: null,
        },
        [`supplier:${ROW.entityId}`]: {
          external_id: "501",
          sync_token: null,
        },
      }) as never,
      { ...ROW, operation: "update" },
      {
        accessToken: "token",
        realmId: "realm",
        providerEnvironment: "sandbox",
        quickBooks: { fetchCurrent, update } as never,
      }
    );

    await expect(service.write()).resolves.toEqual({
      externalId: "501",
      syncToken: "8",
      providerUpdatedAt: "2026-09-03T00:02:00Z",
    });
    expect(fetchCurrent).toHaveBeenCalledWith("Vendor", "501");
    expect(update).toHaveBeenCalledWith(
      "Vendor",
      expect.objectContaining({ Id: "501", SyncToken: "7", sparse: true }),
      ROW.id
    );
  });

  it("uses the business-bound Sage client and queue-derived idempotency identity", async () => {
    process.env.QB_TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString("base64");
    const create = vi.fn().mockResolvedValue({
      data: { id: "sage-supplier-1" },
      evidence: {
        requestId: "sage-request-1",
        status: 201,
        acceptedAt: "2026-09-03T00:01:00Z",
      },
    });
    const sageRow: SupplierBillQueueRow = { ...ROW, provider: "sage" };
    const service = new SupplierBillProviderSyncService(
      fakeDb({
        [`suppliers:${ROW.entityId}`]: {
          id: ROW.entityId,
          display_name: "Example Supply",
          email: "ap@example.test",
          phone: null,
          tax_number: null,
        },
      }) as never,
      sageRow,
      {
        accessToken: "token",
        realmId: null,
        providerEnvironment: "sandbox",
        sage: { create } as never,
      }
    );

    await expect(service.write()).resolves.toEqual({
      externalId: "sage-supplier-1",
      syncToken: null,
      providerUpdatedAt: null,
      acceptedEvidence: {
        requestId: "sage-request-1",
        status: 201,
        acceptedAt: "2026-09-03T00:01:00Z",
      },
    });
    expect(create).toHaveBeenCalledWith(
      "contacts",
      expect.objectContaining({ name: "Example Supply" }),
      expect.objectContaining({
        resource: "contacts",
        id: expect.stringMatching(/^[a-f0-9]{32}$/),
      })
    );
  });

  it("maps Sage purchase lines only through the exact connection", async () => {
    const BILL_ID = "10000000-0000-4000-8000-000000000005";
    const LINE_ID = "10000000-0000-4000-8000-000000000006";
    const CATEGORY_ID = "10000000-0000-4000-8000-000000000007";
    const supplierId = ROW.entityId;
    const sageRow: SupplierBillQueueRow = {
      ...ROW,
      provider: "sage",
      entityType: "supplier_bill",
      entityId: BILL_ID,
      sourceTable: "supplier_bills",
    };
    const create = vi.fn().mockResolvedValue({
      data: { id: "sage-bill-1" },
      evidence: {
        requestId: "request-1",
        status: 201,
        acceptedAt: "2026-09-03T00:01:00Z",
      },
    });
    const service = new SupplierBillProviderSyncService(
      relationalDb({
        supplier_bills: [
          {
            id: BILL_ID,
            company_id: ROW.companyId,
            supplier_id: supplierId,
            invoice_number: "V-100",
            invoice_date: "2026-09-01",
            due_date: "2026-09-30",
            currency: "CAD",
            subtotal: 100,
            tax_total: 12,
            total: 112,
          },
        ],
        suppliers: [
          {
            id: supplierId,
            company_id: ROW.companyId,
            display_name: "Example Supply",
          },
        ],
        supplier_bill_provider_links: [
          {
            connection_id: ROW.connectionId,
            entity_type: "supplier",
            entity_id: supplierId,
            external_id: "sage-supplier-1",
          },
        ],
        supplier_bill_line_items: [
          {
            id: LINE_ID,
            bill_id: BILL_ID,
            company_id: ROW.companyId,
            category_id: CATEGORY_ID,
            position: 1,
            description: "Materials",
            quantity: 2,
            unit_price: 50,
            subtotal: 100,
            tax_amount: 12,
            tax_rate: 12,
            total: 112,
          },
        ],
        supplier_bill_project_allocations: [],
        sage_purchase_account_mappings: [
          {
            company_id: ROW.companyId,
            connection_id: ROW.connectionId,
            expense_category_id: CATEGORY_ID,
            sage_ledger_account_id: "sage-purchase-ledger-1",
          },
          {
            company_id: ROW.companyId,
            connection_id: "different-connection",
            expense_category_id: CATEGORY_ID,
            sage_ledger_account_id: "wrong-ledger",
          },
        ],
        supplier_bill_tax_mappings: [
          {
            company_id: ROW.companyId,
            connection_id: ROW.connectionId,
            provider: "sage",
            tax_rate: 12,
            external_tax_code_id: "sage-tax-12",
          },
        ],
      }) as never,
      sageRow,
      {
        accessToken: "token",
        realmId: null,
        providerEnvironment: "sandbox",
        sage: { create } as never,
      }
    );

    await service.write();

    expect(create).toHaveBeenCalledWith(
      "purchase_invoices",
      expect.objectContaining({
        invoice_lines: [
          expect.objectContaining({
            ledger_account_id: "sage-purchase-ledger-1",
            tax_rate_id: "sage-tax-12",
          }),
        ],
      }),
      expect.any(Object)
    );
  });
});
