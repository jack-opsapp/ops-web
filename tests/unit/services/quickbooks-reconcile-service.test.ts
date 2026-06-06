import { describe, expect, it, vi } from "vitest";

import { QuickBooksReconcileService } from "@/lib/api/services/quickbooks-reconcile-service";

const BASE_INPUT = {
  companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
  connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
  entityType: "invoice" as const,
  entityId: "d9f024cf-f8b0-4e0c-9930-459e3b49660b",
  externalId: "123",
};

describe("QuickBooksReconcileService", () => {
  it("enqueues OPS -> QB and audits when OPS is newer", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const audit = { record: vi.fn().mockResolvedValue("evt-1") };
    const service = new QuickBooksReconcileService({ enqueue, audit });

    const result = await service.reconcileLinkedRecord({
      ...BASE_INPUT,
      opsUpdatedAt: "2026-06-05T10:03:00Z",
      qbUpdatedAt: "2026-06-05T10:01:00Z",
      materialDiff: true,
    });

    expect(result).toEqual(
      expect.objectContaining({ decision: "ops_won", status: "succeeded", enqueued: true }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "invoice", operation: "update" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "reconcile",
        source: "reconcile",
        operation: "reconcile",
        status: "succeeded",
        decision: "ops_won",
      }),
    );
  });

  it("audits QB wins without enqueueing outbound work", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const audit = { record: vi.fn().mockResolvedValue("evt-1") };
    const service = new QuickBooksReconcileService({ enqueue, audit });

    const result = await service.reconcileLinkedRecord({
      ...BASE_INPUT,
      opsUpdatedAt: "2026-06-05T10:01:00Z",
      qbUpdatedAt: "2026-06-05T10:03:00Z",
      materialDiff: true,
    });

    expect(result).toEqual(
      expect.objectContaining({ decision: "qb_won", status: "succeeded", enqueued: false }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "reconcile", status: "succeeded", decision: "qb_won" }),
    );
  });

  it("audits skipped records as skipped", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const audit = { record: vi.fn().mockResolvedValue("evt-1") };
    const service = new QuickBooksReconcileService({ enqueue, audit });

    const result = await service.reconcileLinkedRecord({
      ...BASE_INPUT,
      opsUpdatedAt: "2026-06-05T10:01:00Z",
      qbUpdatedAt: "2026-06-05T10:03:00Z",
      materialDiff: false,
    });

    expect(result).toEqual(
      expect.objectContaining({ decision: "skipped", status: "skipped", enqueued: false }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", decision: "skipped" }),
    );
  });

  it("audits missing timestamps as needs_review", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const audit = { record: vi.fn().mockResolvedValue("evt-1") };
    const service = new QuickBooksReconcileService({ enqueue, audit });

    const result = await service.reconcileLinkedRecord({
      ...BASE_INPUT,
      opsUpdatedAt: "2026-06-05T10:01:00Z",
      qbUpdatedAt: null,
      materialDiff: true,
      moneyTouched: true,
    });

    expect(result).toEqual(
      expect.objectContaining({ decision: "needs_review", status: "needs_review", enqueued: false }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs_review",
        decision: "needs_review",
        error: "missing timestamp",
      }),
    );
  });
});
