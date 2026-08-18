import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  SCOPE_CONSENT_LABELS,
  getClient,
  isAllowlistedRedirectUri,
  resolveRequestedScopes,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

/**
 * Consent context for the MCP OAuth authorize page (P1 plan §D5, Task 5).
 *
 * Answers exactly one question for an authenticated operator: "who is asking,
 * for which company, to see what?" It is a read: it mints nothing, stores
 * nothing, and grants nothing. The decision endpoint re-validates every
 * parameter independently, so a caller who skips this endpoint gains nothing.
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

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

  const clientId = body.client_id;
  if (typeof clientId !== "string" || !UUID_PATTERN.test(clientId)) {
    return invalidRequest();
  }

  const redirectUri = body.redirect_uri;
  if (typeof redirectUri !== "string" || !isAllowlistedRedirectUri(redirectUri)) {
    return invalidRequest();
  }

  const rawScope = body.scope;
  if (rawScope !== undefined && rawScope !== null && typeof rawScope !== "string") {
    return invalidRequest();
  }
  const scopes = resolveRequestedScopes(
    typeof rawScope === "string" ? rawScope : null
  );
  if (!scopes) return invalidRequest();

  const supabase = getServiceRoleClient();
  const rpcClient = supabase as unknown as McpOAuthRpcClient;

  let clientName: string;
  let companyName: string;
  try {
    const client = await getClient(rpcClient, clientId);
    if (!client || client.disabled) return invalidRequest();
    // Registered-URI membership AND the policy allowlist: a client row is
    // storage, the allowlist is policy, and neither alone is authority.
    if (!client.redirect_uris.includes(redirectUri)) return invalidRequest();
    clientName = client.client_name;

    const { data, error } = await supabase
      .from("companies")
      .select("name")
      .eq("id", auth.companyId)
      .maybeSingle();
    if (error) return serverError();
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    // DESIGN.md §2: the empty state is an em dash, never a placeholder word.
    companyName = name.length > 0 ? name : "—";
  } catch {
    return serverError();
  }

  return NextResponse.json(
    {
      clientName,
      companyName,
      scopes: scopes.map((scope) => ({
        scope,
        label: SCOPE_CONSENT_LABELS[scope],
      })),
    },
    { headers: NO_STORE }
  );
}
