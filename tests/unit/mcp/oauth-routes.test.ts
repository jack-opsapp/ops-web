/**
 * OAuth HTTP surface for the OPS remote MCP server.
 *
 * Covers the four route families that Claude touches before a single MCP
 * frame is exchanged: discovery (RFC 9728 + RFC 8414), dynamic client
 * registration (RFC 7591), the token endpoint (RFC 6749 + PKCE + RFC 8707),
 * and revocation (RFC 7009).
 *
 * The store is a controllable fake over the `*_as_system` RPCs, so every
 * assertion here is about the HTTP contract and the policy the routes
 * enforce — never about SQL. Two properties get asserted repeatedly because
 * they are the ones that silently rot:
 *   1. the value returned to the client is never the value handed to the
 *      store (tokens leave as secrets, land as digests);
 *   2. every failed exchange answers the same `invalid_grant`, so the
 *      endpoint cannot be used as an oracle.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_EXPOSURE_V14 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
const APP_URL = "https://app.opsapp.co";

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  return {
    rateLimit: vi.fn(),
    rpc: vi.fn(),
  };
});

vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_PREFIX,
  REFRESH_TOKEN_PREFIX,
  SUPPORTED_READ_SCOPES,
  mintCredential,
  resolveMcpOAuthConfig,
  s256Challenge,
  sha256Hex,
} from "@/lib/agent-control-plane/mcp/oauth";
import {
  INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_CONSENT_LABELS,
  CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

import { GET as authorizationServerGet } from "@/app/.well-known/oauth-authorization-server/route";
import {
  GET as protectedResourceGet,
  POST as protectedResourcePost,
} from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as protectedResourceRootGet } from "@/app/.well-known/oauth-protected-resource/route";
import { POST as registerPost } from "@/app/api/mcp/oauth/register/route";
import { POST as revokePost } from "@/app/api/mcp/oauth/revoke/route";
import { POST as tokenPost } from "@/app/api/mcp/oauth/token/route";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CLIENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_CLIENT_ID = "9c85f2b1-0d47-4a63-8f10-6b2d4e7c9a55";
const USER_ID = "8e811f98-9f2b-4f64-b409-ed56074b7dc8";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const GRANT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const REVISION = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CALLBACK_TWIN = "https://claude.com/api/mcp/auth_callback";
const CHATGPT_CALLBACK =
  "https://chatgpt.com/connector_platform_oauth_redirect";
const CODEX_CALLBACK = "http://127.0.0.1:51759/callback/lwaKvnR9ZEom";
const CODEX_WRONG_PORT_CALLBACK =
  "http://127.0.0.1:51760/callback/lwaKvnR9ZEom";
const CODEX_WRONG_ID_CALLBACK =
  "http://127.0.0.1:51759/callback/anotherCodexId";
const CODE_VERIFIER = "ops-mcp-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
const V1_SCOPES = [...SUPPORTED_READ_SCOPES];
const SCOPES = [
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
const ACCEPTED_LABELS = SCOPES.map((scope) => MCP_SCOPE_CONSENT_LABELS[scope]);
const CONSENT_CATALOG_REVISION = "2026-08-22.mcp-consent-catalog.v1";
const EXPOSURE_REVISION = "2026-08-29.mcp-exposure.v2";
const SCOPE_PARAMETER = SCOPES.join(" ");
const CANARY_EXPOSURE_REVISION = "2026-08-30.mcp-exposure.v3";
const CANARY_CONSENT_CATALOG_REVISION = "2026-08-30.mcp-consent-catalog.v2";
const CANARY_SCOPES = [
  "ops.correspondence.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.prepare",
  "ops.operations.read",
  "ops.schedule.read",
  "ops.tasks.read",
] as const;
const CANARY_ACCEPTED_LABELS = CANARY_SCOPES.map(
  (scope) => INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS[scope]
);

const config = resolveMcpOAuthConfig();
const RESOURCE = config.resource;

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  scope: string;
  scope_ceiling: string[];
  consent_catalog_revision: string;
  exposure_revision: string;
  disabled: boolean;
}

interface CodeRow {
  user_id: string;
  company_id: string;
  scopes: string[];
  accepted_labels: string[];
  consent_catalog_revision: string;
  exposure_revision: string;
  code_challenge: string;
  resource: string;
}

interface RotatedRow {
  grant_id: string;
  client_id: string;
  user_id: string;
  company_id: string;
  scopes: string[];
  accepted_labels: string[];
  consent_catalog_revision: string;
  exposure_revision: string;
  revision: string;
  issuer: string;
  audience: string;
  reuse_detected: boolean;
}

const state = {
  calls: [] as RpcCall[],
  errors: new Map<string, { message: string }>(),
  clientRow: null as ClientRow | null,
  codeRow: null as CodeRow | null,
  rotatedRow: null as RotatedRow | null,
  canaryBindingAvailable: false,
};

function callsTo(fn: string): RpcCall[] {
  return state.calls.filter((call) => call.fn === fn);
}

function lastCallTo(fn: string): RpcCall {
  const calls = callsTo(fn);
  const call = calls[calls.length - 1];
  if (!call) throw new Error(`expected an RPC call to ${fn}`);
  return call;
}

function defaultClientRow(): ClientRow {
  return {
    client_id: CLIENT_ID,
    client_name: "Claude",
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: "none",
    scope: SCOPE_PARAMETER,
    scope_ceiling: [...SCOPES],
    consent_catalog_revision: CONSENT_CATALOG_REVISION,
    exposure_revision: EXPOSURE_REVISION,
    disabled: false,
  };
}

function defaultCodeRow(): CodeRow {
  return {
    user_id: USER_ID,
    company_id: COMPANY_ID,
    scopes: [...SCOPES],
    accepted_labels: ACCEPTED_LABELS,
    consent_catalog_revision: CONSENT_CATALOG_REVISION,
    exposure_revision: EXPOSURE_REVISION,
    code_challenge: s256Challenge(CODE_VERIFIER),
    resource: RESOURCE,
  };
}

function defaultRotatedRow(): RotatedRow {
  return {
    grant_id: GRANT_ID,
    client_id: CLIENT_ID,
    user_id: USER_ID,
    company_id: COMPANY_ID,
    scopes: [...SCOPES],
    accepted_labels: ACCEPTED_LABELS,
    consent_catalog_revision: CONSENT_CATALOG_REVISION,
    exposure_revision: EXPOSURE_REVISION,
    revision: REVISION,
    issuer: config.issuer,
    audience: RESOURCE,
    reuse_detected: false,
  };
}

function canaryClientRow(): ClientRow {
  return {
    ...defaultClientRow(),
    client_name: "OPS canary",
    scope: CANARY_SCOPES.join(" "),
    scope_ceiling: [...CANARY_SCOPES],
    consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
    exposure_revision: CANARY_EXPOSURE_REVISION,
  };
}

function canaryCodeRow(): CodeRow {
  return {
    ...defaultCodeRow(),
    scopes: [...CANARY_SCOPES],
    accepted_labels: CANARY_ACCEPTED_LABELS,
    consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
    exposure_revision: CANARY_EXPOSURE_REVISION,
  };
}

function canaryRotatedRow(): RotatedRow {
  return {
    ...defaultRotatedRow(),
    scopes: [...CANARY_SCOPES],
    accepted_labels: CANARY_ACCEPTED_LABELS,
    consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
    exposure_revision: CANARY_EXPOSURE_REVISION,
  };
}

function fakeRpc(fn: string, args: Record<string, unknown>) {
  state.calls.push({ fn, args });
  const failure = state.errors.get(fn);
  if (failure) return Promise.resolve({ data: null, error: failure });

  switch (fn) {
    case "register_mcp_oauth_client_as_system":
      return Promise.resolve({
        data: [
          {
            client_id: CLIENT_ID,
            client_name: args.p_client_name,
            redirect_uris: args.p_redirect_uris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            scope: args.p_scope,
            scope_ceiling: args.p_scope_ceiling,
            consent_catalog_revision: args.p_consent_catalog_revision,
            exposure_revision: args.p_exposure_revision,
            created_at: "2026-08-18T12:00:00.000Z",
          },
        ],
        error: null,
      });
    case "get_mcp_oauth_client_as_system":
      return Promise.resolve({
        data: state.clientRow ? [state.clientRow] : [],
        error: null,
      });
    case "consume_mcp_oauth_authorization_code_as_system":
      return Promise.resolve({
        data: state.codeRow ? [state.codeRow] : [],
        error: null,
      });
    case "resolve_mcp_oauth_canary_as_system":
      return Promise.resolve({
        data: state.canaryBindingAvailable
          ? [
              {
                exposure_revision: CANARY_EXPOSURE_REVISION,
                consent_catalog_revision: CANARY_CONSENT_CATALOG_REVISION,
                expires_at: "2099-08-31T20:00:00.000Z",
              },
            ]
          : [],
        error: null,
      });
    case "mint_mcp_oauth_grant_as_system":
      return Promise.resolve({
        data: [{ grant_id: GRANT_ID, revision: REVISION }],
        error: null,
      });
    case "rotate_mcp_oauth_refresh_token_as_system":
      return Promise.resolve({
        data: state.rotatedRow ? [state.rotatedRow] : [],
        error: null,
      });
    case "revoke_mcp_oauth_token_as_system":
      return Promise.resolve({ data: true, error: null });
    default:
      throw new Error(`Unexpected RPC: ${fn}`);
  }
}

// ─── Request builders ───────────────────────────────────────────────────────

function jsonRequest(
  path: string,
  body: unknown,
  contentType = "application/json"
): NextRequest {
  return new NextRequest(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

function formRequest(
  path: string,
  body: string,
  contentType = "application/x-www-form-urlencoded"
): NextRequest {
  return new NextRequest(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.7" },
    body,
  });
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function codeExchangeBody(
  overrides: Partial<Record<string, string>> = {},
  code = mintCredential(AUTHORIZATION_CODE_PREFIX)
): { body: string; code: string } {
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK,
    client_id: CLIENT_ID,
    code_verifier: CODE_VERIFIER,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === "") delete fields[key];
  }
  return { body: form(fields), code };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.calls.length = 0;
  state.errors.clear();
  state.clientRow = defaultClientRow();
  state.codeRow = defaultCodeRow();
  state.rotatedRow = defaultRotatedRow();
  state.canaryBindingAvailable = false;
  mocks.rateLimit.mockResolvedValue({
    exceeded: false,
    count: 1,
    retryAfterSec: 0,
  });
  mocks.rpc.mockImplementation(fakeRpc);
});

// ─── Discovery ──────────────────────────────────────────────────────────────

describe("OAuth discovery documents", () => {
  const expectedProtectedResource = {
    resource: `${config.issuer}/api/mcp`,
    authorization_servers: [config.issuer],
    scopes_supported: [...MCP_EXPOSURE_V14.grantableScopes],
    bearer_methods_supported: ["header"],
    resource_name: "OPS",
  };

  it("serves RFC 9728 protected resource metadata at the path-inserted probe", async () => {
    const response = await protectedResourceGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.json()).resolves.toEqual(expectedProtectedResource);
  });

  it("serves the identical document at the root probe location", async () => {
    const nested = await (await protectedResourceGet()).json();
    const root = await protectedResourceRootGet();
    expect(root.status).toBe(200);
    expect(root.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await root.json();
    expect(body).toEqual(expectedProtectedResource);
    expect(body).toEqual(nested);
  });

  it("serves RFC 8414 authorization server metadata without advertising CIMD", async () => {
    const response = await authorizationServerGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await response.json();
    expect(body).toEqual({
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      registration_endpoint: config.registrationEndpoint,
      revocation_endpoint: config.revocationEndpoint,
      scopes_supported: [...MCP_EXPOSURE_V14.grantableScopes],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(body).not.toHaveProperty("client_id_metadata_document_supported");
  });

  it("does not advertise CIMD on the protected resource document either", async () => {
    const body = await (await protectedResourceGet()).json();
    expect(body).not.toHaveProperty("client_id_metadata_document_supported");
  });

  it("answers 405 on a non-GET discovery request", async () => {
    const response = protectedResourcePost();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

// ─── Dynamic client registration ────────────────────────────────────────────

describe("POST /api/mcp/oauth/register", () => {
  const validPayload = {
    client_name: "  Claude  ",
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    software_id: " claude-connector ",
  };

  it("registers a public client and never returns a secret", async () => {
    const response = await registerPost(
      jsonRequest("/api/mcp/oauth/register", validPayload)
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const call = lastCallTo("register_mcp_oauth_client_as_system");
    expect(call.args).toEqual({
      p_client_name: "Claude",
      p_redirect_uris: [CALLBACK],
      p_scope: MCP_EXPOSURE_V14.grantableScopes.join(" "),
      p_scope_ceiling: [...MCP_EXPOSURE_V14.grantableScopes],
      p_consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9",
      p_exposure_revision: MCP_EXPOSURE_V14.revision,
      p_software_id: "claude-connector",
      p_software_version: null,
    });

    const body = await response.json();
    expect(body).toEqual({
      client_id: CLIENT_ID,
      client_name: "Claude",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: MCP_EXPOSURE_V14.grantableScopes.join(" "),
    });
    expect(body).not.toHaveProperty("client_secret");
    expect(JSON.stringify(body)).not.toContain("client_secret");
  });

  it("registers the captured Codex native DCR payload without changing its callback", async () => {
    const response = await registerPost(
      jsonRequest("/api/mcp/oauth/register", {
        client_name: "Codex",
        redirect_uris: [CODEX_CALLBACK],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
        response_types: ["code"],
        scope: "ops.jobs.read",
        application_type: "native",
      })
    );

    expect(response.status).toBe(201);
    expect(
      lastCallTo("register_mcp_oauth_client_as_system").args
    ).toMatchObject({
      p_client_name: "Codex",
      p_redirect_uris: [CODEX_CALLBACK],
      p_scope: "ops.jobs.read",
      p_scope_ceiling: ["ops.jobs.read"],
    });
    const body = await response.json();
    expect(body).toMatchObject({
      client_id: CLIENT_ID,
      client_name: "Codex",
      redirect_uris: [CODEX_CALLBACK],
      token_endpoint_auth_method: "none",
    });
    expect(body).not.toHaveProperty("client_secret");
  });

  it("registers ChatGPT DCR with the exact stable RFC 9207 callback", async () => {
    const response = await registerPost(
      jsonRequest("/api/mcp/oauth/register", {
        ...validPayload,
        client_name: "ChatGPT",
        redirect_uris: [CHATGPT_CALLBACK],
      })
    );

    expect(response.status).toBe(201);
    expect(
      lastCallTo("register_mcp_oauth_client_as_system").args.p_redirect_uris
    ).toEqual([CHATGPT_CALLBACK]);
    await expect(response.json()).resolves.toMatchObject({
      client_name: "ChatGPT",
      redirect_uris: [CHATGPT_CALLBACK],
      token_endpoint_auth_method: "none",
    });
  });

  it("rejects a redirect URI that is not the Claude connector callback", async () => {
    const response = await registerPost(
      jsonRequest("/api/mcp/oauth/register", {
        ...validPayload,
        redirect_uris: ["https://evil.example/api/mcp/auth_callback"],
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_redirect_uri");
    expect(typeof body.error_description).toBe("string");
    expect(callsTo("register_mcp_oauth_client_as_system")).toHaveLength(0);
  });

  it("rejects a non-JSON registration body with 415", async () => {
    const response = await registerPost(
      jsonRequest(
        "/api/mcp/oauth/register",
        validPayload,
        "application/x-www-form-urlencoded"
      )
    );
    expect(response.status).toBe(415);
    expect(callsTo("register_mcp_oauth_client_as_system")).toHaveLength(0);
  });

  it("still rate limits when no forwarded IP is present", async () => {
    const request = new NextRequest(`${APP_URL}/api/mcp/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    const response = await registerPost(request);
    expect(response.status).toBe(201);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "mcp-oauth-register:unknown",
      limit: 10,
      windowSec: 3600,
    });
  });

  it("rate limits registration by IP", async () => {
    mocks.rateLimit.mockResolvedValue({
      exceeded: true,
      count: 11,
      retryAfterSec: 1800,
    });
    const response = await registerPost(
      jsonRequest("/api/mcp/oauth/register", validPayload)
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1800");
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "mcp-oauth-register:203.0.113.7",
      limit: 10,
      windowSec: 3600,
    });
    expect(callsTo("register_mcp_oauth_client_as_system")).toHaveLength(0);
  });
});

// ─── Token endpoint: authorization_code ─────────────────────────────────────

describe("POST /api/mcp/oauth/token (authorization_code)", () => {
  it("exchanges a code for a bearer pair and stores only digests", async () => {
    const { body: requestBody, code } = codeExchangeBody({
      resource: RESOURCE,
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");

    const body = await response.json();
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(body.scope).toBe(SCOPE_PARAMETER);
    expect(body.access_token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(body.refresh_token.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(body).not.toHaveProperty("id_token");

    const consume = lastCallTo(
      "consume_mcp_oauth_authorization_code_as_system"
    );
    expect(consume.args).toEqual({
      p_code_hash: sha256Hex(code),
      p_client_id: CLIENT_ID,
      p_redirect_uri: CALLBACK,
    });

    const mint = lastCallTo("mint_mcp_oauth_grant_as_system");
    expect(mint.args.p_access_hash).toBe(sha256Hex(body.access_token));
    expect(mint.args.p_refresh_hash).toBe(sha256Hex(body.refresh_token));
    expect(mint.args.p_access_hash).not.toBe(body.access_token);
    expect(mint.args.p_refresh_hash).not.toBe(body.refresh_token);
    expect(mint.args.p_user_id).toBe(USER_ID);
    expect(mint.args.p_company_id).toBe(COMPANY_ID);
    expect(mint.args).not.toHaveProperty("p_scopes");
    expect(mint.args.p_active_exposure_revision).toBe(EXPOSURE_REVISION);
    expect(mint.args.p_active_grantable_scopes).toEqual(SCOPES);
    expect(mint.args.p_issuer).toBe(config.issuer);
    expect(mint.args.p_audience).toBe(RESOURCE);
    expect(Date.parse(String(mint.args.p_refresh_expires_at))).toBeGreaterThan(
      Date.parse(String(mint.args.p_access_expires_at))
    );

    // The secrets themselves must never reach the store.
    expect(JSON.stringify(state.calls)).not.toContain(body.access_token);
    expect(JSON.stringify(state.calls)).not.toContain(body.refresh_token);
  });

  it("exchanges only an exact current v3 canary code", async () => {
    state.clientRow = canaryClientRow();
    state.codeRow = canaryCodeRow();
    state.canaryBindingAvailable = true;
    const { body: requestBody } = codeExchangeBody();

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe(CANARY_SCOPES.join(" "));
    expect(lastCallTo("mint_mcp_oauth_grant_as_system").args).toMatchObject({
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_active_exposure_revision: CANARY_EXPOSURE_REVISION,
      p_active_grantable_scopes: [...CANARY_SCOPES],
    });
  });

  it("consumes no authority when the canary disappears before exchange", async () => {
    state.clientRow = canaryClientRow();
    state.codeRow = canaryCodeRow();
    state.canaryBindingAvailable = false;
    const { body: requestBody } = codeExchangeBody();

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(callsTo("mint_mcp_oauth_grant_as_system")).toHaveLength(0);
  });

  it("exchanges a Codex code against the exact registered loopback callback", async () => {
    state.clientRow = {
      ...defaultClientRow(),
      client_name: "Codex",
      redirect_uris: [CODEX_CALLBACK],
    };
    const { body: requestBody } = codeExchangeBody({
      redirect_uri: CODEX_CALLBACK,
    });

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    expect(
      lastCallTo("consume_mcp_oauth_authorization_code_as_system").args
        .p_redirect_uri
    ).toBe(CODEX_CALLBACK);
  });

  it("exchanges a ChatGPT code against only the exact registered stable callback", async () => {
    state.clientRow = {
      ...defaultClientRow(),
      client_name: "ChatGPT",
      redirect_uris: [CHATGPT_CALLBACK],
    };
    const { body: requestBody } = codeExchangeBody({
      redirect_uri: CHATGPT_CALLBACK,
    });

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    expect(
      lastCallTo("consume_mcp_oauth_authorization_code_as_system").args
        .p_redirect_uri
    ).toBe(CHATGPT_CALLBACK);
  });

  it("rejects ChatGPT callback-ID URLs even when the stable callback is registered", async () => {
    state.clientRow = {
      ...defaultClientRow(),
      client_name: "ChatGPT",
      redirect_uris: [CHATGPT_CALLBACK],
    };
    const { body: requestBody } = codeExchangeBody({
      redirect_uri: "https://chatgpt.com/connector/oauth/callback-id",
    });

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(
      callsTo("consume_mcp_oauth_authorization_code_as_system")
    ).toHaveLength(0);
  });

  it.each([
    ["another loopback port", CODEX_WRONG_PORT_CALLBACK],
    ["another callback id", CODEX_WRONG_ID_CALLBACK],
  ])(
    "does not treat %s as the registered Codex callback",
    async (_label, redirectUri) => {
      state.clientRow = {
        ...defaultClientRow(),
        client_name: "Codex",
        redirect_uris: [CODEX_CALLBACK],
      };
      const { body: requestBody } = codeExchangeBody({
        redirect_uri: redirectUri,
      });

      const response = await tokenPost(
        formRequest("/api/mcp/oauth/token", requestBody)
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_grant",
      });
      expect(
        callsTo("consume_mcp_oauth_authorization_code_as_system")
      ).toHaveLength(0);
    }
  );

  it("answers 401 invalid_client for an unknown client", async () => {
    state.clientRow = null;
    const { body: requestBody } = codeExchangeBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_client" });
    expect(
      callsTo("consume_mcp_oauth_authorization_code_as_system")
    ).toHaveLength(0);
  });

  it("answers 401 invalid_client for a disabled client", async () => {
    state.clientRow = { ...defaultClientRow(), disabled: true };
    const { body: requestBody } = codeExchangeBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_client" });
  });

  it("rejects a redirect_uri the client never registered", async () => {
    const { body: requestBody } = codeExchangeBody({
      redirect_uri: CALLBACK_TWIN,
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(
      callsTo("consume_mcp_oauth_authorization_code_as_system")
    ).toHaveLength(0);
  });

  it("rejects a malformed authorization code without touching the store", async () => {
    const { body: requestBody } = codeExchangeBody({}, "not-an-ops-code");
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(
      callsTo("consume_mcp_oauth_authorization_code_as_system")
    ).toHaveLength(0);
  });

  it("rejects a code the store will not consume (expired, replayed, unknown)", async () => {
    state.codeRow = null;
    const { body: requestBody } = codeExchangeBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(callsTo("mint_mcp_oauth_grant_as_system")).toHaveLength(0);
  });

  it("rejects a code_verifier that does not match the stored challenge", async () => {
    const { body: requestBody } = codeExchangeBody({
      code_verifier: `${CODE_VERIFIER}-wrong`,
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(callsTo("mint_mcp_oauth_grant_as_system")).toHaveLength(0);
  });

  it("rejects a resource that does not match the code's audience", async () => {
    const { body: requestBody } = codeExchangeBody({
      resource: "https://app.opsapp.co/api/other",
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_target" });
    expect(callsTo("mint_mcp_oauth_grant_as_system")).toHaveLength(0);
  });

  it("accepts a non-canonical resource that canonicalizes to the audience", async () => {
    const { body: requestBody } = codeExchangeBody({
      resource: "https://APP.opsapp.co:443/api/mcp/",
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(200);
  });

  it("rejects a form that repeats a parameter", async () => {
    const { body: requestBody, code } = codeExchangeBody();
    const smuggled = `${requestBody}&code=${encodeURIComponent(code)}`;
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", smuggled)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(callsTo("get_mcp_oauth_client_as_system")).toHaveLength(0);
  });

  it("rejects a JSON body with 415", async () => {
    const { body: requestBody } = codeExchangeBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody, "application/json")
    );
    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("rejects a request missing a required parameter", async () => {
    const response = await tokenPost(
      formRequest(
        "/api/mcp/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          redirect_uri: CALLBACK,
        })
      )
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });

  it("rate limits the token endpoint by IP with no-store headers intact", async () => {
    mocks.rateLimit.mockResolvedValue({
      exceeded: true,
      count: 61,
      retryAfterSec: 30,
    });
    const { body: requestBody } = codeExchangeBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "mcp-oauth-token:203.0.113.7",
      limit: 60,
      windowSec: 60,
    });
  });
});

// ─── Token endpoint: refresh_token ──────────────────────────────────────────

describe("POST /api/mcp/oauth/token (refresh_token)", () => {
  function refreshBody(
    overrides: Partial<Record<string, string>> = {},
    presented = mintCredential(REFRESH_TOKEN_PREFIX)
  ): { body: string; presented: string } {
    return {
      body: form({
        grant_type: "refresh_token",
        refresh_token: presented,
        client_id: CLIENT_ID,
        ...overrides,
      }),
      presented,
    };
  }

  it("rotates the refresh token and returns a brand-new pair", async () => {
    const { body: requestBody, presented } = refreshBody({
      resource: RESOURCE,
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(body.scope).toBe(SCOPE_PARAMETER);
    expect(body.refresh_token).not.toBe(presented);
    expect(body.refresh_token.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(body.access_token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);

    const rotate = lastCallTo("rotate_mcp_oauth_refresh_token_as_system");
    expect(rotate.args.p_presented_hash).toBe(sha256Hex(presented));
    expect(rotate.args.p_client_id).toBe(CLIENT_ID);
    expect(rotate.args.p_active_grantable_scopes).toEqual([
      ...MCP_EXPOSURE_V14.grantableScopes,
    ]);
    expect(rotate.args.p_new_access_hash).toBe(sha256Hex(body.access_token));
    expect(rotate.args.p_new_refresh_hash).toBe(sha256Hex(body.refresh_token));
    expect(rotate.args.p_new_refresh_hash).not.toBe(body.refresh_token);
  });

  it("rotates an exact v3 family only while its canary remains current", async () => {
    state.clientRow = canaryClientRow();
    state.rotatedRow = canaryRotatedRow();
    state.canaryBindingAvailable = true;
    const { body: requestBody } = refreshBody();

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe(CANARY_SCOPES.join(" "));
    expect(callsTo("resolve_mcp_oauth_canary_as_system")).toHaveLength(1);
  });

  it("returns only invalid_grant when canary authority is lost during refresh", async () => {
    state.clientRow = canaryClientRow();
    state.rotatedRow = canaryRotatedRow();
    state.canaryBindingAvailable = false;
    const { body: requestBody } = refreshBody();

    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
  });

  it("refreshes a historical v1 grant without widening its seven scopes or revision", async () => {
    const v1Labels = V1_SCOPES.map((scope) => MCP_SCOPE_CONSENT_LABELS[scope]);
    state.clientRow = {
      ...defaultClientRow(),
      scope: V1_SCOPES.join(" "),
      scope_ceiling: V1_SCOPES,
      exposure_revision: "2026-08-22.mcp-exposure.v1",
    };
    state.rotatedRow = {
      ...defaultRotatedRow(),
      scopes: V1_SCOPES,
      accepted_labels: v1Labels,
      exposure_revision: "2026-08-22.mcp-exposure.v1",
    };

    const { body: requestBody } = refreshBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe(V1_SCOPES.join(" "));
    expect(body.scope).not.toContain("ops.tasks.read");
    expect(
      lastCallTo("rotate_mcp_oauth_refresh_token_as_system").args
        .p_active_grantable_scopes
    ).toEqual([...MCP_EXPOSURE_V14.grantableScopes]);
    expect(state.rotatedRow.exposure_revision).toBe(
      "2026-08-22.mcp-exposure.v1"
    );
  });

  it("answers invalid_grant when the store reports refresh reuse", async () => {
    state.rotatedRow = { ...defaultRotatedRow(), reuse_detected: true };
    const { body: requestBody } = refreshBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
  });

  it("answers invalid_grant when the token belongs to another client", async () => {
    state.rotatedRow = { ...defaultRotatedRow(), client_id: OTHER_CLIENT_ID };
    const { body: requestBody } = refreshBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
  });

  it("answers invalid_grant for an unknown refresh token", async () => {
    state.rotatedRow = null;
    const { body: requestBody } = refreshBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
  });

  it("rejects a malformed refresh token without touching the store", async () => {
    const { body: requestBody } = refreshBody({}, "ops_mcp_rt_not-a-token");
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(callsTo("rotate_mcp_oauth_refresh_token_as_system")).toHaveLength(0);
  });

  it("rejects a resource that does not match the grant audience", async () => {
    const { body: requestBody } = refreshBody({
      resource: "https://app.opsapp.co/api/mcp/other",
    });
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_target" });
  });

  it("answers 401 invalid_client for an unknown client", async () => {
    state.clientRow = null;
    const { body: requestBody } = refreshBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_client" });
    expect(callsTo("rotate_mcp_oauth_refresh_token_as_system")).toHaveLength(0);
  });
});

// ─── Token endpoint: everything else ────────────────────────────────────────

describe("POST /api/mcp/oauth/token (other grants and failures)", () => {
  it("rejects an unsupported grant type", async () => {
    const response = await tokenPost(
      formRequest(
        "/api/mcp/oauth/token",
        form({ grant_type: "client_credentials", client_id: CLIENT_ID })
      )
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "unsupported_grant_type",
    });
    expect(callsTo("get_mcp_oauth_client_as_system")).toHaveLength(0);
  });

  it("answers 500 server_error on a store failure and leaks nothing", async () => {
    state.errors.set("consume_mcp_oauth_authorization_code_as_system", {
      message: "connection to server at 10.0.0.4 lost",
    });
    const { body: requestBody } = codeExchangeBody();
    const response = await tokenPost(
      formRequest("/api/mcp/oauth/token", requestBody)
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "server_error" });
    expect(Object.keys(body)).toEqual(["error"]);
    expect(JSON.stringify(body)).not.toContain("10.0.0.4");
    expect(JSON.stringify(body)).not.toContain("consume_mcp");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

// ─── Revocation ─────────────────────────────────────────────────────────────

describe("POST /api/mcp/oauth/revoke", () => {
  it("revokes a presented refresh token and answers 200 with an empty body", async () => {
    const refreshToken = mintCredential(REFRESH_TOKEN_PREFIX);
    const response = await revokePost(
      formRequest("/api/mcp/oauth/revoke", form({ token: refreshToken }))
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({});

    const call = lastCallTo("revoke_mcp_oauth_token_as_system");
    expect(call.args).toEqual({ p_token_hash: sha256Hex(refreshToken) });
  });

  it("revokes a presented access token", async () => {
    const accessToken = mintCredential(ACCESS_TOKEN_PREFIX);
    const response = await revokePost(
      formRequest(
        "/api/mcp/oauth/revoke",
        form({ token: accessToken, token_type_hint: "access_token" })
      )
    );
    expect(response.status).toBe(200);
    expect(lastCallTo("revoke_mcp_oauth_token_as_system").args).toEqual({
      p_token_hash: sha256Hex(accessToken),
    });
  });

  it("answers 200 for an unknown token without calling the store", async () => {
    const response = await revokePost(
      formRequest("/api/mcp/oauth/revoke", form({ token: "garbage-token" }))
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(callsTo("revoke_mcp_oauth_token_as_system")).toHaveLength(0);
  });

  it("answers 200 when no token is presented at all", async () => {
    const response = await revokePost(
      formRequest(
        "/api/mcp/oauth/revoke",
        form({ token_type_hint: "refresh_token" })
      )
    );
    expect(response.status).toBe(200);
    expect(callsTo("revoke_mcp_oauth_token_as_system")).toHaveLength(0);
  });

  it("rejects a JSON body with 415", async () => {
    const response = await revokePost(
      formRequest(
        "/api/mcp/oauth/revoke",
        form({ token: mintCredential(ACCESS_TOKEN_PREFIX) }),
        "application/json"
      )
    );
    expect(response.status).toBe(415);
    expect(callsTo("revoke_mcp_oauth_token_as_system")).toHaveLength(0);
  });

  it("answers 500 rather than claiming a revocation that failed", async () => {
    state.errors.set("revoke_mcp_oauth_token_as_system", {
      message: "deadlock detected",
    });
    const response = await revokePost(
      formRequest(
        "/api/mcp/oauth/revoke",
        form({ token: mintCredential(REFRESH_TOKEN_PREFIX) })
      )
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("deadlock");
  });

  it("rate limits revocation by IP", async () => {
    mocks.rateLimit.mockResolvedValue({
      exceeded: true,
      count: 61,
      retryAfterSec: 12,
    });
    const response = await revokePost(
      formRequest(
        "/api/mcp/oauth/revoke",
        form({ token: mintCredential(REFRESH_TOKEN_PREFIX) })
      )
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "mcp-oauth-revoke:203.0.113.7",
      limit: 60,
      windowSec: 60,
    });
  });
});

describe("Phase 12 token exchange", () => {
  const scopes = [
    "ops.correspondence.read",
    "ops.customers.prepare",
    "ops.customers.read",
    "ops.jobs.read",
    "ops.team.read",
  ];
  const revision = {
    consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9",
    exposure_revision: MCP_EXPOSURE_V14.revision,
  };
  it("exchanges an approved minimum-scope code and retains exactly its authority", async () => {
    const labels = scopes.map(
      (scope) =>
        CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS[
          scope as keyof typeof CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS
        ]
    );
    state.clientRow = {
      ...defaultClientRow(),
      ...revision,
      scope: scopes.join(" "),
      scope_ceiling: scopes,
    };
    state.codeRow = {
      ...defaultCodeRow(),
      ...revision,
      scopes,
      accepted_labels: labels,
    };
    const response = await tokenPost(
      formRequest(
        "/api/mcp/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code: mintCredential(AUTHORIZATION_CODE_PREFIX),
          redirect_uri: CALLBACK,
          code_verifier: CODE_VERIFIER,
          resource: RESOURCE,
        })
      )
    );
    expect(response.status).toBe(200);
    expect((await response.json()).scope).toBe(scopes.join(" "));
    const args = lastCallTo("mint_mcp_oauth_grant_as_system").args;
    expect(args).toMatchObject({
      p_active_grantable_scopes: [...MCP_EXPOSURE_V14.grantableScopes],
      p_active_exposure_revision: revision.exposure_revision,
    });
    expect(args).not.toHaveProperty("p_scopes");
  });
  it("refreshes a minimum-scope v14 grant without adding other reads", async () => {
    const labels = scopes.map(
      (scope) =>
        CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS[
          scope as keyof typeof CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS
        ]
    );
    state.clientRow = {
      ...defaultClientRow(),
      ...revision,
      scope: scopes.join(" "),
      scope_ceiling: scopes,
    };
    state.rotatedRow = {
      ...defaultRotatedRow(),
      ...revision,
      scopes,
      accepted_labels: labels,
    };
    const response = await tokenPost(
      formRequest(
        "/api/mcp/oauth/token",
        form({
          grant_type: "refresh_token",
          refresh_token: mintCredential(REFRESH_TOKEN_PREFIX),
          client_id: CLIENT_ID,
        })
      )
    );
    expect(response.status).toBe(200);
    expect((await response.json()).scope).toBe(scopes.join(" "));
  });
});
