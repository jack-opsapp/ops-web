import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evaluateBilateralEventMock,
  fetchOperatorIdentityMock,
  getConnectionMock,
  persistBilateralEventHandoffMock,
  refreshSummaryMock,
} = vi.hoisted(() => ({
  evaluateBilateralEventMock: vi.fn(),
  fetchOperatorIdentityMock: vi.fn(),
  getConnectionMock: vi.fn(),
  persistBilateralEventHandoffMock: vi.fn(),
  refreshSummaryMock: vi.fn(),
}));

vi.mock("@/lib/api/services/lead-summary-service", () => ({
  refreshLeadSummariesForOpportunities: refreshSummaryMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getConnection: getConnectionMock },
}));

vi.mock("@/lib/api/services/conversation-state/operator-identity", () => ({
  fetchOperatorIdentity: fetchOperatorIdentityMock,
}));

vi.mock("@/lib/email/phase-c-bilateral-event-handoff", () => ({
  evaluatePhaseCBilateralEvent: evaluateBilateralEventMock,
  persistPhaseCBilateralEventHandoff: persistBilateralEventHandoffMock,
}));

import { createPhaseCLeadIntelligenceWorkService } from "@/lib/api/services/phase-c-lead-intelligence-work-runtime";

async function runEventHandoffWorker(
  input: {
    requiredEventId?: "event-current" | "event-legacy";
    legacySource?: string;
    legacyProviderMessageId?: string | null;
    currentActivityDirection?: "inbound" | "outbound";
  } = {}
) {
  const requiredEventId = input.requiredEventId ?? "event-current";
  const completedComponents = Object.fromEntries(
    ["summary", "lifecycle", "commercial"].map((component) => [
      component,
      { event_id: requiredEventId },
    ])
  );
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_opportunity_phase_c_work") {
      return {
        data: [
          {
            company_id: "company-1",
            opportunity_id: "opportunity-1",
            required_event_id: requiredEventId,
            required_event_at: "2026-09-04T16:35:19.000Z",
            required_activity_id:
              requiredEventId === "event-current" ? "activity-current" : null,
            required_connection_id: "connection-1",
            required_provider_thread_id: "thread-1",
            attempt_count: 12,
            component_outcomes: completedComponents,
            component_errors: {},
          },
        ],
        error: null,
      };
    }
    if (name === "acknowledge_opportunity_phase_c_component") {
      return { data: "completed", error: null };
    }
    if (name === "fail_opportunity_phase_c_work") {
      return { data: "retry_scheduled", error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const events = [
    {
      id: "event-legacy",
      source: input.legacySource ?? "legacy_thread_email",
      activity_id: null,
      connection_id: "connection-1",
      provider_thread_id: "thread-1",
      provider_message_id: input.legacyProviderMessageId ?? null,
      direction: "inbound",
      from_email: "customer@example.com",
      to_emails: ["operator@example.com"],
      cc_emails: [],
      subject: "Legacy thread evidence",
      occurred_at: "2026-05-26T18:25:05.000Z",
    },
    {
      id: "event-current",
      source: "sync_activity",
      activity_id: "activity-current",
      connection_id: "connection-1",
      provider_thread_id: "thread-1",
      provider_message_id: "message-current",
      direction: "outbound",
      from_email: "operator@example.com",
      to_emails: ["customer@example.com"],
      cc_emails: [],
      subject: "Current reply",
      occurred_at: "2026-09-04T16:35:19.000Z",
    },
  ];
  const activities = [
    {
      id: "activity-current",
      email_connection_id: "connection-1",
      email_thread_id: "thread-1",
      email_message_id: "message-current",
      direction: input.currentActivityDirection ?? "outbound",
      subject: "Current reply",
      body_text: "Thanks, we will follow up shortly.",
      body_text_clean: "Thanks, we will follow up shortly.",
      to_emails: ["customer@example.com"],
      cc_emails: [],
    },
  ];
  const selectedColumns = new Map<string, string>();
  const page = (table: string, data: unknown[]) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn((columns: string) => {
      selectedColumns.set(table, columns);
      return builder;
    });
    for (const method of ["eq", "is", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.range = vi.fn(async () => ({ data, error: null }));
    return builder;
  };
  const single = (data: Record<string, unknown>) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(async () => ({ data, error: null }));
    return builder;
  };
  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "opportunities") {
        return single({
          id: "opportunity-1",
          company_id: "company-1",
          title: "Lead",
          address: null,
          contact_email: "customer@example.com",
          client_id: null,
          client_ref: null,
          stage: "quoted",
          assignment_version: 1,
          assigned_to: "operator-1",
        });
      }
      if (table === "companies") {
        return single({
          id: "company-1",
          name: "OPS",
          timezone: "America/Vancouver",
        });
      }
      if (table === "opportunity_correspondence_events") {
        return page(table, events);
      }
      if (table === "activities") return page(table, activities);
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  getConnectionMock.mockResolvedValue({
    id: "connection-1",
    companyId: "company-1",
    userId: "operator-1",
    email: "operator@example.com",
  });
  fetchOperatorIdentityMock.mockResolvedValue({
    userId: "operator-1",
    emails: ["operator@example.com"],
  });
  evaluateBilateralEventMock.mockReturnValue({ status: "none" });

  const result = await createPhaseCLeadIntelligenceWorkService({
    supabase,
  }).runWorker({ limit: 1, leaseSeconds: 300 });
  return { result, rpc, selectedColumns };
}

