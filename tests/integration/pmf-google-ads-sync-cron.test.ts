/**
 * Integration tests for GET /api/cron/pmf/google-ads-sync.
 *
 * Pulls yesterday's account-level Google Ads totals via queryDailyAccountData
 * (already converts micros -> dollars) and upserts a single row into
 * ad_spend_log keyed on (channel, spend_date) for PMF marker computation.
 *
 * Mocking strategy mirrors tests/integration/pmf-attributions-seed.test.ts:
 *   - vi.mock("@/lib/supabase/admin-client") returns a hand-rolled mock
 *     client that records every .upsert(...) call so we can assert against
 *     the rows the handler tried to write.
 *   - vi.mock("@/lib/analytics/google-ads-client") swaps out
 *     isGoogleAdsConfigured / queryDailyAccountData so we can simulate
 *     "not configured", "data returned", and "no data" cases without
 *     hitting the real Google Ads API.
 *   - We never hit a real Supabase or Google Ads — the test is hermetic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface UpsertCall {
  table: string;
  row: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}

const upsertCalls: UpsertCall[] = [];

let nextUpsertError: { message: string; code?: string } | null = null;

let isConfigured = true;
let nextRows: Array<{
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
}> = [];
let nextQueryError: Error | null = null;
const queryCalls: Array<{ start: Date; end: Date }> = [];
let nextControlSkip:
  | "lease_held"
  | "circuit_open"
  | "control_unavailable"
  | null = null;
let lastWorkError: unknown = null;
const healthReports: Array<{ blocked: boolean; reason?: string }> = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => makeMockClient(),
}));

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    return {
      ...actual,
      runWithCronWorkloadControl: async ({
        work,
      }: {
        work: () => Promise<unknown>;
      }) => {
        if (nextControlSkip) {
          return { status: "skipped", reason: nextControlSkip };
        }
        try {
          return { status: "completed", value: await work() };
        } catch (error) {
          lastWorkError = error;
          throw error;
        }
      },
    };
  }
);

vi.mock("@/lib/analytics/google-ads-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/analytics/google-ads-client")>();
  return {
    // The real typed error — the provider-health classifier instanceof-checks it.
    GoogleAdsApiError: actual.GoogleAdsApiError,
    isGoogleAdsConfigured: () => isConfigured,
    queryDailyAccountData: async (start: Date, end: Date) => {
      queryCalls.push({ start, end });
      if (nextQueryError) throw nextQueryError;
      return nextRows;
    },
  };
});

// Real classifier, recorded reporter: the degrade decision is under test, the
// shared state write is covered by tests/unit/admin/ads-provider-health.test.ts.
vi.mock("@/lib/admin/ads-provider-health", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/admin/ads-provider-health")>();
  return {
    ...actual,
    reportAdsProviderHealth: async (
      _sb: unknown,
      next: { blocked: boolean; reason?: string }
    ) => {
      healthReports.push(next);
    },
  };
});

interface MockBuilder {
  upsert: (
    row: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
}

function makeMockClient() {
  return {
    from(table: string): MockBuilder {
      return {
        upsert: async (row, options) => {
          upsertCalls.push({ table, row, options });
          if (nextUpsertError) return { error: nextUpsertError };
          return { error: null };
        },
      };
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_SECRET = "test-cron-secret-pmf-google-ads-sync";

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  const req = new Request("http://localhost/api/cron/pmf/google-ads-sync", {
    method: "GET",
    headers,
  });
  return req as unknown as NextRequest;
}

function expectedYesterdayStr(): string {
  const y = new Date();
  y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/cron/pmf/google-ads-sync", () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    queryCalls.length = 0;
    nextUpsertError = null;
    nextQueryError = null;
    nextControlSkip = null;
    lastWorkError = null;
    healthReports.length = 0;
    isConfigured = true;
    nextRows = [];
    process.env.CRON_SECRET = VALID_SECRET;
  });

  it("returns 401 when no auth header is supplied", async () => {
    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("cron_secret");
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns { skipped } and does no work when Google Ads is not configured", async () => {
    isConfigured = false;
    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { skipped: string };
    expect(json.skipped).toBeTruthy();
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("skips an overlapping invocation before provider or database work", async () => {
    nextControlSkip = "lease_held";
    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("upserts yesterday's totals into ad_spend_log on the happy path with data", async () => {
    const dateStr = expectedYesterdayStr();
    nextRows = [
      {
        date: dateStr,
        spend: 12.34,
        clicks: 100,
        impressions: 1000,
        conversions: 5,
        cpa: 2.47,
        ctr: 0.1,
      },
    ];

    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);

    // Query was called with (yesterday, yesterday)
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].start.toISOString().slice(0, 10)).toBe(dateStr);
    expect(queryCalls[0].end.toISOString().slice(0, 10)).toBe(dateStr);

    // Upsert hit ad_spend_log with the right shape
    expect(upsertCalls).toHaveLength(1);
    const call = upsertCalls[0];
    expect(call.table).toBe("ad_spend_log");
    expect(call.options).toEqual({ onConflict: "channel,spend_date" });
    expect(call.row).toMatchObject({
      channel: "google_ads",
      spend_date: dateStr,
      spend_cents: 1234,
      impressions: 1000,
      clicks: 100,
      source: "auto_sync",
    });

    const json = (await res.json()) as {
      ok: boolean;
      date: string;
      spend_cents: number;
      impressions: number;
      clicks: number;
    };
    expect(json.ok).toBe(true);
    expect(json.date).toBe(dateStr);
    expect(json.spend_cents).toBe(1234);
    expect(json.impressions).toBe(1000);
    expect(json.clicks).toBe(100);
  });

  it("records a zero-row when the day returned no data (account paused / no spend)", async () => {
    nextRows = [];
    const dateStr = expectedYesterdayStr();

    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].row).toMatchObject({
      channel: "google_ads",
      spend_date: dateStr,
      spend_cents: 0,
      impressions: 0,
      clicks: 0,
      source: "auto_sync",
    });
    expect(upsertCalls[0].options).toEqual({
      onConflict: "channel,spend_date",
    });

    const json = (await res.json()) as { spend_cents: number };
    expect(json.spend_cents).toBe(0);
  });

  it("returns a generic 500 (no secret leakage) when the Google Ads query throws", async () => {
    // Mirrors the real shape thrown by queryGoogleAds, which embeds the raw
    // Google response body — including customer ID and request diagnostics —
    // into the Error message. The route must NOT echo that back in the HTTP
    // response body, but MUST log it server-side for debugging.
    // A 5xx is a transient provider fault, NOT a standing access condition, so
    // it must still surface as a 500 rather than degrade.
    const leakyMessage =
      'Google Ads API error (500): {"error":{"code":500,"message":"Internal error encountered.","status":"INTERNAL","details":[{"customerId":"1234567890","requestId":"abc-secret-request-id"}]}}';
    nextQueryError = new Error(leakyMessage);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    // Exactly the generic message — no leakage of the underlying Google Ads body.
    expect(json).toEqual({ error: "google ads sync failed" });
    expect(json.error).not.toContain("customerId");
    expect(json.error).not.toContain("requestId");
    expect(json.error).not.toContain("Google Ads API error");

    // The full message IS logged server-side (Vercel logs need it for debugging).
    expect(errorSpy).toHaveBeenCalled();
    const loggedAnything = errorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes(leakyMessage))
    );
    expect(loggedAnything).toBe(true);

    // The query was attempted; no upsert happened because the throw came first.
    expect(queryCalls).toHaveLength(1);
    expect(upsertCalls).toHaveLength(0);
    // A transient provider fault is not a standing access condition.
    expect(healthReports).toHaveLength(0);

    errorSpy.mockRestore();
  });

  it("degrades with 200 and writes no spend row when account access is blocked", async () => {
    // Bug 964cf782: for four weeks this returned 500 on every scheduled run
    // and the PMF dashboard silently lost its spend series.
    const leakyMessage =
      'Google Ads API error (403): {"error":{"code":403,"status":"PERMISSION_DENIED","details":[{"errors":[{"errorCode":{"authorizationError":"DEVELOPER_TOKEN_NOT_APPROVED"}}],"customerId":"1234567890","requestId":"abc-secret-request-id"}]}}';
    nextQueryError = new Error(leakyMessage);

    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      ran: boolean;
      degraded: string;
      reason: string;
    };
    expect(json.ok).toBe(false);
    expect(json.ran).toBe(true);
    expect(json.degraded).toBe("provider_access");
    expect(json.reason).toContain("DEVELOPER_TOKEN_NOT_APPROVED");
    // The one-line reason carries the marker, never the raw response body.
    expect(json.reason).not.toContain("customerId");
    expect(json.reason).not.toContain("requestId");

    // A missing day truthfully means "not synced"; a zero row would claim
    // "checked, no spend". Never blur the two.
    expect(upsertCalls).toHaveLength(0);
    expect(healthReports).toEqual([
      {
        blocked: true,
        reason: expect.stringContaining("DEVELOPER_TOKEN_NOT_APPROVED"),
      },
    ]);
  });

  it("records provider health as healthy after a successful sync", async () => {
    nextRows = [
      {
        date: expectedYesterdayStr(),
        spend: 12.34,
        clicks: 5,
        impressions: 100,
        conversions: 1,
        cpa: 0,
        ctr: 0,
      },
    ];

    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));

    expect(res.status).toBe(200);
    expect(upsertCalls).toHaveLength(1);
    expect(healthReports).toEqual([{ blocked: false }]);
  });

  it("tags a Supabase upsert failure as database pressure without leaking it", async () => {
    nextRows = [
      {
        date: expectedYesterdayStr(),
        spend: 1,
        clicks: 1,
        impressions: 1,
        conversions: 0,
        cpa: 0,
        ctr: 0,
      },
    ];
    nextUpsertError = {
      message: "remaining connection slots are reserved",
      code: "53300",
    };

    const { GET } = await import("@/app/api/cron/pmf/google-ads-sync/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("google ads sync failed");

    const { CronDatabaseOperationError, isDatabasePressureError } =
      await import("@/lib/api/services/cron-workload-control-service");
    expect(lastWorkError).toBeInstanceOf(CronDatabaseOperationError);
    expect(isDatabasePressureError(lastWorkError)).toBe(true);

    // The upsert *was* attempted before the error came back.
    expect(upsertCalls).toHaveLength(1);
  });
});
