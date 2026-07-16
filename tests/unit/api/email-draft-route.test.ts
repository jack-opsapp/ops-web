/**
 * Manual Pipeline "Draft" route — POST /api/integrations/email/draft
 *
 * Verifies the route routes a forwarded contact-form lead to a fresh NEW-THREAD
 * outreach (placeNewThreadDraft) instead of a "Re:" reply glued to the
 * forwarder's thread, and that an ordinary reply lead still takes the reply path
 * (provider.createDraft with a Re: subject + resolved thread).
 *
 * placeNewThreadDraft is mocked (unit-tested separately) so this asserts wiring:
 * detection (real extractContactFormSubmission) + which placement path runs.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getServiceRoleClientMock,
  getConnectionsMock,
  getProviderMock,
  generateDraftMock,
  getProfileMock,
  getConfidenceMock,
  placeNewThreadDraftMock,
  resolveEmailOpportunityAccessMock,
  resolveEmailRouteActorMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  getConnectionsMock: vi.fn(),
  getProviderMock: vi.fn(),
  generateDraftMock: vi.fn(),
  getProfileMock: vi.fn(),
  getConfidenceMock: vi.fn(),
  placeNewThreadDraftMock: vi.fn(),
  resolveEmailOpportunityAccessMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: resolveEmailOpportunityAccessMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnections: getConnectionsMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    getProfile: getProfileMock,
    getConfidence: getConfidenceMock,
  },
}));

vi.mock("@/lib/api/services/mailbox-draft-push", () => ({
  placeNewThreadDraft: placeNewThreadDraftMock,
  CONTACT_FORM_OUTREACH_SUBJECT: "Thanks for reaching out",
}));

import { POST } from "@/app/api/integrations/email/draft/route";

// ─── In-memory Supabase double ──────────────────────────────────────────────

interface DbState {
  opportunities: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  email_threads: Array<Record<string, unknown>>;
  ai_draft_history: Array<Record<string, unknown>>;
  email_signatures?: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: DbState) {
  class Query {
    private _filters = new Map<string, unknown>();
    private _limit: number | null = null;
    private _payload: Record<string, unknown> | null = null;
    private _action: "select" | "update" = "select";
    constructor(private table: keyof DbState) {}
    select() {
      return this;
    }
    eq(c: string, v: unknown) {
      this._filters.set(c, v);
      return this;
    }
    is(c: string, v: unknown) {
      this._filters.set(c, v);
      return this;
    }
    order() {
      return this;
    }
    limit(n: number) {
      this._limit = n;
      return this;
    }
    update(p: Record<string, unknown>) {
      this._action = "update";
      this._payload = p;
      return this;
    }
    private _rows() {
      const tableRows =
        this.table === "email_signatures"
          ? (state.email_signatures ?? [makeSignatureRow()])
          : (state[this.table] ?? []);
      return tableRows.filter((r) => {
        for (const [c, v] of this._filters) if (r[c] !== v) return false;
        return true;
      });
    }
    private _resolve() {
      if (this._action === "update") {
        for (const r of this._rows()) Object.assign(r, this._payload);
        return { data: null, error: null };
      }
      let rows = this._rows();
      if (this._limit !== null) rows = rows.slice(0, this._limit);
      return { data: rows, error: null };
    }
    async single() {
      const { data } = this._resolve();
      const arr = data as Array<Record<string, unknown>>;
      return { data: arr[0] ?? null, error: null };
    }
    async maybeSingle() {
      return this.single();
    }
    then<A = unknown, B = never>(
      f?: ((v: unknown) => A | PromiseLike<A>) | null,
      r?: ((e: unknown) => B | PromiseLike<B>) | null
    ) {
      return Promise.resolve(this._resolve()).then(f, r);
    }
  }
  return {
    from: (t: keyof DbState) => new Query(t),
    rpc: async () => ({ data: null, error: null }),
  };
}

function makeSignatureRow(): Record<string, unknown> {
  return {
    id: "signature-1",
    company_id: "company-1",
    connection_id: "conn-1",
    scope_user_id: "user-1",
    source: "ops",
    content_html: "<div>Jackson<br>OPS</div>",
    content_text: "Jackson\nOPS",
    content_hash: "a".repeat(64),
    provider_identity: null,
    active: true,
    fetched_at: null,
    confirmed_at: null,
    created_by: "user-1",
    updated_by: "user-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const CONTACT_FORM_BODY = `New contact form submission

Name: Priya Shah
Email: priya@example.net
Message: Need a quote for deck resurfacing.`;

function makeRequest() {
  return new NextRequest("http://localhost/api/integrations/email/draft", {
    method: "POST",
    body: JSON.stringify({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveEmailRouteActorMock.mockResolvedValue({
    ok: true,
    actor: { userId: "user-1", companyId: "company-1" },
  });
  resolveEmailOpportunityAccessMock.mockResolvedValue({
    allowed: true,
    actor: { userId: "user-1", companyId: "company-1" },
    operation: "send",
    threadId: null,
    connectionId: "conn-1",
    providerThreadId: null,
    opportunityId: "opp-1",
    connectionType: "company",
    connectionOwnerId: null,
    pipelineScope: "assigned",
    inboxScope: "assigned",
    usedLegacyPipelineManage: false,
    usedLegacyInboxViewCompany: false,
  });
  getConnectionsMock.mockResolvedValue([
    {
      id: "conn-1",
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      status: "active",
      provider: "gmail",
      email: "ops@example.com",
    },
  ]);
  generateDraftMock.mockResolvedValue({
    available: true,
    draft: "Thanks for getting in touch — happy to help with your deck.",
    draftHistoryId: "dh-1",
    confidence: 0.9,
    sources: [],
  });
  placeNewThreadDraftMock.mockResolvedValue({
    mailboxDraftId: "pd-new",
    threadId: "client-thread-1",
  });
});

afterEach(() => vi.clearAllMocks());

describe("POST /api/integrations/email/draft — forwarded contact-form lead", () => {
  it("starts a NEW thread to the client (placeNewThreadDraft, fresh subject) — not a Re: reply", async () => {
    const createDraft = vi.fn().mockResolvedValue("reply-draft");
    getProviderMock.mockReturnValue({
      createNewThreadDraft: vi.fn(),
      createDraft,
      updateDraft: vi.fn(),
    });

    const state: DbState = {
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          deleted_at: null,
          title: "Priya Shah — Email Inquiry",
          clients: { email: "priya@example.net", name: "Priya Shah" },
        },
      ],
      activities: [
        {
          opportunity_id: "opp-1",
          type: "email",
          direction: "inbound",
          subject: "New contact form",
          email_thread_id: "forwarder-thread",
          body_text: CONTACT_FORM_BODY,
          created_at: "2026-06-01T10:00:00Z",
        },
      ],
      email_threads: [],
      ai_draft_history: [
        {
          id: "dh-1",
          connection_id: "conn-1",
          thread_id: null,
          status: "drafted",
          mailbox_draft_id: null,
        },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(placeNewThreadDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        opportunityId: "opp-1",
        draftHistoryId: "dh-1",
        to: "priya@example.net",
        subject: "Thanks for reaching out",
        body: expect.stringContaining("Jackson"),
        contentType: "html",
      })
    );
    expect(createDraft).not.toHaveBeenCalled();
    expect(json.mailboxSaved).toBe(true);
    expect(json.mailboxDraftId).toBe("pd-new");
  });

  it("takes the reply path (Re: + createDraft) for an ordinary client reply (no contact form)", async () => {
    const createDraft = vi.fn().mockResolvedValue("reply-draft");
    getProviderMock.mockReturnValue({
      createNewThreadDraft: vi.fn(),
      createDraft,
      updateDraft: vi.fn(),
    });
    getConnectionsMock.mockResolvedValue([
      {
        id: "conn-personal",
        companyId: "company-1",
        userId: "user-1",
        type: "individual",
        status: "active",
        provider: "gmail",
        email: "operator@example.com",
      },
      {
        id: "conn-company",
        companyId: "company-1",
        userId: null,
        type: "company",
        status: "active",
        provider: "gmail",
        email: "office@example.com",
      },
    ]);
    const initialAccess = {
      allowed: true as const,
      actor: { userId: "user-1", companyId: "company-1" },
      operation: "send" as const,
      threadId: null,
      connectionId: "conn-personal",
      providerThreadId: null,
      opportunityId: "opp-1",
      connectionType: "individual" as const,
      connectionOwnerId: "user-1",
      pipelineScope: "assigned" as const,
      inboxScope: "assigned" as const,
      usedLegacyPipelineManage: false,
      usedLegacyInboxViewCompany: false,
    };
    const threadAccess = {
      ...initialAccess,
      threadId: "thread-internal-1",
      connectionId: "conn-company",
      providerThreadId: "gmail-thread-x",
      connectionType: "company" as const,
      connectionOwnerId: null,
    };
    resolveEmailOpportunityAccessMock
      .mockResolvedValueOnce(initialAccess)
      .mockResolvedValueOnce(threadAccess);

    const state: DbState = {
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          deleted_at: null,
          title: "Acme Co — Email Inquiry",
          clients: { email: "bob@acme.com", name: "Bob" },
        },
      ],
      activities: [
        {
          opportunity_id: "opp-1",
          type: "email",
          direction: "inbound",
          subject: "Question about the deck timeline",
          email_thread_id: "gmail-thread-x",
          email_connection_id: "conn-company",
          body_text: "Hey, just checking when you can start the deck?",
          created_at: "2026-06-01T10:00:00Z",
        },
      ],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "conn-company",
          provider_thread_id: "gmail-thread-x",
          opportunity_id: "opp-1",
        },
      ],
      ai_draft_history: [
        {
          id: "dh-1",
          connection_id: "conn-1",
          thread_id: "gmail-thread-x",
          status: "drafted",
          mailbox_draft_id: null,
        },
      ],
      email_signatures: [
        { ...makeSignatureRow(), connection_id: "conn-company" },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    await POST(makeRequest());

    expect(placeNewThreadDraftMock).not.toHaveBeenCalled();
    expect(getProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conn-company" })
    );
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor: { userId: "user-1", companyId: "company-1" },
      operation: "send",
      threadId: "thread-internal-1",
      connectionId: "conn-company",
      providerThreadId: "gmail-thread-x",
      opportunityId: "opp-1",
      supabase: expect.anything(),
    });
    expect(generateDraftMock).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "conn-company",
      opportunityId: "opp-1",
      threadId: "gmail-thread-x",
      emailAccess: threadAccess,
    });
    expect(createDraft).toHaveBeenCalledWith(
      "bob@acme.com",
      "Re: Question about the deck timeline",
      expect.any(String),
      "gmail-thread-x",
      "html"
    );
  });
});
