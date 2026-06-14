import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { verifyAuthToken, findUserByAuth, checkPermissionById, rpc, serviceFrom } =
  vi.hoisted(() => ({
    verifyAuthToken: vi.fn(),
    findUserByAuth: vi.fn(),
    checkPermissionById: vi.fn(),
    rpc: vi.fn(),
    serviceFrom: vi.fn(),
  }));

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAuthToken }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: serviceFrom }),
}));
vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: () => ({ rpc }),
}));

import { POST } from "../route";

const makeReq = (body: unknown): NextRequest =>
  ({ json: async () => body }) as unknown as NextRequest;

const sellCard = {
  id: "c1",
  source: "manual",
  state: "accepted",
  module: "sell",
  fields: {
    name: "Service Call",
    defaultPrice: 95,
    unitCost: 40,
    isTaxable: true,
    kind: "service",
    type: "LABOR",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  serviceFrom.mockImplementation(() => ({
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    insert: vi.fn(async () => ({ error: null })),
  }));
  verifyAuthToken.mockResolvedValue({ uid: "fb-1", email: "op@co.com" });
  findUserByAuth.mockResolvedValue({ id: "u-1", company_id: "co-1" });
  checkPermissionById.mockResolvedValue(true);
  rpc.mockResolvedValue({ data: { ok: true, counts: { products: 1 } }, error: null });
});

describe("POST /api/catalog/setup/commit", () => {
  it("commits accepted products via catalog_setup_save (edit mode, stable key)", async () => {
    const res = await POST(makeReq({ token: "t", sessionId: "sess-1", cards: [sellCard] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.counts.products).toBe(1);

    const args = rpc.mock.calls[0][1];
    expect(args.p_company_id).toBe("co-1");
    expect(args.p_idempotency_key).toBe("sess-1:edit:products");
    expect(args.p_payload.mode).toBe("edit");
    expect(args.p_payload.products).toHaveLength(1);
    // completion stamp + rail notification fired (service-role)
    expect(serviceFrom).toHaveBeenCalled();
  });

  it("400 when token/sessionId/cards missing", async () => {
    const res = await POST(makeReq({ token: "t", cards: [sellCard] }));
    expect(res.status).toBe(400);
  });

  it("404 when the user is not found", async () => {
    findUserByAuth.mockResolvedValue(null);
    const res = await POST(makeReq({ token: "t", sessionId: "s", cards: [sellCard] }));
    expect(res.status).toBe(404);
  });

  it("403 when the user lacks catalog.run_setup", async () => {
    checkPermissionById.mockResolvedValue(false);
    const res = await POST(makeReq({ token: "t", sessionId: "s", cards: [sellCard] }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400 when there are no committable cards", async () => {
    const res = await POST(
      makeReq({ token: "t", sessionId: "s", cards: [{ ...sellCard, state: "proposed" }] }),
    );
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("422 on RPC blockers — does not stamp completion", async () => {
    rpc.mockResolvedValue({
      data: { ok: false, blockers: [{ code: "missing_price" }] },
      error: null,
    });
    const res = await POST(makeReq({ token: "t", sessionId: "s", cards: [sellCard] }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.blockers[0].code).toBe("missing_price");
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  it("422 with a clear scope-mismatch when the accessToken bridge drops email", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "company_scope_mismatch" },
    });
    const res = await POST(makeReq({ token: "t", sessionId: "s", cards: [sellCard] }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.blockers[0].code).toBe("company_scope_mismatch");
  });

  it("loops one RPC call per stock family (single-family contract)", async () => {
    const stockCard = (id: string) => ({
      id,
      source: "manual",
      state: "accepted",
      module: "stock",
      fields: { name: id, quantity: 5, unitCost: 2, reorderPoint: 1 },
    });
    await POST(
      makeReq({ token: "t", sessionId: "sess-9", cards: [stockCard("a"), stockCard("b")] }),
    );
    const keys = rpc.mock.calls.map((c) => c[1].p_idempotency_key);
    expect(keys).toContain("sess-9:edit:family:0");
    expect(keys).toContain("sess-9:edit:family:1");
  });
});
