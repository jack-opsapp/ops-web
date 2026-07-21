import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  afterError: null as Error | null,
  acquireLock: vi.fn(),
  client: null as unknown,
  enqueue: vi.fn(),
  fetchGmailRead: vi.fn(),
  prepareHistoricalBody: vi.fn(),
  releaseLock: vi.fn(),
  renewLock: vi.fn(),
  jobInsertError: null as { message: string } | null,
  progressSelectErrors: [] as Array<{ message: string } | null>,
  progressUpdateErrors: [] as Array<{ message: string } | null>,
  jobUpdates: [] as Array<{
    payload: Record<string, unknown>;
    error: { message: string } | null;
  }>,
  notificationRows: [] as Array<Record<string, unknown>>,
  currentResult: {} as Record<string, unknown>,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => Promise<void>) => {
      if (mocks.afterError) throw mocks.afterError;
      mocks.afterCallbacks.push(callback);
    },
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.client,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: (_client: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn().mockResolvedValue({
    uid: "firebase-user-1",
    email: "operator@example.com",
  }),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn().mockResolvedValue({
    id: "user-1",
    company_id: "company-1",
  }),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: vi.fn().mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      accessToken: "read-only-token",
      type: "individual",
      userId: "user-1",
    }),
    getConnections: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  isPersonalHistoricalLearningConnection: vi.fn().mockReturnValue(true),
  prepareHistoricalOutboundBodyForLearning: (...args: unknown[]) =>
    mocks.prepareHistoricalBody(...args),
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled(...args: unknown[]) {
      return mocks.enqueue(...args);
    }
  },
}));

vi.mock("@/lib/api/services/providers/gmail-read", () => ({
  fetchGmailRead: (...args: unknown[]) => mocks.fetchGmailRead(...args),
}));

vi.mock("@/lib/api/services/providers/gmail-provider", () => ({
  GmailProvider: class {
    async getValidAccessToken() {
      return "read-only-token";
    }
  },
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  acquireEmailConnectionSyncLock: (...args: unknown[]) =>
    mocks.acquireLock(...args),
  createEmailConnectionSyncLockRenewer: () =>
    Object.assign((...args: unknown[]) => mocks.renewLock(...args), {
      stop: vi.fn(async () => undefined),
    }),
  releaseEmailConnectionSyncLock: (...args: unknown[]) =>
    mocks.releaseLock(...args),
}));

function gmailListResponse(): Response {
  return Response.json({ messages: [{ id: "message-1" }] });
}

function gmailMessageResponse(): Response {
  return Response.json({
    id: "message-1",
    threadId: "thread-1",
    internalDate: "1710000000000",
    labelIds: ["SENT"],
    snippet: "A sufficiently long outbound message",
    payload: {
      headers: [
        { name: "From", value: "operator@example.com" },
        { name: "To", value: "customer@example.com" },
        { name: "Subject", value: "Estimate details" },
      ],
      mimeType: "text/plain",
      body: {
        data: Buffer.from(
          "Here are the requested estimate details for your project."
        ).toString("base64url"),
      },
    },
  });
}

