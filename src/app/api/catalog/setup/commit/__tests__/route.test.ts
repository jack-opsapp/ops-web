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

// Captures the service-role UPDATE/INSERTs a commit issues (completion stamp,
// external-id stamp, unit_cost stamp) so a test can assert what was written.
let serviceWrites: Array<{ table: string; op: "update" | "insert"; values: Record<string, unknown> }>;

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
  serviceWrites = [];
  // Chainable query-builder stub: from().update()/insert().eq().eq() all return
  // the same thenable chain (resolves { error: null }), so one- and two-eq scopes
  // both work; update/insert payloads are captured for assertions.
  serviceFrom.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {
      update(values: Record<string, unknown>) {
        serviceWrites.push({ table, op: "update", values });
        return chain;
      },
      insert(values: Record<string, unknown>) {
        serviceWrites.push({ table, op: "insert", values });
        return chain;
      },
      eq: () => chain,
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    return chain;
  });
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
    // Content-addressed key: session:mode:products:<16-hex payload hash>.
    expect(args.p_idempotency_key).toMatch(/^sess-1:edit:products:[0-9a-f]{16}$/);
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

  it("discloses partial counts when a later call fails after products committed", async () => {
    rpc
      .mockResolvedValueOnce({ data: { ok: true, counts: { products: 2 } }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    const stockCard = {
      id: "s1",
      source: "manual",
      state: "accepted",
      module: "stock",
      fields: { name: "Screws", quantity: 5, unitCost: 1, reorderPoint: 1 },
    };
    const res = await POST(
      makeReq({ token: "t", sessionId: "sp", cards: [sellCard, stockCard] }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.partial.products).toBe(2); // products are live; do not imply "nothing saved"
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
    // Keyed by stable card id (a, b), not array index, plus a payload hash.
    expect(keys.some((k) => /^sess-9:edit:family:a:[0-9a-f]{16}$/.test(k))).toBe(true);
    expect(keys.some((k) => /^sess-9:edit:family:b:[0-9a-f]{16}$/.test(k))).toBe(true);
  });

  it("merge commit: mixed per-field verdicts apply, and non-diffed columns + activation stay on file", async () => {
    const mergeCard = {
      id: "c1",
      source: "import",
      state: "merge",
      module: "sell",
      matchedExistingId: "live-7",
      // keep the on-file PRICE, take the incoming NAME (is_taxable unspecified → take)
      fieldSelections: { base_price: false, name: true },
      fields: {
        name: "Renamed by import",
        defaultPrice: 95, // incoming price (rejected)
        unitCost: 40,
        sku: "NEW-SKU",
        isTaxable: true, // incoming (accepted by default)
        kind: "service",
        type: "LABOR",
      },
    };
    const res = await POST(
      makeReq({
        token: "t",
        sessionId: "sess-r",
        cards: [mergeCard],
        existingRows: {
          "live-7": {
            name: "On-file name",
            description: "On-file description", // not diffed → must survive
            defaultPrice: 80, // on-file price (the verdict keeps this)
            unitCost: 30,
            sku: "OLD-SKU",
            isTaxable: false, // owner takes incoming true over this
            kind: "material",
            categoryId: "cat-1",
            isActive: false, // RETIRED — must NOT be reactivated
            showInStorefront: false,
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    const p = rpc.mock.calls[0][1].p_payload.products[0];
    expect(p.id).toBe("live-7"); // UPSERT into the live row
    // accepted verdicts → incoming; rejected → on-file
    expect(p.name).toBe("Renamed by import");
    expect(p.base_price).toBe(80); // rejected price kept on file (mirrored)
    expect(p.default_price).toBe(80);
    expect(p.is_taxable).toBe(true); // unspecified → take incoming
    // the rest stays on file — never wiped, never reactivated
    expect(p.description).toBe("On-file description");
    expect(p.category_id).toBe("cat-1");
    expect(p.sku).toBe("OLD-SKU");
    expect(p.kind).toBe("material");
    expect(p.is_active).toBe(false); // retired product is NOT reactivated
    expect(p.show_in_storefront).toBe(false);
  });

  it("stamps unit_cost on a CREATED product after commit (catalog_setup_save never writes it)", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, counts: { products: 1 }, id_map: { c1: "row-new" } },
      error: null,
    });
    const res = await POST(
      makeReq({
        token: "t",
        sessionId: "sess-cost",
        cards: [
          {
            id: "c1",
            source: "manual",
            state: "accepted",
            module: "sell",
            fields: {
              name: "New service",
              defaultPrice: 100,
              unitCost: 40,
              isTaxable: true,
              kind: "service",
              type: "LABOR",
            },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const costWrite = serviceWrites.find(
      (w) => w.table === "products" && "unit_cost" in w.values,
    );
    expect(costWrite?.values).toEqual({ unit_cost: 40 });
  });

  it("does NOT stamp unit_cost on a merge card (the on-file cost is preserved, not overwritten)", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, counts: { products: 1 }, id_map: {} },
      error: null,
    });
    const res = await POST(
      makeReq({
        token: "t",
        sessionId: "sess-cost2",
        cards: [
          {
            id: "c1",
            source: "import",
            state: "merge",
            module: "sell",
            matchedExistingId: "live-7",
            fields: {
              name: "X",
              defaultPrice: 95,
              unitCost: 40, // incoming cost — must NOT overwrite the on-file 30
              isTaxable: true,
              kind: "service",
              type: "LABOR",
            },
          },
        ],
        existingRows: {
          "live-7": {
            name: "X",
            defaultPrice: 80,
            unitCost: 30,
            isTaxable: true,
            kind: "service",
            isActive: true,
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(serviceWrites.find((w) => "unit_cost" in w.values)).toBeUndefined();
  });

  it("content-addressed key: identical set replays the key, a changed set gets a fresh one", async () => {
    const base = { token: "t", sessionId: "sess-c", cards: [sellCard] };
    await POST(makeReq(base));
    await POST(makeReq(base)); // identical payload → same key (RPC replays, no double-commit)
    const edited = {
      ...base,
      cards: [{ ...sellCard, fields: { ...sellCard.fields, defaultPrice: 120 } }],
    };
    await POST(makeReq(edited)); // changed payload → fresh key (reprocess, not idempotency_conflict)
    const keys = rpc.mock.calls.map((c) => c[1].p_idempotency_key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
