import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConnection } from "@/lib/types/email-connection";

const mocks = vi.hoisted(() => ({
  buildConversationState: vi.fn(),
  persistRoutingDecision: vi.fn(),
  decideAcceptStage: vi.fn(),
  convertOpportunityToProject: vi.fn(),
  linkOpportunityToExistingProject: vi.fn(),
  findUniqueExistingProjectForEmailConversion: vi.fn(),
}));

vi.mock("@/lib/api/services/conversation-state/conversation-state", () => ({
  buildConversationState: mocks.buildConversationState,
}));

vi.mock("@/lib/api/services/conversation-state/persist-routing", () => ({
  persistRoutingDecision: mocks.persistRoutingDecision,
}));

vi.mock("@/lib/api/services/conversation-state/accept-stage", () => ({
  decideAcceptStage: mocks.decideAcceptStage,
}));

vi.mock("@/lib/api/services/project-conversion-service", () => ({
  ProjectConversionError: class ProjectConversionError extends Error {
    guardReason = null;
  },
  ProjectConversionService: {
    convertOpportunityToProject: mocks.convertOpportunityToProject,
    linkOpportunityToExistingProject: mocks.linkOpportunityToExistingProject,
  },
}));

vi.mock("@/lib/email/opportunity-relationship-matching", () => ({
  findUniqueExistingProjectForEmailConversion:
    mocks.findUniqueExistingProjectForEmailConversion,
}));

import {
  evaluateOpportunityAcceptance,
  evaluateOpportunityCommercialOutcome,
  shouldEvaluateOpportunityCommercialOutcome,
} from "@/lib/api/services/conversation-state/acceptance-evaluation";

type Row = Record<string, unknown>;

function makeSupabase(input: {
  opportunity?: Row | null;
  thread?: Row | null;
  threads?: Row[];
  client?: Row | null;
  subClients?: Row[];
  events?: Row[];
  activities?: Row[];
}) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const selects: Array<{ table: string; columns: string }> = [];
  const rpc = vi.fn(
    async (
      _name: string,
      _params?: unknown
    ): Promise<{ data: unknown; error: { message: string } | null }> => ({
      data: null,
      error: null,
    })
  );

  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    const queryFilters = new Map<string, unknown>();
    query.select = (columns: string) => {
      selects.push({ table, columns });
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      filters.push({ table, column, value });
      queryFilters.set(column, value);
      return query;
    };
    query.is = (column: string, value: unknown) => {
      filters.push({ table, column, value });
      queryFilters.set(column, value);
      return query;
    };
    query.order = () => query;
    query.range = async (fromIndex: number, toIndex: number) => {
      const defaultEvents = [
        {
          id: "event-accept-1",
          activity_id: "activity-accept-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-accept-1",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-14T18:00:00.000Z",
        },
      ];
      const defaultActivities = [
        {
          id: "activity-accept-1",
          email_connection_id: "connection-1",
          email_message_id: "message-accept-1",
          subject: "Re: Estimate",
          body_text: "We accept the estimate. Please proceed.",
          body_text_clean: "We accept the estimate. Please proceed.",
        },
      ];
      const eventRows: Row[] = (input.events ?? defaultEvents).map(
        (event) => ({
          ...event,
          activity_id: Object.hasOwn(event, "activity_id")
            ? event.activity_id
            : `activity-${event.provider_message_id}`,
          from_email:
            event.from_email ??
            (event.party_role === "customer"
              ? "customer@example.com"
              : "operator@example.com"),
        })
      );
      const rows =
        table === "opportunity_correspondence_events"
          ? eventRows
          : table === "activities"
            ? (input.activities ?? defaultActivities).map((activity) => {
                const activityId = Object.hasOwn(activity, "id")
                  ? activity.id
                  : `activity-${activity.email_message_id}`;
                const linkedEvent = eventRows.find(
                  (event) =>
                    event.activity_id === activityId ||
                    event.provider_message_id === activity.email_message_id
                );
                const linkedThreadId = linkedEvent?.provider_thread_id;
                const linkedDirection = linkedEvent?.direction;
                return {
                  email_thread_id:
                    typeof linkedThreadId === "string"
                      ? linkedThreadId
                      : "provider-thread-1",
                  direction:
                    linkedDirection === "outbound" ? "outbound" : "inbound",
                  ...activity,
                  id: activityId,
                };
              })
            : table === "sub_clients"
              ? (input.subClients ?? [])
              : [];
      return { data: rows.slice(fromIndex, toIndex + 1), error: null };
    };
    query.maybeSingle = async () => {
      const emailThread = (
        input.threads ?? [input.thread].filter(Boolean)
      ).find((candidate) =>
        [...queryFilters.entries()].every(
          ([column, value]) =>
            !Object.hasOwn(candidate as Row, column) ||
            (candidate as Row)[column] === value
        )
      );
      return {
        data:
          table === "opportunities"
            ? input.opportunity
              ? {
                  contact_email: "customer@example.com",
                  ...input.opportunity,
                }
              : null
            : table === "email_threads"
              ? (emailThread ?? null)
              : table === "clients"
                ? input.client
                  ? { email: "customer@example.com", ...input.client }
                  : null
                : null,
        error: null,
      };
    };
    return query;
  });

  return { client: { from, rpc }, filters, selects, rpc };
}

