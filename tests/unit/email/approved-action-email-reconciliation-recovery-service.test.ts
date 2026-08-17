import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/services/email-service", () => ({ EmailService: {} }));
vi.mock(
  "@/lib/api/services/approved-action-email-reconciliation-service",
  () => ({ reconcileApprovedActionEmail: vi.fn() })
);

import {
  ApprovedActionEmailReconciliationRecoveryService,
  type ApprovedActionEmailReconciliationRecoveryDependencies,
} from "@/lib/api/services/approved-action-email-reconciliation-recovery-service";
import type { ApprovedActionEmailIntent } from "@/lib/api/services/approved-action-email-delivery-service";
import { CronDatabaseOperationError } from "@/lib/api/services/cron-workload-control-service";
import type { EmailConnectionSyncLockRunResult } from "@/lib/api/services/email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "@/lib/api/services/email-provider-mailbox-operation";
import type { EmailConnection } from "@/lib/types/email-connection";

function leasedIntent(
  overrides: Partial<ApprovedActionEmailIntent> = {}
): ApprovedActionEmailIntent {
  return {
    id: "approved-intent-1",
    actionId: "action-1",
    actionType: "send_appointment_confirmation",
    actionDataSnapshot: {},
    companyId: "company-1",
    actorUserId: "actor-1",
    executionMode: "autonomous",
    idempotencyKey: "f".repeat(64),
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    assignmentVersion: 4,
    assignmentEventId: "assignment-event-4",
    clientId: "client-1",
    projectId: "project-1",
    invoiceId: null,
    sourceEmailThreadId: "thread-row-1",
    replyProviderThreadId: "provider-thread-1",
    inReplyTo: "provider-message-1",
    toEmails: ["client@example.com"],
    ccEmails: [],
    subject: "Your appointment",
    authoredBody: "We are scheduled for Tuesday.",
    renderedBody: "We are scheduled for Tuesday.\n\n--\nAlex",
    contentType: "text",
    draftHistoryId: null,
    sourceDraftHistoryId: "source-draft-1",
    profileTypeSnapshot: "lead-estimate",
    learningAuthority: "autonomous",
    actorNameSnapshot: "Alex Rivera",
    actorEmailSnapshot: "alex@ops.test",
    clientFromAddressSnapshot: "hello@company.test",
    signatureId: "signature-1",
    signatureContentHash: "a".repeat(64),
    renderedBodyHash: "b".repeat(64),
    status: "reconciling",
    providerMessageId: "sent-message-1",
    acceptedProviderThreadId: "provider-thread-1",
    providerAcceptedAt: "2026-08-09T17:50:00.000Z",
    reconciliationAttempts: 2,
    maxReconciliationAttempts: 8,
    reconciliationLeaseToken: "reconcile-lease-1",
    reconciliationLeaseExpiresAt: "2026-08-09T18:13:00.000Z",
    reconciliationExhaustedAt: null,
    reconciledActivityId: null,
    lastError: null,
    ...overrides,
  };
}

function connection(): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "hello@company.test",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date("2026-08-09T19:00:00.000Z"),
    historyId: null,
    syncEnabled: false,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: true,
    aiMemoryEnabled: true,
    status: "paused",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-09T17:00:00.000Z"),
  };
}

