import { describe, expect, it, vi } from "vitest";

import {
  assertProviderLeadFollowUpThreadsFresh,
  assertFreshLeadFollowUpIsDue,
  buildLeadFollowUpDraftRefreshPatch,
  isStockFollowUpStage,
  LeadFollowUpError,
  normalizeLeadFollowUpDeliveryError,
  prepareInputFromExistingLeadFollowUpIntent,
  refetchReconciledLeadFollowUpIntent,
  resolveLeadFollowUpThreadBindings,
  resultFromSettledLeadFollowUpIntent,
  resolveLeadFollowUpDraftContent,
  renderLeadFollowUpTemplate,
  resolveProviderFollowUpContext,
  selectCanonicalLeadFollowUpThread,
} from "@/lib/api/services/lead-follow-up-send-service";
import type { EmailSendIntent } from "@/lib/api/services/email-send-intent-service";

function leadFollowUpIntent(
  overrides: Partial<EmailSendIntent> = {}
): EmailSendIntent {
  return {
    id: "intent-1",
    companyId: "company-1",
    idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
    requestFingerprint: "fingerprint",
    actorUserId: "user-1",
    initiatedBy: "operator",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    assignmentVersion: 1,
    assignmentEventId: null,
    sourceEmailThreadId: "thread-row-1",
    replyProviderThreadId: "provider-thread-1",
    inReplyTo: "provider-message-before-send",
    senderSwitched: false,
    toEmails: ["crystal@example.com"],
    ccEmails: [],
    subject: "Re: Deck quote",
    authoredBody: "Checking in.",
    renderedBody: "Checking in.\n\nJackson",
    contentType: "text",
    draftHistoryId: null,
    followUpDraftId: "follow-up-draft-1",
    followUpSourceEventId: "source-event-1",
    followUpRecipientEmail: "crystal@example.com",
    followUpOutcomeAppliedAt: null,
    followUpComebackAt: null,
    followUpNotificationId: null,
    learningAuthority: "operator_authored",
    actorNameSnapshot: "Jackson",
    actorEmailSnapshot: "jackson@ops.test",
    clientFromAddressSnapshot: "jackson@ops.test",
    signatureId: "signature-1",
    signatureContentHash: "signature-hash",
    renderedBodyHash: "rendered-hash",
    pendingAutoSendId: null,
    pendingAutoSendLeaseToken: null,
    profileTypeSnapshot: "sales_lead",
    status: "reconciled",
    providerMessageId: "provider-message-after-send",
    acceptedProviderThreadId: "provider-thread-1",
    providerAcceptedAt: "2026-07-23T18:01:00.000Z",
    reconciliationAttempts: 1,
    reconciliationLeaseToken: null,
    reconciliationLeaseExpiresAt: null,
    reconciledActivityId: "activity-1",
    reconciledAt: "2026-07-23T18:01:01.000Z",
    lastError: null,
    createdAt: "2026-07-23T18:00:00.000Z",
    updatedAt: "2026-07-23T18:01:01.000Z",
    ...overrides,
  };
}

