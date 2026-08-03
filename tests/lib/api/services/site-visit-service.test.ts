import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock, createActivityMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
  createActivityMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
  parseDateRequired: (value: unknown) => new Date(value as string),
}));

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: { createActivity: createActivityMock },
}));

import { SiteVisitService } from "@/lib/api/services/site-visit-service";

const VISIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPPORTUNITY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const completedVisit = {
  id: VISIT_ID,
  company_id: COMPANY_ID,
  opportunity_id: OPPORTUNITY_ID,
  project_id: null,
  client_id: null,
  scheduled_at: "2026-07-31T20:00:00.000Z",
  duration_minutes: 60,
  assignee_ids: [],
  status: "completed",
  completed_at: "2026-07-31T21:00:00.000Z",
  notes: "Rear ledger needs replacement",
  internal_notes: null,
  measurements: null,
  photos: [],
  activity_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  calendar_event_id: null,
  created_by: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  created_at: "2026-07-31T19:00:00.000Z",
  updated_at: "2026-07-31T21:00:00.000Z",
  deleted_at: null,
};

beforeEach(() => {
  requireSupabaseMock.mockReset();
  createActivityMock.mockReset();
});

describe("SiteVisitService.completeSiteVisit", () => {
  it("uses the shared guarded transaction instead of split client writes", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        visit: completedVisit,
        activity_id: completedVisit.activity_id,
      },
      error: null,
    });
    const from = vi.fn(() => {
      throw new Error("completion must not write tables directly");
    });
    requireSupabaseMock.mockReturnValue({ rpc, from });

    const result = await SiteVisitService.completeSiteVisit(VISIT_ID, {
      notes: "Rear ledger needs replacement",
      measurements: "142 in",
      photos: ["https://cdn.example/visit/photo.jpg"],
      internalNotes: "Confirm bearing detail",
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("complete_site_visit_guarded", {
      p_site_visit_id: VISIT_ID,
      p_completion: {
        notes: "Rear ledger needs replacement",
        measurements: "142 in",
        photos: ["https://cdn.example/visit/photo.jpg"],
        internal_notes: "Confirm bearing detail",
      },
    });
    expect(from).not.toHaveBeenCalled();
    expect(createActivityMock).not.toHaveBeenCalled();
    expect(result.id).toBe(VISIT_ID);
    expect(result.activityId).toBe(completedVisit.activity_id);
    expect(result.completedAt?.toISOString()).toBe(completedVisit.completed_at);
  });

  it("surfaces a failed transaction instead of reporting a completed visit", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "cannot_complete_cancelled_site_visit" },
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    await expect(
      SiteVisitService.completeSiteVisit(VISIT_ID, {})
    ).rejects.toThrow("cannot_complete_cancelled_site_visit");
    expect(createActivityMock).not.toHaveBeenCalled();
  });
});
