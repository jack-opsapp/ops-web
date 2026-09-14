// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import type { McpServerRuntime } from "@/lib/agent-control-plane/mcp/runtime";
import type { ResolvedAccessTokenRow } from "@/lib/agent-control-plane/mcp/oauth/grants";

const state = vi.hoisted(() => ({
  runtime: null as McpServerRuntime | null,
  configured: true,
  limited: false,
  rateFailure: false,
}));
vi.mock("@/lib/agent-control-plane/mcp/runtime", () => ({
  mcpRuntimeConfigured: () => state.configured,
  getMcpServerRuntime: () => state.runtime,
}));
vi.mock("@/lib/agent-control-plane/mcp/rate-limit", () => ({
  checkTransportRate: async () => {
    if (state.rateFailure) throw new Error("private limiter detail");
    return { exceeded: state.limited, retryAfterSec: 30 };
  },
}));

import { GET, POST } from "@/app/api/mcp/oauth/userinfo/route";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const TOKEN = `ops_mcp_at_${"a".repeat(43)}`;
const URL = "https://app.opsapp.co/api/mcp/oauth/userinfo";
let row: ResolvedAccessTokenRow | null;
let authority: StubAuthoritySupabaseRpcClient;
let rpc: ReturnType<typeof vi.fn>;
function request(headers: Record<string, string> = {}, url = URL) {
  return new Request(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.configured = true;
  state.limited = false;
  state.rateFailure = false;
  row = {
    grant_id: "44444444-4444-4444-8444-444444444444",
    client_id: "33333333-3333-4333-8333-333333333333",
    client_name: "Canpro cloud sources",
    user_id: ACTOR,
    company_id: COMPANY,
    scopes: ["ops.company.read"],
    accepted_labels: ["See the company operating profile"],
    consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9",
    exposure_revision: "2026-09-04.mcp-exposure.v14",
    revision: "0123456789abcdef0123456789abcdef",
    issuer: "https://app.opsapp.co",
    audience: "https://app.opsapp.co/api/mcp",
    expires_at: "2099-01-01T00:00:00Z",
    token_revoked: false,
    grant_revoked: false,
    client_disabled: false,
  };
  authority = new StubAuthoritySupabaseRpcClient({
    actorUserId: ACTOR,
    companyId: COMPANY,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [],
    effectivePermissions: [],
    permissionSnapshotRevision: "sha256:userinfo-test",
  });
  rpc = vi.fn(async (fn: string) => {
    expect(fn).toBe("resolve_mcp_oauth_access_token_as_system");
    return { data: row ? [row] : [], error: null };
  });
  state.runtime = {
    authorityRepository: authority.repository,
    rpcClient: { rpc },
  } as unknown as McpServerRuntime;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("MCP OAuth bearer identity", () => {
  it("returns only current actor/company, not token or grant claims", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actorId: ACTOR,
      companyId: COMPANY,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(authority.actorLookups).toHaveLength(1);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
  });

  it("never accepts caller-supplied identity selectors", async () => {
    const response = await GET(
      request({}, `${URL}?actorId=someone&companyId=other`)
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "",
    "Bearer bogus",
    `Basic ${TOKEN}`,
    `Bearer ${TOKEN} extra`,
  ])("denies malformed or missing bearer %s", async (header) => {
    const response = await GET(
      new Request(URL, {
        headers: header === undefined ? {} : { Authorization: header },
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="ops.company.read"'
    );
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("does not authenticate a cookie or query token", async () => {
    expect(
      (await GET(new Request(URL, { headers: { Cookie: `token=${TOKEN}` } })))
        .status
    ).toBe(401);
    expect(
      (await GET(new Request(`${URL}?access_token=${TOKEN}`))).status
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked token", { token_revoked: true }],
    ["revoked grant", { grant_revoked: true }],
    ["disabled client", { client_disabled: true }],
    ["expired", { expires_at: "2000-01-01T00:00:00Z" }],
    ["invalid expiry", { expires_at: "invalid" }],
    ["wrong issuer", { issuer: "https://evil.example" }],
    ["wrong resource", { audience: `${URL}` }],
    ["unregistered exposure", { exposure_revision: "unknown.v1" }],
  ] as const)("rejects %s before authority lookup", async (_name, override) => {
    Object.assign(row!, override);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"'
    );
    expect(authority.actorLookups).toHaveLength(0);
  });

  it("rejects a missing or stale database grant", async () => {
    row = null;
    expect((await GET(request())).status).toBe(401);
  });

  it.each(["inactive", "removed", "company mismatch", "actor mismatch"])(
    "denies %s membership",
    async (reason) => {
      if (reason === "removed") authority.mcpResult = null;
      else
        authority.mcpResult = {
          ...authority.mcpResult!,
          ...(reason === "inactive" ? { isActive: false } : {}),
          ...(reason === "company mismatch" ? { companyId: ACTOR } : {}),
          ...(reason === "actor mismatch" ? { actorUserId: COMPANY } : {}),
        };
      const response = await GET(request());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
  );

  it("reauthorizes the same token on every call", async () => {
    expect((await GET(request())).status).toBe(200);
    authority.mcpResult = null;
    expect((await GET(request())).status).toBe(403);
    expect(authority.actorLookups).toHaveLength(2);
  });

  it("requires ops.company.read without granting it from membership", async () => {
    row!.scopes = ["ops.jobs.read"];
    row!.accepted_labels = ["See your jobs and their status"];
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"'
    );
    expect(await response.json()).toEqual({ error: "insufficient_scope" });
  });

  it.each(["unconfigured", "token store", "authority", "limiter"])(
    "fails closed when %s is unavailable",
    async (reason) => {
      if (reason === "unconfigured") state.configured = false;
      if (reason === "token store")
        rpc.mockRejectedValue(new Error("private token store details"));
      if (reason === "authority")
        authority.failure = { message: "private authority details" };
      if (reason === "limiter") state.rateFailure = true;
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "temporarily_unavailable",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  );

  it("uses the existing transport limit", async () => {
    state.limited = true;
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("rejects cross-origin browser requests and supports server or issuer origin", async () => {
    expect(
      (await GET(request({ Origin: "https://evil.example" }))).status
    ).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(
      (await GET(request({ Origin: "https://app.opsapp.co" }))).status
    ).toBe(200);
  });

  it("rejects POST without a credential lookup", async () => {
    const response = await POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpc).not.toHaveBeenCalled();
  });
});
