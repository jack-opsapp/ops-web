import { describe, expect, it, vi } from "vitest";

import type { NormalizedSageRecord } from "../sage-normalize";
import {
  SageReconcileService,
  type SageReconcileCandidate,
} from "../sage-reconcile-service";

const candidate: SageReconcileCandidate = {
  companyId: "20000000-0000-4000-8000-000000000001",
  connectionId: "30000000-0000-4000-8000-000000000001",
  entityType: "invoice",
  entityId: "40000000-0000-4000-8000-000000000001",
  externalId: "sage-invoice-1",
  resource: "sales_invoices",
  opsUpdatedAt: "2026-09-04T08:00:00.000Z",
  moneyTouched: true,
  syncDirection: "bidirectional",
  propagateDeletes: true,
  latestAudit: {
    opsUpdatedAt: "2026-09-04T08:00:00.000Z",
    sageUpdatedAt: "2026-09-04T08:00:00.000Z",
  },
};

function provider(
  updatedAt = "2026-09-04T08:05:00.000Z"
): NormalizedSageRecord {
  return {
    externalId: candidate.externalId,
    updatedAt,
    deletedAt: null,
    payload: { total: 100, lines: [{ description: "Work" }] },
  };
}

function ports() {
  return {
    audit: { record: vi.fn(async () => "audit-1") },
    enqueue: vi.fn(async () => undefined),
    applyInbound: vi.fn(async () => ({
      opsUpdatedAt: "2026-09-04T08:06:00.000Z",
    })),
  };
}

describe("SageReconcileService", () => {
  it("applies a Sage-only change and audits the post-apply OPS timestamp", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);

    const result = await service.reconcile({
      candidate,
      provider: provider(),
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result).toEqual(
      expect.objectContaining({ decision: "sage_won", applied: true })
    );
    expect(dependencies.enqueue).not.toHaveBeenCalled();
    expect(dependencies.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "sage_won",
        opsUpdatedAt: "2026-09-04T08:06:00.000Z",
        qbUpdatedAt: "2026-09-04T08:05:00.000Z",
      })
    );
  });

  it("enqueues an OPS-only change when both write gates are open", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);
    const result = await service.reconcile({
      candidate: {
        ...candidate,
        opsUpdatedAt: "2026-09-04T08:05:00.000Z",
      },
      provider: provider("2026-09-04T08:00:00.000Z"),
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result).toEqual(
      expect.objectContaining({ decision: "ops_won", enqueued: true })
    );
    expect(dependencies.enqueue).toHaveBeenCalledOnce();
    expect(dependencies.applyInbound).not.toHaveBeenCalled();
  });

  it("quarantines an OPS win when the connection is read-only", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);
    const result = await service.reconcile({
      candidate: {
        ...candidate,
        syncDirection: "pull_only",
        opsUpdatedAt: "2026-09-04T08:05:00.000Z",
      },
      provider: provider("2026-09-04T08:00:00.000Z"),
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result.decision).toBe("needs_review");
    expect(dependencies.enqueue).not.toHaveBeenCalled();
  });

  it("quarantines simultaneous financial edits", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);
    const result = await service.reconcile({
      candidate: {
        ...candidate,
        opsUpdatedAt: "2026-09-04T08:04:00.000Z",
      },
      provider: provider(),
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result.decision).toBe("needs_review");
    expect(dependencies.enqueue).not.toHaveBeenCalled();
    expect(dependencies.applyInbound).not.toHaveBeenCalled();
  });

  it("applies a proven Sage tombstone only when propagation is enabled", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);
    const result = await service.reconcile({
      candidate,
      provider: null,
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result.decision).toBe("sage_won");
    expect(dependencies.applyInbound).toHaveBeenCalledWith(candidate, null);
  });

  it("quarantines a missing record without prior tombstone evidence", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);
    const result = await service.reconcile({
      candidate: { ...candidate, latestAudit: null },
      provider: null,
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result.decision).toBe("needs_review");
    expect(dependencies.applyInbound).not.toHaveBeenCalled();
  });

  it("never auto-deletes an accounts-payable record from a Sage tombstone", async () => {
    const dependencies = ports();
    const service = new SageReconcileService(dependencies);
    const result = await service.reconcile({
      candidate: {
        ...candidate,
        entityType: "supplier_bill",
        resource: "purchase_invoices",
      },
      provider: null,
      materialDiff: true,
      providerWritesEnabled: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        decision: "needs_review",
        reason: expect.stringContaining("accounts-payable"),
      })
    );
    expect(dependencies.applyInbound).not.toHaveBeenCalled();
  });
});
