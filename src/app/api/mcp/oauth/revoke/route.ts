/**
 * POST /api/mcp/oauth/revoke
 *
 * RFC 7009 token revocation. Presenting either half of a grant — access or
 * refresh token — revokes the grant and its whole token family, so a user
 * disconnecting the connector in its host kills the connection immediately
 * rather than waiting out an access token's ten minutes.
 *
 * The response is always `200 {}`: an unknown, malformed, already-revoked or
 * expired token is indistinguishable from a successful revocation, exactly
 * as RFC 7009 §2.2 requires. The one deviation is a store failure — that
 * answers 500 rather than claiming a revocation that did not happen, since a
 * client is entitled to assume 200 means the token is dead (RFC 7009 §2.2.1
 * anticipates exactly this case with its 503 guidance).
 *
 * `token_type_hint` is accepted and ignored: the prefix on our own
 * credentials already says which kind was presented, and RFC 7009 requires
 * the server to fall back to searching other types anyway.
 *
 * No authentication: the token itself is the credential. Rate limited by IP
 * so the endpoint cannot be used as a cheap hash-probing loop.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_PREFIX,
  McpOAuthStoreError,
  REFRESH_TOKEN_PREFIX,
  credentialDigest,
  revokeTokenByHash,
} from "@/lib/agent-control-plane/mcp/oauth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

const REVOKE_LIMIT = 60;
const REVOKE_WINDOW_SECONDS = 60;
const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
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

function revocationAcknowledged(): NextResponse {
  return NextResponse.json({}, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const limited = await rateLimit({
    key: `mcp-oauth-revoke:${ip}`,
    limit: REVOKE_LIMIT,
    windowSec: REVOKE_WINDOW_SECONDS,
  });
  if (limited.exceeded) {
    return NextResponse.json(
      { error: "temporarily_unavailable" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(limited.retryAfterSec),
        },
      }
    );
  }

  if (mediaType(request) !== "application/x-www-form-urlencoded") {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 415, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const params = new URLSearchParams(await request.text());
    const token = params.get("token");
    if (token) {
      // Refresh first: it is the credential a client is most likely to hand
      // over on disconnect, and the prefixes are disjoint so the order only
      // decides which digest is computed first, never which grant dies.
      const tokenHash =
        credentialDigest(token, REFRESH_TOKEN_PREFIX) ??
        credentialDigest(token, ACCESS_TOKEN_PREFIX);
      if (tokenHash) {
        await revokeTokenByHash(getServiceRoleClient(), tokenHash);
      }
    }
    return revocationAcknowledged();
  } catch (error) {
    console.error(
      "[mcp-oauth-revoke] revocation failed",
      error instanceof McpOAuthStoreError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown"
    );
    return NextResponse.json(
      { error: "server_error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { ...NO_STORE_HEADERS, Allow: "POST" } }
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
