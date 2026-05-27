import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getServiceRoleClientMock,
  buildBlocklistMock,
  shouldFilterMock,
  matchMock,
  fetchOpportunitiesMock,
  createActivityMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  buildBlocklistMock: vi.fn(),
  shouldFilterMock: vi.fn(),
  matchMock: vi.fn(),
  fetchOpportunitiesMock: vi.fn(),
  createActivityMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/api/services/email-filter-service", () => ({
  EmailFilterService: {
    buildBlocklist: buildBlocklistMock,
    shouldFilter: shouldFilterMock,
  },
}));

vi.mock("@/lib/api/services/email-matching-service-v2", () => ({
  EmailMatchingServiceV2: {
    match: matchMock,
  },
}));

vi.mock("@/lib/api/services/client-service", () => ({
  ClientService: {
    createClient: vi.fn(),
    createSubClient: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: {
    fetchOpportunities: fetchOpportunitiesMock,
    createOpportunity: vi.fn(),
    createActivity: createActivityMock,
  },
}));

import { POST } from "@/app/api/integrations/gmail/historical-import/route";

interface HistoricalImportState {
  activityMetadataUpdates: Array<Record<string, unknown>>;
  emailThreadWrites: Array<Record<string, unknown>>;
  threadLinkWrites: Array<Record<string, unknown>>;
  opportunityUpdates: Array<Record<string, unknown>>;
  jobUpdates: Array<Record<string, unknown>>;
}

interface GmailMessageFixture {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  labelIds?: string[];
}

function makeJsonRequest(body: unknown): Request {
  return new Request("https://ops.test/api/integrations/gmail/historical-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSupabaseDouble(state: HistoricalImportState) {
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

    is() {
      return this;
    }

    ilike() {
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
      this.payload = payload;
      if (this.table === "email_threads") state.emailThreadWrites.push(payload);
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "gmail_import_jobs") state.jobUpdates.push(payload);
      if (this.table === "activities") state.activityMetadataUpdates.push(payload);
      if (this.table === "opportunities") state.opportunityUpdates.push(payload);
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads") {
        state.threadLinkWrites.push(payload);
      }
      return this;
    }

    async single() {
      if (this.table === "email_connections") {
        return {
          data: {
            id: "connection-1",
            company_id: "company-1",
            email: "operator@example.com",
            access_token: "token",
            refresh_token: "refresh",
            expires_at: "2999-01-01T00:00:00.000Z",
            history_id: null,
            sync_enabled: true,
            sync_filters: null,
          },
          error: null,
        };
      }

      if (this.table === "gmail_import_jobs" && this.action === "insert") {
        return {
          data: { id: "job-1", ...this.payload },
          error: null,
        };
      }

      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "opportunities") {
        return {
          data: {
            client_id: "client-1",
            contact_name: null,
            contact_email: null,
            contact_phone: null,
            address: null,
            estimated_value: null,
            detected_value: null,
            description: null,
            source: null,
            source_email_id: null,
          },
          error: null,
        };
      }

      if (this.table === "clients") {
        return {
          data: {
            name: null,
            email: null,
            phone_number: null,
            address: null,
          },
          error: null,
        };
      }

      return { data: null, error: null };
    }

    private result() {
      if (this.table === "activities") {
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

function makeFetchMock(messages: GmailMessageFixture[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/gmail/v1/users/me/messages?")) {
      return Response.json({
        messages: messages.map((message) => ({
          id: message.id,
          threadId: message.threadId,
        })),
      });
    }

    if (url.includes("/gmail/v1/users/me/messages/")) {
      const message =
        messages.find((candidate) => url.includes(candidate.id)) ?? messages[0];

      return Response.json({
        id: message.id,
        threadId: message.threadId,
        payload: {
          headers: [
            {
              name: "From",
              value: message.from ?? "Kara Beach <kara.beach@example.com>",
            },
            {
              name: "To",
              value: message.to ?? "operator@example.com",
            },
            {
              name: "Subject",
              value: message.subject ?? "Deck quote follow-up",
            },
          ],
        },
        snippet: message.snippet ?? "Following up on the deck quote.",
        labelIds: message.labelIds ?? ["INBOX"],
      });
    }

    if (url.includes("/gmail/v1/users/me/profile")) {
      return Response.json({ historyId: "history-2" });
    }

    return new Response("", { status: 200 });
  });
}

