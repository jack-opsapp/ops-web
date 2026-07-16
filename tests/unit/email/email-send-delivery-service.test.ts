import { describe, expect, it, vi } from "vitest";

import {
  EmailSendDeliveryService,
  type EmailSendReconciliationResult,
} from "@/lib/api/services/email-send-delivery-service";
import {
  ProviderApiError,
  type EmailProviderInterface,
} from "@/lib/api/services/email-provider";
import type {
  EmailSendIntent,
  PrepareEmailSendIntentInput,
} from "@/lib/api/services/email-send-intent-service";

const PREPARE_INPUT: PrepareEmailSendIntentInput = {
  idempotencyKey: "send-attempt-1",
  companyId: "company-1",
  actorUserId: "actor-1",
  initiatedBy: "operator",
  connectionId: "connection-1",
  opportunityId: "opportunity-1",
  sourceEmailThreadId: "email-thread-1",
  replyProviderThreadId: "provider-thread-1",
  inReplyTo: "provider-message-1",
  senderSwitched: false,
  toEmails: ["client@example.com"],
  ccEmails: [],
  subject: "Deck quote",
  authoredBody: "Here is the quote.",
  renderedBody: "Here is the quote.\n\n-- \nJason",
  contentType: "text",
  draftHistoryId: "draft-1",
  followUpDraftId: null,
  learningAuthority: "operator_approved",
  signatureId: "signature-1",
  signatureContentHash: "a".repeat(64),
  renderedBodyHash: "b".repeat(64),
  pendingAutoSendId: null,
  pendingAutoSendLeaseToken: null,
};

function intent(
  status: EmailSendIntent["status"],
  overrides: Partial<EmailSendIntent> = {}
): EmailSendIntent {
  return {
    id: "intent-1",
    companyId: PREPARE_INPUT.companyId,
    idempotencyKey: PREPARE_INPUT.idempotencyKey,
    requestFingerprint: "f".repeat(64),
    actorUserId: PREPARE_INPUT.actorUserId,
    initiatedBy: PREPARE_INPUT.initiatedBy,
    connectionId: PREPARE_INPUT.connectionId,
    opportunityId: PREPARE_INPUT.opportunityId,
    assignmentVersion: 4,
    assignmentEventId: "assignment-event-4",
    sourceEmailThreadId: PREPARE_INPUT.sourceEmailThreadId ?? null,
    replyProviderThreadId: PREPARE_INPUT.replyProviderThreadId ?? null,
    inReplyTo: PREPARE_INPUT.inReplyTo ?? null,
    senderSwitched: false,
    toEmails: PREPARE_INPUT.toEmails,
    ccEmails: PREPARE_INPUT.ccEmails ?? [],
    subject: PREPARE_INPUT.subject,
    authoredBody: PREPARE_INPUT.authoredBody,
    renderedBody: PREPARE_INPUT.renderedBody,
    contentType: PREPARE_INPUT.contentType,
    draftHistoryId: PREPARE_INPUT.draftHistoryId ?? null,
    followUpDraftId: null,
    learningAuthority: PREPARE_INPUT.learningAuthority,
    actorNameSnapshot: "Jason Zavarella",
    actorEmailSnapshot: "jason@ops-login.example",
    clientFromAddressSnapshot: "info@canprodeckandrail.com",
    signatureId: PREPARE_INPUT.signatureId ?? null,
    signatureContentHash: PREPARE_INPUT.signatureContentHash ?? null,
    renderedBodyHash: PREPARE_INPUT.renderedBodyHash,
    pendingAutoSendId: null,
    pendingAutoSendLeaseToken: null,
    profileTypeSnapshot: "sales_lead",
    status,
    providerMessageId: null,
    acceptedProviderThreadId: null,
    providerAcceptedAt: null,
    reconciliationAttempts: 0,
    reconciliationLeaseToken: null,
    reconciliationLeaseExpiresAt: null,
    reconciledActivityId: null,
    reconciledAt: null,
    lastError: null,
    createdAt: "2026-07-15T18:00:00.000Z",
    updatedAt: "2026-07-15T18:00:00.000Z",
    ...overrides,
  };
}

function dependencies() {
  const intentStore = {
    prepare: vi.fn().mockResolvedValue(intent("prepared")),
    claimProviderDelivery: vi.fn().mockResolvedValue(intent("sending")),
    persistProviderAcceptance: vi.fn().mockResolvedValue(
      intent("provider_accepted", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        providerAcceptedAt: "2026-07-15T18:01:00.000Z",
      })
    ),
    markProviderRejected: vi
      .fn()
      .mockResolvedValue(intent("provider_rejected")),
    markDeliveryUnknown: vi.fn().mockResolvedValue(intent("delivery_unknown")),
    claimReconciliation: vi.fn().mockResolvedValue(
      intent("reconciling", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        providerAcceptedAt: "2026-07-15T18:01:00.000Z",
        reconciliationAttempts: 1,
        reconciliationLeaseToken: "lease-1",
      })
    ),
    completeReconciliation: vi.fn().mockResolvedValue(
      intent("reconciled", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        reconciledActivityId: "activity-1",
      })
    ),
    failReconciliation: vi.fn().mockResolvedValue(
      intent("reconciliation_failed", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
      })
    ),
  };
  const provider = {
    sendEmail: vi.fn().mockResolvedValue({
      messageId: "sent-message-1",
      threadId: "sent-thread-1",
    }),
  };
  const reconcile = vi
    .fn<() => Promise<EmailSendReconciliationResult>>()
    .mockResolvedValue({ activityId: "activity-1" });
  const service = new EmailSendDeliveryService({
    intentStore,
    provider: provider as unknown as EmailProviderInterface,
    reconcile,
    now: () => new Date("2026-07-15T18:01:00.000Z"),
  });
  return { service, intentStore, provider, reconcile };
}

