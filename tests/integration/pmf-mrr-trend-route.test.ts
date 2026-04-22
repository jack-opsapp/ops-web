/**
 * Integration tests for GET /api/admin/pmf/mrr-trend
 *
 * The route is admin-gated (via withAdmin / requireAdmin) and proxies to the
 * `pmf_mrr_weekly` RPC, returning { data: WeekPoint[] }.
 *
 * Mocking strategy mirrors tests/integration/pmf-attributions-seed.test.ts:
 *   - vi.mock("@/lib/admin/api-auth") swaps requireAdmin/withAdmin so we can
 *     simulate admin / non-admin / unauthenticated callers without hitting
 *     Firebase Auth.
 *   - vi.mock("@/lib/supabase/admin-client") returns a hand-rolled client
 *     whose .rpc(name, args) is recorded and whose response is configurable
 *     per-test.
 *   - The test is hermetic — never touches a real Supabase or Firebase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest, NextResponse } from "next/server";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

const rpcCalls: RpcCall[] = [];

let nextRpcResponse: {
  data: unknown;
  error: { message: string } | null;
} = { data: [], error: null };

let authMode: "admin" | "non_admin" | "unauthenticated" = "admin";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/admin/api-auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAdmin: async () => {
      if (authMode === "unauthenticated") {
        throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (authMode === "non_admin") {
        throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return { uid: "admin-uid", email: "admin@opsapp.co", claims: {} };
    },
    withAdmin: (
      handler: (req: NextRequest) => Promise<NextResponse>
    ) =>
      async (req: NextRequest) => {
        try {
          return await handler(req);
        } catch (err) {
          if (err instanceof NextResponse) return err;
          return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
          );
        }
      },
  };
});

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return nextRpcResponse;
    },
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildReq(): NextRequest {
  const req = new Request("http://localhost/api/admin/pmf/mrr-trend", {
    method: "GET",
  });
  return req as unknown as NextRequest;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/pmf/mrr-trend", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    nextRpcResponse = { data: [], error: null };
    authMode = "admin";
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    authMode = "unauthenticated";
    const { GET } = await import(
      "@/app/api/admin/pmf/mrr-trend/route"
    );
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 403 when the caller is signed in but not an admin", async () => {
    authMode = "non_admin";
    const { GET } = await import(
      "@/app/api/admin/pmf/mrr-trend/route"
    );
    const res = await GET(buildReq());
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns the RPC data payload on the happy path", async () => {
    const rows = [
      { week: "2026-01", mrr_cents: 0 },
      { week: "2026-02", mrr_cents: 12500 },
      { week: "2026-03", mrr_cents: 47000 },
    ];
    nextRpcResponse = { data: rows, error: null };

    const { GET } = await import(
      "@/app/api/admin/pmf/mrr-trend/route"
    );
    const res = await GET(buildReq());
    expect(res.status).toBe(200);

    const json = (await res.json()) as { data: typeof rows };
    expect(json.data).toEqual(rows);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("pmf_mrr_weekly");
    expect(rpcCalls[0].args).toEqual({ weeks: 18 });
  });

  it("returns 500 when the rpc errors", async () => {
    nextRpcResponse = {
      data: null,
      error: { message: "function does not exist" },
    };
    const { GET } = await import(
      "@/app/api/admin/pmf/mrr-trend/route"
    );
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("function does not exist");
  });
});
