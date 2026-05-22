import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";
import { buildEmailOpportunityTitle } from "@/lib/email/opportunity-title";

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

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: vi.fn(),
  };
});

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

    ilike(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
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
      this.payload = payload;
      if (this.table === "clients") {
        const row = { id: `client-${state.clients.length + 1}`, ...payload };
        state.clients.push(row);
      }
      if (this.table === "opportunities") {
        const row = {
          id: `opp-${state.opportunities.length + 1}`,
          created_at: "2026-05-20T00:00:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
          stage_entered_at: "2026-05-20T00:00:00.000Z",
          ...payload,
        };
        state.opportunities.push(row);
      }
      if (this.table === "activities") {
        state.activities.push({
          id: `activity-${state.activities.length + 1}`,
          ...payload,
        });
      }
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads") {
        state.threadLinks.push(payload);
      }
      return this;
    }

    async single() {
      if (this.table === "clients" && this.action === "insert") {
        return { data: state.clients.at(-1), error: null };
      }
      if (this.table === "opportunities" && this.action === "insert") {
        return { data: state.opportunities.at(-1), error: null };
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
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "activities" && this.action === "select") {
        return { data: [], error: null };
      }

      if (this.table === "clients" && this.action === "select") {
        const email = String(this.filters.get("email") ?? "").toLowerCase();
        const match = state.clients.filter(
          (client) => String(client.email).toLowerCase() === email
        );
        return { data: match, error: null };
      }

      if (this.table === "opportunities" && this.action === "select") {
        return { data: [], error: null };
      }

      if (
        this.table === "opportunity_email_threads" &&
        this.action === "select"
      ) {
        const threadId = this.filters.get("thread_id");
        const connectionId = this.filters.get("connection_id");
        const matches = state.threadLinks.filter(
          (link) =>
            link.thread_id === threadId && link.connection_id === connectionId
        );
        return { data: matches, error: null };
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
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

function baseConnection(
  overrides: Partial<EmailConnection> = {}
): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "jackson@canprodeckandrail.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2026-05-21T00:00:00.000Z"),
    historyId: "sync-token",
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {
      includeSentMail: true,
      estimateSubjectPatterns: ["estimate"],
      companyDomains: ["canprodeckandrail.com"],
      teamForwarders: ["jackson@canprodeckandrail.com"],
    },
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    updatedAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

function baseEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    from: "Jackson Sweet <jackson@canprodeckandrail.com>",
    fromName: "Jackson Sweet",
    to: ["Kara Beach <kara.beach@example.com>"],
    cc: [],
    subject: "Canpro Deck and Rail Estimate",
    snippet: "Estimate attached.",
    bodyText: "Estimate attached.",
    date: new Date("2026-05-20T17:00:00.000Z"),
    labelIds: ["SENT"],
    isRead: true,
    hasAttachments: false,
    sizeEstimate: 1200,
    ...overrides,
  };
}

const contactFormBody = `Begin forwarded message:

From: Canpro Deck and Rail <notifications@wix-forms.com>
Reply-To: "Marcel Mercier" <marcel.mercier@example.com>
Subject: Contact Us 3 got a new submission

Submission summary:

Full Name:
Marcel Mercier

Phone:
12505388340

Email:
marcel.mercier@example.com

How can we help?:
We need someone to renovate and replace two roof decks.`;

describe("SyncEngine email opportunity title generation", () => {
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

  it("uses the external recipient display name for sent-folder safety-net opportunities", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [baseEmail()],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Kara Beach — Estimate");
    expect(state.opportunities[0].title).not.toContain("Jackson Sweet");
  });

  it("uses a parsed contact form submitter instead of the platform sender or company identity", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-form-1",
            threadId: "thread-form-1",
            from: "Canpro Deck and Rail <notifications@wix-forms.com>",
            fromName: "Canpro Deck and Rail",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Contact Us 3 got a new submission",
            bodyText: contactFormBody,
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Marcel Mercier — Email Inquiry");
    expect(state.opportunities[0].title).not.toContain("Canpro");
    expect(state.opportunities[0].title).not.toContain("notifications");
  });

  it("keeps valid inbound customer sender titles stable", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-inbound-1",
            threadId: "thread-inbound-1",
            from: "Leah Graham <leah.graham@example.com>",
            fromName: "Leah Graham",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Need an estimate",
            bodyText: "Can you quote our deck repair?",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Leah Graham — Email Inquiry");
  });

  it("prioritizes inbound sender identity over an existing linked client display name", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-existing",
          company_id: "company-1",
          name: "Existing Property Group",
          email: "office@existing-property.test",
        },
      ],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(
      baseConnection({
        email: "operator@north-ridge.test",
        syncFilters: {
          includeSentMail: false,
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["north-ridge.test"],
          teamForwarders: [],
        },
      })
    );
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-linked-1",
            threadId: "thread-linked-1",
            from: "Mara Hill <mara.hill@example.com>",
            fromName: "Mara Hill",
            to: ["operator@north-ridge.test"],
            subject: "Need an estimate",
            bodyText: "Can you quote a repair?",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({
      action: "link",
      clientId: "client-existing",
    });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Mara Hill — Email Inquiry");
    expect(state.opportunities[0].title).not.toContain(
      "Existing Property Group"
    );
  });
});

describe("buildEmailOpportunityTitle unsafe identity filtering", () => {
  it("rejects operator, company, and platform identities before using a safe local part", () => {
    expect(
      buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: "contact_form",
            name: "North Ridge Exteriors",
            email: "operator@north-ridge.test",
          },
          {
            source: "inbound_sender",
            name: "Wix Forms",
            email: "notifications@wix-forms.com",
          },
          {
            source: "contact",
            name: "Riley Operator",
            email: "operator@north-ridge.test",
          },
          {
            source: "contact",
            name: null,
            email: "mara.hill@example.com",
          },
        ],
        unsafe: {
          names: ["Riley Operator"],
          emails: ["operator@north-ridge.test"],
          domains: ["north-ridge.test"],
          platformEmails: ["notifications@wix-forms.com"],
        },
      })
    ).toBe("Mara Hill — Email Inquiry");
  });

  it("uses New Lead only when every available identity is unsafe", () => {
    expect(
      buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: "inbound_sender",
            name: "North Ridge Exteriors",
            email: "operator@north-ridge.test",
          },
          {
            source: "inbound_sender",
            name: "Wix Forms",
            email: "notifications@wix-forms.com",
          },
        ],
        unsafe: {
          emails: ["operator@north-ridge.test"],
          domains: ["north-ridge.test"],
          platformEmails: ["notifications@wix-forms.com"],
        },
      })
    ).toBe("New Lead — Email Inquiry");
  });

  it("rejects company display names derived from unsafe company domains", () => {
    expect(
      buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: "inbound_sender",
            name: "North Ridge Exteriors",
            email: null,
          },
          {
            source: "contact",
            name: null,
            email: "mara.hill@example.com",
          },
        ],
        unsafe: {
          domains: ["north-ridge.test"],
        },
      })
    ).toBe("Mara Hill — Email Inquiry");
  });
});