describe("EmailSendDeliveryService", () => {
  it("persists, claims, sends once, persists acceptance, and reconciles", async () => {
    const { service, intentStore, provider, reconcile } = dependencies();

    const result = await service.execute(PREPARE_INPUT);

    expect(result).toMatchObject({
      state: "reconciled",
      delivered: true,
      providerMessageId: "sent-message-1",
      providerThreadId: "sent-thread-1",
      activityId: "activity-1",
    });
    expect(provider.sendEmail).toHaveBeenCalledOnce();
    expect(provider.sendEmail).toHaveBeenCalledWith({
      to: ["client@example.com"],
      cc: [],
      subject: "Deck quote",
      body: PREPARE_INPUT.renderedBody,
      contentType: "text",
      inReplyTo: "provider-message-1",
      threadId: "provider-thread-1",
    });
    expect(intentStore.persistProviderAcceptance).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(intentStore.completeReconciliation).toHaveBeenCalledWith({
      intentId: "intent-1",
      leaseToken: "lease-1",
      activityId: "activity-1",
    });
  });

  it.each(["sending", "delivery_unknown", "reconciling"] as const)(
    "never resends an existing %s intent",
    async (status) => {
      const { service, intentStore, provider } = dependencies();
      intentStore.prepare.mockResolvedValueOnce(intent(status));

      const result = await service.execute(PREPARE_INPUT);

      expect(result.state).toBe("pending");
      expect(provider.sendEmail).not.toHaveBeenCalled();
      expect(intentStore.claimProviderDelivery).not.toHaveBeenCalled();
    }
  );

  it("returns a completed retry without calling the provider", async () => {
    const { service, intentStore, provider } = dependencies();
    intentStore.prepare.mockResolvedValueOnce(
      intent("reconciled", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        reconciledActivityId: "activity-1",
      })
    );

    const result = await service.execute(PREPARE_INPUT);

    expect(result.state).toBe("reconciled");
    expect(provider.sendEmail).not.toHaveBeenCalled();
  });

  it("marks an explicit provider rejection and preserves reconciliation state", async () => {
    const { service, intentStore, provider, reconcile } = dependencies();
    provider.sendEmail.mockRejectedValueOnce(
      new ProviderApiError("Gmail rejected send", 400, {})
    );

    const result = await service.execute(PREPARE_INPUT);

    expect(result).toMatchObject({ state: "rejected", delivered: false });
    expect(intentStore.markProviderRejected).toHaveBeenCalledOnce();
    expect(intentStore.persistProviderAcceptance).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("marks a network/unknown failure non-resendable", async () => {
    const { service, intentStore, provider } = dependencies();
    provider.sendEmail.mockRejectedValueOnce(new Error("socket closed"));

    const result = await service.execute(PREPARE_INPUT);

    expect(result).toMatchObject({
      state: "delivery_unknown",
      delivered: false,
    });
    expect(intentStore.markDeliveryUnknown).toHaveBeenCalledWith(
      "intent-1",
      "socket closed"
    );
    expect(intentStore.markProviderRejected).not.toHaveBeenCalled();
  });

  it("retries post-provider reconciliation exactly once without resending", async () => {
    const { service, intentStore, provider, reconcile } = dependencies();
    reconcile
      .mockRejectedValueOnce(new Error("activity insert failed"))
      .mockResolvedValueOnce({ activityId: "activity-1" });
    intentStore.claimReconciliation
      .mockResolvedValueOnce(
        intent("reconciling", {
          providerMessageId: "sent-message-1",
          acceptedProviderThreadId: "sent-thread-1",
          reconciliationLeaseToken: "lease-1",
        })
      )
      .mockResolvedValueOnce(
        intent("reconciling", {
          providerMessageId: "sent-message-1",
          acceptedProviderThreadId: "sent-thread-1",
          reconciliationLeaseToken: "lease-2",
          reconciliationAttempts: 2,
        })
      );

    const result = await service.execute(PREPARE_INPUT);

    expect(result.state).toBe("reconciled");
    expect(provider.sendEmail).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(intentStore.failReconciliation).toHaveBeenCalledWith({
      intentId: "intent-1",
      leaseToken: "lease-1",
      error: "activity insert failed",
    });
    expect(intentStore.completeReconciliation).toHaveBeenCalledWith({
      intentId: "intent-1",
      leaseToken: "lease-2",
      activityId: "activity-1",
    });
  });

  it("starts a fresh provider thread when the sender was explicitly switched", async () => {
    const { service, intentStore, provider } = dependencies();
    const switched = {
      ...PREPARE_INPUT,
      connectionId: "connection-2",
      senderSwitched: true,
      replyProviderThreadId: null,
      inReplyTo: null,
    };
    intentStore.prepare.mockResolvedValueOnce(
      intent("prepared", {
        connectionId: "connection-2",
        senderSwitched: true,
        replyProviderThreadId: null,
        inReplyTo: null,
      })
    );
    intentStore.claimProviderDelivery.mockResolvedValueOnce(
      intent("sending", {
        connectionId: "connection-2",
        senderSwitched: true,
        replyProviderThreadId: null,
        inReplyTo: null,
      })
    );

    await service.execute(switched);

    expect(provider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: undefined, threadId: undefined })
    );
  });
});
