/**
 * GET /.well-known/oauth-protected-resource
 *
 * RFC 9728 root fallback probe location. Clients that do not path-insert the
 * resource path land here; the document is byte-identical to the one served
 * at `/.well-known/oauth-protected-resource/api/mcp` because both describe
 * the same single protected resource.
 *
 * The duplication is deliberate: RFC 9728 mandates two probe locations, and
 * both are route entry points rather than a shared handler so neither can be
 * silently dropped by a refactor of the other. Every value is derived from
 * the same config resolver and scope constant, so the only thing repeated is
 * the document shape — and a unit test asserts the two responses stay equal.
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
