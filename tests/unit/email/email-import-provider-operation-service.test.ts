import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailConnection } from "@/lib/types/email-connection";

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async <T>(
    _client: unknown,
    callback: () => Promise<T>
  ): Promise<T> => callback(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: vi.fn(),
    getProvider: vi.fn(),
  },
}));

import {
  EmailImportProviderOperationService,
  createSupabaseEmailImportProviderOperationStore,
  type ClaimedEmailImportProviderOperation,
  type EmailImportProviderLabelTransport,
} from "@/lib/api/services/email-import-provider-operation-service";

const operation: ClaimedEmailImportProviderOperation = {
  id: "operation-1",
  importJobId: "import-job-1",
  companyId: "company-1",
  connectionId: "connection-2",
  providerThreadId: "provider-thread-exact",
  attemptCount: 1,
};

function connection(overrides: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: "connection-2",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "shared@canpro.ca",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date("2026-07-16T00:00:00.000Z"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: "label-existing",
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    ...overrides,
  };
}

function makeHarness(input?: {
  claimed?: ClaimedEmailImportProviderOperation[];
  loadedConnection?: EmailConnection | null;
  authorizeResult?: boolean;
  completeResult?: boolean;
  failResult?: boolean;
}) {
  const sendEmail = vi.fn();
  const listLabels = vi.fn(async () => [
    { id: "label-listed", name: "OPS Pipeline", type: "user" },
  ]);
  const createLabel = vi.fn(async () => "label-created");
  const applyLabel = vi.fn(async () => undefined);
  const transport: EmailImportProviderLabelTransport & {
    sendEmail: typeof sendEmail;
  } = { listLabels, createLabel, applyLabel, sendEmail };
  const claim = vi.fn(async () => input?.claimed ?? [operation]);
  const authorize = vi.fn(async () => input?.authorizeResult ?? true);
  const loadConnection = vi.fn(async () =>
    input?.loadedConnection === undefined
      ? connection()
      : input.loadedConnection
  );
  const getLabelTransport = vi.fn(() => transport);
  const persistOpsLabelId = vi.fn(async () => "label-listed");
  const complete = vi.fn(async () => input?.completeResult ?? true);
  const fail = vi.fn(async () => input?.failResult ?? true);

  const service = new EmailImportProviderOperationService({
    claim,
    authorize,
    loadConnection,
    getLabelTransport,
    persistOpsLabelId,
    complete,
    fail,
    workerId: () => "00000000-0000-4000-8000-000000000024",
  });

  return {
    service,
    claim,
    authorize,
    loadConnection,
    getLabelTransport,
    persistOpsLabelId,
    complete,
    fail,
    listLabels,
    createLabel,
    applyLabel,
    sendEmail,
  };
}

