/**
 * POST /api/mcp/oauth/token
 *
 * RFC 6749 token endpoint for the OPS MCP mount. Two grants:
 *
 *   authorization_code — single-use, PKCE-S256-bound, redirect-bound and
 *     resource-bound. The code row is consumed by a single-statement RPC, so
 *     a replay loses the race rather than being detected after the fact.
 *   refresh_token     — rotated on every use. The rotation RPC detects reuse
 *     of an already-spent refresh token and revokes the whole family; this
 *     route surfaces that as a plain `invalid_grant`.
 *
 * Error discipline: every failed exchange answers `invalid_grant` with no
 * description, regardless of which check failed (unknown code, wrong
 * redirect, bad verifier, expired, replayed). A caller must not be able to
 * distinguish "that code never existed" from "that verifier was wrong" —
 * the uniform answer is what makes the endpoint useless as an oracle. No
 * request value is ever echoed back.
 *
 * Public clients only: there is no client secret to verify, so a
 * client_id that is unknown or disabled answers 401 `invalid_client`.
 *
 * Bodies are `application/x-www-form-urlencoded` per RFC 6749 §3.2 — a JSON
 * body is answered 415, which is the documented failure mode when a client's
 * body parser is misconfigured. Every response carries `Cache-Control:
 * no-store` and `Pragma: no-cache` (RFC 6749 §5.1), including errors and the
 * rate-limit rejection.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_PREFIX,
  McpOAuthStoreError,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  canonicalizeResourceUri,
  consumeAuthorizationCode,
  credentialDigest,
  getClient,
  isAllowlistedRedirectUri,
  isConsentSnapshotValidForExposure,
  mintCredential,
  mintGrant,
  resolveMcpOAuthConfig,
  resolveActiveMcpConsentCatalog,
  resolveMcpConsentCatalogRevision,
  rotateRefreshToken,
  sha256Hex,
  verifyS256Challenge,
} from "@/lib/agent-control-plane/mcp/oauth";
import {
  resolveActiveMcpExposure,
  type McpExposure,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import type { McpConsentCatalog } from "@/lib/agent-control-plane/mcp/oauth/scope-catalog";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

const TOKEN_LIMIT = 60;
const TOKEN_WINDOW_SECONDS = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOKEN_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
  Pragma: "no-cache",
});

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

function mediaType(request: NextRequest): string {
  return (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function tokenError(
  status: number,
  error: string,
  extraHeaders?: Readonly<Record<string, string>>
): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { ...TOKEN_RESPONSE_HEADERS, ...(extraHeaders ?? {}) },
    }
  );
}

/**
 * RFC 6749 §3.2: request parameters MUST NOT be included more than once.
 * A repeated key is the classic parameter-smuggling shape (one value for the
 * check, another for the effect), so it is rejected outright rather than
 * resolved by a first-wins or last-wins rule.
 */
function parseForm(body: string): URLSearchParams | null {
  const params = new URLSearchParams(body);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return params;
}

/** Present-and-non-blank, or null. A blank value is treated as absent. */
function present(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  if (value === null) return null;
  return value.trim() === "" ? null : value;
}

function tokenSuccess(input: {
  accessToken: string;
  refreshToken: string;
  scopes: readonly string[];
}): NextResponse {
  return NextResponse.json(
    {
      access_token: input.accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: input.refreshToken,
      scope: input.scopes.join(" "),
    },
    { headers: TOKEN_RESPONSE_HEADERS }
  );
}

interface MintedPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessHash: string;
  readonly refreshHash: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

function mintPair(): MintedPair {
  const accessToken = mintCredential(ACCESS_TOKEN_PREFIX);
  const refreshToken = mintCredential(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
  };
}

type RpcClient = ReturnType<typeof getServiceRoleClient>;

async function exchangeAuthorizationCode(
  rpc: RpcClient,
  params: URLSearchParams,
  exposure: McpExposure,
  consentCatalog: McpConsentCatalog
): Promise<NextResponse> {
  const code = present(params, "code");
  const redirectUri = present(params, "redirect_uri");
  const clientId = present(params, "client_id");
  const codeVerifier = present(params, "code_verifier");
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return tokenError(400, "invalid_request");
  }

  // A client_id that is not a UUID cannot name a row; answering here keeps a
  // malformed identifier from reaching the RPC and surfacing as a 500.
  if (!UUID_PATTERN.test(clientId)) {
    return tokenError(401, "invalid_client");
  }

  const client = await getClient(rpc, clientId);
  if (!client || client.disabled) {
    return tokenError(401, "invalid_client");
  }

  // Both checks matter: the registered set proves this client asked for that
  // callback, the allowlist proves the callback is still one this server is
  // willing to send a code to even if policy tightened after registration.
  if (
    !client.redirect_uris.includes(redirectUri) ||
    !isAllowlistedRedirectUri(redirectUri)
  ) {
    return tokenError(400, "invalid_grant");
  }

  const codeHash = credentialDigest(code, AUTHORIZATION_CODE_PREFIX);
  if (!codeHash) {
    return tokenError(400, "invalid_grant");
  }

  const codeRow = await consumeAuthorizationCode(rpc, {
    codeHash,
    clientId,
    redirectUri,
  });
  if (!codeRow) {
    return tokenError(400, "invalid_grant");
  }

  if (
    !isConsentSnapshotValidForExposure(
      {
        scopes: codeRow.scopes,
        acceptedLabels: codeRow.accepted_labels,
        consentCatalogRevision: codeRow.consent_catalog_revision,
        exposureRevision: codeRow.exposure_revision,
      },
      exposure,
      consentCatalog,
      { requireActiveExposureRevision: true }
    )
  ) {
    return tokenError(400, "invalid_grant");
  }

  if (!verifyS256Challenge(codeVerifier, codeRow.code_challenge)) {
    return tokenError(400, "invalid_grant");
  }

  // RFC 8707: Claude sends `resource` on the token request too. Compare in
  // canonical form — never byte-for-byte against what a user typed.
  const requestedResource = present(params, "resource");
  if (requestedResource !== null) {
    const canonical = canonicalizeResourceUri(requestedResource);
    if (canonical === null || canonical !== codeRow.resource) {
      return tokenError(400, "invalid_target");
    }
  }

  const minted = mintPair();
  const config = resolveMcpOAuthConfig();
  await mintGrant(rpc, {
    codeHash,
    clientId,
    userId: codeRow.user_id,
    companyId: codeRow.company_id,
    activeExposureRevision: exposure.revision,
    activeGrantableScopes: exposure.grantableScopes,
    accessHash: minted.accessHash,
    refreshHash: minted.refreshHash,
    issuer: config.issuer,
    audience: codeRow.resource,
    accessExpiresAt: minted.accessExpiresAt,
    refreshExpiresAt: minted.refreshExpiresAt,
  });

  return tokenSuccess({
    accessToken: minted.accessToken,
    refreshToken: minted.refreshToken,
    scopes: codeRow.scopes,
  });
}

