import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

const {
  getConnectionMock,
  getProviderMock,
  updateConnectionMock,
  matchMock,
  buildBlocklistMock,
  shouldFilterMock,
  reviewUnmatchedEmailsMock,
  evaluateStagesWithSummaryMock,
  upsertFromEmailMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  updateConnectionMock: vi.fn(),
  matchMock: vi.fn(),
  buildBlocklistMock: vi.fn(),
  shouldFilterMock: vi.fn(),
  reviewUnmatchedEmailsMock: vi.fn(),
  evaluateStagesWithSummaryMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
    updateConnection: updateConnectionMock,
  },
}));

vi.mock("@/lib/api/services/email-matching-service-v2", () => ({
  EmailMatchingServiceV2: {
    match: matchMock,
  },
}));

vi.mock("@/lib/api/services/email-filter-service", () => ({
  EmailFilterService: {
    buildBlocklist: buildBlocklistMock,
    shouldFilter: shouldFilterMock,
  },
}));

vi.mock("@/lib/api/services/ai-sync-reviewer", () => ({
  AISyncReviewer: {
    reviewUnmatchedEmails: reviewUnmatchedEmailsMock,
    evaluateStagesWithSummary: evaluateStagesWithSummaryMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: upsertFromEmailMock,
    classifyAndUpdate: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    checkMilestonesAfterSync: vi.fn(),
  },
}));

import { SyncEngine } from "@/lib/api/services/sync-engine";

interface SupabaseState {
  clients: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  threadLinks: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: SupabaseState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    ilike(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    like(column: string, value: unknown) {
      this.filters.set(`${column}:like`, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    or(value: string) {
      this.filters.set("or", value);
      return this;
    }

    not(column: string, operator: string, value: unknown) {
      this.filters.set(`${column}:${operator}`, value);
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      if (this.table === "clients") {
        state.clients.push({
          id: `client-${state.clients.length + 1}`,
          ...payload,
        });
      }
      if (this.table === "opportunities") {
        state.opportunities.push({
          id: `opp-${state.opportunities.length + 1}`,
          created_at: "2026-05-25T00:00:00.000Z",
          updated_at: "2026-05-25T00:00:00.000Z",
          stage_entered_at: "2026-05-25T00:00:00.000Z",
          ...payload,
        });
      }
      if (this.table === "activities") {
        state.activities.push({
          id: `activity-${state.activities.length + 1}`,
          ...payload,
        });
      }
      return this;
    }

    update() {
      this.action = "update";
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      if (this.table === "opportunity_email_threads")
        state.threadLinks.push(payload);
      return this;
    }

    async single() {
      if (this.table === "clients" && this.action === "insert") {
        return { data: state.clients.at(-1), error: null };
      }
      if (this.table === "opportunities" && this.action === "insert") {
        return { data: state.opportunities.at(-1), error: null };
      }
      if (this.table === "activities" && this.action === "insert") {
        return { data: state.activities.at(-1), error: null };
      }
      if (this.table === "companies") {
        return {
          data: { name: "Canpro Deck and Rail", industry: "deck and rail" },
          error: null,
        };
      }
      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "clients") {
        const id = this.filters.get("id");
        const client = state.clients.find((row) => row.id === id) ?? null;
        return { data: client, error: null };
      }
      if (this.table === "opportunities") {
        const id = this.filters.get("id");
        const opportunity =
          state.opportunities.find((row) => row.id === id) ?? null;
        return { data: opportunity, error: null };
      }
      if (this.table === "opportunity_email_threads") {
        const link =
          state.threadLinks.find(
            (row) =>
              row.thread_id === this.filters.get("thread_id") &&
              row.connection_id === this.filters.get("connection_id")
          ) ?? null;
        return { data: link, error: null };
      }
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "email_connections" && this.action === "update") {
        return { data: [{ id: "connection-1" }], error: null };
      }
      if (this.table === "activities" && this.action === "select")
        return { data: [], error: null };
      if (this.table === "opportunities" && this.action === "select")
        return { data: [], error: null };
      if (this.table === "clients" && this.action === "select") {
        const email = String(this.filters.get("email") ?? "").toLowerCase();
        const matches = state.clients.filter(
          (client) => String(client.email).toLowerCase() === email
        );
        return { data: matches, error: null };
      }
      if (
        this.table === "opportunity_email_threads" &&
        this.action === "select"
      ) {
        return {
          data: state.threadLinks.filter(
            (row) =>
              row.thread_id === this.filters.get("thread_id") &&
              row.connection_id === this.filters.get("connection_id")
          ),
          error: null,
        };
      }
      return { data: null, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "acquire_email_connection_sync_lock_as_system") {
        return {
          data: "00000000-0000-4000-8000-000000000001",
          error: null,
        };
      }
      if (
        name === "renew_email_connection_sync_lock_as_system" ||
        name === "release_email_connection_sync_lock_as_system" ||
        name === "persist_email_connection_recovery_checkpoint_as_system" ||
        name === "persist_email_connection_sync_completion_as_system"
      ) {
        return { data: true, error: null };
      }
      return {
        data:
          name === "apply_opportunity_correspondence_event"
            ? [
                {
                  changed: true,
                  correspondence_count: 1,
                  inbound_count: 0,
                  outbound_count: 1,
                  stage: "qualifying",
                  stage_manually_set: false,
                  last_message_direction: "out",
                  last_inbound_at: null,
                  last_outbound_at: "2026-05-25T23:05:00.000Z",
                },
              ]
            : name === "apply_email_opportunity_stage_transition"
              ? [{ changed: true }]
              : null,
        error: null,
      };
    }),
  };
}

function baseConnection(): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "canprojack@gmail.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2026-05-25T00:00:00.000Z"),
    historyId: "sync-token",
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {
      includeSentMail: true,
      estimateSubjectPatterns: ["Canpro Deck and Rail Estimate"],
      companyDomains: ["canprodeckandrail.com"],
      userEmailAddresses: [],
      teamForwarders: ["victoria@canprodeckandrail.com"],
    },
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
  };
}

function sentEstimateEmail(): NormalizedEmail {
  return {
    id: "msg-live-pattern",
    threadId: "thread-live-pattern",
    from: "Jackson Sweet <canprojack@gmail.com>",
    fromName: "Jackson Sweet",
    to: ["runningemu@gmail.com"],
    cc: [],
    subject: "Canpro Deck and Rail Estimate",
    snippet: "Estimate details",
    bodyText: "Hi Michael, thanks for your email.",
    date: new Date("2026-05-25T23:05:00.000Z"),
    labelIds: ["SENT"],
    isRead: true,
    hasAttachments: false,
    sizeEstimate: 1200,
  };
}

describe("SyncEngine live email opportunity title pattern", () => {
  beforeEach(() => {
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    updateConnectionMock.mockReset();
    matchMock.mockReset();
    buildBlocklistMock.mockResolvedValue({});
    shouldFilterMock.mockReturnValue(false);
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [],
      newLeadsClassified: 0,
    });
    evaluateStagesWithSummaryMock.mockResolvedValue([]);
    upsertFromEmailMock.mockResolvedValue({
      isNew: false,
      threadRow: {
        id: "email-thread-1",
        categoryConfidence: 1,
        categoryManuallySet: true,
      },
    });
  });

  afterEach(() => {
    setSupabaseOverride(null);
  });

  it("labels sent-folder safety-net leads from the external recipient when the operator uses a Gmail mailbox", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [sentEstimateEmail()],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("runningemu — Estimate");
    expect(state.opportunities[0].title).not.toContain("Jackson Sweet");
  });
});
