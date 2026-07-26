import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  CronDatabaseOperationError,
  expiredRows,
  queryLimits,
  autoResumeMock,
  runWithCronWorkloadControlMock,
  serviceClient,
} = vi.hoisted(() => {
  class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  }
  return {
    CronDatabaseOperationError,
    expiredRows: [] as Array<{ scope: string }>,
    queryLimits: [] as number[],
    autoResumeMock: vi.fn(),
    runWithCronWorkloadControlMock: vi.fn(),
    serviceClient: { from: vi.fn() },
  };
});

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError,
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
}));

vi.mock("@/lib/email/pause", () => ({
  autoResume: autoResumeMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));

import { GET } from "@/app/api/cron/email/auto-resume/route";

function request() {
  return new NextRequest("https://ops.test/api/cron/email/auto-resume", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("email auto-resume cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    expiredRows.splice(
      0,
      expiredRows.length,
      { scope: "global" },
      { scope: "bucket:dispatch" }
    );
    queryLimits.length = 0;
    vi.clearAllMocks();
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    autoResumeMock.mockResolvedValue(undefined);
    serviceClient.from.mockImplementation(() => {
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        lt: () => query,
        order: () => query,
        limit: async (limit: number) => {
          queryLimits.push(limit);
          return { data: expiredRows.slice(0, limit), error: null };
        },
      };
      return query;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("runs an ordered batch of at most 25 scopes inside one workload lease", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(queryLimits).toEqual([25]);
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceClient,
        workloadKey: "email-auto-resume",
        leaseSeconds: 120,
        work: expect.any(Function),
      })
    );
    expect(autoResumeMock).toHaveBeenNthCalledWith(1, "global", {
      abortOnDatabaseError: true,
    });
    expect(autoResumeMock).toHaveBeenNthCalledWith(2, "bucket:dispatch", {
      abortOnDatabaseError: true,
    });
  });

  it("launches no work while an overlapping run holds the lease", async () => {
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
    expect(serviceClient.from).not.toHaveBeenCalled();
    expect(autoResumeMock).not.toHaveBeenCalled();
  });

  it("aborts remaining scopes after a typed database error", async () => {
    autoResumeMock.mockRejectedValueOnce(
      new CronDatabaseOperationError("resume update failed", {
        cause: { code: "53300", message: "remaining connection slots" },
      })
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(autoResumeMock).toHaveBeenCalledTimes(1);
  });

  it("isolates an ordinary business failure and continues later scopes", async () => {
    autoResumeMock
      .mockRejectedValueOnce(new Error("scope no longer paused"))
      .mockResolvedValueOnce(undefined);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      checked: 2,
      resumed: ["bucket:dispatch"],
      failures: [
        {
          scope: "global",
          error: "scope no longer paused",
        },
      ],
    });
    expect(autoResumeMock).toHaveBeenCalledTimes(2);
  });
});
