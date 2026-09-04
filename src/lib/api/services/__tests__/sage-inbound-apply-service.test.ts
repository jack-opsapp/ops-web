import { describe, expect, it, vi } from "vitest";

import { SageInboundApplyService } from "../sage-inbound-apply-service";
import type { SageReconcileCandidate } from "../sage-reconcile-service";

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
  latestAudit: null,
};

describe("SageInboundApplyService", () => {
  it("passes every observed identity and version to the atomic RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ops_updated_at: "2026-09-04T08:06:00.000Z" }],
      error: null,
    }));
    const service = new SageInboundApplyService({ rpc } as never);
    const provider = {
      externalId: candidate.externalId,
      updatedAt: "2026-09-04T08:05:00.000Z",
      deletedAt: null,
      payload: { total: 100, lines: [{ description: "Work" }] },
    };

    await expect(service.apply(candidate, provider)).resolves.toEqual({
      opsUpdatedAt: "2026-09-04T08:06:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("apply_sage_reconcile_entity", {
      p_company_id: candidate.companyId,
      p_connection_id: candidate.connectionId,
      p_entity_type: "invoice",
      p_entity_id: candidate.entityId,
      p_external_id: candidate.externalId,
      p_expected_ops_updated_at: candidate.opsUpdatedAt,
      p_provider_updated_at: provider.updatedAt,
      p_deleted_at: null,
      p_payload: provider.payload,
    });
  });

  it("turns a proven 404 into an observed tombstone without inventing payload", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ops_updated_at: "2026-09-04T08:10:00.000Z" }],
      error: null,
    }));
    const service = new SageInboundApplyService(
      { rpc } as never,
      () => new Date("2026-09-04T08:10:00.000Z")
    );

    await service.apply(candidate, null);

    expect(rpc).toHaveBeenCalledWith(
      "apply_sage_reconcile_entity",
      expect.objectContaining({
        p_provider_updated_at: "2026-09-04T08:10:00.000Z",
        p_deleted_at: "2026-09-04T08:10:00.000Z",
        p_payload: {},
      })
    );
  });

  it("rejects a provider identity mismatch before the database call", async () => {
    const rpc = vi.fn();
    const service = new SageInboundApplyService({ rpc } as never);

    await expect(
      service.apply(candidate, {
        externalId: "different",
        updatedAt: "2026-09-04T08:05:00.000Z",
        deletedAt: null,
        payload: {},
      })
    ).rejects.toThrow("identity changed");
    expect(rpc).not.toHaveBeenCalled();
  });
});
