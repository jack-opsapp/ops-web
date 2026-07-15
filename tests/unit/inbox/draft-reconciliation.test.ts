/**
 * Unit tests — classifyDraftOutcome (Part A)
 *
 * Pure classifier: no I/O, no mocks, no async.
 * TDD: write tests first, watch them fail, implement, go green.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

const { getDraftMock, enqueueIfEnabledMock, listKnownSignaturesMock } =
  vi.hoisted(() => ({
    getDraftMock: vi.fn(),
    enqueueIfEnabledMock: vi.fn(),
    listKnownSignaturesMock: vi.fn(),
  }));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: () => ({ getDraft: getDraftMock }),
  },
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

import {
  classifyDraftOutcome,
  reconcilePendingMailboxDrafts,
  type DraftOutcome,
} from "@/lib/api/services/draft-reconciliation";

describe("classifyDraftOutcome", () => {
  // ── used: draft gone + outbound reply exists ─────────────────────────────
  it("returns 'used' when draft is gone from mailbox and there is an outbound reply", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: true,
      daysSinceDraft: 2,
    });
    expect(result).toBe<DraftOutcome>("used");
  });

  it("returns 'used' regardless of TTL when there is an outbound reply and the draft is gone", () => {
    // TTL is irrelevant when hasOutboundAfter is true and draft is gone
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: true,
      daysSinceDraft: 30,
      ttlDays: 7,
    });
    expect(result).toBe<DraftOutcome>("used");
  });

  // ── from_scratch: draft still present + outbound reply exists ───────────
  it("returns 'from_scratch' when draft is still in the mailbox but an outbound reply was sent", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: true,
      daysSinceDraft: 3,
    });
    expect(result).toBe<DraftOutcome>("from_scratch");
  });

  it("returns 'from_scratch' even when well past the TTL if the draft is still present and a reply was sent", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: true,
      daysSinceDraft: 60,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("from_scratch");
  });

  // ── discarded: draft gone + no outbound + past TTL ───────────────────────
  it("returns 'discarded' when draft is gone, no outbound reply, and past default TTL (14 days)", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 14,
    });
    expect(result).toBe<DraftOutcome>("discarded");
  });

  it("returns 'discarded' when draft is gone, no outbound reply, and past a custom TTL", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 8,
      ttlDays: 7,
    });
    expect(result).toBe<DraftOutcome>("discarded");
  });

  it("returns 'discarded' on exactly the TTL boundary (>= is discarded)", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 14,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("discarded");
  });

  // ── pending: still in mailbox + no outbound ──────────────────────────────
  it("returns 'pending' when draft is still in the mailbox and no outbound reply yet", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: false,
      daysSinceDraft: 1,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  it("returns 'pending' even when past TTL if the draft is still sitting in the mailbox", () => {
    // Draft still present = user may yet send it; don't call it discarded
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: false,
      daysSinceDraft: 30,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  // ── pending: draft gone + no outbound + within TTL ───────────────────────
  it("returns 'pending' when draft is gone, no outbound, but within TTL window", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 5,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  it("returns 'pending' when draft is gone, no outbound, one day before TTL", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 13,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  it("uses 14 days as the default TTL when ttlDays is not provided", () => {
    // 13 days → still pending with default 14-day TTL
    const pendingResult = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 13,
    });
    expect(pendingResult).toBe<DraftOutcome>("pending");

    // 14 days → now discarded with default TTL
    const discardedResult = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 14,
    });
    expect(discardedResult).toBe<DraftOutcome>("discarded");
  });
});

describe("reconcilePendingMailboxDrafts", () => {
  beforeEach(() => {
    getDraftMock.mockReset();
    enqueueIfEnabledMock.mockReset();
    getDraftMock.mockResolvedValue(null);
    enqueueIfEnabledMock.mockResolvedValue({ id: "queue-1" });
    listKnownSignaturesMock.mockResolvedValue([
      {
        scopeUserId: null,
        contentHtml: "<div>Old Jackson<br>Old OPS LTD.</div>",
        contentText: "Old Jackson\nOld OPS LTD.",
        contentHash: "a".repeat(64),
      },
    ]);
  });

  it("hands a mailbox-sent AI draft to the durable provider-id queue exactly once", async () => {
    const pendingRows = [
      {
        id: "draft-history-1",
        company_id: "company-1",
        user_id: "user-1",
        mailbox_draft_id: "provider-draft-1",
        created_at: "2026-07-10T09:00:00.000Z",
        profile_type: "client_new_inquiry",
      },
    ];
    const outboundRows = [
      {
        id: "activity-1",
        body_text:
          "Final operator body\n\nThanks,\n\nOld Jackson\nOld OPS LTD.\n\n" +
          "On Tue, Jul 14, 2026, Lead wrote:\n> Prior message",
        created_at: "2026-07-10T10:00:00.000Z",
        subject: "Final subject",
        from_email: "operator@example.com",
        to_emails: ["lead@example.com"],
        email_message_id: "provider-message-1",
        opportunity_id: "opportunity-1",
      },
    ];
    const updateCalls: Array<Record<string, unknown>> = [];

    function queryFor(table: string) {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        not: vi.fn(() => query),
        update: vi.fn((payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return query;
        }),
        order: vi.fn(async () => ({
          data: table === "activities" ? outboundRows : [],
          error: null,
        })),
        limit: vi.fn(async () => ({
          data:
            table === "opportunity_follow_up_drafts"
              ? [{ id: "follow-up-1" }]
              : [],
          error: null,
        })),
        then: (
          onfulfilled?: (value: unknown) => unknown,
          onrejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve({
            data: table === "ai_draft_history" ? pendingRows : [],
            error: null,
          }).then(onfulfilled, onrejected),
      };
      return query;
    }

    const supabase = {
      from: vi.fn((table: string) => queryFor(table)),
    };
    const connection = {
      id: "connection-1",
      companyId: "company-1",
      userId: "user-1",
      email: "operator@example.com",
    };

    await reconcilePendingMailboxDrafts({
      connection: connection as never,
      providerThreadId: "provider-thread-1",
      supabase: supabase as never,
    });

    expect(getDraftMock).toHaveBeenCalledOnce();
    expect(getDraftMock).toHaveBeenCalledWith("provider-draft-1");
    expect(enqueueIfEnabledMock).toHaveBeenCalledTimes(1);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
      providerMessageId: "provider-message-1",
      providerThreadId: "provider-thread-1",
      userId: "user-1",
      fromEmail: "operator@example.com",
      toEmails: ["lead@example.com"],
      subject: "Final subject",
      bodyText:
        "Final operator body\n\nThanks,\n\nOld Jackson\nOld OPS LTD.\n\n" +
        "On Tue, Jul 14, 2026, Lead wrote:\n> Prior message",
      authoredBody: "Final operator body\n\nThanks,",
      cleanBody: "Final operator body\n\nThanks,",
      occurredAt: "2026-07-10T10:00:00.000Z",
      labelIds: ["SENT"],
      draftHistoryId: "draft-history-1",
      draftDeliveryChannel: "mailbox",
      followUpDraftId: "follow-up-1",
      opportunityId: "opportunity-1",
      profileType: "client_new_inquiry",
      learningAuthority: "operator_approved",
    });
    expect(listKnownSignaturesMock).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
    });
    expect(updateCalls).toEqual([]);
  });

  it("checks an older draft by exact id instead of treating a bounded list omission as deletion", async () => {
    const pendingRows = [
      {
        id: "draft-history-old",
        company_id: "company-1",
        user_id: "user-1",
        mailbox_draft_id: "provider-draft-older-than-ui-page",
        created_at: "2026-06-01T09:00:00.000Z",
        profile_type: "general",
      },
    ];
    const updateCalls: Array<Record<string, unknown>> = [];
    getDraftMock.mockResolvedValue({
      id: "provider-draft-older-than-ui-page",
      threadId: "provider-thread-1",
      to: ["lead@example.com"],
      cc: [],
      subject: "Re: Quote",
      bodyText: "Still editing",
      updatedAt: new Date("2026-07-14T18:00:00.000Z"),
    });

    function queryFor(table: string) {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        not: vi.fn(() => query),
        update: vi.fn((payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return query;
        }),
        order: vi.fn(async () => ({ data: [], error: null })),
        then: (
          onfulfilled?: (value: unknown) => unknown,
          onrejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve({
            data: table === "ai_draft_history" ? pendingRows : [],
            error: null,
          }).then(onfulfilled, onrejected),
      };
      return query;
    }

    const supabase = { from: vi.fn((table: string) => queryFor(table)) };
    await reconcilePendingMailboxDrafts({
      connection: {
        id: "connection-1",
        companyId: "company-1",
        email: "operator@example.com",
      } as never,
      providerThreadId: "provider-thread-1",
      supabase: supabase as never,
    });

    expect(getDraftMock).toHaveBeenCalledWith(
      "provider-draft-older-than-ui-page"
    );
    expect(updateCalls).toEqual([]);
    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
  });

  it("binds one immutable sent message to only the newest competing history row", async () => {
    const pendingRows = [
      {
        id: "draft-history-old",
        company_id: "company-1",
        user_id: "user-1",
        mailbox_draft_id: "provider-draft-shared",
        created_at: "2026-07-10T09:00:00.000Z",
        profile_type: "general",
      },
      {
        id: "draft-history-new",
        company_id: "company-1",
        user_id: "user-1",
        mailbox_draft_id: "provider-draft-shared",
        created_at: "2026-07-10T09:30:00.000Z",
        profile_type: "general",
      },
    ];
    const outboundRows = [
      {
        id: "activity-1",
        body_text: "Final body\n\nJackson\nOPS LTD.",
        created_at: "2026-07-10T10:00:00.000Z",
        subject: "Final subject",
        from_email: "operator@example.com",
        to_emails: ["lead@example.com"],
        email_message_id: "immutable-sent-message-1",
        opportunity_id: null,
      },
    ];
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "draft-history-new", status: "auto_drafted" },
      error: null,
    });

    function queryFor(table: string) {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        not: vi.fn(() => query),
        update: vi.fn(() => query),
        order: vi.fn(async () => ({
          data: table === "activities" ? outboundRows : [],
          error: null,
        })),
        limit: vi.fn(async () => ({ data: [], error: null })),
        then: (
          onfulfilled?: (value: unknown) => unknown,
          onrejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve({
            data: table === "ai_draft_history" ? pendingRows : [],
            error: null,
          }).then(onfulfilled, onrejected),
      };
      return query;
    }

    const supabase = {
      from: vi.fn((table: string) => queryFor(table)),
      rpc,
    };
    await reconcilePendingMailboxDrafts({
      connection: {
        id: "connection-1",
        companyId: "company-1",
        email: "operator@example.com",
      } as never,
      providerThreadId: "provider-thread-1",
      supabase: supabase as never,
    });

    expect(rpc).toHaveBeenCalledWith("reassign_phase_c_mailbox_draft", {
      p_company_id: "company-1",
      p_connection_id: "connection-1",
      p_new_draft_history_id: "draft-history-new",
      p_mailbox_draft_id: "provider-draft-shared",
      p_thread_id: "provider-thread-1",
      p_expected_old_draft_history_id: "draft-history-old",
    });
    expect(enqueueIfEnabledMock).toHaveBeenCalledOnce();
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: "immutable-sent-message-1",
        draftHistoryId: "draft-history-new",
      })
    );
  });
});
