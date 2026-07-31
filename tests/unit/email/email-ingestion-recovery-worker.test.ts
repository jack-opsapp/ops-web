import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EmailIngestionRecoveryWorker,
  type ClaimedEmailIngestionRecovery,
  type EmailIngestionRecoveryDependencies,
} from "@/lib/api/services/email-ingestion-recovery-worker";
import type { EmailConnection } from "@/lib/types/email-connection";

const CONNECTION_ID = "00000000-0000-4000-8000-000000000101";
const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

function connection(overrides: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: CONNECTION_ID,
    companyId: COMPANY_ID,
    provider: "gmail",
    type: "company",
    userId: "00000000-0000-4000-8000-000000000999",
    email: "office@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    historyRecoveryAnchor: null,
    historyRecoveryPageToken: null,
    historyRecoveryTargetToken: null,
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    webhookClientStateHash: null,
    opsLabelId: "Label_1",
    aiReviewEnabled: true,
    aiMemoryEnabled: true,
    status: "active",
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    ...overrides,
  };
}

function labelJob(
  overrides: Partial<ClaimedEmailIngestionRecovery> = {}
): ClaimedEmailIngestionRecovery {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    companyId: COMPANY_ID,
    connectionId: CONNECTION_ID,
    kind: "provider_label_apply",
    providerThreadId: "provider-thread-1",
    providerMessageId: "provider-message-exact",
    providerLabelId: "Label_1",
    opportunityId: null,
    attempts: 1,
    ...overrides,
  };
}

function classificationJob(
  overrides: Partial<ClaimedEmailIngestionRecovery> = {}
): ClaimedEmailIngestionRecovery {
  return {
    ...labelJob(),
    id: "00000000-0000-4000-8000-000000000202",
    kind: "lead_classification",
    providerMessageId: "provider-message-exact",
    providerLabelId: null,
    ...overrides,
  };
}

function commercialOutcomeJob(
  overrides: Partial<ClaimedEmailIngestionRecovery> = {}
): ClaimedEmailIngestionRecovery {
  return {
    ...classificationJob(),
    id: "00000000-0000-4000-8000-000000000203",
    kind: "commercial_outcome",
    opportunityId: "00000000-0000-4000-8000-000000000401",
    ...overrides,
  };
}

function makeHarness(input?: {
  jobs?: ClaimedEmailIngestionRecovery[];
  connection?: EmailConnection | null;
  authorized?: boolean;
}) {
  const claim = vi.fn(async () => input?.jobs ?? [labelJob()]);
  const reauthorize = vi.fn(async () => input?.authorized ?? true);
  const loadConnection = vi.fn(async () =>
    input && Object.prototype.hasOwnProperty.call(input, "connection")
      ? (input.connection ?? null)
      : connection()
  );
  const applyProviderLabel = vi.fn(async () => undefined);
  const recoverLeadClassification = vi.fn(async () => "promoted" as const);
  const recoverCommercialOutcome = vi.fn(async () => undefined);
  const complete = vi.fn(async () => true);
  const fail = vi.fn<EmailIngestionRecoveryDependencies["fail"]>(
    async () => "retrying"
  );
  const mailbox = { acquired: true };
  const checkpoint = vi.fn(async () => undefined);
  const runWithMailboxLease: EmailIngestionRecoveryDependencies["runWithMailboxLease"] =
    async ({ run }) =>
      mailbox.acquired
        ? {
            acquired: true,
            value: await run(
              checkpoint,
              "00000000-0000-4000-8000-000000000301"
            ),
          }
        : { acquired: false };

  const dependencies: EmailIngestionRecoveryDependencies = {
    claim,
    reauthorize,
    loadConnection,
    runWithMailboxLease,
    applyProviderLabel,
    recoverLeadClassification,
    recoverCommercialOutcome,
    complete,
    fail,
    workerId: () => "email-ingestion-recovery-worker-1",
  };

  return {
    worker: new EmailIngestionRecoveryWorker(dependencies),
    claim,
    reauthorize,
    loadConnection,
    applyProviderLabel,
    recoverLeadClassification,
    recoverCommercialOutcome,
    complete,
    fail,
    mailbox,
    checkpoint,
  };
}

