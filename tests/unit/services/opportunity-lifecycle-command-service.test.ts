import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
  parseDateRequired: (value: unknown) => new Date(value as string),
}));

import { OpportunityService } from "@/lib/api/services/opportunity-service";
import { OpportunityStage } from "@/lib/types/pipeline";

const opportunityRow = {
  id: "opp-1",
  company_id: "co-1",
  client_id: null,
  title: "Website inquiry",
  description: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  stage: "qualifying",
  source: "website",
  assigned_to: null,
  assignment_version: 0,
  priority: null,
  estimated_value: null,
  actual_value: null,
  win_probability: 20,
  expected_close_date: null,
  actual_close_date: null,
  stage_entered_at: "2026-07-27T10:00:00.000Z",
  project_id: null,
  lost_reason: null,
  lost_notes: null,
  source_email_id: null,
  correspondence_count: 0,
  outbound_count: 0,
  inbound_count: 0,
  last_inbound_at: null,
  last_outbound_at: null,
  last_message_direction: null,
  handled_at: null,
  operator_action_required_at: null,
  ai_summary: null,
  ai_summary_updated_at: null,
  ai_stage_confidence: null,
  ai_stage_signals: null,
  detected_value: null,
  quote_delivery_method: null,
  address: null,
  latitude: null,
  longitude: null,
  last_activity_at: null,
  next_follow_up_at: null,
  tags: [],
  images: [],
  created_at: "2026-07-27T09:00:00.000Z",
  updated_at: "2026-07-27T10:00:00.000Z",
  deleted_at: null,
  archived_at: null,
};

describe("OpportunityService lifecycle commands", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    requireSupabaseMock.mockReset();
    requireSupabaseMock.mockReturnValue({ rpc });
  });

  it("moves a stage through the atomic database command", async () => {
    rpc.mockResolvedValue({ data: opportunityRow, error: null });

    const result = await OpportunityService.moveOpportunityStage(
      "opp-1",
      OpportunityStage.Qualifying,
      "user-1"
    );

    expect(rpc).toHaveBeenCalledWith("move_opportunity_stage", {
      p_opportunity_id: "opp-1",
      p_to_stage: "qualifying",
      p_user_id: "user-1",
    });
    expect(result.stage).toBe(OpportunityStage.Qualifying);
  });

  it.each(["archive", "unarchive", "delete"] as const)(
    "routes %s through the guarded lifecycle command",
    async (action) => {
      rpc.mockResolvedValue({ data: opportunityRow, error: null });

      if (action === "archive") {
        await OpportunityService.archiveOpportunity("opp-1");
      } else if (action === "unarchive") {
        await OpportunityService.unarchiveOpportunity("opp-1");
      } else {
        await OpportunityService.deleteOpportunity("opp-1");
      }

      expect(rpc).toHaveBeenCalledWith("mutate_opportunity_lifecycle", {
        p_opportunity_id: "opp-1",
        p_action: action,
        p_actor_user_id: null,
        p_company_id: null,
      });
    }
  );

  it("rejects lifecycle fields at the generic update seam", async () => {
    await expect(
      OpportunityService.updateOpportunity("opp-1", {
        stage: OpportunityStage.Won,
      })
    ).rejects.toThrow("Opportunity lifecycle fields require guarded commands");
    expect(rpc).not.toHaveBeenCalled();
  });
});
