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
 *     supported connectors. Both Claude and Codex use dynamic client
 *     registration when CIMD is unadvertised. Adding the key later requires
 *     the SSRF hardening appropriate for remote metadata retrieval.
 *   - No `token_endpoint_auth_signing_alg_values_supported`, no JWKS: tokens
 *     are opaque, hashed at rest, and resolved from the grant row on every
 *     call, so there is no signing key to publish.
 *
 * Public and unauthenticated: RFC-required OAuth topology and scope strings
 * only, never capability vocabulary.
 */

import { NextResponse } from "next/server";

import { resolveMcpOAuthConfig } from "@/lib/agent-control-plane/mcp/oauth";
import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const DISCOVERY_CACHE_CONTROL = "public, max-age=300";

export async function GET(): Promise<NextResponse> {
  const config = resolveMcpOAuthConfig();
  const exposure = resolveActiveMcpExposure();
  return NextResponse.json(
    {
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      registration_endpoint: config.registrationEndpoint,
      revocation_endpoint: config.revocationEndpoint,
      scopes_supported: [...exposure.grantableScopes],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
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
