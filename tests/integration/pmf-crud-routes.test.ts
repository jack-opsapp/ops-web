/**
 * Integration tests for PMF CRUD routes (Task 15)
 *
 * Five admin-gated route groups under /api/admin/pmf:
 *   - GET / POST   /prospects
 *   - GET / PATCH / DELETE  /prospects/[id]
 *   - PATCH        /deals/[id]
 *   - PATCH        /deals/[id]/stage
 *   - POST         /ad-spend
 *
 * Mocking strategy mirrors tests/integration/pmf-attributions-seed.test.ts:
 *   - vi.mock("@/lib/admin/api-auth") simulates admin / non-admin /
 *     unauthenticated callers without standing up Firebase.
 *   - vi.mock("@/lib/supabase/admin-client") returns a hand-rolled
 *     method-chain recorder that captures every call (.from, .select,
 *     .eq, .order, .insert, .update, .delete, .upsert, .single,
 *     .maybeSingle) so we can assert against the queries the handler ran.
 *   - vi.mock("next/cache") swallows revalidateTag so the handlers can
 *     call it under test without trying to reach the real cache layer.
 *
 * The mock supabase is intentionally generic — it doesn't know about
 * pmf_prospects vs pmf_deals etc. Per-test we drive its behaviour with
 * a small `nextResult` queue + per-table data overrides, and inspect
 * `recordedCalls` to verify what the handler did.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest, NextResponse } from "next/server";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

const recordedCalls: RecordedCall[] = [];

type DbResult = { data: unknown; error: { code?: string; message: string } | null };

// Per-test overrides: queue of results consumed in FIFO order by terminal ops
// (.single / .maybeSingle / await). When empty, we fall through to default
// behaviour (success, no rows).
let resultQueue: DbResult[] = [];

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
      return { uid: "admin-uid", email: "admin@ops.test", claims: {} };
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

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => makeMockClient(),
}));

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  insert: (rows: unknown) => MockBuilder;
  update: (vals: unknown) => MockBuilder;
  delete: () => MockBuilder;
  upsert: (rows: unknown, opts?: unknown) => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  order: (col: string, opts?: unknown) => MockBuilder;
  single: () => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
  // Builder is awaitable for terminal calls without .single() (e.g. plain
  // delete / upsert / list-style select).
  then: (onFulfilled: (v: DbResult) => unknown) => Promise<unknown>;
}

function makeMockClient() {
  return {
    from(table: string): MockBuilder {
      const record = (method: string, ...args: unknown[]) =>
        recordedCalls.push({ table, method, args });

      const consumeResult = (): DbResult => {
        if (resultQueue.length > 0) {
          return resultQueue.shift()!;
        }
        return { data: null, error: null };
      };

      const builder: MockBuilder = {
        select: (cols) => {
          record("select", cols);
          return builder;
        },
        insert: (rows) => {
          record("insert", rows);
          return builder;
        },
        update: (vals) => {
          record("update", vals);
          return builder;
        },
        delete: () => {
          record("delete");
          return builder;
        },
        upsert: (rows, opts) => {
          record("upsert", rows, opts);
          return builder;
        },
        eq: (col, val) => {
          record("eq", col, val);
          return builder;
        },
        order: (col, opts) => {
          record("order", col, opts);
          return builder;
        },
        single: async () => {
          record("single");
          return consumeResult();
        },
        maybeSingle: async () => {
          record("maybeSingle");
          return consumeResult();
        },
        then: (onFulfilled) => {
          record("await");
          return Promise.resolve(consumeResult()).then(onFulfilled);
        },
      };
      return builder;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildReq(
  url: string,
  init?: { method?: string; body?: unknown }
): NextRequest {
  const req = new Request(url, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return req as unknown as NextRequest;
}

const VALID_PROSPECT = {
  name: "Acme Roofing",
  company: "Acme Roofing LLC",
  email: "owner@acme.test",
  source: "outbound_cold" as const,
  deal_type: "tier_a" as const,
  first_contact_at: "2026-04-15T10:00:00.000Z",
  first_contact_direction: "outbound" as const,
};

const VALID_PROSPECT_ID = "11111111-1111-1111-1111-111111111111";
const VALID_DEAL_ID = "22222222-2222-2222-2222-222222222222";

function callsFor(table: string): RecordedCall[] {
  return recordedCalls.filter((c) => c.table === table);
}

beforeEach(() => {
  recordedCalls.length = 0;
  resultQueue = [];
  authMode = "admin";
});

// ─── Tests: GET /api/admin/pmf/prospects ─────────────────────────────────────

describe("GET /api/admin/pmf/prospects", () => {
  it("returns 401 when unauthenticated", async () => {
    authMode = "unauthenticated";
    const { GET } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await GET(buildReq("http://localhost/api/admin/pmf/prospects"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not an admin", async () => {
    authMode = "non_admin";
    const { GET } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await GET(buildReq("http://localhost/api/admin/pmf/prospects"));
    expect(res.status).toBe(403);
  });

  it("lists prospects with the deal embed and orders by first_contact_at desc", async () => {
    resultQueue = [{ data: [{ id: VALID_PROSPECT_ID, name: "Acme" }], error: null }];
    const { GET } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await GET(buildReq("http://localhost/api/admin/pmf/prospects"));
    expect(res.status).toBe(200);

    const calls = callsFor("pmf_prospects");
    const select = calls.find((c) => c.method === "select");
    expect(select?.args[0]).toContain("pmf_deals");
    expect(select?.args[0]).toContain("!inner");

    const order = calls.find((c) => c.method === "order");
    expect(order?.args[0]).toBe("first_contact_at");
    expect(order?.args[1]).toEqual({ ascending: false });
  });

  it("filters by deal_type when ?deal_type=tier_a is supplied", async () => {
    resultQueue = [{ data: [], error: null }];
    const { GET } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await GET(
      buildReq("http://localhost/api/admin/pmf/prospects?deal_type=tier_a")
    );
    expect(res.status).toBe(200);

    const eqCalls = callsFor("pmf_prospects").filter((c) => c.method === "eq");
    expect(
      eqCalls.some((c) => c.args[0] === "deal_type" && c.args[1] === "tier_a")
    ).toBe(true);
  });

  it("returns 500 when the database returns an error", async () => {
    resultQueue = [{ data: null, error: { message: "boom" } }];
    const { GET } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await GET(buildReq("http://localhost/api/admin/pmf/prospects"));
    expect(res.status).toBe(500);
  });
});

// ─── Tests: POST /api/admin/pmf/prospects ────────────────────────────────────

describe("POST /api/admin/pmf/prospects", () => {
  it("returns 403 when caller is not an admin", async () => {
    authMode = "non_admin";
    const { POST } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/prospects", {
        method: "POST",
        body: VALID_PROSPECT,
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when the body is invalid (missing name)", async () => {
    const { POST } = await import("@/app/api/admin/pmf/prospects/route");
    const { name: _drop, ...incomplete } = VALID_PROSPECT;
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/prospects", {
        method: "POST",
        body: incomplete,
      })
    );
    expect(res.status).toBe(400);
  });

  it("inserts the prospect and an initial deal at stage=contacted", async () => {
    const insertedProspect = {
      id: VALID_PROSPECT_ID,
      ...VALID_PROSPECT,
    };
    // Two terminal results: prospect insert .single() then deal insert (await)
    resultQueue = [
      { data: insertedProspect, error: null },
      { data: null, error: null },
    ];
    const { POST } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/prospects", {
        method: "POST",
        body: VALID_PROSPECT,
      })
    );
    expect(res.status).toBe(200);

    const prospectInsert = callsFor("pmf_prospects").find(
      (c) => c.method === "insert"
    );
    expect(prospectInsert).toBeDefined();
    const prospectRow = prospectInsert!.args[0] as Record<string, unknown>;
    expect(prospectRow.name).toBe(VALID_PROSPECT.name);
    expect(prospectRow.deal_type).toBe("tier_a");

    const dealInsert = callsFor("pmf_deals").find(
      (c) => c.method === "insert"
    );
    expect(dealInsert).toBeDefined();
    const dealRow = dealInsert!.args[0] as Record<string, unknown>;
    expect(dealRow.prospect_id).toBe(VALID_PROSPECT_ID);
    expect(dealRow.stage).toBe("contacted");
    expect(dealRow.deal_type).toBe("tier_a");

    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe(VALID_PROSPECT_ID);
  });

  it("returns 500 when the prospect insert fails", async () => {
    resultQueue = [{ data: null, error: { message: "insert failed" } }];
    const { POST } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/prospects", {
        method: "POST",
        body: VALID_PROSPECT,
      })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when the auto-deal insert fails and runs compensating delete", async () => {
    // Three terminal results in order:
    //   1. prospect insert .single() → success
    //   2. deal insert (await) → failure
    //   3. compensating prospect delete (await) → success
    resultQueue = [
      { data: { id: VALID_PROSPECT_ID, ...VALID_PROSPECT }, error: null },
      { data: null, error: { message: "deal insert failed" } },
      { data: null, error: null },
    ];
    const { POST } = await import("@/app/api/admin/pmf/prospects/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/prospects", {
        method: "POST",
        body: VALID_PROSPECT,
      })
    );
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("rolled back");

    // Assert the call sequence: prospect insert → deal insert →
    // compensating prospect delete keyed by the prospect id.
    const prospectCalls = callsFor("pmf_prospects");
    const insertIdx = prospectCalls.findIndex((c) => c.method === "insert");
    const deleteIdx = prospectCalls.findIndex((c) => c.method === "delete");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(insertIdx);

    const eqAfterDelete = prospectCalls
      .slice(deleteIdx)
      .find((c) => c.method === "eq");
    expect(eqAfterDelete?.args).toEqual(["id", VALID_PROSPECT_ID]);
  });

  it("logs CRITICAL error if compensating delete also fails", async () => {
    // Three terminal results: prospect insert ok, deal insert fails,
    // compensating delete ALSO fails — orphan exists, we must scream.
    resultQueue = [
      { data: { id: VALID_PROSPECT_ID, ...VALID_PROSPECT }, error: null },
      { data: null, error: { message: "deal insert failed" } },
      { data: null, error: { message: "delete also failed" } },
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { POST } = await import("@/app/api/admin/pmf/prospects/route");
      const res = await POST(
        buildReq("http://localhost/api/admin/pmf/prospects", {
          method: "POST",
          body: VALID_PROSPECT,
        })
      );
      expect(res.status).toBe(500);

      const criticalCall = errorSpy.mock.calls.find((args) =>
        args.some(
          (a) => typeof a === "string" && a.includes("CRITICAL")
        )
      );
      expect(criticalCall).toBeDefined();
      // Prospect id must appear somewhere in the CRITICAL call args so
      // it is grep-able in Vercel logs.
      expect(
        criticalCall!.some(
          (a) => typeof a === "string" && a.includes(VALID_PROSPECT_ID)
        )
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ─── Tests: GET /api/admin/pmf/prospects/[id] ────────────────────────────────

describe("GET /api/admin/pmf/prospects/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    authMode = "unauthenticated";
    const { GET } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await GET(
      buildReq(`http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}`),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the prospect is not found", async () => {
    resultQueue = [{ data: null, error: null }];
    const { GET } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await GET(
      buildReq(`http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}`),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(404);
  });

  it("uses the nested deals/events embed syntax", async () => {
    resultQueue = [
      {
        data: { id: VALID_PROSPECT_ID, name: "Acme", pmf_deals: [] },
        error: null,
      },
    ];
    const { GET } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await GET(
      buildReq(`http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}`),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(200);

    const select = callsFor("pmf_prospects").find(
      (c) => c.method === "select"
    );
    expect(select?.args[0]).toContain("pmf_deals(*, pmf_deal_events(*))");

    const eq = callsFor("pmf_prospects").find((c) => c.method === "eq");
    expect(eq?.args).toEqual(["id", VALID_PROSPECT_ID]);
  });
});

// ─── Tests: PATCH /api/admin/pmf/prospects/[id] ──────────────────────────────

describe("PATCH /api/admin/pmf/prospects/[id]", () => {
  it("returns 400 when the body fails validation", async () => {
    const { PATCH } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await PATCH(
      buildReq(`http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}`, {
        method: "PATCH",
        body: { source: "not_a_real_source" },
      }),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(400);
  });

  it("updates the prospect and returns the new row", async () => {
    const updated = { id: VALID_PROSPECT_ID, name: "Renamed", source: "referral" };
    resultQueue = [{ data: updated, error: null }];
    const { PATCH } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await PATCH(
      buildReq(`http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}`, {
        method: "PATCH",
        body: { name: "Renamed" },
      }),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(200);

    const update = callsFor("pmf_prospects").find((c) => c.method === "update");
    expect(update?.args[0]).toEqual({ name: "Renamed" });

    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe(VALID_PROSPECT_ID);
  });
});

// ─── Tests: DELETE /api/admin/pmf/prospects/[id] ─────────────────────────────

describe("DELETE /api/admin/pmf/prospects/[id]", () => {
  it("deletes the prospect and returns ok when ?confirm=1 is supplied", async () => {
    resultQueue = [{ data: null, error: null }];
    const { DELETE } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await DELETE(
      buildReq(
        `http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}?confirm=1`,
        { method: "DELETE" }
      ),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(200);

    const del = callsFor("pmf_prospects").find((c) => c.method === "delete");
    expect(del).toBeDefined();
    const eq = callsFor("pmf_prospects").find((c) => c.method === "eq");
    expect(eq?.args).toEqual(["id", VALID_PROSPECT_ID]);

    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("returns 400 when DELETE is missing ?confirm=1 and never touches the DB", async () => {
    const { DELETE } = await import("@/app/api/admin/pmf/prospects/[id]/route");
    const res = await DELETE(
      buildReq(
        `http://localhost/api/admin/pmf/prospects/${VALID_PROSPECT_ID}`,
        { method: "DELETE" }
      ),
      { params: Promise.resolve({ id: VALID_PROSPECT_ID }) }
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("confirm");

    // No supabase.delete() call should have been made.
    const del = callsFor("pmf_prospects").find((c) => c.method === "delete");
    expect(del).toBeUndefined();
  });
});

// ─── Tests: PATCH /api/admin/pmf/deals/[id] ──────────────────────────────────

describe("PATCH /api/admin/pmf/deals/[id]", () => {
  it("returns 400 on an invalid stage value", async () => {
    const { PATCH } = await import("@/app/api/admin/pmf/deals/[id]/route");
    const res = await PATCH(
      buildReq(`http://localhost/api/admin/pmf/deals/${VALID_DEAL_ID}`, {
        method: "PATCH",
        body: { stage: "not_a_real_stage" },
      }),
      { params: Promise.resolve({ id: VALID_DEAL_ID }) }
    );
    expect(res.status).toBe(400);
  });

  it("updates the deal and returns the new row", async () => {
    resultQueue = [
      {
        data: { id: VALID_DEAL_ID, sow_signed_at: "2026-04-20T10:00:00.000Z" },
        error: null,
      },
    ];
    const { PATCH } = await import("@/app/api/admin/pmf/deals/[id]/route");
    const res = await PATCH(
      buildReq(`http://localhost/api/admin/pmf/deals/${VALID_DEAL_ID}`, {
        method: "PATCH",
        body: { sow_signed_at: "2026-04-20T10:00:00.000Z" },
      }),
      { params: Promise.resolve({ id: VALID_DEAL_ID }) }
    );
    expect(res.status).toBe(200);

    const update = callsFor("pmf_deals").find((c) => c.method === "update");
    expect(update?.args[0]).toEqual({ sow_signed_at: "2026-04-20T10:00:00.000Z" });
  });
});

// ─── Tests: PATCH /api/admin/pmf/deals/[id]/stage ────────────────────────────

describe("PATCH /api/admin/pmf/deals/[id]/stage", () => {
  it("returns 400 on an invalid stage", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/pmf/deals/[id]/stage/route"
    );
    const res = await PATCH(
      buildReq(
        `http://localhost/api/admin/pmf/deals/${VALID_DEAL_ID}/stage`,
        { method: "PATCH", body: { stage: "garbage" } }
      ),
      { params: Promise.resolve({ id: VALID_DEAL_ID }) }
    );
    expect(res.status).toBe(400);
  });

  it("updates only the stage column (trigger handles stage_entered_at)", async () => {
    resultQueue = [
      { data: { id: VALID_DEAL_ID, stage: "qualified" }, error: null },
    ];
    const { PATCH } = await import(
      "@/app/api/admin/pmf/deals/[id]/stage/route"
    );
    const res = await PATCH(
      buildReq(
        `http://localhost/api/admin/pmf/deals/${VALID_DEAL_ID}/stage`,
        { method: "PATCH", body: { stage: "qualified" } }
      ),
      { params: Promise.resolve({ id: VALID_DEAL_ID }) }
    );
    expect(res.status).toBe(200);

    const update = callsFor("pmf_deals").find((c) => c.method === "update");
    expect(update?.args[0]).toEqual({ stage: "qualified" });
    // The handler must NOT manually set stage_entered_at — the DB trigger
    // does that.
    expect(
      Object.prototype.hasOwnProperty.call(
        update!.args[0] as Record<string, unknown>,
        "stage_entered_at"
      )
    ).toBe(false);
  });
});

// ─── Tests: POST /api/admin/pmf/ad-spend ─────────────────────────────────────

describe("POST /api/admin/pmf/ad-spend", () => {
  it("returns 400 on an invalid month format", async () => {
    const { POST } = await import("@/app/api/admin/pmf/ad-spend/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/ad-spend", {
        method: "POST",
        body: { channel: "google_ads", month: "not-a-month", spend_cents: 1000 },
      })
    );
    expect(res.status).toBe(400);
  });

  it("splits an even monthly spend into one row per day (April 2026, 30 days)", async () => {
    resultQueue = [{ data: null, error: null }];
    const { POST } = await import("@/app/api/admin/pmf/ad-spend/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/ad-spend", {
        method: "POST",
        body: {
          channel: "google_ads",
          month: "2026-04",
          spend_cents: 30000,
        },
      })
    );
    expect(res.status).toBe(200);

    const upsert = callsFor("ad_spend_log").find((c) => c.method === "upsert");
    expect(upsert).toBeDefined();
    const rows = upsert!.args[0] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(30);

    // Even split: 30000 / 30 = 1000, remainder 0 → every row 1000
    expect(rows[0].spend_cents).toBe(1000);
    expect(rows[15].spend_cents).toBe(1000);
    expect(rows[29].spend_cents).toBe(1000);

    // Verify per-row metadata.
    expect(rows[0].channel).toBe("google_ads");
    expect(rows[0].source).toBe("manual_entry");
    expect(rows[0].entered_by).toBe("admin@ops.test");
    expect(rows[0].spend_date).toBe("2026-04-01");
    expect(rows[29].spend_date).toBe("2026-04-30");

    // upsert opts: onConflict on (channel, spend_date)
    expect(upsert!.args[1]).toEqual({ onConflict: "channel,spend_date" });

    const json = (await res.json()) as { ok: boolean; days: number };
    expect(json.ok).toBe(true);
    expect(json.days).toBe(30);
  });

  it("puts the remainder on day 1 for a non-even split (Feb 2026 = 28 days, 1000 cents)", async () => {
    resultQueue = [{ data: null, error: null }];
    const { POST } = await import("@/app/api/admin/pmf/ad-spend/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/ad-spend", {
        method: "POST",
        body: {
          channel: "meta_ads",
          month: "2026-02",
          spend_cents: 1000,
        },
      })
    );
    expect(res.status).toBe(200);

    const upsert = callsFor("ad_spend_log").find((c) => c.method === "upsert");
    const rows = upsert!.args[0] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(28);

    // 1000 / 28 = 35 (floor), remainder = 1000 - 35*28 = 20 → row 0 = 55
    expect(rows[0].spend_cents).toBe(55);
    expect(rows[1].spend_cents).toBe(35);
    expect(rows[27].spend_cents).toBe(35);

    // Verify the dates roll over correctly across the month.
    expect(rows[0].spend_date).toBe("2026-02-01");
    expect(rows[27].spend_date).toBe("2026-02-28");
  });

  it("returns 401 when unauthenticated", async () => {
    authMode = "unauthenticated";
    const { POST } = await import("@/app/api/admin/pmf/ad-spend/route");
    const res = await POST(
      buildReq("http://localhost/api/admin/pmf/ad-spend", {
        method: "POST",
        body: { channel: "google_ads", month: "2026-04", spend_cents: 1000 },
      })
    );
    expect(res.status).toBe(401);
  });
});
