import { describe, expect, it, vi } from "vitest";
import { AccountingSyncQueueService } from "../accounting-sync-queue-service";
import type { AccountingSyncQueueRow } from "../accounting-sync-queue-types";

function clientMock() {
  const rpc = vi.fn();
  const update = vi.fn();
  const eq = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => ({
    update: (patch: unknown) => {
      update(patch);
      return { eq };
    },
  }));

  return { rpc, from, update, eq };
}

function guardedClientMock(result: { data: { id: string } | null; error: unknown }) {
  const eq = vi.fn();
  const maybeSingle = vi.fn(() => Promise.resolve(result));
  const select = vi.fn(() => ({ maybeSingle }));
  const update = vi.fn(() => {
    const builder = { eq, select };
    eq.mockReturnValue(builder);
    return builder;
  });
  const from = vi.fn(() => ({ update }));

  return { from, update, eq, select, maybeSingle };
}

function queueRow(overrides: Partial<AccountingSyncQueueRow> = {}): AccountingSyncQueueRow {
  return {
    id: "q-1",
    companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
    connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
    provider: "quickbooks",
    entityType: "invoice",
    entityId: "2873266e-8d86-47e4-819b-7e570084f06f",
    externalId: null,
    operation: "update",
    sourceTable: "invoices",
    sourceAction: "update",
    sourceUpdatedAt: "2026-06-05T10:00:00.000Z",
    idempotencyKey: "invoice:2873266e-8d86-47e4-819b-7e570084f06f",
    status: "claimed",
    attempts: 2,
    maxAttempts: 5,
    runAfter: "2026-06-05T10:00:00.000Z",
    lockedAt: "2026-06-05T10:01:00.000Z",
    lockedBy: "worker-1",
    lastError: null,
    payloadSnapshot: {},
    createdAt: "2026-06-05T09:59:00.000Z",
    updatedAt: "2026-06-05T10:01:00.000Z",
    ...overrides,
  };
}

function queueDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "q-1",
    company_id: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
    connection_id: "91d98e28-36ec-4060-b047-3cb5cc342a12",
    provider: "quickbooks",
    entity_type: "invoice",
    entity_id: "2873266e-8d86-47e4-819b-7e570084f06f",
    external_id: null,
    operation: "update",
    source_table: "invoices",
    source_action: "update",
    source_updated_at: "2026-06-05T10:00:00.000Z",
    idempotency_key: "invoice:2873266e-8d86-47e4-819b-7e570084f06f",
    status: "pending",
    attempts: 2,
    max_attempts: 5,
    run_after: "2026-06-05T10:10:00.000Z",
    locked_at: null,
    locked_by: null,
    last_error: "rate limited",
    payload_snapshot: {},
    created_at: "2026-06-05T09:59:00.000Z",
    updated_at: "2026-06-05T10:01:00.000Z",
    ...overrides,
  };
}

