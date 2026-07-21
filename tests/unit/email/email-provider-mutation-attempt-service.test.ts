import { describe, expect, it, vi } from "vitest";

import {
  EmailProviderMutationAttemptService,
  EmailProviderMutationReconciliationRequiredError,
  type EmailProviderMutationAttempt,
} from "@/lib/api/services/email-provider-mutation-attempt-service";
import { ProviderApiError } from "@/lib/api/services/email-provider";

function attempt(
  status: EmailProviderMutationAttempt["status"],
  overrides: Partial<EmailProviderMutationAttempt> = {}
): EmailProviderMutationAttempt {
  return {
    id: "attempt-1",
    connectionId: "connection-1",
    connectionTypeSnapshot: "company",
    providerSnapshot: "gmail",
    mailboxAddressSnapshot: "office@example.com",
    ownerUserIdSnapshot: null,
    operationKind: "draft_create",
    operationKey: "composer-1",
    requestFingerprint: "a".repeat(64),
    status,
    attemptCount: status === "prepared" ? 0 : 1,
    providerResourceId: null,
    providerSecondaryResourceId: null,
    providerResult: {},
    lastError: null,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function dependencies() {
  const accepted = attempt("provider_accepted", {
    providerResourceId: "provider-draft-1",
    providerSecondaryResourceId: "provider-thread-1",
    providerResult: {
      draftId: "provider-draft-1",
      threadId: "provider-thread-1",
    },
  });
  const store = {
    prepare: vi.fn().mockResolvedValue(attempt("prepared")),
    claim: vi.fn().mockResolvedValue(attempt("attempting")),
    persistAcceptance: vi.fn().mockResolvedValue(accepted),
    markProviderRejected: vi
      .fn()
      .mockResolvedValue(attempt("provider_rejected")),
    markReconciliationRequired: vi
      .fn()
      .mockResolvedValue(attempt("reconciliation_required")),
    complete: vi
      .fn()
      .mockResolvedValue(
        attempt("completed", { ...accepted, status: "completed" })
      ),
  };
  const executeProvider = vi.fn().mockResolvedValue({
    resourceId: "provider-draft-1",
    secondaryResourceId: "provider-thread-1",
    result: {
      draftId: "provider-draft-1",
      threadId: "provider-thread-1",
    },
  });
  const reconcile = vi.fn().mockResolvedValue(undefined);
  const assertMailboxLease = vi.fn().mockResolvedValue(undefined);
  const service = new EmailProviderMutationAttemptService(store);
  const input = {
    connectionId: "connection-1",
    operationKind: "draft_create" as const,
    operationKey: "composer-1",
    requestFingerprint: "a".repeat(64),
    assertMailboxLease,
    executeProvider,
    reconcile,
  };
  return {
    service,
    store,
    executeProvider,
    reconcile,
    assertMailboxLease,
    input,
    accepted,
  };
}

describe("EmailProviderMutationAttemptService", () => {
  it("persists the attempt before one provider create, then reconciles and completes", async () => {
    const {
      service,
      store,
      executeProvider,
      reconcile,
      assertMailboxLease,
      input,
    } = dependencies();

    const result = await service.execute(input);

    expect(result.status).toBe("completed");
    expect(store.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      store.claim.mock.invocationCallOrder[0]!
    );
    expect(store.claim.mock.invocationCallOrder[0]).toBeLessThan(
      executeProvider.mock.invocationCallOrder[0]!
    );
    expect(assertMailboxLease).toHaveBeenCalledTimes(2);
    expect(store.claim.mock.invocationCallOrder[0]).toBeLessThan(
      assertMailboxLease.mock.invocationCallOrder[1]!
    );
    expect(assertMailboxLease.mock.invocationCallOrder[1]).toBeLessThan(
      executeProvider.mock.invocationCallOrder[0]!
    );
    expect(executeProvider).toHaveBeenCalledOnce();
    expect(store.persistAcceptance.mock.invocationCallOrder[0]).toBeLessThan(
      reconcile.mock.invocationCallOrder[0]!
    );
    expect(reconcile).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      resourceId: "provider-draft-1",
      secondaryResourceId: "provider-thread-1",
      result: {
        draftId: "provider-draft-1",
        threadId: "provider-thread-1",
      },
    });
    expect(store.complete).toHaveBeenCalledOnce();
  });

  it("retries provider-acceptance persistence exactly once without re-calling the provider", async () => {
    const { service, store, executeProvider, input, accepted } = dependencies();
    store.persistAcceptance
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(accepted);

    await service.execute(input);

    expect(executeProvider).toHaveBeenCalledOnce();
    expect(store.persistAcceptance).toHaveBeenCalledTimes(2);
  });

  it("resumes accepted reconciliation without another provider create", async () => {
    const { service, store, executeProvider, reconcile, input, accepted } =
      dependencies();
    store.prepare.mockResolvedValueOnce(accepted);

    await service.execute(input);

    expect(store.claim).not.toHaveBeenCalled();
    expect(executeProvider).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(store.complete).toHaveBeenCalledOnce();
  });

  it("replays only exact-resource reconciliation for a completed retry", async () => {
    const { service, store, executeProvider, reconcile, input, accepted } =
      dependencies();
    store.prepare.mockResolvedValueOnce(
      attempt("completed", { ...accepted, status: "completed" })
    );

    await service.execute(input);

    expect(executeProvider).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("turns a lease-proven stranded attempt into a durable recovery alert without replaying the provider", async () => {
    const { service, store, executeProvider, assertMailboxLease, input } =
      dependencies();
    store.prepare.mockResolvedValueOnce(attempt("attempting"));

    await expect(service.execute(input)).rejects.toBeInstanceOf(
      EmailProviderMutationReconciliationRequiredError
    );
    expect(store.claim).not.toHaveBeenCalled();
    expect(executeProvider).not.toHaveBeenCalled();
    expect(store.markReconciliationRequired).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      providerResourceId: null,
      providerSecondaryResourceId: null,
      providerResult: {},
      error:
        "A prior provider attempt ended without a durable acceptance result",
    });
    expect(assertMailboxLease.mock.invocationCallOrder.at(-1)).toBeLessThan(
      store.markReconciliationRequired.mock.invocationCallOrder[0]!
    );
  });

  it("does not clobber an attempting row when the caller cannot prove exclusive mailbox-lease ownership", async () => {
    const { service, store, executeProvider, assertMailboxLease, input } =
      dependencies();
    store.prepare.mockResolvedValueOnce(attempt("attempting"));
    assertMailboxLease.mockRejectedValueOnce(
      new Error("mailbox lock ownership was lost")
    );

    await expect(service.execute(input)).rejects.toThrow(
      "mailbox lock ownership was lost"
    );
    expect(store.markReconciliationRequired).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(executeProvider).not.toHaveBeenCalled();
  });

  it("quarantines a lost provider result and never blindly retries", async () => {
    const { service, store, executeProvider, input } = dependencies();
    executeProvider.mockRejectedValueOnce(new Error("request timed out"));

    await expect(service.execute(input)).rejects.toMatchObject({
      code: "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED",
    });
    expect(store.markReconciliationRequired).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      providerResourceId: null,
      providerSecondaryResourceId: null,
      providerResult: {},
      error: "request timed out",
    });

    store.prepare.mockResolvedValueOnce(
      attempt("reconciliation_required", {
        lastError: "request timed out",
      })
    );
    await expect(service.execute(input)).rejects.toBeInstanceOf(
      EmailProviderMutationReconciliationRequiredError
    );
    expect(executeProvider).toHaveBeenCalledTimes(1);
  });

  it.each([500, 408, 409, 425, 429, 499])(
    "quarantines ambiguous provider HTTP %s instead of making it replayable",
    async (status) => {
      const { service, store, executeProvider, input } = dependencies();
      executeProvider.mockRejectedValueOnce(
        new ProviderApiError("ambiguous response", status, {})
      );

      await expect(service.execute(input)).rejects.toBeInstanceOf(
        EmailProviderMutationReconciliationRequiredError
      );
      expect(store.markProviderRejected).not.toHaveBeenCalled();
      expect(store.markReconciliationRequired).toHaveBeenCalledOnce();
    }
  );

  it.each([400, 401, 403])(
    "records explicit provider HTTP %s rejection as safely retryable",
    async (status) => {
      const { service, store, executeProvider, input } = dependencies();
      const rejection = new ProviderApiError(
        "provider rejected request",
        status,
        {}
      );
      executeProvider.mockRejectedValueOnce(rejection);

      await expect(service.execute(input)).rejects.toBe(rejection);
      expect(store.markProviderRejected).toHaveBeenCalledOnce();
      expect(store.markReconciliationRequired).not.toHaveBeenCalled();
    }
  );

  it("retries idempotent reconciliation exactly once, then leaves a durable recovery state", async () => {
    const { service, store, executeProvider, reconcile, input } =
      dependencies();
    reconcile
      .mockRejectedValueOnce(new Error("mirror write failed"))
      .mockRejectedValueOnce(new Error("mirror write failed again"));

    await expect(service.execute(input)).rejects.toMatchObject({
      code: "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED",
    });

    expect(executeProvider).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(store.markReconciliationRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        providerResourceId: "provider-draft-1",
        providerSecondaryResourceId: "provider-thread-1",
        error: "mirror write failed again",
      })
    );
  });

  it("creates a persistent recovery state when completion persistence fails after exact reconciliation", async () => {
    const { service, store, executeProvider, reconcile, input } =
      dependencies();
    store.complete.mockRejectedValue(new Error("completion store unavailable"));

    await expect(service.execute(input)).rejects.toMatchObject({
      code: "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED",
      providerResourceId: "provider-draft-1",
      providerSecondaryResourceId: "provider-thread-1",
    });

    expect(executeProvider).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(store.complete).toHaveBeenCalledTimes(2);
    expect(store.markReconciliationRequired).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      providerResourceId: "provider-draft-1",
      providerSecondaryResourceId: "provider-thread-1",
      providerResult: {
        draftId: "provider-draft-1",
        threadId: "provider-thread-1",
      },
      error:
        "Provider mutation reconciled but completion persistence failed: completion store unavailable",
    });
  });
});