describe("Phase C lead-intelligence runtime database wiring", () => {
  beforeEach(() => {
    evaluateBilateralEventMock.mockReset();
    fetchOperatorIdentityMock.mockReset();
    getConnectionMock.mockReset();
    persistBilateralEventHandoffMock.mockReset();
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

  it("ignores historical projections without message identity when the required event is exact", async () => {
    const { result, rpc, selectedColumns } = await runEventHandoffWorker();

    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({ claimed: 1, completed: 1, retrying: 0 });
    expect(
      selectedColumns
        .get("opportunity_correspondence_events")
        ?.split(",")
        .map((column) => column.trim())
    ).toContain("source");
    expect(evaluateBilateralEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            eventId: "event-current",
            providerMessageId: "message-current",
          }),
        ],
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "fail_opportunity_phase_c_work",
      expect.anything()
    );
  });

  it.each([null, "   "])(
    "keeps a required event with %s provider message identity on durable retry",
    async (legacyProviderMessageId) => {
      const { result } = await runEventHandoffWorker({
        requiredEventId: "event-legacy",
        legacyProviderMessageId,
      });

      expect(result).toMatchObject({ claimed: 1, completed: 0, retrying: 1 });
      expect(result.errors).toEqual([
        {
          opportunityId: "opportunity-1",
          error:
            "event_handoff: Phase C required evidence event has no provider message identity",
        },
      ]);
      expect(evaluateBilateralEventMock).not.toHaveBeenCalled();
    }
  );

  it("does not suppress missing identity on an ordinary projected event", async () => {
    const { result } = await runEventHandoffWorker({
      legacySource: "sync_activity",
    });

    expect(result).toMatchObject({ claimed: 1, completed: 0, retrying: 1 });
    expect(result.errors[0]?.error).toBe(
      "event_handoff: Phase C activity evidence missing for event event-legacy"
    );
    expect(evaluateBilateralEventMock).not.toHaveBeenCalled();
  });

  it("keeps mismatched message-backed activity identity on durable retry", async () => {
    const { result } = await runEventHandoffWorker({
      currentActivityDirection: "inbound",
    });

    expect(result).toMatchObject({ claimed: 1, completed: 0, retrying: 1 });
    expect(result.errors[0]?.error).toBe(
      "event_handoff: Phase C activity evidence identity conflict for event event-current"
    );
    expect(evaluateBilateralEventMock).not.toHaveBeenCalled();
  });
});
