import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  CONSENT_PREVIEW_PREFIX,
  CONSENT_PREVIEW_TTL_SECONDS,
  canonicalizeResourceUri,
  consentLabelsForScopes,
  getClient,
  isValidCodeChallenge,
  issueConsentPreview,
  isAllowlistedRedirectUri,
  mintCredential,
  resolveMcpOAuthConfig,
  resolveMcpConsentCatalogRevision,
  resolveOAuthExposureForSubject,
  resolveRequestedScopes,
  sha256Hex,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

/**
 * Consent context for the MCP OAuth authorize page (P1 plan §D5, Task 5).
 *
 * Answers exactly one question for an authenticated operator: "who is asking,
 * for which company, to see what?" It stores no authority, only a bounded,
 * short-lived digest of the exact context the operator sees. The decision
 * endpoint must consume that opaque preview once before it can create a code.
 * A caller who skips this endpoint gains nothing.
 *
 * Every rejection is the same opaque `invalid_request`. Naming which check
 * failed would turn this endpoint into a probe for which client IDs exist and
 * which redirect URIs are registered — for an unauthenticated-adjacent OAuth
 * surface that is a disclosure, not a courtesy.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_STATE_LENGTH = 2048;
const PREVIEW_RATE_LIMIT = 30;
const PREVIEW_RATE_WINDOW_SECONDS = 300;

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

function isSafeState(value: string): boolean {
  if (value.length > MAX_STATE_LENGTH) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

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

  const clientId = body.client_id;
  if (typeof clientId !== "string" || !UUID_PATTERN.test(clientId)) {
    return invalidRequest();
  }

  const redirectUri = body.redirect_uri;
  if (
    typeof redirectUri !== "string" ||
    !isAllowlistedRedirectUri(redirectUri)
  ) {
    return invalidRequest();
  }

  if (body.response_type !== "code") return invalidRequest();

  const codeChallenge = body.code_challenge;
  if (!isValidCodeChallenge(codeChallenge)) return invalidRequest();
  if (body.code_challenge_method !== "S256") return invalidRequest();

  const rawScope = body.scope;
  if (
    rawScope !== undefined &&
    rawScope !== null &&
    typeof rawScope !== "string"
  ) {
    return invalidRequest();
  }
  const rawState = body.state;
  let state: string | null = null;
  if (rawState !== undefined && rawState !== null) {
    if (typeof rawState !== "string" || !isSafeState(rawState)) {
      return invalidRequest();
    }
    state = rawState.length > 0 ? rawState : null;
  }

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

  const limit = await rateLimit({
    key: `mcp-oauth-consent-preview:${auth.id}:${auth.companyId}`,
    limit: PREVIEW_RATE_LIMIT,
    windowSec: PREVIEW_RATE_WINDOW_SECONDS,
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

  const rpcClient = getServiceRoleClient() as unknown as McpOAuthRpcClient;
  let client;
  try {
    client = await getClient(rpcClient, clientId);
  } catch {
    return serverError();
  }
  if (!client) return invalidRequest();

  let exposure;
  try {
    exposure = await resolveOAuthExposureForSubject({
      rpcClient,
      client,
      userId: auth.id,
      companyId: auth.companyId,
    });
  } catch {
    return serverError();
  }
  if (exposure === null) return invalidRequest();

  const consentCatalog = resolveMcpConsentCatalogRevision(
    client.consent_catalog_revision
  );
  const scopes = resolveRequestedScopes(
    typeof rawScope === "string" && rawScope.trim() ? rawScope : client.scope,
    exposure
  );
  if (!scopes) return invalidRequest();
  const acceptedLabels = consentLabelsForScopes(scopes, consentCatalog);
  if (!acceptedLabels) return invalidRequest();

  const consentPreview = mintCredential(CONSENT_PREVIEW_PREFIX);
  const expiresAt = new Date(Date.now() + CONSENT_PREVIEW_TTL_SECONDS * 1000);

  let issued;
  try {
    issued = await issueConsentPreview(rpcClient, {
      previewHash: sha256Hex(consentPreview),
      clientId,
      userId: auth.id,
      companyId: auth.companyId,
      redirectUri,
      responseType: "code",
      scopes,
      acceptedLabels,
      consentCatalogRevision: consentCatalog.revision,
      exposureRevision: exposure.revision,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
      resource,
      expiresAt,
    });
  } catch {
    return serverError();
  }
  if (!issued) return invalidRequest();
  if (issued.rate_limited) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(PREVIEW_RATE_WINDOW_SECONDS),
        },
      }
    );
  }

  return NextResponse.json(
    {
      clientName: issued.client_name,
      companyName: issued.company_name,
      consentCatalogRevision: consentCatalog.revision,
      exposureRevision: exposure.revision,
      consentPreview,
      expiresAt: issued.expires_at,
      scopes: scopes.map((scope, index) => ({
        scope,
        label: acceptedLabels[index],
      })),
    },
    { headers: NO_STORE }
  );
}
