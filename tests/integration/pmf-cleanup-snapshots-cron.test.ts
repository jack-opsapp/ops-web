/**
 * Integration tests for GET /api/cron/pmf/cleanup-snapshots.
 *
 * Fires daily at 06:30 PT. Deletes `pmf_threshold_snapshots` rows older
 * than 30 days. Single Supabase call:
 *
 *   sb.from('pmf_threshold_snapshots')
 *     .delete({ count: 'exact' })
 *     .lt('captured_at', <cutoff ISO>)
 *
 * Mocking strategy:
 *   - A hand-rolled mock client records every `.from/.delete/.lt` call and
 *     the arguments, then resolves the chain with a configurable
 *     `{ error, count }` response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

const recordedCalls: RecordedCall[] = [];

let nextDeleteResponse: {
  error: { message: string } | null;
  count: number | null;
} = { error: null, count: 0 };

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => makeMockClient(),
}));

interface MockBuilder {
  delete: (opts?: Record<string, unknown>) => MockBuilder;
  lt: (
    col: string,
    val: unknown
  ) => Promise<{
    error: { message: string } | null;
    count: number | null;
  }>;
}

function makeMockClient(): { from: (table: string) => MockBuilder } {
  return {
    from(table: string): MockBuilder {
      const record = (method: string, ...args: unknown[]) =>
        recordedCalls.push({ table, method, args });

      const builder: MockBuilder = {
        delete: (opts) => {
          record("delete", opts);
          return builder;
        },
        // Terminal in this chain — resolves the configured response.
        lt: async (col, val) => {
          record("lt", col, val);
          return nextDeleteResponse;
        },
      };
      return builder;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_SECRET = "test-cron-secret-pmf-cleanup-snapshots";

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  const req = new Request("http://localhost/api/cron/pmf/cleanup-snapshots", {
    method: "GET",
    headers,
  });
  return req as unknown as NextRequest;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/cron/pmf/cleanup-snapshots", () => {
  beforeEach(() => {
    recordedCalls.length = 0;
    nextDeleteResponse = { error: null, count: 0 };
    process.env.CRON_SECRET = VALID_SECRET;
  });

  it("returns 401 when no auth header is supplied", async () => {
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(recordedCalls).toHaveLength(0);
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(recordedCalls).toHaveLength(0);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("cron_secret");
    expect(recordedCalls).toHaveLength(0);
  });

  it("happy path: deletes from pmf_threshold_snapshots and returns pruned count", async () => {
    nextDeleteResponse = { error: null, count: 42 };
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; pruned: number };
    expect(json).toEqual({ ok: true, pruned: 42 });

    // Targets the right table.
    const deleteCalls = recordedCalls.filter(
      (c) => c.table === "pmf_threshold_snapshots" && c.method === "delete"
    );
    expect(deleteCalls).toHaveLength(1);
    // And requested an exact count.
    expect(deleteCalls[0].args[0]).toEqual({ count: "exact" });
  });

  it("filters by captured_at < cutoff, where cutoff is ~30 days ago", async () => {
    const beforeMs = Date.now();
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    await GET(buildReq(`Bearer ${VALID_SECRET}`));
    const afterMs = Date.now();

    const ltCalls = recordedCalls.filter(
      (c) => c.table === "pmf_threshold_snapshots" && c.method === "lt"
    );
    expect(ltCalls).toHaveLength(1);
    expect(ltCalls[0].args[0]).toBe("captured_at");

    // Cutoff is an ISO string 30 days before the request. Parse and check
    // the delta falls within the window [beforeMs..afterMs] minus 30 days,
    // with a millisecond tolerance on each side to account for test jitter.
    const cutoffIso = ltCalls[0].args[1] as string;
    expect(typeof cutoffIso).toBe("string");
    const cutoffMs = new Date(cutoffIso).getTime();
    const THIRTY_DAYS_MS = 30 * 86_400_000;
    expect(cutoffMs).toBeGreaterThanOrEqual(beforeMs - THIRTY_DAYS_MS - 5);
    expect(cutoffMs).toBeLessThanOrEqual(afterMs - THIRTY_DAYS_MS + 5);
  });

  it("returns pruned: 0 when count is null (supabase-js can return null)", async () => {
    // supabase-js v2's delete({ count: 'exact' }) returns count: number | null.
    // The route must coerce null → 0 so the JSON response is well-typed.
    nextDeleteResponse = { error: null, count: null };
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; pruned: number };
    expect(json).toEqual({ ok: true, pruned: 0 });
  });

  it("returns 500 when the delete errors (and logs, without leaking internals)", async () => {
    nextDeleteResponse = {
      error: { message: "permission denied for table pmf_threshold_snapshots" },
      count: null,
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    // Sanitized — no internal DB message leaked.
    expect(json.error).toBe("snapshot cleanup failed");
    expect(json.error).not.toContain("permission denied");

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
