/**
 * Integration tests for GET /api/cron/pmf/daily-digest.
 *
 * Fires daily at 07:00 PT. Renders `DailyDigestEmail` with the current
 * PMF state and the days-to-GATE-B countdown, then hands off to
 * `sendPmfNotification` with `kind: 'daily_digest'`.
 *
 * Mocking strategy (mirrors pmf-threshold-check-cron.test.ts):
 *   - `@/lib/admin/pmf-queries` mocked so `computePmfState()` returns
 *     a configurable `PmfState` (or throws, for the failure path).
 *   - `@/lib/notifications/pmf-send` mocked so we can inspect exactly
 *     what the route hands off — kind, trigger, subject, React element.
 *   - `@/lib/supabase/admin-client` mocked as a no-op (this route does
 *     not touch Supabase directly — only through `sendPmfNotification`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { ReactElement } from "react";
import type { PmfState } from "@/lib/pmf/types";

// ─── Mock state ──────────────────────────────────────────────────────────────

const workloadControlMocks = vi.hoisted(() => {
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
    adminClient: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
  };
});

const sendPmfNotificationMock =
  vi.fn<
    (opts: {
      kind: string;
      trigger: string;
      emailSubject?: string;
      emailReact?: unknown;
    }) => Promise<void>
  >();

let nextComputePmfStateResult: PmfState | Error = makeState();

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/admin/pmf-queries", () => ({
  computePmfState: async () => {
    if (nextComputePmfStateResult instanceof Error) {
      throw nextComputePmfStateResult;
    }
    return nextComputePmfStateResult;
  },
}));

vi.mock("@/lib/notifications/pmf-send", () => ({
  sendPmfNotification: (opts: Parameters<typeof sendPmfNotificationMock>[0]) =>
    sendPmfNotificationMock(opts),
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: workloadControlMocks.CronDatabaseOperationError,
  runWithCronWorkloadControl: workloadControlMocks.runWithCronWorkloadControl,
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => workloadControlMocks.adminClient,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_SECRET = "test-cron-secret-pmf-daily-digest";

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  const req = new Request("http://localhost/api/cron/pmf/daily-digest", {
    method: "GET",
    headers,
  });
  return req as unknown as NextRequest;
}

/** Build a PmfState with sensible defaults. */
function makeState(): PmfState {
  return {
    capturedAt: "2026-04-22T12:00:00.000Z",
    markers: {
      marker_1: {
        status: "amber",
        value: 1,
        target: 2,
        label: "TIER A ENGAGEMENTS",
      },
      marker_2: {
        status: "red",
        value: 0,
        target: 5,
        label: "RETAINED BASE SAAS",
      },
      marker_3: { status: "red", value: 0, target: 1, label: "INBOUND LEAD" },
      marker_4: {
        status: "red",
        value: 0,
        target: 15000,
        label: "CAC FROM $15K SPEND",
        detail: "0 paid attributed",
      },
    },
    indicators: {
      indicator_a: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "ACTIVE TIER A",
      },
      indicator_b: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "WEEKLY TRIALS",
      },
      indicator_c: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "TRIAL→PAID",
        unit: "percent",
      },
      indicator_d: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "COHORT CHURN",
        unit: "percent",
      },
      indicator_e: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "REFERRALS",
      },
    },
  };
}

function isReactElement(x: unknown): x is ReactElement {
  return typeof x === "object" && x !== null && "type" in x && "props" in x;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/cron/pmf/daily-digest", () => {
  beforeEach(() => {
    sendPmfNotificationMock.mockReset();
    sendPmfNotificationMock.mockResolvedValue(undefined);
    workloadControlMocks.runWithCronWorkloadControl.mockReset();
    workloadControlMocks.observedWorkFailures.length = 0;
    workloadControlMocks.runWithCronWorkloadControl.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => {
        try {
          return {
            status: "completed",
            value: await work(),
          };
        } catch (error) {
          workloadControlMocks.observedWorkFailures.push(error);
          throw error;
        }
      }
    );
    nextComputePmfStateResult = makeState();
    process.env.CRON_SECRET = VALID_SECRET;
  });

  it("returns 401 when no auth header is supplied", async () => {
    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("cron_secret");
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it("happy path: returns { ok: true } and fires one notification", async () => {
    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json).toEqual({ ok: true });

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    expect(
      workloadControlMocks.runWithCronWorkloadControl
    ).toHaveBeenCalledWith({
      supabase: workloadControlMocks.adminClient,
      workloadKey: "pmf-daily-digest",
      leaseSeconds: 90,
      work: expect.any(Function),
    });
  });

  it("returns an idempotent no-op when another daily digest owns the lease", async () => {
    workloadControlMocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it.each(["circuit_open", "control_unavailable"] as const)(
    "fails closed when workload control reports %s",
    async (reason) => {
      workloadControlMocks.runWithCronWorkloadControl.mockResolvedValue({
        status: "skipped",
        reason,
        ...(reason === "control_unavailable"
          ? { error: new Error("control RPC unavailable") }
          : {}),
      });

      const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
      const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        ok: false,
        ran: false,
        reason,
      });
      expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    }
  );

  it("hands off the correct kind, trigger, subject, and a React element", async () => {
    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    await GET(buildReq(`Bearer ${VALID_SECRET}`));

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    const call = sendPmfNotificationMock.mock.calls[0][0];

    // Kind is exactly 'daily_digest' so pmf-send routes to email-only.
    expect(call.kind).toBe("daily_digest");

    // Trigger is date-scoped YYYY-MM-DD for operational log readability.
    expect(call.trigger).toMatch(/^daily_\d{4}-\d{2}-\d{2}$/);
    const today = new Date().toISOString().slice(0, 10);
    expect(call.trigger).toBe(`daily_${today}`);

    // Subject follows the "OPS :: PMF DAILY · GATE B <N> DAYS" format.
    expect(call.emailSubject).toMatch(/^OPS :: PMF DAILY · GATE B \d+ DAYS$/);

    // emailReact is a real React element (DailyDigestEmail output).
    expect(call.emailReact).toBeTruthy();
    expect(isReactElement(call.emailReact)).toBe(true);
  });

  it("returns 500 when computePmfState throws (and logs the error)", async () => {
    nextComputePmfStateResult = new Error(
      "RPC pmf_count_retained_saas missing"
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    // Generic error shape — no Supabase internals leaked to clients.
    expect(json.error).toBe("daily digest failed");
    expect(errorSpy).toHaveBeenCalled();
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    expect(workloadControlMocks.observedWorkFailures).toHaveLength(1);
    const [failure] = workloadControlMocks.observedWorkFailures;
    expect(failure).toBeInstanceOf(
      workloadControlMocks.CronDatabaseOperationError
    );
    expect((failure as Error & { cause?: unknown }).cause).toBe(
      nextComputePmfStateResult
    );
    errorSpy.mockRestore();
  });

  it("keeps a notification provider failure outside the database circuit", async () => {
    const providerFailure = new Error("sendgrid transient 502");
    sendPmfNotificationMock.mockRejectedValueOnce(providerFailure);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/daily-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("daily digest failed");
    expect(errorSpy).toHaveBeenCalled();
    expect(workloadControlMocks.observedWorkFailures).toEqual([
      providerFailure,
    ]);
    expect(providerFailure).not.toBeInstanceOf(
      workloadControlMocks.CronDatabaseOperationError
    );
    errorSpy.mockRestore();
  });
});