async function exchangeRefreshToken(
  rpc: RpcClient,
  params: URLSearchParams,
  exposure: McpExposure
): Promise<NextResponse> {
  const presented = present(params, "refresh_token");
  const clientId = present(params, "client_id");
  if (!presented || !clientId) {
    return tokenError(400, "invalid_request");
  }
  if (!UUID_PATTERN.test(clientId)) {
    return tokenError(401, "invalid_client");
  }

  const client = await getClient(rpc, clientId);
  if (!client || client.disabled) {
    return tokenError(401, "invalid_client");
  }

  const presentedHash = credentialDigest(presented, REFRESH_TOKEN_PREFIX);
  if (!presentedHash) {
    return tokenError(400, "invalid_grant");
  }

  const minted = mintPair();
  const rotated = await rotateRefreshToken(rpc, {
    presentedHash,
    clientId,
    activeGrantableScopes: exposure.grantableScopes,
    newAccessHash: minted.accessHash,
    newRefreshHash: minted.refreshHash,
    accessExpiresAt: minted.accessExpiresAt,
    refreshExpiresAt: minted.refreshExpiresAt,
  });
  if (!rotated) {
    return tokenError(400, "invalid_grant");
  }

  // The RPC already revoked the family when it saw a spent token; nothing is
  // issued here and the client is told only "invalid_grant".
  if (rotated.reuse_detected) {
    return tokenError(400, "invalid_grant");
  }

  // Defence in depth: the RPC binds the presented token to this client before
  // rotation; reject any malformed result that violates that binding.
  if (rotated.client_id !== clientId) {
    return tokenError(400, "invalid_grant");
  }

  let consentCatalog: McpConsentCatalog;
  try {
    consentCatalog = resolveMcpConsentCatalogRevision(
      rotated.consent_catalog_revision
    );
  } catch {
    return tokenError(400, "invalid_grant");
  }
  if (
    !isConsentSnapshotValidForExposure(
      {
        scopes: rotated.scopes,
        acceptedLabels: rotated.accepted_labels,
        consentCatalogRevision: rotated.consent_catalog_revision,
        exposureRevision: rotated.exposure_revision,
      },
      exposure,
      consentCatalog,
      { requireActiveExposureRevision: false }
    )
  ) {
    return tokenError(400, "invalid_grant");
  }

  const requestedResource = present(params, "resource");
  if (requestedResource !== null) {
    const canonical = canonicalizeResourceUri(requestedResource);
    if (canonical === null || canonical !== rotated.audience) {
      return tokenError(400, "invalid_target");
    }
  }

  return tokenSuccess({
    accessToken: minted.accessToken,
    refreshToken: minted.refreshToken,
    scopes: rotated.scopes,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const limited = await rateLimit({
    key: `mcp-oauth-token:${ip}`,
    limit: TOKEN_LIMIT,
    windowSec: TOKEN_WINDOW_SECONDS,
  });
  if (limited.exceeded) {
    return tokenError(429, "temporarily_unavailable", {
      "Retry-After": String(limited.retryAfterSec),
    });
  }

  if (mediaType(request) !== "application/x-www-form-urlencoded") {
    return tokenError(415, "invalid_request");
  }

  let params: URLSearchParams | null;
  try {
    params = parseForm(await request.text());
  } catch {
    return tokenError(400, "invalid_request");
  }
  if (!params) {
    return tokenError(400, "invalid_request");
  }

  const grantType = present(params, "grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return tokenError(400, "unsupported_grant_type");
  }

  try {
    const rpc = getServiceRoleClient();
    const exposure = resolveActiveMcpExposure();
    const consentCatalog = resolveActiveMcpConsentCatalog();
    return grantType === "authorization_code"
      ? await exchangeAuthorizationCode(rpc, params, exposure, consentCatalog)
      : await exchangeRefreshToken(rpc, params, exposure);
  } catch (error) {
    console.error(
      "[mcp-oauth-token] exchange failed",
      error instanceof McpOAuthStoreError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown"
    );
    return tokenError(500, "server_error");
  }
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "method_not_allowed" },
    {
      status: 405,
      headers: { ...TOKEN_RESPONSE_HEADERS, Allow: "POST" },
    }
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