describe("EmailImportProviderOperationService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses only the claimed mailbox and exact provider thread", async () => {
    const harness = makeHarness();

    const result = await harness.service.process({
      limit: 5,
      leaseSeconds: 300,
    });

    expect(harness.claim).toHaveBeenCalledWith({
      holder: "00000000-0000-4000-8000-000000000024",
      limit: 5,
      leaseSeconds: 300,
    });
    expect(harness.loadConnection).toHaveBeenCalledWith("connection-2");
    expect(harness.authorize).toHaveBeenNthCalledWith(1, {
      operationId: "operation-1",
      holder: "00000000-0000-4000-8000-000000000024",
    });
    expect(harness.authorize).toHaveBeenNthCalledWith(2, {
      operationId: "operation-1",
      holder: "00000000-0000-4000-8000-000000000024",
    });
    expect(harness.getLabelTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "connection-2",
        companyId: "company-1",
      })
    );
    expect(harness.applyLabel).toHaveBeenCalledWith(
      "provider-thread-exact",
      "label-existing"
    );
    expect(harness.complete).toHaveBeenCalledWith({
      operationId: "operation-1",
      holder: "00000000-0000-4000-8000-000000000024",
      providerLabelId: "label-existing",
    });
    expect(harness.listLabels).not.toHaveBeenCalled();
    expect(harness.createLabel).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({
      claimed: 1,
      applied: 1,
      failed: 0,
      staleCompletions: 0,
      staleFailures: 0,
      errors: [],
    });
  });

  it("fails before any provider access when the claimed operation is no longer authorized", async () => {
    const harness = makeHarness({ authorizeResult: false });

    const result = await harness.service.process();

    expect(harness.authorize).toHaveBeenCalledTimes(1);
    expect(harness.getLabelTransport).not.toHaveBeenCalled();
    expect(harness.listLabels).not.toHaveBeenCalled();
    expect(harness.createLabel).not.toHaveBeenCalled();
    expect(harness.applyLabel).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith({
      operationId: "operation-1",
      holder: "00000000-0000-4000-8000-000000000024",
      error: "EMAIL_IMPORT_PROVIDER_OPERATION_FORBIDDEN",
    });
    expect(result.failed).toBe(1);
  });

  it("reauthorizes after label discovery and does not mutate the thread after access changes", async () => {
    const harness = makeHarness({
      loadedConnection: connection({ opsLabelId: null }),
    });
    harness.authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await harness.service.process();

    expect(harness.authorize).toHaveBeenCalledTimes(2);
    expect(harness.listLabels).toHaveBeenCalledTimes(1);
    expect(harness.applyLabel).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith({
      operationId: "operation-1",
      holder: "00000000-0000-4000-8000-000000000024",
      error: "EMAIL_IMPORT_PROVIDER_OPERATION_FORBIDDEN",
    });
    expect(result.failed).toBe(1);
  });

  it("discovers and persists the OPS label before applying it", async () => {
    const harness = makeHarness({
      loadedConnection: connection({ opsLabelId: null }),
    });

    await harness.service.process();

    expect(harness.listLabels).toHaveBeenCalledTimes(1);
    expect(harness.createLabel).not.toHaveBeenCalled();
    expect(harness.persistOpsLabelId).toHaveBeenCalledWith({
      connectionId: "connection-2",
      companyId: "company-1",
      providerLabelId: "label-listed",
    });
    expect(harness.applyLabel).toHaveBeenCalledWith(
      "provider-thread-exact",
      "label-listed"
    );
  });

  it("creates the OPS label only when the exact mailbox does not have one", async () => {
    const harness = makeHarness({
      loadedConnection: connection({ opsLabelId: null }),
    });
    harness.listLabels.mockResolvedValue([]);
    harness.persistOpsLabelId.mockResolvedValue("label-created");

    await harness.service.process();

    expect(harness.createLabel).toHaveBeenCalledWith("OPS Pipeline");
    expect(harness.persistOpsLabelId).toHaveBeenCalledWith({
      connectionId: "connection-2",
      companyId: "company-1",
      providerLabelId: "label-created",
    });
    expect(harness.applyLabel).toHaveBeenCalledWith(
      "provider-thread-exact",
      "label-created"
    );
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a different connection",
      loadedConnection: connection({ id: "connection-other" }),
    },
    {
      name: "a different company",
      loadedConnection: connection({ companyId: "company-other" }),
    },
    {
      name: "a disabled mailbox",
      loadedConnection: connection({
        syncEnabled: false,
        status: "disconnected",
      }),
    },
  ])(
    "fails durably before provider access for $name",
    async ({ loadedConnection }) => {
      const harness = makeHarness({ loadedConnection });

      const result = await harness.service.process();

      expect(harness.getLabelTransport).not.toHaveBeenCalled();
      expect(harness.applyLabel).not.toHaveBeenCalled();
      expect(harness.sendEmail).not.toHaveBeenCalled();
      expect(harness.complete).not.toHaveBeenCalled();
      expect(harness.fail).toHaveBeenCalledWith({
        operationId: "operation-1",
        holder: "00000000-0000-4000-8000-000000000024",
        error: expect.stringContaining(
          "EMAIL_IMPORT_PROVIDER_CONNECTION_INVALID"
        ),
      });
      expect(result.failed).toBe(1);
    }
  );

  it("records provider failures without completing or sending", async () => {
    const harness = makeHarness();
    harness.applyLabel.mockRejectedValue(new Error("provider unavailable"));

    const result = await harness.service.process();

    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith({
      operationId: "operation-1",
      holder: "00000000-0000-4000-8000-000000000024",
      error: "provider unavailable",
    });
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      { operationId: "operation-1", error: "provider unavailable" },
    ]);
  });

  it("treats a stale completion as durable retry work without a second provider call", async () => {
    const harness = makeHarness({ completeResult: false });

    const result = await harness.service.process();

    expect(harness.applyLabel).toHaveBeenCalledTimes(1);
    expect(harness.fail).not.toHaveBeenCalled();
    expect(result).toEqual({
      claimed: 1,
      applied: 0,
      failed: 0,
      staleCompletions: 1,
      staleFailures: 0,
      errors: [
        {
          operationId: "operation-1",
          error: "EMAIL_IMPORT_PROVIDER_COMPLETION_STALE",
        },
      ],
    });
  });

  it("retries only durable completion when the provider label was already applied", async () => {
    const harness = makeHarness();
    harness.complete
      .mockRejectedValueOnce(new Error("database response lost"))
      .mockResolvedValueOnce(true);

    const result = await harness.service.process();

    expect(harness.applyLabel).toHaveBeenCalledTimes(1);
    expect(harness.complete).toHaveBeenCalledTimes(2);
    expect(harness.fail).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("reports a stale failure lease without attempting completion", async () => {
    const harness = makeHarness({ failResult: false });
    harness.applyLabel.mockRejectedValue(new Error("provider unavailable"));

    const result = await harness.service.process();

    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
    expect(result.staleFailures).toBe(1);
    expect(result.errors).toEqual([
      {
        operationId: "operation-1",
        error:
          "provider unavailable; EMAIL_IMPORT_PROVIDER_FAILURE_WRITE_STALE",
      },
    ]);
  });
});

