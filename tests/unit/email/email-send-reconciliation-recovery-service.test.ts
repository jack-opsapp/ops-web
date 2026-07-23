import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/services/email-service", () => ({ EmailService: {} }));
vi.mock("@/lib/api/services/email-send-reconciliation-service", () => ({
  reconcileEmailSend: vi.fn(),
}));

import {
  EmailSendReconciliationRecoveryService,
  type EmailSendReconciliationRecoveryDependencies,
} from "@/lib/api/services/email-send-reconciliation-recovery-service";
import type { EmailSendIntent } from "@/lib/api/services/email-send-intent-service";

function leasedIntent(): EmailSendIntent {
  return {
    id: "intent-1",
    companyId: "company-1",
    idempotencyKey: "send-1",
    requestFingerprint: "f".repeat(64),
    actorUserId: "actor-1",
    initiatedBy: "phase_c_auto_send",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    assignmentVersion: 4,
    assignmentEventId: "assignment-event-4",
    sourceEmailThreadId: "thread-row-1",
    replyProviderThreadId: "provider-thread-1",
    inReplyTo: "provider-message-1",
    senderSwitched: false,
    toEmails: ["lead@example.com"],
    ccEmails: [],
    subject: "Estimate",
    authoredBody: "Here is the estimate.",
    renderedBody: "Here is the estimate.",
    contentType: "text",
    draftHistoryId: "draft-1",
    followUpDraftId: null,
    followUpSourceEventId: null,
    followUpRecipientEmail: null,
    learningAuthority: "autonomous",
    actorNameSnapshot: "Alex Rivera",
    actorEmailSnapshot: "alex@ops.test",
    clientFromAddressSnapshot: "hello@company.test",
    signatureId: null,
    signatureContentHash: null,
    renderedBodyHash: "b".repeat(64),
    pendingAutoSendId: "pending-1",
    pendingAutoSendLeaseToken: "queue-lease-1",
    profileTypeSnapshot: "lead-estimate",
    status: "reconciling",
    providerMessageId: "sent-message-1",
    acceptedProviderThreadId: "provider-thread-1",
    providerAcceptedAt: "2026-07-15T18:00:00.000Z",
    reconciliationAttempts: 2,
    reconciliationLeaseToken: "reconcile-lease-1",
    reconciliationLeaseExpiresAt: "2026-07-15T18:10:00.000Z",
    reconciledActivityId: null,
    reconciledAt: null,
    lastError: null,
    createdAt: "2026-07-15T17:00:00.000Z",
    updatedAt: "2026-07-15T18:05:00.000Z",
  };
}

function dependencies() {
  const intent = leasedIntent();
  const intentStore = {
    claimNextReconciliation: vi
      .fn()
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce(null),
    completeReconciliation: vi.fn().mockResolvedValue({
      ...intent,
      status: "reconciled",
      reconciledActivityId: "activity-1",
    }),
    failReconciliation: vi.fn().mockResolvedValue({
      ...intent,
      status: "reconciliation_failed",
    }),
  };
  const sendEmail = vi.fn();
  const applyLabel = vi.fn();
  const provider = { applyLabel, sendEmail };
  const connection = {
    id: "connection-1",
    companyId: "company-1",
    status: "active",
  };
  const getConnection = vi.fn().mockResolvedValue(connection);
  const getProvider = vi.fn().mockReturnValue(provider);
  const reconcile = vi.fn().mockResolvedValue({ activityId: "activity-1" });
  const service = new EmailSendReconciliationRecoveryService({
    intentStore,
    getConnection,
    getProvider,
    reconcile,
    now: () => new Date("2026-07-15T18:10:00.000Z"),
  } as unknown as EmailSendReconciliationRecoveryDependencies);

  return {
    service,
    intentStore,
    connection,
    provider,
    getConnection,
    getProvider,
    reconcile,
    sendEmail,
    applyLabel,
  };
}

describe("EmailSendReconciliationRecoveryService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reconciles a provider-accepted intent without any provider send path", async () => {
    const deps = dependencies();

    const result = await deps.service.process({
      limit: 5,
      failureCooldownSeconds: 60,
      leaseSeconds: 240,
    });

    expect(deps.intentStore.claimNextReconciliation).toHaveBeenNthCalledWith(
      1,
      {
        failedBefore: "2026-07-15T18:09:00.000Z",
        leaseSeconds: 240,
      }
    );
    expect(deps.getConnection).toHaveBeenCalledWith("connection-1");
    expect(deps.reconcile).toHaveBeenCalledWith(
      leasedIntent(),
      deps.connection,
      deps.provider
    );
    expect(deps.intentStore.completeReconciliation).toHaveBeenCalledWith({
      intentId: "intent-1",
      leaseToken: "reconcile-lease-1",
      activityId: "activity-1",
    });
    expect(result).toEqual({
      claimed: 1,
      reconciled: 1,
      failed: 0,
      errors: [],
    });
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("records a token-fenced retry when reconciliation fails", async () => {
    const deps = dependencies();
    deps.reconcile.mockRejectedValue(new Error("activity insert failed"));

    const result = await deps.service.process({ limit: 1 });

    expect(deps.intentStore.failReconciliation).toHaveBeenCalledWith({
      intentId: "intent-1",
      leaseToken: "reconcile-lease-1",
      error: "activity insert failed",
    });
    expect(result).toEqual({
      claimed: 1,
      reconciled: 0,
      failed: 1,
      errors: ["intent-1: activity insert failed"],
    });
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });
});
