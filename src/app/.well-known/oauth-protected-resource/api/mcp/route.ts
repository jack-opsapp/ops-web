/**
 * GET /.well-known/oauth-protected-resource/api/mcp
 *
 * RFC 9728 protected resource metadata for the OPS remote MCP server. This
 * is the path-inserted probe location Claude tries FIRST after following the
 * `resource_metadata` pointer on our 401 challenge; the root form lives at
 * `/.well-known/oauth-protected-resource/route.ts` and serves the identical
 * document.
 *
 * Public and unauthenticated by design — the document describes only the
 * OAuth topology and the scope strings the authorization server issues. It
 * names no capability, no tool, and no OPS domain vocabulary (D8).
 *
 * `resource` must match the URL exactly as typed into Claude; it is derived
 * from the canonicalized app origin so a trailing slash or an uppercase host
 * in configuration cannot drift the audience check performed on every token.
 *
 * Cached for five minutes: Claude caches discovery responses globally for
 * roughly that long anyway, so a longer TTL would only slow propagation of a
 * metadata correction.
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
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: [...exposure.grantableScopes],
      bearer_methods_supported: ["header"],
      resource_name: "OPS",
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