const connection = {
  id: "connection-1",
  companyId: "company-1",
  provider: "gmail",
  type: "individual",
  userId: "user-1",
  email: "operator@example.com",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: new Date("2026-07-15T00:00:00.000Z"),
  historyId: null,
  syncEnabled: true,
  lastSyncedAt: null,
  syncIntervalMinutes: 5,
  syncFilters: {},
  webhookSubscriptionId: null,
  webhookExpiresAt: null,
  opsLabelId: null,
  aiReviewEnabled: true,
  aiMemoryEnabled: true,
  status: "active",
  createdAt: new Date("2026-07-14T00:00:00.000Z"),
  updatedAt: new Date("2026-07-14T00:00:00.000Z"),
} satisfies EmailConnection;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildConversationState.mockResolvedValue({
    accept: { detected: true, confidence: "high", basis: [] },
    stage: "quoted",
    routing: { decision: "draft" },
    messages: [],
  });
  mocks.persistRoutingDecision.mockResolvedValue(undefined);
  mocks.decideAcceptStage.mockReturnValue({
    kind: "auto_advance_won",
    reason: "signed estimate",
  });
  mocks.convertOpportunityToProject.mockResolvedValue({ won: true });
  mocks.linkOpportunityToExistingProject.mockResolvedValue({ won: true });
  mocks.findUniqueExistingProjectForEmailConversion.mockResolvedValue(null);
});

