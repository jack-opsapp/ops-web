import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConnection } from "@/lib/types/email-connection";

const mocks = vi.hoisted(() => ({
  buildConversationState: vi.fn(),
  persistRoutingDecision: vi.fn(),
  decideAcceptStage: vi.fn(),
  convertOpportunityToProject: vi.fn(),
  getCompanyManagerUserIds: vi.fn(),
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

vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: mocks.getCompanyManagerUserIds,
}));

import { evaluateOpportunityAcceptance } from "@/lib/api/services/conversation-state/acceptance-evaluation";

type Row = Record<string, unknown>;

function makeSupabase(input: {
  opportunity?: Row | null;
  thread?: Row | null;
  client?: Row | null;
}) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const rpc = vi.fn(async () => ({ data: null, error: null }));

  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    query.select = () => query;
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

  return { client: { from, rpc }, filters, rpc };
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
  mocks.getCompanyManagerUserIds.mockResolvedValue(["manager-1"]);
});

describe("evaluateOpportunityAcceptance", () => {
  it("re-evaluates a signed attachment and converts the exact mailbox lead", async () => {
    const { client, filters, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: "client-1",
      },
      thread: { id: "thread-1" },
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
        expectedStage: "quoted",
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      "create_notification_if_new",
      expect.objectContaining({
        p_user_id: "user-1",
        p_dedupe_key: "email-accept:auto-won:opportunity-1",
      })
    );
    expect(result).toEqual({ stageChanged: true });
  });

  it("notifies company managers for a shared mailbox", async () => {
    const { client, rpc } = makeSupabase({
      opportunity: {
        stage: "quoted",
        stage_manually_set: false,
        client_id: null,
      },
      thread: { id: "thread-1" },
    });

    await evaluateOpportunityAcceptance({
      supabase: client as never,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      connection: { ...connection, userId: null },
    });

    expect(mocks.getCompanyManagerUserIds).toHaveBeenCalledWith(
      client,
      "company-1"
    );
    expect(rpc).toHaveBeenCalledWith(
      "create_notification_if_new",
      expect.objectContaining({ p_user_id: "manager-1" })
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
