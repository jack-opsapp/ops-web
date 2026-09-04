import { beforeEach, describe, expect, it, vi } from "vitest";

import { SageApiError, type SageWriteClient } from "../sage-api-client";
import type { AccountingSyncQueueRow } from "../accounting-sync-queue-types";
import {
  AcceptedWriteDurabilityError,
  processSageQueueRow,
  type SageQueueProcessorDependencies,
} from "../sage-queue-processor";

const QUEUE_ID = "10000000-0000-4000-8000-000000000001";
const NOW = "2026-09-04T08:00:00.000Z";

function row(
  overrides: Partial<AccountingSyncQueueRow> = {}
): AccountingSyncQueueRow {
  return {
    id: QUEUE_ID,
    companyId: "20000000-0000-4000-8000-000000000001",
    connectionId: "30000000-0000-4000-8000-000000000001",
    provider: "sage",
    entityType: "invoice",
    entityId: "40000000-0000-4000-8000-000000000001",
    externalId: null,
    operation: "create",
    sourceTable: "invoices",
    sourceAction: "insert",
    sourceUpdatedAt: NOW,
    idempotencyKey: "invoice:40000000-0000-4000-8000-000000000001",
    status: "claimed",
    attempts: 1,
    maxAttempts: 5,
    runAfter: NOW,
    lockedAt: NOW,
    lockedBy: "sage-worker-1",
    providerRequestId: null,
    providerAcceptedAt: null,
    idempotencyExpiresAt: null,
    lastError: null,
    payloadSnapshot: {
      providerEnvironment: "sandbox" as const,
      parentExternalId: "sage-contact-1",
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function dependencies() {
  const calls: string[] = [];
  const client = {
    create: vi.fn(async () => {
      calls.push("provider");
      return {
        data: { id: "sage-invoice-1" },
        evidence: {
          requestId: "sage-request-1",
          status: 201,
          acceptedAt: NOW,
        },
      };
    }),
    update: vi.fn(),
    voidOrDelete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  };
  const deps: SageQueueProcessorDependencies = {
    loadConnection: vi.fn(async () => ({
      id: "30000000-0000-4000-8000-000000000001",
      companyId: "20000000-0000-4000-8000-000000000001",
      provider: "sage",
      providerEnvironment: "sandbox" as const,
      isConnected: true,
      syncEnabled: true,
      syncDirection: "bidirectional",
      encryptedBusinessId: "encrypted-business",
    })),
    decryptBusinessId: vi.fn(() => "sage-business-1"),
    assertWriteAllowed: vi.fn(),
    getValidToken: vi.fn(async () => ({
      accessToken: "access-1",
      providerEnvironment: "sandbox" as const,
    })),
    refreshAccessToken: vi.fn(async () => "access-2"),
    disconnect: vi.fn(async () => undefined),
    prepare: vi.fn(async () => ({
      resource: "sales_invoices" as const,
      payload: { contact_id: "sage-contact-1", invoice_lines: [] },
      externalId: null,
      finalize: vi.fn(async () => {
        calls.push("finalize");
      }),
    })),
    createClient: vi.fn(() => client as unknown as SageWriteClient),
    queue: {
      recordProviderAcceptance: vi.fn(async () => {
        calls.push("acceptance");
        return row({
          providerRequestId: "sage-request-1",
          providerAcceptedAt: NOW,
          idempotencyExpiresAt: "2026-09-11T08:00:00.000Z",
        });
      }),
      markSucceeded: vi.fn(async () => {
        calls.push("succeeded");
      }),
      scheduleRetry: vi.fn(async () =>
        row({ status: "pending" })
      ) as SageQueueProcessorDependencies["queue"]["scheduleRetry"],
      markBlocked: vi.fn(async () => undefined),
      markNeedsReview: vi.fn(async () => undefined),
    },
    recordAudit: vi.fn(async () => undefined),
    now: () => new Date(NOW),
  };
  return { deps, client, calls };
}

describe("Sage queue processor", () => {
  beforeEach(() => {
    process.env.QB_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("proves the exact environment and business before a provider write", async () => {
    const { deps, client } = dependencies();

    const result = await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(deps.assertWriteAllowed).toHaveBeenCalledWith({
      environment: "sandbox",
      businessId: "sage-business-1",
    });
    expect(deps.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "sage-business-1" })
    );
    expect(client.create).toHaveBeenCalledWith(
      "sales_invoices",
      expect.objectContaining({ contact_id: "sage-contact-1" }),
      expect.objectContaining({
        resource: "sales_invoices",
        id: expect.stringMatching(/^[a-f0-9]{32}$/),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "succeeded",
        externalId: "sage-invoice-1",
      })
    );
  });

  it("persists provider acceptance before local identity and queue finalization", async () => {
    const { deps, calls } = dependencies();

    await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(calls).toEqual(["provider", "acceptance", "finalize", "succeeded"]);
    expect(deps.queue.recordProviderAcceptance).toHaveBeenCalledWith({
      id: QUEUE_ID,
      workerId: "sage-worker-1",
      providerRequestId: "sage-request-1",
      acceptedAt: NOW,
      idempotencyExpiresAt: "2026-09-11T08:00:00.000Z",
    });
  });

  it.each([
    ["provider", row({ provider: "quickbooks" })],
    ["claim owner", row({ lockedBy: "other-worker" })],
    ["claim state", row({ status: "pending" })],
  ])(
    "rejects a mismatched %s before loading connection state",
    async (_label, queueRow) => {
      const { deps } = dependencies();

      await expect(
        processSageQueueRow({
          row: queueRow,
          workerId: "sage-worker-1",
          dependencies: deps,
        })
      ).rejects.toThrow();
      expect(deps.loadConnection).not.toHaveBeenCalled();
    }
  );

  it("rejects environment substitution before token or provider access", async () => {
    const { deps } = dependencies();
    const loaded = await vi.mocked(deps.loadConnection)(row());
    if (!loaded) throw new Error("expected a connection fixture");
    vi.mocked(deps.loadConnection).mockResolvedValue({
      ...loaded,
      providerEnvironment: "production",
    });
    vi.mocked(deps.loadConnection).mockClear();

    const result = await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(result.status).toBe("needs_review");
    expect(deps.getValidToken).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("schedules a bounded retry after a provider 429", async () => {
    const { deps, client } = dependencies();
    client.create.mockRejectedValue(
      new SageApiError(
        "Sage API request failed (HTTP 429)",
        "rate_limited",
        429,
        true,
        1_000
      )
    );

    const result = await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(result.status).toBe("retry");
    expect(deps.queue.scheduleRetry).toHaveBeenCalledOnce();
    expect(deps.queue.markNeedsReview).not.toHaveBeenCalled();
  });

  it("does not retry terminal provider validation or reconnect failures", async () => {
    const validation = dependencies();
    validation.client.create.mockRejectedValue(
      new SageApiError(
        "Sage API request failed (HTTP 422)",
        "validation_failed",
        422
      )
    );
    const validationResult = await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: validation.deps,
    });
    expect(validationResult.status).toBe("needs_review");
    expect(validation.deps.queue.scheduleRetry).not.toHaveBeenCalled();

    const revoked = dependencies();
    revoked.client.create.mockRejectedValue(
      new SageApiError(
        "Sage API request failed (HTTP 403)",
        "reconnect_required",
        403
      )
    );
    const revokedResult = await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: revoked.deps,
    });
    expect(revokedResult.status).toBe("needs_review");
  });

  it("quarantines accepted writes when local finalization fails", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.prepare).mockResolvedValue({
      resource: "sales_invoices",
      payload: { contact_id: "sage-contact-1" },
      externalId: null,
      finalize: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    const result = await processSageQueueRow({
      row: row(),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(result.status).toBe("needs_review");
    expect(deps.queue.markNeedsReview).toHaveBeenCalledWith(
      QUEUE_ID,
      expect.stringContaining("finalization failed"),
      { workerId: "sage-worker-1", externalId: "sage-invoice-1" }
    );
    expect(deps.queue.scheduleRetry).not.toHaveBeenCalled();
  });

  it("stops the batch if acceptance evidence cannot be made durable", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.queue.recordProviderAcceptance).mockRejectedValue(
      new Error("database pressure")
    );

    await expect(
      processSageQueueRow({
        row: row(),
        workerId: "sage-worker-1",
        dependencies: deps,
      })
    ).rejects.toBeInstanceOf(AcceptedWriteDurabilityError);
    expect(deps.queue.scheduleRetry).not.toHaveBeenCalled();
    expect(deps.queue.markNeedsReview).not.toHaveBeenCalled();
  });

  it("blocks an ambiguous replay after the seven-day idempotency window", async () => {
    const { deps } = dependencies();
    const result = await processSageQueueRow({
      row: row({
        attempts: 2,
        createdAt: "2026-08-20T08:00:00.000Z",
      }),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(result.status).toBe("needs_review");
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("rejects unsupported outbound operations before provider access", async () => {
    const { deps } = dependencies();
    const result = await processSageQueueRow({
      row: row({ operation: "reconcile" }),
      workerId: "sage-worker-1",
      dependencies: deps,
    });

    expect(result.status).toBe("needs_review");
    expect(deps.createClient).not.toHaveBeenCalled();
  });
});
