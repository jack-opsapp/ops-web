import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
import { resolveMcpOAuthConfig } from "@/lib/agent-control-plane/mcp/oauth";
import {
  INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_CONSENT_LABELS,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const APP_URL = "https://app.opsapp.co";
const RESOURCE = `${APP_URL}/api/mcp`;
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_REDIRECT_URI =
  "https://chatgpt.com/connector_platform_oauth_redirect";
const CODEX_REDIRECT_URI = "http://127.0.0.1:51759/callback/lwaKvnR9ZEom";
const CODEX_WRONG_PORT_REDIRECT_URI =
  "http://127.0.0.1:51760/callback/lwaKvnR9ZEom";
const CODEX_WRONG_ID_REDIRECT_URI =
  "http://127.0.0.1:51759/callback/anotherCodexId";
const FOREIGN_REDIRECT = "https://evil.example.com/api/mcp/auth_callback";
/** RFC 7636 appendix B challenge — 43 chars, valid PKCE charset. */
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const USER_ID = "8e811f98-9f2b-4f64-b409-ed56074b7dc8";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const COMPANY_NAME = "MAVERICK PROJECTS LTD";
const CONSENT_CATALOG_REVISION = "2026-08-22.mcp-consent-catalog.v1";
const EXPOSURE_REVISION = "2026-08-29.mcp-exposure.v2";
const CANARY_CONSENT_CATALOG_REVISION = "2026-08-30.mcp-consent-catalog.v2";
const CANARY_EXPOSURE_REVISION = "2026-08-30.mcp-exposure.v3";
const ACTIVE_READ_SCOPES = [
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.customers.read",
  "ops.customer_contacts.read",
  "ops.photos.read",
  "ops.correspondence.read",
  "ops.financials.read",
  "ops.tasks.read",
  "ops.site_visits.read",
  "ops.files.read",
  "ops.financial_documents.read",
  "ops.payments.read",
  "ops.expenses.read",
  "ops.catalog.read",
  "ops.purchasing.read",
  "ops.catalog_costs.read",
  "ops.company.read",
  "ops.team.read",
  "ops.integrations.read",
  "ops.operations.read",
] as const;
const CONSENT_PREVIEW =
  "ops_mcp_cp_dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CONSENT_PREVIEW_EXPIRES_AT = "2026-08-23T07:05:00.000Z";
const CANARY_SCOPES = [
  "ops.correspondence.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.prepare",
  "ops.operations.read",
  "ops.schedule.read",
  "ops.tasks.read",
] as const;

const CLIENT_ROW = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
  scope: ACTIVE_READ_SCOPES.join(" "),
  scope_ceiling: [...ACTIVE_READ_SCOPES],
  consent_catalog_revision: "2026-08-22.mcp-consent-catalog.v1",
  exposure_revision: EXPOSURE_REVISION,
  disabled: false,
};

const CONSUMED_PREVIEW_ROW = {
  client_id: CLIENT_ID,
  user_id: USER_ID,
  company_id: COMPANY_ID,
  client_name: "Claude",
  company_name: COMPANY_NAME,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scopes: [...ACTIVE_READ_SCOPES],
  accepted_labels: ACTIVE_READ_SCOPES.map(
    (scope) => MCP_SCOPE_CONSENT_LABELS[scope]
  ),
  consent_catalog_revision: CONSENT_CATALOG_REVISION,
  exposure_revision: EXPOSURE_REVISION,
  state: "opaque-anti-csrf-state",
  code_challenge: CODE_CHALLENGE,
  code_challenge_method: "S256",
  resource: RESOURCE,
  expires_at: CONSENT_PREVIEW_EXPIRES_AT,
};

const CANARY_CLIENT_ROW = {
  ...CLIENT_ROW,
  client_name: "OPS canary",
  scope: CANARY_SCOPES.join(" "),
  scope_ceiling: [...CANARY_SCOPES],
  consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
  exposure_revision: CANARY_EXPOSURE_REVISION,
};

const CANARY_CONSUMED_PREVIEW_ROW = {
  ...CONSUMED_PREVIEW_ROW,
  client_name: "OPS canary",
  scopes: [...CANARY_SCOPES],
  accepted_labels: CANARY_SCOPES.map(
    (scope) => INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS[scope]
  ),
  consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
  exposure_revision: CANARY_EXPOSURE_REVISION,
};

