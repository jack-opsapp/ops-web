import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const findConflict = vi.fn();
const connectionUpsert = vi.fn();
const attemptInsert = vi.fn();
const connectionSingle = vi.fn();
const disconnectMaybeSingle = vi.fn();
const disconnectPatch = vi.fn();
const eqEvidence = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: (...args: unknown[]) => verifyAdminAuth(...args),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserByAuth(...args),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...args: unknown[]) => checkPermissionById(...args),
}));
vi.mock("@/lib/api/services/accounting-connection-guard", () => ({
  findConflictingActiveProvider: (...args: unknown[]) => findConflict(...args),
  providerLabel: (provider: string) => provider,
}));
vi.mock("@/lib/api/services/sage-config", () => ({
  SAGE_AUTHORIZE_URL: "https://sage.example/authorize?filter=apiv3.1",
  SAGE_REVOKE_URL: "https://sage.example/revoke",
  getSageProviderEnvironment: () => "sandbox",
  getSageCredentials: (environment: string) => ({
    clientId: `${environment}-client`,
    clientSecret: `${environment}-secret`,
    redirectUri: "https://ops.test/api/integrations/sage/callback",
    environment,
  }),
}));
vi.mock("@/lib/api/services/sage-oauth-service", () => ({
  createSageOAuthSecrets: () => ({
    state: "opaque-state",
    verifier: "pkce-verifier",
    challenge: "pkce-challenge",
  }),
  digestSageOAuthState: () => "a".repeat(64),
}));
vi.mock("@/lib/api/services/token-cipher", () => ({
  encryptToken: (value: string) => `encrypted:${value}`,
  decryptToken: (value: string | null) =>
    value?.startsWith("encrypted:") ? value.slice(10) : value,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "accounting_oauth_attempts") {
        return {
          insert: (value: unknown) => attemptInsert(value),
        };
      }
      if (table !== "accounting_connections")
        throw new Error(`unexpected ${table}`);
      return {
        upsert: (value: unknown, options: unknown) => {
          connectionUpsert(value, options);
          return {
            select: () => ({ single: () => connectionSingle() }),
          };
        },
        select: () => {
          const chain = {
            eq: (column: string, value: unknown) => {
              eqEvidence("select", column, value);
              return chain;
            },
            single: () => connectionSingle(),
          };
          return chain;
        },
        update: (patch: unknown) => {
          disconnectPatch(patch);
          const chain = {
            eq: (column: string, value: unknown) => {
              eqEvidence("update", column, value);
              return chain;
            },
            select: () => ({ maybeSingle: () => disconnectMaybeSingle() }),
          };
          return chain;
        },
      };
    },
  }),
}));

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function request(method: "POST" | "DELETE", body: unknown): Request {
  return new Request("https://ops.test/api/integrations/sage", {
    method,
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
}

async function handlers() {
  return import("@/app/api/integrations/sage/route");
}

describe("Sage connection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({
      uid: "firebase-1",
      email: "owner@ops.test",
    });
    findUserByAuth.mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID });
    checkPermissionById.mockResolvedValue(true);
    findConflict.mockResolvedValue(null);
    connectionSingle.mockResolvedValue({
      data: { id: "33333333-3333-4333-8333-333333333333", refresh_token: null },
      error: null,
    });
    attemptInsert.mockResolvedValue({ error: null });
    disconnectMaybeSingle.mockResolvedValue({
      data: { id: "conn-1" },
      error: null,
    });
  });

  it("rejects unauthenticated and cross-company OAuth attempts before persistence", async () => {
    const { POST } = await handlers();
    verifyAdminAuth.mockResolvedValueOnce(null);
    expect(
      (await POST(request("POST", { companyId: COMPANY_ID }) as never)).status
    ).toBe(401);

    findUserByAuth.mockResolvedValueOnce({ id: USER_ID, company_id: "other" });
    expect(
      (await POST(request("POST", { companyId: COMPANY_ID }) as never)).status
    ).toBe(403);
    expect(attemptInsert).not.toHaveBeenCalled();
  });

  it("rejects a user without accounting.manage_connections", async () => {
    checkPermissionById.mockResolvedValue(false);
    const { POST } = await handlers();
    const response = await POST(
      request("POST", { companyId: COMPANY_ID }) as never
    );
    expect(response.status).toBe(403);
    expect(attemptInsert).not.toHaveBeenCalled();
  });

  it("persists only a state digest and encrypted verifier for the exact profile", async () => {
    const { POST } = await handlers();
    const response = await POST(
      request("POST", {
        companyId: COMPANY_ID,
        providerEnvironment: "sandbox",
        returnSurface: "books",
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const url = new URL(body.authUrl);
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("code_challenge")).toBe("pkce-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(body.authUrl).not.toContain(COMPANY_ID);
    expect(attemptInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        state_digest: "a".repeat(64),
        actor_user_id: USER_ID,
        company_id: COMPANY_ID,
        provider_environment: "sandbox",
        pkce_verifier: "encrypted:pkce-verifier",
        return_surface: "books",
      })
    );
  });

  it("disconnects only the authorized environment and clears all Sage identity", async () => {
    const { DELETE } = await handlers();
    const response = await DELETE(
      request("DELETE", {
        companyId: COMPANY_ID,
        providerEnvironment: "sandbox",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(eqEvidence).toHaveBeenCalledWith(
      "update",
      "provider_environment",
      "sandbox"
    );
    expect(disconnectPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: null,
        refresh_token: null,
        sage_business_id: null,
        sage_business_id_lookup: null,
        sage_business_name: null,
        is_connected: false,
        sync_enabled: false,
        sync_direction: "pull_only",
        propagate_deletes: false,
      })
    );
  });

  it("returns 404 when the exact Sage connection does not exist", async () => {
    disconnectMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { DELETE } = await handlers();
    const response = await DELETE(
      request("DELETE", {
        companyId: COMPANY_ID,
        providerEnvironment: "sandbox",
      }) as never
    );
    expect(response.status).toBe(404);
  });
});
