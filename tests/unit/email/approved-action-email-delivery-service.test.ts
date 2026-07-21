import { describe, expect, it, vi } from "vitest";

import {
  ApprovedActionEmailDeliveryService,
  type ApprovedActionEmailIntent,
  type PrepareApprovedActionEmailIntentInput,
} from "@/lib/api/services/approved-action-email-delivery-service";
import { mapApprovedActionEmailIntent } from "@/lib/api/services/approved-action-email-intent-service";
import type { EmailConnectionSyncLockRunResult } from "@/lib/api/services/email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "@/lib/api/services/email-provider-mailbox-operation";
import { ProviderApiError } from "@/lib/api/services/email-provider";

const PREPARE_INPUT: PrepareApprovedActionEmailIntentInput = {
  actionId: "action-1",
  executionMode: "manual",
  signatureId: "signature-1",
  signatureContentHash: "a".repeat(64),
  authoredBodyHash: "c".repeat(64),
  renderedBody: "Approved body\n\n--\nJason",
  renderedBodyHash: "b".repeat(64),
};

function intent(
  status: ApprovedActionEmailIntent["status"],
  overrides: Partial<ApprovedActionEmailIntent> = {}
): ApprovedActionEmailIntent {
  return {
    id: "intent-1",
    actionId: "action-1",
    actionType: "process_reschedule_request",
    actionDataSnapshot: {},
    companyId: "company-1",
    actorUserId: "reviewer-1",
    executionMode: "manual",
    idempotencyKey: "approved-action:action-1",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    assignmentVersion: 7,
    assignmentEventId: "assignment-event-7",
    clientId: "client-1",
    projectId: null,
    invoiceId: null,
    sourceEmailThreadId: "email-thread-1",
    replyProviderThreadId: "provider-thread-1",
    inReplyTo: "provider-message-1",
    toEmails: ["client@example.com"],
    ccEmails: [],
    subject: "Re: project inquiry",
    authoredBody: "Approved body",
    renderedBody: "Approved body\n\n--\nJason",
    contentType: "text",
    draftHistoryId: "reviewer-draft-1",
    sourceDraftHistoryId: "source-draft-1",
    profileTypeSnapshot: "client_active_project",
    learningAuthority: "operator_approved",
    actorNameSnapshot: "Jason Zavarella",
    actorEmailSnapshot: "jason-login@example.com",
    clientFromAddressSnapshot: "office@example.com",
    signatureId: "signature-1",
    signatureContentHash: "a".repeat(64),
    renderedBodyHash: "b".repeat(64),
    status,
    providerMessageId: null,
    acceptedProviderThreadId: null,
    providerAcceptedAt: null,
    reconciliationLeaseToken: null,
    reconciledActivityId: null,
    lastError: null,
    ...overrides,
  };
}