const CODEX_CLIENT_ROW = {
  ...CLIENT_ROW,
  client_name: "Codex",
  redirect_uris: [CODEX_REDIRECT_URI],
};

const CODEX_CONSUMED_PREVIEW_ROW = {
  ...CONSUMED_PREVIEW_ROW,
  client_name: "Codex",
  redirect_uri: CODEX_REDIRECT_URI,
};

const CHATGPT_CLIENT_ROW = {
  ...CLIENT_ROW,
  client_name: "ChatGPT",
  redirect_uris: [CHATGPT_REDIRECT_URI],
};

const CHATGPT_CONSUMED_PREVIEW_ROW = {
  ...CONSUMED_PREVIEW_ROW,
  client_name: "ChatGPT",
  redirect_uri: CHATGPT_REDIRECT_URI,
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
    response_type: "code",
    scope: ACTIVE_READ_SCOPES.join(" "),
    state: "opaque-anti-csrf-state",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    resource: RESOURCE,
    ...overrides,
  };
}

function decisionBody(overrides: Record<string, unknown> = {}) {
  return {
    decision: "approve",
    consent_preview: CONSENT_PREVIEW,
    ...overrides,
  };
}

function mockConsumedPreview(overrides: Record<string, unknown>): void {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "consume_mcp_oauth_consent_preview_as_system") {
      return {
        data: [{ ...CONSUMED_PREVIEW_ROW, ...overrides }],
        error: null,
      };
    }
    if (fn === "get_mcp_oauth_client_as_system") {
      return { data: [CLIENT_ROW], error: null };
    }
    if (fn === "create_mcp_oauth_authorization_code_as_system") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
}

function useCodexConsentRpc(
  previewOverrides: Record<string, unknown> = {},
  issuePreviewAvailable = true
): void {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_mcp_oauth_client_as_system") {
      return { data: [CODEX_CLIENT_ROW], error: null };
    }
    if (fn === "issue_mcp_oauth_consent_preview_as_system") {
      return {
        data: issuePreviewAvailable
          ? [
              {
                client_name: "Codex",
                company_name: COMPANY_NAME,
                expires_at: CONSENT_PREVIEW_EXPIRES_AT,
                rate_limited: false,
              },
            ]
          : [],
        error: null,
      };
    }
    if (fn === "consume_mcp_oauth_consent_preview_as_system") {
      return {
        data: [{ ...CODEX_CONSUMED_PREVIEW_ROW, ...previewOverrides }],
        error: null,
      };
    }
    if (fn === "create_mcp_oauth_authorization_code_as_system") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
}

function useChatGPTConsentRpc(): void {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_mcp_oauth_client_as_system") {
      return { data: [CHATGPT_CLIENT_ROW], error: null };
    }
    if (fn === "consume_mcp_oauth_consent_preview_as_system") {
      return { data: [CHATGPT_CONSUMED_PREVIEW_ROW], error: null };
    }
    if (fn === "create_mcp_oauth_authorization_code_as_system") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
}

function useCanaryConsentRpc(bindingAvailable = true): void {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_mcp_oauth_client_as_system") {
      return { data: [CANARY_CLIENT_ROW], error: null };
    }
    if (fn === "resolve_mcp_oauth_canary_as_system") {
      return {
        data: bindingAvailable
          ? [
              {
                exposure_revision: CANARY_EXPOSURE_REVISION,
                consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
                expires_at: "2099-08-31T20:00:00.000Z",
              },
            ]
          : [],
        error: null,
      };
    }
    if (fn === "issue_mcp_oauth_consent_preview_as_system") {
      return {
        data: [
          {
            client_name: "OPS canary",
            company_name: COMPANY_NAME,
            expires_at: CONSENT_PREVIEW_EXPIRES_AT,
            rate_limited: false,
          },
        ],
        error: null,
      };
    }
    if (fn === "consume_mcp_oauth_consent_preview_as_system") {
      return { data: [CANARY_CONSUMED_PREVIEW_ROW], error: null };
    }
    if (fn === "create_mcp_oauth_authorization_code_as_system") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
}

