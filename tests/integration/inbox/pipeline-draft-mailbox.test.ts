/**
 * Integration test — pipeline "Draft" button mailbox push (T10)
 *
 * Tests the POST /api/integrations/email/draft route end-to-end:
 *   - Generating a draft also calls provider.createDraft and persists
 *     mailbox_draft_id + status='auto_drafted' on the ai_draft_history row.
 *   - Idempotency: an existing unresolved mailbox draft triggers updateDraft.
 *   - Works with phase_c OFF (AIDraftService does not require phase_c).
 *   - Push failure still returns the draft with mailboxSaved: false.
 *   - No active connection returns available: false on checkOnly.
 *
 * External boundaries mocked:
 *   - AIDraftService
 *   - WritingProfileService
 *   - EmailService (provider access + getConnections)
 *   - getServiceRoleClient (Supabase DB calls)
 *   - AdminFeatureOverrideService
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  generateDraftMock,
  getConnectionsMock,
  getProviderMock,
  getProfileMock,
  getConfidenceMock,
  setSupabaseOverrideMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  getConnectionsMock: vi.fn(),
  getProviderMock: vi.fn(),
  getProfileMock: vi.fn(),
  getConfidenceMock: vi.fn(),
  setSupabaseOverrideMock: vi.fn(),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: {
    generateDraft: generateDraftMock,
  },
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    getProfile: getProfileMock,
    getConfidence: getConfidenceMock,
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnections: getConnectionsMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: setSupabaseOverrideMock,
  requireSupabase: vi.fn(),
}));

// ─── In-memory Supabase double ─────────────────────────────────────────────────

interface DbState {
  aiDraftHistory: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  emailThreads: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: DbState) {
  class Query {
    private _table: string;
    private _action: "select" | "insert" | "update" = "select";
    private _payload: Record<string, unknown> | null = null;
    private _filters = new Map<string, unknown>();
    private _notNullCols: string[] = [];
    private _limitN: number | null = null;
    private _ascending = true;
    private _cols = "*";

    constructor(table: string) {
      this._table = table;
    }

    select(cols?: string) {
      this._cols = cols ?? "*";
      return this;
    }

    eq(col: string, val: unknown) {
      this._filters.set(col, val);
      return this;
    }

    not(col: string, _op: string, _val: unknown) {
      this._notNullCols.push(col);
      return this;
    }

    order(_col: string, opts?: { ascending?: boolean }) {
      this._ascending = opts?.ascending ?? true;
      return this;
    }

    limit(n: number) {
      this._limitN = n;
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this._action = "insert";
      this._payload = payload;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this._action = "update";
      this._payload = payload;
      return this;
    }

    private _resolve(): { data: unknown; error: null } {
      if (this._action === "update") {
        const id = this._filters.get("id");
        if (this._table === "ai_draft_history" && id) {
          const row = state.aiDraftHistory.find((r) => r.id === id);
          if (row && this._payload) Object.assign(row, this._payload);
        }
        return { data: null, error: null };
      }

      if (this._action === "insert") {
        return { data: null, error: null };
      }

      // SELECT paths
      if (this._table === "opportunities") {
        const id = this._filters.get("id");
        const row =
          state.opportunities.find((r) => r.id === id) ?? null;
        return { data: row, error: null };
      }

      if (this._table === "activities") {
        const oppId = this._filters.get("opportunity_id");
        let rows = state.activities.filter((r) => r.opportunity_id === oppId);
        // direction filter
        const dir = this._filters.get("direction");
        if (dir) rows = rows.filter((r) => r.direction === dir);
        const type = this._filters.get("type");
        if (type) rows = rows.filter((r) => r.type === type);
        if (!this._ascending) rows = [...rows].reverse();
        if (this._limitN !== null) rows = rows.slice(0, this._limitN);
        return { data: rows, error: null };
      }

      if (this._table === "email_threads") {
        const id = this._filters.get("id");
        const row = state.emailThreads.find((r) => r.id === id) ?? null;
        return { data: row, error: null };
      }

      if (this._table === "ai_draft_history") {
        const connId = this._filters.get("connection_id");
        const threadId = this._filters.get("thread_id");
        let rows = state.aiDraftHistory.filter((r) => {
          if (connId !== undefined && r.connection_id !== connId) return false;
          if (threadId !== undefined && r.thread_id !== threadId) return false;
          for (const col of this._notNullCols) {
            if (r[col] === null || r[col] === undefined) return false;
          }
          return true;
        });
        if (this._limitN !== null) rows = rows.slice(0, this._limitN);
        return { data: rows, error: null };
      }

      return { data: null, error: null };
    }

    then<T1 = unknown, T2 = never>(
      onFulfilled?: ((val: unknown) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
    ) {
      return Promise.resolve(this._resolve()).then(onFulfilled, onRejected);
    }

    async single() {
      const { data, error } = this._resolve();
      // For single(), if data is an array, return first element
      if (Array.isArray(data)) {
        return { data: (data[0] ?? null) as Record<string, unknown> | null, error };
      }
      return { data: data as Record<string, unknown> | null, error };
    }

    async maybeSingle() {
      return this.single();
    }
  }

  return {
    from: (table: string) => new Query(table),
  };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeActiveConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: "user-1",
    email: "ops@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2099-01-01"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/integrations/email/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Setup / teardown ──────────────────────────────────────────────────────────

// Capture setSupabaseOverride calls to inject our double
let capturedSupabaseDouble: ReturnType<typeof makeSupabaseDouble> | null = null;

// We need to intercept getServiceRoleClient at import-time.
// Since the route calls getServiceRoleClient() and then setSupabaseOverride(),
// we mock getServiceRoleClient to return the double we inject via setSupabaseOverride.
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => capturedSupabaseDouble,
}));

// Override setSupabaseOverride to capture the injected value
vi.mocked(setSupabaseOverrideMock).mockImplementation((client) => {
  // No-op in the mock — the route uses the return value of getServiceRoleClient directly
  void client;
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: writing profile with sufficient emails
  getProfileMock.mockResolvedValue({ emails_analyzed: 20 });
  getConfidenceMock.mockReturnValue(0.45);

  // Default: no auto-send
  generateDraftMock.mockResolvedValue({
    available: true,
    draft: "Hi, thanks for reaching out. I can send a quote shortly.",
    draftHistoryId: "history-1",
    confidence: 0.72,
    sources: ["writing_profile", "thread_history"],
    profileType: "client_quoting",
  });

  // Default: one active Gmail connection
  getConnectionsMock.mockResolvedValue([makeActiveConnection()]);
});

afterEach(() => {
  capturedSupabaseDouble = null;
});

// ─── Import AFTER all vi.mock() calls are registered ──────────────────────────
// Dynamic import in each test so the mock registry is fully set up.

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/integrations/email/draft — mailbox push (T10)", () => {

  it("generating a draft calls provider.createDraft and persists mailbox_draft_id + status='auto_drafted'", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "history-1",
          connection_id: "conn-1",
          thread_id: "thread-provider-1",
          status: "drafted",
          mailbox_draft_id: null,
        },
      ],
      opportunities: [
        {
          id: "opp-1",
          title: "Deck Repair",
          clients: { email: "client@example.com", name: "John Smith" },
        },
      ],
      activities: [
        {
          id: "act-1",
          opportunity_id: "opp-1",
          type: "email",
          direction: "inbound",
          subject: "Need a quote",
          email_thread_id: "thread-internal-1",
        },
      ],
      emailThreads: [
        {
          id: "thread-internal-1",
          provider_thread_id: "thread-provider-1",
        },
      ],
    };

    capturedSupabaseDouble = makeSupabaseDouble(state);

    const createDraftMock = vi.fn().mockResolvedValue("mailbox-draft-abc");
    const updateDraftMock = vi.fn().mockResolvedValue(undefined);
    getProviderMock.mockReturnValue({
      createDraft: createDraftMock,
      updateDraft: updateDraftMock,
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
    }));

    const json = await res.json();

    // Response shape
    expect(json.draft).toBeTruthy();
    expect(json.available).toBe(true);
    expect(json.mailboxSaved).toBe(true);
    expect(json.mailboxDraftId).toBe("mailbox-draft-abc");
    expect(json.provider).toBe("gmail");

    // provider.createDraft called with correct args
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(createDraftMock).toHaveBeenCalledWith(
      "client@example.com",
      "Re: Need a quote",
      expect.stringContaining("quote"),
      "thread-provider-1"
    );
    expect(updateDraftMock).not.toHaveBeenCalled();

    // ai_draft_history row updated
    const row = state.aiDraftHistory.find((r) => r.id === "history-1");
    expect(row?.status).toBe("auto_drafted");
    expect(row?.mailbox_draft_id).toBe("mailbox-draft-abc");
  });

  it("idempotency: existing unresolved mailbox draft → calls updateDraft, not createDraft", async () => {
    const state: DbState = {
      aiDraftHistory: [
        // Prior row with mailbox_draft_id already placed
        {
          id: "history-prior",
          connection_id: "conn-1",
          thread_id: "thread-provider-1",
          status: "auto_drafted",
          mailbox_draft_id: "existing-mailbox-draft",
        },
        // New row returned by AIDraftService for this call
        {
          id: "history-1",
          connection_id: "conn-1",
          thread_id: "thread-provider-1",
          status: "drafted",
          mailbox_draft_id: null,
        },
      ],
      opportunities: [
        {
          id: "opp-1",
          title: "Deck Repair",
          clients: { email: "client@example.com", name: "John Smith" },
        },
      ],
      activities: [
        {
          id: "act-1",
          opportunity_id: "opp-1",
          type: "email",
          direction: "inbound",
          subject: "Re: Need a quote",
          email_thread_id: "thread-internal-1",
        },
      ],
      emailThreads: [
        {
          id: "thread-internal-1",
          provider_thread_id: "thread-provider-1",
        },
      ],
    };

    capturedSupabaseDouble = makeSupabaseDouble(state);

    const createDraftMock = vi.fn().mockResolvedValue("new-draft");
    const updateDraftMock = vi.fn().mockResolvedValue(undefined);
    getProviderMock.mockReturnValue({
      createDraft: createDraftMock,
      updateDraft: updateDraftMock,
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
    }));

    const json = await res.json();

    // updateDraft must be called, createDraft must NOT
    expect(updateDraftMock).toHaveBeenCalledTimes(1);
    expect(updateDraftMock).toHaveBeenCalledWith(
      "existing-mailbox-draft",
      "client@example.com",
      "Re: Need a quote",
      expect.any(String),
      "thread-provider-1"
    );
    expect(createDraftMock).not.toHaveBeenCalled();

    expect(json.mailboxSaved).toBe(true);
    expect(json.mailboxDraftId).toBe("existing-mailbox-draft");
  });

  it("works with phase_c OFF — AIDraftService is called without phase_c gate, mailbox push still happens", async () => {
    // AIDraftService does not require phase_c. The route no longer checks it.
    // Simulate AIDraftService returning a draft even when phase_c context is unavailable.
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Thank you, I will follow up.",
      draftHistoryId: "history-1",
      confidence: 0.5,
      sources: ["writing_profile"],
    });

    const state: DbState = {
      aiDraftHistory: [
        {
          id: "history-1",
          connection_id: "conn-1",
          thread_id: null,
          status: "drafted",
          mailbox_draft_id: null,
        },
      ],
      opportunities: [
        {
          id: "opp-1",
          title: "Fence install",
          clients: { email: "jane@example.com", name: "Jane Doe" },
        },
      ],
      activities: [],
      emailThreads: [],
    };

    capturedSupabaseDouble = makeSupabaseDouble(state);

    const createDraftMock = vi.fn().mockResolvedValue("draft-no-thread");
    getProviderMock.mockReturnValue({
      createDraft: createDraftMock,
      updateDraft: vi.fn(),
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
    }));

    const json = await res.json();

    // Draft was generated and returned
    expect(json.available).toBe(true);
    expect(json.draft).toBeTruthy();
    // createDraft is called even without a thread (no threadId arg)
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(createDraftMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.stringContaining("Fence install"),
      expect.any(String),
      undefined // no provider thread id
    );
    expect(json.mailboxSaved).toBe(true);
  });

  it("push failure still returns the draft with mailboxSaved: false", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "history-1",
          connection_id: "conn-1",
          thread_id: null,
          status: "drafted",
          mailbox_draft_id: null,
        },
      ],
      opportunities: [
        {
          id: "opp-1",
          title: "Roofing",
          clients: { email: "bob@example.com", name: "Bob" },
        },
      ],
      activities: [],
      emailThreads: [],
    };

    capturedSupabaseDouble = makeSupabaseDouble(state);

    const createDraftMock = vi
      .fn()
      .mockRejectedValue(new Error("OAuth token expired"));
    getProviderMock.mockReturnValue({
      createDraft: createDraftMock,
      updateDraft: vi.fn(),
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
    }));

    expect(res.status).toBe(200);
    const json = await res.json();

    // Draft is still returned so Copy to Clipboard works
    expect(json.draft).toBeTruthy();
    expect(json.available).toBe(true);
    expect(json.mailboxSaved).toBe(false);

    // Status-only fallback: row gets auto_drafted without mailbox_draft_id
    const row = state.aiDraftHistory.find((r) => r.id === "history-1");
    expect(row?.status).toBe("auto_drafted");
    expect(row?.mailbox_draft_id).toBeNull();
  });

  it("checkOnly with no connection returns available: false with 'No mailbox connected'", async () => {
    getConnectionsMock.mockResolvedValue([]); // no connections

    // capturedSupabaseDouble doesn't matter here since we return before any DB call
    capturedSupabaseDouble = makeSupabaseDouble({
      aiDraftHistory: [],
      opportunities: [],
      activities: [],
      emailThreads: [],
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
      checkOnly: true,
    }));

    const json = await res.json();
    expect(json.available).toBe(false);
    expect(json.reason).toMatch(/no mailbox connected/i);
  });

  it("checkOnly with an active connection and sufficient emails returns available: true + provider", async () => {
    getProfileMock.mockResolvedValue({ emails_analyzed: 15 });
    getConfidenceMock.mockReturnValue(0.5);

    capturedSupabaseDouble = makeSupabaseDouble({
      aiDraftHistory: [],
      opportunities: [],
      activities: [],
      emailThreads: [],
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
      checkOnly: true,
    }));

    const json = await res.json();
    expect(json.available).toBe(true);
    expect(json.provider).toBe("gmail");
  });

  it("Outlook connection surfaces provider='microsoft365' in the response", async () => {
    getConnectionsMock.mockResolvedValue([
      makeActiveConnection({ provider: "microsoft365" }),
    ]);

    const state: DbState = {
      aiDraftHistory: [
        { id: "history-1", connection_id: "conn-1", thread_id: null, status: "drafted", mailbox_draft_id: null },
      ],
      opportunities: [
        { id: "opp-1", title: "Paving", clients: { email: "mary@co.com", name: "Mary" } },
      ],
      activities: [],
      emailThreads: [],
    };

    capturedSupabaseDouble = makeSupabaseDouble(state);

    getProviderMock.mockReturnValue({
      createDraft: vi.fn().mockResolvedValue("outlook-draft-id"),
      updateDraft: vi.fn(),
    });

    const { POST } = await import(
      "@/app/api/integrations/email/draft/route"
    );

    const res = await POST(makeRequest({
      companyId: "company-1",
      userId: "user-1",
      opportunityId: "opp-1",
    }));

    const json = await res.json();
    expect(json.provider).toBe("microsoft365");
    expect(json.mailboxSaved).toBe(true);
  });
});
