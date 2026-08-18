/**
 * POST /api/mcp/oauth/register
 *
 * RFC 7591 dynamic client registration — the registration path Claude uses
 * by default for custom connectors. Public clients only: no secret is
 * generated, stored, or returned, and `token_endpoint_auth_method` is fixed
 * at "none". PKCE S256 (enforced at the authorize/token endpoints) is the
 * only client proof this server accepts.
 *
 * Policy lives in `validateClientRegistration`: the redirect-URI allowlist
 * is exact-match against Anthropic's published connector callback, grant and
 * response types are pinned, and the requested scope is clamped to the read
 * scopes this server issues. Anything else is rejected with an RFC 7591
 * error body — never a partial registration.
 *
 * Rate limit: 10 registrations per hour per IP. Registration is unauthenticated
 * by definition (that is the point of DCR), so the IP window is the only
 * cheap gate standing between a scanner and unbounded client rows.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  McpOAuthStoreError,
  registerClient,
  validateClientRegistration,
} from "@/lib/agent-control-plane/mcp/oauth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

const REGISTRATION_LIMIT = 10;
const REGISTRATION_WINDOW_SECONDS = 3600;
const NO_STORE = "no-store";

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

function registrationError(
  status: number,
  error: string,
  errorDescription: string,
  extraHeaders?: Readonly<Record<string, string>>
): NextResponse {
  return NextResponse.json(
    { error, error_description: errorDescription },
    {
      status,
      headers: { "Cache-Control": NO_STORE, ...(extraHeaders ?? {}) },
    }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const limited = await rateLimit({
    key: `mcp-oauth-register:${ip}`,
    limit: REGISTRATION_LIMIT,
    windowSec: REGISTRATION_WINDOW_SECONDS,
  });
  if (limited.exceeded) {
    return registrationError(
      429,
      "temporarily_unavailable",
      "Too many registration requests.",
      { "Retry-After": String(limited.retryAfterSec) }
    );
  }

  if (mediaType(request) !== "application/json") {
    // Claude's own troubleshooting notes call out body-parser mismatches as a
    // common cause of registration failures; answer with the RFC status for
    // the wrong media type rather than a confusing 400.
    return registrationError(
      415,
      "invalid_request",
      "Registration requests must be application/json."
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return registrationError(
      400,
      "invalid_client_metadata",
      "Registration payload must be a JSON object."
    );
  }

  const validated = validateClientRegistration(payload);
  if (!validated.ok) {
    return registrationError(
      400,
      validated.rejection.error,
      validated.rejection.errorDescription
    );
  }

  const registration = validated.registration;
  try {
    const row = await registerClient(getServiceRoleClient(), {
      clientName: registration.clientName,
      redirectUris: registration.redirectUris,
      scope: registration.scope,
      softwareId: registration.softwareId,
      softwareVersion: registration.softwareVersion,
    });

    return NextResponse.json(
      {
        client_id: row.client_id,
        client_name: row.client_name,
        redirect_uris: row.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: row.grant_types,
        response_types: row.response_types,
        scope: row.scope,
      },
      { status: 201, headers: { "Cache-Control": NO_STORE } }
    );
  } catch (error) {
    console.error(
      "[mcp-oauth-register] registration failed",
      error instanceof McpOAuthStoreError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown"
    );
    return NextResponse.json(
      { error: "server_error" },
      { status: 500, headers: { "Cache-Control": NO_STORE } }
    );
  }
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": NO_STORE } }
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
