/**
 * Integration tests for POST /api/admin/pmf/attributions/seed
 *
 * The route accepts a company_id + optional first_touch payload and inserts
 * a row into trial_attributions with a derived attributed_channel.
 *
 * Mocking strategy mirrors tests/integration/stripe-webhook-billing-events.test.ts:
 *   - vi.mock("@/lib/supabase/admin-client") returns a hand-rolled mock
 *     client that records every .insert(...) call so we can assert against
 *     the rows the handler tried to write.
 *   - vi.mock("@/lib/admin/api-auth") swaps out requireAdmin/withAdmin
 *     so we can simulate admin / non-admin / unauthenticated callers
 *     without standing up Firebase Auth.
 *   - We never hit a real Supabase or Firebase — the test is hermetic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest, NextResponse } from "next/server";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  row: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];

// Per-test toggles for the mock client
let companyExists = true;
let nextInsertError: { code?: string; message: string } | null = null;

// Per-test toggles for the auth mock
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
    // Signature mirrors the real withAdmin in src/lib/admin/api-auth.ts —
    // handler returns Promise<NextResponse>, NOT Promise<Response>. Keeping
    // these aligned means future narrowing of the catch surface in the real
    // wrapper will be caught by tests instead of slipping through.
    withAdmin:
      (handler: (req: NextRequest) => Promise<NextResponse>) =>
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
  getAdminSupabase: () => makeMockClient(),
}));

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  single: () => Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
  insert: (
    row: Record<string, unknown>
  ) => Promise<{ error: { code?: string; message: string } | null }>;
}

function makeMockClient() {
  return {
    from(table: string): MockBuilder {
      const builder: MockBuilder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          // Used by the company-existence check.
          if (table === "companies") {
            return companyExists
              ? { data: { id: "company-uuid" }, error: null }
              : { data: null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === "companies") {
            return companyExists
              ? { data: { id: "company-uuid" }, error: null }
              : { data: null, error: null };
          }
          return { data: null, error: null };
        },
        insert: async (row) => {
          insertCalls.push({ table, row });
          if (nextInsertError) return { error: nextInsertError };
          return { error: null };
        },
      };
      return builder;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildReq(body: unknown): NextRequest {
  const req = new Request("http://localhost/api/admin/pmf/attributions/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Cast — the admin handler only consumes standard Request methods.
  return req as unknown as NextRequest;
}

const VALID_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/pmf/attributions/seed", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    companyExists = true;
    nextInsertError = null;
    authMode = "admin";
  });

  it("inserts a trial_attributions row with derived google_ads channel from gclid", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(
      buildReq({
        company_id: VALID_COMPANY_ID,
        first_touch: {
          gclid: "Cj0KCQjw",
          landing_url: "https://app.opsapp.co/?gclid=Cj0KCQjw",
        },
      })
    );
    expect(res.status).toBe(200);

    const inserts = insertCalls.filter((c) => c.table === "trial_attributions");
    expect(inserts).toHaveLength(1);
    const row = inserts[0].row;
    expect(row.company_id).toBe(VALID_COMPANY_ID);
    expect(row.gclid).toBe("Cj0KCQjw");
    expect(row.attributed_channel).toBe("google_ads");
    expect(typeof row.trial_started_at).toBe("string");

    const json = (await res.json()) as {
      company_id: string;
      attributed_channel: string;
    };
    expect(json.company_id).toBe(VALID_COMPANY_ID);
    expect(json.attributed_channel).toBe("google_ads");
  });

  it("derives meta_ads from utm_source=facebook", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(
      buildReq({
        company_id: VALID_COMPANY_ID,
        first_touch: { utm_source: "facebook", utm_medium: "social" },
      })
    );
    expect(res.status).toBe(200);

    const row = insertCalls[0].row;
    expect(row.attributed_channel).toBe("meta_ads");
    expect(row.utm_source).toBe("facebook");
  });

  it("defaults trial_started_at to now() when absent", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const before = Date.now();
    const res = await POST(
      buildReq({ company_id: VALID_COMPANY_ID, first_touch: {} })
    );
    const after = Date.now();
    expect(res.status).toBe(200);

    const row = insertCalls[0].row;
    const ts = new Date(row.trial_started_at as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("uses provided trial_started_at when supplied", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const ts = "2026-04-01T12:00:00.000Z";
    const res = await POST(
      buildReq({ company_id: VALID_COMPANY_ID, trial_started_at: ts })
    );
    expect(res.status).toBe(200);
    expect(insertCalls[0].row.trial_started_at).toBe(ts);
  });

  it("derives 'direct' when first_touch is omitted entirely", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: VALID_COMPANY_ID }));
    expect(res.status).toBe(200);
    expect(insertCalls[0].row.attributed_channel).toBe("direct");
  });

  it("returns 409 when trial_attributions row already exists for the company", async () => {
    nextInsertError = { code: "23505", message: "duplicate key" };
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: VALID_COMPANY_ID }));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("already");
  });

  it("returns 500 on a non-unique-violation insert error", async () => {
    nextInsertError = { code: "42P01", message: "table missing" };
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: VALID_COMPANY_ID }));
    expect(res.status).toBe(500);
  });

  it("returns 404 when the company does not exist", async () => {
    companyExists = false;
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: VALID_COMPANY_ID }));
    expect(res.status).toBe(404);
    expect(
      insertCalls.filter((c) => c.table === "trial_attributions")
    ).toHaveLength(0);
  });

  it("returns 400 on invalid body (company_id missing)", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ first_touch: {} }));
    expect(res.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 400 on invalid body (company_id not a uuid)", async () => {
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    authMode = "unauthenticated";
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: VALID_COMPANY_ID }));
    expect(res.status).toBe(401);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 403 when the caller is signed in but not an admin", async () => {
    authMode = "non_admin";
    const { POST } =
      await import("@/app/api/admin/pmf/attributions/seed/route");
    const res = await POST(buildReq({ company_id: VALID_COMPANY_ID }));
    expect(res.status).toBe(403);
    expect(insertCalls).toHaveLength(0);
  });
});
