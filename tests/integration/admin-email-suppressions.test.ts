/**
 * Verifies the admin email-suppression API end-to-end against an
 * in-memory store, with the admin gate stubbed via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { store } = vi.hoisted(() => ({
  store: [] as Array<{ email: string; list: string; reason: string; source: string }>,
}));

vi.mock("@/lib/email/suppressions", () => ({
  addSuppression: vi.fn(async (p: { email: string; list?: string; reason: string; source?: string }) => {
    const row = {
      email: p.email.toLowerCase(),
      list: p.list ?? "global",
      reason: p.reason,
      source: p.source ?? "manual",
    };
    const idx = store.findIndex((r) => r.email === row.email && r.list === row.list);
    if (idx >= 0) store[idx] = row;
    else store.push(row);
    return {
      id: "x",
      ...row,
      sourceEventId: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };
  }),
  listSuppressions: vi.fn(async () => ({
    rows: store.map((r) => ({ ...r, id: "x" })),
    total: store.length,
  })),
  removeSuppression: vi.fn(async (email: string, list: string) => {
    const idx = store.findIndex((r) => r.email === email.toLowerCase() && r.list === list);
    if (idx < 0) return false;
    store.splice(idx, 1);
    return true;
  }),
}));

vi.mock("@/lib/admin/api-auth", () => ({
  withAdmin: (handler: unknown) => handler,
  requireAdmin: vi.fn(async () => ({ email: "admin@opsapp.co" })),
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        ilike: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

import { POST as collectionPOST, GET as collectionGET } from "@/app/api/admin/email/suppressions/route";
import { DELETE as itemDELETE } from "@/app/api/admin/email/suppressions/[email]/route";

beforeEach(() => {
  store.length = 0;
});

function makePost(body: unknown) {
  return new NextRequest(new URL("https://example.com/api/admin/email/suppressions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin email suppressions API", () => {
  it("adds a single suppression", async () => {
    const res = await collectionPOST(makePost({ email: "a@x.com", reason: "manual" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toBe(1);
    expect(store).toHaveLength(1);
    expect(store[0].email).toBe("a@x.com");
  });

  it("rejects invalid reason", async () => {
    const res = await collectionPOST(makePost({ email: "a@x.com", reason: "made_up" }));
    expect(res.status).toBe(400);
  });

  it("requires email or emails", async () => {
    const res = await collectionPOST(makePost({ reason: "manual" }));
    expect(res.status).toBe(400);
  });

  it("adds many suppressions in batch", async () => {
    const emails = ["a@x.com", "B@X.com", "c@x.com"];
    const res = await collectionPOST(makePost({ emails, reason: "import" } as { emails: string[]; reason: string }));
    // 'import' is not a valid reason; expect 400. (reason is suppression reason, not source.)
    expect(res.status).toBe(400);

    const res2 = await collectionPOST(makePost({ emails, reason: "manual" }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).added).toBe(3);
    expect(store.map((r) => r.email).sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("lists suppressions", async () => {
    await collectionPOST(makePost({ email: "a@x.com", reason: "manual" }));
    const res = await collectionGET(new NextRequest(new URL("https://example.com/api/admin/email/suppressions")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.rows[0].email).toBe("a@x.com");
  });

  it("removes a suppression", async () => {
    await collectionPOST(makePost({ email: "a@x.com", reason: "manual" }));
    expect(store).toHaveLength(1);
    const res = await itemDELETE(
      new NextRequest(new URL("https://example.com/api/admin/email/suppressions/a%40x.com")),
      { params: Promise.resolve({ email: "a%40x.com" }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);
    expect(store).toHaveLength(0);
  });
});
