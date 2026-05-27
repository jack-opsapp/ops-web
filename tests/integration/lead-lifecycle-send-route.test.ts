import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getServiceRoleClientMock,
  getConnectionMock,
  getProviderMock,
  upsertFromEmailMock,
  dismissAwaitingReplyMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
  dismissAwaitingReplyMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getConnections: vi.fn(),
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: upsertFromEmailMock,
    dismissAwaitingReply: dismissAwaitingReplyMock,
  },
}));

import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { POST } from "@/app/api/integrations/email/send/route";

interface SendRouteState {
  activities: Array<Record<string, unknown>>;
  opportunityUpdates: Array<Record<string, unknown>>;
  threadLinks: Array<Record<string, unknown>>;
  correspondenceEvents: Array<Record<string, unknown>>;
  lifecycleStateUpserts: Array<Record<string, unknown>>;
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("https://ops.test/api/integrations/email/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-cron-secret",
    },
    body: JSON.stringify(body),
  });
}

function makeSupabaseDouble(state: SendRouteState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Record<string, unknown> | null = null;
    private filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    gte(column: string, value: unknown) {
      this.filters.set(`${column}:gte`, value);
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      if (this.table === "activities") state.activities.push(payload);
      if (this.table === "opportunity_correspondence_events") {
        state.correspondenceEvents.push({
          id: `event-${state.correspondenceEvents.length + 1}`,
          ...payload,
        });
      }
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "opportunities") state.opportunityUpdates.push(payload);
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads") state.threadLinks.push(payload);
      if (this.table === "opportunity_lifecycle_state") {
        state.lifecycleStateUpserts.push(payload);
      }
      return this;
    }

    async single() {
      if (this.table === "companies") {
        return {
          data: {
            subscription_plan: "team",
            subscription_status: "active",
            trial_end_date: null,
            seated_employee_ids: ["user-1"],
            admin_ids: ["user-1"],
            max_seats: 10,
          },
          error: null,
        };
      }
      if (this.table === "opportunities") {
        return {
          data: {
            correspondence_count: 2,
            outbound_count: 1,
            last_outbound_at: "2026-05-20T17:00:00.000Z",
          },
          error: null,
        };
      }
      return { data: this.payload, error: null };
    }

    async maybeSingle() {
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "activities" && this.action === "select") {
        return { data: null, count: 0, error: null };
      }
      if (this.table === "opportunity_correspondence_events") {
        return { data: [], error: null };
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
  };
}

describe("lead lifecycle send route event writes", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    setSupabaseOverride(null);
    getServiceRoleClientMock.mockReset();
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    upsertFromEmailMock.mockReset();
    dismissAwaitingReplyMock.mockReset();
    upsertFromEmailMock.mockResolvedValue({
      threadRow: {
        id: "thread-row-1",
        latestDirection: "outbound",
        labels: ["AWAITING_REPLY"],
      },
    });
    dismissAwaitingReplyMock.mockResolvedValue(["CUSTOMER"]);
  });

  it("creates an outbound meaningful correspondence event after provider ids validate", async () => {
    const state: SendRouteState = {
      activities: [],
      opportunityUpdates: [],
      threadLinks: [],
      correspondenceEvents: [],
      lifecycleStateUpserts: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      userId: "user-1",
      email: "jackson@canprodeckandrail.com",
      provider: "gmail",
      status: "active",
      opsLabelId: null,
      syncFilters: {
        companyDomains: ["canprodeckandrail.com"],
        userEmailAddresses: ["jackson@canprodeckandrail.com"],
      },
    });
    getProviderMock.mockReturnValue({
      sendEmail: vi.fn(async () => ({
        messageId: "msg-send-1",
        threadId: "thread-send-1",
      })),
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await POST(
      makeRequest({
        userId: "user-1",
        companyId: "company-1",
        connectionId: "connection-1",
        to: ["kara.beach@example.com"],
        subject: "Deck quote follow-up",
        body: "Checking in on the quote.",
        opportunityId: "opp-1",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        opportunity_id: "opp-1",
        connection_id: "connection-1",
        provider_thread_id: "thread-send-1",
        provider_message_id: "msg-send-1",
        direction: "outbound",
        party_role: "ops",
        is_meaningful: true,
        noise_reason: null,
        source: "email_send",
      }),
    ]);
  });
});