function dependencies() {
  const intent = leasedIntent();
  const intentStore = {
    finalizeExpiredReconciliations: vi.fn().mockResolvedValue(0),
    claimNextReconciliation: vi
      .fn()
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce(null),
    renewReconciliation: vi.fn().mockResolvedValue(intent),
    completeReconciliation: vi.fn().mockResolvedValue({
      ...intent,
      status: "reconciled",
      reconciledActivityId: "activity-1",
    }),
    failReconciliation: vi.fn().mockResolvedValue({
      ...intent,
      status: "reconciliation_failed",
    }),
    releaseReconciliation: vi.fn().mockResolvedValue({
      ...intent,
      status: "reconciliation_failed",
      reconciliationLeaseToken: null,
      reconciliationLeaseExpiresAt: null,
    }),
    projectNextAlert: vi.fn().mockResolvedValue({
      processed: false,
      succeeded: true,
      error: null,
    }),
  };
  const mailbox = connection();
  const provider = { applyLabel: vi.fn(), sendEmail: vi.fn() };
  const getConnection = vi.fn().mockResolvedValue(mailbox);
  const getProvider = vi.fn().mockReturnValue(provider);
  const reconcile = vi.fn().mockResolvedValue({ activityId: "activity-1" });
  const mailboxCheckpoint = vi.fn(async () => undefined);
  const runWithMailboxLease = vi.fn(
    async <T>(input: {
      connectionId: string;
      run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
    }): Promise<EmailConnectionSyncLockRunResult<T>> => ({
      acquired: true,
      value: await input.run(mailboxCheckpoint),
    })
  );
  const service = new ApprovedActionEmailReconciliationRecoveryService({
    intentStore,
    getConnection,
    getProvider,
    reconcile,
    runWithMailboxLease,
    now: () => new Date("2026-08-09T18:10:00.000Z"),
  } as ApprovedActionEmailReconciliationRecoveryDependencies);

  return {
    service,
    intent,
    intentStore,
    mailbox,
    provider,
    getConnection,
    getProvider,
    reconcile,
    mailboxCheckpoint,
    runWithMailboxLease,
  };
}

