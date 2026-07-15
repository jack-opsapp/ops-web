import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getServiceRoleClientMock,
  buildBlocklistMock,
  shouldFilterMock,
  matchMock,
  fetchOpportunitiesMock,
  createOpportunityMock,
  createActivityMock,
  upsertEmailThreadMock,
  classifyEmailThreadMock,
  relationshipMatchMock,
  recordCorrespondenceMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  buildBlocklistMock: vi.fn(),
  shouldFilterMock: vi.fn(),
  matchMock: vi.fn(),
  fetchOpportunitiesMock: vi.fn(),
  createOpportunityMock: vi.fn(),
  createActivityMock: vi.fn(),
  upsertEmailThreadMock: vi.fn(),
  classifyEmailThreadMock: vi.fn(),
  relationshipMatchMock: vi.fn(),
  recordCorrespondenceMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: vi.fn(async () => null),
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
    createOpportunity: createOpportunityMock,
    createActivity: createActivityMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: upsertEmailThreadMock,
    classifyAndUpdate: classifyEmailThreadMock,
  },
}));

vi.mock("@/lib/api/services/opportunity-lifecycle-service", () => ({
  OpportunityLifecycleService: {
    recordCorrespondenceEvent: recordCorrespondenceMock,
  },
}));

vi.mock("@/lib/email/opportunity-relationship-matching", () => ({
  findOpportunityRelationshipMatch: relationshipMatchMock,
}));

import { POST } from "@/app/api/integrations/gmail/historical-import/route";

interface HistoricalImportState {
  activityMetadataUpdates: Array<Record<string, unknown>>;
  emailThreadWrites: Array<Record<string, unknown>>;
  threadLinkWrites: Array<Record<string, unknown>>;
  opportunityUpdates: Array<Record<string, unknown>>;
  jobUpdates: Array<Record<string, unknown>>;
  connectionUpdates: Array<Record<string, unknown>>;
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
}

interface GmailMessageFixture {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  bodyText?: string;
  internalDate?: string;
  labelIds?: string[];
}

interface HistoricalImportOptions {
  connectionEmail?: string;
  companyUserEmails?: string[];
  profileHistoryId?: string;
  nextPageToken?: string;
  listMessageIds?: string[];
  correspondenceProjectionError?: string;
  writeError?: { table: string; action: "update" | "upsert"; message: string };
  existingActivities?: Array<{
    id: string;
    opportunity_id: string | null;
    client_id: string | null;
  }>;
}

