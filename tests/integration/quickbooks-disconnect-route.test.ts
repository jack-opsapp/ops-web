import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const selectEqCall = vi.fn();
const updateEqCall = vi.fn();
const updateCall = vi.fn();
const single = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: (request: unknown) => verifyAdminAuth(request),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserByAuth(...args),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...args: unknown[]) => checkPermissionById(...args),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => {
        const chain = {
          eq: (column: string, value: unknown) => {
            selectEqCall(column, value);
            return chain;
          },
          single: () => single(),
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        updateCall(patch);
        const chain = {
          eq: (column: string, value: unknown) => {
            updateEqCall(column, value);
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

function req(body: unknown) {
  return new Request("http://localhost/api/integrations/quickbooks", {
    method: "DELETE",
    headers: { Authorization: "Bearer test-jwt" },
    body: JSON.stringify(body),
  }) as never;
}

async function route() {
  return (await import("@/app/api/integrations/quickbooks/route")).DELETE;
}

describe("DELETE /api/integrations/quickbooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("QB_ACTIVE_PROFILE", "production");
    vi.stubEnv("QB_CLIENT_ID", "prod-client");
    vi.stubEnv("QB_CLIENT_SECRET", "prod-secret");
    vi.stubEnv("QB_SANDBOX_CLIENT_ID", "sandbox-client");
    vi.stubEnv("QB_SANDBOX_CLIENT_SECRET", "sandbox-secret");
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "owner@ops.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    single.mockResolvedValue({
      data: { access_token: null, refresh_token: null },
      error: null,
    });
    maybeSingle.mockResolvedValue({ data: { id: "conn-1" }, error: null });
  });

  it("401s without a verified user", async () => {
    verifyAdminAuth.mockResolvedValue(null);

    const DELETE = await route();
    const res = await DELETE(req({ companyId: CO, providerEnvironment: "sandbox" }));

    expect(res.status).toBe(401);
    expect(updateCall).not.toHaveBeenCalled();
  });

  it("disconnects the requested QuickBooks provider environment", async () => {
    const DELETE = await route();
    const res = await DELETE(req({ companyId: CO, providerEnvironment: "sandbox" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, providerEnvironment: "sandbox" });
    expect(selectEqCall).toHaveBeenCalledWith("provider_environment", "sandbox");
    expect(updateEqCall).toHaveBeenCalledWith("provider_environment", "sandbox");
    expect(updateCall).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        realm_id: null,
        realm_id_lookup: null,
        is_connected: false,
        sync_enabled: false,
        updated_at: expect.any(String),
      })
    );
  });

  it("404s when no selected connection row was updated", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const DELETE = await route();
    const res = await DELETE(req({ companyId: CO, providerEnvironment: "sandbox" }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("No quickbooks sandbox connection found");
  });
});
