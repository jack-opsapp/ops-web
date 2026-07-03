/**
 * Integration tests for PUT /api/roles/[id]/permissions
 *
 * The write path for the Roles editor (previously a dead direct-table write
 * that bounced off RLS as anon). Verifies:
 *   - 400 malformed body / unregistered permission / unsupported scope
 *   - 401 invalid token
 *   - 404 role not found
 *   - 403 preset role (immutable) and cross-company custom role
 *   - 403 caller lacks team.assign_roles and admin_ids membership
 *   - 200 happy path: transactional replace (delete then insert), restore
 *     attempted if the insert fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}
const recordedCalls: RecordedCall[] = [];

type DbResult = { data: unknown; error: { message: string } | null };
let resultQueue: DbResult[] = [];
function nextResult(data: unknown, error: DbResult["error"] = null): void {
  resultQueue.push({ data, error });
}

function makeMockClient() {
  return {
    from(table: string) {
      const record = (method: string, ...args: unknown[]) =>
        recordedCalls.push({ table, method, args });
      const consume = (): DbResult =>
        resultQueue.length > 0 ? resultQueue.shift()! : { data: null, error: null };
      const b = {
        select: (cols?: string) => { record("select", cols); return b; },
        insert: (rows: unknown) => { record("insert", rows); return b; },
        delete: () => { record("delete"); return b; },
        eq: (col: string, val: unknown) => { record("eq", col, val); return b; },
        is: (col: string, val: unknown) => { record("is", col, val); return b; },
        maybeSingle: async () => { record("maybeSingle"); return consume(); },
        then: (onFulfilled: (v: DbResult) => unknown) => {
          record("await");
          return Promise.resolve(consume()).then(onFulfilled);
        },
      };
      return b;
    },
  };
}

const { verifyAuthMock, findUserMock, checkPermMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  findUserMock: vi.fn(),
  checkPermMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeMockClient(),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: (token: string) => verifyAuthMock(token),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserMock(...args),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermission: (...args: unknown[]) => checkPermMock(...args),
}));

import { PUT } from "@/app/api/roles/[id]/permissions/route";

const ROLE_ID = "44444444-4444-4444-8444-444444444444";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function seedCaller() {
  verifyAuthMock.mockResolvedValue({ uid: "fb-uid-caller", email: "boss@ops.co" });
  findUserMock.mockResolvedValue({ id: CALLER_ID, company_id: COMPANY_ID });
}

function seedRole(overrides: Record<string, unknown> = {}) {
  nextResult({ id: ROLE_ID, is_preset: false, company_id: COMPANY_ID, ...overrides });
}

const VALID_BODY = {
  idToken: "token-1",
  permissions: [
    { permission: "projects.view", scope: "all" },
    { permission: "tasks.view", scope: "assigned" },
  ],
};

beforeEach(() => {
  recordedCalls.length = 0;
  resultQueue = [];
  verifyAuthMock.mockReset();
  findUserMock.mockReset();
  checkPermMock.mockReset();
});

describe("PUT /api/roles/[id]/permissions", () => {
  it("400 when idToken or permissions are missing", async () => {
    const res = await PUT(makeReq({ permissions: [] }), ctx(ROLE_ID));
    expect(res.status).toBe(400);
  });

  it("400 on an unregistered permission", async () => {
    const res = await PUT(
      makeReq({ idToken: "t", permissions: [{ permission: "spec.admin", scope: "all" }] }),
      ctx(ROLE_ID),
    );
    expect(res.status).toBe(400);
  });

  it("400 on a scope the permission does not support", async () => {
    const res = await PUT(
      makeReq({ idToken: "t", permissions: [{ permission: "projects.create", scope: "own" }] }),
      ctx(ROLE_ID),
    );
    expect(res.status).toBe(400);
  });

  it("401 on an invalid token", async () => {
    verifyAuthMock.mockRejectedValue(new Error("Token expired"));
    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(401);
  });

  it("404 when the role does not exist", async () => {
    seedCaller();
    nextResult(null);
    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(404);
  });

  it("403 for a preset role", async () => {
    seedCaller();
    seedRole({ is_preset: true, company_id: null });
    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(403);
  });

  it("403 for another company's custom role", async () => {
    seedCaller();
    seedRole({ company_id: "other-company" });
    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(403);
  });

  it("403 when the caller lacks team.assign_roles and admin_ids membership", async () => {
    seedCaller();
    seedRole();
    checkPermMock.mockResolvedValue(false);
    nextResult({ admin_ids: ["someone-else"] }); // company fallback lookup
    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(403);
  });

  it("replaces the role's permission set (snapshot, delete, insert)", async () => {
    seedCaller();
    seedRole();
    checkPermMock.mockResolvedValue(true);
    nextResult([{ role_id: ROLE_ID, permission: "clients.view", scope: "all" }]); // snapshot
    nextResult(null); // delete
    nextResult(null); // insert

    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, count: 2 });

    const insert = recordedCalls.find(
      (c) => c.table === "role_permissions" && c.method === "insert",
    );
    const rows = insert!.args[0] as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { role_id: ROLE_ID, permission: "projects.view", scope: "all" },
      { role_id: ROLE_ID, permission: "tasks.view", scope: "assigned" },
    ]);
  });

  it("attempts restore when the insert fails", async () => {
    seedCaller();
    seedRole();
    checkPermMock.mockResolvedValue(true);
    nextResult([{ role_id: ROLE_ID, permission: "clients.view", scope: "all" }]); // snapshot
    nextResult(null); // delete ok
    nextResult(null, { message: "insert exploded" }); // insert fails
    nextResult(null); // restore insert

    const res = await PUT(makeReq(VALID_BODY), ctx(ROLE_ID));
    expect(res.status).toBe(500);

    const inserts = recordedCalls.filter(
      (c) => c.table === "role_permissions" && c.method === "insert",
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[1].args[0]).toEqual([
      { role_id: ROLE_ID, permission: "clients.view", scope: "all" },
    ]);
  });

  it("allows clearing all permissions with an empty list", async () => {
    seedCaller();
    seedRole();
    checkPermMock.mockResolvedValue(true);
    nextResult([]); // snapshot
    nextResult(null); // delete

    const res = await PUT(makeReq({ idToken: "t", permissions: [] }), ctx(ROLE_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
  });
});
