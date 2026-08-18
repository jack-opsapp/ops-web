import "server-only";

import { getAppUrl } from "@/lib/utils/app-url";

/**
 * OAuth topology for the OPS remote MCP server. The app deployment is both
 * the authorization server and the resource server: issuer is the app origin
 * and the protected resource is the /api/mcp route on that same origin.
 */
export interface McpOAuthConfig {
  readonly issuer: string;
  readonly resource: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string;
  readonly revocationEndpoint: string;
  readonly protectedResourceMetadataUrl: string;
}

const DEFAULT_PORT_BY_SCHEME: Readonly<Record<string, string>> = Object.freeze({
  "https:": "443",
  "http:": "80",
});

/**
 * RFC 8707 canonical form: lowercase scheme/host, default port elided, no
 * trailing slash, no fragment. Claude sends `resource` already canonicalized
 * this way; audience comparison must happen on this form, never on the
 * user-typed string.
 */
export function canonicalizeResourceUri(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const scheme = parsed.protocol;
  const host = parsed.hostname.toLowerCase();
  const port =
    parsed.port && parsed.port !== DEFAULT_PORT_BY_SCHEME[scheme]
      ? `:${parsed.port}`
      : "";
  let path = parsed.pathname;
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") path = "";
  const search = parsed.search ?? "";
  return `${scheme}//${host}${port}${path}${search}`;
}

export function resolveMcpOAuthConfig(): McpOAuthConfig {
  const issuer = canonicalizeResourceUri(getAppUrl());
  if (!issuer) {
    throw new TypeError("MCP OAuth issuer configuration is invalid");
  }
  return Object.freeze({
    issuer,
    resource: `${issuer}/api/mcp`,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/api/mcp/oauth/token`,
    registrationEndpoint: `${issuer}/api/mcp/oauth/register`,
    revocationEndpoint: `${issuer}/api/mcp/oauth/revoke`,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/api/mcp`,
  });
}
