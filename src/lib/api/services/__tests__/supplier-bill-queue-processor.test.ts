import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupplierBillQueueRow } from "../supplier-bill-queue-processor";

const {
  getValidToken,
  forceRefresh,
  disconnectGrant,
  createSageWriteClient,
  assertSageWriteAllowed,
  decryptToken,
  providerWrite,
} = vi.hoisted(() => ({
  getValidToken: vi.fn(),
  forceRefresh: vi.fn(),
  disconnectGrant: vi.fn(),
  createSageWriteClient: vi.fn(),
  assertSageWriteAllowed: vi.fn(),
  decryptToken: vi.fn(),
  providerWrite: vi.fn(),
}));

vi.mock("../accounting-token-service", () => ({
  AccountingTokenService: { getValidToken, forceRefresh, disconnectGrant },
  ReconnectRequiredError: class extends Error {},
}));
vi.mock("../sage-api-client", () => ({ createSageWriteClient }));
vi.mock("../sage-config", () => ({ assertSageWriteAllowed }));
vi.mock("../token-cipher", () => ({ decryptToken }));
vi.mock("../supplier-bill-provider-sync-service", () => ({
  SupplierBillProviderSyncService: vi.fn(() => ({ write: providerWrite })),
}));

import { AcceptedWriteDurabilityError } from "../sage-queue-processor";
import { processSupplierBillQueueRow } from "../supplier-bill-queue-processor";

const ROW: SupplierBillQueueRow = {
  id: "10000000-0000-4000-8000-000000000001",
  companyId: "20000000-0000-4000-8000-000000000001",
  connectionId: "30000000-0000-4000-8000-000000000001",
  provider: "sage",
  entityType: "supplier",
  entityId: "40000000-0000-4000-8000-000000000001",
  externalId: null,
  operation: "create",
  sourceTable: "suppliers",
  sourceAction: "insert",
  sourceUpdatedAt: "2026-09-04T08:00:00.000Z",
  idempotencyKey: "supplier:entity",
  status: "claimed",
  attempts: 1,
  maxAttempts: 5,
  runAfter: "2026-09-04T08:00:00.000Z",
  lockedAt: "2026-09-04T08:00:00.000Z",
  lockedBy: "sage-worker-1",
  providerRequestId: null,
  providerAcceptedAt: null,
  idempotencyExpiresAt: null,
  lastError: null,
  payloadSnapshot: { providerEnvironment: "sandbox" },
  createdAt: "2026-09-04T08:00:00.000Z",
  updatedAt: "2026-09-04T08:00:00.000Z",
};

function supabase(environment = "sandbox") {
  const maybeSingle = vi.fn(async () => ({
    data: {
      id: ROW.connectionId,
      company_id: ROW.companyId,
      provider: "sage",
      provider_environment: environment,
      is_connected: true,
      sync_enabled: true,
      sync_direction: "bidirectional",
      sage_business_id: "encrypted-business",
    },
    error: null,
  }));
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle,
  };
  return {
    from: vi.fn(() => builder),
    rpc: vi.fn(async () => ({ data: { status: "succeeded" }, error: null })),
  };
}

function ports() {
  return {
    queue: {
      recordProviderAcceptance: vi.fn(async () => ROW),
      markSucceeded: vi.fn(),
      scheduleRetry: vi.fn(),
      markBlocked: vi.fn(),
      markNeedsReview: vi.fn(),
    },
    audit: { record: vi.fn(async () => undefined) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getValidToken.mockResolvedValue({
    accessToken: "access",
    realmId: null,
    providerEnvironment: "sandbox",
  });
  decryptToken.mockReturnValue("sage-business-1");
  createSageWriteClient.mockReturnValue({ kind: "business-bound-client" });
  providerWrite.mockResolvedValue({
    externalId: "sage-supplier-1",
    syncToken: null,
    providerUpdatedAt: null,
    acceptedEvidence: {
      requestId: "sage-request-1",
      status: 201,
      acceptedAt: "2026-09-04T08:00:00.000Z",
    },
  });
});

describe("supplier bill Sage queue processing", () => {
  it("binds the exact business and persists acceptance before finalization", async () => {
    const db = supabase();
    const { queue, audit } = ports();

    const result = await processSupplierBillQueueRow({
      supabase: db as never,
      queue: queue as never,
      audit: audit as never,
      row: ROW,
      workerId: "sage-worker-1",
    });

    expect(assertSageWriteAllowed).toHaveBeenCalledWith({
      environment: "sandbox",
      businessId: "sage-business-1",
    });
    expect(createSageWriteClient).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "sage-business-1" })
    );
    expect(queue.recordProviderAcceptance).toHaveBeenCalledWith({
      id: ROW.id,
      workerId: "sage-worker-1",
      providerRequestId: "sage-request-1",
      acceptedAt: "2026-09-04T08:00:00.000Z",
      idempotencyExpiresAt: "2026-09-11T08:00:00.000Z",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "finalize_supplier_bill_provider_sync",
      {
        p_queue_id: ROW.id,
        p_worker_id: "sage-worker-1",
        p_external_id: "sage-supplier-1",
        p_sync_token: null,
        p_provider_updated_at: null,
      }
    );
    expect(result.status).toBe("succeeded");
  });

  it("rejects environment substitution before constructing the provider client", async () => {
    const db = supabase("production");
    const { queue, audit } = ports();

    const result = await processSupplierBillQueueRow({
      supabase: db as never,
      queue: queue as never,
      audit: audit as never,
      row: ROW,
      workerId: "sage-worker-1",
    });

    expect(result.status).toBe("needs_review");
    expect(createSageWriteClient).not.toHaveBeenCalled();
    expect(providerWrite).not.toHaveBeenCalled();
  });

  it("stops the batch when accepted evidence cannot be persisted", async () => {
    const db = supabase();
    const { queue, audit } = ports();
    queue.recordProviderAcceptance.mockRejectedValue(new Error("db pressure"));

    await expect(
      processSupplierBillQueueRow({
        supabase: db as never,
        queue: queue as never,
        audit: audit as never,
        row: ROW,
        workerId: "sage-worker-1",
      })
    ).rejects.toBeInstanceOf(AcceptedWriteDurabilityError);
    expect(queue.scheduleRetry).not.toHaveBeenCalled();
    expect(queue.markNeedsReview).not.toHaveBeenCalled();
  });
});
