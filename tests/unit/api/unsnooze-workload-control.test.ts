import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  CronDatabaseOperationError,
  dueRows,
  queryLimits,
  unsnoozeMock,
  runWithCronWorkloadControlMock,
  runWithSupabaseMock,
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
    dueRows: [] as Array<{ id: string }>,
    queryLimits: [] as number[],
    unsnoozeMock: vi.fn(),
    runWithCronWorkloadControlMock: vi.fn(),
    runWithSupabaseMock: vi.fn(),
    serviceClient: { from: vi.fn() },
  };
});

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError,
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { unsnooze: unsnoozeMock },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));

import { GET } from "@/app/api/cron/unsnooze/route";

function request() {
  return new NextRequest("https://ops.test/api/cron/unsnooze", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("unsnooze workload control", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    dueRows.splice(0, dueRows.length, { id: "thread-1" }, { id: "thread-2" });
    queryLimits.length = 0;
    vi.clearAllMocks();
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    runWithSupabaseMock.mockImplementation(
      async (_client: unknown, work: () => Promise<unknown>) => work()
    );
    unsnoozeMock.mockResolvedValue(undefined);
    serviceClient.from.mockImplementation(() => {
      const query = {
        select: () => query,
        not: () => query,
        lte: () => query,
        is: () => query,
        order: () => query,
        limit: async (limit: number) => {
          queryLimits.push(limit);
          return { data: dueRows.slice(0, limit), error: null };
        },
      };
      return query;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("runs one ordered batch of at most ten threads inside the workload lease", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(queryLimits).toEqual([10]);
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceClient,
        workloadKey: "email-unsnooze",
        leaseSeconds: 120,
        work: expect.any(Function),
      })
    );
    expect(unsnoozeMock.mock.calls.map(([threadId]) => threadId)).toEqual([
      "thread-1",
      "thread-2",
    ]);
  });

  it("launches no work when an overlapping cron holds the lease", async () => {
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
    expect(unsnoozeMock).not.toHaveBeenCalled();
  });

  it("aborts queued threads after a typed database failure", async () => {
    unsnoozeMock.mockRejectedValueOnce(
      new CronDatabaseOperationError("thread read failed", {
        cause: { code: "53300", message: "remaining connection slots" },
      })
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(unsnoozeMock).toHaveBeenCalledTimes(1);
  });

  it("isolates an ordinary provider timeout and continues the batch", async () => {
    unsnoozeMock
      .mockRejectedValueOnce({ status: 504, message: "Gmail timeout" })
      .mockResolvedValueOnce(undefined);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      processed: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(unsnoozeMock).toHaveBeenCalledTimes(2);
  });
});
