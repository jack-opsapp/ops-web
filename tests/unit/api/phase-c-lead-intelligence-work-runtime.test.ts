import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshSummaryMock } = vi.hoisted(() => ({
  refreshSummaryMock: vi.fn(),
}));

vi.mock("@/lib/api/services/lead-summary-service", () => ({
  refreshLeadSummariesForOpportunities: refreshSummaryMock,
}));

import { createPhaseCLeadIntelligenceWorkService } from "@/lib/api/services/phase-c-lead-intelligence-work-runtime";

describe("Phase C lead-intelligence runtime database wiring", () => {
  beforeEach(() => {
    refreshSummaryMock.mockReset();
  });

  it("claims and acknowledges the exact event through the production RPC adapter", async () => {
    refreshSummaryMock.mockResolvedValue({
      requested: 1,
      attempted: 0,
      written: 0,
      skippedFeatureDisabled: true,
      failed: [],
      deferred: [],
      remainingOpportunityIds: ["opportunity-1"],
    });
    const acknowledgements = new Set<string>();
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_opportunity_phase_c_work") {
        return {
          data: [
            {
              company_id: "company-1",
              opportunity_id: "opportunity-1",
              required_event_id: "event-1",
              required_event_at: "2026-08-20T15:00:00.000Z",
              required_activity_id: "activity-1",
              required_connection_id: "connection-1",
              required_provider_thread_id: "thread-1",
              attempt_count: 1,
              component_outcomes: {},
              component_errors: {},
            },
          ],
          error: null,
        };
      }
      if (name === "acknowledge_opportunity_phase_c_component") {
        expect(args.p_expected_required_event_id).toBe("event-1");
        acknowledgements.add(args.p_component as string);
        return {
          data: acknowledgements.size === 4 ? "completed" : "acknowledged",
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const supabase = {
      rpc,
      from: vi.fn(() => {
        throw new Error("Disabled Phase C must not load lifecycle context");
      }),
    };

    const result = await createPhaseCLeadIntelligenceWorkService({
      supabase,
    }).runWorker({ limit: 2, leaseSeconds: 300 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, retrying: 0 });
    expect(refreshSummaryMock).toHaveBeenCalledWith({
      supabase,
      companyId: "company-1",
      opportunityIds: ["opportunity-1"],
    });
    expect(acknowledgements).toEqual(
      new Set(["summary", "lifecycle", "commercial", "event_handoff"])
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "fail_opportunity_phase_c_work",
      expect.anything()
    );
  });
});
