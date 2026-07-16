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
import { OpportunityStage } from "@/lib/types/pipeline";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  client_id: null,
  title: "Framing consultation",
  description: null,
  contact_name: "A. Client",
  contact_email: "client@example.com",
  contact_phone: null,
  stage: "new_lead",
  source: "manual",
  assigned_to: "33333333-3333-4333-8333-333333333333",
  assignment_version: 4,
  priority: null,
  estimated_value: null,
  actual_value: null,
  win_probability: 10,
  expected_close_date: null,
  actual_close_date: null,
  stage_entered_at: "2026-07-15T00:00:00.000Z",
  project_id: null,
  lost_reason: null,
  lost_notes: null,
  tags: [],
  images: [],
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
};

function directMutationClient() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const query = {
    insert(value: unknown) {
      inserted.push(value);
      return query;
    },
    update(value: unknown) {
      updated.push(value);
      return query;
    },
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async single() {
      return { data: ROW, error: null };
    },
  };
  return {
    inserted,
    updated,
    client: { from: vi.fn(() => query), rpc: vi.fn() },
  };
}

describe("web opportunity assignment write contract", () => {
  beforeEach(() => {
    requireSupabaseMock.mockReset();
  });

  it("maps the authoritative assignment version on every opportunity read", async () => {
    const fake = directMutationClient();
    requireSupabaseMock.mockReturnValue(fake.client);

    const opportunity = await OpportunityService.fetchOpportunity(ROW.id);

    expect(opportunity.assignedTo).toBe(ROW.assigned_to);
    expect(opportunity.assignmentVersion).toBe(4);
  });

  it.each([
    "assignedTo",
    "assigned_to",
    "assignmentVersion",
    "assignment_version",
  ])(
    "rejects direct %s smuggling before a create or update query",
    async (field) => {
      const fake = directMutationClient();
      requireSupabaseMock.mockReturnValue(fake.client);
      const unsafe = {
        companyId: ROW.company_id,
        clientId: null,
        title: ROW.title,
        description: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        stage: OpportunityStage.NewLead,
        source: null,
        priority: null,
        estimatedValue: null,
        actualValue: null,
        winProbability: 10,
        expectedCloseDate: null,
        actualCloseDate: null,
        projectId: null,
        lostReason: null,
        lostNotes: null,
        quoteDeliveryMethod: null,
        address: null,
        latitude: null,
        longitude: null,
        tags: [],
        [field]:
          field.includes("version") || field.includes("Version")
            ? 9
            : ROW.assigned_to,
      };

      await expect(
        OpportunityService.createOpportunity(unsafe as never)
      ).rejects.toThrow("guarded assignment operation");
      await expect(
        OpportunityService.updateOpportunity(ROW.id, unsafe as never)
      ).rejects.toThrow("guarded assignment operation");
      expect(fake.inserted).toEqual([]);
      expect(fake.updated).toEqual([]);
    }
  );

  it("creates a manual lead through the guarded self-assignment RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        conflict: false,
        opportunity: ROW,
        assigned_to: ROW.assigned_to,
        assignment_version: 4,
        event_id: "44444444-4444-4444-8444-444444444444",
      },
      error: null,
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    const created = await OpportunityService.createManualOpportunity({
      clientId: null,
      title: ROW.title,
      description: null,
      contactName: "A. Client",
      contactEmail: "client@example.com",
      contactPhone: null,
      stage: OpportunityStage.NewLead,
      source: null,
      priority: null,
      estimatedValue: null,
      winProbability: 10,
      expectedCloseDate: null,
      quoteDeliveryMethod: null,
      address: null,
      latitude: null,
      longitude: null,
      tags: [],
    });

    expect(rpc).toHaveBeenCalledWith("create_opportunity_guarded", {
      p_opportunity: {
        client_id: null,
        title: ROW.title,
        description: null,
        contact_name: "A. Client",
        contact_email: "client@example.com",
        contact_phone: null,
        stage: "new_lead",
        source: null,
        priority: null,
        estimated_value: null,
        win_probability: 10,
        expected_close_date: null,
        quote_delivery_method: null,
        address: null,
        latitude: null,
        longitude: null,
        tags: [],
      },
      p_assignment_mode: "self",
      p_initial_assigned_to: null,
      p_metadata: { surface: "web_manual_create" },
    });
    const rpcPayload = rpc.mock.calls[0]?.[1] as {
      p_opportunity: Record<string, unknown>;
    };
    expect(rpcPayload.p_opportunity).not.toHaveProperty("company_id");
    expect(rpcPayload.p_opportunity).not.toHaveProperty("assigned_to");
    expect(created.assignmentVersion).toBe(4);
  });
});
