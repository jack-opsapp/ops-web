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

let nextUpsertError: { message: string } | null = null;

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
const queryCalls: Array<{ start: Date; end: Date }> = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => makeMockClient(),
}));

vi.mock("@/lib/analytics/google-ads-client", () => ({
  isGoogleAdsConfigured: () => isConfigured,
  queryDailyAccountData: async (start: Date, end: Date) => {
    queryCalls.push({ start, end });
    return nextRows;
  },
}));

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
    isConfigured = true;
    nextRows = [];
    process.env.CRON_SECRET = VALID_SECRET;
  });

  it("returns 401 when no auth header is supplied", async () => {
    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
    const res = await GET(buildReq("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("cron_secret");
    expect(queryCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns { skipped } and does no work when Google Ads is not configured", async () => {
    isConfigured = false;
    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { skipped: string };
    expect(json.skipped).toBeTruthy();
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

    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
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

    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
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

  it("returns 500 with the error message when the supabase upsert fails", async () => {
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
    nextUpsertError = { message: "boom" };

    const { GET } = await import(
      "@/app/api/cron/pmf/google-ads-sync/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("boom");

    // The upsert *was* attempted before the error came back.
    expect(upsertCalls).toHaveLength(1);
  });
});
