import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MCP OAuth consent surface — context + decision endpoints (P1 plan Task 5).
 *
 * The decision endpoint is where a browser click becomes machine authority,
 * so these tests are written against the security contract rather than the
 * happy path: uniform opaque rejections, a redirect target that can only ever
 * be an allowlisted URI, a code that reaches storage only as a digest, and a
 * PKCE method that cannot be downgraded.
 */

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getServiceRoleClient: vi.fn(),
  rateLimit: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
  isErrorResponse: (value: unknown) => value instanceof Response,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
}));

import { POST as contextPOST } from "@/app/api/mcp/oauth/authorize/context/route";
import { POST as decisionPOST } from "@/app/api/mcp/oauth/authorize/decision/route";
import { SUPPORTED_READ_SCOPES } from "@/lib/agent-control-plane/mcp/oauth/scopes";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const APP_URL = "https://app.opsapp.co";
const RESOURCE = `${APP_URL}/api/mcp`;
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const FOREIGN_REDIRECT = "https://evil.example.com/api/mcp/auth_callback";
/** RFC 7636 appendix B challenge — 43 chars, valid PKCE charset. */
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const USER_ID = "8e811f98-9f2b-4f64-b409-ed56074b7dc8";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const COMPANY_NAME = "MAVERICK PROJECTS LTD";

const CLIENT_ROW = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
  scope: SUPPORTED_READ_SCOPES.join(" "),
  disabled: false,
};

let originalAppUrl: string | undefined;
let originalBaseUrl: string | undefined;

beforeAll(() => {
  originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

afterAll(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
});

// ─── Harness ─────────────────────────────────────────────────────────────────

function companyQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer firebase-id-token",
    },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

function contextBody(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SUPPORTED_READ_SCOPES.join(" "),
    ...overrides,
  };
}

function decisionBody(overrides: Record<string, unknown> = {}) {
  return {
    decision: "approve",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SUPPORTED_READ_SCOPES.join(" "),
    state: "opaque-anti-csrf-state",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    resource: RESOURCE,
    ...overrides,
  };
}

function createCodeArgs(): Record<string, unknown> {
  const call = mocks.rpc.mock.calls.find(
    ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
  );
  if (!call) throw new Error("authorization code RPC was never called");
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({
    id: USER_ID,
    companyId: COMPANY_ID,
    role: "admin",
    isManager: true,
    firstName: "Jackson",
    lastName: "Sweet",
  });
  mocks.rateLimit.mockResolvedValue({
    exceeded: false,
    count: 1,
    retryAfterSec: 0,
  });
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_mcp_oauth_client_as_system") {
      return { data: [CLIENT_ROW], error: null };
    }
    if (fn === "create_mcp_oauth_authorization_code_as_system") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
  mocks.from.mockImplementation(() =>
    companyQuery({ data: { name: COMPANY_NAME }, error: null })
  );
  mocks.getServiceRoleClient.mockReturnValue({
    rpc: mocks.rpc,
    from: mocks.from,
  });
});

// ─── Authentication ──────────────────────────────────────────────────────────

describe("MCP OAuth consent — authentication", () => {
  it("passes the 401 straight through on the context endpoint", async () => {
    mocks.authenticateRequest.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await contextPOST(post("/api/mcp/oauth/authorize/context", contextBody()));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the 401 straight through on the decision endpoint", async () => {
    mocks.authenticateRequest.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });
});

// ─── Context endpoint ────────────────────────────────────────────────────────