describe("lead one-tap follow-up resolution", () => {
  it("selects the newest canonical linked thread", () => {
    expect(
      selectCanonicalLeadFollowUpThread([
        {
          id: "thread-old",
          connectionId: "connection-1",
          providerThreadId: "provider-old",
          subject: "Old quote",
          lastMessageAt: "2026-07-20T18:00:00.000Z",
        },
        {
          id: "thread-current",
          connectionId: "connection-1",
          providerThreadId: "provider-current",
          subject: "Current quote",
          lastMessageAt: "2026-07-22T18:00:00.000Z",
        },
      ])
    ).toMatchObject({
      id: "thread-current",
      providerThreadId: "provider-current",
    });
  });

  it("fails closed when two different conversations are equally current", () => {
    expect(() =>
      selectCanonicalLeadFollowUpThread([
        {
          id: "thread-a",
          connectionId: "connection-1",
          providerThreadId: "provider-a",
          subject: "Quote",
          lastMessageAt: "2026-07-22T18:00:00.000Z",
        },
        {
          id: "thread-b",
          connectionId: "connection-2",
          providerThreadId: "provider-b",
          subject: "Quote",
          lastMessageAt: "2026-07-22T18:00:00.000Z",
        },
      ])
    ).toThrowError(
      expect.objectContaining({
        code: "LEAD_FOLLOW_UP_THREAD_AMBIGUOUS",
      })
    );
  });

  it("fails closed when final validation finds linked threads on multiple mailboxes", () => {
    expect(() =>
      resolveLeadFollowUpThreadBindings({
        expectedConnectionId: "connection-1",
        links: [
          {
            providerThreadId: "provider-thread-1",
            connectionId: "connection-1",
          },
          {
            providerThreadId: "provider-thread-2",
            connectionId: "connection-2",
          },
        ],
        threads: [
          {
            id: "thread-row-1",
            connectionId: "connection-1",
            providerThreadId: "provider-thread-1",
            subject: "Quote one",
            lastMessageAt: "2026-07-22T18:00:00.000Z",
          },
          {
            id: "thread-row-2",
            connectionId: "connection-2",
            providerThreadId: "provider-thread-2",
            subject: "Quote two",
            lastMessageAt: "2026-07-23T18:00:00.000Z",
          },
        ],
      })
    ).toThrowError(
      expect.objectContaining({
        code: "LEAD_FOLLOW_UP_MAILBOX_AMBIGUOUS",
      })
    );
  });

  it("binds a real reply to the newest outbound provider message", () => {
    const context = resolveProviderFollowUpContext({
      connectionEmail: "jackson@ops.test",
      recipientEmail: "crystal@example.com",
      messages: [
        {
          id: "message-inbound",
          threadId: "provider-thread",
          from: "Crystal <crystal@example.com>",
          to: ["jackson@ops.test"],
          cc: [],
          subject: "Deck quote",
          bodyText: "Could you quote this?",
          date: new Date("2026-07-20T18:00:00.000Z"),
        },
        {
          id: "message-outbound",
          threadId: "provider-thread",
          from: "Jackson <jackson@ops.test>",
          to: ["Crystal <crystal@example.com>"],
          cc: [],
          subject: "Re: Deck quote",
          bodyText: "Here is the quote.",
          date: new Date("2026-07-22T18:00:00.000Z"),
        },
      ],
    });

    expect(context).toMatchObject({
      inReplyTo: "message-outbound",
      providerThreadId: "provider-thread",
      subject: "Re: Deck quote",
      recipientEmail: "crystal@example.com",
    });
  });

  it("refuses a stock follow-up when the newest provider message is inbound", () => {
    expect(() =>
      resolveProviderFollowUpContext({
        connectionEmail: "jackson@ops.test",
        recipientEmail: "crystal@example.com",
        messages: [
          {
            id: "message-outbound",
            threadId: "provider-thread",
            from: "jackson@ops.test",
            to: ["crystal@example.com"],
            cc: [],
            subject: "Deck quote",
            bodyText: "Here is the quote.",
            date: new Date("2026-07-20T18:00:00.000Z"),
          },
          {
            id: "message-inbound",
            threadId: "provider-thread",
            from: "crystal@example.com",
            to: ["jackson@ops.test"],
            cc: [],
            subject: "Re: Deck quote",
            bodyText: "I have a question.",
            date: new Date("2026-07-22T18:00:00.000Z"),
          },
        ],
      })
    ).toThrowError(
      expect.objectContaining({
        code: "LEAD_FOLLOW_UP_RESPONSE_REQUIRED",
      })
    );
  });

  it("refuses final delivery when another linked thread changed at the same or a later instant", () => {
    expect(() =>
      assertProviderLeadFollowUpThreadsFresh({
        connectionEmail: "jackson@ops.test",
        recipientEmail: "crystal@example.com",
        selectedProviderThreadId: "provider-thread-1",
        selectedInReplyTo: "message-outbound",
        selectedSubject: "Re: Deck quote",
        snapshots: [
          {
            providerThreadId: "provider-thread-1",
            messages: [
              {
                id: "message-outbound",
                threadId: "provider-thread-1",
                from: "jackson@ops.test",
                to: ["crystal@example.com"],
                cc: [],
                subject: "Re: Deck quote",
                bodyText: "Here is the quote.",
                date: new Date("2026-07-22T18:00:00.000Z"),
              },
            ],
          },
          {
            providerThreadId: "provider-thread-2",
            messages: [
              {
                id: "message-inbound",
                threadId: "provider-thread-2",
                from: "crystal@example.com",
                to: ["jackson@ops.test"],
                cc: [],
                subject: "Another quote thread",
                bodyText: "I have a question.",
                date: new Date("2026-07-22T18:00:00.000Z"),
              },
            ],
          },
        ],
      })
    ).toThrowError(
      expect.objectContaining({
        code: "LEAD_FOLLOW_UP_CONVERSATION_CHANGED",
      })
    );
  });

  it("accepts final delivery when every other linked thread is strictly older", () => {
    expect(() =>
      assertProviderLeadFollowUpThreadsFresh({
        connectionEmail: "jackson@ops.test",
        recipientEmail: "crystal@example.com",
        selectedProviderThreadId: "provider-thread-1",
        selectedInReplyTo: "message-outbound",
        selectedSubject: "Re: Deck quote",
        snapshots: [
          {
            providerThreadId: "provider-thread-1",
            messages: [
              {
                id: "message-outbound",
                threadId: "provider-thread-1",
                from: "jackson@ops.test",
                to: ["crystal@example.com"],
                cc: [],
                subject: "Re: Deck quote",
                bodyText: "Here is the quote.",
                date: new Date("2026-07-22T18:00:00.000Z"),
              },
            ],
          },
          {
            providerThreadId: "provider-thread-2",
            messages: [
              {
                id: "older-message",
                threadId: "provider-thread-2",
                from: "crystal@example.com",
                to: ["jackson@ops.test"],
                cc: [],
                subject: "Older thread",
                bodyText: "Earlier context.",
                date: new Date("2026-07-20T18:00:00.000Z"),
              },
            ],
          },
        ],
      })
    ).not.toThrow();
  });

  it("refuses to send the lead address into a thread it never participated in", () => {
    expect(() =>
      resolveProviderFollowUpContext({
        connectionEmail: "jackson@ops.test",
        recipientEmail: "crystal@example.com",
        messages: [
          {
            id: "message-outbound",
            threadId: "provider-thread",
            from: "jackson@ops.test",
            to: ["somebody-else@example.com"],
            cc: [],
            subject: "Different customer",
            bodyText: "Wrong thread.",
            date: new Date("2026-07-22T18:00:00.000Z"),
          },
        ],
      })
    ).toThrowError(
      expect.objectContaining({
        code: "LEAD_FOLLOW_UP_RECIPIENT_THREAD_MISMATCH",
      })
    );
  });

  it("renders the standardized template without leaving empty-token punctuation", () => {
    expect(
      renderLeadFollowUpTemplate(
        "Hi {{ first_name }}, just checking on {{opportunity_title}} for {{company_name}}.",
        {
          contactName: "Crystal May",
          opportunityTitle: "Front deck",
          companyName: null,
        }
      )
    ).toBe("Hi Crystal, just checking on Front deck.");
  });

  it("refreshes an untouched stale draft to the current stock reply and provider subject", () => {
    expect(
      resolveLeadFollowUpDraftContent(
        {
          subject: "Following up",
          originalBody:
            "Hey there Crystal, just following up on this as I didn't see anything back from you.",
          currentBody:
            "Hey there Crystal, just following up on this as I didn't see anything back from you.",
        },
        {
          subject: "Re: Front deck quote",
          body: "Hi Crystal, just checking in to see if you had any questions about the quote.",
        }
      )
    ).toEqual({
      subject: "Re: Front deck quote",
      body: "Hi Crystal, just checking in to see if you had any questions about the quote.",
      shouldRefreshDraft: true,
    });
  });

  it("preserves a deliberate draft edit while retaining the provider thread subject", () => {
    expect(
      resolveLeadFollowUpDraftContent(
        {
          subject: "Following up",
          originalBody: "Stock body.",
          currentBody: "Crystal, I also found the railing answer you wanted.",
        },
        {
          subject: "Re: Front deck quote",
          body: "New stock body.",
        }
      )
    ).toEqual({
      subject: "Re: Front deck quote",
      body: "Crystal, I also found the railing answer you wanted.",
      shouldRefreshDraft: true,
    });
  });

  it("leaves a deliberate body edit untouched once the provider subject is current", () => {
    expect(
      resolveLeadFollowUpDraftContent(
        {
          subject: "Re: Front deck quote",
          originalBody: "Stock body.",
          currentBody: "Crystal, I also found the railing answer you wanted.",
        },
        {
          subject: "Re: Front deck quote",
          body: "New stock body.",
        }
      )
    ).toEqual({
      subject: "Re: Front deck quote",
      body: "Crystal, I also found the railing answer you wanted.",
      shouldRefreshDraft: false,
    });
  });

  it("refreshes a reply subject without overwriting a deliberate body edit", () => {
    expect(
      buildLeadFollowUpDraftRefreshPatch(
        {
          subject: "Following up",
          originalBody: "Stock body.",
          currentBody: "Crystal, I also found the railing answer you wanted.",
        },
        {
          subject: "Re: Front deck quote",
          body: "New stock body.",
        },
        "2026-07-23T18:00:00.000Z"
      )
    ).toEqual({
      subject: "Re: Front deck quote",
      updated_at: "2026-07-23T18:00:00.000Z",
    });
  });

  it("allows a fresh send only when the canonical comeback is due", () => {
    expect(() =>
      assertFreshLeadFollowUpIsDue(
        { next_follow_up_at: "2026-07-23T18:00:00.000Z" },
        "America/Vancouver",
        new Date("2026-07-23T18:00:00.000Z")
      )
    ).not.toThrow();

    expect(() =>
      assertFreshLeadFollowUpIsDue(
        { next_follow_up_at: "2026-07-24T18:00:00.000Z" },
        "America/Vancouver",
        new Date("2026-07-23T18:00:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ code: "LEAD_FOLLOW_UP_NOT_DUE" }));
  });

  it("allows a Due Today card before its exact stored time in the company timezone", () => {
    expect(() =>
      assertFreshLeadFollowUpIsDue(
        // UTC has already rolled to Jul 24, but Vancouver is still Jul 23.
        { next_follow_up_at: "2026-07-24T06:30:00.000Z" },
        "America/Vancouver",
        new Date("2026-07-23T16:00:00.000Z")
      )
    ).not.toThrow();
  });

  it("limits quote-specific stock copy to quote-bearing stages", () => {
    expect(isStockFollowUpStage("quoted")).toBe(true);
    expect(isStockFollowUpStage("follow_up")).toBe(true);
    expect(isStockFollowUpStage("negotiation")).toBe(true);
    expect(isStockFollowUpStage("quoting")).toBe(false);
    expect(isStockFollowUpStage("new_lead")).toBe(false);
  });

  it("rehydrates an exact durable intent instead of rebuilding a changed provider reply", () => {
    expect(
      prepareInputFromExistingLeadFollowUpIntent(leadFollowUpIntent())
    ).toMatchObject({
      idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
      sourceEmailThreadId: "thread-row-1",
      replyProviderThreadId: "provider-thread-1",
      inReplyTo: "provider-message-before-send",
      followUpDraftId: "follow-up-draft-1",
      authoredBody: "Checking in.",
      renderedBody: "Checking in.\n\nJackson",
    });
  });

  it("replays an immutable settled receipt without rebuilding transport state", () => {
    const result = resultFromSettledLeadFollowUpIntent(
      leadFollowUpIntent({
        followUpOutcomeAppliedAt: "2026-07-23T18:01:01.000Z",
        followUpComebackAt: "2026-07-26T18:01:00.000Z",
        followUpNotificationId: "notification-1",
      })
    );

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        delivered: true,
        reconciliationPending: false,
        deliveryUnknown: false,
        intentId: "intent-1",
        messageId: "provider-message-after-send",
        threadId: "provider-thread-1",
        sentAt: "2026-07-23T18:01:00.000Z",
        comebackAt: "2026-07-26T18:01:00.000Z",
        outcomeAppliedAt: "2026-07-23T18:01:01.000Z",
        notificationId: "notification-1",
        opportunityId: "opportunity-1",
      },
    });
  });

  it("replays a completed send without claiming a comeback when newer lifecycle truth won", () => {
    const result = resultFromSettledLeadFollowUpIntent(
      leadFollowUpIntent({
        followUpOutcomeAppliedAt: "2026-07-23T18:01:01.000Z",
        followUpComebackAt: null,
        followUpNotificationId: "notification-1",
      })
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        delivered: true,
        reconciliationPending: false,
        comebackAt: null,
        outcomeAppliedAt: "2026-07-23T18:01:01.000Z",
        notificationId: "notification-1",
      },
    });
  });

  it("replays a definitive provider rejection with the same safe retry contract", () => {
    const result = resultFromSettledLeadFollowUpIntent(
      leadFollowUpIntent({
        status: "provider_rejected",
        providerMessageId: null,
        acceptedProviderThreadId: null,
        providerAcceptedAt: null,
        followUpOutcomeAppliedAt: null,
        followUpComebackAt: null,
        followUpNotificationId: null,
        lastError: "LEAD_FOLLOW_UP_CONVERSATION_CHANGED",
      })
    );

    expect(result).toEqual({
      status: 409,
      body: {
        error: "LEAD_FOLLOW_UP_CONVERSATION_CHANGED",
        delivered: false,
        definitiveNoDelivery: true,
        intentId: "intent-1",
      },
    });
  });

  it("refetches the durable reconciled intent before building a concurrent replay receipt", async () => {
    const durable = leadFollowUpIntent({
      followUpOutcomeAppliedAt: "2026-07-23T18:01:01.000Z",
      followUpComebackAt: "2026-07-26T18:01:00.000Z",
      followUpNotificationId: "notification-1",
    });
    const findByIdempotencyKey = vi.fn().mockResolvedValue(durable);

    await expect(
      refetchReconciledLeadFollowUpIntent({
        intentStore: { findByIdempotencyKey },
        companyId: "company-1",
        idempotencyKey: durable.idempotencyKey,
        intentId: durable.id,
      })
    ).resolves.toBe(durable);
    expect(findByIdempotencyKey).toHaveBeenCalledWith({
      companyId: "company-1",
      idempotencyKey: durable.idempotencyKey,
    });
  });

  it("turns a final database stale-state refusal into a definitive unavailable result", () => {
    expect(
      normalizeLeadFollowUpDeliveryError(
        new Error("EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE")
      )
    ).toMatchObject({
      code: "LEAD_FOLLOW_UP_UNAVAILABLE",
      status: 409,
      details: {
        delivered: false,
        definitiveNoDelivery: true,
      },
    });
  });

  it("marks a final actor-authorization claim refusal as definitive no-delivery", () => {
    expect(
      normalizeLeadFollowUpDeliveryError(new Error("EMAIL_SEND_ACTOR_INVALID"))
    ).toMatchObject({
      code: "LEAD_FOLLOW_UP_FORBIDDEN",
      status: 403,
      details: {
        delivered: false,
        definitiveNoDelivery: true,
      },
    });
  });

  it("exposes stable route errors", () => {
    const error = new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_REQUIRED", 409);
    expect(error.code).toBe("LEAD_FOLLOW_UP_THREAD_REQUIRED");
    expect(error.status).toBe(409);
  });
});
