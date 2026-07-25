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
  runWithCronWorkloadControlMock,
  readCronWorkloadCursorMock,
  advanceCronWorkloadCursorMock,
  CronDatabaseOperationError,
  queryState,
} = vi.hoisted(() => {
  class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  }
  const connectionRows = [
    {
      id: "connection-1",
      provider: "gmail",
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_client_state_hash: null,
    },
  ];
  const queryState = {
    error: null as { code?: string; message: string } | null,
    eqs: [] as Array<[string, unknown]>,
    ors: [] as string[],
    orders: [] as Array<[string, unknown]>,
    limits: [] as number[],
    gts: [] as Array<[string, unknown]>,
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    gt: vi.fn(),
    then: (
      resolve: (value: {
        data: typeof connectionRows;
        error: typeof queryState.error;
      }) => unknown
    ) =>
      Promise.resolve({
        data: connectionRows,
        error: queryState.error,
      }).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockImplementation((column: string, value: unknown) => {
    queryState.eqs.push([column, value]);
    return query;
  });
  query.or.mockImplementation((filter: string) => {
    queryState.ors.push(filter);
    return query;
  });
  query.order.mockImplementation((column: string, options: unknown) => {
    queryState.orders.push([column, options]);
    return query;
  });
  query.limit.mockImplementation((limit: number) => {
    queryState.limits.push(limit);
    return query;
  });
  query.gt.mockImplementation((column: string, value: unknown) => {
    queryState.gts.push([column, value]);
    return query;
  });
  return {
    CronDatabaseOperationError,
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
    runWithCronWorkloadControlMock: vi.fn(),
    readCronWorkloadCursorMock: vi.fn(),
    advanceCronWorkloadCursorMock: vi.fn(),
    queryState,
  };
});

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError,
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
}));

vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: readCronWorkloadCursorMock,
  advanceCronWorkloadCursor: advanceCronWorkloadCursorMock,
}));

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

const workloadLease = {
  ownerToken: "webhook-renewal-test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  vi.clearAllMocks();
  connectionRows.splice(1);
  queryState.error = null;
  queryState.eqs.length = 0;
  queryState.ors.length = 0;
  queryState.orders.length = 0;
  queryState.limits.length = 0;
  queryState.gts.length = 0;
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
  runWithCronWorkloadControlMock.mockImplementation(
    async ({
      work,
    }: {
      work: (lease: typeof workloadLease) => Promise<unknown>;
    }) => ({
      status: "completed",
      value: await work(workloadLease),
    })
  );
  readCronWorkloadCursorMock.mockResolvedValue(null);
  advanceCronWorkloadCursorMock.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("webhook renewal mailbox lease", () => {
  it("server-filters only due connections and rotates a ten-row cursor", async () => {
    readCronWorkloadCursorMock.mockResolvedValue("connection-0");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(queryState.eqs).toEqual(
      expect.arrayContaining([
        ["sync_enabled", true],
        ["status", "active"],
      ])
    );
    expect(queryState.ors).toHaveLength(1);
    expect(queryState.ors[0]).toContain("webhook_subscription_id.is.null");
    expect(queryState.ors[0]).toContain("webhook_expires_at.lt.");
    expect(queryState.ors[0]).toContain(
      "and(provider.eq.microsoft365,webhook_client_state_hash.is.null)"
    );
    expect(queryState.gts).toEqual([["id", "connection-0"]]);
    expect(queryState.limits).toEqual([10]);
    expect(advanceCronWorkloadCursorMock).toHaveBeenCalledWith(
      serviceClient,
      "email-webhook-renewal",
      workloadLease,
      "connection-0",
      null
    );
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceClient,
        workloadKey: "email-webhook-renewal",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
  });

  it("launches no query or provider work while another run holds the lease", async () => {
    runWithCronWorkloadControlMock.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(readCronWorkloadCursorMock).not.toHaveBeenCalled();
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("aborts provider work and cursor advancement after a database query failure", async () => {
    queryState.error = {
      code: "53300",
      message: "remaining connection slots",
    };

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(advanceCronWorkloadCursorMock).not.toHaveBeenCalled();
  });

  it("isolates a provider timeout and continues the next due connection", async () => {
    connectionRows.push({
      id: "connection-2",
      provider: "gmail",
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_client_state_hash: null,
    });
    getConnectionMock.mockImplementation(async (id: string) => ({
      id,
      companyId: id === "connection-1" ? "company-1" : "company-2",
      provider: "gmail",
      webhookClientStateHash: null,
    }));
    setupWebhookMock
      .mockRejectedValueOnce({ status: 504, message: "Gmail timeout" })
      .mockResolvedValueOnce({
        subscriptionId: "watch-2",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        clientState: null,
      });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      renewed: 1,
      results: [
        expect.objectContaining({
          id: "connection-1",
          renewed: false,
        }),
        expect.objectContaining({
          id: "connection-2",
          renewed: true,
        }),
      ],
    });
    expect(setupWebhookMock).toHaveBeenCalledTimes(2);
    expect(advanceCronWorkloadCursorMock).toHaveBeenCalledOnce();
  });

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
