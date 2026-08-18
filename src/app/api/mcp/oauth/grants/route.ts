/**
 * GET / DELETE /api/mcp/oauth/grants
 *
 * The operator's own view of the MCP OAuth grants issued in their name — the
 * settings-side counterpart to the consent panel's promise that a connection
 * can be revoked at any time.
 *
 * Scope is the caller, always. Both verbs read `auth.id` from the verified
 * Firebase session and never from the request body, so this endpoint cannot
 * be pointed at another operator's grants no matter what is posted to it.
 *
 * DELETE answers `{ revoked: boolean }` and nothing more. The RPC enforces
 * ownership itself and reports `false` for "not yours" and "no such grant"
 * alike; passing that single boolean through unembellished keeps the endpoint
 * from becoming an oracle for which grant IDs exist. A malformed grant ID is
 * a different class of failure — the caller's own request is wrong — so that
 * one answers 400 without touching the store.
 *
 * Never cached: a revocation the operator just performed must never be
 * contradicted by a stale list.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  McpOAuthStoreError,
  listGrantsForUser,
  revokeGrant,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
});

const ALLOWED_METHODS = "GET, DELETE";

function invalidRequest(): NextResponse {
  return NextResponse.json(
    { error: "invalid_request" },
    { status: 400, headers: NO_STORE }
  );
}

function serverError(operation: string, error: unknown): NextResponse {
  console.error(
    `[mcp-oauth-grants] ${operation} failed`,
    error instanceof McpOAuthStoreError
      ? error.message
      : error instanceof Error
        ? error.name
        : "unknown"
  );
  return NextResponse.json(
    { error: "server_error" },
    { status: 500, headers: NO_STORE }
  );
}

function rpcClient(): McpOAuthRpcClient {
  return getServiceRoleClient() as unknown as McpOAuthRpcClient;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  try {
    const rows = await listGrantsForUser(rpcClient(), {
      userId: auth.id,
      companyId: auth.companyId,
    });

    return NextResponse.json(
      {
        grants: rows.map((row) => ({
          grantId: row.grant_id,
          clientName: row.client_name,
          scopes: row.scopes,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
        })),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return serverError("list", error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
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

  const grantId = (payload as Readonly<Record<string, unknown>>).grantId;
  if (typeof grantId !== "string" || !UUID_PATTERN.test(grantId)) {
    return invalidRequest();
  }

  try {
    // The RPC is the ownership boundary: it matches the grant against this
    // user and returns false when it does not belong to them. The route adds
    // no membership check of its own precisely so there is only one place
    // where that rule lives.
    const revoked = await revokeGrant(rpcClient(), {
      grantId,
      userId: auth.id,
    });
    return NextResponse.json({ revoked }, { headers: NO_STORE });
  } catch (error) {
    return serverError("revoke", error);
  }
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { ...NO_STORE, Allow: ALLOWED_METHODS } }
  );
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
