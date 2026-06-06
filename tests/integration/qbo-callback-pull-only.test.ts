// tests/integration/qbo-callback-pull-only.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateCapture = vi.fn();

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => {
        const builder = {
          eq: () => builder,
          single: () =>
            Promise.resolve({ data: { webhook_verifier_token: "CO:abc" }, error: null }),
        };
        return builder;
      },
      update: (payload: unknown) => {
        updateCapture(payload);
        const builder = {
          eq: () => builder,
          then: (resolve: (value: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return builder;
      },
    }),
  }),
}));
vi.mock("@/lib/utils/app-url", () => ({ getAppUrl: () => "http://localhost" }));

describe("QuickBooks OAuth callback defaults to pull_only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QB_CLIENT_ID = "cid";
    process.env.QB_CLIENT_SECRET = "secret";
    process.env.QB_ENVIRONMENT = "production";
    delete process.env.QB_ACTIVE_PROFILE;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    })) as never);
  });

  it("stores sync_direction=pull_only and sync_enabled=false", async () => {
    const { GET } = await import("@/app/api/integrations/quickbooks/callback/route");
    const url = "http://localhost/api/integrations/quickbooks/callback?code=c&state=CO:abc&realmId=R1";
    await GET(new Request(url) as never);
    expect(updateCapture).toHaveBeenCalledTimes(1);
    const payload = updateCapture.mock.calls[0][0];
    expect(payload.sync_direction).toBe("pull_only");
    expect(payload.sync_enabled).toBe(false);
    expect(payload.is_connected).toBe(true);
  });
});