describe("AccountingSyncQueueService", () => {
  it("claims due QuickBooks queue rows through the RPC and maps them to camelCase", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: [
        {
          id: "q-1",
          company_id: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
          connection_id: "91d98e28-36ec-4060-b047-3cb5cc342a12",
          provider: "quickbooks",
          entity_type: "invoice",
          entity_id: "2873266e-8d86-47e4-819b-7e570084f06f",
          external_id: "123",
          operation: "update",
          source_table: "invoices",
          source_action: "update",
          source_updated_at: "2026-06-05T10:00:00.000Z",
          idempotency_key: "invoice:2873266e-8d86-47e4-819b-7e570084f06f",
          status: "claimed",
          attempts: 1,
          max_attempts: 5,
          run_after: "2026-06-05T10:00:00.000Z",
          locked_at: "2026-06-05T10:01:00.000Z",
          locked_by: "w-1",
          last_error: null,
          payload_snapshot: { source: "trigger" },
          created_at: "2026-06-05T09:59:00.000Z",
          updated_at: "2026-06-05T10:01:00.000Z",
        },
      ],
      error: null,
    });
    const service = new AccountingSyncQueueService(db as never);

    const rows = await service.claimDue({ provider: "quickbooks", limit: 10, workerId: "w-1" });

    expect(db.rpc).toHaveBeenCalledWith("claim_accounting_sync_queue", {
      p_provider: "quickbooks",
      p_limit: 10,
      p_worker_id: "w-1",
    });
    expect(rows).toEqual([
      expect.objectContaining({
        id: "q-1",
        companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
        connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
        entityType: "invoice",
        entityId: "2873266e-8d86-47e4-819b-7e570084f06f",
        externalId: "123",
        sourceTable: "invoices",
        idempotencyKey: "invoice:2873266e-8d86-47e4-819b-7e570084f06f",
        maxAttempts: 5,
        lockedBy: "w-1",
        payloadSnapshot: { source: "trigger" },
      }),
    ]);
  });

  it("marks a row succeeded and clears lock fields", async () => {
    const db = guardedClientMock({ data: { id: "q-1" }, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await service.markSucceeded("q-1", { externalId: "123", workerId: "worker-1" });

    expect(db.from).toHaveBeenCalledWith("accounting_sync_queue");
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        external_id: "123",
        locked_at: null,
        locked_by: null,
        last_error: null,
      })
    );
    expect(db.eq).toHaveBeenCalledWith("id", "q-1");
    expect(db.eq).toHaveBeenCalledWith("status", "claimed");
    expect(db.eq).toHaveBeenCalledWith("locked_by", "worker-1");
  });

  it("marks a row succeeded without clearing an existing external id when omitted", async () => {
    const db = guardedClientMock({ data: { id: "q-1" }, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await service.markSucceeded("q-1", { workerId: "worker-1" });

    const updateCalls = db.update.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const patch = updateCalls[0][0];
    expect(patch).toEqual(
      expect.objectContaining({
        status: "succeeded",
        locked_at: null,
        locked_by: null,
        last_error: null,
      })
    );
    expect(patch).not.toHaveProperty("external_id");
    expect(db.eq).toHaveBeenCalledWith("status", "claimed");
    expect(db.eq).toHaveBeenCalledWith("locked_by", "worker-1");
  });

  it("schedules retry through the retry RPC with exponential backoff", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({ data: queueDbRow(), error: null });
    const service = new AccountingSyncQueueService(db as never);

    const result = await service.scheduleRetry(queueRow({ attempts: 2, maxAttempts: 5 }), "rate limited", {
      workerId: "worker-1",
    });

    expect(db.rpc).toHaveBeenCalledWith("retry_accounting_sync_queue", {
      p_queue_id: "q-1",
      p_worker_id: "worker-1",
      p_error: "rate limited",
      p_run_after: expect.any(String),
    });
    const args = db.rpc.mock.calls[0][1] as { p_run_after: string };
    expect(Date.parse(args.p_run_after)).toBeGreaterThan(Date.now());
    expect(result).toEqual(expect.objectContaining({ id: "q-1", status: "pending", lastError: "rate limited" }));
  });

  it("blocks a row when max attempts are exhausted", async () => {
    const db = guardedClientMock({ data: { id: "q-1" }, error: null });
    const service = new AccountingSyncQueueService(db as never);

    const result = await service.scheduleRetry(queueRow({ attempts: 5, maxAttempts: 5 }), "validation failed", {
      workerId: "worker-1",
    });

    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "blocked",
        last_error: "validation failed",
        locked_at: null,
        locked_by: null,
      })
    );
    expect(result).toBeNull();
    expect(db.eq).toHaveBeenCalledWith("status", "claimed");
    expect(db.eq).toHaveBeenCalledWith("locked_by", "worker-1");
  });

  it("maps retry RPC cancellation when an older claimed row is superseded by a newer pending row", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: queueDbRow({
        status: "cancelled",
        last_error: "rate limited; superseded by newer pending queue row q-2",
      }),
      error: null,
    });
    const service = new AccountingSyncQueueService(db as never);

    const result = await service.scheduleRetry(queueRow({ attempts: 2, maxAttempts: 5 }), "rate limited", {
      workerId: "worker-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "cancelled",
        lastError: "rate limited; superseded by newer pending queue row q-2",
      })
    );
  });

  it("marks a row blocked and clears lock fields", async () => {
    const db = guardedClientMock({ data: { id: "q-1" }, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await service.markBlocked("q-1", "missing customer link", { workerId: "worker-1" });

    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "blocked",
        last_error: "missing customer link",
        locked_at: null,
        locked_by: null,
      })
    );
    expect(db.eq).toHaveBeenCalledWith("status", "claimed");
    expect(db.eq).toHaveBeenCalledWith("locked_by", "worker-1");
  });

  it("marks a row as needing review and clears lock fields", async () => {
    const db = guardedClientMock({ data: { id: "q-1" }, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await service.markNeedsReview("q-1", "money conflict", { workerId: "worker-1" });

    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs_review",
        last_error: "money conflict",
        locked_at: null,
        locked_by: null,
      })
    );
    expect(db.eq).toHaveBeenCalledWith("status", "claimed");
    expect(db.eq).toHaveBeenCalledWith("locked_by", "worker-1");
  });

  it("guards worker-owned success updates by claimed status and lock owner", async () => {
    const db = guardedClientMock({ data: { id: "q-1" }, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await service.markSucceeded("q-1", { externalId: "123", workerId: "worker-1" });

    expect(db.eq).toHaveBeenCalledWith("id", "q-1");
    expect(db.eq).toHaveBeenCalledWith("status", "claimed");
    expect(db.eq).toHaveBeenCalledWith("locked_by", "worker-1");
    expect(db.select).toHaveBeenCalledWith("id");
    expect(db.maybeSingle).toHaveBeenCalled();
  });

  it("throws when a worker-owned update no-ops because the claim is stale", async () => {
    const db = guardedClientMock({ data: null, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await expect(service.markBlocked("q-1", "stale worker", { workerId: "worker-1" })).rejects.toThrow(
      "Accounting sync queue update lost ownership"
    );
  });

  it("throws when the retry RPC reports a stale claim/no-op", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({ data: null, error: null });
    const service = new AccountingSyncQueueService(db as never);

    await expect(
      service.scheduleRetry(queueRow({ lockedBy: "worker-1" }), "rate limited", { workerId: "worker-1" })
    ).rejects.toThrow("Accounting sync queue retry lost ownership");
  });
});
