import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunityAssignedContextService } from "@/lib/api/services/opportunity-assigned-context-service";

const rpcMock = vi.hoisted(() => vi.fn());
const getSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

function validContextResponse() {
  return {
    lead: {
      id: OPPORTUNITY_ID,
      title: "Greenway framing package",
      description: "Frame the addition and renovate the main floor.",
      stage: "quoting",
      priority: "high",
      estimated_value: 48000,
      expected_close_date: "2026-08-01",
      source: "referral",
      tags: ["framing", "renovation"],
      address: "1180 Howe St, Vancouver, BC",
      created_at: "2026-07-10T10:00:00+00:00",
      updated_at: "2026-07-15T12:00:00+00:00",
    },
    contact: {
      id: CLIENT_ID,
      name: "Dana Scully",
      email: "dana@example.com",
      phone: "+1 604 555 0142",
      address: "1180 Howe St, Vancouver, BC",
      profile_image_url: null,
    },
    estimate_summaries: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        estimate_number: "EST-1042",
        title: "Framing package",
        status: "sent",
        subtotal: 45000,
        tax_amount: 3000,
        total: 48000,
        issue_date: "2026-07-14",
        expiration_date: "2026-08-14",
        sent_at: "2026-07-14T18:00:00+00:00",
        approved_at: null,
      },
    ],
    activities: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        type: "email",
        subject: "Re: framing package",
        content: "Jason, call me tomorrow morning.",
        body_text: "Jason, call me tomorrow morning.",
        direction: "inbound",
        outcome: null,
        duration_minutes: null,
        has_attachments: true,
        created_at: "2026-07-15T11:00:00+00:00",
      },
    ],
    follow_ups: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        title: "Call Dana",
        description: null,
        type: "call",
        status: "pending",
        due_at: "2026-07-16T16:00:00+00:00",
        reminder_at: null,
        completed_at: null,
        completion_notes: null,
        assigned_to: "66666666-6666-4666-8666-666666666666",
        created_at: "2026-07-15T12:00:00+00:00",
      },
    ],
    site_visits: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        scheduled_at: "2026-07-18T17:00:00+00:00",
        duration_minutes: 60,
        status: "scheduled",
        notes: "Meet at the rear entrance.",
        internal_notes: null,
        measurements: "24 ft x 18 ft",
        photos: ["https://files.example.com/site.jpg"],
        completed_at: null,
      },
    ],
    deck_designs: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        title: "Rear addition",
        thumbnail_url: null,
        version: 3,
        updated_at: "2026-07-15T09:00:00+00:00",
      },
    ],
    lifecycle: {
      last_meaningful_at: "2026-07-15T11:00:00+00:00",
      last_meaningful_direction: "inbound",
      unanswered_follow_up_count: 0,
      stale_status: "clear",
      stale_status_at: null,
      protected_until: null,
      updated_at: "2026-07-15T12:00:00+00:00",
    },
    correspondence: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        direction: "inbound",
        party_role: "customer",
        is_meaningful: true,
        noise_reason: null,
        subject: "Re: framing package",
        occurred_at: "2026-07-15T11:00:00+00:00",
      },
    ],
  };
}

describe("OpportunityAssignedContextService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("calls the guarded RPC and maps its exact snake-case projection", async () => {
    rpcMock.mockResolvedValue({ data: validContextResponse(), error: null });

    const context =
      await OpportunityAssignedContextService.fetch(OPPORTUNITY_ID);

    expect(rpcMock).toHaveBeenCalledWith("get_opportunity_assigned_context", {
      p_opportunity_id: OPPORTUNITY_ID,
    });
    expect(context.lead.id).toBe(OPPORTUNITY_ID);
    expect(context.lead.createdAt).toEqual(
      new Date("2026-07-10T10:00:00.000Z")
    );
    expect(context.lead.expectedCloseDate).toEqual(
      new Date("2026-08-01T00:00:00.000Z")
    );
    expect(context.contact).toMatchObject({
      id: CLIENT_ID,
      name: "Dana Scully",
      phone: "+1 604 555 0142",
    });
    expect(context.estimateSummaries[0]).toMatchObject({
      estimateNumber: "EST-1042",
      total: 48000,
    });
    expect(context.activities[0]).toMatchObject({
      bodyText: "Jason, call me tomorrow morning.",
      hasAttachments: true,
    });
    expect(context.followUps[0].assignedTo).toBe(
      "66666666-6666-4666-8666-666666666666"
    );
    expect(context.siteVisits[0]).toMatchObject({
      measurements: "24 ft x 18 ft",
      photos: ["https://files.example.com/site.jpg"],
    });
    expect(context.correspondence[0]).toMatchObject({
      partyRole: "customer",
      isMeaningful: true,
    });
  });

  it("fails closed when Supabase denies the guarded read", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "access_denied" },
    });

    await expect(
      OpportunityAssignedContextService.fetch(OPPORTUNITY_ID)
    ).rejects.toMatchObject({
      code: "access_denied",
    });
  });

  it("accepts the RPC's legitimate empty-context shape", async () => {
    const empty = {
      ...validContextResponse(),
      contact: {
        id: null,
        name: null,
        email: null,
        phone: null,
        address: null,
        profile_image_url: null,
      },
      estimate_summaries: [],
      activities: [],
      follow_ups: [],
      site_visits: [],
      deck_designs: [],
      lifecycle: null,
      correspondence: [],
    };
    rpcMock.mockResolvedValue({ data: empty, error: null });

    const context =
      await OpportunityAssignedContextService.fetch(OPPORTUNITY_ID);

    expect(context.contact.id).toBeNull();
    expect(context.estimateSummaries).toEqual([]);
    expect(context.lifecycle).toBeNull();
  });

  it("fails closed on a malformed projection instead of returning partial data", async () => {
    const malformed = validContextResponse();
    malformed.contact = undefined as never;
    rpcMock.mockResolvedValue({ data: malformed, error: null });

    await expect(
      OpportunityAssignedContextService.fetch(OPPORTUNITY_ID)
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects a valid-looking response for a different lead", async () => {
    const mismatched = validContextResponse();
    mismatched.lead.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    rpcMock.mockResolvedValue({ data: mismatched, error: null });

    await expect(
      OpportunityAssignedContextService.fetch(OPPORTUNITY_ID)
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("fails closed when no authenticated Supabase client is available", async () => {
    getSupabaseClientMock.mockReturnValue(null);

    await expect(
      OpportunityAssignedContextService.fetch(OPPORTUNITY_ID)
    ).rejects.toMatchObject({
      code: "client_unavailable",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