function makeClient() {
  return {
    from(table: string) {
      if (table === "gmail_scan_jobs") {
        return {
          insert: (_payload: Record<string, unknown>) => ({
            select: (_columns: string) => ({
              single: async () => ({
                data: mocks.jobInsertError ? null : { id: "job-1" },
                error: mocks.jobInsertError,
              }),
            }),
          }),
          select: (_columns: string) => ({
            eq: (_column: string, _value: string) => ({
              single: async () => {
                const error = mocks.progressSelectErrors.length
                  ? mocks.progressSelectErrors.shift()!
                  : null;
                return {
                  data: error ? null : { result: mocks.currentResult },
                  error,
                };
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async (_column: string, _value: string) => {
              const error = mocks.progressUpdateErrors.length
                ? mocks.progressUpdateErrors.shift()!
                : null;
              mocks.jobUpdates.push({ payload, error });
              if (!error && payload.result) {
                mocks.currentResult = payload.result as Record<string, unknown>;
              }
              return { error };
            },
          }),
        };
      }

      if (table === "users") {
        return {
          select: (_columns: string) => ({
            eq: async (_column: string, _value: string) => ({
              data: [{ email: "operator@example.com" }],
              error: null,
            }),
          }),
        };
      }

      if (table === "notifications") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            mocks.notificationRows.push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function postRequest(): Request {
  return new Request("http://localhost/api/integrations/ai-setup/email-scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connectionId: "connection-1" }),
  });
}

function getRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/integrations/ai-setup/email-scan?jobId=00000000-0000-4000-8000-000000000001"
  );
}

function progressStatuses(): Array<string | undefined> {
  return mocks.jobUpdates.map(({ payload }) => {
    const result = payload.result as
      | { emailScanProgress?: { status?: string } }
      | undefined;
    return result?.emailScanProgress?.status;
  });
}

function lastProgress(): Record<string, unknown> | undefined {
  const payload = mocks.jobUpdates.at(-1)?.payload;
  const result = payload?.result as
    | { emailScanProgress?: Record<string, unknown> }
    | undefined;
  return result?.emailScanProgress;
}

async function startAndRunBackgroundJob() {
  const { POST } =
    await import("@/app/api/integrations/ai-setup/email-scan/route");
  const response = await POST(postRequest() as never);
  expect(response.status).toBe(200);
  expect(mocks.afterCallbacks).toHaveLength(1);
  await mocks.afterCallbacks[0]();
}

describe("Phase C email history scan durability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.afterError = null;
    mocks.acquireLock.mockResolvedValue("lock-owner-1");
    mocks.jobInsertError = null;
    mocks.progressSelectErrors.length = 0;
    mocks.progressUpdateErrors.length = 0;
    mocks.jobUpdates.length = 0;
    mocks.notificationRows.length = 0;
    mocks.currentResult = {
      emailScanProgress: {
        status: "pending",
        total: 0,
        processed: 0,
        factsExtracted: 0,
        entitiesCreated: 0,
        profileUpdates: 0,
        startedAt: "2026-07-21T00:00:00.000Z",
      },
    };
    mocks.client = makeClient();
    mocks.fetchGmailRead
      .mockResolvedValueOnce(gmailListResponse())
      .mockResolvedValueOnce(gmailMessageResponse());
    mocks.prepareHistoricalBody.mockResolvedValue({
      authoredBody: "Here are the requested estimate details.",
      cleanBody: "Here are the requested estimate details.",
      exactSignatureRemoved: true,
    });
    mocks.enqueue.mockResolvedValue({ id: "learning-job-1" });
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.renewLock.mockResolvedValue(undefined);
  });

  it("does not start or read Gmail while another mailbox operation owns the lease", async () => {
    mocks.acquireLock.mockResolvedValue(null);

    const { POST } =
      await import("@/app/api/integrations/ai-setup/email-scan/route");
    const response = await POST(postRequest() as never);

    expect(response.status).toBe(409);
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.fetchGmailRead).not.toHaveBeenCalled();
    expect(mocks.releaseLock).not.toHaveBeenCalled();
  });

  it("fails closed when polling cannot read durable scan progress", async () => {
    mocks.progressSelectErrors.push({ message: "progress read failed" });

    const { GET } =
      await import("@/app/api/integrations/ai-setup/email-scan/route");
    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Couldn't load scan progress. Try again.",
    });
  });

  it("rejects the start when the durable job insert fails", async () => {
    mocks.jobInsertError = { message: "job insert failed" };

    const { POST } =
      await import("@/app/api/integrations/ai-setup/email-scan/route");
    const response = await POST(postRequest() as never);

    expect(response.status).toBe(500);
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("marks the inserted job failed when after() registration fails", async () => {
    mocks.afterError = new Error("background registration unavailable");

    const { POST } =
      await import("@/app/api/integrations/ai-setup/email-scan/route");
    const response = await POST(postRequest() as never);

    expect(response.status).toBe(500);
    expect(progressStatuses()).toEqual(["error"]);
    expect(lastProgress()).toMatchObject({
      status: "error",
      error: "background registration unavailable",
    });
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("marks the job error without counting or completing when enqueue fails", async () => {
    mocks.enqueue.mockRejectedValue(new Error("enqueue failed"));

    await startAndRunBackgroundJob();

    expect(progressStatuses()).toEqual(["scanning", "processing", "error"]);
    expect(lastProgress()).toMatchObject({ status: "error", processed: 0 });
    expect(mocks.notificationRows).toHaveLength(0);
  });

  it("marks the job error when historical body or signature preparation fails", async () => {
    mocks.prepareHistoricalBody.mockRejectedValue(
      new Error("signature preparation failed")
    );

    await startAndRunBackgroundJob();

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(progressStatuses()).toEqual(["scanning", "processing", "error"]);
    expect(lastProgress()).toMatchObject({ status: "error", processed: 0 });
    expect(mocks.notificationRows).toHaveLength(0);
  });

  it("keeps an exact-signature miss as a deterministic safe skip", async () => {
    mocks.prepareHistoricalBody.mockResolvedValue({
      authoredBody: "Unchanged body",
      cleanBody: "Unchanged body",
      exactSignatureRemoved: false,
    });

    await startAndRunBackgroundJob();

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(progressStatuses()).toEqual([
      "scanning",
      "processing",
      "processing",
      "complete",
    ]);
    expect(mocks.notificationRows).toHaveLength(1);
  });

  it("stops before Gmail reads and records an error when a progress select fails", async () => {
    mocks.progressSelectErrors.push({ message: "progress read failed" }, null);

    await startAndRunBackgroundJob();

    expect(mocks.fetchGmailRead).not.toHaveBeenCalled();
    expect(progressStatuses()).toEqual(["error"]);
    expect(mocks.notificationRows).toHaveLength(0);
  });

  it("stops before Gmail reads and records an error when a progress write fails", async () => {
    mocks.progressUpdateErrors.push({ message: "progress write failed" }, null);

    await startAndRunBackgroundJob();

    expect(mocks.fetchGmailRead).not.toHaveBeenCalled();
    expect(progressStatuses()).toEqual(["scanning", "error"]);
    expect(mocks.notificationRows).toHaveLength(0);
  });

  it("does not notify or log completion when the final complete write fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.progressUpdateErrors.push(
      null,
      null,
      null,
      { message: "final complete write failed" },
      null
    );

    await startAndRunBackgroundJob();

    expect(progressStatuses()).toEqual([
      "scanning",
      "processing",
      "processing",
      "complete",
      "error",
    ]);
    expect(mocks.jobUpdates[3].error).toEqual({
      message: "final complete write failed",
    });
    expect(mocks.notificationRows).toHaveLength(0);
    expect(logSpy.mock.calls.flat().join(" ")).not.toContain(
      "[email-scan] Complete"
    );
    logSpy.mockRestore();
  });

  it("rejects the background task when even the durable error state cannot be written", async () => {
    mocks.enqueue.mockRejectedValue(new Error("enqueue failed"));
    mocks.progressUpdateErrors.push(null, null, {
      message: "error state write failed",
    });

    const { POST } =
      await import("@/app/api/integrations/ai-setup/email-scan/route");
    const response = await POST(postRequest() as never);
    expect(response.status).toBe(200);

    await expect(mocks.afterCallbacks[0]()).rejects.toThrow(
      "error state write failed"
    );
  });
});
