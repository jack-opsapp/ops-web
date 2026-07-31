import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  }

  return {
    CronDatabaseOperationError,
    runWithCronWorkloadControl: vi.fn(),
    observedWorkFailures: [] as unknown[],
    readCronWorkloadCursor: vi.fn(),
    advanceCronWorkloadCursor: vi.fn(),
    setSupabaseOverride: vi.fn(),
    scanCompany: vi.fn(),
    checkPermissionByIdStrict: vi.fn(),
    createNotificationOrThrow: vi.fn(),
    getSubscriptionInfo: vi.fn(),
  };
});

type DbError = { code?: string; message: string };

let companyRows: Array<Record<string, unknown>> = [];
let companyError: DbError | null = null;
let userRowsByCompany = new Map<
  string,
  Array<{ id: string }>
>();
let userErrorByCompany = new Map<string, DbError>();
const companyQueryCalls: Array<{
  method: string;
  args: unknown[];
}> = [];

function makeCompanyQuery() {
  const query = {
    select(...args: unknown[]) {
      companyQueryCalls.push({ method: "select", args });
      return query;
    },
    gt(...args: unknown[]) {
      companyQueryCalls.push({ method: "gt", args });
      return query;
    },
    order(...args: unknown[]) {
      companyQueryCalls.push({ method: "order", args });
      return query;
    },
    limit(...args: unknown[]) {
      companyQueryCalls.push({ method: "limit", args });
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onFulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve({
        data: companyRows,
        error: companyError,
      }).then(onFulfilled, onRejected);
    },
  };
  return query;
}

function makeUserQuery(companyId: string) {
  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === "company_id") {
        companyId = String(value);
      }
      return query;
    },
    is() {
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onFulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve({
        data: userRowsByCompany.get(companyId) ?? [],
        error: userErrorByCompany.get(companyId) ?? null,
      }).then(onFulfilled, onRejected);
    },
  };
  return query;
}

const supabase = {
  from(table: string) {
    if (table === "companies") return makeCompanyQuery();
    if (table === "users") return makeUserQuery("");
    throw new Error(`Unexpected table: ${table}`);
  },
  rpc: vi.fn(),
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabase,
}));
vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: mocks.setSupabaseOverride,
}));
vi.mock("@/lib/api/services/duplicate-detection-service", () => ({
  DuplicateDetectionService: {
    scanCompany: mocks.scanCompany,
  },
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionByIdStrict: mocks.checkPermissionByIdStrict,
}));
vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: {
    createOrThrow: mocks.createNotificationOrThrow,
  },
}));
vi.mock("@/lib/subscription", () => ({
  getSubscriptionInfo: mocks.getSubscriptionInfo,
}));
vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: mocks.readCronWorkloadCursor,
  advanceCronWorkloadCursor: mocks.advanceCronWorkloadCursor,
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: mocks.CronDatabaseOperationError,
  isDatabasePressureError: (error: unknown) =>
    error instanceof mocks.CronDatabaseOperationError,
  runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
}));

function request(auth = "Bearer duplicate-secret"): NextRequest {
  return new Request("http://localhost/api/cron/duplicate-scan", {
    headers: { authorization: auth },
  }) as unknown as NextRequest;
}

