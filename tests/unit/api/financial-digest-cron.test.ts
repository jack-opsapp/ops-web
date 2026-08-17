import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: { from: vi.fn(), rpc: vi.fn() },
  generateFinancialDigest: vi.fn(),
  getCompanyManagerUserIds: vi.fn(),
  getServiceRoleClient: vi.fn(),
  runWithCronWorkloadControl: vi.fn(),
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: mocks.setSupabaseOverride,
}));

vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: mocks.getCompanyManagerUserIds,
}));

vi.mock("@/lib/api/services/financial-intelligence-service", () => ({
  FinancialIntelligenceService: {
    generateFinancialDigest: mocks.generateFinancialDigest,
  },
}));

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/api/services/cron-workload-control-service")
    >()),
    runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
  })
);

import { GET } from "@/app/api/cron/financial-digest/route";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "@/lib/api/services/cron-workload-control-service";

function request() {
  return new NextRequest("https://ops.test/api/cron/financial-digest", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("financial digest cron", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getServiceRoleClient.mockReturnValue(mocks.client);
    mocks.runWithCronWorkloadControl.mockImplementation(
      async ({ work }: { work: (lease: object) => Promise<unknown> }) => ({
        status: "completed",
        value: await work({
          ownerToken: "owner-1",
          fenceToken: 7,
          globalFenceToken: 11,
          expiresAt: "2026-08-13T18:00:00.000Z",
          signal: new AbortController().signal,
        }),
      })
    );
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "gt", "order"]) {
      query[method] = vi.fn(() => query);
    }
    query.limit = vi.fn(async () => ({
      data: [
        { company_id: "company-1" },
        { company_id: "company-2" },
        { company_id: "company-3" },
      ],
      error: null,
    }));
    mocks.client.from.mockReturnValue(query);
    mocks.client.rpc.mockImplementation(async (functionName: string) => {
      if (functionName === "read_cron_workload_cursor_as_system") {
        return { data: null, error: null };
      }
      return { data: true, error: null };
    });
    mocks.getCompanyManagerUserIds.mockRejectedValue(
      new Error("column companies.invoice_settings does not exist")
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails the workload instead of reporting a company schema error as success", async () => {
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Financial digest failed for 3 of 3 companies",
      retry: {
        status: "scheduled",
        scheduled: [
          { companyId: "company-1", attempt: 1 },
          { companyId: "company-2", attempt: 1 },
          { companyId: "company-3", attempt: 1 },
        ],
      },
      results: [
        {
          companyId: "company-1",
          digestProposed: false,
          disposition: "retryable",
          error: "column companies.invoice_settings does not exist",
        },
        {
          companyId: "company-2",
          digestProposed: false,
          disposition: "retryable",
          error: "column companies.invoice_settings does not exist",
        },
        {
          companyId: "company-3",
          digestProposed: false,
          disposition: "retryable",
          error: "column companies.invoice_settings does not exist",
        },
      ],
    });
    const cursorWrite = mocks.client.rpc.mock.calls.find(
      ([functionName]) =>
        functionName === "advance_cron_workload_cursor_as_system"
    );
    expect(cursorWrite?.[1]).toEqual(
      expect.objectContaining({
        p_expected_cursor: null,
        p_next_cursor: expect.stringMatching(/^phase-c-fanout:v2:/),
      })
    );
    expect(mocks.setSupabaseOverride).toHaveBeenLastCalledWith(null);
  });

  it("reports companies without an admin as non-actionable and advances the full page", async () => {
    mocks.getCompanyManagerUserIds.mockResolvedValue([]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      companiesProcessed: 3,
      errors: 0,
      nonActionable: 3,
      details: [
        {
          companyId: "company-1",
          disposition: "not_actionable",
          reason: "no_admin_user",
        },
        {
          companyId: "company-2",
          disposition: "not_actionable",
          reason: "no_admin_user",
        },
        {
          companyId: "company-3",
          disposition: "not_actionable",
          reason: "no_admin_user",
        },
      ],
    });
    expect(mocks.client.rpc).toHaveBeenCalledWith(
      "advance_cron_workload_cursor_as_system",
      expect.objectContaining({ p_next_cursor: "company-3" })
    );
  });

  it("reports an exhausted transient page and advances after three durable attempts", async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "gt", "order"]) {
      query[method] = vi.fn(() => query);
    }
    query.limit = vi.fn(async () => ({
      data: [{ company_id: "company-1" }],
      error: null,
    }));
    mocks.client.from.mockReturnValue(query);
    let storedCursor: string | null = null;
    mocks.client.rpc.mockImplementation(
      async (functionName: string, args: Record<string, unknown>) => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: storedCursor, error: null };
        }
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return { data: true, error: null };
      }
    );

    expect((await GET(request())).status).toBe(500);
    expect((await GET(request())).status).toBe(500);
    const exhausted = await GET(request());
    const payload = await exhausted.json();

    expect(exhausted.status).toBe(200);
    expect(payload).toMatchObject({
      ok: false,
      retry: {
        status: "exhausted",
        scheduled: [],
        exhausted: [{ companyId: "company-1", attempts: 3 }],
      },
    });
    expect(storedCursor).toBeNull();
  });

  it("preserves database-pressure evidence through the workload error", async () => {
    const pressure = new CronDatabaseOperationError("database unavailable", {
      cause: { code: "PGRST002" },
    });
    mocks.getCompanyManagerUserIds.mockRejectedValue(pressure);
    let observedPressure = false;
    mocks.runWithCronWorkloadControl.mockImplementation(
      async ({ work }: { work: (lease: object) => Promise<unknown> }) => {
        try {
          await work({
            ownerToken: "owner-1",
            fenceToken: 7,
            globalFenceToken: 11,
            expiresAt: "2026-08-13T18:00:00.000Z",
            signal: new AbortController().signal,
          });
        } catch (error) {
          observedPressure = isDatabasePressureError(error);
          throw error;
        }
      }
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(observedPressure).toBe(true);
  });

  it("reports exhausted identities even while another company remains scheduled", async () => {
    const storedCursor =
      'phase-c-fanout:v2:{"v":2,"pageCursor":"company-1","pending":[{"companyId":"company-1","attempts":2}]}';
    mocks.client.rpc.mockImplementation(async (functionName: string) =>
      functionName === "read_cron_workload_cursor_as_system"
        ? { data: storedCursor, error: null }
        : { data: true, error: null }
    );
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "gt", "order"]) {
      query[method] = vi.fn(() => query);
    }
    query.limit = vi.fn(async () => ({
      data: [{ company_id: "company-2" }],
      error: null,
    }));
    mocks.client.from.mockReturnValue(query);

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.retry).toMatchObject({
      status: "scheduled",
      exhausted: [{ companyId: "company-1", attempts: 3 }],
      scheduled: [{ companyId: "company-2", attempt: 1 }],
    });
  });
});
