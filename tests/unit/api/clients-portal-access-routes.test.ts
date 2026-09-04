/**
 * Staff "Portal access" routes (PUBLIC API P1, design §5.4, invariants I2/I7).
 *
 *   GET  /api/clients/[id]/portal-access
 *   POST /api/clients/[id]/portal-access/[membershipId]/confirm
 *   POST /api/clients/[id]/portal-access/[membershipId]/revoke
 *
 * Every route: Firebase staff auth → users row → granular permission (never a
 * role name) → the client must belong to the caller's company → the system
 * RPC. The membership RPCs come from the P1-1 migration; here they are mocked
 * at the service-role client boundary against the plan's contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthMock,
  findUserMock,
  checkPermMock,
  rpcMock,
  clientLookupMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  findUserMock: vi.fn(),
  checkPermMock: vi.fn(),
  rpcMock: vi.fn(),
  clientLookupMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: checkPermMock }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: rpcMock,
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column1: string, value1: string) => ({
          eq: (column2: string, value2: string) => ({
            maybeSingle: () =>
              clientLookupMock({ table, columns, column1, value1, column2, value2 }),
          }),
        }),
      }),
    }),
  }),
}));

import { GET as LIST } from "@/app/api/clients/[id]/portal-access/route";
import { POST as CONFIRM } from "@/app/api/clients/[id]/portal-access/[membershipId]/confirm/route";
import { POST as REVOKE } from "@/app/api/clients/[id]/portal-access/[membershipId]/revoke/route";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_A = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP_B = "55555555-5555-4555-8555-555555555555";
const FOREIGN_MEMBERSHIP = "66666666-6666-4666-8666-666666666666";

const LISTING_ROWS = [
  {
    membership_id: MEMBERSHIP_A,
    state: "active_forward_only",
    evidence_kind: "guest_claim",
    contact_email_masked: "j***@example.com",
    last_seen_at: "2026-08-30T12:00:00.000Z",
  },
  {
    membership_id: MEMBERSHIP_B,
    state: "active_full",
    evidence_kind: "staff_confirmed",
    contact_email_masked: "m***@example.com",
    last_seen_at: null,
  },
];

function request(method: "GET" | "POST") {
  return { method, json: async () => ({}) } as unknown as Parameters<typeof LIST>[0];
}

const listParams = { params: Promise.resolve({ id: CLIENT_ID }) };
function actionParams(membershipId: string) {
  return { params: Promise.resolve({ id: CLIENT_ID, membershipId }) };
}

function failRpc(name: string, code: string, message: string) {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "list_customer_memberships_for_client_as_system") {
      return { data: LISTING_ROWS, error: null };
    }
    if (fn === name) return { data: null, error: { code, message } };
    return { data: null, error: { code: "42883", message: `unknown rpc ${fn}` } };
  });
}

function listCall(name: string) {
  return rpcMock.mock.calls.filter(([fn]) => fn === name);
}

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "staff@example.com" });
  findUserMock.mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID, is_active: true });
  checkPermMock.mockResolvedValue(true);
  clientLookupMock.mockResolvedValue({ data: { id: CLIENT_ID }, error: null });
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "list_customer_memberships_for_client_as_system") {
      return { data: LISTING_ROWS, error: null };
    }
    if (fn === "confirm_customer_membership_as_system") {
      return { data: "active_full", error: null };
    }
    if (fn === "revoke_customer_membership_as_system") {
      return { data: true, error: null };
    }
    return { data: null, error: { code: "42883", message: `unknown rpc ${fn}` } };
  });
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/clients/[id]/portal-access", () => {
  it("returns 401 without staff auth and never touches the store", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(clientLookupMock).not.toHaveBeenCalled();
  });

  it("asks the user lookup for the columns it gates on", async () => {
    await LIST(request("GET"), listParams);
    expect(findUserMock).toHaveBeenCalledTimes(1);
    const select = String(findUserMock.mock.calls[0][2] ?? "");
    for (const column of ["id", "company_id", "is_active"]) {
      expect(select.split(",").map((c) => c.trim())).toContain(column);
    }
  });

  it("returns 403 for an inactive staff user", async () => {
    findUserMock.mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID, is_active: false });
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gates reads on the granular clients.view permission", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith(USER_ID, "clients.view");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the client is not in the caller's company", async () => {
    clientLookupMock.mockResolvedValue({ data: null, error: null });
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(404);
    expect(clientLookupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "clients",
        column1: "id",
        value1: CLIENT_ID,
        column2: "company_id",
        value2: COMPANY_ID,
      })
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("lists memberships through the system RPC scoped to the company and client", async () => {
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "list_customer_memberships_for_client_as_system",
      { p_company_id: COMPANY_ID, p_client_id: CLIENT_ID }
    );
    await expect(res.json()).resolves.toEqual({
      memberships: [
        {
          membershipId: MEMBERSHIP_A,
          state: "active_forward_only",
          evidenceKind: "guest_claim",
          maskedEmail: "j***@example.com",
          lastSeenAt: "2026-08-30T12:00:00.000Z",
        },
        {
          membershipId: MEMBERSHIP_B,
          state: "active_full",
          evidenceKind: "staff_confirmed",
          maskedEmail: "m***@example.com",
          lastSeenAt: null,
        },
      ],
    });
  });

  it("never echoes company or client identifiers in the listing body", async () => {
    const res = await LIST(request("GET"), listParams);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(COMPANY_ID);
    expect(text).not.toContain(CLIENT_ID);
    expect(text).not.toContain(USER_ID);
  });

  it("returns an empty listing when the RPC yields no rows", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ memberships: [] });
  });

  it("fails closed with 503 portal_access_unavailable when the store RPC is missing", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "portal_access_unavailable" });
  });

  it("refuses a malformed listing row instead of forwarding it", async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...LISTING_ROWS[0], contact_email_masked: "jane@example.com" }],
      error: null,
    });
    const res = await LIST(request("GET"), listParams);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("jane@example.com");
  });
});

describe("POST /api/clients/[id]/portal-access/[membershipId]/confirm", () => {
  it("returns 401 without staff auth", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gates on the granular clients.edit permission", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith(USER_ID, "clients.edit");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a membership id that is not a uuid", async () => {
    const res = await CONFIRM(request("POST"), actionParams("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the client is outside the caller's company", async () => {
    clientLookupMock.mockResolvedValue({ data: null, error: null });
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the membership does not belong to this client", async () => {
    const res = await CONFIRM(request("POST"), actionParams(FOREIGN_MEMBERSHIP));
    expect(res.status).toBe(404);
    expect(listCall("confirm_customer_membership_as_system")).toHaveLength(0);
  });

  it("promotes the membership through the system RPC as the acting staff user", async () => {
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("confirm_customer_membership_as_system", {
      p_membership_id: MEMBERSHIP_A,
      p_staff_user_id: USER_ID,
    });
    await expect(res.json()).resolves.toEqual({ state: "active_full" });
  });

  it("maps the RPC's access_denied to a generic 403", async () => {
    failRpc("confirm_customer_membership_as_system", "42501", "access_denied");
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("maps a membership the store no longer knows to 404", async () => {
    failRpc("confirm_customer_membership_as_system", "P0002", "customer_membership_not_found");
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(404);
  });

  it("maps a membership that can no longer be confirmed to 409", async () => {
    failRpc("confirm_customer_membership_as_system", "22023", "customer_membership_revoked");
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Conflict" });
  });

  it("accepts the evidence kind 'none' the store uses for forward-only rows", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_customer_memberships_for_client_as_system") {
        return { data: [{ ...LISTING_ROWS[0], evidence_kind: "none" }], error: null };
      }
      return { data: "active_full", error: null };
    });
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(200);
  });

  it("fails closed with 503 when the confirm RPC fails", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_customer_memberships_for_client_as_system") {
        return { data: LISTING_ROWS, error: null };
      }
      return { data: null, error: { code: "P0001", message: "boom" } };
    });
    const res = await CONFIRM(request("POST"), actionParams(MEMBERSHIP_A));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "portal_access_unavailable" });
  });
});

describe("POST /api/clients/[id]/portal-access/[membershipId]/revoke", () => {
  it("returns 401 without staff auth", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await REVOKE(request("POST"), actionParams(MEMBERSHIP_B));
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gates on the granular clients.edit permission", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await REVOKE(request("POST"), actionParams(MEMBERSHIP_B));
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith(USER_ID, "clients.edit");
  });

  it("returns 404 when the membership does not belong to this client", async () => {
    const res = await REVOKE(request("POST"), actionParams(FOREIGN_MEMBERSHIP));
    expect(res.status).toBe(404);
    expect(listCall("revoke_customer_membership_as_system")).toHaveLength(0);
  });

  it("revokes through the system RPC with a staff reason", async () => {
    const res = await REVOKE(request("POST"), actionParams(MEMBERSHIP_B));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("revoke_customer_membership_as_system", {
      p_membership_id: MEMBERSHIP_B,
      p_staff_user_id: USER_ID,
      p_reason: "staff_revoked",
    });
    await expect(res.json()).resolves.toEqual({ revoked: true });
  });

  it("maps the RPC's access_denied to a generic 403", async () => {
    failRpc("revoke_customer_membership_as_system", "42501", "access_denied");
    const res = await REVOKE(request("POST"), actionParams(MEMBERSHIP_B));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("reports revoked=false when the store declines a non-live membership", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_customer_memberships_for_client_as_system") {
        return { data: LISTING_ROWS, error: null };
      }
      return { data: false, error: null };
    });
    const res = await REVOKE(request("POST"), actionParams(MEMBERSHIP_B));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revoked: false });
  });

  it("fails closed with 503 when the revoke RPC fails", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_customer_memberships_for_client_as_system") {
        return { data: LISTING_ROWS, error: null };
      }
      return { data: null, error: { code: "P0001", message: "boom" } };
    });
    const res = await REVOKE(request("POST"), actionParams(MEMBERSHIP_B));
    expect(res.status).toBe(503);
  });
});