describe("Supabase email import provider operation store", () => {
  it("uses only the 176000 lifecycle RPCs for claims and lease transitions", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_email_import_provider_operations") {
        return {
          data: [
            {
              id: "operation-1",
              import_job_id: "import-job-1",
              company_id: "company-1",
              connection_id: "connection-2",
              provider_thread_id: "provider-thread-exact",
              operation_type: "apply_pipeline_label",
              status: "processing",
              attempt_count: 4,
              lease_holder: "00000000-0000-4000-8000-000000000024",
              lease_expires_at: "2026-07-15T01:00:00.000Z",
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    const supabase = { rpc } as never;
    const store = createSupabaseEmailImportProviderOperationStore(supabase);

    await expect(
      store.claim({
        holder: "00000000-0000-4000-8000-000000000024",
        limit: 5,
        leaseSeconds: 300,
      })
    ).resolves.toEqual([
      {
        id: "operation-1",
        importJobId: "import-job-1",
        companyId: "company-1",
        connectionId: "connection-2",
        providerThreadId: "provider-thread-exact",
        attemptCount: 4,
      },
    ]);
    await expect(
      store.authorize({
        operationId: "operation-1",
        holder: "00000000-0000-4000-8000-000000000024",
      })
    ).resolves.toBe(true);
    await expect(
      store.complete({
        operationId: "operation-1",
        holder: "00000000-0000-4000-8000-000000000024",
        providerLabelId: "label-1",
      })
    ).resolves.toBe(true);
    await expect(
      store.fail({
        operationId: "operation-1",
        holder: "00000000-0000-4000-8000-000000000024",
        error: "provider unavailable",
      })
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_email_import_provider_operations",
      {
        p_holder: "00000000-0000-4000-8000-000000000024",
        p_limit: 5,
        p_lease_seconds: 300,
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "authorize_email_import_provider_operation_as_system",
      {
        p_operation_id: "operation-1",
        p_holder: "00000000-0000-4000-8000-000000000024",
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "complete_email_import_provider_operation",
      {
        p_operation_id: "operation-1",
        p_holder: "00000000-0000-4000-8000-000000000024",
        p_provider_label_id: "label-1",
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      4,
      "fail_email_import_provider_operation",
      {
        p_operation_id: "operation-1",
        p_holder: "00000000-0000-4000-8000-000000000024",
        p_error: "provider unavailable",
      }
    );
  });

  it("fails closed when a claim response is missing the exact processing lease", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          id: "operation-1",
          import_job_id: "import-job-1",
          company_id: "company-1",
          connection_id: "connection-2",
          provider_thread_id: "provider-thread-exact",
          operation_type: "apply_pipeline_label",
          status: "processing",
          attempt_count: 1,
        },
      ],
      error: null,
    }));
    const store = createSupabaseEmailImportProviderOperationStore({
      rpc,
    } as never);

    await expect(
      store.claim({
        holder: "00000000-0000-4000-8000-000000000024",
        limit: 5,
        leaseSeconds: 300,
      })
    ).rejects.toThrow("EMAIL_IMPORT_PROVIDER_OPERATION_LEASE_INVALID");
  });
});
