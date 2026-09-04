import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountingSyncQueueRow } from "@/lib/api/services/accounting-sync-queue-types";

const {
  claimDue,
  processSage,
  processSupplier,
  getServiceRoleClient,
  MockAcceptedWriteDurabilityError,
} = vi.hoisted(() => ({
  claimDue: vi.fn(),
  processSage: vi.fn(),
  processSupplier: vi.fn(),
  getServiceRoleClient: vi.fn(() => ({ kind: "service-role" })),
  MockAcceptedWriteDurabilityError: class extends Error {},
}));

vi.mock("@/lib/supabase/server-client", () => ({ getServiceRoleClient }));
vi.mock("@/lib/api/services/accounting-sync-queue-service", () => ({
  AccountingSyncQueueService: vi.fn(() => ({ claimDue })),
}));
vi.mock("@/lib/api/services/accounting-sync-audit-service", () => ({
  AccountingSyncAuditService: vi.fn(() => ({ record: vi.fn() })),
}));
vi.mock("@/lib/api/services/sage-queue-processor", () => ({
  AcceptedWriteDurabilityError: MockAcceptedWriteDurabilityError,
  createSageQueueProcessorDependencies: vi.fn(() => ({ kind: "deps" })),
  processSageQueueRow: processSage,
}));
vi.mock("@/lib/api/services/supplier-bill-queue-processor", () => ({
  isSupplierBillQueueEntity: (entity: string) =>
    ["supplier", "supplier_bill", "supplier_bill_payment"].includes(entity),
  processSupplierBillQueueRow: processSupplier,
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  isDatabasePressureError: () => false,
  runWithCronWorkloadControl: vi.fn(
    async ({ work }: { work: () => Promise<unknown> }) => ({
      status: "completed",
      value: await work(),
    })
  ),
}));

import { GET, POST } from "@/app/api/cron/accounting/sage/push-queue/route";

function queueRow(
  id: string,
  entityType: AccountingSyncQueueRow["entityType"]
): AccountingSyncQueueRow {
  return {
    id,
    companyId: "20000000-0000-4000-8000-000000000001",
    connectionId: "30000000-0000-4000-8000-000000000001",
    provider: "sage",
    entityType,
    entityId: "40000000-0000-4000-8000-000000000001",
    externalId: null,
    operation: "create",
    sourceTable: entityType === "supplier" ? "suppliers" : "invoices",
    sourceAction: "insert",
    sourceUpdatedAt: "2026-09-04T08:00:00.000Z",
    idempotencyKey: `${entityType}:entity`,
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
  };
}

function request(method: "GET" | "POST" = "POST", token = "cron-secret") {
  return new Request("https://ops.test/api/cron/accounting/sage/push-queue", {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  process.env.ACCOUNTING_WRITE_ENABLED = "true";
  process.env.SAGE_WRITE_ENABLED = "true";
  claimDue.mockResolvedValue([]);
  processSage.mockImplementation(
    async ({ row }: { row: AccountingSyncQueueRow }) => ({
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: "succeeded",
    })
  );
  processSupplier.mockImplementation(
    async ({ row }: { row: AccountingSyncQueueRow }) => ({
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: "succeeded",
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sage push queue route", () => {
  it("rejects unauthorized callers before opening a service client", async () => {
    const response = await POST(request("POST", "wrong"));
    expect(response.status).toBe(401);
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each(["ACCOUNTING_WRITE_ENABLED", "SAGE_WRITE_ENABLED"])(
    "fails closed when %s is not enabled",
    async (gate) => {
      vi.stubEnv(gate, "false");
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual(
        expect.objectContaining({ code: "SAGE_WRITE_DISABLED" })
      );
      expect(claimDue).not.toHaveBeenCalled();
    }
  );

  it("claims one fair Sage batch and processes every write sequentially", async () => {
    const core = queueRow("10000000-0000-4000-8000-000000000001", "invoice");
    const supplier = queueRow(
      "10000000-0000-4000-8000-000000000002",
      "supplier"
    );
    claimDue.mockResolvedValue([core, supplier]);
    const order: string[] = [];
    processSage.mockImplementation(async () => {
      order.push("core-start");
      await Promise.resolve();
      order.push("core-end");
      return {
        queueId: core.id,
        entityType: "invoice",
        entityId: core.entityId,
        status: "succeeded",
      };
    });
    processSupplier.mockImplementation(async () => {
      order.push("supplier-start");
      order.push("supplier-end");
      return {
        queueId: supplier.id,
        entityType: "supplier",
        entityId: supplier.entityId,
        status: "succeeded",
      };
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(claimDue).toHaveBeenCalledWith({
      provider: "sage",
      limit: 5,
      workerId: expect.stringMatching(/^sage-push-/),
    });
    expect(order).toEqual([
      "core-start",
      "core-end",
      "supplier-start",
      "supplier-end",
    ]);
    expect(body).toEqual(
      expect.objectContaining({ processed: 2, succeeded: 2 })
    );
  });

  it("stops the batch immediately after uncertain acceptance durability", async () => {
    const first = queueRow("10000000-0000-4000-8000-000000000001", "invoice");
    const second = queueRow("10000000-0000-4000-8000-000000000002", "customer");
    claimDue.mockResolvedValue([first, second]);
    processSage.mockRejectedValueOnce(
      new MockAcceptedWriteDurabilityError("acceptance persistence failed")
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(processSage).toHaveBeenCalledTimes(1);
    expect((await response.json()).error).toContain(
      "acceptance persistence failed"
    );
  });

  it("supports Vercel cron GET through the same guarded worker", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(claimDue).toHaveBeenCalledOnce();
  });
});
