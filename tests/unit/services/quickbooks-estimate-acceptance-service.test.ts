import { describe, expect, it, vi } from "vitest";

import { QuickBooksEstimateAcceptanceService } from "@/lib/api/services/quickbooks-estimate-acceptance-service";

describe("QuickBooksEstimateAcceptanceService", () => {
  it("calls the service-role bridge when a QBO estimate is accepted", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "succeeded",
        estimate_id: "est-1",
        project_id: "proj-1",
        opportunity_id: "opp-1",
        project_task_result: { project_task_count: 2 },
        booking_projection_result: {
          booking_persistence_performed: true,
          demand_ids: ["demand-1"],
        },
      },
      error: null,
    });
    const service = new QuickBooksEstimateAcceptanceService({ rpc });

    const result = await service.acceptFromQuickBooks({
      companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      estimateId: "est-1",
      qbEstimateId: "99",
      qbUpdatedAt: "2026-06-05T11:00:00Z",
    });

    expect(rpc).toHaveBeenCalledWith("accept_estimate_to_job_from_quickbooks", {
      p_company_id: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      p_connection_id: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      p_estimate_id: "est-1",
      p_qb_estimate_id: "99",
      p_idempotency_key:
        "qbo:estimate:accepted:91d98e28-36ec-4060-b047-3cb5cc342a12:99",
    });
    expect(result.status).toBe("succeeded");
    expect(result.project_id).toBe("proj-1");
  });

  it("returns needs_review without throwing when the bridge cannot prove actor or linkage", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "needs_review", reason: "integration_acceptance_actor_not_found" },
      error: null,
    });
    const service = new QuickBooksEstimateAcceptanceService({ rpc });

    await expect(
      service.acceptFromQuickBooks({
        companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
        connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
        estimateId: "est-1",
        qbEstimateId: "99",
        qbUpdatedAt: null,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "needs_review",
        reason: "integration_acceptance_actor_not_found",
      })
    );
  });

  it("throws on RPC errors so webhook apply records an error audit", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function missing" },
    });
    const service = new QuickBooksEstimateAcceptanceService({ rpc });

    await expect(
      service.acceptFromQuickBooks({
        companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
        connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
        estimateId: "est-1",
        qbEstimateId: "99",
        qbUpdatedAt: null,
      })
    ).rejects.toThrow("QuickBooks estimate acceptance bridge failed: function missing");
  });
});