function makeJsonRequest(body: unknown): Request {
  return new Request(
    "https://ops.test/api/integrations/gmail/historical-import",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function makeSupabaseDouble(
  state: HistoricalImportState,
  options: HistoricalImportOptions = {}
) {
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
      if (this.table === "activities")
        state.activityMetadataUpdates.push(payload);
      if (this.table === "opportunities")
        state.opportunityUpdates.push(payload);
      if (this.table === "email_connections")
        state.connectionUpdates.push(payload);
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
            email: options.connectionEmail ?? "operator@example.com",
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
        const companyId = this.filters.get("company_id");
        return {
          data:
            companyId === "company-1"
              ? {
                  company_id: companyId,
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
                }
              : null,
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

      if (this.table === "opportunity_email_threads") {
        const canonicalLink = state.threadLinkWrites.find(
          (write) =>
            write.thread_id === this.filters.get("thread_id") &&
            write.connection_id === this.filters.get("connection_id")
        );
        return {
          data: canonicalLink
            ? { opportunity_id: canonicalLink.opportunity_id }
            : null,
          error: null,
        };
      }

      return { data: null, error: null };
    }

    private result() {
      if (this.table === "users") {
        return {
          data: (options.companyUserEmails ?? []).map((email) => ({ email })),
          error: null,
        };
      }
      if (
        options.writeError?.table === this.table &&
        options.writeError.action === this.action
      ) {
        return { data: null, error: { message: options.writeError.message } };
      }
      if (this.table === "activities") {
        return {
          data:
            this.action === "select" ? (options.existingActivities ?? []) : [],
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
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      state.rpcCalls.push({ name, params });
      if (
        name === "apply_opportunity_correspondence_event" &&
        options.correspondenceProjectionError
      ) {
        return {
          data: null,
          error: { message: options.correspondenceProjectionError },
        };
      }
      return {
        data: [
          {
            correspondence_count: 1,
            inbound_count: 1,
            outbound_count: 0,
            stage: "new_lead",
            stage_manually_set: false,
            last_inbound_at: "2026-02-02T02:40:00.000Z",
            last_outbound_at: null,
            last_message_direction: "in",
          },
        ],
        error: null,
      };
    }),
  };
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeFetchMock(
  messages: GmailMessageFixture[],
  options: HistoricalImportOptions = {}
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/gmail/v1/users/me/profile")) {
      return Response.json({
        historyId: options.profileHistoryId ?? "history-boundary",
      });
    }

    if (url.includes("/gmail/v1/users/me/messages?")) {
      return Response.json({
        messages: (
          options.listMessageIds ?? messages.map((message) => message.id)
        ).map((id) => ({
          id,
          threadId:
            messages.find((message) => message.id === id)?.threadId ??
            "thread-1",
        })),
        nextPageToken: options.nextPageToken,
      });
    }

    if (url.includes("/gmail/v1/users/me/messages/")) {
      const message =
        messages.find((candidate) => url.includes(candidate.id)) ?? messages[0];

      return Response.json({
        id: message.id,
        threadId: message.threadId,
        internalDate: message.internalDate ?? "1770000000000",
        payload: {
          mimeType: "text/plain",
          headers: [
            {
              name: "From",
              value: message.from ?? "Kara Beach <kara.beach@customer.example>",
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
          body: {
            data: encodeBase64Url(
              message.bodyText ??
                message.snippet ??
                "Following up on the deck quote."
            ),
          },
        },
        snippet: message.snippet ?? "Following up on the deck quote.",
        labelIds: message.labelIds ?? ["INBOX"],
      });
    }

    return new Response("", { status: 200 });
  });
}

async function runHistoricalImport(
  messages: GmailMessageFixture[],
  options: HistoricalImportOptions = {}
) {
  const state: HistoricalImportState = {
    activityMetadataUpdates: [],
    emailThreadWrites: [],
    threadLinkWrites: [],
    opportunityUpdates: [],
    jobUpdates: [],
    connectionUpdates: [],
    rpcCalls: [],
  };

  getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state, options));
  vi.stubGlobal("fetch", makeFetchMock(messages, options));

  const response = await POST(
    makeJsonRequest({
      companyId: "company-1",
      connectionId: "connection-1",
      importAfter: "2026-05-01",
      approvedContacts: [],
    }) as never
  );

  return {
    response,
    state,
    fetchMock: fetch as unknown as ReturnType<typeof vi.fn>,
  };
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
    createOpportunityMock.mockReset();
    createOpportunityMock.mockResolvedValue({ id: "opp-created" });
    createActivityMock.mockReset();
    createActivityMock.mockResolvedValue({ id: "activity-1" });
    upsertEmailThreadMock.mockReset();
    upsertEmailThreadMock.mockResolvedValue({
      threadRow: { id: "email-thread-1" },
      isNew: true,
    });
    classifyEmailThreadMock.mockReset();
    relationshipMatchMock.mockReset();
    relationshipMatchMock.mockResolvedValue({
      action: "link",
      opportunityId: "opp-1",
      clientId: "client-1",
      confidence: "exact_contact_email",
      reason: "Exact contact email matched an active opportunity",
      evidence: ["email:kara.beach@customer.example"],
    });
    recordCorrespondenceMock.mockReset();
    recordCorrespondenceMock.mockResolvedValue({ created: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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

  it.each(["DRAFT", "SPAM", "TRASH"])(
    "never imports Gmail %s objects as delivered correspondence",
    async (nonDeliveryLabel) => {
      const { response, state } = await runHistoricalImport([
        {
          id: `msg-${nonDeliveryLabel.toLowerCase()}`,
          threadId: `thread-${nonDeliveryLabel.toLowerCase()}`,
          labelIds: [nonDeliveryLabel],
        },
      ]);

      expect(response.status).toBe(200);
      expect(createActivityMock).not.toHaveBeenCalled();
      expect(recordCorrespondenceMock).not.toHaveBeenCalled();
      expect(upsertEmailThreadMock).not.toHaveBeenCalled();
      expect(state.threadLinkWrites).toEqual([]);
    }
  );

  it("canonicalizes an already-scoped historical thread before matching and persistence", async () => {
    const { response, state } = await runHistoricalImport([
      {
        id: "msg-valid",
        threadId: "email:gmail:connection-1:thread:thread-valid",
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "kara.beach@customer.example",
      expect.objectContaining({
        threadId: "thread-valid",
        connectionId: "connection-1",
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
        contact_email: "kara.beach@customer.example",
        description: "Following up on the deck quote.",
        source_email_id: "thread-valid",
        source: "email",
      }),
      {
        source_thread_key: "email:gmail:connection-1:thread:thread-valid",
      },
    ]);
    expect(state.emailThreadWrites).toHaveLength(0);
    expect(state.threadLinkWrites).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-1",
        thread_id: "thread-valid",
        connection_id: "connection-1",
      }),
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("keeps a normal raw historical thread raw while scoping its CRM source key once", async () => {
    const { response, state } = await runHistoricalImport([
      {
        id: "msg-raw",
        threadId: "thread-raw",
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "kara.beach@customer.example",
      expect.objectContaining({
        threadId: "thread-raw",
        connectionId: "connection-1",
      })
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emailThreadId: "thread-raw",
        emailMessageId: "msg-raw",
        occurredAt: new Date(1770000000000),
      })
    );
    expect(state.opportunityUpdates).toContainEqual({
      source_thread_key: "email:gmail:connection-1:thread:thread-raw",
    });
    expect(state.threadLinkWrites).toContainEqual(
      expect.objectContaining({
        thread_id: "thread-raw",
        connection_id: "connection-1",
      })
    );
    expect(upsertEmailThreadMock).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "thread-raw",
      direction: "inbound",
      opportunityId: "opp-1",
      clientId: "client-1",
      markClassificationDirty: true,
      email: expect.objectContaining({
        id: "msg-raw",
        threadId: "thread-raw",
        from: "Kara Beach <kara.beach@customer.example>",
        fromName: "Kara Beach",
        to: ["operator@example.com"],
        cc: [],
        subject: "Deck quote follow-up",
        date: new Date(1770000000000),
        isRead: true,
      }),
    });
    expect(createActivityMock.mock.invocationCallOrder[0]).toBeLessThan(
      upsertEmailThreadMock.mock.invocationCallOrder[0]
    );
    expect(recordCorrespondenceMock.mock.invocationCallOrder[0]).toBeLessThan(
      upsertEmailThreadMock.mock.invocationCallOrder[0]
    );
    expect(classifyEmailThreadMock).not.toHaveBeenCalled();
  });

  it("persists a connected-mailbox historical message as outbound", async () => {
    const { response } = await runHistoricalImport([
      {
        id: "msg-outbound",
        threadId: "thread-outbound",
        from: "OPS Operator <operator@example.com>",
        to: "Kara Beach <kara.beach@customer.example>",
        labelIds: ["SENT"],
      },
    ]);

    expect(response.status).toBe(200);
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emailMessageId: "msg-outbound",
        direction: "outbound",
      })
    );
  });

  it("does not treat a provider display name that only repeats the email local-part as a verified customer name", async () => {
    const { response } = await runHistoricalImport([
      {
        id: "msg-local-part-name",
        threadId: "thread-local-part-name",
        from: "Jirvine <jirvine@gmail.com>",
        to: "OPS Operator <operator@example.com>",
        labelIds: ["INBOX"],
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "jirvine@gmail.com",
      expect.objectContaining({ name: "" })
    );
    expect(relationshipMatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.objectContaining({ contactName: null }),
      })
    );
    expect(recordCorrespondenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromName: "" })
    );
  });

  it("decodes full Gmail bodies and routes repeated form submissions by message instead of raw thread", async () => {
    relationshipMatchMock.mockResolvedValue({
      action: "create_new",
      reason:
        "No deterministic opportunity relationship signal met the confidence bar",
      evidence: [],
    });
    createOpportunityMock
      .mockResolvedValueOnce({ id: "opp-sandra" })
      .mockResolvedValueOnce({ id: "opp-brad" });

    const { response, state, fetchMock } = await runHistoricalImport([
      {
        id: "msg-sandra",
        threadId: "wix-reused-thread",
        from: "Wix Forms <notifications@wix.com>",
        subject: "New contact form submission",
        bodyText:
          "Submission summary\nName: Sandra Lee\nEmail: sandra@customer.example\nPhone: 250-555-0101\nMessage: Please quote a cedar deck.",
      },
      {
        id: "msg-brad",
        threadId: "wix-reused-thread",
        from: "Wix Forms <notifications@wix.com>",
        subject: "New contact form submission",
        bodyText:
          "Submission summary\nName: Brad Cole\nEmail: brad@example.net\nMessage: I need an aluminum railing.",
      },
    ]);

    expect(response.status).toBe(200);
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url).includes("/gmail/v1/users/me/messages/"))
        .map(([url]) => String(url))
    ).toEqual([
      expect.stringContaining("msg-sandra?format=full"),
      expect.stringContaining("msg-brad?format=full"),
    ]);
    expect(matchMock).toHaveBeenNthCalledWith(
      1,
      "company-1",
      "sandra@customer.example",
      {
        name: "Sandra Lee",
      }
    );
    expect(matchMock).toHaveBeenNthCalledWith(
      2,
      "company-1",
      "brad@example.net",
      {
        name: "Brad Cole",
      }
    );
    expect(relationshipMatchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerThreadId: null })
    );
    expect(relationshipMatchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerThreadId: null })
    );
    expect(createOpportunityMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        contactName: "Sandra Lee",
        contactEmail: "sandra@customer.example",
        sourceEmailId: "wix-reused-thread",
        sourceThreadKey: "email:gmail:connection-1:message:msg-sandra",
      })
    );
    expect(createOpportunityMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        contactName: "Brad Cole",
        contactEmail: "brad@example.net",
        sourceEmailId: "wix-reused-thread",
        sourceThreadKey: "email:gmail:connection-1:message:msg-brad",
      })
    );
    expect(createActivityMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        emailThreadId: "wix-reused-thread",
        emailMessageId: "msg-sandra",
        content: expect.stringContaining("Please quote a cedar deck"),
      })
    );
    expect(createActivityMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        emailThreadId: "wix-reused-thread",
        emailMessageId: "msg-brad",
        content: expect.stringContaining("aluminum railing"),
      })
    );
    expect(state.threadLinkWrites).toEqual([]);
    expect(state.opportunityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_thread_key: "email:gmail:connection-1:message:msg-sandra",
        }),
        expect.objectContaining({
          source_thread_key: "email:gmail:connection-1:message:msg-brad",
        }),
      ])
    );
  });

  it("matches and enriches outbound historical mail from the external recipient", async () => {
    relationshipMatchMock.mockResolvedValueOnce({
      action: "create_new",
      reason:
        "No deterministic opportunity relationship signal met the confidence bar",
      evidence: [],
    });

    const { response } = await runHistoricalImport([
      {
        id: "msg-customer-outbound",
        threadId: "thread-customer-outbound",
        from: "OPS Operator <operator@example.com>",
        to: "Kara Beach <kara.beach@example.net>",
        labelIds: ["SENT"],
        bodyText: "Here is the estimate you requested.",
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "kara.beach@example.net",
      expect.objectContaining({ name: "Kara Beach" })
    );
    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: "Kara Beach",
        contactEmail: "kara.beach@example.net",
      })
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "outbound",
        fromEmail: "operator@example.com",
      })
    );
  });

  it("never falls back to the operator as the customer for internal-only outbound mail", async () => {
    const { response } = await runHistoricalImport([
      {
        id: "msg-internal-outbound",
        threadId: "thread-internal-outbound",
        from: "OPS Operator <operator@example.com>",
        to: "OPS Estimator <estimator@example.com>",
        labelIds: ["SENT"],
      },
    ]);

    expect(response.status).toBe(200);
    expect(matchMock).not.toHaveBeenCalled();
    expect(createOpportunityMock).not.toHaveBeenCalled();
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "outbound",
        fromEmail: "operator@example.com",
      })
    );
  });

  it("does not classify every external Gmail sender as outbound when operators use Gmail", async () => {
    const { response } = await runHistoricalImport(
      [
        {
          id: "msg-external-gmail",
          threadId: "thread-external-gmail",
          from: "Customer One <customer.one@gmail.com>",
          to: "OPS Operator <operator@gmail.com>",
          labelIds: ["INBOX"],
        },
      ],
      {
        connectionEmail: "operator@gmail.com",
        companyUserEmails: ["estimator@gmail.com"],
      }
    );

    expect(response.status).toBe(200);
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "inbound" })
    );
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "customer.one@gmail.com",
      expect.any(Object)
    );
  });

  it("captures the Gmail history boundary before listing and persists exactly that snapshot", async () => {
    const { response, state, fetchMock } = await runHistoricalImport(
      [
        {
          id: "msg-boundary",
          threadId: "thread-boundary",
        },
      ],
      { profileHistoryId: "history-before-list" }
    );

    expect(response.status).toBe(200);
    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(
      requestedUrls.findIndex((url) => url.includes("/users/me/profile"))
    ).toBeLessThan(
      requestedUrls.findIndex((url) => url.includes("/users/me/messages?"))
    );
    expect(state.connectionUpdates).toContainEqual({
      history_id: "history-before-list",
    });
    expect(
      requestedUrls.filter((url) => url.includes("/users/me/profile"))
    ).toHaveLength(1);
  });

  it("fails the job and leaves the cursor untouched when any message write fails", async () => {
    createActivityMock.mockRejectedValueOnce(
      new Error("activity insert failed")
    );

    const { response, state } = await runHistoricalImport([
      {
        id: "msg-write-failure",
        threadId: "thread-write-failure",
      },
    ]);

    expect(response.status).toBe(500);
    expect(state.connectionUpdates).toEqual([]);
    expect(state.jobUpdates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("activity insert failed"),
      })
    );
    expect(state.jobUpdates).not.toContainEqual(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("repairs semantic side effects from an existing activity before advancing on retry", async () => {
    const options: HistoricalImportOptions = { existingActivities: [] };
    recordCorrespondenceMock
      .mockRejectedValueOnce(new Error("correspondence event insert failed"))
      .mockResolvedValueOnce({
        created: false,
        reason: "duplicate_provider_message_id",
      });

    const first = await runHistoricalImport(
      [
        {
          id: "msg-retry",
          threadId: "thread-retry",
          bodyText: "Please quote the west deck.",
        },
      ],
      options
    );

    expect(first.response.status).toBe(500);
    expect(first.state.connectionUpdates).toEqual([]);
    expect(createActivityMock).toHaveBeenCalledTimes(1);

    options.existingActivities = [
      {
        id: "activity-1",
        opportunity_id: "opp-1",
        client_id: "client-1",
      },
    ];
    const second = await runHistoricalImport(
      [
        {
          id: "msg-retry",
          threadId: "thread-retry",
          bodyText: "Please quote the west deck.",
        },
      ],
      options
    );

    expect(second.response.status).toBe(200);
    expect(createActivityMock).toHaveBeenCalledTimes(1);
    expect(recordCorrespondenceMock).toHaveBeenCalledTimes(2);
    expect(recordCorrespondenceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activityId: "activity-1",
        opportunityId: "opp-1",
        providerMessageId: "msg-retry",
      })
    );
    expect(second.state.threadLinkWrites).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-1",
        thread_id: "thread-retry",
      }),
    ]);
    expect(second.state.activityMetadataUpdates).toContainEqual(
      expect.objectContaining({
        match_confidence: "exact",
        match_needs_review: false,
      })
    );
    expect(second.state.connectionUpdates).toContainEqual({
      history_id: "history-boundary",
    });
  });

  it("retries a pending historical correspondence projection before advancing the cursor", async () => {
    const options: HistoricalImportOptions = {
      existingActivities: [],
      correspondenceProjectionError: "counter projection unavailable",
    };

    const first = await runHistoricalImport(
      [
        {
          id: "msg-projection-retry",
          threadId: "thread-projection-retry",
          bodyText: "Please quote the west deck.",
        },
      ],
      options
    );

    expect(first.response.status).toBe(500);
    expect(first.state.connectionUpdates).toEqual([]);
    expect(createActivityMock).toHaveBeenCalledTimes(1);
    expect(recordCorrespondenceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activityId: "activity-1",
        opportunityId: "opp-1",
        providerMessageId: "msg-projection-retry",
        applyOpportunityProjection: true,
      })
    );
    expect(first.state.rpcCalls).toEqual([
      {
        name: "apply_opportunity_correspondence_event",
        params: {
          p_company_id: "company-1",
          p_opportunity_id: "opp-1",
          p_connection_id: "connection-1",
          p_provider_message_id: "msg-projection-retry",
        },
      },
    ]);

    options.existingActivities = [
      {
        id: "activity-1",
        opportunity_id: "opp-1",
        client_id: "client-1",
      },
    ];
    options.correspondenceProjectionError = undefined;
    const second = await runHistoricalImport(
      [
        {
          id: "msg-projection-retry",
          threadId: "thread-projection-retry",
          bodyText: "Please quote the west deck.",
        },
      ],
      options
    );

    expect(second.response.status).toBe(200);
    expect(createActivityMock).toHaveBeenCalledTimes(1);
    expect(recordCorrespondenceMock).toHaveBeenCalledTimes(2);
    expect(second.state.rpcCalls).toEqual([
      {
        name: "apply_opportunity_correspondence_event",
        params: expect.objectContaining({
          p_opportunity_id: "opp-1",
          p_provider_message_id: "msg-projection-retry",
        }),
      },
    ]);
    expect(second.state.connectionUpdates).toContainEqual({
      history_id: "history-boundary",
    });
  });

  it("fails closed when pagination proves the date range exceeds MAX_MESSAGES", async () => {
    vi.stubGlobal("setTimeout", ((callback: (...args: unknown[]) => void) => {
      callback();
      return 0;
    }) as typeof setTimeout);
    const overLimitIds = Array.from({ length: 5000 }, () => "   ");

    const { response, state } = await runHistoricalImport([], {
      listMessageIds: overLimitIds,
      nextPageToken: "still-more-mail",
    });

    expect(response.status).toBe(500);
    expect(state.connectionUpdates).toEqual([]);
    expect(state.jobUpdates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("5000"),
      })
    );
  });

  it("fails closed when a direct Supabase thread-link write reports an error", async () => {
    const { response, state } = await runHistoricalImport(
      [
        {
          id: "msg-thread-write",
          threadId: "thread-write",
        },
      ],
      {
        writeError: {
          table: "opportunity_email_threads",
          action: "upsert",
          message: "thread link constraint failed",
        },
      }
    );

    expect(response.status).toBe(500);
    expect(state.connectionUpdates).toEqual([]);
    expect(state.jobUpdates).toContainEqual(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("uses P3 relationship matching create_new for historical existing-client messages instead of reusing an open opportunity", async () => {
    relationshipMatchMock.mockResolvedValueOnce({
      action: "create_new",
      reason:
        "No deterministic opportunity relationship signal met the P3 confidence bar",
      suggestedOpportunityId: "opp-open",
      evidence: [],
    });
    fetchOpportunitiesMock.mockResolvedValueOnce([{ id: "opp-open" }]);
    createOpportunityMock.mockResolvedValueOnce({ id: "opp-new" });

    const { response, state } = await runHistoricalImport([
      {
        id: "msg-new-job",
        threadId: "thread-new-job",
        from: "Mara Hill <mara.hill@customer.example>",
        subject: "Need a new estimate",
        snippet: "Can you quote a front gate at 455 New Road?",
      },
    ]);

    expect(response.status).toBe(200);
    expect(relationshipMatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        connectionId: "connection-1",
        providerThreadId: "thread-new-job",
        clientId: "client-1",
      })
    );
    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        clientId: "client-1",
        contactName: "Mara Hill",
        contactEmail: "mara.hill@customer.example",
        sourceEmailId: "thread-new-job",
      })
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-new",
        clientId: "client-1",
        emailThreadId: "thread-new-job",
        emailMessageId: "msg-new-job",
      })
    );
    expect(state.threadLinkWrites).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-new",
        thread_id: "thread-new-job",
        connection_id: "connection-1",
      }),
    ]);
    expect(state.threadLinkWrites[0].opportunity_id).not.toBe("opp-open");
  });

  it("persists opportunity_email_threads when P3 relationship matching links a historical provider thread", async () => {
    relationshipMatchMock.mockResolvedValueOnce({
      action: "link",
      opportunityId: "opp-linked",
      clientId: "client-1",
      confidence: "exact_contact_email",
      reason: "Exact contact email matched an active opportunity",
      evidence: ["email:kara.beach@customer.example"],
    });

    const { response, state } = await runHistoricalImport([
      {
        id: "msg-linked",
        threadId: "thread-linked",
      },
    ]);

    expect(response.status).toBe(200);
    expect(relationshipMatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "thread-linked",
        clientId: "client-1",
      })
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-linked",
        clientId: "client-1",
        emailThreadId: "thread-linked",
        emailMessageId: "msg-linked",
      })
    );
    expect(state.threadLinkWrites).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-linked",
        thread_id: "thread-linked",
        connection_id: "connection-1",
      }),
    ]);
  });
});
