import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const upsertCall = vi.fn();

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
        const builder = {
          eq: () => builder,
          neq: () => builder,
          limit: () => Promise.resolve({ data: [], error: null }),
        };
        return builder;
      },
      upsert: (...args: unknown[]) => {
        upsertCall(...args);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";

function req(body: unknown) {
  return new Request("http://localhost/api/integrations/quickbooks", {
    method: "POST",
    headers: { Authorization: "Bearer test-jwt" },
    body: JSON.stringify(body),
  }) as never;
}

async function route() {
  return (await import("@/app/api/integrations/quickbooks/route")).POST;
}

describe("POST /api/integrations/quickbooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("QB_ACTIVE_PROFILE", "sandbox");
    vi.stubEnv("QB_SANDBOX_CLIENT_ID", "sandbox-client");
    vi.stubEnv("QB_SANDBOX_CLIENT_SECRET", "sandbox-secret");
    vi.stubEnv(
      "QB_SANDBOX_REDIRECT_URI",
      "https://sandbox.example.test/api/integrations/quickbooks/callback"
    );
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "owner@ops.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
  });

  it("401s before writing OAuth state when unauthenticated", async () => {
    verifyAdminAuth.mockResolvedValue(null);

    const POST = await route();
    const res = await POST(req({ companyId: CO }));

    expect(res.status).toBe(401);
    expect(upsertCall).not.toHaveBeenCalled();
  });

  it("403s before writing OAuth state for a different company", async () => {
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "other-co" });

    const POST = await route();
    const res = await POST(req({ companyId: CO }));

    expect(res.status).toBe(403);
    expect(upsertCall).not.toHaveBeenCalled();
  });

  it("403s before writing OAuth state without accounting.manage_connections", async () => {
    checkPermissionById.mockResolvedValue(false);

    const POST = await route();
    const res = await POST(req({ companyId: CO }));

    expect(res.status).toBe(403);
    expect(upsertCall).not.toHaveBeenCalled();
  });

  it("stores state only for an authorized company operator", async () => {
    const POST = await route();
    const res = await POST(req({ companyId: CO }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authUrl).toContain("client_id=sandbox-client");
    expect(body.authUrl).toContain("state=");
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: CO,
        provider: "quickbooks",
        provider_environment: "sandbox",
        webhook_verifier_token: expect.stringMatching(
          /^a612edc0-5c18-4c4d-af97-55b9410dd077:sandbox:[a-f0-9]{32}$/
        ),
      }),
      { onConflict: "company_id,provider,provider_environment" }
    );
  });
});
