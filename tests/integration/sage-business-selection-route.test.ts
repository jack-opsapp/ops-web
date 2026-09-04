import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermission = vi.fn();
const sessionSingle = vi.fn();
const consumeSession = vi.fn();
const discoverBusinesses = vi.fn();
const refreshGrant = vi.fn();
const connectionUpdate = vi.fn();
const findConflict = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: (...args: unknown[]) => verifyAdminAuth(...args),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserByAuth(...args),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...args: unknown[]) => checkPermission(...args),
}));
vi.mock("@/lib/api/services/accounting-connection-guard", () => ({
  findConflictingActiveProvider: (...args: unknown[]) => findConflict(...args),
}));
vi.mock("@/lib/api/services/sage-config", () => ({
  getAllowedSageBusinessIds: () => ["business-a", "business-b"],
  getSageCredentials: (environment: string) => ({
    clientId: `${environment}-client`,
    clientSecret: `${environment}-secret`,
    redirectUri: "https://ops.test/callback",
    environment,
  }),
}));
vi.mock("@/lib/api/services/sage-oauth-service", () => ({
  discoverEligibleSageBusinesses: (...args: unknown[]) =>
    discoverBusinesses(...args),
  refreshSageOAuthGrant: (...args: unknown[]) => refreshGrant(...args),
  sageBusinessIdLookup: (id: string) => `lookup:${id}`,
}));
vi.mock("@/lib/api/services/token-cipher", () => ({
  encryptToken: (value: string) => `encrypted:${value}`,
  decryptToken: (value: string | null) =>
    value?.startsWith("encrypted:") ? value.slice(10) : value,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: (_name: string, args: unknown) => consumeSession(args),
    from: (table: string) => {
      if (table === "sage_business_selection_sessions") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              maybeSingle: () => sessionSingle(),
            };
            return chain;
          },
        };
      }
      if (table !== "accounting_connections")
        throw new Error(`unexpected ${table}`);
      return {
        update: (payload: unknown) => {
          connectionUpdate(payload);
          const chain = {
            eq: () => chain,
            select: () => ({
              maybeSingle: () => ({
                data: { id: "connection-1" },
                error: null,
              }),
            }),
          };
          return chain;
        },
      };
    },
  }),
}));

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION = {
  id: SESSION_ID,
  connection_id: "33333333-3333-4333-8333-333333333333",
  actor_user_id: USER_ID,
  company_id: COMPANY_ID,
  provider_environment: "sandbox",
  access_token: "encrypted:access-1",
  refresh_token: "encrypted:refresh-1",
  token_expires_at: new Date(Date.now() + 180_000).toISOString(),
  eligible_businesses: [
    { id: "business-a", name: "Sandbox A" },
    { id: "business-b", name: "Sandbox B" },
  ],
};

function getRequest(): Request {
  return new Request(
    `https://ops.test/api/integrations/sage/businesses?companyId=${COMPANY_ID}&sessionId=${SESSION_ID}`,
    { headers: { Authorization: "Bearer token" } }
  );
}

function postRequest(body: unknown): Request {
  return new Request("https://ops.test/api/integrations/sage/businesses", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
}

async function handlers() {
  return import("@/app/api/integrations/sage/businesses/route");
}

describe("Sage business selection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({
      uid: "firebase-1",
      email: "owner@ops.test",
    });
    findUserByAuth.mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID });
    checkPermission.mockResolvedValue(true);
    sessionSingle.mockResolvedValue({ data: SESSION, error: null });
    consumeSession.mockResolvedValue({ data: [SESSION], error: null });
    discoverBusinesses.mockResolvedValue([
      { id: "business-a", name: "Sandbox A" },
      { id: "business-b", name: "Sandbox B" },
    ]);
    findConflict.mockResolvedValue(null);
  });

  it("returns only the pending businesses to the initiating authorized user", async () => {
    const { GET } = await handlers();
    const response = await GET(getRequest() as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      businesses: SESSION.eligible_businesses,
      providerEnvironment: "sandbox",
    });
  });

  it("rejects cross-company access before reading the selection", async () => {
    findUserByAuth.mockResolvedValue({ id: USER_ID, company_id: "other" });
    const { GET } = await handlers();
    const response = await GET(getRequest() as never);
    expect(response.status).toBe(403);
    expect(sessionSingle).not.toHaveBeenCalled();
  });

  it("atomically consumes, revalidates, and binds the selected business pull-only", async () => {
    const { POST } = await handlers();
    const response = await POST(
      postRequest({
        companyId: COMPANY_ID,
        sessionId: SESSION_ID,
        businessId: "business-b",
      }) as never
    );
    expect(response.status).toBe(200);
    expect(discoverBusinesses).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-1",
        environment: "sandbox",
      })
    );
    expect(connectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "encrypted:access-1",
        refresh_token: "encrypted:refresh-1",
        sage_business_id: "encrypted:business-b",
        sage_business_id_lookup: "lookup:business-b",
        sage_business_name: "Sandbox B",
        is_connected: true,
        sync_enabled: false,
        sync_direction: "pull_only",
        propagate_deletes: false,
      })
    );
  });

  it("rejects replayed selection sessions", async () => {
    consumeSession.mockResolvedValue({ data: [], error: null });
    const { POST } = await handlers();
    const response = await POST(
      postRequest({
        companyId: COMPANY_ID,
        sessionId: SESSION_ID,
        businessId: "business-a",
      }) as never
    );
    expect(response.status).toBe(410);
    expect(connectionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a business that is no longer eligible before activation", async () => {
    discoverBusinesses.mockResolvedValue([
      { id: "business-a", name: "Sandbox A" },
    ]);
    const { POST } = await handlers();
    const response = await POST(
      postRequest({
        companyId: COMPANY_ID,
        sessionId: SESSION_ID,
        businessId: "business-b",
      }) as never
    );
    expect(response.status).toBe(409);
    expect(connectionUpdate).not.toHaveBeenCalled();
  });
});
