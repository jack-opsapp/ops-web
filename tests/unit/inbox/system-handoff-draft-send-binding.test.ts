import { describe, expect, it } from "vitest";

import { resolveInboxDraftSendBinding } from "@/lib/inbox/draft-send-binding";
import type { InboxDraftRow } from "@/lib/types/email-thread";

function systemHandoffDraft(
  overrides: Partial<InboxDraftRow> = {}
): InboxDraftRow {
  return {
    source: "lifecycle",
    id: "draft-1",
    threadId: null,
    inboxThreadId: "forward-wrapper-thread",
    opportunityId: "opportunity-1",
    connectionId: "victoria-connection",
    fromEmail: "victoria@canprodeckandrail.com",
    to: ["customer@example.com"],
    cc: [],
    subject: "Victoria deck inquiry",
    bodyText: "Thanks for reaching out.",
    updatedAt: "2026-07-22T18:00:00.000Z",
    origin: "system_handoff",
    recipientEmail: "customer@example.com",
    sourceEventId: "source-event-1",
    sourceProviderMessageId: "forward-wrapper-message-1",
    ...overrides,
  };
}

describe("system-handoff inbox draft send binding", () => {
  it("starts a new provider thread to the exact source-event customer for message-scoped drafts", () => {
    const result = resolveInboxDraftSendBinding({
      selectedInboxThreadId: "forward-wrapper-thread",
      selectedOpportunityId: "wrong-opportunity",
      selectedConnectionId: "wrong-connection",
      selectedSubject: "Fwd: New Wix lead",
      lastInbound: {
        from: "victoria@canprodeckandrail.com",
        providerMessageId: "forward-wrapper-message-1",
      },
      draft: systemHandoffDraft(),
    });

    expect(result).toEqual({
      ok: true,
      connectionId: "victoria-connection",
      opportunityId: "opportunity-1",
      sourceEmailThreadId: null,
      recipient: "customer@example.com",
      inReplyTo: null,
      subject: "Victoria deck inquiry",
    });
  });

  it("pins a thread-scoped system handoff to its own source thread and source message", () => {
    const result = resolveInboxDraftSendBinding({
      selectedInboxThreadId: "other-fragment",
      selectedOpportunityId: "opportunity-1",
      selectedConnectionId: "wrong-connection",
      selectedSubject: "Other fragment",
      lastInbound: {
        from: "forwarder@example.com",
        providerMessageId: "other-message",
      },
      draft: systemHandoffDraft({
        threadId: "provider-customer-thread",
        inboxThreadId: "canonical-customer-thread",
        sourceProviderMessageId: "customer-message-1",
      }),
    });

    expect(result).toEqual({
      ok: true,
      connectionId: "victoria-connection",
      opportunityId: "opportunity-1",
      sourceEmailThreadId: "canonical-customer-thread",
      recipient: "customer@example.com",
      inReplyTo: "customer-message-1",
      subject: "Victoria deck inquiry",
    });
  });

  it("fails closed when exact system-handoff provenance is incomplete", () => {
    const result = resolveInboxDraftSendBinding({
      selectedInboxThreadId: "forward-wrapper-thread",
      selectedOpportunityId: "opportunity-1",
      selectedConnectionId: "victoria-connection",
      selectedSubject: "Fwd: New Wix lead",
      lastInbound: {
        from: "victoria@canprodeckandrail.com",
        providerMessageId: "forward-wrapper-message-1",
      },
      draft: systemHandoffDraft({ recipientEmail: null }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "system_handoff_provenance_invalid",
    });
  });

  it("preserves ordinary selected-thread reply behaviour for non-handoff drafts", () => {
    const result = resolveInboxDraftSendBinding({
      selectedInboxThreadId: "thread-1",
      selectedOpportunityId: "opportunity-1",
      selectedConnectionId: "connection-1",
      selectedSubject: "Quote",
      lastInbound: {
        from: "customer@example.com",
        providerMessageId: "message-1",
      },
      draft: null,
    });

    expect(result).toEqual({
      ok: true,
      connectionId: "connection-1",
      opportunityId: "opportunity-1",
      sourceEmailThreadId: "thread-1",
      recipient: "customer@example.com",
      inReplyTo: "message-1",
      subject: "Re: Quote",
    });
  });
});
