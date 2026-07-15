import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getServiceRoleClientMock,
  getConnectionMock,
  getProviderMock,
  upsertFromEmailMock,
  dismissAwaitingReplyMock,
  enqueueIfEnabledMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
  dismissAwaitingReplyMock: vi.fn(),
  enqueueIfEnabledMock: vi.fn(),
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

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled = enqueueIfEnabledMock;
  },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: vi.fn(async () => ({
    recordId: "signature-1",
    source: "ops",
    scope: "mailbox",
    html: "<div>Jackson<br>Canpro</div>",
    text: "Jackson\nCanpro",
    hash: "a".repeat(64),
    providerIdentity: null,
  })),
}));

import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { POST } from "@/app/api/integrations/email/send/route";

interface SendRouteState {
  activities: Array<Record<string, unknown>>;
  opportunityUpdates: Array<Record<string, unknown>>;
  threadLinks: Array<Record<string, unknown>>;
  correspondenceEvents: Array<Record<string, unknown>>;
  lifecycleStateUpserts: Array<Record<string, unknown>>;
  canonicalThreadOwnerId?: string | null;
  canonicalThreadOwnerSequence?: Array<string | null>;
  activityInsertError?: { code?: string; message: string } | null;
  activityLookupRows?: Array<Record<string, unknown>>;
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

