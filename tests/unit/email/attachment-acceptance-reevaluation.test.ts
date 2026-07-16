import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConnection } from "@/lib/types/email-connection";

const mocks = vi.hoisted(() => ({
  buildConversationState: vi.fn(),
  persistRoutingDecision: vi.fn(),
  decideAcceptStage: vi.fn(),
  convertOpportunityToProject: vi.fn(),
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
  ProjectConversionService: {
    convertOpportunityToProject: mocks.convertOpportunityToProject,
  },
}));

import { evaluateOpportunityAcceptance } from "@/lib/api/services/conversation-state/acceptance-evaluation";

type Row = Record<string, unknown>;

function makeSupabase(input: {
  opportunity?: Row | null;
  thread?: Row | null;
  client?: Row | null;
}) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const selects: Array<{ table: string; columns: string }> = [];
  const rpc = vi.fn(async () => ({ data: null, error: null }));

  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    query.select = (columns: string) => {
      selects.push({ table, columns });
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      filters.push({ table, column, value });
      return query;
    };
    query.maybeSingle = async () => ({
      data:
        table === "opportunities"
          ? (input.opportunity ?? null)
          : table === "email_threads"
            ? (input.thread ?? null)
            : table === "clients"
              ? (input.client ?? null)
              : null,
      error: null,
    });
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
  });
  mocks.persistRoutingDecision.mockResolvedValue(undefined);
  mocks.decideAcceptStage.mockReturnValue({
    kind: "auto_advance_won",
    reason: "signed estimate",
  });
  mocks.convertOpportunityToProject.mockResolvedValue({ won: true });
});

describe("evaluateOpportunityAcceptance", () => {
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
      columns: "stage, stage_manually_set, client_id, assignment_version",
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
          decision: "auto_advance_won",
        },
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      "create_email_opportunity_notification_as_system",
      {
        p_opportunity_id: "opportunity-1",
        p_connection_id: "connection-1",
        p_provider_thread_id: "provider-thread-1",
        p_expected_assignment_version: 7,
        p_event_type: "accept_auto_won",
      }
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("does not invent a human recipient for an unassigned shared mailbox", async () => {
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

    expect(rpc).toHaveBeenCalledWith(
      "create_email_opportunity_notification_as_system",
      expect.not.objectContaining({
        p_recipient_user_id: expect.anything(),
        p_company_id: expect.anything(),
      })
    );
  });

  it("does not rebuild state for a manual or terminal lead", async () => {
    const { client } = makeSupabase({
      opportunity: {
        stage: "won",
        stage_manually_set: true,
        client_id: null,
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
});
