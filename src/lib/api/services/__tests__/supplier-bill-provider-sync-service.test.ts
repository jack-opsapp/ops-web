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
});
