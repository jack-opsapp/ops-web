// tests/integration/accounting-sync-enabled-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const updateCall = vi.fn();
const eqCall = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updateCall(patch);
        const chain = {
          eq: (column: string, value: unknown) => {
            eqCall(column, value);
            return chain;
          },
          select: () => ({ maybeSingle: () => maybeSingle() }),
        };
        return chain;
      },
    }),
  }),
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function post(body: unknown) {
  return new Request("http://localhost/api/integrations/accounting/sync-enabled", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}
async function route() {
  return (await import("@/app/api/integrations/accounting/sync-enabled/route")).POST;
}

describe("POST /api/integrations/accounting/sync-enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QB_ACTIVE_PROFILE = "sandbox";
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    maybeSingle.mockResolvedValue({ data: { id: "conn-1" }, error: null });
  });

  it("401 without auth", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncEnabled: true }));
    expect(res.status).toBe(401);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("400 when syncEnabled is not a boolean", async () => {
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncEnabled: "true" }));
    expect(res.status).toBe(400);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("403 for a different company", async () => {
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "other-co" });
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncEnabled: true }));
    expect(res.status).toBe(403);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("403 without accounting.manage_connections", async () => {
    checkPermissionById.mockResolvedValue(false);
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncEnabled: true }));
    expect(res.status).toBe(403);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("updates the active QuickBooks provider environment only", async () => {
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncEnabled: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.providerEnvironment).toBe("sandbox");
    expect(updateCall).toHaveBeenCalledWith(
      expect.objectContaining({ sync_enabled: true, updated_at: expect.any(String) })
    );
    expect(eqCall).toHaveBeenCalledWith("company_id", CO);
    expect(eqCall).toHaveBeenCalledWith("provider", "quickbooks");
    expect(eqCall).toHaveBeenCalledWith("provider_environment", "sandbox");
  });

  it("404 when no connection matches", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncEnabled: false }));
    expect(res.status).toBe(404);
  });
});
