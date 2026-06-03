/**
 * Integration test — reconcilePendingMailboxDrafts (Task 5 / Part B)
 *
 * Tests the reconciliation runner that closes the Phase C learning loop when
 * users send from their native mail client (Gmail/Outlook) instead of the
 * OPS inbox composer.
 *
 * External boundaries mocked:
 *   - AIDraftService.recordDraftOutcome
 *   - EmailService.getProvider (fake provider with listDrafts)
 *   - requireSupabase / setSupabaseOverride (in-memory DB double)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { NormalizedDraft } from "@/lib/api/services/email-provider";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { recordDraftOutcomeMock, getProviderMock } = vi.hoisted(() => ({
  recordDraftOutcomeMock: vi.fn(),
  getProviderMock: vi.fn(),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: {
    recordDraftOutcome: recordDraftOutcomeMock,
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: getProviderMock,
    getConnection: vi.fn(),
    updateConnection: vi.fn(),
  },
}));

// Import AFTER mocks are registered
import { reconcilePendingMailboxDrafts } from "@/lib/api/services/draft-reconciliation";
import { requireSupabase } from "@/lib/supabase/helpers";

// ─── In-memory Supabase double ────────────────────────────────────────────────

interface DbState {
  aiDraftHistory: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: DbState) {
  // Minimal builder that supports the exact query patterns used by
  // reconcilePendingMailboxDrafts. Mirrors the pattern from auto-draft-mailbox.test.ts.
  class Query {
    private _table: string;
    private _action: "select" | "update" = "select";
    private _payload: Record<string, unknown> | null = null;
    private _filters = new Map<string, unknown>();
    private _notFilters = new Map<string, unknown>();
    private _selectCols = "*";
    private _orderCol: string | null = null;
    private _orderAsc = true;

    constructor(table: string) {
      this._table = table;
    }

    select(cols?: string) {
      if (cols) this._selectCols = cols;
      return this;
    }

    eq(col: string, val: unknown) {
      this._filters.set(col, val);
      return this;
    }

    not(col: string, op: string, val: unknown) {
      if (op === "is") {
        // .not("mailbox_draft_id", "is", null) → require mailbox_draft_id to be not null
        this._notFilters.set(col, "not_null");
      }
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this._orderCol = col;
      this._orderAsc = opts?.ascending !== false;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this._action = "update";
      this._payload = payload;
      return this;
    }

    private _applyFilters(rows: Array<Record<string, unknown>>) {
      let filtered = rows;
      for (const [col, val] of this._filters) {
        filtered = filtered.filter((r) => r[col] === val);
      }
      for (const [col, rule] of this._notFilters) {
        if (rule === "not_null") {
          filtered = filtered.filter((r) => r[col] != null);
        }
      }
      return filtered;
    }

    private _applyOrder(rows: Array<Record<string, unknown>>) {
      if (!this._orderCol) return rows;
      const col = this._orderCol;
      return [...rows].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return this._orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    private _resolve(): { data: unknown; error: null } {
      if (this._action === "update") {
        const idFilter = this._filters.get("id");
        if (this._table === "ai_draft_history" && idFilter !== undefined) {
          const row = state.aiDraftHistory.find((r) => r.id === idFilter);
          if (row && this._payload) Object.assign(row, this._payload);
        }
        return { data: null, error: null };
      }

      // SELECT
      if (this._table === "ai_draft_history") {
        const rows = this._applyOrder(this._applyFilters(state.aiDraftHistory));
        return { data: rows, error: null };
      }
      if (this._table === "activities") {
        const rows = this._applyOrder(this._applyFilters(state.activities));
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    }

    then<T1 = unknown, T2 = never>(
      onFulfilled?: ((val: unknown) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
    ) {
      return Promise.resolve(this._resolve()).then(onFulfilled, onRejected);
    }

    async single() {
      const { data, error } = this._resolve();
      const arr = Array.isArray(data) ? data : [];
      return { data: arr[0] ?? null, error };
    }
  }

  return {
    from: (table: string) => new Query(table),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeConnection(overrides: Partial<EmailConnection> = {}): EmailConnection {
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
    historyId: "sync-token",
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {
      includeSentMail: true,
      estimateSubjectPatterns: ["estimate"],
      companyDomains: ["example.com"],
      teamForwarders: [],
    },
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

/** A pending ai_draft_history row placed in the mailbox 2 days ago. */
function makePendingDraftRow(overrides: Partial<Record<string, unknown>> = {}) {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: "draft-row-1",
    company_id: "company-1",
    user_id: "user-1",
    connection_id: "conn-1",
    thread_id: "thread-abc",
    status: "auto_drafted",
    mailbox_draft_id: "provider-draft-1",
    profile_type: "client_quoting",
    original_draft: "Hi, here's your quote…",
    created_at: twoDaysAgo,
    ...overrides,
  };
}

