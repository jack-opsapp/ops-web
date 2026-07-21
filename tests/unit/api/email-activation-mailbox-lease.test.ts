import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getConnectionMock,
  getProviderMock,
  updateConnectionMock,
  listLabelsMock,
  createLabelMock,
  setupWebhookMock,
  resolveAccessMock,
  resolveSignatureMock,
  reconcileLifecycleMock,
  runWithEmailConnectionSyncLockMock,
  createMutationServiceMock,
  mutationExecuteMock,
  buildMutationFingerprintMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  updateConnectionMock: vi.fn(),
  listLabelsMock: vi.fn(),
  createLabelMock: vi.fn(),
  setupWebhookMock: vi.fn(),
  resolveAccessMock: vi.fn(),
  resolveSignatureMock: vi.fn(),
  reconcileLifecycleMock: vi.fn(),
  runWithEmailConnectionSyncLockMock: vi.fn(),
  createMutationServiceMock: vi.fn(),
  mutationExecuteMock: vi.fn(),
  buildMutationFingerprintMock: vi.fn(() => "f".repeat(64)),
}));

vi.mock("@/lib/api/services/email-provider-mutation-attempt-service", () => ({
  buildEmailProviderMutationFingerprint: buildMutationFingerprintMock,
  createEmailProviderMutationAttemptService: createMutationServiceMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: vi.fn(() => ({ rpc: vi.fn() })),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
    updateConnection: updateConnectionMock,
  },
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  resolveEmailConnectionOperationAccess: resolveAccessMock,
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveSignatureMock,
}));

vi.mock(
  "@/lib/api/services/personal-email-connection-lifecycle-service",
  () => ({
    PersonalEmailConnectionLifecycleService: {
      reconcile: reconcileLifecycleMock,
    },
  })
);

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

vi.mock("@/lib/email/microsoft365-webhook-security", () => ({
  hashMicrosoft365ClientState: vi.fn(async () => "state-hash"),
}));

import { POST } from "@/app/api/integrations/email/activate/route";

function request() {
  return new NextRequest("https://ops.test/api/integrations/email/activate", {
    method: "POST",
    body: JSON.stringify({
      connectionId: "connection-1",
      companyId: "company-1",
      syncIntervalMinutes: 15,
      syncProfile: { includeLabels: ["INBOX"] },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAccessMock.mockResolvedValue({
    allowed: true,
    actor: { userId: "user-1", companyId: "company-1" },
  });
  getConnectionMock.mockResolvedValue({
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "individual",
    userId: "user-1",
    email: "operator@example.com",
    syncFilters: { lastScanJobId: "scan-1" },
  });
  listLabelsMock.mockResolvedValue([
    { id: "label-1", name: "OPS Pipeline", type: "user" },
  ]);
  createLabelMock.mockResolvedValue("label-created");
  setupWebhookMock.mockResolvedValue({
    subscriptionId: "watch-1",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    clientState: null,
  });
  getProviderMock.mockReturnValue({
    listLabels: listLabelsMock,
    createLabel: createLabelMock,
    setupWebhook: setupWebhookMock,
  });
  updateConnectionMock.mockResolvedValue(undefined);
  reconcileLifecycleMock.mockResolvedValue(undefined);
  resolveSignatureMock.mockResolvedValue(null);
  runWithEmailConnectionSyncLockMock.mockImplementation(
    async ({
      run,
    }: {
      run: (checkpoint: ReturnType<typeof vi.fn>) => unknown;
    }) => {
      const checkpoint = vi.fn(async () => undefined);
      return { acquired: true, value: await run(checkpoint) };
    }
  );
  mutationExecuteMock.mockImplementation(async (input) => {
    const output = await input.executeProvider();
    await input.reconcile({
      attemptId: "attempt-1",
      resourceId: output.resourceId,
      secondaryResourceId: output.secondaryResourceId ?? null,
      result: output.result ?? {},
    });
    return {
      status: "completed",
      providerResourceId: output.resourceId,
      providerResult: output.result ?? {},
    };
  });
  createMutationServiceMock.mockReturnValue({ execute: mutationExecuteMock });
});

describe("email activation mailbox lease", () => {
  it("fails busy before provider construction or activation mutation", async () => {
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Mailbox is busy. Try again in a few minutes.",
    });
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(listLabelsMock).not.toHaveBeenCalled();
    expect(createLabelMock).not.toHaveBeenCalled();
    expect(setupWebhookMock).not.toHaveBeenCalled();
    expect(updateConnectionMock).not.toHaveBeenCalled();
    expect(resolveSignatureMock).not.toHaveBeenCalled();
  });

  it("uses one lease for label, webhook, activation, and signature refresh", async () => {
    let leaseCheckpoint: ReturnType<typeof vi.fn> | null = null;
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: ReturnType<typeof vi.fn>) => unknown;
      }) => {
        leaseCheckpoint = vi.fn(async () => undefined);
        return { acquired: true, value: await run(leaseCheckpoint) };
      }
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(runWithEmailConnectionSyncLockMock).toHaveBeenCalledTimes(1);
    expect(runWithEmailConnectionSyncLockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "connection-1",
        context: "email-activation",
      })
    );
    expect(listLabelsMock).toHaveBeenCalledTimes(1);
    expect(setupWebhookMock).toHaveBeenCalledTimes(1);
    expect(updateConnectionMock).toHaveBeenCalledTimes(1);
    expect(resolveSignatureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        refreshProviderIfMissing: true,
        providerLockCheckpoint: leaseCheckpoint,
      })
    );
    expect(leaseCheckpoint).not.toBeNull();
    expect(leaseCheckpoint!).toHaveBeenCalled();
  });

  it("durably claims Microsoft 365 webhook setup with the canonical actor", async () => {
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "microsoft365",
      type: "individual",
      userId: "user-1",
      email: "operator@example.com",
      syncFilters: {},
      webhookSubscriptionId: null,
      webhookExpiresAt: null,
      webhookClientStateHash: null,
    });
    setupWebhookMock.mockResolvedValue({
      subscriptionId: "subscription-1",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      clientState: "secret-client-state",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mutationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        connectionId: "connection-1",
        operationKind: "webhook_setup",
        operationKey: expect.stringContaining("m365-webhook-setup:"),
        requestFingerprint: "f".repeat(64),
      })
    );
    expect(setupWebhookMock).toHaveBeenCalledOnce();
    expect(updateConnectionMock).toHaveBeenCalledWith("connection-1", {
      webhookSubscriptionId: "subscription-1",
      webhookExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      webhookClientStateHash: "state-hash",
    });
  });
});