describe("MCP OAuth consent — context", () => {
  it("returns the client, company, and consent labels", async () => {
    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.clientName).toBe("Claude");
    expect(json.companyName).toBe(COMPANY_NAME);
    expect(json.scopes.map((s: { scope: string }) => s.scope)).toEqual([
      ...SUPPORTED_READ_SCOPES,
    ]);
    for (const line of json.scopes) {
      expect(typeof line.label).toBe("string");
      expect(line.label.length).toBeGreaterThan(0);
    }
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("defaults to the full read set when scope is omitted", async () => {
    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", {
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.scopes).toHaveLength(SUPPORTED_READ_SCOPES.length);
  });

  it("rejects an unknown client with the uniform error", async () => {
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects a disabled client with the uniform error", async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: [{ ...CLIENT_ROW, disabled: true }],
      error: null,
    }));

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects a malformed client id with the uniform error", async () => {
    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody({ client_id: "claude" }))
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-allowlisted redirect with the uniform error", async () => {
    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ redirect_uri: FOREIGN_REDIRECT })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects an allowlisted redirect the client never registered", async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: [{ ...CLIENT_ROW, redirect_uris: ["https://claude.com/api/mcp/auth_callback"] }],
      error: null,
    }));

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects a scope this server does not issue with the uniform error", async () => {
    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ scope: "ops.jobs.read ops.invoices.write" })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("never reveals which check failed", async () => {
    const rejections = await Promise.all([
      contextPOST(post("/api/mcp/oauth/authorize/context", contextBody({ client_id: "nope" }))),
      contextPOST(
        post("/api/mcp/oauth/authorize/context", contextBody({ redirect_uri: FOREIGN_REDIRECT }))
      ),
      contextPOST(
        post("/api/mcp/oauth/authorize/context", contextBody({ scope: "ops.everything" }))
      ),
    ]);

    const bodies = await Promise.all(rejections.map((r) => r.json()));
    for (const body of bodies) {
      expect(body).toEqual({ error: "invalid_request" });
    }
  });
});

// ─── Decision endpoint — approve ─────────────────────────────────────────────

describe("MCP OAuth consent — approve", () => {
  it("mints a code, stores only its digest, and redirects with state", async () => {
    const before = Date.now();
    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );
    const after = Date.now();

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();

    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("opaque-anti-csrf-state");
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(code).toMatch(/^ops_mcp_ac_[A-Za-z0-9_-]{43}$/);

    const args = createCodeArgs();

    // The raw code never reaches storage — only its SHA-256 digest.
    const expectedHash = createHash("sha256").update(code as string, "utf8").digest("hex");
    expect(args.p_code_hash).toBe(expectedHash);
    expect(args.p_code_hash).not.toBe(code);
    expect(String(args.p_code_hash)).toMatch(/^[0-9a-f]{64}$/);

    // Grant subject comes from the authenticated session, never the request.
    expect(args.p_client_id).toBe(CLIENT_ID);
    expect(args.p_user_id).toBe(USER_ID);
    expect(args.p_company_id).toBe(COMPANY_ID);

    // Scopes land in canonical order, not request order.
    expect(args.p_scopes).toEqual([...SUPPORTED_READ_SCOPES]);

    expect(args.p_redirect_uri).toBe(REDIRECT_URI);
    expect(args.p_code_challenge).toBe(CODE_CHALLENGE);
    expect(args.p_resource).toBe(RESOURCE);

    const expiresAt = Date.parse(String(args.p_expires_at));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000 - 2_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 300_000 + 2_000);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("defaults the audience to the configured resource when absent", async () => {
    const body = decisionBody();
    delete (body as Record<string, unknown>).resource;

    const response = await decisionPOST(post("/api/mcp/oauth/authorize/decision", body));

    expect(response.status).toBe(200);
    expect(createCodeArgs().p_resource).toBe(RESOURCE);
  });

  it("preserves the canonical scope order when the request scrambles it", async () => {
    const scrambled = [...SUPPORTED_READ_SCOPES].reverse().join(" ");

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody({ scope: scrambled }))
    );

    expect(response.status).toBe(200);
    expect(createCodeArgs().p_scopes).toEqual([...SUPPORTED_READ_SCOPES]);
  });

  it("omits state from the redirect when the client sent none", async () => {
    const body = decisionBody();
    delete (body as Record<string, unknown>).state;

    const response = await decisionPOST(post("/api/mcp/oauth/authorize/decision", body));

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();
    expect(redirectTo).not.toContain("state=");
    expect(redirectTo.startsWith(`${REDIRECT_URI}?code=`)).toBe(true);
  });

  it("accepts a non-canonical resource that canonicalizes to the audience", async () => {
    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ resource: "https://APP.OPSAPP.CO:443/api/mcp/" })
      )
    );

    expect(response.status).toBe(200);
    expect(createCodeArgs().p_resource).toBe(RESOURCE);
  });
});

// ─── Decision endpoint — deny ────────────────────────────────────────────────

