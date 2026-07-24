import { describe, expect, it, vi } from "vitest";

import {
  EmailSendDeliveryService,
  type EmailSendReconciliationResult,
} from "@/lib/api/services/email-send-delivery-service";
import {
  ProviderApiError,
  type EmailProviderInterface,
} from "@/lib/api/services/email-provider";
import type { EmailConnectionSyncLockRunResult } from "@/lib/api/services/email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "@/lib/api/services/email-provider-mailbox-operation";
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
    followUpSourceEventId: null,
    followUpRecipientEmail: null,
    followUpOutcomeAppliedAt: null,
    followUpComebackAt: null,
    followUpNotificationId: null,
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

function dependencies(
  validateProviderDelivery?: (
    intent: EmailSendIntent,
    checkpoint: EmailProviderMailboxCheckpoint
  ) => Promise<void>
) {
  const mailboxLeaseState = { acquired: true };
  const mailboxCheckpoint = vi.fn(async () => undefined);
  const runWithMailboxLeaseMock = vi.fn();
  const runWithMailboxLease = async <T>(input: {
    connectionId: string;
    run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>> => {
    runWithMailboxLeaseMock(input.connectionId);
    return mailboxLeaseState.acquired
      ? { acquired: true, value: await input.run(mailboxCheckpoint) }
      : { acquired: false };
  };
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
    validateProviderDelivery,
    runWithMailboxLease,
    now: () => new Date("2026-07-15T18:01:00.000Z"),
  });
  return {
    service,
    intentStore,
    provider,
    reconcile,
    mailboxLeaseState,
    mailboxCheckpoint,
    runWithMailboxLease: runWithMailboxLeaseMock,
  };
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

  it("revalidates a claimed send before the provider call and terminates stale delivery", async () => {
    const validateProviderDelivery = vi
      .fn()
      .mockRejectedValue(new Error("LEAD_FOLLOW_UP_RESPONSE_REQUIRED"));
    const { service, intentStore, provider } = dependencies(
      validateProviderDelivery
    );

    const result = await service.execute(PREPARE_INPUT);

    expect(validateProviderDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "intent-1",
        status: "sending",
      }),
      expect.any(Function)
    );
    expect(result).toMatchObject({
      state: "rejected",
      delivered: false,
    });
    expect(provider.sendEmail).not.toHaveBeenCalled();
    expect(intentStore.markProviderRejected).toHaveBeenCalledWith({
      intentId: "intent-1",
      error: "LEAD_FOLLOW_UP_RESPONSE_REQUIRED",
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

  it.each(["provider_accepted", "reconciliation_failed"] as const)(
    "reconciles an existing %s intent without another provider delivery",
    async (status) => {
      const { service, intentStore, provider, reconcile } = dependencies();
      intentStore.prepare.mockResolvedValueOnce(
        intent(status, {
          providerMessageId: "sent-message-1",
          acceptedProviderThreadId: "sent-thread-1",
          providerAcceptedAt: "2026-07-15T18:01:00.000Z",
        })
      );

      const result = await service.execute(PREPARE_INPUT);

      expect(result.state).toBe("reconciled");
      expect(provider.sendEmail).not.toHaveBeenCalled();
      expect(intentStore.claimProviderDelivery).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalled();
    }
  );

  it("does not retry the same definitively rejected intent", async () => {
    const { service, intentStore, provider } = dependencies();
    intentStore.prepare.mockResolvedValueOnce(intent("provider_rejected"));

    const result = await service.execute(PREPARE_INPUT);

    expect(result).toMatchObject({ state: "rejected", delivered: false });
    expect(provider.sendEmail).not.toHaveBeenCalled();
    expect(intentStore.claimProviderDelivery).not.toHaveBeenCalled();
  });

  it("fails busy before claiming or calling the provider", async () => {
    const { service, intentStore, provider, mailboxLeaseState } =
      dependencies();
    mailboxLeaseState.acquired = false;

    const result = await service.execute(PREPARE_INPUT);

    expect(result).toMatchObject({
      state: "pending",
      delivered: false,
      error: "EMAIL_SEND_MAILBOX_BUSY",
    });
    expect(intentStore.prepare).toHaveBeenCalledTimes(1);
    expect(intentStore.claimProviderDelivery).not.toHaveBeenCalled();
    expect(provider.sendEmail).not.toHaveBeenCalled();
  });

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

  it.each([408, 409, 423, 425, 429, 500, 502, 503, 504])(
    "quarantines ambiguous provider status %s instead of treating it as a definitive rejection",
    async (providerStatus) => {
      const { service, intentStore, provider } = dependencies();
      provider.sendEmail.mockRejectedValueOnce(
        new ProviderApiError("Microsoft Graph outcome unknown", providerStatus)
      );

      const result = await service.execute(PREPARE_INPUT);

      expect(result).toMatchObject({
        state: "delivery_unknown",
        delivered: false,
      });
      expect(intentStore.markDeliveryUnknown).toHaveBeenCalledWith(
        "intent-1",
        "Microsoft Graph outcome unknown"
      );
      expect(intentStore.markProviderRejected).not.toHaveBeenCalled();
    }
  );

  it("never resends when mailbox ownership is lost after provider acceptance", async () => {
    const { service, intentStore, provider, mailboxCheckpoint } =
      dependencies();
    mailboxCheckpoint
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("mailbox lease ownership lost"));

    const first = await service.execute(PREPARE_INPUT);

    expect(first).toMatchObject({
      state: "pending",
      delivered: true,
      providerMessageId: "sent-message-1",
      providerThreadId: "sent-thread-1",
      error: "mailbox lease ownership lost",
    });
    expect(provider.sendEmail).toHaveBeenCalledTimes(1);
    expect(intentStore.persistProviderAcceptance).toHaveBeenCalledWith({
      intentId: "intent-1",
      providerMessageId: "sent-message-1",
      providerThreadId: "sent-thread-1",
      acceptedAt: new Date("2026-07-15T18:01:00.000Z"),
    });
    expect(intentStore.markDeliveryUnknown).not.toHaveBeenCalled();

    intentStore.prepare.mockResolvedValueOnce(
      intent("provider_accepted", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        providerAcceptedAt: "2026-07-15T18:01:00.000Z",
      })
    );
    const retry = await service.execute(PREPARE_INPUT);

    expect(retry.state).toBe("reconciled");
    expect(provider.sendEmail).toHaveBeenCalledTimes(1);
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
