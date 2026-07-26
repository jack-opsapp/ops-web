/**
 * Integration tests for GET /api/cron/pmf/cleanup-snapshots.
 *
 * Fires daily in an isolated maintenance slot. Deletes at most 250
 * `pmf_threshold_snapshots` rows older than 30 days through a bounded RPC.
 *
 *   sb.rpc('cleanup_pmf_threshold_snapshots_batch_as_system', {
 *     p_cutoff: <cutoff ISO>,
 *     p_batch_size: 250,
 *   })
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

let nextRpcResponse: {
  error: { message: string; code?: string } | null;
  data: unknown;
} = { error: null, data: 0 };
let nextControlSkip:
  | "lease_held"
  | "circuit_open"
  | "control_unavailable"
  | null = null;
let lastWorkError: unknown = null;

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

function makeMockClient() {
  return {
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      recordedCalls.push({
        table: functionName,
        method: "rpc",
        args: [args],
      });
      return nextRpcResponse;
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
    nextRpcResponse = { error: null, data: 0 };
    nextControlSkip = null;
    lastWorkError = null;
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

  it("happy path: runs the bounded cleanup RPC and returns its pruned count", async () => {
    nextRpcResponse = { error: null, data: 42 };
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; pruned: number };
    expect(json).toEqual({ ok: true, ran: true, pruned: 42 });

    const cleanupCalls = recordedCalls.filter(
      (c) =>
        c.table === "cleanup_pmf_threshold_snapshots_batch_as_system" &&
        c.method === "rpc"
    );
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0].args[0]).toMatchObject({ p_batch_size: 250 });
  });

  it("filters by captured_at < cutoff, where cutoff is ~30 days ago", async () => {
    const beforeMs = Date.now();
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    await GET(buildReq(`Bearer ${VALID_SECRET}`));
    const afterMs = Date.now();

    const cleanupCalls = recordedCalls.filter(
      (c) =>
        c.table === "cleanup_pmf_threshold_snapshots_batch_as_system" &&
        c.method === "rpc"
    );
    expect(cleanupCalls).toHaveLength(1);

    // Cutoff is an ISO string 30 days before the request. Parse and check
    // the delta falls within the window [beforeMs..afterMs] minus 30 days,
    // with a millisecond tolerance on each side to account for test jitter.
    const cutoffIso = (cleanupCalls[0].args[0] as { p_cutoff: string })
      .p_cutoff;
    expect(typeof cutoffIso).toBe("string");
    const cutoffMs = new Date(cutoffIso).getTime();
    const THIRTY_DAYS_MS = 30 * 86_400_000;
    expect(cutoffMs).toBeGreaterThanOrEqual(beforeMs - THIRTY_DAYS_MS - 5);
    expect(cutoffMs).toBeLessThanOrEqual(afterMs - THIRTY_DAYS_MS + 5);
  });

  it("rejects an invalid cleanup count as a database contract failure", async () => {
    nextRpcResponse = { error: null, data: null };
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const { CronDatabaseOperationError } =
      await import("@/lib/api/services/cron-workload-control-service");
    expect(lastWorkError).toBeInstanceOf(CronDatabaseOperationError);
  });

  it("returns 500 when the delete errors (and logs, without leaking internals)", async () => {
    nextRpcResponse = {
      error: {
        message: "remaining connection slots are reserved",
        code: "53300",
      },
      data: null,
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

  it("skips an overlapping cleanup before invoking the bounded RPC", async () => {
    nextControlSkip = "lease_held";
    const { GET } = await import("@/app/api/cron/pmf/cleanup-snapshots/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(recordedCalls).toHaveLength(0);
  });
});
