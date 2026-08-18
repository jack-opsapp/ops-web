/**
 * /api/mcp/oauth/grants — the operator's own grant register.
 *
 * Two properties carry this endpoint and both are asserted directly:
 *   1. the caller is the only subject. `auth.id` reaches the store on every
 *      verb; nothing in the request body can redirect it at someone else.
 *   2. DELETE is not an oracle. A grant that is not the caller's answers
 *      `200 {revoked:false}` — the same shape a successful revocation uses,
 *      differing only in the boolean — so a caller cannot probe which grant
 *      IDs exist. A malformed ID is the caller's own error and answers 400
 *      without ever reaching the store.
 *
 * The store is a controllable fake over the `*_as_system` RPCs, so every
 * assertion is about the HTTP contract, never about SQL.
 */

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/app/api/agent/_lib/auth", async () => {
  const { NextResponse: Response } = await import("next/server");
  return {
    authenticateRequest: mocks.authenticateRequest,
    // The real guard, not a stand-in: the route's control flow depends on it
    // agreeing with whatever authenticateRequest actually returned.
    isErrorResponse: (value: unknown) => value instanceof Response,
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import {
  DELETE as grantsDelete,
  GET as grantsGet,
  POST as grantsPost,
} from "@/app/api/mcp/oauth/grants/route";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = "8e811f98-9f2b-4f64-b409-ed56074b7dc8";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const GRANT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_GRANT_ID = "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e";
const ENDPOINT = "https://app.opsapp.co/api/mcp/oauth/grants";

const AUTHENTICATED = {
  id: USER_ID,
  companyId: COMPANY_ID,
  role: "owner",
  isManager: true,
  firstName: "Jackson",
  lastName: "Sweet",
};

const GRANT_ROW = {
  grant_id: GRANT_ID,
  client_name: "Claude",
  scopes: ["ops.jobs.read", "ops.schedule.read"],
  created_at: "2026-08-01T12:00:00.000Z",
  last_used_at: "2026-08-18T09:30:00.000Z",
};

const NEVER_USED_ROW = {
  grant_id: OTHER_GRANT_ID,
  client_name: "Claude Desktop",
  scopes: ["ops.customers.read"],
  created_at: "2026-08-17T08:00:00.000Z",
  last_used_at: null,
};

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

const calls: RpcCall[] = [];

function authenticated(): void {
  mocks.authenticateRequest.mockResolvedValue(AUTHENTICATED);
}

function unauthenticated(): void {
  mocks.authenticateRequest.mockResolvedValue(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  );
}

function getRequest(): NextRequest {
  return new NextRequest(ENDPOINT, { method: "GET" });
}

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  mocks.rpc.mockImplementation(
    async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "list_mcp_oauth_grants_for_user_as_system") {
        return { data: [GRANT_ROW, NEVER_USED_ROW], error: null };
      }
      if (fn === "revoke_mcp_oauth_grant_as_system") {
        // The RPC is the ownership boundary: it answers true only for a
        // grant that belongs to the presented user.
        return { data: args.p_grant_id === GRANT_ID, error: null };
      }
      return { data: null, error: { message: `unexpected rpc: ${fn}` } };
    }
  );
});

// ─── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/mcp/oauth/grants", () => {
  it("maps store rows onto the client contract and never caches", async () => {
    authenticated();

    const response = await grantsGet(getRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    await expect(response.json()).resolves.toEqual({
      grants: [
        {
          grantId: GRANT_ID,
          clientName: "Claude",
          scopes: ["ops.jobs.read", "ops.schedule.read"],
          createdAt: "2026-08-01T12:00:00.000Z",
          lastUsedAt: "2026-08-18T09:30:00.000Z",
        },
        {
          grantId: OTHER_GRANT_ID,
          clientName: "Claude Desktop",
          scopes: ["ops.customers.read"],
          createdAt: "2026-08-17T08:00:00.000Z",
          // A never-used grant crosses the boundary as null, not as a
          // fabricated timestamp — the UI renders the em dash from it.
          lastUsedAt: null,
        },
      ],
    });
  });

  it("scopes the listing to the authenticated caller, not to request input", async () => {
    authenticated();

    await grantsGet(getRequest());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      fn: "list_mcp_oauth_grants_for_user_as_system",
      args: { p_user_id: USER_ID, p_company_id: COMPANY_ID },
    });
  });

  it("answers 401 without touching the store when unauthenticated", async () => {
    unauthenticated();

    const response = await grantsGet(getRequest());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 500 rather than an empty list when the store fails", async () => {
    authenticated();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await grantsGet(getRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "server_error" });
    consoleError.mockRestore();
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────────

describe("DELETE /api/mcp/oauth/grants", () => {
  it("revokes the caller's own grant and reports it", async () => {
    authenticated();

    const response = await grantsDelete(deleteRequest({ grantId: GRANT_ID }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ revoked: true });
    expect(calls).toEqual([
      {
        fn: "revoke_mcp_oauth_grant_as_system",
        args: { p_grant_id: GRANT_ID, p_user_id: USER_ID },
      },
    ]);
  });

  it("reports revoked:false for a grant that is not the caller's, and leaks nothing else", async () => {
    authenticated();

    const response = await grantsDelete(
      deleteRequest({ grantId: OTHER_GRANT_ID })
    );

    // 200 with the same body shape as success: a non-owner and a
    // nonexistent grant are indistinguishable from out here.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: false });
    expect(calls[0]?.args).toEqual({
      p_grant_id: OTHER_GRANT_ID,
      p_user_id: USER_ID,
    });
  });

  it("rejects a malformed grantId with 400 before reaching the store", async () => {
    authenticated();

    const response = await grantsDelete(
      deleteRequest({ grantId: "not-a-uuid" })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing grantId and an unparseable body with 400", async () => {
    authenticated();

    const missing = await grantsDelete(deleteRequest({}));
    expect(missing.status).toBe(400);

    const garbage = await grantsDelete(deleteRequest("{not json"));
    expect(garbage.status).toBe(400);

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 401 without touching the store when unauthenticated", async () => {
    unauthenticated();

    const response = await grantsDelete(deleteRequest({ grantId: GRANT_ID }));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

// ─── Method surface ─────────────────────────────────────────────────────────

describe("method surface", () => {
  it("answers 405 on POST and advertises the verbs it does serve", async () => {
    const response = await grantsPost();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, DELETE");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
    });
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });
});
