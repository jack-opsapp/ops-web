// tests/integration/accounting-sync-mode-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const updateCall = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updateCall(patch);
        return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => maybeSingle() }) }) }) };
      },
    }),
  }),
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function post(body: unknown) {
  return new Request("http://localhost/api/integrations/accounting/sync-mode", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}
async function route() {
  return (await import("@/app/api/integrations/accounting/sync-mode/route")).POST;
}

describe("POST /api/integrations/accounting/sync-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    maybeSingle.mockResolvedValue({ data: { id: "conn-1" }, error: null });
  });

  it("401 without auth", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncDirection: "bidirectional" }));
    expect(res.status).toBe(401);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("400 for an invalid syncDirection (e.g. push_only)", async () => {
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncDirection: "push_only" }));
    expect(res.status).toBe(400);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("403 for a different company", async () => {
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "other-co" });
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncDirection: "bidirectional" }));
    expect(res.status).toBe(403);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("403 without accounting.manage_connections", async () => {
    checkPermissionById.mockResolvedValue(false);
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncDirection: "bidirectional" }));
    expect(res.status).toBe(403);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("persists bidirectional + propagateDeletes", async () => {
    const POST = await route();
    const res = await POST(
      post({ companyId: CO, provider: "quickbooks", syncDirection: "bidirectional", propagateDeletes: true })
    );
    expect(res.status).toBe(200);
    expect(updateCall).toHaveBeenCalledWith(
      expect.objectContaining({ sync_direction: "bidirectional", propagate_deletes: true })
    );
  });

  it("forces propagate_deletes=false when read-only (no writes at all)", async () => {
    const POST = await route();
    const res = await POST(
      post({ companyId: CO, provider: "quickbooks", syncDirection: "pull_only", propagateDeletes: true })
    );
    expect(res.status).toBe(200);
    expect(updateCall).toHaveBeenCalledWith(
      expect.objectContaining({ sync_direction: "pull_only", propagate_deletes: false })
    );
  });

  it("404 when no connection matches", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const POST = await route();
    const res = await POST(post({ companyId: CO, provider: "quickbooks", syncDirection: "bidirectional" }));
    expect(res.status).toBe(404);
  });
});
