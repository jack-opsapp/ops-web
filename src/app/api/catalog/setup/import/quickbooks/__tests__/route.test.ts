import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { serviceItem, nonInventoryItem } from "@/lib/catalog-setup/import/__fixtures__/qb-items";

const {
  verifyAuthToken,
  findUserByAuth,
  checkPermissionById,
  serviceFrom,
  getValidToken,
  pullItems,
  ReconnectRequiredError,
  qbWriteCallsRef,
} = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  serviceFrom: vi.fn(),
  getValidToken: vi.fn(),
  pullItems: vi.fn(),
  ReconnectRequiredError: class ReconnectRequiredError extends Error {},
  qbWriteCallsRef: { value: 0 },
}));

// vi.hoisted runs before imports — set the gate ON before the route module evals
// (a plain `process.env.X =` after the imports would run too late, ESM-hoisted).
vi.hoisted(() => {
  process.env.CATALOG_QB_IMPORT_ENABLED = "true";
  delete process.env.CATALOG_QB_IMPORT_COMPANY_ALLOWLIST;
});

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAuthToken }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: serviceFrom }),
}));
vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: { getValidToken },
  ReconnectRequiredError,
}));
vi.mock("@/lib/api/services/quickbooks-pull-service", () => ({
  QuickBooksPullService: class {
    pullItems = pullItems;
    get qbWriteCalls() {
      return qbWriteCallsRef.value;
    }
  },
}));
vi.mock("@/lib/api/services/quickbooks-config", () => ({
  getQuickBooksProviderEnvironment: () => "sandbox",
}));

import { POST } from "../route";

const makeReq = (body: unknown): NextRequest =>
  ({ json: async () => body }) as unknown as NextRequest;

/** Builds a chainable supabase query stub resolving to `result`. */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.is = () => Promise.resolve(result);
  b.maybeSingle = () => Promise.resolve(result);
  return b;
}

/** Wire serviceFrom to return per-table data. */
function wireTables(opts: {
  connection?: { data: unknown; error?: unknown };
  inventory?: { data: unknown };
  products?: { data: unknown };
}) {
  serviceFrom.mockImplementation((table: string) => {
    if (table === "accounting_connections")
      return builder({ data: opts.connection?.data ?? null, error: opts.connection?.error ?? null });
    if (table === "company_inventory_settings")
      return builder({ data: opts.inventory?.data ?? null, error: null });
    if (table === "products")
      return builder({ data: opts.products?.data ?? [], error: null });
    return builder({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  qbWriteCallsRef.value = 0;
  verifyAuthToken.mockResolvedValue({ uid: "fb-1", email: "op@co.com" });
  findUserByAuth.mockResolvedValue({ id: "u-1", company_id: "co-1" });
  checkPermissionById.mockResolvedValue(true);
  getValidToken.mockResolvedValue({
    accessToken: "tok",
    realmId: "realm-1",
    providerEnvironment: "sandbox",
  });
  pullItems.mockResolvedValue([serviceItem, nonInventoryItem]);
  wireTables({
    connection: { data: { id: "conn-1", is_connected: true } },
    inventory: { data: { inventory_mode: "off" } },
    products: { data: [] },
  });
});

describe("POST /api/catalog/setup/import/quickbooks", () => {
  it("pulls + maps + classifies QB items into proposed SELL cards", async () => {
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.connected).toBe(true);
    expect(json.cards).toHaveLength(2);
    expect(json.cards.every((c: { module: string }) => c.module === "sell")).toBe(true);
    expect(json.cards.every((c: { state: string }) => c.state === "proposed")).toBe(true);
    expect(json.cards.every((c: { externalSource: string }) => c.externalSource === "quickbooks")).toBe(true);
    expect(json.summary).toMatchObject({ pulled: 2, staged: 2, matched: 0 });
    expect(json.qbWriteCalls).toBe(0);
  });

  it("re-pull binds a matching live row as a merge card (idempotent, no duplicate)", async () => {
    // serviceItem (Id 42) already lives in the catalog — re-pull must MERGE.
    wireTables({
      connection: { data: { id: "conn-1", is_connected: true } },
      inventory: { data: { inventory_mode: "off" } },
      products: {
        data: [
          {
            id: "prod-42",
            name: "Roof inspection",
            sku: "INSP-01",
            base_price: 150,
            unit_cost: null,
            is_taxable: false,
            kind: "service",
            type: "LABOR",
            external_source: "quickbooks",
            external_id: "42",
          },
        ],
      },
    });
    const res = await POST(makeReq({ token: "t" }));
    const json = await res.json();
    const merged = json.cards.find((c: { id: string }) => c.id === "qb:42");
    expect(merged.state).toBe("merge");
    expect(merged.matchedExistingId).toBe("prod-42");
    expect(json.summary.matched).toBe(1);
    expect(json.existingRows["prod-42"]).toMatchObject({ name: "Roof inspection" });
  });

  it("returns connected:false when there is no live QuickBooks connection", async () => {
    wireTables({ connection: { data: null } });
    const res = await POST(makeReq({ token: "t" }));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, connected: false });
  });

  it("returns reconnect:true when the refresh token is stale", async () => {
    getValidToken.mockRejectedValue(new ReconnectRequiredError("QuickBooks"));
    const res = await POST(makeReq({ token: "t" }));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, connected: false, reconnect: true });
  });

  it("fails the run when the read-only invariant is violated (qbWriteCalls != 0)", async () => {
    qbWriteCallsRef.value = 1;
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(500);
  });

  it("403 when the operator lacks catalog.run_setup", async () => {
    checkPermissionById.mockResolvedValue(false);
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(403);
    expect(pullItems).not.toHaveBeenCalled();
  });

  it("400 when the token is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("404 (dark) when the import flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("CATALOG_QB_IMPORT_ENABLED", "");
    const mod = await import("../route");
    const res = await mod.POST(makeReq({ token: "t" }));
    expect(res.status).toBe(404);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