describe("MCP OAuth consent — deny", () => {
  it("returns an access_denied redirect carrying state, minting nothing", async () => {
    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody({ decision: "deny" }))
    );

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();

    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("opaque-anti-csrf-state");
    expect(url.searchParams.get("code")).toBeNull();

    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });

  it("omits state from the denial redirect when the client sent none", async () => {
    const body = decisionBody({ decision: "deny" });
    delete (body as Record<string, unknown>).state;

    const response = await decisionPOST(post("/api/mcp/oauth/authorize/decision", body));

    const { redirect_to: redirectTo } = await response.json();
    expect(redirectTo).toBe(`${REDIRECT_URI}?error=access_denied`);
  });
});

// ─── Decision endpoint — parameter tampering ─────────────────────────────────

describe("MCP OAuth consent — decision rejects tampering", () => {
  const tamperCases: Array<[string, Record<string, unknown>]> = [
    ["implicit response_type", { response_type: "token" }],
    ["absent response_type", { response_type: undefined }],
    ["downgraded PKCE method", { code_challenge_method: "plain" }],
    ["absent PKCE method", { code_challenge_method: undefined }],
    ["absent code challenge", { code_challenge: undefined }],
    ["short code challenge", { code_challenge: "too-short" }],
    ["oversized state", { state: "s".repeat(2049) }],
    ["control-character state", { state: "abc def" }],
    ["newline state", { state: "abc\ndef" }],
    ["DEL-character state", { state: `abc${String.fromCharCode(0x7f)}def` }],
    ["non-string state", { state: 42 }],
    ["foreign audience", { resource: "https://evil.example.com/api/mcp" }],
    ["wrong path audience", { resource: `${APP_URL}/api/other` }],
    ["unparseable audience", { resource: "not-a-url" }],
    ["scope escalation", { scope: "ops.jobs.read ops.invoices.write" }],
    ["malformed client id", { client_id: "claude" }],
    ["unknown decision verb", { decision: "maybe" }],
    ["absent decision verb", { decision: undefined }],
  ];

  for (const [name, overrides] of tamperCases) {
    it(`rejects ${name} with 400 and no redirect`, async () => {
      const body = decisionBody();
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete (body as Record<string, unknown>)[key];
        else (body as Record<string, unknown>)[key] = value;
      }

      const response = await decisionPOST(post("/api/mcp/oauth/authorize/decision", body));

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({ error: "invalid_request" });
      expect(json).not.toHaveProperty("redirect_to");
      expect(
        mocks.rpc.mock.calls.some(
          ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
        )
      ).toBe(false);
    });
  }

  it("rejects an unknown client without minting a code", async () => {
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects an allowlisted redirect the client never registered", async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: [{ ...CLIENT_ROW, redirect_uris: ["https://claude.com/api/mcp/auth_callback"] }],
      error: null,
    }));

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});

// ─── Open-redirect containment ───────────────────────────────────────────────

describe("MCP OAuth consent — a non-allowlisted redirect is never navigated", () => {
  for (const decision of ["approve", "deny"] as const) {
    it(`never returns a redirect_to for a foreign target on ${decision}`, async () => {
      const response = await decisionPOST(
        post(
          "/api/mcp/oauth/authorize/decision",
          decisionBody({ decision, redirect_uri: FOREIGN_REDIRECT })
        )
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({ error: "invalid_request" });
      expect(json).not.toHaveProperty("redirect_to");
      expect(JSON.stringify(json)).not.toContain("evil.example.com");
    });
  }

  it("never returns a redirect_to for a scheme-relative target", async () => {
    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ redirect_uri: "//evil.example.com/api/mcp/auth_callback" })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("redirect_to");
  });

  it("never returns a redirect_to for a javascript: target", async () => {
    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ redirect_uri: "javascript:alert(1)" })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("redirect_to");
  });
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

describe("MCP OAuth consent — rate limiting", () => {
  it("keys the decision limiter on the authenticated user at 30 per 300s", async () => {
    await decisionPOST(post("/api/mcp/oauth/authorize/decision", decisionBody()));

    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: `mcp-oauth-decision:${USER_ID}`,
      limit: 30,
      windowSec: 300,
    });
  });

  it("returns 429 with Retry-After and mints nothing when exceeded", async () => {
    mocks.rateLimit.mockResolvedValue({
      exceeded: true,
      count: 31,
      retryAfterSec: 120,
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });
});
