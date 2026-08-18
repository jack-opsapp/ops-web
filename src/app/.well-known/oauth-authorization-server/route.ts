/**
 * GET /.well-known/oauth-authorization-server
 *
 * RFC 8414 authorization server metadata. The OPS deployment is both the
 * authorization server and the resource server, so the issuer is the app
 * origin and every endpoint below lives on it.
 *
 * Deliberate omissions:
 *   - `client_id_metadata_document_supported` is NOT advertised. Accepting
 *     CIMD means fetching remote client metadata (an SSRF surface) to serve
 *     exactly one connection; Claude's documented fallback when CIMD is
 *     unadvertised is dynamic client registration, which it supports out of
 *     the box. Adding the key later is a one-line change plus the SSRF
 *     hardening that decision requires.
 *   - No `token_endpoint_auth_signing_alg_values_supported`, no JWKS: tokens
 *     are opaque, hashed at rest, and resolved from the grant row on every
 *     call, so there is no signing key to publish.
 *
 * Public and unauthenticated: RFC-required OAuth topology and scope strings
 * only, never capability vocabulary.
 */

import { NextResponse } from "next/server";

import {
  resolveMcpOAuthConfig,
  SUPPORTED_READ_SCOPES,
} from "@/lib/agent-control-plane/mcp/oauth";

const DISCOVERY_CACHE_CONTROL = "public, max-age=300";

export async function GET(): Promise<NextResponse> {
  const config = resolveMcpOAuthConfig();
  return NextResponse.json(
    {
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      registration_endpoint: config.registrationEndpoint,
      revocation_endpoint: config.revocationEndpoint,
      scopes_supported: [...SUPPORTED_READ_SCOPES],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: { "Cache-Control": DISCOVERY_CACHE_CONTROL } }
  );
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "GET" } }
  );
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
