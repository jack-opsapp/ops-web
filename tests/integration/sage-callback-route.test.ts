import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeAttempt = vi.fn();
const connectionSingle = vi.fn();
const connectionUpdate = vi.fn();
const selectionInsert = vi.fn();
const exchangeCode = vi.fn();
const discoverBusinesses = vi.fn();
const findConflict = vi.fn();

vi.mock("@/lib/api/services/sage-config", () => ({
  getAllowedSageBusinessIds: () => ["business-a", "business-b"],
  getSageCredentials: (environment: string) => ({
    clientId: `${environment}-client`,
    clientSecret: `${environment}-secret`,
    redirectUri: "https://ops.test/api/integrations/sage/callback",
    environment,
  }),
}));
vi.mock("@/lib/api/services/sage-oauth-service", () => ({
  digestSageOAuthState: () => "a".repeat(64),
  exchangeSageAuthorizationCode: (...args: unknown[]) => exchangeCode(...args),
  discoverEligibleSageBusinesses: (...args: unknown[]) =>
    discoverBusinesses(...args),
  sageBusinessIdLookup: (id: string) => `lookup:${id}`,
}));
vi.mock("@/lib/api/services/token-cipher", () => ({
  encryptToken: (value: string) => `encrypted:${value}`,
  decryptToken: (value: string | null) =>
    value?.startsWith("encrypted:") ? value.slice(10) : value,
}));
vi.mock("@/lib/api/services/accounting-connection-guard", () => ({
  findConflictingActiveProvider: (...args: unknown[]) => findConflict(...args),
}));
vi.mock("@/lib/utils/app-url", () => ({ getAppUrl: () => "https://ops.test" }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: (_name: string, args: unknown) => consumeAttempt(args),
    from: (table: string) => {
      if (table === "sage_business_selection_sessions") {
        return {
          insert: (payload: unknown) => {
            selectionInsert(payload);
            return {
              select: () => ({
                single: () => ({ data: { id: "selection-1" }, error: null }),
              }),
            };
          },
        };
      }
      if (table !== "accounting_connections")
        throw new Error(`unexpected ${table}`);
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            single: () => connectionSingle(),
          };
          return chain;
        },
        update: (payload: unknown) => {
          connectionUpdate(payload);
          const chain = {
            eq: () => chain,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(resolve),
          };
          return chain;
        },
      };
    },
  }),
}));

const ATTEMPT = {
  actor_user_id: "11111111-1111-4111-8111-111111111111",
  company_id: "a612edc0-5c18-4c4d-af97-55b9410dd077",
  provider: "sage",
  provider_environment: "sandbox",
  pkce_verifier: "encrypted:pkce-verifier",
  return_surface: "books",
};

function request(extra = ""): Request {
  return new Request(
    `https://ops.test/api/integrations/sage/callback?code=auth-code&state=opaque-state${extra}`
  );
}

async function callback() {
  return (await import("@/app/api/integrations/sage/callback/route")).GET;
}

describe("Sage OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeAttempt.mockResolvedValue({ data: [ATTEMPT], error: null });
    connectionSingle.mockResolvedValue({
      data: { id: "connection-1" },
      error: null,
    });
    findConflict.mockResolvedValue(null);
    exchangeCode.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds: 300,
    });
    discoverBusinesses.mockResolvedValue([
      { id: "business-a", name: "Sandbox A" },
    ]);
  });

  it("rejects expired or replayed state before exchanging the authorization code", async () => {
    consumeAttempt.mockResolvedValue({ data: [], error: null });
    const GET = await callback();
    const response = await GET(request() as never);
    expect(response.headers.get("location")).toContain("message=invalid_state");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("uses the consumed PKCE verifier and exact environment, then binds one active business pull-only", async () => {
    const GET = await callback();
    const response = await GET(request() as never);

    expect(exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "auth-code",
        verifier: "pkce-verifier",
        credentials: expect.objectContaining({ environment: "sandbox" }),
      })
    );
    expect(connectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "encrypted:access-1",
        refresh_token: "encrypted:refresh-1",
        sage_business_id: "encrypted:business-a",
        sage_business_id_lookup: "lookup:business-a",
        sage_business_name: "Sandbox A",
        is_connected: true,
        sync_enabled: false,
        sync_direction: "pull_only",
        propagate_deletes: false,
      })
    );
    expect(response.headers.get("location")).toContain("connected=sage");
  });

  it("stores a short-lived encrypted selection session when multiple businesses are eligible", async () => {
    discoverBusinesses.mockResolvedValue([
      { id: "business-a", name: "Sandbox A" },
      { id: "business-b", name: "Sandbox B" },
    ]);
    const GET = await callback();
    const response = await GET(request() as never);

    expect(selectionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: "connection-1",
        actor_user_id: ATTEMPT.actor_user_id,
        company_id: ATTEMPT.company_id,
        provider_environment: "sandbox",
        access_token: "encrypted:access-1",
        refresh_token: "encrypted:refresh-1",
        eligible_businesses: [
          { id: "business-a", name: "Sandbox A" },
          { id: "business-b", name: "Sandbox B" },
        ],
      })
    );
    expect(connectionUpdate).not.toHaveBeenCalled();
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("sageSelection=selection-1");
    expect(location).not.toContain("access-1");
    expect(location).not.toContain("business-a");
  });

  it("activates nothing when the grant has no eligible business", async () => {
    discoverBusinesses.mockResolvedValue([]);
    const GET = await callback();
    const response = await GET(request() as never);
    expect(response.headers.get("location")).toContain(
      "message=no_eligible_business"
    );
    expect(connectionUpdate).not.toHaveBeenCalled();
    expect(selectionInsert).not.toHaveBeenCalled();
  });
});