const workloadLease = {
  ownerToken: "duplicate-scan-test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

function company(id: string) {
  return {
    id,
    subscription_plan: "pro",
    subscription_status: "active",
    trial_end_date: null,
    seated_employee_ids: [],
    admin_ids: [],
    max_seats: 5,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "duplicate-secret";
  companyRows = [];
  companyError = null;
  userRowsByCompany = new Map();
  userErrorByCompany = new Map();
  companyQueryCalls.length = 0;
  vi.clearAllMocks();
  mocks.observedWorkFailures.length = 0;
  mocks.readCronWorkloadCursor.mockResolvedValue(null);
  mocks.advanceCronWorkloadCursor.mockResolvedValue(undefined);
  mocks.scanCompany.mockResolvedValue(0);
  mocks.checkPermissionByIdStrict.mockResolvedValue(true);
  mocks.createNotificationOrThrow.mockResolvedValue(undefined);
  mocks.getSubscriptionInfo.mockReturnValue({ isActive: true });
  mocks.runWithCronWorkloadControl.mockImplementation(
    async ({
      work,
    }: {
      work: (lease: typeof workloadLease) => Promise<unknown>;
    }) => {
      try {
        return { status: "completed", value: await work(workloadLease) };
      } catch (error) {
        mocks.observedWorkFailures.push(error);
        throw error;
      }
    }
  );
});

describe("duplicate-scan cron outage controls", () => {
  it("scans no more than five companies and advances the durable cursor", async () => {
    companyRows = Array.from({ length: 6 }, (_, index) =>
      company(`00000000-0000-0000-0000-00000000000${index}`)
    );

    const { GET } = await import("@/app/api/cron/duplicate-scan/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.scanCompany).toHaveBeenCalledTimes(5);
    expect(
      companyQueryCalls.filter(({ method }) => method === "limit")
    ).toEqual([{ method: "limit", args: [5] }]);
    expect(mocks.runWithCronWorkloadControl).toHaveBeenCalledWith({
      supabase,
      workloadKey: "duplicate-scan",
      leaseSeconds: 360,
      work: expect.any(Function),
    });
    expect(mocks.advanceCronWorkloadCursor).toHaveBeenCalledWith(
      supabase,
      "duplicate-scan",
      workloadLease,
      null,
      "00000000-0000-0000-0000-000000000004"
    );
  });

  it("resumes company rotation after the durable cursor", async () => {
    mocks.readCronWorkloadCursor.mockResolvedValue(
      "00000000-0000-0000-0000-000000000009"
    );
    companyRows = [company("00000000-0000-0000-0000-000000000010")];

    const { GET } = await import("@/app/api/cron/duplicate-scan/route");
    await GET(request());

    expect(companyQueryCalls).toContainEqual({
      method: "gt",
      args: ["id", "00000000-0000-0000-0000-000000000009"],
    });
    expect(mocks.advanceCronWorkloadCursor).toHaveBeenCalledWith(
      supabase,
      "duplicate-scan",
      workloadLease,
      "00000000-0000-0000-0000-000000000009",
      null
    );
  });

  it("returns an idempotent no-op when another scan owns the lease", async () => {
    mocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const { GET } = await import("@/app/api/cron/duplicate-scan/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(mocks.readCronWorkloadCursor).not.toHaveBeenCalled();
    expect(mocks.scanCompany).not.toHaveBeenCalled();
  });

  it.each(["circuit_open", "control_unavailable"] as const)(
    "fails closed when workload control reports %s",
    async (reason) => {
      mocks.runWithCronWorkloadControl.mockResolvedValue({
        status: "skipped",
        reason,
        ...(reason === "control_unavailable"
          ? { error: new Error("control unavailable") }
          : {}),
      });

      const { GET } = await import("@/app/api/cron/duplicate-scan/route");
      const response = await GET(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        ran: false,
        reason,
      });
      expect(mocks.scanCompany).not.toHaveBeenCalled();
    }
  );

  it("aborts immediately on database pressure and leaves the cursor unchanged", async () => {
    companyRows = [company("company-1"), company("company-2")];
    const pressure = new mocks.CronDatabaseOperationError(
      "duplicate entity page failed",
      {
        cause: {
          code: "PGRST002",
          message: "Could not query the database for the schema cache",
        },
      }
    );
    mocks.scanCompany.mockRejectedValueOnce(pressure);

    const { GET } = await import("@/app/api/cron/duplicate-scan/route");
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(mocks.scanCompany).toHaveBeenCalledTimes(1);
    expect(mocks.advanceCronWorkloadCursor).not.toHaveBeenCalled();
    expect(mocks.observedWorkFailures).toEqual([pressure]);
  });

  it("keeps a business-record failure ordinary and continues the bounded batch", async () => {
    companyRows = [company("company-1"), company("company-2")];
    const businessError = new Error("malformed subscription state");
    mocks.scanCompany
      .mockRejectedValueOnce(businessError)
      .mockResolvedValueOnce(0);

    const { GET } = await import("@/app/api/cron/duplicate-scan/route");
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.scanCompany).toHaveBeenCalledTimes(2);
    expect(body.results[0].error).toBe(businessError.message);
    expect(mocks.advanceCronWorkloadCursor).toHaveBeenCalled();
    expect(businessError).not.toBeInstanceOf(
      mocks.CronDatabaseOperationError
    );
  });

  it("tags the raw companies query error as database-origin", async () => {
    const raw = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    companyError = raw;

    const { GET } = await import("@/app/api/cron/duplicate-scan/route");
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(mocks.observedWorkFailures).toHaveLength(1);
    const [failure] = mocks.observedWorkFailures;
    expect(failure).toBeInstanceOf(mocks.CronDatabaseOperationError);
    expect((failure as Error & { cause?: unknown }).cause).toBe(raw);
    expect(mocks.scanCompany).not.toHaveBeenCalled();
    expect(mocks.advanceCronWorkloadCursor).not.toHaveBeenCalled();
  });
});