describe("evaluateOpportunityAcceptance", () => {
  it("keeps engine-deferred lost leads eligible for later decisive correspondence", () => {
    expect(shouldEvaluateOpportunityCommercialOutcome("lost", false)).toBe(
      true
    );
    expect(shouldEvaluateOpportunityCommercialOutcome("won", false)).toBe(
      false
    );
    expect(shouldEvaluateOpportunityCommercialOutcome("discarded", false)).toBe(
      false
    );
    expect(shouldEvaluateOpportunityCommercialOutcome("lost", true)).toBe(
      false
    );
  });

  it.each([
    {
      body: "We accept the $600 supply-only estimate. Please send the deposit instructions.",
      signal: "explicit_acceptance",
    },
    {
      body: "Just paid the 50% deposit. Please confirm you received it.",
      signal: "payment_confirmed",
    },
  ])(
    "converts a trusted message-scoped customer commitment without an email_threads row: $signal",
    async ({ body, signal }) => {
      const { client } = makeSupabase({
        opportunity: {
          stage: "quoted",
          stage_manually_set: false,
          client_id: "client-1",
          assignment_version: 17,
          address: "2745 Fernwood Rd",
        },
        events: [
          {
            id: "event-forwarded-acceptance",
            activity_id: "activity-forwarded-acceptance",
            connection_id: "connection-1",
            provider_thread_id: "shared-victoria-forward-thread",
            provider_message_id: "forwarded-acceptance-message",
            direction: "inbound",
            party_role: "customer",
            from_email: "customer@example.com",
            occurred_at: "2026-07-22T16:00:00.000Z",
          },
        ],
        activities: [
          {
            id: "activity-forwarded-acceptance",
            email_connection_id: "connection-1",
            email_message_id: "forwarded-acceptance-message",
            subject: "Fwd: Victoria office lead",
            body_text: body,
            body_text_clean: body,
          },
        ],
      });

      const result = await evaluateOpportunityCommercialOutcome({
        supabase: client as never,
        opportunityId: "opportunity-1",
        connection,
      });

      expect(mocks.buildConversationState).not.toHaveBeenCalled();
      expect(mocks.persistRoutingDecision).not.toHaveBeenCalled();
      expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
        expect.objectContaining({
          opportunityId: "opportunity-1",
          expectedStage: "quoted",
          expectedAssignmentVersion: 17,
          evidence: {
            connection_id: "connection-1",
            conversation_scope: "message",
            source_activity_id: "activity-forwarded-acceptance",
            provider_thread_id: "shared-victoria-forward-thread",
            provider_message_id: "forwarded-acceptance-message",
            decisive_event_id: "event-forwarded-acceptance",
            decisive_direction: "inbound",
            evaluated_through_event_id: "event-forwarded-acceptance",
            signals: expect.arrayContaining([signal]),
            decision: "auto_advance_won",
          },
        })
      );
      expect(result).toEqual({ stageChanged: true });
    }
  );

  it("claims an exact legacy activity before message-scoped conversion", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 21,
      },
      events: [
        {
          id: "event-legacy-acceptance",
          activity_id: "activity-legacy-acceptance",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-legacy",
          provider_message_id: "provider-message-legacy",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:00:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-legacy-acceptance",
          email_connection_id: null,
          email_message_id: "provider-message-legacy",
          email_thread_id: "provider-thread-legacy",
          direction: "inbound",
          subject: "Re: Estimate",
          body_text:
            "We accept the estimate. Please send the deposit instructions.",
          body_text_clean:
            "We accept the estimate. Please send the deposit instructions.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "claim_legacy_email_activity_connection_as_system"
        ? { data: true, error: null }
        : { data: null, error: null }
    );

    const result = await evaluateOpportunityCommercialOutcome({
      supabase: client as never,
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "claim_legacy_email_activity_connection_as_system",
      {
        p_company_id: "company-1",
        p_connection_id: "connection-1",
        p_activity_id: "activity-legacy-acceptance",
        p_provider_thread_id: "provider-thread-legacy",
        p_provider_message_id: "provider-message-legacy",
      }
    );
    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opportunity-1",
        expectedStage: "quoted",
        expectedAssignmentVersion: 21,
        evidence: expect.objectContaining({
          conversation_scope: "message",
          source_activity_id: "activity-legacy-acceptance",
          provider_message_id: "provider-message-legacy",
          decisive_event_id: "event-legacy-acceptance",
        }),
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("claims a validated legacy activity before thread-scoped conversion", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 22,
      },
      thread: {
        id: "thread-legacy-acceptance",
        provider_thread_id: "provider-thread-legacy",
      },
      events: [
        {
          id: "event-legacy-acceptance",
          activity_id: "activity-legacy-acceptance",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-legacy",
          provider_message_id: "provider-message-legacy",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:00:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-legacy-acceptance",
          email_connection_id: null,
          email_message_id: "provider-message-legacy",
          email_thread_id: "provider-thread-legacy",
          direction: "inbound",
          subject: "Re: Estimate",
          body_text: "We accept the estimate.",
          body_text_clean: "We accept the estimate.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "claim_legacy_email_activity_connection_as_system"
        ? { data: true, error: null }
        : { data: null, error: null }
    );

    const result = await evaluateOpportunityCommercialOutcome({
      supabase: client as never,
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "claim_legacy_email_activity_connection_as_system",
      {
        p_company_id: "company-1",
        p_connection_id: "connection-1",
        p_activity_id: "activity-legacy-acceptance",
        p_provider_thread_id: "provider-thread-legacy",
        p_provider_message_id: "provider-message-legacy",
      }
    );
    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          email_thread_id: "thread-legacy-acceptance",
          decisive_event_id: "event-legacy-acceptance",
        }),
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("fails closed when the guarded claim finds a multiply-linked legacy activity", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 22,
      },
      thread: {
        id: "thread-ambiguous-legacy",
        provider_thread_id: "provider-thread-ambiguous",
      },
      events: [
        {
          id: "event-ambiguous-legacy-1",
          activity_id: "activity-ambiguous-legacy",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-ambiguous",
          provider_message_id: "provider-message-ambiguous",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:01:00.000Z",
        },
        {
          id: "event-ambiguous-legacy-2",
          activity_id: "activity-ambiguous-legacy",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-ambiguous",
          provider_message_id: "provider-message-ambiguous",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:02:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-ambiguous-legacy",
          email_connection_id: null,
          email_message_id: "provider-message-ambiguous",
          email_thread_id: "provider-thread-ambiguous",
          direction: "inbound",
          subject: "Re: Estimate",
          body_text: "We accept the estimate.",
          body_text_clean: "We accept the estimate.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "claim_legacy_email_activity_connection_as_system"
        ? {
            data: null,
            error: { message: "legacy activity is linked to multiple events" },
          }
        : { data: null, error: null }
    );

    await expect(
      evaluateOpportunityCommercialOutcome({
        supabase: client as never,
        opportunityId: "opportunity-1",
        connection,
      })
    ).rejects.toThrow(
      "email acceptance legacy activity connection claim failed for event event-ambiguous-legacy-1: legacy activity is linked to multiple events"
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
  });

  it.each([
    {
      field: "connection",
      activity: {
        email_connection_id: "different-connection",
        email_message_id: "provider-message-conflict",
      },
    },
    {
      field: "message",
      activity: {
        email_connection_id: "connection-1",
        email_message_id: "different-message",
      },
    },
    {
      field: "missing message",
      activity: {
        email_connection_id: "connection-1",
        email_message_id: null,
      },
    },
    {
      field: "thread",
      activity: {
        email_connection_id: "connection-1",
        email_message_id: "provider-message-conflict",
        email_thread_id: "different-thread",
      },
    },
    {
      field: "direction",
      activity: {
        email_connection_id: "connection-1",
        email_message_id: "provider-message-conflict",
        direction: "outbound",
      },
    },
  ])(
    "fails closed when an exact activity link has conflicting $field provenance",
    async ({ activity }) => {
      const { client } = makeSupabase({
        opportunity: {
          stage: "quoted",
          stage_manually_set: false,
          client_id: "client-1",
          assignment_version: 22,
        },
        events: [
          {
            id: "event-provenance-conflict",
            activity_id: "activity-provenance-conflict",
            connection_id: "connection-1",
            provider_thread_id: "provider-thread-conflict",
            provider_message_id: "provider-message-conflict",
            direction: "inbound",
            party_role: "customer",
            from_email: "customer@example.com",
            occurred_at: "2026-07-23T18:05:00.000Z",
          },
        ],
        activities: [
          {
            id: "activity-provenance-conflict",
            ...activity,
            subject: "Re: Estimate",
            body_text: "We accept the estimate.",
            body_text_clean: "We accept the estimate.",
          },
        ],
      });

      await expect(
        evaluateOpportunityCommercialOutcome({
          supabase: client as never,
          opportunityId: "opportunity-1",
          connection,
        })
      ).rejects.toThrow(
        "commercial evidence activity identity conflict for event event-provenance-conflict"
      );
      expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    }
  );

  it("holds message-scoped conversion when a legacy activity claim is not proven", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 23,
      },
      events: [
        {
          id: "event-unclaimed-legacy",
          activity_id: "activity-unclaimed-legacy",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-unclaimed",
          provider_message_id: "provider-message-unclaimed",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:08:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-unclaimed-legacy",
          email_connection_id: null,
          email_message_id: "provider-message-unclaimed",
          email_thread_id: "provider-thread-unclaimed",
          direction: "inbound",
          subject: "Re: Estimate",
          body_text: "We accept the estimate.",
          body_text_clean: "We accept the estimate.",
        },
      ],
    });

    await expect(
      evaluateOpportunityCommercialOutcome({
        supabase: client as never,
        opportunityId: "opportunity-1",
        connection,
      })
    ).rejects.toThrow(
      "email acceptance legacy activity connection claim was not proven for event event-unclaimed-legacy"
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
  });

  it("holds message-scoped conversion when the guarded legacy claim rejects it", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 23,
      },
      events: [
        {
          id: "event-rejected-legacy-claim",
          activity_id: "activity-rejected-legacy-claim",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-rejected-claim",
          provider_message_id: "provider-message-rejected-claim",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:09:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-rejected-legacy-claim",
          email_connection_id: null,
          email_message_id: "provider-message-rejected-claim",
          email_thread_id: "provider-thread-rejected-claim",
          direction: "inbound",
          subject: "Re: Estimate",
          body_text: "We accept the estimate.",
          body_text_clean: "We accept the estimate.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "claim_legacy_email_activity_connection_as_system"
        ? {
            data: null,
            error: { message: "legacy activity identity is not proven" },
          }
        : { data: null, error: null }
    );

    await expect(
      evaluateOpportunityCommercialOutcome({
        supabase: client as never,
        opportunityId: "opportunity-1",
        connection,
      })
    ).rejects.toThrow(
      "email acceptance legacy activity connection claim failed for event event-rejected-legacy-claim: legacy activity identity is not proven"
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
  });

  it("does not replace a missing exact activity link with a composite mailbox match", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 23,
      },
      events: [
        {
          id: "event-out-of-scope-activity",
          activity_id: "activity-not-in-scoped-evidence",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-scoped",
          provider_message_id: "provider-message-scoped",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:10:00.000Z",
        },
      ],
      activities: [
        {
          id: "different-composite-activity",
          email_connection_id: "connection-1",
          email_message_id: "provider-message-scoped",
          subject: "Re: Estimate",
          body_text: "We accept the estimate.",
          body_text_clean: "We accept the estimate.",
        },
      ],
    });

    await expect(
      evaluateOpportunityCommercialOutcome({
        supabase: client as never,
        opportunityId: "opportunity-1",
        connection,
      })
    ).rejects.toThrow(
      "commercial evidence activity missing for event event-out-of-scope-activity"
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
  });

  it("preserves composite mailbox fallback when a legacy event has no activity link", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 24,
      },
      thread: {
        id: "thread-composite-fallback",
        provider_thread_id: "provider-thread-composite-fallback",
      },
      events: [
        {
          id: "event-composite-fallback",
          activity_id: null,
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-composite-fallback",
          provider_message_id: "provider-message-composite-fallback",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:15:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-composite-fallback",
          email_connection_id: "connection-1",
          email_message_id: "provider-message-composite-fallback",
          subject: "Re: Estimate",
          body_text: "We accept the estimate.",
          body_text_clean: "We accept the estimate.",
        },
      ],
    });

    const result = await evaluateOpportunityCommercialOutcome({
      supabase: client as never,
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          email_thread_id: "thread-composite-fallback",
          decisive_event_id: "event-composite-fallback",
        }),
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("applies a message-scoped budget/timing deferral without requiring an email_threads row", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "new_lead",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 18,
      },
      events: [
        {
          id: "event-forwarded-deferral",
          activity_id: "activity-forwarded-deferral",
          connection_id: "connection-1",
          provider_thread_id: "shared-victoria-forward-thread",
          provider_message_id: "forwarded-deferral-message",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-22T17:00:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-forwarded-deferral",
          email_connection_id: "connection-1",
          email_message_id: "forwarded-deferral-message",
          subject: "Fwd: Project timing",
          body_text:
            "Truck repairs consumed the budget, so I need to postpone this until next year.",
          body_text_clean:
            "Truck repairs consumed the budget, so I need to postpone this until next year.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "claim_legacy_email_activity_connection_as_system"
        ? { data: true, error: null }
        : name === "apply_email_opportunity_deferred_disposition"
          ? { data: [{ changed: true }], error: null }
          : { data: null, error: null }
    );

    const result = await evaluateOpportunityCommercialOutcome({
      supabase: client as never,
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_email_opportunity_deferred_disposition",
      expect.objectContaining({
        p_connection_id: "connection-1",
        p_provider_message_id: "forwarded-deferral-message",
        p_expected_assignment_version: 18,
        p_expected_stage: "new_lead",
      })
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: true });
  });

  it("applies a budget/timing deferral from validated legacy-null mailbox provenance", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "new_lead",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 25,
      },
      events: [
        {
          id: "event-legacy-deferral",
          activity_id: "activity-legacy-deferral",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-legacy-deferral",
          provider_message_id: "provider-message-legacy-deferral",
          direction: "inbound",
          party_role: "customer",
          from_email: "customer@example.com",
          occurred_at: "2026-07-23T18:20:00.000Z",
        },
      ],
      activities: [
        {
          id: "activity-legacy-deferral",
          email_connection_id: null,
          email_message_id: "provider-message-legacy-deferral",
          email_thread_id: "provider-thread-legacy-deferral",
          direction: "inbound",
          subject: "Re: Project timing",
          body_text:
            "Truck repairs consumed the budget, so I need to postpone this until next year.",
          body_text_clean:
            "Truck repairs consumed the budget, so I need to postpone this until next year.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "claim_legacy_email_activity_connection_as_system"
        ? { data: true, error: null }
        : name === "apply_email_opportunity_deferred_disposition"
          ? { data: [{ changed: true }], error: null }
          : { data: null, error: null }
    );

    const result = await evaluateOpportunityCommercialOutcome({
      supabase: client as never,
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_email_opportunity_deferred_disposition",
      expect.objectContaining({
        p_connection_id: "connection-1",
        p_provider_message_id: "provider-message-legacy-deferral",
        p_expected_assignment_version: 25,
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      "claim_legacy_email_activity_connection_as_system",
      {
        p_company_id: "company-1",
        p_connection_id: "connection-1",
        p_activity_id: "activity-legacy-deferral",
        p_provider_thread_id: "provider-thread-legacy-deferral",
        p_provider_message_id: "provider-message-legacy-deferral",
      }
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: true });
  });

  it("keeps a manual stage override inert in the opportunity-wide entrypoint", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "negotiation",
        stage_manually_set: true,
        client_id: "client-1",
        assignment_version: 19,
      },
    });

    const result = await evaluateOpportunityCommercialOutcome({
      supabase: client as never,
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: false });
  });

  it("re-evaluates a signed attachment and converts the exact mailbox lead", async () => {
    const { client, filters, selects, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 7,
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      client: { name: "North Shore Rail" },
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(filters).toContainEqual({
      table: "email_threads",
      column: "connection_id",
      value: "connection-1",
    });
    expect(selects).toContainEqual({
      table: "opportunities",
      columns:
        "stage, stage_manually_set, client_id, client_ref, contact_email, assignment_version, address",
    });
    expect(mocks.buildConversationState).toHaveBeenCalledWith("thread-1");
    expect(mocks.persistRoutingDecision).toHaveBeenCalledWith(
      "thread-1",
      expect.any(Object)
    );
    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opportunity-1",
        companyId: "company-1",
        sourcePath: "email_accept",
        decidedBy: null,
        expectedStage: "quoted",
        expectedAssignmentVersion: 7,
        evidence: {
          connection_id: "connection-1",
          email_thread_id: "thread-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-accept-1",
          decisive_event_id: "event-accept-1",
          decisive_direction: "inbound",
          evaluated_through_event_id: "event-accept-1",
          signals: ["explicit_acceptance"],
          decision: "auto_advance_won",
        },
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "create_email_opportunity_notification_as_system",
      expect.objectContaining({ p_event_type: "accept_auto_won" })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("uses a client_ref-only historical opportunity as the trusted customer identity", async () => {
    const { client, filters } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: null,
        client_ref: "client-ref-only",
        assignment_version: 7,
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      client: { email: "customer@example.com" },
    });

    await expect(
      evaluateOpportunityAcceptance({
        supabase: client as never,
        providerThreadId: "provider-thread-1",
        opportunityId: "opportunity-1",
        connection,
      })
    ).resolves.toEqual({ stageChanged: true });

    expect(filters).toContainEqual({
      table: "clients",
      column: "id",
      value: "client-ref-only",
    });
    expect(
      mocks.findUniqueExistingProjectForEmailConversion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: null,
        clientRef: "client-ref-only",
      })
    );
  });

  it("fails closed before reading conversation state when client mirrors disagree", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-a",
        client_ref: "client-b",
        assignment_version: 7,
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
    });

    await expect(
      evaluateOpportunityAcceptance({
        supabase: client as never,
        providerThreadId: "provider-thread-1",
        opportunityId: "opportunity-1",
        connection,
      })
    ).rejects.toThrow("Opportunity client mirrors disagree");
    expect(mocks.buildConversationState).not.toHaveBeenCalled();
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
  });

  it("authorizes an outbound schedule confirmation only with that decisive message's signals", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "negotiation",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 8,
        address: "3277 Galloway Rd",
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      events: [
        {
          id: "event-accept",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-accept",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-06-12T17:00:00.000Z",
        },
        {
          id: "event-schedule",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-schedule",
          direction: "outbound",
          party_role: "ops",
          occurred_at: "2026-06-13T17:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-accept",
          subject: "Re: Installation",
          body_text: "I'll take you up on the install offer for $1,200.",
          body_text_clean: "I'll take you up on the install offer for $1,200.",
        },
        {
          email_connection_id: "connection-1",
          email_message_id: "message-schedule",
          subject: "Re: Installation",
          body_text: "Sure thing. Tomorrow is good still!",
          body_text_clean: "Sure thing. Tomorrow is good still!",
        },
      ],
    });

    await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        actualValue: 1200,
        evidence: expect.objectContaining({
          provider_message_id: "message-schedule",
          decisive_event_id: "event-schedule",
          decisive_direction: "outbound",
          evaluated_through_event_id: "event-schedule",
          signals: ["schedule_confirmed"],
        }),
      })
    );
  });

  it("relies on the canonical conversion outbox instead of an ad-hoc Won notification", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: null,
        assignment_version: 0,
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
    });

    await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection: { ...connection, userId: null },
    });

    expect(rpc).not.toHaveBeenCalledWith(
      "create_email_opportunity_notification_as_system",
      expect.objectContaining({ p_event_type: "accept_auto_won" })
    );
  });

  it("does not rebuild state for an active manually overridden lead", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "negotiation",
        stage_manually_set: true,
        client_id: null,
        assignment_version: 4,
      },
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.buildConversationState).not.toHaveBeenCalled();
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(mocks.linkOpportunityToExistingProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: false });
  });

  it("does not rebuild state for a final Won lead", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "won",
        stage_manually_set: false,
        client_id: null,
        assignment_version: 4,
      },
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.buildConversationState).not.toHaveBeenCalled();
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: false });
  });

  it("commits an explicit budget-and-timing deferral through the guarded disposition RPC", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "new_lead",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 9,
        address: "88 Example Rd",
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      events: [
        {
          id: "event-deferral-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "erick-deferral-message",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-21T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "erick-deferral-message",
          subject: "Re: Estimate",
          body_text:
            "The truck engine repairs consumed the funds, so I need to postpone this until next year.",
          body_text_clean:
            "The truck engine repairs consumed the funds, so I need to postpone this until next year.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "apply_email_opportunity_deferred_disposition"
        ? { data: [{ changed: true }], error: null }
        : { data: null, error: null }
    );
    mocks.buildConversationState.mockResolvedValue({
      accept: { detected: false, confidence: "low", basis: [] },
      stage: "new_lead",
      routing: { decision: "update_lead_only" },
      messages: [
        {
          providerMessageId: "erick-deferral-message",
          sentAt: "2026-07-21T18:00:00.000Z",
          direction: "inbound",
          cleanBody:
            "The truck engine repairs consumed the funds, so I need to postpone this until next year.",
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_email_opportunity_deferred_disposition",
      expect.objectContaining({
        p_company_id: "company-1",
        p_opportunity_id: "opportunity-1",
        p_connection_id: "connection-1",
        p_provider_message_id: "erick-deferral-message",
        p_expected_assignment_version: 9,
        p_expected_stage: "new_lead",
        p_evidence: expect.objectContaining({
          reason_code: "budget_timing",
          signals: expect.arrayContaining(["budget_timing_deferral"]),
        }),
      })
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: true });
  });

  it("uses the newest opportunity-wide decision across fragmented threads", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "negotiation",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 10,
        address: "88 Example Rd",
      },
      thread: { id: "thread-accept", provider_thread_id: "thread-accept" },
      events: [
        {
          id: "event-older-accept",
          connection_id: "connection-1",
          provider_thread_id: "thread-accept",
          provider_message_id: "message-older-accept",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-06-01T18:00:00.000Z",
        },
        {
          id: "event-newer-deferral",
          connection_id: "connection-1",
          provider_thread_id: "thread-deferral",
          provider_message_id: "message-newer-deferral",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-older-accept",
          subject: "Re: Estimate",
          body_text: "We accept the estimate. Please proceed.",
          body_text_clean: "We accept the estimate. Please proceed.",
        },
        {
          email_connection_id: "connection-1",
          email_message_id: "message-newer-deferral",
          subject: "Fwd: Project timing",
          body_text:
            "Truck repairs used the budget, so we need to postpone this until next year.",
          body_text_clean:
            "Truck repairs used the budget, so we need to postpone this until next year.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "apply_email_opportunity_deferred_disposition"
        ? {
            data: [{ changed: false, guard_reason: "follow_up_updated" }],
            error: null,
          }
        : { data: null, error: null }
    );

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "thread-accept",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_email_opportunity_deferred_disposition",
      expect.objectContaining({
        p_provider_message_id: "message-newer-deferral",
        p_evidence: expect.objectContaining({
          evaluated_through_event_id: "event-newer-deferral",
        }),
      })
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: false });
  });

  it("converts from the decisive thread when the trigger thread is only a placeholder", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "new_lead",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 14,
        address: "2745 Fernwood Rd",
      },
      threads: [
        {
          id: "thread-placeholder",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "thread-placeholder",
          opportunity_id: "opportunity-1",
        },
        {
          id: "thread-decisive",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "thread-decisive",
          opportunity_id: "opportunity-1",
        },
      ],
      events: [
        {
          id: "event-placeholder",
          connection_id: "connection-1",
          provider_thread_id: "thread-placeholder",
          provider_message_id: "message-placeholder",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-06-01T18:00:00.000Z",
        },
        {
          id: "event-decisive",
          connection_id: "connection-1",
          provider_thread_id: "thread-decisive",
          provider_message_id: "message-decisive",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-placeholder",
          subject: "Jennifer placeholder",
          body_text: "Please send details for the Fernwood railing.",
          body_text_clean: "Please send details for the Fernwood railing.",
        },
        {
          email_connection_id: "connection-1",
          email_message_id: "message-decisive",
          subject: "Re: 2745 Fernwood",
          body_text: "We accept the estimate. Please proceed.",
          body_text_clean: "We accept the estimate. Please proceed.",
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "thread-placeholder",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "new_lead",
        evidence: expect.objectContaining({
          email_thread_id: "thread-decisive",
          provider_thread_id: "thread-decisive",
          provider_message_id: "message-decisive",
          decisive_event_id: "event-decisive",
        }),
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("lets a newer inspected signed estimate reopen an automatic budget deferral", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "lost",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 15,
        address: "2745 Fernwood Rd",
      },
      thread: { id: "thread-signed", provider_thread_id: "thread-signed" },
      events: [
        {
          id: "event-old-deferral",
          connection_id: "connection-1",
          provider_thread_id: "thread-deferral",
          provider_message_id: "message-old-deferral",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-06-01T18:00:00.000Z",
        },
        {
          id: "event-new-signed",
          connection_id: "connection-1",
          provider_thread_id: "thread-signed",
          provider_message_id: "message-new-signed",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-old-deferral",
          subject: "Re: Timing",
          body_text:
            "Truck repairs used the budget, so postpone this until next year.",
          body_text_clean:
            "Truck repairs used the budget, so postpone this until next year.",
        },
        {
          email_connection_id: "connection-1",
          email_message_id: "message-new-signed",
          subject: "Signed estimate",
          body_text: "Attached.",
          body_text_clean: "Attached.",
        },
      ],
    });
    mocks.buildConversationState.mockResolvedValue({
      accept: {
        detected: true,
        confidence: "high",
        basis: ["signed_estimate_attachment"],
      },
      stage: "lost",
      routing: { decision: "draft" },
      messages: [
        {
          providerMessageId: "message-new-signed",
          fromEmail: "customer@example.com",
          isRealCustomerInbound: true,
          attachments: [{ inspection: { isSignedEstimate: true } }],
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "thread-signed",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "lost",
        expectedAssignmentVersion: 15,
        evidence: expect.objectContaining({
          provider_message_id: "message-new-signed",
          decisive_event_id: "event-new-signed",
          evaluated_through_event_id: "event-new-signed",
          signals: ["signed_estimate"],
        }),
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it.each([
    {
      name: "payment reversal",
      body: "The deposit was received and then refunded.",
    },
    {
      name: "unresolved acceptance and deferral",
      body: "We are ready to proceed and we also need to postpone until next year because the budget is tight.",
    },
  ])(
    "does not let an older signed estimate override a newer $name",
    async ({ body }) => {
      const { client } = makeSupabase({
        opportunity: {
          stage: "quoted",
          stage_manually_set: false,
          client_id: "client-1",
          assignment_version: 16,
          address: "88 Example Rd",
        },
        thread: { id: "thread-signed", provider_thread_id: "thread-signed" },
        events: [
          {
            id: "event-old-signed",
            connection_id: "connection-1",
            provider_thread_id: "thread-signed",
            provider_message_id: "message-old-signed",
            direction: "inbound",
            party_role: "customer",
            occurred_at: "2026-06-01T18:00:00.000Z",
          },
          {
            id: "event-newer-unresolved",
            connection_id: "connection-1",
            provider_thread_id: "thread-newer",
            provider_message_id: "message-newer-unresolved",
            direction: "inbound",
            party_role: "customer",
            occurred_at: "2026-07-01T18:00:00.000Z",
          },
        ],
        activities: [
          {
            email_connection_id: "connection-1",
            email_message_id: "message-old-signed",
            subject: "Signed estimate",
            body_text: "Attached.",
            body_text_clean: "Attached.",
          },
          {
            email_connection_id: "connection-1",
            email_message_id: "message-newer-unresolved",
            subject: "Re: Estimate",
            body_text: body,
            body_text_clean: body,
          },
        ],
      });
      mocks.buildConversationState.mockResolvedValue({
        accept: {
          detected: true,
          confidence: "high",
          basis: ["signed_estimate_attachment"],
        },
        stage: "quoted",
        routing: { decision: "draft" },
        messages: [
          {
            providerMessageId: "message-old-signed",
            fromEmail: "customer@example.com",
            isRealCustomerInbound: true,
            attachments: [{ inspection: { isSignedEstimate: true } }],
          },
        ],
      });

      const result = await evaluateOpportunityAcceptance({
        supabase: client as never,
        providerThreadId: "thread-signed",
        opportunityId: "opportunity-1",
        connection,
      });

      expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
      expect(mocks.linkOpportunityToExistingProject).not.toHaveBeenCalled();
      expect(result).toEqual({ stageChanged: false });
    }
  );

  it("does not replay quoted acceptance from a reply whose cleaned body is empty", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 16,
        address: "88 Example Rd",
      },
      thread: {
        id: "thread-quote-only",
        provider_thread_id: "thread-quote-only",
      },
      events: [
        {
          id: "event-quote-only",
          connection_id: "connection-1",
          provider_thread_id: "thread-quote-only",
          provider_message_id: "message-quote-only",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-quote-only",
          subject: "Re: Estimate",
          body_text:
            "On Jun 30, Customer wrote:\nWe accept the estimate. Please proceed.",
          body_text_clean: "",
        },
      ],
    });
    mocks.buildConversationState.mockResolvedValue({
      accept: {
        detected: true,
        confidence: "high",
        basis: ["explicit_accept_language"],
      },
      stage: "quoted",
      routing: { decision: "draft" },
      messages: [],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "thread-quote-only",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(mocks.linkOpportunityToExistingProject).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "create_email_opportunity_notification_as_system",
      expect.objectContaining({ p_event_type: "accept_review_won" })
    );
    expect(result).toEqual({ stageChanged: false });
  });

  it("reopens an automatically deferred cycle when newer customer acceptance wins", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "lost",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 12,
        address: "88 Example Rd",
      },
      thread: { id: "thread-accept", provider_thread_id: "thread-accept" },
      events: [
        {
          id: "event-older-deferral",
          connection_id: "connection-1",
          provider_thread_id: "thread-deferral",
          provider_message_id: "message-older-deferral",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-06-01T18:00:00.000Z",
        },
        {
          id: "event-newer-accept",
          connection_id: "connection-1",
          provider_thread_id: "thread-accept",
          provider_message_id: "message-newer-accept",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-older-deferral",
          subject: "Re: Estimate",
          body_text:
            "Truck repairs used the budget, so we need to postpone this until next year.",
          body_text_clean:
            "Truck repairs used the budget, so we need to postpone this until next year.",
        },
        {
          email_connection_id: "connection-1",
          email_message_id: "message-newer-accept",
          subject: "Re: Estimate",
          body_text:
            "The budget is ready now. We accept the estimate. Please proceed.",
          body_text_clean:
            "The budget is ready now. We accept the estimate. Please proceed.",
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "thread-accept",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "lost",
        expectedAssignmentVersion: 12,
        evidence: expect.objectContaining({
          provider_message_id: "message-newer-accept",
          decisive_event_id: "event-newer-accept",
          evaluated_through_event_id: "event-newer-accept",
        }),
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("commits a later budget re-deferral without treating lost as permanently inert", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "lost",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 13,
        address: "88 Example Rd",
      },
      thread: { id: "thread-deferral", provider_thread_id: "thread-deferral" },
      events: [
        {
          id: "event-older-deferral",
          connection_id: "connection-1",
          provider_thread_id: "thread-deferral",
          provider_message_id: "message-older-deferral",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-06-01T18:00:00.000Z",
        },
        {
          id: "event-newer-redeferral",
          connection_id: "connection-1",
          provider_thread_id: "thread-deferral",
          provider_message_id: "message-newer-redeferral",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-older-deferral",
          subject: "Re: Timing",
          body_text:
            "The repair budget means we need to postpone this until next year.",
          body_text_clean:
            "The repair budget means we need to postpone this until next year.",
        },
        {
          email_connection_id: "connection-1",
          email_message_id: "message-newer-redeferral",
          subject: "Re: Timing",
          body_text:
            "The truck repair budget is still tied up, so we need to postpone this until next year.",
          body_text_clean:
            "The truck repair budget is still tied up, so we need to postpone this until next year.",
        },
      ],
    });
    rpc.mockImplementation(async (name: string) =>
      name === "apply_email_opportunity_deferred_disposition"
        ? { data: [{ changed: true }], error: null }
        : { data: null, error: null }
    );

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "thread-deferral",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_email_opportunity_deferred_disposition",
      expect.objectContaining({
        p_provider_message_id: "message-newer-redeferral",
        p_expected_stage: "lost",
        p_expected_assignment_version: 13,
        p_evidence: expect.objectContaining({
          evaluated_through_event_id: "event-newer-redeferral",
        }),
      })
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: true });
  });

  it("holds conversion when a trusted durable event has no activity body to evaluate", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 10,
        address: "88 Example Rd",
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      events: [
        {
          id: "event-without-activity",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-without-activity",
          direction: "inbound",
          party_role: "customer",
          occurred_at: "2026-07-21T18:00:00.000Z",
        },
      ],
      activities: [],
    });

    await expect(
      evaluateOpportunityAcceptance({
        supabase: client as never,
        providerThreadId: "provider-thread-1",
        opportunityId: "opportunity-1",
        connection,
      })
    ).rejects.toThrow(
      "commercial evidence activity missing for event event-without-activity"
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(mocks.linkOpportunityToExistingProject).not.toHaveBeenCalled();
  });

  it("does not let an unrelated external participant authorize conversion on a linked thread", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        contact_email: "customer@example.com",
        assignment_version: 10,
        address: "88 Example Rd",
      },
      client: { email: "customer@example.com" },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      events: [
        {
          id: "event-vendor-acceptance",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-vendor-acceptance",
          direction: "inbound",
          party_role: "customer",
          from_email: "vendor@example.net",
          occurred_at: "2026-07-21T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-vendor-acceptance",
          subject: "Re: Deposit",
          body_text: "We accept. The deposit payment has been sent.",
          body_text_clean: "We accept. The deposit payment has been sent.",
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(mocks.linkOpportunityToExistingProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: false });
  });

  it("does not let an unrelated external participant's signed attachment authorize conversion", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
        contact_email: "customer@example.com",
        assignment_version: 10,
        address: "88 Example Rd",
      },
      client: { email: "customer@example.com" },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      events: [
        {
          id: "event-vendor-signed",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "message-vendor-signed",
          direction: "inbound",
          party_role: "customer",
          from_email: "vendor@example.net",
          occurred_at: "2026-07-21T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "message-vendor-signed",
          subject: "Signed estimate",
          body_text: "Attached.",
          body_text_clean: "Attached.",
        },
      ],
    });
    mocks.buildConversationState.mockResolvedValue({
      accept: {
        detected: true,
        confidence: "high",
        basis: ["signed_estimate_attachment"],
      },
      stage: "quoted",
      routing: { decision: "draft" },
      messages: [
        {
          providerMessageId: "message-vendor-signed",
          fromEmail: "vendor@example.net",
          isRealCustomerInbound: true,
          attachments: [{ inspection: { isSignedEstimate: true } }],
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(mocks.linkOpportunityToExistingProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: false });
  });

  it("links a unique same-client same-address project instead of creating a duplicate", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "new_lead",
        stage_manually_set: false,
        client_id: "client-1",
        assignment_version: 11,
        address: "2745 Fernwood Rd",
      },
      thread: { id: "thread-1", provider_thread_id: "provider-thread-1" },
      events: [
        {
          id: "event-owen-payment",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          provider_message_id: "owen-payment-message",
          direction: "outbound",
          party_role: "ops",
          occurred_at: "2026-07-21T18:00:00.000Z",
        },
      ],
      activities: [
        {
          email_connection_id: "connection-1",
          email_message_id: "owen-payment-message",
          subject: "Re: Deposit",
          body_text: "We received and confirmed your 50% deposit payment.",
          body_text_clean:
            "We received and confirmed your 50% deposit payment.",
        },
      ],
    });
    mocks.findUniqueExistingProjectForEmailConversion.mockResolvedValue(
      "project-1"
    );
    mocks.buildConversationState.mockResolvedValue({
      accept: { detected: true, confidence: "high", basis: [] },
      stage: "new_lead",
      routing: { decision: "draft" },
      messages: [
        {
          providerMessageId: "owen-payment-message",
          sentAt: "2026-07-21T18:00:00.000Z",
          direction: "outbound",
          cleanBody: "We received and confirmed your 50% deposit payment.",
        },
      ],
    });

    const result = await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection,
    });

    expect(
      mocks.findUniqueExistingProjectForEmailConversion
    ).toHaveBeenCalledWith({
      supabase: client,
      companyId: "company-1",
      opportunityId: "opportunity-1",
      clientId: "client-1",
      clientRef: null,
      opportunityAddress: "2745 Fernwood Rd",
    });
    expect(mocks.linkOpportunityToExistingProject).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opportunity-1",
        linkToProjectId: "project-1",
        expectedAssignmentVersion: 11,
      })
    );
    expect(mocks.convertOpportunityToProject).not.toHaveBeenCalled();
    expect(result).toEqual({ stageChanged: true });
  });
});
