import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc }),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: vi.fn() }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: vi.fn() }));
vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: vi.fn(async () => []),
}));

import { requirePermission } from "../auth";

const auth = {
  id: "user-1",
  companyId: "co-1",
  role: "operator",
  isManager: false,
  firstName: null,
  lastName: null,
};

describe("requirePermission", () => {
  beforeEach(() => rpc.mockReset());

  it("passes when has_permission returns true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await requirePermission(auth, "agent.review")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("has_permission", {
      p_user_id: "user-1",
      p_permission: "agent.review",
    });
  });

  it("returns 403 when the permission is missing", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await requirePermission(auth, "agent.review");
    expect(res?.status).toBe(403);
  });

  it("fails closed on RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "x" } });
    const res = await requirePermission(auth, "agent.review");
    expect(res?.status).toBe(403);
  });
});