function createCodeArgs(): Record<string, unknown> {
  const call = mocks.rpc.mock.calls.find(
    ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
  );
  if (!call) throw new Error("authorization code RPC was never called");
  return call[1] as Record<string, unknown>;
}

function expectExactIssuer(url: URL): void {
  expect(url.searchParams.getAll("iss")).toEqual([
    resolveMcpOAuthConfig().issuer,
  ]);
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
    if (fn === "issue_mcp_oauth_consent_preview_as_system") {
      return {
        data: [
          {
            client_name: "Claude",
            company_name: COMPANY_NAME,
            expires_at: CONSENT_PREVIEW_EXPIRES_AT,
            rate_limited: false,
          },
        ],
        error: null,
      };
    }
    if (fn === "consume_mcp_oauth_consent_preview_as_system") {
      return { data: [CONSUMED_PREVIEW_ROW], error: null };
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

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

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
    expect(json.consentCatalogRevision).toBe(CONSENT_CATALOG_REVISION);
    expect(json.exposureRevision).toBe(EXPOSURE_REVISION);
    expect(json.consentPreview).toMatch(/^ops_mcp_cp_[A-Za-z0-9_-]{43}$/);
    expect(json.expiresAt).toBe(CONSENT_PREVIEW_EXPIRES_AT);
    expect(json.scopes.map((s: { scope: string }) => s.scope)).toEqual([
      ...ACTIVE_READ_SCOPES,
    ]);
    for (const line of json.scopes) {
      expect(typeof line.label).toBe("string");
      expect(line.label.length).toBeGreaterThan(0);
    }
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const issueCall = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issueCall).toBeTruthy();
    expect(issueCall?.[1]).toMatchObject({
      p_client_id: CLIENT_ID,
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_redirect_uri: REDIRECT_URI,
      p_response_type: "code",
      p_scopes: [...ACTIVE_READ_SCOPES],
      p_accepted_labels: ACTIVE_READ_SCOPES.map(
        (scope) => MCP_SCOPE_CONSENT_LABELS[scope]
      ),
      p_consent_catalog_revision: CONSENT_CATALOG_REVISION,
      p_exposure_revision: EXPOSURE_REVISION,
      p_state: "opaque-anti-csrf-state",
      p_code_challenge: CODE_CHALLENGE,
      p_code_challenge_method: "S256",
      p_resource: RESOURCE,
    });
    expect(issueCall?.[1]?.p_preview_hash).toBe(
      createHash("sha256")
        .update(json.consentPreview as string, "utf8")
        .digest("hex")
    );
    expect(issueCall?.[1]?.p_preview_hash).not.toBe(json.consentPreview);
  });

  it("stores the captured Codex callback byte-for-byte in the consent preview", async () => {
    useCodexConsentRpc();

    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ redirect_uri: CODEX_REDIRECT_URI })
      )
    );

    expect(response.status).toBe(200);
    const issueCall = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issueCall?.[1]?.p_redirect_uri).toBe(CODEX_REDIRECT_URI);
  });

  it("lets the store reject a valid-shaped Codex callback that was never registered", async () => {
    useCodexConsentRpc({}, false);

    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ redirect_uri: CODEX_WRONG_PORT_REDIRECT_URI })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    const issueCall = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issueCall?.[1]?.p_redirect_uri).toBe(CODEX_WRONG_PORT_REDIRECT_URI);
  });

  it("defaults to the full read set when scope is omitted", async () => {
    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ scope: undefined })
      )
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.scopes).toHaveLength(ACTIVE_READ_SCOPES.length);
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
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects a malformed client id with the uniform error", async () => {
    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ client_id: "claude" })
      )
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
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));

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

  it("rejects a scope outside the dynamically registered client's immutable ceiling", async () => {
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));

    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ scope: "ops.schedule.read" })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("never reveals which check failed", async () => {
    const rejections = await Promise.all([
      contextPOST(
        post(
          "/api/mcp/oauth/authorize/context",
          contextBody({ client_id: "nope" })
        )
      ),
      contextPOST(
        post(
          "/api/mcp/oauth/authorize/context",
          contextBody({ redirect_uri: FOREIGN_REDIRECT })
        )
      ),
      contextPOST(
        post(
          "/api/mcp/oauth/authorize/context",
          contextBody({ scope: "ops.everything" })
        )
      ),
    ]);

    const bodies = await Promise.all(rejections.map((r) => r.json()));
    for (const body of bodies) {
      expect(body).toEqual({ error: "invalid_request" });
    }
  });

  const invalidAuthorizationCases: Array<[string, Record<string, unknown>]> = [
    ["implicit response type", { response_type: "token" }],
    ["absent response type", { response_type: undefined }],
    ["downgraded PKCE method", { code_challenge_method: "plain" }],
    ["absent PKCE method", { code_challenge_method: undefined }],
    ["absent code challenge", { code_challenge: undefined }],
    ["short code challenge", { code_challenge: "too-short" }],
    ["oversized state", { state: "s".repeat(2049) }],
    ["control-character state", { state: `abc${String.fromCharCode(0)}def` }],
    ["newline state", { state: "abc\ndef" }],
    ["DEL-character state", { state: `abc${String.fromCharCode(0x7f)}def` }],
    ["non-string state", { state: 42 }],
    ["foreign audience", { resource: "https://evil.example.com/api/mcp" }],
    ["wrong path audience", { resource: `${APP_URL}/api/other` }],
    ["unparseable audience", { resource: "not-a-url" }],
  ];

  for (const [name, overrides] of invalidAuthorizationCases) {
    it(`rejects ${name} before issuing a preview`, async () => {
      const body = contextBody();
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete (body as Record<string, unknown>)[key];
        } else {
          (body as Record<string, unknown>)[key] = value;
        }
      }

      const response = await contextPOST(
        post("/api/mcp/oauth/authorize/context", body)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(
        mocks.rpc.mock.calls.some(
          ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
        )
      ).toBe(false);
    });
  }
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
    expectExactIssuer(url);
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(code).toMatch(/^ops_mcp_ac_[A-Za-z0-9_-]{43}$/);

    const args = createCodeArgs();

    // The raw code never reaches storage — only its SHA-256 digest.
    const expectedHash = createHash("sha256")
      .update(code as string, "utf8")
      .digest("hex");
    expect(args.p_code_hash).toBe(expectedHash);
    expect(args.p_code_hash).not.toBe(code);
    expect(String(args.p_code_hash)).toMatch(/^[0-9a-f]{64}$/);

    // Grant subject comes from the authenticated session, never the request.
    expect(args.p_client_id).toBe(CLIENT_ID);
    expect(args.p_user_id).toBe(USER_ID);
    expect(args.p_company_id).toBe(COMPANY_ID);

    // Scopes land in canonical order, not request order.
    expect(args.p_scopes).toEqual([...ACTIVE_READ_SCOPES]);
    expect(args.p_accepted_labels).toEqual(
      ACTIVE_READ_SCOPES.map((scope) => MCP_SCOPE_CONSENT_LABELS[scope])
    );
    expect(args.p_consent_catalog_revision).toBe(
      "2026-08-22.mcp-consent-catalog.v1"
    );
    expect(args.p_exposure_revision).toBe(EXPOSURE_REVISION);

    expect(args.p_redirect_uri).toBe(REDIRECT_URI);
    expect(args.p_code_challenge).toBe(CODE_CHALLENGE);
    expect(args.p_resource).toBe(RESOURCE);

    const expiresAt = Date.parse(String(args.p_expires_at));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000 - 2_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 300_000 + 2_000);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("approves Codex with the exact registered loopback callback", async () => {
    useCodexConsentRpc();

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(CODEX_REDIRECT_URI);
    expectExactIssuer(url);
    expect(url.searchParams.get("code")).toMatch(
      /^ops_mcp_ac_[A-Za-z0-9_-]{43}$/
    );
    expect(createCodeArgs().p_redirect_uri).toBe(CODEX_REDIRECT_URI);
  });

  it("approves ChatGPT through the exact stable callback with issuer identification", async () => {
    useChatGPTConsentRpc();

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(CHATGPT_REDIRECT_URI);
    expectExactIssuer(url);
    expect(url.searchParams.get("state")).toBe("opaque-anti-csrf-state");
    expect(url.searchParams.get("code")).toMatch(
      /^ops_mcp_ac_[A-Za-z0-9_-]{43}$/
    );
    expect(createCodeArgs().p_redirect_uri).toBe(CHATGPT_REDIRECT_URI);
  });

  it.each([
    ["another loopback port", CODEX_WRONG_PORT_REDIRECT_URI],
    ["another callback id", CODEX_WRONG_ID_REDIRECT_URI],
  ])(
    "never treats %s as the registered Codex callback",
    async (_label, redirectUri) => {
      useCodexConsentRpc({ redirect_uri: redirectUri });

      const response = await decisionPOST(
        post("/api/mcp/oauth/authorize/decision", decisionBody())
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(
        mocks.rpc.mock.calls.some(
          ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
        )
      ).toBe(false);
    }
  );

  it("uses the audience from the consumed snapshot", async () => {
    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(200);
    expect(createCodeArgs().p_resource).toBe(RESOURCE);
  });

  it("canonicalizes scrambled scopes before storing the visible preview", async () => {
    const scrambled = [...ACTIVE_READ_SCOPES].reverse().join(" ");

    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ scope: scrambled })
      )
    );

    expect(response.status).toBe(200);
    const issueCall = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issueCall?.[1]?.p_scopes).toEqual([...ACTIVE_READ_SCOPES]);
  });

  it("omits state from the redirect when the stored snapshot has none", async () => {
    mockConsumedPreview({ state: null });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();
    expect(redirectTo).not.toContain("state=");
    expect(redirectTo.startsWith(`${REDIRECT_URI}?code=`)).toBe(true);
  });

  it("canonicalizes the resource before storing the visible preview", async () => {
    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ resource: "https://APP.OPSAPP.CO:443/api/mcp/" })
      )
    );

    expect(response.status).toBe(200);
    const issueCall = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issueCall?.[1]?.p_resource).toBe(RESOURCE);
  });
});