describe("EmailIngestionRecoveryWorker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retries an idempotent provider-label write and completes the same durable job once", async () => {
    const job = labelJob();
    const harness = makeHarness({ jobs: [job] });
    harness.applyProviderLabel.mockRejectedValueOnce(
      new Error("gmail temporarily unavailable")
    );

    const first = await harness.worker.process({
      companyIds: [COMPANY_ID],
      limit: 5,
      leaseSeconds: 360,
    });

    expect(harness.claim).toHaveBeenCalledWith({
      holder: "email-ingestion-recovery-worker-1",
      companyIds: [COMPANY_ID],
      limit: 5,
      leaseSeconds: 360,
    });
    expect(harness.fail).toHaveBeenCalledWith({
      queueId: job.id,
      holder: "email-ingestion-recovery-worker-1",
      error: "gmail temporarily unavailable",
    });
    expect(harness.complete).not.toHaveBeenCalled();
    expect(first.retrying).toBe(1);

    harness.claim.mockResolvedValueOnce([{ ...job, attempts: 2 }]);
    const second = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.applyProviderLabel).toHaveBeenCalledTimes(2);
    expect(harness.complete).toHaveBeenCalledWith({
      queueId: job.id,
      holder: "email-ingestion-recovery-worker-1",
      outcome: "label_applied",
    });
    expect(second.labelsApplied).toBe(1);
  });

  it("recovers one exact deferred message without substituting the latest thread message", async () => {
    const job = classificationJob();
    const harness = makeHarness({ jobs: [job] });

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.recoverLeadClassification).toHaveBeenCalledWith({
      job,
      connection: expect.objectContaining({ id: CONNECTION_ID }),
      providerLockCheckpoint: harness.checkpoint,
      syncLockOwner: "00000000-0000-4000-8000-000000000301",
    });
    expect(harness.applyProviderLabel).not.toHaveBeenCalled();
    expect(harness.complete).toHaveBeenCalledWith({
      queueId: job.id,
      holder: "email-ingestion-recovery-worker-1",
      outcome: "classification_recovered",
    });
    expect(result.classificationsRecovered).toBe(1);
    expect(result.promoted).toBe(1);
  });

  it("re-evaluates one exact safety-held commercial outcome without provider transport", async () => {
    const job = commercialOutcomeJob();
    const harness = makeHarness({ jobs: [job] });

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.recoverCommercialOutcome).toHaveBeenCalledWith({
      job,
      connection: expect.objectContaining({ id: CONNECTION_ID }),
      providerLockCheckpoint: harness.checkpoint,
      syncLockOwner: "00000000-0000-4000-8000-000000000301",
    });
    expect(harness.recoverLeadClassification).not.toHaveBeenCalled();
    expect(harness.applyProviderLabel).not.toHaveBeenCalled();
    expect(harness.complete).toHaveBeenCalledWith({
      queueId: job.id,
      holder: "email-ingestion-recovery-worker-1",
      outcome: "commercial_outcome_recovered",
    });
    expect(result.commercialOutcomesRecovered).toBe(1);
  });

  it("rejects a commercial recovery whose exact opportunity identity is absent", async () => {
    const harness = makeHarness({
      jobs: [commercialOutcomeJob({ opportunityId: null })],
    });

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.recoverCommercialOutcome).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "EMAIL_INGESTION_RECOVERY_OPPORTUNITY_ID_MISSING",
      })
    );
    expect(result.retrying).toBe(1);
  });

  it("fails closed when the durable lease is no longer authorized", async () => {
    const harness = makeHarness({
      jobs: [labelJob()],
      authorized: false,
    });
    harness.fail.mockResolvedValue("stale");

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.applyProviderLabel).not.toHaveBeenCalled();
    expect(harness.recoverLeadClassification).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "EMAIL_INGESTION_RECOVERY_AUTHORIZATION_STALE",
      })
    );
    expect(result.stale).toBe(1);
  });

  it("retires a label job when the mailbox label configuration changed", async () => {
    const job = labelJob();
    const harness = makeHarness({
      jobs: [job],
      connection: connection({ opsLabelId: "Label_2" }),
    });

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.applyProviderLabel).not.toHaveBeenCalled();
    expect(harness.complete).toHaveBeenCalledWith({
      queueId: job.id,
      holder: "email-ingestion-recovery-worker-1",
      outcome: "stale_configuration",
    });
    expect(result.stale).toBe(1);
  });

  it("retries without provider access when the physical mailbox is busy", async () => {
    const harness = makeHarness({ jobs: [classificationJob()] });
    harness.mailbox.acquired = false;

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.reauthorize).not.toHaveBeenCalled();
    expect(harness.recoverLeadClassification).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "EMAIL_INGESTION_RECOVERY_MAILBOX_BUSY",
      })
    );
    expect(result.retrying).toBe(1);
  });

  it("rejects an inactive or cross-tenant mailbox before any provider access", async () => {
    const harness = makeHarness({
      jobs: [labelJob()],
      connection: connection({
        companyId: "00000000-0000-4000-8000-000000000999",
        status: "disconnected",
        syncEnabled: false,
      }),
    });

    const result = await harness.worker.process({
      companyIds: [COMPANY_ID],
    });

    expect(harness.reauthorize).not.toHaveBeenCalled();
    expect(harness.applyProviderLabel).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "EMAIL_INGESTION_RECOVERY_CONNECTION_INVALID",
      })
    );
    expect(result.retrying).toBe(1);
  });
});
