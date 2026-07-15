import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for bug 36f8a964 (blank/unsafe opportunity titles): the
// historical-import approved-contacts path must build its opportunity title
// through the canonical buildEmailOpportunityTitle helper — the single source
// of opportunity titling — never by raw `Email inquiry from ${name}`
// interpolation (which had no length cap, no email/operator filtering, and no
// unknown-name normalization).

const {
  getServiceRoleClientMock,
  buildBlocklistMock,
  shouldFilterMock,
  matchMock,
  fetchOpportunitiesMock,
  createOpportunityMock,
  createActivityMock,
  createClientMock,
  relationshipMatchMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  buildBlocklistMock: vi.fn(),
  shouldFilterMock: vi.fn(),
  matchMock: vi.fn(),
  fetchOpportunitiesMock: vi.fn(),
  createOpportunityMock: vi.fn(),
  createActivityMock: vi.fn(),
  createClientMock: vi.fn(),
  relationshipMatchMock: vi.fn(),
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
    createClient: createClientMock,
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

vi.mock("@/lib/email/opportunity-relationship-matching", () => ({
  findOpportunityRelationshipMatch: relationshipMatchMock,
}));

import { POST } from "@/app/api/integrations/gmail/historical-import/route";

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

function makeSupabaseDouble() {
  class Query {
    private table: string;
    constructor(table: string) {
      this.table = table;
    }
    select() {
      return this;
    }
    eq() {
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
    insert() {
      return this;
    }
    update() {
      return this;
    }
    upsert() {
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
      if (this.table === "gmail_import_jobs") {
        return { data: { id: "job-1" }, error: null };
      }
      return { data: null, error: null };
    }
    async maybeSingle() {
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
      // clients lookup returns empty → route falls through to createClient
      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    }
  }
  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

function makeFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/gmail/v1/users/me/messages?")) {
      return Response.json({ messages: [] });
    }
    if (url.includes("/gmail/v1/users/me/profile")) {
      return Response.json({ historyId: "history-2" });
    }
    return new Response("", { status: 200 });
  });
}

async function importApprovedContact(name: string, fromEmail: string) {
  getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble());
  vi.stubGlobal("fetch", makeFetchMock());

  const response = await POST(
    makeJsonRequest({
      companyId: "company-1",
      connectionId: "connection-1",
      importAfter: "2026-05-01",
      approvedContacts: [{ fromEmail, name, createLead: true }],
    }) as never
  );
  return response;
}

describe("Gmail historical import — safe opportunity titles", () => {
  beforeEach(() => {
    getServiceRoleClientMock.mockReset();
    buildBlocklistMock.mockReset();
    buildBlocklistMock.mockResolvedValue({ domains: new Set(), keywords: [] });
    shouldFilterMock.mockReset();
    shouldFilterMock.mockReturnValue(false);
    matchMock.mockReset();
    fetchOpportunitiesMock.mockReset();
    fetchOpportunitiesMock.mockResolvedValue([]); // no existing open opp → create
    createOpportunityMock.mockReset();
    createOpportunityMock.mockResolvedValue({ id: "opp-created" });
    createActivityMock.mockReset();
    createActivityMock.mockResolvedValue({ id: "activity-1" });
    createClientMock.mockReset();
    createClientMock.mockResolvedValue({ id: "client-new" });
    relationshipMatchMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("titles an approved-contact lead via the canonical builder", async () => {
    const response = await importApprovedContact(
      "Kara Beach",
      "kara.beach@example.com"
    );

    expect(response.status).toBe(200);
    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Kara Beach — Email Inquiry" })
    );
  });

  it("normalizes an unknown-name contact to the safe fallback title", async () => {
    const response = await importApprovedContact(
      "unknown",
      "someone@example.com"
    );

    expect(response.status).toBe(200);
    // The builder rejects placeholder names and derives a display name from the
    // safe email local-part → "Someone — Email Inquiry".
    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Someone — Email Inquiry" })
    );
    // And it must NEVER fall back to the old raw interpolation.
    expect(createOpportunityMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Email inquiry from unknown" })
    );
  });

  it("caps an oversized contact name instead of interpolating it raw", async () => {
    const hugeName = "A".repeat(200);
    const response = await importApprovedContact(hugeName, "big@example.com");

    expect(response.status).toBe(200);
    const call = createOpportunityMock.mock.calls.find(Boolean);
    const title = (call?.[0] as { title?: string } | undefined)?.title ?? "";
    // Builder drops the >80-char name and derives from the email local-part.
    expect(title).toBe("Big — Email Inquiry");
    expect(title).not.toContain(hugeName);
  });
});
