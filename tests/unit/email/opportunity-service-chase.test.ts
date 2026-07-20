import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
  parseDate: (value: unknown) => (value ? new Date(String(value)) : null),
  parseDateRequired: (value: unknown) => new Date(String(value)),
}));

import { OpportunityService } from "@/lib/api/services/opportunity-service";

function makeUpdateSupabase() {
  const updatePayloads: Array<Record<string, unknown>> = [];
  const query = {
    update(payload: Record<string, unknown>) {
      updatePayloads.push(payload);
      return query;
    },
    eq() {
      return query;
    },
    select() {
      return query;
    },
    async single() {
      return {
        data: {
          id: "opp-1",
          company_id: "company-1",
          title: "Deck rebuild",
          stage: "quoted",
          handled_at: "2026-07-19T12:00:00.000Z",
          next_follow_up_at: "2026-07-22T12:00:00.000Z",
          stage_entered_at: "2026-07-01T00:00:00.000Z",
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-19T12:00:00.000Z",
        },
        error: null,
      };
    },
  };

  return {
    updatePayloads,
    client: { from: vi.fn(() => query) },
  };
}

describe("OpportunityService.markHandled", () => {
  beforeEach(() => requireSupabaseMock.mockReset());

  it("writes handled_at and its comeback in one authorized opportunity update", async () => {
    const fake = makeUpdateSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await OpportunityService.markHandled(
      "opp-1",
      null,
      new Date("2026-07-19T12:00:00.000Z")
    );

    expect(fake.updatePayloads).toEqual([
      {
        handled_at: "2026-07-19T12:00:00.000Z",
        next_follow_up_at: "2026-07-22T12:00:00.000Z",
      },
    ]);
  });

  it("preserves an earlier future follow-up in the same two-column write", async () => {
    const fake = makeUpdateSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await OpportunityService.markHandled(
      "opp-1",
      new Date("2026-07-20T09:30:00.000Z"),
      new Date("2026-07-19T12:00:00.000Z")
    );

    expect(fake.updatePayloads[0]).toEqual({
      handled_at: "2026-07-19T12:00:00.000Z",
      next_follow_up_at: "2026-07-20T09:30:00.000Z",
    });
  });
});