// ─── Decision endpoint — deny ────────────────────────────────────────────────

describe("MCP OAuth consent — deny", () => {
  it("returns an access_denied redirect carrying state, minting nothing", async () => {
    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ decision: "deny" })
      )
    );

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();

    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("opaque-anti-csrf-state");
    expectExactIssuer(url);
    expect(url.searchParams.get("code")).toBeNull();

    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });

  it("denies Codex back to the exact registered loopback callback", async () => {
    useCodexConsentRpc();

    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ decision: "deny" })
      )
    );

    expect(response.status).toBe(200);
    const { redirect_to: redirectTo } = await response.json();
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(CODEX_REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("opaque-anti-csrf-state");
    expectExactIssuer(url);
    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });

  it("omits state from the denial redirect when the snapshot has none", async () => {
    mockConsumedPreview({ state: null });

    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ decision: "deny" })
      )
    );

    const { redirect_to: redirectTo } = await response.json();
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expectExactIssuer(url);
    expect(url.searchParams.has("state")).toBe(false);
  });
});

// ─── Decision endpoint — parameter tampering ─────────────────────────────────

describe("MCP OAuth consent — decision rejects tampering", () => {
  it("rejects a different allowed scope set than the exact labels shown in context", async () => {
    const shownScope = ACTIVE_READ_SCOPES[0];
    const substitutedScopes = ACTIVE_READ_SCOPES.slice(0, 2).join(" ");
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "consume_mcp_oauth_consent_preview_as_system") {
        return {
          data: [
            {
              ...CONSUMED_PREVIEW_ROW,
              scopes: [shownScope],
              accepted_labels: [MCP_SCOPE_CONSENT_LABELS[shownScope]],
            },
          ],
          error: null,
        };
      }
      if (fn === "get_mcp_oauth_client_as_system") {
        return { data: [CLIENT_ROW], error: null };
      }
      if (fn === "create_mcp_oauth_authorization_code_as_system") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await decisionPOST(
      post(
        "/api/mcp/oauth/authorize/decision",
        decisionBody({ scope: substitutedScopes })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });

  it("rejects an expired, unknown, cross-actor, or already-consumed preview", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "consume_mcp_oauth_consent_preview_as_system") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });

  const tamperCases: Array<[string, Record<string, unknown>]> = [
    ["an echoed client id", { client_id: CLIENT_ID }],
    ["an echoed scope", { scope: ACTIVE_READ_SCOPES[0] }],
    ["an echoed redirect", { redirect_uri: REDIRECT_URI }],
    [
      "an echoed preview expiry",
      { consent_preview_expires_at: CONSENT_PREVIEW_EXPIRES_AT },
    ],
    [
      "an echoed consent revision",
      { consent_catalog_revision: CONSENT_CATALOG_REVISION },
    ],
    ["an echoed exposure revision", { exposure_revision: EXPOSURE_REVISION }],
    ["an unknown decision verb", { decision: "maybe" }],
    ["a malformed preview", { consent_preview: "ops_mcp_cp_short" }],
  ];

  for (const [name, overrides] of tamperCases) {
    it(`rejects ${name} with 400 and no redirect`, async () => {
      const body = decisionBody();
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete (body as Record<string, unknown>)[key];
        else (body as Record<string, unknown>)[key] = value;
      }

      const response = await decisionPOST(
        post("/api/mcp/oauth/authorize/decision", body)
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({ error: "invalid_request" });
      expect(json).not.toHaveProperty("redirect_to");
      expect(
        mocks.rpc.mock.calls.some(
          ([fn]) =>
            fn === "consume_mcp_oauth_consent_preview_as_system" ||
            fn === "create_mcp_oauth_authorization_code_as_system"
        )
      ).toBe(false);
    });
  }

  for (const missingKey of ["decision", "consent_preview"] as const) {
    it(`rejects an absent ${missingKey} with 400 and no database call`, async () => {
      const body = decisionBody();
      delete (body as Record<string, unknown>)[missingKey];

      const response = await decisionPOST(
        post("/api/mcp/oauth/authorize/decision", body)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }

  it("rejects a stale consent or exposure revision from the consumed snapshot", async () => {
    mockConsumedPreview({
      consent_catalog_revision: "2026-08-21.mcp-consent-catalog.v0",
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(createCodeArgs).toThrow("authorization code RPC was never called");
  });

  it("rejects labels that differ from the exact active consent catalogue", async () => {
    mockConsumedPreview({
      accepted_labels: ACTIVE_READ_SCOPES.map(() => "Different label"),
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(createCodeArgs).toThrow("authorization code RPC was never called");
  });

  it("rejects a client whose immutable revisions differ from the preview", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "consume_mcp_oauth_consent_preview_as_system") {
        return { data: [CONSUMED_PREVIEW_ROW], error: null };
      }
      if (fn === "get_mcp_oauth_client_as_system") {
        return {
          data: [
            {
              ...CLIENT_ROW,
              exposure_revision: "2026-08-21.mcp-exposure.v0",
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(createCodeArgs).toThrow("authorization code RPC was never called");
  });

  it("rejects an unknown client without minting a code", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "consume_mcp_oauth_consent_preview_as_system") {
        return { data: [CONSUMED_PREVIEW_ROW], error: null };
      }
      return { data: [], error: null };
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects an allowlisted redirect the client never registered", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "consume_mcp_oauth_consent_preview_as_system") {
        return { data: [CONSUMED_PREVIEW_ROW], error: null };
      }
      if (fn === "get_mcp_oauth_client_as_system") {
        return {
          data: [
            {
              ...CLIENT_ROW,
              redirect_uris: ["https://claude.com/api/mcp/auth_callback"],
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("does not mint a code for a scope outside the stored client ceiling", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_mcp_oauth_client_as_system") {
        return {
          data: [
            {
              ...CLIENT_ROW,
              scope: "ops.jobs.read",
              scope_ceiling: ["ops.jobs.read"],
            },
          ],
          error: null,
        };
      }
      if (fn === "consume_mcp_oauth_consent_preview_as_system") {
        return { data: [CONSUMED_PREVIEW_ROW], error: null };
      }
      if (fn === "create_mcp_oauth_authorization_code_as_system") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(createCodeArgs).toThrow("authorization code RPC was never called");
  });
});

// ─── Open-redirect containment ───────────────────────────────────────────────

describe("MCP OAuth consent — a non-allowlisted redirect is never navigated", () => {
  for (const decision of ["approve", "deny"] as const) {
    it(`never returns a redirect_to for a foreign target on ${decision}`, async () => {
      mockConsumedPreview({ redirect_uri: FOREIGN_REDIRECT });
      const response = await decisionPOST(
        post("/api/mcp/oauth/authorize/decision", decisionBody({ decision }))
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({ error: "invalid_request" });
      expect(json).not.toHaveProperty("redirect_to");
      expect(JSON.stringify(json)).not.toContain("evil.example.com");
    });
  }

  it("never returns a redirect_to for a scheme-relative target", async () => {
    mockConsumedPreview({
      redirect_uri: "//evil.example.com/api/mcp/auth_callback",
    });
    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("redirect_to");
  });

  it("never returns a redirect_to for a javascript: target", async () => {
    mockConsumedPreview({ redirect_uri: "javascript:alert(1)" });
    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("redirect_to");
  });
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

describe("MCP OAuth consent — rate limiting", () => {
  it("keys preview issuance on the actor and company across all clients", async () => {
    await contextPOST(post("/api/mcp/oauth/authorize/context", contextBody()));
    await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ client_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" })
      )
    );

    const expectedLimit = {
      key: `mcp-oauth-consent-preview:${USER_ID}:${COMPANY_ID}`,
      limit: 30,
      windowSec: 300,
    };
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(1, expectedLimit);
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(2, expectedLimit);
    expect(JSON.stringify(mocks.rateLimit.mock.calls[0]?.[0])).not.toContain(
      CLIENT_ID
    );
  });

  it("returns 429 and performs no preview RPC when issuance is exceeded", async () => {
    mocks.rateLimit.mockResolvedValue({
      exceeded: true,
      count: 31,
      retryAfterSec: 75,
    });

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("75");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns 429 without a proof when the database cardinality ceiling wins", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_mcp_oauth_client_as_system") {
        return { data: [CLIENT_ROW], error: null };
      }
      if (fn === "issue_mcp_oauth_consent_preview_as_system") {
        return {
          data: [
            {
              client_name: "Claude",
              company_name: COMPANY_NAME,
              expires_at: CONSENT_PREVIEW_EXPIRES_AT,
              rate_limited: true,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const response = await contextPOST(
      post("/api/mcp/oauth/authorize/context", contextBody())
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  it("keys the decision limiter on the authenticated user at 30 per 300s", async () => {
    await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

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

describe("MCP OAuth consent — exact synthetic v3 canary", () => {
  it("shows only the seven v3 scopes for the exact bound subject", async () => {
    useCanaryConsentRpc();

    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ scope: CANARY_SCOPES.join(" ") })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exposureRevision).toBe(CANARY_EXPOSURE_REVISION);
    expect(body.consentCatalogRevision).toBe(CANARY_CONSENT_CATALOG_REVISION);
    expect(body.scopes).toEqual(
      CANARY_SCOPES.map((scope) => ({
        scope,
        label: INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS[scope],
      }))
    );
    const issueCall = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issueCall?.[1]).toMatchObject({
      p_client_id: CLIENT_ID,
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_scopes: [...CANARY_SCOPES],
      p_consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
      p_exposure_revision: CANARY_EXPOSURE_REVISION,
    });
  });

  it("rejects an unavailable binding without falling back or revealing it", async () => {
    useCanaryConsentRpc(false);

    const response = await contextPOST(
      post(
        "/api/mcp/oauth/authorize/context",
        contextBody({ scope: CANARY_SCOPES.join(" ") })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "issue_mcp_oauth_consent_preview_as_system"
      )
    ).toBe(false);
  });

  it("rechecks the exact binding at decision before creating a v3 code", async () => {
    useCanaryConsentRpc();

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(200);
    expect(createCodeArgs()).toMatchObject({
      p_client_id: CLIENT_ID,
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_scopes: [...CANARY_SCOPES],
      p_consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
      p_exposure_revision: CANARY_EXPOSURE_REVISION,
    });
    expect(
      mocks.rpc.mock.calls.filter(
        ([fn]) => fn === "resolve_mcp_oauth_canary_as_system"
      )
    ).toHaveLength(1);
  });

  it("blocks code creation when the binding disappears after preview", async () => {
    useCanaryConsentRpc(false);

    const response = await decisionPOST(
      post("/api/mcp/oauth/authorize/decision", decisionBody())
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(
      mocks.rpc.mock.calls.some(
        ([fn]) => fn === "create_mcp_oauth_authorization_code_as_system"
      )
    ).toBe(false);
  });
});