function dependencies() {
  const mailboxLeaseState = { acquired: true };
  const mailboxCheckpoint = vi.fn(async () => undefined);
  const runWithMailboxLease = async <T>(input: {
    connectionId: string;
    run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>> =>
    mailboxLeaseState.acquired
      ? { acquired: true, value: await input.run(mailboxCheckpoint) }
      : { acquired: false };
  const accepted = intent("provider_accepted", {
    providerMessageId: "sent-message-1",
    acceptedProviderThreadId: "sent-thread-1",
    providerAcceptedAt: "2026-07-15T20:00:00.000Z",
  });
  const store = {
    prepare: vi.fn().mockResolvedValue(intent("prepared")),
    claimProviderDelivery: vi.fn().mockResolvedValue(intent("sending")),
    persistProviderAcceptance: vi.fn().mockResolvedValue(accepted),
    markProviderRejected: vi
      .fn()
      .mockResolvedValue(intent("provider_rejected")),
    markDeliveryUnknown: vi.fn().mockResolvedValue(intent("delivery_unknown")),
    claimReconciliation: vi.fn().mockResolvedValue(
      intent("reconciling", {
        ...accepted,
        reconciliationLeaseToken: "lease-1",
      })
    ),
    completeReconciliation: vi.fn().mockResolvedValue(
      intent("reconciled", {
        ...accepted,
        reconciledActivityId: "activity-1",
      })
    ),
    failReconciliation: vi
      .fn()
      .mockResolvedValue(intent("reconciliation_failed", accepted)),
  };
  const provider = {
    sendEmail: vi.fn().mockResolvedValue({
      messageId: "sent-message-1",
      threadId: "sent-thread-1",
    }),
  };
  const reconcile = vi.fn().mockResolvedValue({ activityId: "activity-1" });
  return {
    store,
    provider,
    reconcile,
    runWithMailboxLease,
    mailboxLeaseState,
    mailboxCheckpoint,
  };
}

describe("approved-action email delivery", () => {
  it("maps the durable assignment version and event snapshot", () => {
    const mapped = mapApprovedActionEmailIntent({
      assignment_version: "7",
      assignment_event_id: "assignment-event-7",
    });

    expect(mapped.assignmentVersion).toBe(7);
    expect(mapped.assignmentEventId).toBe("assignment-event-7");
  });

  it("persists the durable intent before the only provider call", async () => {
    const deps = dependencies();
    const callOrder: string[] = [];
    deps.store.prepare.mockImplementation(async () => {
      callOrder.push("prepare");
      return intent("prepared");
    });
    deps.provider.sendEmail.mockImplementation(async () => {
      callOrder.push("provider");
      return { messageId: "sent-message-1", threadId: "sent-thread-1" };
    });

    const result = await new ApprovedActionEmailDeliveryService(deps).execute(
      PREPARE_INPUT
    );

    expect(callOrder).toEqual(["prepare", "provider"]);
    expect(result.state).toBe("reconciled");
  });

  it("does not touch the provider when an away-then-back assignment invalidates the claim", async () => {
    const deps = dependencies();
    deps.store.prepare.mockResolvedValue(
      intent("prepared", {
        assignmentVersion: 7,
        assignmentEventId: "assignment-event-before-transfer",
      })
    );
    deps.store.claimProviderDelivery.mockRejectedValue(
      new Error("APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED")
    );

    await expect(
      new ApprovedActionEmailDeliveryService(deps).execute(PREPARE_INPUT)
    ).rejects.toThrow("APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED");

    expect(deps.provider.sendEmail).not.toHaveBeenCalled();
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it("fails busy before claiming delivery or touching the provider", async () => {
    const deps = dependencies();
    deps.mailboxLeaseState.acquired = false;

    const result = await new ApprovedActionEmailDeliveryService(deps).execute(
      PREPARE_INPUT
    );

    expect(result).toMatchObject({
      state: "pending",
      delivered: false,
      error: "APPROVED_ACTION_EMAIL_MAILBOX_BUSY",
    });
    expect(deps.store.prepare).toHaveBeenCalledTimes(1);
    expect(deps.store.claimProviderDelivery).not.toHaveBeenCalled();
    expect(deps.provider.sendEmail).not.toHaveBeenCalled();
  });

  it("retries provider-acceptance persistence exactly once and never resends", async () => {
    const deps = dependencies();
    deps.store.persistProviderAcceptance.mockRejectedValue(
      new Error("database unavailable")
    );

    const service = new ApprovedActionEmailDeliveryService(deps);
    const first = await service.execute(PREPARE_INPUT);

    expect(first.state).toBe("delivery_unknown");
    expect(first.delivered).toBe(true);
    expect(deps.store.persistProviderAcceptance).toHaveBeenCalledTimes(2);
    expect(deps.provider.sendEmail).toHaveBeenCalledTimes(1);

    deps.store.prepare.mockResolvedValue(intent("delivery_unknown"));
    await service.execute(PREPARE_INPUT);
    expect(deps.provider.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("never resends when mailbox ownership is lost after provider acceptance", async () => {
    const deps = dependencies();
    deps.mailboxCheckpoint
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("mailbox lease ownership lost"));

    const service = new ApprovedActionEmailDeliveryService(deps);
    const first = await service.execute(PREPARE_INPUT);

    expect(first).toMatchObject({
      state: "pending",
      delivered: true,
      providerMessageId: "sent-message-1",
      providerThreadId: "sent-thread-1",
      error: "mailbox lease ownership lost",
    });
    expect(deps.provider.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.store.persistProviderAcceptance).toHaveBeenCalledWith({
      intentId: "intent-1",
      providerMessageId: "sent-message-1",
      providerThreadId: "sent-thread-1",
      acceptedAt: expect.any(Date),
    });
    expect(deps.store.markDeliveryUnknown).not.toHaveBeenCalled();

    deps.store.prepare.mockResolvedValueOnce(
      intent("provider_accepted", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        providerAcceptedAt: "2026-07-15T20:00:00.000Z",
      })
    );
    const retry = await service.execute(PREPARE_INPUT);

    expect(retry.state).toBe("reconciled");
    expect(deps.provider.sendEmail).toHaveBeenCalledTimes(1);
  });

  it.each([408, 409, 423, 425, 429, 500, 502, 503, 504])(
    "quarantines ambiguous provider status %s instead of treating it as a definitive rejection",
    async (providerStatus) => {
      const deps = dependencies();
      deps.provider.sendEmail.mockRejectedValue(
        new ProviderApiError("Microsoft Graph outcome unknown", providerStatus)
      );

      const result = await new ApprovedActionEmailDeliveryService(deps).execute(
        PREPARE_INPUT
      );

      expect(result.state).toBe("delivery_unknown");
      expect(deps.store.markDeliveryUnknown).toHaveBeenCalledWith({
        intentId: "intent-1",
        error: "Microsoft Graph outcome unknown",
      });
      expect(deps.store.markProviderRejected).not.toHaveBeenCalled();
    }
  );

  it("writes no reconciliation activity after an explicit provider rejection", async () => {
    const deps = dependencies();
    deps.provider.sendEmail.mockRejectedValue(
      new ProviderApiError("provider rejected", 400)
    );

    const result = await new ApprovedActionEmailDeliveryService(deps).execute(
      PREPARE_INPUT
    );

    expect(result.state).toBe("provider_rejected");
    expect(result.delivered).toBe(false);
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(deps.store.completeReconciliation).not.toHaveBeenCalled();
  });

  it("resumes failed reconciliation without another provider call", async () => {
    const deps = dependencies();
    deps.store.prepare.mockResolvedValue(
      intent("reconciliation_failed", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        providerAcceptedAt: "2026-07-15T20:00:00.000Z",
      })
    );

    const result = await new ApprovedActionEmailDeliveryService(deps).execute(
      PREPARE_INPUT
    );

    expect(result.state).toBe("reconciled");
    expect(deps.provider.sendEmail).not.toHaveBeenCalled();
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
  });

  it("reclaims an expired reconciliation lease without another provider call", async () => {
    const deps = dependencies();
    deps.store.prepare.mockResolvedValue(
      intent("reconciling", {
        providerMessageId: "sent-message-1",
        acceptedProviderThreadId: "sent-thread-1",
        providerAcceptedAt: "2026-07-15T20:00:00.000Z",
      })
    );

    const result = await new ApprovedActionEmailDeliveryService(deps).execute(
      PREPARE_INPUT
    );

    expect(result.state).toBe("reconciled");
    expect(deps.provider.sendEmail).not.toHaveBeenCalled();
    expect(deps.store.claimReconciliation).toHaveBeenCalledTimes(1);
  });
});
