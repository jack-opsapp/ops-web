/**
 * Integration tests for the native-mailbox Phase C reconciliation boundary.
 * Provider delivery and the durable learning queue stay mocked; the query and
 * state transitions run against an in-memory Supabase-shaped double.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedDraft } from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

const { enqueueIfEnabledMock, getProviderMock, listKnownSignaturesMock } =
  vi.hoisted(() => ({
    enqueueIfEnabledMock: vi.fn(),
    getProviderMock: vi.fn(),
    listKnownSignaturesMock: vi.fn(),
  }));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getProvider: getProviderMock },
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled = enqueueIfEnabledMock;
  },
}));

vi.mock("@/lib/api/services/email-signature-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/email-signature-service")
  >("@/lib/api/services/email-signature-service");
  return {
    ...actual,
    EmailSignatureService: {
      ...actual.EmailSignatureService,
      listKnown: listKnownSignaturesMock,
    },
  };
});

import { reconcilePendingMailboxDrafts } from "@/lib/api/services/draft-reconciliation";

interface DbState {
  ai_draft_history: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  opportunity_follow_up_drafts: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: DbState) {
  class Query {
    private action: "select" | "update" = "select";
    private payload: Record<string, unknown> | null = null;
    private filters = new Map<string, unknown>();
    private notNull = new Set<string>();
    private orderColumn: string | null = null;
    private orderAscending = true;
    private limitCount: number | null = null;

    constructor(private readonly table: keyof DbState) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    not(column: string, operator: string, value: unknown) {
      if (operator === "is" && value === null) this.notNull.add(column);
      return this;
    }

    order(column: string, options?: { ascending?: boolean }) {
      this.orderColumn = column;
      this.orderAscending = options?.ascending !== false;
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    private matches(row: Record<string, unknown>) {
      for (const [column, value] of this.filters) {
        if (row[column] !== value) return false;
      }
      for (const column of this.notNull) {
        if (row[column] == null) return false;
      }
      return true;
    }

    private resolve() {
      let rows = state[this.table].filter((row) => this.matches(row));
      if (this.orderColumn) {
        const column = this.orderColumn;
        rows = [...rows].sort((left, right) => {
          const comparison = String(left[column] ?? "").localeCompare(
            String(right[column] ?? "")
          );
          return this.orderAscending ? comparison : -comparison;
        });
      }
      if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);

      if (this.action === "update" && this.payload) {
        for (const row of rows) Object.assign(row, this.payload);
        return { data: null, error: null };
      }
      return { data: rows, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
    }
  }

  return {
    from: (table: keyof DbState) => new Query(table),
    rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
}

function makeConnection(
  overrides: Partial<EmailConnection> = {}
): EmailConnection {
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

function pendingDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-row-1",
    company_id: "company-1",
    user_id: "user-1",
    connection_id: "conn-1",
    thread_id: "thread-abc",
    origin: "phase_c",
    status: "auto_drafted",
    mailbox_draft_id: "provider-draft-1",
    profile_type: "client_quoting",
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function outboundActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: "activity-1",
    company_id: "company-1",
    email_connection_id: "conn-1",
    email_thread_id: "thread-abc",
    email_message_id: "sent-message-1",
    direction: "outbound",
    subject: "Re: Need a quote",
    body_text:
      "Final operator body\n\nOld Jackson\nOld OPS\n\n" +
      "On Tue, Jul 14, 2026, Lead wrote:\n> Prior customer text",
    from_email: "ops@example.com",
    to_emails: ["lead@example.com"],
    opportunity_id: "opportunity-1",
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function providerDraft(): NormalizedDraft {
  return {
    id: "provider-draft-1",
    threadId: "thread-abc",
    to: ["lead@example.com"],
    cc: [],
    subject: "Re: Need a quote",
    bodyText: "Still editing",
    updatedAt: new Date(),
  };
}

function state(
  drafts: Array<Record<string, unknown>>,
  activities: Array<Record<string, unknown>> = []
): DbState {
  return {
    ai_draft_history: drafts,
    activities,
    opportunity_follow_up_drafts: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueueIfEnabledMock.mockResolvedValue({ id: "queue-1" });
  listKnownSignaturesMock.mockResolvedValue([
    {
      scopeUserId: null,
      contentHtml: "<div>Old Jackson<br>Old OPS</div>",
      contentText: "Old Jackson\nOld OPS",
      contentHash: "a".repeat(64),
    },
  ]);
});

describe("reconcilePendingMailboxDrafts", () => {
  it("queues one exact signature- and quote-free sample for a mailbox-sent draft", async () => {
    const draft = pendingDraft();
    getProviderMock.mockReturnValue({
      getDraft: vi.fn().mockResolvedValue(null),
    });

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase: makeSupabaseDouble(
        state([draft], [outboundActivity()])
      ) as never,
    });

    expect(enqueueIfEnabledMock).toHaveBeenCalledOnce();
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: "sent-message-1",
        draftHistoryId: "draft-row-1",
        authoredBody: "Final operator body",
        cleanBody: "Final operator body",
        learningAuthority: "operator_approved",
      })
    );
    // The durable queue owns the sent-state transition after learning applies.
    expect(draft.status).toBe("auto_drafted");
  });

  it("treats a sent reply as from-scratch while the exact provider draft still exists", async () => {
    const draft = pendingDraft();
    getProviderMock.mockReturnValue({
      getDraft: vi.fn().mockResolvedValue(providerDraft()),
    });

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase: makeSupabaseDouble(
        state([draft], [outboundActivity()])
      ) as never,
    });

    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: "sent-message-1",
        learningAuthority: "operator_authored",
      })
    );
    expect(enqueueIfEnabledMock.mock.calls[0][0]).not.toHaveProperty(
      "draftHistoryId"
    );
    expect(draft.status).toBe("superseded");
    expect(draft).toMatchObject({ discarded_at: expect.any(String) });
  });

  it("marks an exact missing draft discarded only after the TTL", async () => {
    const draft = pendingDraft({
      created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    });
    getProviderMock.mockReturnValue({
      getDraft: vi.fn().mockResolvedValue(null),
    });

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase: makeSupabaseDouble(state([draft])) as never,
    });

    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
    expect(draft.status).toBe("discarded_in_mailbox");
  });

  it("keeps a missing draft pending inside the TTL", async () => {
    const draft = pendingDraft();
    getProviderMock.mockReturnValue({
      getDraft: vi.fn().mockResolvedValue(null),
    });

    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase: makeSupabaseDouble(state([draft])) as never,
    });

    expect(draft.status).toBe("auto_drafted");
    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
  });

  it("does not touch the provider when no pending mailbox history exists", async () => {
    await reconcilePendingMailboxDrafts({
      connection: makeConnection(),
      providerThreadId: "thread-abc",
      supabase: makeSupabaseDouble(
        state([pendingDraft({ thread_id: "another-thread" })])
      ) as never,
    });

    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("fails closed and retries later when exact provider lookup errors", async () => {
    const draft = pendingDraft();
    getProviderMock.mockReturnValue({
      getDraft: vi.fn().mockRejectedValue(new Error("Provider timeout")),
    });

    await expect(
      reconcilePendingMailboxDrafts({
        connection: makeConnection(),
        providerThreadId: "thread-abc",
        supabase: makeSupabaseDouble(state([draft])) as never,
      })
    ).resolves.toBeUndefined();

    expect(draft.status).toBe("auto_drafted");
    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
  });
});