/** An outbound activity that occurred AFTER the draft was placed. */
function makeOutboundActivity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "act-1",
    company_id: "company-1",
    email_thread_id: "thread-abc",
    direction: "outbound",
    body_text: "Thanks for reaching out. The price is $5,000.",
    created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
    ...overrides,
  };
}

function makeInboundActivity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "act-0",
    company_id: "company-1",
    email_thread_id: "thread-abc",
    direction: "inbound",
    body_text: "Can you give me a quote for decking?",
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    ...overrides,
  };
}

function makeDraft(id: string, threadId: string | null = null): NormalizedDraft {
  return {
    id,
    threadId,
    to: ["client@customer.com"],
    cc: [],
    subject: "Re: Need a quote",
    bodyText: "Hi, here's your quote…",
    updatedAt: new Date(),
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  recordDraftOutcomeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  setSupabaseOverride(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reconcilePendingMailboxDrafts", () => {
  // ── "used" path ─────────────────────────────────────────────────────────────

  it("used: calls recordDraftOutcome once with a cleaned body and updates status to sent_from_mailbox when draft is gone and outbound exists", async () => {
    const pendingRow = makePendingDraftRow();

    // The outbound body includes an Outlook-style quote header that
    // stripQuotedContent should strip (the "On ... wrote:" pattern fires).
    // We also include a sentence before the quote to confirm the new content
    // survives the strip.
    const outboundBodyWithQuote =
      "Thanks for reaching out. The price is $5,000.\n\n" +
      "On Mon, Jan 1, 2026, at 10:00 AM, Client wrote:\n" +
      "> Can you give me a quote for decking?";

    const state: DbState = {
      aiDraftHistory: [pendingRow],
      activities: [
        makeInboundActivity(),
        makeOutboundActivity({ body_text: outboundBodyWithQuote }),
      ],
    };

    // Draft is NOT in listDrafts → draftStillInMailbox = false
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([
        // Different draft (unrelated) — our draft-id not here
        makeDraft("other-draft-999"),
      ]),
    });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase,
    });

    // recordDraftOutcome must have been called once
    expect(recordDraftOutcomeMock).toHaveBeenCalledTimes(1);
    expect(recordDraftOutcomeMock).toHaveBeenCalledWith(
      "draft-row-1",      // draftHistoryId
      "company-1",        // companyId
      "user-1",           // userId
      "sent",             // outcome
      expect.any(String), // cleanBody (quote-stripped)
      "client_quoting"    // profileType
    );

    // The clean body should NOT contain the quoted attribution line.
    // stripQuotedContent fires on "On Mon, Jan 1, 2026, at 10:00 AM, Client wrote:"
    // (matches QUOTE_MARKERS /^On .{10,80} wrote:\s*$/m).
    const calledBody = recordDraftOutcomeMock.mock.calls[0][4] as string;
    expect(calledBody).not.toMatch(/Jan 1, 2026/);
    expect(calledBody).toContain("$5,000");

    // Status must be overridden to sent_from_mailbox
    expect(pendingRow.status).toBe("sent_from_mailbox");
  });

  // ── "from_scratch" path ─────────────────────────────────────────────────────

  it("from_scratch: does NOT call recordDraftOutcome and sets status to superseded when draft is still present and outbound exists", async () => {
    const pendingRow = makePendingDraftRow();
    const state: DbState = {
      aiDraftHistory: [pendingRow],
      activities: [makeInboundActivity(), makeOutboundActivity()],
    };

    // Draft IS still in listDrafts → draftStillInMailbox = true
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([
        makeDraft("provider-draft-1", "thread-abc"),
      ]),
    });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase,
    });

    // recordDraftOutcome must NOT be called — the existing learnFromOutboundEmail
    // in sync-engine already captured this reply as a voice sample.
    expect(recordDraftOutcomeMock).not.toHaveBeenCalled();

    // Status should be superseded
    expect(pendingRow.status).toBe("superseded");
  });

  // ── "discarded" path ────────────────────────────────────────────────────────

  it("discarded: sets status to discarded_in_mailbox when draft is gone, no outbound, and past TTL (14 days)", async () => {
    // Draft created 15 days ago
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const pendingRow = makePendingDraftRow({ created_at: fifteenDaysAgo });
    const state: DbState = {
      aiDraftHistory: [pendingRow],
      activities: [makeInboundActivity({ created_at: fifteenDaysAgo })], // only inbound, no outbound
    };

    // Draft not in mailbox anymore
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([]),
    });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase,
    });

    expect(recordDraftOutcomeMock).not.toHaveBeenCalled();
    expect(pendingRow.status).toBe("discarded_in_mailbox");
  });

  // ── cheap path: no pending rows ─────────────────────────────────────────────

  it("cheap path: does NOT call provider.listDrafts when there are no pending rows for the thread", async () => {
    const state: DbState = {
      aiDraftHistory: [
        // This row exists but is for a DIFFERENT thread — should not match
        makePendingDraftRow({ thread_id: "thread-other" }),
      ],
      activities: [],
    };

    const listDraftsMock = vi.fn().mockResolvedValue([]);
    getProviderMock.mockReturnValue({ listDrafts: listDraftsMock });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase,
    });

    // The provider must NOT be called when there are no pending rows
    expect(listDraftsMock).not.toHaveBeenCalled();
    expect(recordDraftOutcomeMock).not.toHaveBeenCalled();
  });

  // ── cheap path: row without mailbox_draft_id excluded ──────────────────────

  it("cheap path: does NOT call provider.listDrafts when auto_drafted row has no mailbox_draft_id", async () => {
    const state: DbState = {
      // Row is auto_drafted but mailbox_draft_id is null (push failed previously)
      aiDraftHistory: [makePendingDraftRow({ mailbox_draft_id: null })],
      activities: [],
    };

    const listDraftsMock = vi.fn().mockResolvedValue([]);
    getProviderMock.mockReturnValue({ listDrafts: listDraftsMock });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase,
    });

    expect(listDraftsMock).not.toHaveBeenCalled();
  });

  // ── "pending" path: within TTL, draft gone, no outbound ────────────────────

  it("pending: does nothing (no DB update, no recordDraftOutcome) when draft is gone but within TTL and no outbound", async () => {
    // Draft created 5 days ago — within default 14-day TTL
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const pendingRow = makePendingDraftRow({ created_at: fiveDaysAgo });
    const initialStatus = pendingRow.status;

    const state: DbState = {
      aiDraftHistory: [pendingRow],
      activities: [], // no outbound
    };

    // Draft not in mailbox (maybe user deleted it, or it's on another page)
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([]),
    });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase,
    });

    expect(recordDraftOutcomeMock).not.toHaveBeenCalled();
    // Status must remain unchanged — we did nothing
    expect(pendingRow.status).toBe(initialStatus);
  });

  // ── provider listDrafts failure is non-fatal ────────────────────────────────

  it("non-fatal: returns without throwing when listDrafts throws", async () => {
    const pendingRow = makePendingDraftRow();
    const state: DbState = {
      aiDraftHistory: [pendingRow],
      activities: [],
    };

    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockRejectedValue(new Error("Provider timeout")),
    });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    // Must not throw — returns early and the row stays as-is
    await expect(
      reconcilePendingMailboxDrafts({
        connection: makeConnection(),
        providerThreadId: "thread-abc",
        supabase,
      })
    ).resolves.toBeUndefined();

    expect(recordDraftOutcomeMock).not.toHaveBeenCalled();
  });

  // ── new-thread (forwarded contact-form) reconciliation contract ─────────────

  it("new-thread (contact-form): reconciles to sent_from_mailbox when the user sends on the minted thread", async () => {
    // A contact-form auto-draft is placed on a NEW client thread (not the
    // forwarder's). placeNewThreadDraft stamps ai_draft_history.thread_id with
    // that minted thread and links it, so when the user sends, processSentEmail
    // records an outbound activity on the SAME thread. This locks the invariant
    // that the learning loop then classifies the send as "used" — without the
    // new thread_id + link, the send would be invisible here and the draft would
    // rot to discarded_in_mailbox after the TTL, poisoning Phase C learning.
    const draftRow = makePendingDraftRow({
      thread_id: "client-thread-1",
      mailbox_draft_id: "pd-new",
      profile_type: "general",
    });
    const state: DbState = {
      aiDraftHistory: [draftRow],
      activities: [
        makeOutboundActivity({
          email_thread_id: "client-thread-1",
          body_text:
            "Thanks for reaching out. Happy to help with your deck — free for a call this week?",
        }),
      ],
    };

    // Draft gone from the mailbox → user sent it.
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([]),
    });

    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const supabase = requireSupabase();

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "client-thread-1",
      supabase,
    });

    expect(recordDraftOutcomeMock).toHaveBeenCalledWith(
      "draft-row-1",
      "company-1",
      "user-1",
      "sent",
      expect.any(String),
      "general"
    );
    expect(draftRow.status).toBe("sent_from_mailbox");
  });
});
