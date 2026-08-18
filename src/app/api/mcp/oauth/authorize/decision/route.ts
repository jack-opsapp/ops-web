import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_SECONDS,
  canonicalizeResourceUri,
  createAuthorizationCode,
  getClient,
  isAllowlistedRedirectUri,
  isValidCodeChallenge,
  mintCredential,
  resolveMcpOAuthConfig,
  resolveRequestedScopes,
  sha256Hex,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

/**
 * The consent decision endpoint for the MCP OAuth mount (P1 plan §D5, Task 5).
 *
 * This is where consent becomes authority, so it trusts nothing that came
 * before it. Every authorization parameter is re-validated here from scratch,
 * independent of whatever the context endpoint said a moment earlier — the
 * page is a browser surface and its POST body is attacker-shaped input.
 *
 * The single hardest rule: a validation failure returns a 400 body, never a
 * redirect. Redirecting on a failure would mean navigating to a target that
 * failed validation, which is the open-redirect this allowlist exists to
 * prevent. Only a request that passed every check earns a `redirect_to`, and
 * that value is always built from the allowlisted, client-registered URI.
 *
 * The grant binds `(user, company, client)` from the authenticated session.
 * Company is never read from the request — an operator cannot consent on
 * behalf of a company they are not in, because the request cannot name one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_STATE_LENGTH = 2048;
const DECISION_RATE_LIMIT = 30;
const DECISION_RATE_WINDOW_SECONDS = 300;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function invalidRequest(): NextResponse {
  return NextResponse.json(
    { error: "invalid_request" },
    { status: 400, headers: NO_STORE }
  );
}

function serverError(): NextResponse {
  return NextResponse.json(
    { error: "server_error" },
    { status: 500, headers: NO_STORE }
  );
}

/**
 * `state` is echoed back into a URL we hand the browser. Control characters
 * are the header/URL-splitting vector, so they are rejected outright rather
 * than stripped — mirrors the loop in `safeRedirectPath`.
 */
function isSafeState(value: string): boolean {
  if (value.length > MAX_STATE_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function stateSuffix(state: string | null): string {
  return state === null ? "" : `&state=${encodeURIComponent(state)}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const limit = await rateLimit({
    key: `mcp-oauth-decision:${auth.id}`,
    limit: DECISION_RATE_LIMIT,
    windowSec: DECISION_RATE_WINDOW_SECONDS,
  });
  if (limit.exceeded) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(Math.max(1, limit.retryAfterSec)),
        },
      }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalidRequest();
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return invalidRequest();
  }
  const body = payload as Readonly<Record<string, unknown>>;

  // ── Client identity ──────────────────────────────────────────────────────
  const clientId = body.client_id;
  if (typeof clientId !== "string" || !UUID_PATTERN.test(clientId)) {
    return invalidRequest();
  }

  // ── Redirect target ──────────────────────────────────────────────────────
  const redirectUri = body.redirect_uri;
  if (typeof redirectUri !== "string" || !isAllowlistedRedirectUri(redirectUri)) {
    return invalidRequest();
  }

  // ── Response type ────────────────────────────────────────────────────────
  if (body.response_type !== "code") return invalidRequest();

  // ── PKCE (S256 only; `plain` is never accepted) ──────────────────────────
  const codeChallenge = body.code_challenge;
  if (!isValidCodeChallenge(codeChallenge)) return invalidRequest();
  if (body.code_challenge_method !== "S256") return invalidRequest();

  // ── Scope ceiling ────────────────────────────────────────────────────────
  const rawScope = body.scope;
  if (rawScope !== undefined && rawScope !== null && typeof rawScope !== "string") {
    return invalidRequest();
  }
  const scopes = resolveRequestedScopes(
    typeof rawScope === "string" ? rawScope : null
  );
  if (!scopes) return invalidRequest();

  // ── CSRF state (optional, echoed verbatim) ───────────────────────────────
  const rawState = body.state;
  let state: string | null = null;
  if (rawState !== undefined && rawState !== null) {
    if (typeof rawState !== "string" || !isSafeState(rawState)) {
      return invalidRequest();
    }
    state = rawState.length > 0 ? rawState : null;
  }

  // ── RFC 8707 audience (optional; compared canonically, never byte-wise) ──
  const config = resolveMcpOAuthConfig();
  const rawResource = body.resource;
  let resource = config.resource;
  if (rawResource !== undefined && rawResource !== null) {
    if (typeof rawResource !== "string") return invalidRequest();
    const canonical = canonicalizeResourceUri(rawResource);
    if (canonical === null || canonical !== config.resource) {
      return invalidRequest();
    }
    resource = canonical;
  }

  // ── Decision ─────────────────────────────────────────────────────────────
  const decision = body.decision;
  if (decision !== "approve" && decision !== "deny") return invalidRequest();

  const rpcClient = getServiceRoleClient() as unknown as McpOAuthRpcClient;

  let client;
  try {
    client = await getClient(rpcClient, clientId);
  } catch {
    return serverError();
  }
  if (!client || client.disabled) return invalidRequest();
  if (!client.redirect_uris.includes(redirectUri)) return invalidRequest();

  if (decision === "deny") {
    return NextResponse.json(
      {
        redirect_to: `${redirectUri}?error=access_denied${stateSuffix(state)}`,
      },
      { headers: NO_STORE }
    );
  }

  const code = mintCredential(AUTHORIZATION_CODE_PREFIX);
  try {
    await createAuthorizationCode(rpcClient, {
      // Only the digest is ever stored; the raw code exists solely inside the
      // redirect we are about to hand back.
      codeHash: sha256Hex(code),
      clientId,
      userId: auth.id,
      companyId: auth.companyId,
      scopes,
      redirectUri,
      codeChallenge,
      resource,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    });
  } catch {
    return serverError();
  }

  return NextResponse.json(
    {
      redirect_to: `${redirectUri}?code=${encodeURIComponent(code)}${stateSuffix(state)}`,
    },
    { headers: NO_STORE }
  );
}
