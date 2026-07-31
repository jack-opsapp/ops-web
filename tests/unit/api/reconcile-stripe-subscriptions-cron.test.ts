import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  CronDatabaseOperationError,
  companies,
  queryState,
  subscriptionsListMock,
  runWithCronWorkloadControlMock,
  readCronWorkloadCursorMock,
  advanceCronWorkloadCursorMock,
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
    companies: [] as Array<Record<string, unknown>>,
    queryState: {
      readError: null as { code?: string; message: string } | null,
      updateError: null as { code?: string; message: string } | null,
      limits: [] as number[],
      gts: [] as Array<[string, unknown]>,
      orders: [] as Array<[string, unknown]>,
      updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    },
    subscriptionsListMock: vi.fn(),
    runWithCronWorkloadControlMock: vi.fn(),
    readCronWorkloadCursorMock: vi.fn(),
    advanceCronWorkloadCursorMock: vi.fn(),
    serviceClient: { from: vi.fn() },
  };
});

vi.mock("stripe", () => ({
  default: class Stripe {
    subscriptions = { list: subscriptionsListMock };
  },
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError,
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
}));

vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: readCronWorkloadCursorMock,
  advanceCronWorkloadCursor: advanceCronWorkloadCursorMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));

import { GET } from "@/app/api/cron/reconcile-stripe-subscriptions/route";

function request() {
  return new NextRequest(
    "https://ops.test/api/cron/reconcile-stripe-subscriptions",
    { headers: { authorization: "Bearer cron-secret" } }
  );
}

const workloadLease = {
  ownerToken: "stripe-reconciliation-test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

function company(id: string) {
  return {
    id,
    stripe_customer_id: `cus_${id}`,
    subscription_status: "active",
    subscription_plan: "solo",
    subscription_end: null,
    trial_start_date: null,
    trial_end_date: null,
    seat_grace_start_date: null,
    max_seats: 1,
  };
}

describe("Stripe subscription reconciliation cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_ops";
    vi.clearAllMocks();
    companies.splice(
      0,
      companies.length,
      company("company-1"),
      company("company-2")
    );
    queryState.readError = null;
    queryState.updateError = null;
    queryState.limits.length = 0;
    queryState.gts.length = 0;
    queryState.orders.length = 0;
    queryState.updates.length = 0;
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
    subscriptionsListMock.mockResolvedValue({ data: [] });
    serviceClient.from.mockImplementation(() => {
      let mode: "read" | "update" = "read";
      let patch: Record<string, unknown> = {};
      let id = "";
      const query = {
        select: () => {
          mode = "read";
          return query;
        },
        not: () => query,
        order: (column: string, options: unknown) => {
          queryState.orders.push([column, options]);
          return query;
        },
        gt: (column: string, value: unknown) => {
          queryState.gts.push([column, value]);
          return query;
        },
        limit: (limit: number) => {
          queryState.limits.push(limit);
          return query;
        },
        update: (nextPatch: Record<string, unknown>) => {
          mode = "update";
          patch = nextPatch;
          return query;
        },
        eq: (column: string, value: string) => {
          expect(column).toBe("id");
          id = value;
          return query;
        },
        then: (
          resolve: (value: {
            data: typeof companies | null;
            error: typeof queryState.readError;
          }) => unknown
        ) => {
          if (mode === "update") {
            queryState.updates.push({ id, patch });
            return Promise.resolve({
              data: null,
              error: queryState.updateError,
            }).then(resolve);
          }
          return Promise.resolve({
            data: companies,
            error: queryState.readError,
          }).then(resolve);
        },
      };
      return query;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it("loads at most ten companies from the durable cursor inside one lease", async () => {
    readCronWorkloadCursorMock.mockResolvedValue("company-0");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(queryState.orders).toContainEqual(["id", { ascending: true }]);
    expect(queryState.gts).toEqual([["id", "company-0"]]);
    expect(queryState.limits).toEqual([10]);
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceClient,
        workloadKey: "stripe-subscription-reconciliation",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
    expect(advanceCronWorkloadCursorMock).toHaveBeenCalledWith(
      serviceClient,
      "stripe-subscription-reconciliation",
      workloadLease,
      "company-0",
      null
    );
  });

  it("launches no query or Stripe work while another run holds the lease", async () => {
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
    expect(subscriptionsListMock).not.toHaveBeenCalled();
  });

  it("aborts Stripe work and cursor advancement after a database read error", async () => {
    queryState.readError = {
      code: "53300",
      message: "remaining connection slots",
    };

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(subscriptionsListMock).not.toHaveBeenCalled();
    expect(advanceCronWorkloadCursorMock).not.toHaveBeenCalled();
  });

  it("aborts later companies when a reconciliation update hits database pressure", async () => {
    queryState.updateError = {
      code: "53300",
      message: "remaining connection slots",
    };
    subscriptionsListMock.mockResolvedValue({
      data: [
        {
          status: "active",
          created: 1,
          trial_start: null,
          trial_end: null,
          items: {
            data: [
              {
                current_period_end: 2_000_000_000,
                price: { id: "unknown-price" },
              },
            ],
          },
        },
      ],
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(subscriptionsListMock).toHaveBeenCalledTimes(1);
    expect(advanceCronWorkloadCursorMock).not.toHaveBeenCalled();
  });

  it("isolates a Stripe timeout and continues the next company", async () => {
    subscriptionsListMock
      .mockRejectedValueOnce({ status: 504, message: "Stripe timeout" })
      .mockResolvedValueOnce({ data: [] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      noSubs: 1,
      errors: 1,
    });
    expect(subscriptionsListMock).toHaveBeenCalledTimes(2);
    expect(advanceCronWorkloadCursorMock).toHaveBeenCalledOnce();
  });
});
