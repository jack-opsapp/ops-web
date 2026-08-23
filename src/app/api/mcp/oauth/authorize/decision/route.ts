import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_SECONDS,
  CONSENT_PREVIEW_PREFIX,
  areScopesWithinCeiling,
  canonicalizeResourceUri,
  consentLabelsForScopes,
  consumeConsentPreview,
  createAuthorizationCode,
  credentialDigest,
  getClient,
  isAllowlistedRedirectUri,
  mintCredential,
  resolveActiveMcpConsentCatalog,
  resolveMcpOAuthConfig,
  resolveRequestedScopes,
  sha256Hex,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth";
import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

/**
 * Consent decision for the MCP OAuth mount (P1 plan §D5, Task 5).
 *
 * The browser returns only its decision and the one-time opaque preview it
 * received. The full authorization request, exact visible labels, actor,
 * company, client revisions, redirect, resource, state, and PKCE challenge
 * come from the consumed service-role database snapshot. No browser-echoed
 * authorization field can widen or replace what the operator saw.
 *
 * A validation failure returns a 400 body, never a redirect. Only a consumed
 * snapshot whose registered redirect remains allowlisted can produce a
 * `redirect_to`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function stateSuffix(state: string | null): string {
  return state === null ? "" : `&state=${encodeURIComponent(state)}`;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return invalidRequest();
  }
  const body = payload as Readonly<Record<string, unknown>>;
  const bodyKeys = Object.keys(body).sort();
  if (
    bodyKeys.length !== 2 ||
    bodyKeys[0] !== "consent_preview" ||
    bodyKeys[1] !== "decision"
  ) {
    return invalidRequest();
  }

  const decision = body.decision;
  if (decision !== "approve" && decision !== "deny") {
    return invalidRequest();
  }
  const previewDigest =
    typeof body.consent_preview === "string"
      ? credentialDigest(body.consent_preview, CONSENT_PREVIEW_PREFIX)
      : null;
  if (previewDigest === null) return invalidRequest();

  const rpcClient = getServiceRoleClient() as unknown as McpOAuthRpcClient;
  let preview;
  try {
    preview = await consumeConsentPreview(rpcClient, {
      previewHash: previewDigest,
      userId: auth.id,
      companyId: auth.companyId,
    });
  } catch {
    return serverError();
  }

  const exposure = resolveActiveMcpExposure();
  const consentCatalog = resolveActiveMcpConsentCatalog();
  const scopes = preview
    ? resolveRequestedScopes(preview.scopes.join(" "), exposure)
    : null;
  const acceptedLabels = scopes
    ? consentLabelsForScopes(scopes, consentCatalog)
    : null;
  const config = resolveMcpOAuthConfig();
  if (
    !preview ||
    preview.user_id !== auth.id ||
    preview.company_id !== auth.companyId ||
    preview.response_type !== "code" ||
    scopes === null ||
    acceptedLabels === null ||
    !sameStrings(preview.scopes, scopes) ||
    !sameStrings(preview.accepted_labels, acceptedLabels) ||
    preview.consent_catalog_revision !== consentCatalog.revision ||
    preview.exposure_revision !== exposure.revision ||
    preview.code_challenge_method !== "S256" ||
    canonicalizeResourceUri(preview.resource) !== config.resource ||
    preview.resource !== config.resource ||
    !isAllowlistedRedirectUri(preview.redirect_uri)
  ) {
    return invalidRequest();
  }

  let client;
  try {
    client = await getClient(rpcClient, preview.client_id);
  } catch {
    return serverError();
  }
  if (!client || client.disabled) return invalidRequest();
  if (!client.redirect_uris.includes(preview.redirect_uri)) {
    return invalidRequest();
  }
  if (client.client_name !== preview.client_name) return invalidRequest();
  if (
    client.consent_catalog_revision !== preview.consent_catalog_revision ||
    client.exposure_revision !== preview.exposure_revision
  ) {
    return invalidRequest();
  }
  if (!areScopesWithinCeiling(scopes, client.scope_ceiling)) {
    return invalidRequest();
  }

  if (decision === "deny") {
    return NextResponse.json(
      {
        redirect_to: `${preview.redirect_uri}?error=access_denied${stateSuffix(preview.state)}`,
      },
      { headers: NO_STORE }
    );
  }

  const code = mintCredential(AUTHORIZATION_CODE_PREFIX);
  try {
    await createAuthorizationCode(rpcClient, {
      codeHash: sha256Hex(code),
      clientId: preview.client_id,
      userId: preview.user_id,
      companyId: preview.company_id,
      scopes: preview.scopes,
      acceptedLabels: preview.accepted_labels,
      consentCatalogRevision: preview.consent_catalog_revision,
      exposureRevision: preview.exposure_revision,
      redirectUri: preview.redirect_uri,
      codeChallenge: preview.code_challenge,
      resource: preview.resource,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    });
  } catch {
    return serverError();
  }

  return NextResponse.json(
    {
      redirect_to: `${preview.redirect_uri}?code=${encodeURIComponent(code)}${stateSuffix(preview.state)}`,
    },
    { headers: NO_STORE }
  );
}