    is(column: string, value: unknown) {
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
      if (this.table === "activities" && !state.activityInsertError) {
        state.activities.push(payload);
      }
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
      if (this.table === "opportunities")
        state.opportunityUpdates.push(payload);
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads") {
        state.threadLinks.push(payload);
        state.canonicalThreadOwnerId ??=
          (payload.opportunity_id as string | null | undefined) ?? null;
      }
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
      if (this.table === "activities" && this.action === "insert") {
        if (state.activityInsertError) {
          return { data: null, error: state.activityInsertError };
        }
        return {
          data: { id: "activity-inserted", ...this.payload },
          error: null,
        };
      }
      return { data: this.payload, error: null };
    }

    async maybeSingle() {
      if (this.table === "opportunities") {
        return {
          data: { id: this.filters.get("id") ?? "opp-1" },
          error: null,
        };
      }
      if (this.table === "opportunity_email_threads") {
        const sequencedOwner = state.canonicalThreadOwnerSequence?.length
          ? state.canonicalThreadOwnerSequence.shift()
          : undefined;
        const owner =
          sequencedOwner !== undefined
            ? sequencedOwner
            : state.canonicalThreadOwnerId;
        return {
          data: owner ? { opportunity_id: owner } : null,
          error: null,
        };
      }
      if (this.table === "ai_draft_history") {
        return {
          data: {
            id: this.filters.get("id") ?? "draft-1",
            company_id: this.filters.get("company_id") ?? "company-1",
            user_id: this.filters.get("user_id") ?? "user-1",
            opportunity_id: "opp-1",
            connection_id: "connection-1",
            thread_id: null,
            status: "drafted",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "activities" && this.action === "select") {
        if (this.filters.has("email_message_id")) {
          return { data: state.activityLookupRows ?? [], error: null };
        }
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
    rpc: vi.fn(async () => ({
      data: [{ changed: true }],
      error: null,
    })),
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
    enqueueIfEnabledMock.mockReset();
    enqueueIfEnabledMock.mockResolvedValue(null);
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
    const supabase = makeSupabaseDouble(state);
    getServiceRoleClientMock.mockReturnValue(supabase);
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
        draftHistoryId: "draft-1",
      }) as never
    );

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      company_id: "company-1",
      email_connection_id: "connection-1",
      email_message_id: "msg-send-1",
      created_at: responseBody.sentAt,
    });
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
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        connectionId: "connection-1",
        providerMessageId: "msg-send-1",
        providerThreadId: "thread-send-1",
        userId: "user-1",
        bodyText: "Checking in on the quote.",
        subject: "Deck quote follow-up",
        draftHistoryId: "draft-1",
        opportunityId: "opp-1",
      })
    );
  });

  it("rejects a conflicting canonical thread owner before writing CRM records", async () => {
    const state: SendRouteState = {
      activities: [],
      opportunityUpdates: [],
      threadLinks: [],
      correspondenceEvents: [],
      lifecycleStateUpserts: [],
      canonicalThreadOwnerId: "opp-2",
    };
    const supabase = makeSupabaseDouble(state);
    getServiceRoleClientMock.mockReturnValue(supabase);
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      userId: "user-1",
      email: "jackson@canprodeckandrail.com",
      provider: "gmail",
      status: "active",
      opsLabelId: null,
      syncFilters: {},
    });
    const sendEmailMock = vi.fn(async () => ({
      messageId: "msg-send-conflict",
      threadId: "thread-owned-by-opp-2",
    }));
    getProviderMock.mockReturnValue({
      sendEmail: sendEmailMock,
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await POST(
      makeRequest({
        userId: "user-1",
        companyId: "company-1",
        connectionId: "connection-1",
        to: ["customer@example.com"],
        subject: "Existing thread",
        body: "Replying on the existing thread.",
        opportunityId: "opp-1",
        threadId: "thread-owned-by-opp-2",
      }) as never
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "EMAIL_THREAD_OWNERSHIP_CONFLICT",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.activities).toHaveLength(0);
    expect(state.correspondenceEvents).toHaveLength(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(upsertFromEmailMock).not.toHaveBeenCalled();
  });

  it("adopts the canonical thread owner when the caller did not assert an opportunity", async () => {
    const state: SendRouteState = {
      activities: [],
      opportunityUpdates: [],
      threadLinks: [],
      correspondenceEvents: [],
      lifecycleStateUpserts: [],
      canonicalThreadOwnerId: "opp-2",
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
      syncFilters: {},
    });
    getProviderMock.mockReturnValue({
      sendEmail: vi.fn(async () => ({
        messageId: "msg-send-adopted",
        threadId: "thread-owned-by-opp-2",
      })),
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await POST(
      makeRequest({
        userId: "user-1",
        companyId: "company-1",
        connectionId: "connection-1",
        to: ["customer@example.com"],
        subject: "Existing thread",
        body: "Replying on the existing thread.",
        threadId: "thread-owned-by-opp-2",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(state.activities).toEqual([
      expect.objectContaining({ opportunity_id: "opp-2" }),
    ]);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({ opportunity_id: "opp-2" }),
    ]);
    expect(upsertFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: "opp-2" })
    );
  });

  it("adopts a same-company owner that wins after the provider send without reporting a retryable failure", async () => {
    const state: SendRouteState = {
      activities: [],
      opportunityUpdates: [],
      threadLinks: [],
      correspondenceEvents: [],
      lifecycleStateUpserts: [],
      canonicalThreadOwnerSequence: [null, "opp-2"],
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
      syncFilters: {},
    });
    const sendEmailMock = vi.fn(async () => ({
      messageId: "msg-send-race",
      threadId: "thread-race",
    }));
    getProviderMock.mockReturnValue({
      sendEmail: sendEmailMock,
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await POST(
      makeRequest({
        userId: "user-1",
        companyId: "company-1",
        connectionId: "connection-1",
        to: ["customer@example.com"],
        subject: "Concurrent owner",
        body: "This message must be recorded exactly once.",
        opportunityId: "opp-1",
        threadId: "thread-race",
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      threadOwnershipReconciled: true,
      opportunityId: "opp-2",
    });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(state.activities).toEqual([
      expect.objectContaining({ opportunity_id: "opp-2" }),
    ]);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({ opportunity_id: "opp-2" }),
    ]);
  });

  it("adopts the unique same-mailbox activity when provider sync wins after delivery", async () => {
    const state: SendRouteState = {
      activities: [],
      opportunityUpdates: [],
      threadLinks: [],
      correspondenceEvents: [],
      lifecycleStateUpserts: [],
      activityInsertError: {
        code: "23505",
        message:
          "duplicate key value violates unique constraint activities_email_provider_identity_unique",
      },
      activityLookupRows: [
        {
          id: "activity-sync-winner",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_message_id: "msg-send-activity-race",
          email_thread_id: "thread-send-activity-race",
          opportunity_id: "opp-1",
          type: "email",
          direction: "outbound",
        },
      ],
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
      syncFilters: {},
    });
    const sendEmailMock = vi.fn(async () => ({
      messageId: "msg-send-activity-race",
      threadId: "thread-send-activity-race",
    }));
    getProviderMock.mockReturnValue({
      sendEmail: sendEmailMock,
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await POST(
      makeRequest({
        userId: "user-1",
        companyId: "company-1",
        connectionId: "connection-1",
        to: ["customer@example.com"],
        subject: "Concurrent provider sync",
        body: "The provider accepted this once.",
        opportunityId: "opp-1",
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      messageId: "msg-send-activity-race",
    });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(state.activities).toHaveLength(0);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        activity_id: "activity-sync-winner",
        company_id: "company-1",
        connection_id: "connection-1",
        provider_message_id: "msg-send-activity-race",
      }),
    ]);
  });

  it.each([
    {
      label: "another company",
      rows: [
        {
          id: "activity-wrong-company",
          company_id: "company-2",
          email_connection_id: "connection-1",
          email_message_id: "msg-send-invalid-winner",
          email_thread_id: "thread-send-invalid-winner",
          type: "email",
          direction: "outbound",
        },
      ],
    },
    {
      label: "another mailbox",
      rows: [
        {
          id: "activity-wrong-mailbox",
          company_id: "company-1",
          email_connection_id: "connection-2",
          email_message_id: "msg-send-invalid-winner",
          email_thread_id: "thread-send-invalid-winner",
          type: "email",
          direction: "outbound",
        },
      ],
    },
    {
      label: "ambiguous same-mailbox duplicates",
      rows: [
        {
          id: "activity-duplicate-1",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_message_id: "msg-send-invalid-winner",
          email_thread_id: "thread-send-invalid-winner",
          type: "email",
          direction: "outbound",
        },
        {
          id: "activity-duplicate-2",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_message_id: "msg-send-invalid-winner",
          email_thread_id: "thread-send-invalid-winner",
          type: "email",
          direction: "outbound",
        },
      ],
    },
  ])(
    "reports delivered/reconciliation-pending when the activity conflict resolves to $label",
    async ({ rows }) => {
      const state: SendRouteState = {
        activities: [],
        opportunityUpdates: [],
        threadLinks: [],
        correspondenceEvents: [],
        lifecycleStateUpserts: [],
        activityInsertError: { code: "23505", message: "duplicate key" },
        activityLookupRows: rows,
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
        syncFilters: {},
      });
      const sendEmailMock = vi.fn(async () => ({
        messageId: "msg-send-invalid-winner",
        threadId: "thread-send-invalid-winner",
      }));
      getProviderMock.mockReturnValue({
        sendEmail: sendEmailMock,
        applyLabel: vi.fn(async () => undefined),
      });

      const response = await POST(
        makeRequest({
          userId: "user-1",
          companyId: "company-1",
          connectionId: "connection-1",
          to: ["customer@example.com"],
          subject: "Invalid activity winner",
          body: "This activity conflict must not be adopted.",
          opportunityId: "opp-1",
        }) as never
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        delivered: true,
        reconciliationPending: true,
      });
      expect(sendEmailMock).toHaveBeenCalledOnce();
      expect(state.activities).toHaveLength(0);
      expect(state.correspondenceEvents).toHaveLength(0);
      expect(upsertFromEmailMock).not.toHaveBeenCalled();
    }
  );
});
