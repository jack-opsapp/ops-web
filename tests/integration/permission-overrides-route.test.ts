/**
 * Integration tests for PUT /api/users/[id]/permission-overrides
 *
 * The write path for per-member permission exceptions (BUG BURNDOWN W5,
 * bug 2984e137). Verifies the guard chain in order:
 *   - 400 malformed body (missing idToken / empty payload / set∩clear overlap)
 *   - 401 invalid token
 *   - 404 target not found
 *   - 403 cross-company target
 *   - 409 admin/account-holder target (exceptions are meaningless for bypass users)
 *   - 400 unregistered permission (spec.admin can never transit this route)
 *   - 400 scope not supported by the permission
 *   - 403 caller lacks team.assign_roles and is not in admin_ids
 *   - 200 happy path: upsert with the TARGET's company_id, delete of cleared
 *     rows, one notification to the affected member.
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
        upsert: (rows: unknown, opts?: unknown) => { record("upsert", rows, opts); return b; },
        delete: () => { record("delete"); return b; },
        eq: (col: string, val: unknown) => { record("eq", col, val); return b; },
        in: (col: string, vals: unknown) => { record("in", col, vals); return b; },
        is: (col: string, val: unknown) => { record("is", col, val); return b; },
        maybeSingle: async () => { record("maybeSingle"); return consume(); },
        single: async () => { record("single"); return consume(); },
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

import { PUT } from "@/app/api/users/[id]/permission-overrides/route";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
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

function seedTarget(overrides: Record<string, unknown> = {}) {
  nextResult({
    id: TARGET_ID,
    company_id: COMPANY_ID,
    is_company_admin: false,
    first_name: "Mike",
    last_name: "Metcalf",
    ...overrides,
  });
}

function seedCompany(overrides: Record<string, unknown> = {}) {
  nextResult({ account_holder_id: "someone-else", admin_ids: [], ...overrides });
}

const VALID_BODY = {
  idToken: "token-1",
  set: [
    { permission: "estimates.view", scope: "all", granted: true },
    { permission: "expenses.view", scope: null, granted: false },
  ],
  clear: ["projects.edit"],
};

beforeEach(() => {
  recordedCalls.length = 0;
  resultQueue = [];
  verifyAuthMock.mockReset();
  findUserMock.mockReset();
  checkPermMock.mockReset();
});

describe("PUT /api/users/[id]/permission-overrides", () => {
  it("400 when idToken is missing", async () => {
    const res = await PUT(makeReq({ set: [], clear: [] }), ctx(TARGET_ID));
    expect(res.status).toBe(400);
  });

  it("400 when the payload contains no changes", async () => {
    const res = await PUT(makeReq({ idToken: "t", set: [], clear: [] }), ctx(TARGET_ID));
    expect(res.status).toBe(400);
  });

  it("400 when a permission appears in both set and clear", async () => {
    const res = await PUT(
      makeReq({
        idToken: "t",
        set: [{ permission: "estimates.view", scope: "all", granted: true }],
        clear: ["estimates.view"],
      }),
      ctx(TARGET_ID),
    );
    expect(res.status).toBe(400);
  });

  it("401 on an invalid token", async () => {
    verifyAuthMock.mockRejectedValue(new Error("Token expired"));
    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(401);
  });

  it("404 when the target user does not exist", async () => {
    seedCaller();
    nextResult(null); // target lookup
    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(404);
  });

  it("403 when the target is in another company", async () => {
    seedCaller();
    seedTarget({ company_id: "other-company" });
    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(403);
  });

  it("409 when the target is a company admin (flag)", async () => {
    seedCaller();
    seedTarget({ is_company_admin: true });
    seedCompany();
    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("target_is_admin");
  });

  it("409 when the target is the account holder", async () => {
    seedCaller();
    seedTarget();
    seedCompany({ account_holder_id: TARGET_ID });
    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(409);
  });

  it("400 when a permission is not in the registry (spec.admin stays sealed)", async () => {
    seedCaller();
    seedTarget();
    seedCompany();
    const res = await PUT(
      makeReq({
        idToken: "t",
        set: [{ permission: "spec.admin", scope: "all", granted: true }],
        clear: [],
      }),
      ctx(TARGET_ID),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("permission");
  });

  it("400 when the scope is not supported by the permission", async () => {
    seedCaller();
    seedTarget();
    seedCompany();
    const res = await PUT(
      makeReq({
        idToken: "t",
        // projects.create only supports 'all'
        set: [{ permission: "projects.create", scope: "own", granted: true }],
        clear: [],
      }),
      ctx(TARGET_ID),
    );
    expect(res.status).toBe(400);
  });

  it("403 when the caller lacks team.assign_roles and is not in admin_ids", async () => {
    seedCaller();
    seedTarget();
    seedCompany({ admin_ids: ["not-the-caller"] });
    checkPermMock.mockResolvedValue(false);
    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(403);
  });

  it("applies sets and clears with the target's company, then notifies the member", async () => {
    seedCaller();
    seedTarget();
    seedCompany();
    checkPermMock.mockResolvedValue(true);
    nextResult(null); // upsert
    nextResult(null); // delete
    nextResult(null); // notification insert

    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ applied: 2, cleared: 1 });

    const upsert = recordedCalls.find(
      (c) => c.table === "user_permission_overrides" && c.method === "upsert",
    );
    expect(upsert).toBeDefined();
    const rows = upsert!.args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.user_id).toBe(TARGET_ID);
      expect(row.company_id).toBe(COMPANY_ID);
    }
    expect((upsert!.args[1] as Record<string, unknown>).onConflict).toBe("user_id,permission");

    const del = recordedCalls.find(
      (c) => c.table === "user_permission_overrides" && c.method === "delete",
    );
    expect(del).toBeDefined();
    const delIn = recordedCalls.find(
      (c) => c.table === "user_permission_overrides" && c.method === "in",
    );
    expect(delIn!.args[1]).toEqual(["projects.edit"]);

    const notif = recordedCalls.find(
      (c) => c.table === "notifications" && c.method === "insert",
    );
    expect(notif).toBeDefined();
    const notifRow = notif!.args[0] as Record<string, unknown>;
    expect(notifRow.user_id).toBe(TARGET_ID);
    expect(notifRow.company_id).toBe(COMPANY_ID);
    expect(notifRow.persistent).toBe(false);
  });

  it("still succeeds when the notification insert fails (non-fatal)", async () => {
    seedCaller();
    seedTarget();
    seedCompany();
    checkPermMock.mockResolvedValue(true);
    nextResult(null); // upsert
    nextResult(null); // delete
    nextResult(null, { message: "notification write failed" });

    const res = await PUT(makeReq(VALID_BODY), ctx(TARGET_ID));
    expect(res.status).toBe(200);
  });
});
