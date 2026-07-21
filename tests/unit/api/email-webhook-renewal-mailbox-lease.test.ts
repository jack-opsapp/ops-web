import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getConnectionMock,
  getProviderMock,
  updateConnectionMock,
  setupWebhookMock,
  renewWebhookMock,
  runWithEmailConnectionSyncLockMock,
  serviceClient,
  connectionRows,
  createMutationServiceMock,
  mutationExecuteMock,
  buildMutationFingerprintMock,
} = vi.hoisted(() => {
  const connectionRows = [
    {
      id: "connection-1",
      provider: "gmail",
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_client_state_hash: null,
    },
  ];
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    then: (
      resolve: (value: { data: typeof connectionRows; error: null }) => unknown
    ) => Promise.resolve({ data: connectionRows, error: null }).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    getConnectionMock: vi.fn(),
    getProviderMock: vi.fn(),
    updateConnectionMock: vi.fn(),
    setupWebhookMock: vi.fn(),
    renewWebhookMock: vi.fn(),
    runWithEmailConnectionSyncLockMock: vi.fn(),
    serviceClient: { from: vi.fn(() => query) },
    connectionRows,
    createMutationServiceMock: vi.fn(),
    mutationExecuteMock: vi.fn(),
    buildMutationFingerprintMock: vi.fn(() => "f".repeat(64)),
  };
});

vi.mock("@/lib/api/services/email-provider-mutation-attempt-service", () => ({
  buildEmailProviderMutationFingerprint: buildMutationFingerprintMock,
  createEmailProviderMutationAttemptService: createMutationServiceMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: vi.fn(() => serviceClient),
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

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

vi.mock("@/lib/email/microsoft365-webhook-security", () => ({
  hashMicrosoft365ClientState: vi.fn(async () => "state-hash"),
}));

import { GET } from "@/app/api/cron/webhook-renewal/route";

function request() {
  return new NextRequest("https://ops.test/api/cron/webhook-renewal", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  vi.clearAllMocks();
  Object.assign(connectionRows[0], {
    id: "connection-1",
    provider: "gmail",
    webhook_subscription_id: null,
    webhook_expires_at: null,
    webhook_client_state_hash: null,
  });
  getConnectionMock.mockResolvedValue({
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    webhookClientStateHash: null,
  });
  setupWebhookMock.mockResolvedValue({
    subscriptionId: "watch-1",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    clientState: null,
  });
  renewWebhookMock.mockResolvedValue({
    subscriptionId: "watch-1",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    clientState: null,
  });
  getProviderMock.mockReturnValue({
    setupWebhook: setupWebhookMock,
    renewWebhook: renewWebhookMock,
  });
  updateConnectionMock.mockResolvedValue(undefined);
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

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("webhook renewal mailbox lease", () => {
  it("fails the mailbox busy without constructing or calling a provider", async () => {
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      renewed: 0,
      results: [
        {
          id: "connection-1",
          provider: "gmail",
          renewed: false,
          error: "EMAIL_WEBHOOK_RENEWAL_MAILBOX_BUSY",
        },
      ],
    });
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(setupWebhookMock).not.toHaveBeenCalled();
    expect(renewWebhookMock).not.toHaveBeenCalled();
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("checkpoints webhook setup and persistence under one mailbox lease", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runWithEmailConnectionSyncLockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "connection-1",
        context: "email-webhook-renewal",
        client: serviceClient,
      })
    );
    expect(setupWebhookMock).toHaveBeenCalledTimes(1);
    expect(updateConnectionMock).toHaveBeenCalledTimes(1);
  });

  it("durably fences Microsoft 365 webhook setup without a human actor", async () => {
    Object.assign(connectionRows[0], {
      provider: "microsoft365",
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_client_state_hash: null,
    });
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "microsoft365",
      webhookClientStateHash: null,
    });
    setupWebhookMock.mockResolvedValue({
      subscriptionId: "subscription-1",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      clientState: "secret-client-state",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mutationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        operationKind: "webhook_setup",
        operationKey: expect.stringContaining("m365-webhook-setup:"),
      })
    );
    expect(setupWebhookMock).toHaveBeenCalledOnce();
  });

  it("keys each Microsoft 365 renewal to the exact subscription expiry generation", async () => {
    Object.assign(connectionRows[0], {
      provider: "microsoft365",
      webhook_subscription_id: "subscription-1",
      webhook_expires_at: "2026-07-21T00:00:00.000Z",
      webhook_client_state_hash: "prior-state-hash",
    });
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "microsoft365",
      webhookClientStateHash: "prior-state-hash",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mutationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        operationKind: "webhook_renewal",
        operationKey:
          "m365-webhook-renew:subscription-1:2026-07-21T00:00:00.000Z",
      })
    );
    expect(renewWebhookMock).toHaveBeenCalledWith("subscription-1");
    expect(setupWebhookMock).not.toHaveBeenCalled();
  });
});
