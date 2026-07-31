import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class EmailOutboundLearningService {},
}));
vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {},
}));
vi.mock("@/lib/api/services/opportunity-lifecycle-service", () => ({
  OpportunityLifecycleService: {},
}));
vi.mock("@/lib/api/services/email-provider-label-writeback", () => ({
  applyEmailProviderLabelWriteback: vi.fn(),
}));

import { reconcileEmailSend } from "@/lib/api/services/email-send-reconciliation-service";
import type { EmailSendIntent } from "@/lib/api/services/email-send-intent-service";

function acceptedIntent(): EmailSendIntent {
  return {
    id: "intent-1",
    companyId: "company-1",
    idempotencyKey: "send-1",
    requestFingerprint: "f".repeat(64),
    actorUserId: "actor-1",
    initiatedBy: "operator",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    assignmentVersion: 1,
    assignmentEventId: null,
    sourceEmailThreadId: null,
    replyProviderThreadId: null,
    inReplyTo: null,
    senderSwitched: false,
    toEmails: ["lead@example.com"],
    ccEmails: [],
    subject: "Estimate",
    authoredBody: "Attached is the estimate.",
    renderedBody: "Attached is the estimate.",
    contentType: "text",
    draftHistoryId: null,
    followUpDraftId: null,
    followUpSourceEventId: null,
    followUpRecipientEmail: null,
    followUpOutcomeAppliedAt: null,
    followUpComebackAt: null,
    followUpNotificationId: null,
    learningAuthority: "operator_authored",
    actorNameSnapshot: "Alex Rivera",
    actorEmailSnapshot: "alex@company.test",
    clientFromAddressSnapshot: "alex@company.test",
    signatureId: null,
    signatureContentHash: null,
    renderedBodyHash: "b".repeat(64),
    pendingAutoSendId: null,
    pendingAutoSendLeaseToken: null,
    profileTypeSnapshot: "sales_lead",
    status: "provider_accepted",
    providerMessageId: "provider-message-1",
    acceptedProviderThreadId: "provider-thread-1",
    providerAcceptedAt: "2026-07-15T18:01:00.000Z",
    reconciliationAttempts: 1,
    reconciliationLeaseToken: "lease-1",
    reconciliationLeaseExpiresAt: "2026-07-15T18:10:00.000Z",
    reconciledActivityId: null,
    reconciledAt: null,
    lastError: null,
    createdAt: "2026-07-15T18:00:00.000Z",
    updatedAt: "2026-07-15T18:01:00.000Z",
  };
}

describe("reconcileEmailSend database boundaries", () => {
  it("preserves the raw Supabase cause when the canonical thread claim fails", async () => {
    const cause = {
      status: 525,
      code: "525",
      message: "SSL handshake failed",
    };
    const upsert = vi.fn().mockResolvedValue({
      data: null,
      error: cause,
    });
    const from = vi.fn(() => ({ upsert }));

    await expect(
      reconcileEmailSend({
        supabase: { from } as never,
        intent: acceptedIntent(),
        connection: {
          id: "connection-1",
          companyId: "company-1",
        } as never,
        provider: { applyLabel: vi.fn() },
      })
    ).rejects.toMatchObject({
      name: "CronDatabaseOperationError",
      cause,
    });
  });
});
