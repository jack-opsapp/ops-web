/**
 * Integration tests for DELETE /api/users/[id]/role
 *
 * The working path behind the Roles editor's "Remove" member action (the
 * prior client-side direct-table delete bounced off RLS as anon). Verifies
 * the guard chain and that the legacy users.role column resets to
 * 'unassigned' after the user_roles row is deleted.
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
        update: (vals: unknown) => { record("update", vals); return b; },
        upsert: (rows: unknown, opts?: unknown) => { record("upsert", rows, opts); return b; },
        delete: () => { record("delete"); return b; },
        eq: (col: string, val: unknown) => { record("eq", col, val); return b; },
        in: (col: string, vals: unknown) => { record("in", col, vals); return b; },
        is: (col: string, val: unknown) => { record("is", col, val); return b; },
        like: (col: string, val: unknown) => { record("like", col, val); return b; },
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

import { DELETE } from "@/app/api/users/[id]/role/route";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  recordedCalls.length = 0;
  resultQueue = [];
  verifyAuthMock.mockReset();
  findUserMock.mockReset();
  checkPermMock.mockReset();
});

describe("DELETE /api/users/[id]/role", () => {
  it("400 when idToken is missing", async () => {
    const res = await DELETE(makeReq({}), ctx(TARGET_ID));
    expect(res.status).toBe(400);
  });

  it("403 for a cross-company target", async () => {
    verifyAuthMock.mockResolvedValue({ uid: "fb-uid", email: "boss@ops.co" });
    findUserMock.mockResolvedValue({ id: CALLER_ID, company_id: COMPANY_ID });
    nextResult({ id: TARGET_ID, company_id: "other-company" });
    const res = await DELETE(makeReq({ idToken: "t" }), ctx(TARGET_ID));
    expect(res.status).toBe(403);
  });

  it("deletes the assignment and resets the legacy role column", async () => {
    verifyAuthMock.mockResolvedValue({ uid: "fb-uid", email: "boss@ops.co" });
    findUserMock.mockResolvedValue({ id: CALLER_ID, company_id: COMPANY_ID });
    checkPermMock.mockResolvedValue(true);
    nextResult({ id: TARGET_ID, company_id: COMPANY_ID }); // target lookup
    nextResult(null); // user_roles delete
    nextResult(null); // users.role reset

    const res = await DELETE(makeReq({ idToken: "t" }), ctx(TARGET_ID));
    expect(res.status).toBe(200);

    const del = recordedCalls.find((c) => c.table === "user_roles" && c.method === "delete");
    expect(del).toBeDefined();

    const legacyUpdate = recordedCalls.find(
      (c) => c.table === "users" && c.method === "update",
    );
    expect(legacyUpdate).toBeDefined();
    expect((legacyUpdate!.args[0] as Record<string, unknown>).role).toBe("unassigned");
  });
});
