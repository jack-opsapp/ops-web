import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getServiceRoleClientMock,
  setSupabaseOverrideMock,
  executeAutonomousActionMock,
  recoverApprovedActionEmailsMock,
  runWithCronWorkloadControlMock,
  serviceRoleClient,
  query,
} = vi.hoisted(() => {
  const queryBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    lte: vi.fn(),
    limit: vi.fn(),
  };
  queryBuilder.select.mockReturnValue(queryBuilder);
  queryBuilder.eq.mockReturnValue(queryBuilder);
  queryBuilder.not.mockReturnValue(queryBuilder);
  queryBuilder.lte.mockReturnValue(queryBuilder);
  return {
    getServiceRoleClientMock: vi.fn(),
    setSupabaseOverrideMock: vi.fn(),
    executeAutonomousActionMock: vi.fn(),
    recoverApprovedActionEmailsMock: vi.fn(),
    runWithCronWorkloadControlMock: vi.fn(),
    serviceRoleClient: { from: vi.fn(() => queryBuilder) },
    query: queryBuilder,
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));
vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: setSupabaseOverrideMock,
}));
vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: {
    executeAutonomousAction: executeAutonomousActionMock,
    recoverApprovedActionEmails: recoverApprovedActionEmailsMock,
  },
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: class CronDatabaseOperationError extends Error {},
  isDatabasePressureError: vi.fn(() => false),
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
}));

import { GET } from "@/app/api/cron/auto-execute-actions/route";

function request(): NextRequest {
  return new NextRequest("https://ops.test/api/cron/auto-execute-actions", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

describe("auto execute actions cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    getServiceRoleClientMock.mockReturnValue(serviceRoleClient);
    serviceRoleClient.from.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.limit.mockReset().mockResolvedValue({
      data: [{ id: "action-1" }, { id: "action-2" }],
      error: null,
    });
    executeAutonomousActionMock.mockReset();
    recoverApprovedActionEmailsMock.mockReset().mockResolvedValue({
      claimed: 0,
      reconciled: 0,
      failed: 0,
      exhausted: 0,
      errors: [],
    });
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("counts a due action as succeeded only after the returned action is executed", async () => {
    executeAutonomousActionMock
      .mockResolvedValueOnce({ status: "executed" })
      .mockResolvedValueOnce({ status: "approved" });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      dueCount: 2,
      succeeded: 1,
      failed: 1,
      recovery: {
        claimed: 0,
        reconciled: 0,
        failed: 0,
        exhausted: 0,
        errors: [],
      },
      results: [
        { actionId: "action-1", success: true },
        {
          actionId: "action-2",
          success: false,
          error: "Action did not reach executed status: approved",
        },
      ],
    });
  });

  it("reports recovery failures and exhaustion as unhealthy", async () => {
    query.limit.mockResolvedValue({ data: [], error: null });
    recoverApprovedActionEmailsMock.mockResolvedValue({
      claimed: 1,
      reconciled: 0,
      failed: 1,
      exhausted: 1,
      errors: ["intent-1: exhausted"],
    });

    const response = await GET(request());

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 503,
      body: {
        ok: false,
        dueCount: 0,
        succeeded: 0,
        failed: 0,
        recovery: {
          claimed: 1,
          reconciled: 0,
          failed: 1,
          exhausted: 1,
          errors: ["intent-1: exhausted"],
        },
        results: [],
      },
    });
  });
});