async function runHistoricalImport(messages: GmailMessageFixture[]) {
  const state: HistoricalImportState = {
    activityMetadataUpdates: [],
    emailThreadWrites: [],
    threadLinkWrites: [],
    opportunityUpdates: [],
    jobUpdates: [],
  };

  getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
  vi.stubGlobal("fetch", makeFetchMock(messages));

  const response = await POST(
    makeJsonRequest({
      companyId: "company-1",
      connectionId: "connection-1",
      importAfter: "2026-05-01",
      approvedContacts: [],
    }) as never
  );

  return { response, state, fetchMock: fetch as unknown as ReturnType<typeof vi.fn> };
}

describe("Gmail historical import provider id guard", () => {
  beforeEach(() => {
    getServiceRoleClientMock.mockReset();
    buildBlocklistMock.mockReset();
    buildBlocklistMock.mockResolvedValue({ domains: new Set(), keywords: [] });
    shouldFilterMock.mockReset();
    shouldFilterMock.mockReturnValue(false);
    matchMock.mockReset();
    matchMock.mockResolvedValue({
      clientId: "client-1",
      confidence: "exact",
      needsReview: false,
      suggestedClientId: null,
    });
    fetchOpportunitiesMock.mockReset();
    fetchOpportunitiesMock.mockResolvedValue([{ id: "opp-1" }]);
    createActivityMock.mockReset();
    createActivityMock.mockResolvedValue({ id: "activity-1" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips historical provider email activity creation when threadId is blank", async () => {
    const { response, state } = await runHistoricalImport([
      {
        id: "msg-blank-thread",
        threadId: "   ",
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).not.toHaveBeenCalled();
    expect(fetchOpportunitiesMock).not.toHaveBeenCalled();
    expect(createActivityMock).not.toHaveBeenCalled();
    expect(state.activityMetadataUpdates).toHaveLength(0);
    expect(state.emailThreadWrites).toHaveLength(0);
    expect(state.threadLinkWrites).toHaveLength(0);
    expect(state.opportunityUpdates).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      "[provider-email-ids] rejected email lifecycle write",
      expect.objectContaining({
        boundary: "gmail_historical_import_activity",
        reasons: ["blank_provider_thread_id"],
        providerThreadId: null,
        providerMessageId: "msg-blank-thread",
        companyId: "company-1",
      })
    );
  });

  it("skips historical provider email activity creation when msgId is blank", async () => {
    const { response, state, fetchMock } = await runHistoricalImport([
      {
        id: "   ",
        threadId: "thread-1",
      },
    ]);

    expect(response.status).toBe(200);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/gmail/v1/users/me/messages/   ")
      )
    ).toBe(false);
    expect(matchMock).not.toHaveBeenCalled();
    expect(fetchOpportunitiesMock).not.toHaveBeenCalled();
    expect(createActivityMock).not.toHaveBeenCalled();
    expect(state.activityMetadataUpdates).toHaveLength(0);
    expect(state.emailThreadWrites).toHaveLength(0);
    expect(state.threadLinkWrites).toHaveLength(0);
    expect(state.opportunityUpdates).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      "[provider-email-ids] rejected email lifecycle write",
      expect.objectContaining({
        boundary: "gmail_historical_import_message_fetch",
        reasons: ["blank_provider_message_id"],
        providerThreadId: null,
        providerMessageId: null,
        companyId: "company-1",
      })
    );
  });

  it("still processes a valid historical provider message", async () => {
    const { response, state } = await runHistoricalImport([
      {
        id: "msg-valid",
        threadId: "thread-valid",
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "kara.beach@example.com",
      expect.objectContaining({
        threadId: "thread-valid",
        name: "Kara Beach",
      })
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-1",
        clientId: "client-1",
        emailThreadId: "thread-valid",
        emailMessageId: "msg-valid",
      })
    );
    expect(state.activityMetadataUpdates).toHaveLength(1);
    expect(state.opportunityUpdates).toEqual([
      expect.objectContaining({
        contact_name: "Kara Beach",
        contact_email: "kara.beach@example.com",
        description: "Following up on the deck quote.",
        source_email_id: "thread-valid",
        source: "email",
      }),
    ]);
    expect(state.emailThreadWrites).toHaveLength(0);
    expect(state.threadLinkWrites).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
