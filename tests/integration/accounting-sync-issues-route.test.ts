import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const tableCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

const state = {
  connection: { id: "conn-1" },
  issues: [
    {
      id: "q-1",
      entity_type: "invoice",
      entity_id: "d9f024cf-f8b0-4e0c-9930-459e3b49660b",
      external_id: "180",
      operation: "update",
      status: "needs_review",
      last_error: "QuickBooks validation failed",
      updated_at: "2026-06-07T12:00:00.000Z",
    },
  ],
};

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: (request: unknown) => verifyAdminAuth(request),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserByAuth(...args),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...args: unknown[]) => checkPermissionById(...args),
}));
vi.mock("@/lib/api/services/quickbooks-config", () => ({
  getQuickBooksProviderEnvironment: () => "sandbox",
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      const builder: any = {
        select: (...args: unknown[]) => {
          tableCalls.push({ table, method: "select", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          tableCalls.push({ table, method: "eq", args });
          return builder;
        },
        in: (...args: unknown[]) => {
          tableCalls.push({ table, method: "in", args });
          return builder;
        },
        order: (...args: unknown[]) => {
          tableCalls.push({ table, method: "order", args });
          return builder;
        },
        limit: (...args: unknown[]) => {
          tableCalls.push({ table, method: "limit", args });
          return Promise.resolve({ data: state.issues, error: null });
        },
        maybeSingle: () => Promise.resolve({ data: state.connection, error: null }),
      };
      return builder;
    },
  }),
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";

function req(companyId = CO) {
  return new Request(`http://localhost/api/integrations/accounting/sync-issues?companyId=${companyId}`, {
    method: "GET",
    headers: { Authorization: "Bearer test-jwt" },
  }) as never;
}

async function route() {
  return (await import("@/app/api/integrations/accounting/sync-issues/route")).GET;
}

describe("GET /api/integrations/accounting/sync-issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableCalls.length = 0;
    state.connection = { id: "conn-1" };
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "owner@ops.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
  });

  it("401s without auth", async () => {
    verifyAdminAuth.mockResolvedValue(null);

    const GET = await route();
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(tableCalls).toEqual([]);
  });

  it("403s for a different company", async () => {
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "other-co" });

    const GET = await route();
    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(tableCalls).toEqual([]);
  });

  it("returns active-environment blocked and review queue rows", async () => {
    const GET = await route();
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.issues).toEqual([
      {
        id: "q-1",
        entityType: "invoice",
        entityId: "d9f024cf-f8b0-4e0c-9930-459e3b49660b",
        externalId: "180",
        operation: "update",
        status: "needs_review",
        lastError: "QuickBooks validation failed",
        updatedAt: "2026-06-07T12:00:00.000Z",
      },
    ]);
    expect(tableCalls).toEqual(
      expect.arrayContaining([
        { table: "accounting_connections", method: "eq", args: ["provider_environment", "sandbox"] },
        { table: "accounting_sync_queue", method: "eq", args: ["connection_id", "conn-1"] },
        { table: "accounting_sync_queue", method: "in", args: ["status", ["blocked", "needs_review"]] },
      ])
    );
  });
});