describe("ApprovedActionEmailReconciliationRecoveryService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replays one accepted provider identity without requiring an active mailbox or exposing a send method", async () => {
    const deps = dependencies();

    const result = await deps.service.process({
      limit: 5,
      failureCooldownSeconds: 60,
      leaseSeconds: 180,
    });

    expect(deps.intentStore.claimNextReconciliation).toHaveBeenNthCalledWith(
      1,
      {
        failedBefore: "2026-08-09T18:09:00.000Z",
        leaseSeconds: 180,
      }
    );
    expect(deps.getConnection).toHaveBeenCalledWith("connection-1");
    expect(deps.runWithMailboxLease).toHaveBeenCalledWith({
      connectionId: "connection-1",
      run: expect.any(Function),
    });
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
    const recoveryProvider = deps.reconcile.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(recoveryProvider).not.toBe(deps.provider);
    expect(recoveryProvider).toEqual({ applyLabel: expect.any(Function) });
    expect("sendEmail" in recoveryProvider).toBe(false);
    expect(deps.reconcile.mock.calls[0]?.[3]).toEqual(expect.any(Function));
    expect(deps.intentStore.renewReconciliation).toHaveBeenCalledTimes(2);
    expect(deps.intentStore.renewReconciliation).toHaveBeenNthCalledWith(1, {
      intentId: "approved-intent-1",
      leaseToken: "reconcile-lease-1",
      leaseSeconds: 180,
    });
    expect(deps.intentStore.completeReconciliation).toHaveBeenCalledWith({
      intentId: "approved-intent-1",
      leaseToken: "reconcile-lease-1",
      activityId: "activity-1",
    });
    expect(result).toEqual({
      claimed: 1,
      reconciled: 1,
      failed: 0,
      exhausted: 0,
      errors: [],
    });
    expect(deps.provider.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps reconciliation and completion inside one mailbox lease", async () => {
    const deps = dependencies();
    const order: string[] = [];
    deps.runWithMailboxLease.mockImplementation(async (input) => {
      order.push("mailbox-enter");
      const value = await input.run(deps.mailboxCheckpoint);
      order.push("mailbox-exit");
      return { acquired: true, value };
    });
    deps.intentStore.renewReconciliation.mockImplementation(async () => {
      order.push("intent-renew");
      return deps.intent;
    });
    deps.reconcile.mockImplementation(
      async (_intent, _connection, _provider, checkpoint) => {
        order.push("reconcile-enter");
        await checkpoint();
        order.push("reconcile-write");
        return { activityId: "activity-1" };
      }
    );
    deps.intentStore.completeReconciliation.mockImplementation(async () => {
      order.push("complete");
      return leasedIntent({
        status: "reconciled",
        reconciledActivityId: "activity-1",
      });
    });

    await deps.service.process({ limit: 1, leaseSeconds: 180 });

    expect(order).toEqual([
      "mailbox-enter",
      "intent-renew",
      "reconcile-enter",
      "intent-renew",
      "reconcile-write",
      "intent-renew",
      "complete",
      "mailbox-exit",
    ]);
  });

  it("stops a stale worker at the next exact-token renewal before another side effect", async () => {
    const deps = dependencies();
    const sideEffect = vi.fn();
    deps.intentStore.renewReconciliation
      .mockResolvedValueOnce(deps.intent)
      .mockRejectedValueOnce(
        new Error("APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID")
      );
    deps.reconcile.mockImplementation(
      async (_intent, _connection, _provider, checkpoint) => {
        await checkpoint();
        sideEffect();
        return { activityId: "activity-1" };
      }
    );

    const result = await deps.service.process({ limit: 1 });

    expect(sideEffect).not.toHaveBeenCalled();
    expect(deps.intentStore.completeReconciliation).not.toHaveBeenCalled();
    expect(deps.intentStore.failReconciliation).not.toHaveBeenCalled();
    expect(deps.intentStore.releaseReconciliation).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, reconciled: 0, failed: 1 });
  });

  it("releases mailbox contention without consuming reconciliation retry budget", async () => {
    const deps = dependencies();
    deps.runWithMailboxLease.mockResolvedValue({ acquired: false });

    const result = await deps.service.process({ limit: 1 });

    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(deps.intentStore.failReconciliation).not.toHaveBeenCalled();
    expect(deps.intentStore.releaseReconciliation).toHaveBeenCalledWith({
      intentId: "approved-intent-1",
      leaseToken: "reconcile-lease-1",
      error: "APPROVED_ACTION_EMAIL_RECONCILIATION_MAILBOX_BUSY",
    });
    expect(result).toMatchObject({ claimed: 1, reconciled: 0, failed: 1 });
  });

  it("continues past one retryable failure so an older bad row cannot starve later accepted work", async () => {
    const deps = dependencies();
    const second = leasedIntent({
      id: "approved-intent-2",
      actionId: "action-2",
      reconciliationLeaseToken: "reconcile-lease-2",
    });
    deps.intentStore.claimNextReconciliation
      .mockReset()
      .mockResolvedValueOnce(deps.intent)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(null);
    deps.reconcile
      .mockRejectedValueOnce(new Error("activity insert failed"))
      .mockResolvedValueOnce({ activityId: "activity-2" });

    const result = await deps.service.process({ limit: 5 });

    expect(deps.intentStore.claimNextReconciliation).toHaveBeenCalledTimes(3);
    expect(deps.intentStore.failReconciliation).toHaveBeenCalledWith({
      intentId: "approved-intent-1",
      leaseToken: "reconcile-lease-1",
      error: "activity insert failed",
    });
    expect(deps.intentStore.completeReconciliation).toHaveBeenCalledWith({
      intentId: "approved-intent-2",
      leaseToken: "reconcile-lease-2",
      activityId: "activity-2",
    });
    expect(result).toEqual({
      claimed: 2,
      reconciled: 1,
      failed: 1,
      exhausted: 0,
      errors: ["approved-intent-1: activity insert failed"],
    });
  });

  it("reports the failed attempt that consumes the final bounded retry as exhausted", async () => {
    const deps = dependencies();
    deps.reconcile.mockRejectedValue(new Error("memory persistence failed"));
    deps.intentStore.failReconciliation.mockResolvedValue(
      leasedIntent({
        status: "reconciliation_failed",
        reconciliationAttempts: 8,
        maxReconciliationAttempts: 8,
        reconciliationLeaseToken: null,
        reconciliationLeaseExpiresAt: null,
        reconciliationExhaustedAt: "2026-08-09T18:10:00.000Z",
        lastError: "memory persistence failed",
      })
    );

    const result = await deps.service.process({ limit: 1 });

    expect(result).toEqual({
      claimed: 1,
      reconciled: 0,
      failed: 1,
      exhausted: 1,
      errors: ["approved-intent-1: memory persistence failed"],
    });
  });

  it("releases a pressure-interrupted lease without consuming the final retry", async () => {
    const deps = dependencies();
    const pressure = new CronDatabaseOperationError(
      "Approved-action email reconciliation failed",
      { cause: { status: 521, message: "Web server is down" } }
    );
    deps.reconcile.mockRejectedValue(pressure);

    await expect(deps.service.process({ limit: 5 })).rejects.toBe(pressure);

    expect(deps.intentStore.failReconciliation).not.toHaveBeenCalled();
    expect(deps.intentStore.releaseReconciliation).toHaveBeenCalledWith({
      intentId: "approved-intent-1",
      leaseToken: "reconcile-lease-1",
      error: "Approved-action email reconciliation failed",
    });
    expect(deps.intentStore.claimNextReconciliation).toHaveBeenCalledTimes(1);
  });

  it("preserves the original pressure classification when pressure also prevents lease release", async () => {
    const deps = dependencies();
    const pressure = new CronDatabaseOperationError(
      "Approved-action email reconciliation failed",
      { cause: { status: 521, message: "Web server is down" } }
    );
    deps.reconcile.mockRejectedValue(pressure);
    deps.intentStore.releaseReconciliation.mockRejectedValue(
      new CronDatabaseOperationError("Lease release failed", {
        cause: { status: 503, message: "database is unavailable" },
      })
    );

    await expect(deps.service.process({ limit: 5 })).rejects.toBe(pressure);

    expect(deps.intentStore.releaseReconciliation).toHaveBeenCalledTimes(1);
    expect(deps.intentStore.failReconciliation).not.toHaveBeenCalled();
    expect(deps.intentStore.completeReconciliation).not.toHaveBeenCalled();
  });

  it("terminalizes capped expired leases before claiming new work", async () => {
    const deps = dependencies();
    deps.intentStore.finalizeExpiredReconciliations.mockResolvedValue(2);
    deps.intentStore.claimNextReconciliation
      .mockReset()
      .mockResolvedValue(null);

    const result = await deps.service.process({ limit: 5 });

    expect(
      deps.intentStore.finalizeExpiredReconciliations
    ).toHaveBeenCalledWith({
      limit: 5,
    });
    expect(result).toEqual({
      claimed: 0,
      reconciled: 0,
      failed: 2,
      exhausted: 2,
      errors: [
        "2 expired approved-action email reconciliations exhausted their retry budget",
      ],
    });
  });

  it("reports a durable alert projection failure instead of hiding it", async () => {
    const deps = dependencies();
    deps.intentStore.claimNextReconciliation
      .mockReset()
      .mockResolvedValue(null);
    deps.intentStore.projectNextAlert.mockResolvedValue({
      processed: true,
      succeeded: false,
      error: "notification insert failed",
    });

    const result = await deps.service.process({ limit: 5 });

    expect(result).toEqual({
      claimed: 0,
      reconciled: 0,
      failed: 1,
      exhausted: 0,
      errors: [
        "approved-action email reconciliation alert projection failed: notification insert failed",
      ],
    });
    expect(deps.intentStore.projectNextAlert).toHaveBeenCalledTimes(1);
  });

  it("routes every legacy approved-action recovery entry point through the accepted-only worker", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/api/services/approved-action-email-transport-service.ts"
      ),
      "utf8"
    );
    const recovery = source.slice(source.indexOf("async recover"));

    expect(recovery).toContain("runApprovedActionEmailReconciliationRecovery");
    expect(recovery).not.toContain("executeApprovedActionEmail");
    expect(recovery).not.toContain("listRecoverable");
    expect(recovery).not.toMatch(/\.sendEmail\s*\(/);
  });
});
