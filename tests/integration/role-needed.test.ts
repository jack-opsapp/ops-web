/**
 * Integration tests for POST /api/notifications/role-needed
 *
 * Verifies:
 *   - 400 on missing body fields.
 *   - 404 when company not found.
 *   - 200 with notified=0 when no roles carry team.assign_roles.
 *   - 200 with notified=0 when no users hold those roles.
 *   - Happy path: in-app notifications inserted, push fired to playerIds.
 *   - Push is skipped (not an error) when no admins have onesignal_player_id.
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

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  insert: (rows: unknown) => MockBuilder;
  update: (vals: unknown) => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  in: (col: string, vals: unknown) => MockBuilder;
  is: (col: string, val: unknown) => MockBuilder;
  single: () => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
  then: (onFulfilled: (v: DbResult) => unknown) => Promise<unknown>;
}

function makeMockClient() {
  return {
    from(table: string): MockBuilder {
      const record = (method: string, ...args: unknown[]) =>
        recordedCalls.push({ table, method, args });
      const consume = (): DbResult =>
        resultQueue.length > 0 ? resultQueue.shift()! : { data: null, error: null };

      const b: MockBuilder = {
        select: (cols) => { record("select", cols); return b; },
        insert: (rows) => { record("insert", rows); return b; },
        update: (vals) => { record("update", vals); return b; },
        eq: (col, val) => { record("eq", col, val); return b; },
        in: (col, vals) => { record("in", col, vals); return b; },
        is: (col, val) => { record("is", col, val); return b; },
        single: async () => { record("single"); return consume(); },
        maybeSingle: async () => { record("maybeSingle"); return consume(); },
        then: (onFulfilled) => {
          record("await");
          return Promise.resolve(consume()).then(onFulfilled);
        },
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeMockClient(),
}));

const sendOneSignalPushMock = vi.fn<
  (params: { playerIds: string[]; title: string; body: string; data: Record<string, unknown> }) => Promise<{ ok: boolean }>
>();
vi.mock("@/lib/notifications/onesignal", () => ({
  sendOneSignalPush: (p: Parameters<typeof sendOneSignalPushMock>[0]) =>
    sendOneSignalPushMock(p),
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://app.opsapp.co",
}));

const { POST } = await import(
  "@/app/api/notifications/role-needed/route"
);

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/notifications/role-needed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function callsFor(table: string, method: string): RecordedCall[] {
  return recordedCalls.filter((c) => c.table === table && c.method === method);
}

beforeEach(() => {
  recordedCalls.length = 0;
  resultQueue = [];
  sendOneSignalPushMock.mockReset();
  sendOneSignalPushMock.mockResolvedValue({ ok: true });
});

describe("POST /api/notifications/role-needed", () => {
  it("returns 400 when userId missing", async () => {
    const res = await POST(makeRequest({ userName: "Alex", companyId: "c-1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when userName missing", async () => {
    const res = await POST(makeRequest({ userId: "u-1", companyId: "c-1" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when company not found", async () => {
    nextResult(null);
    const res = await POST(makeRequest({ userId: "u-1", userName: "Alex", companyId: "c-1" }));
    expect(res.status).toBe(404);
  });

  it("returns 200 notified=0 when no roles carry team.assign_roles", async () => {
    nextResult({ name: "Acme" });
    nextResult([]);
    const res = await POST(makeRequest({ userId: "u-1", userName: "Alex", companyId: "c-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notified).toBe(0);
    expect(sendOneSignalPushMock).not.toHaveBeenCalled();
  });

  it("returns 200 notified=0 when no users hold those roles", async () => {
    nextResult({ name: "Acme" });
    nextResult([{ role_id: "r-1" }]);
    nextResult([]);
    const res = await POST(makeRequest({ userId: "u-1", userName: "Alex", companyId: "c-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notified).toBe(0);
  });

  it("happy path: inserts notifications and fires push for admins with player_ids", async () => {
    nextResult({ name: "Acme" });
    nextResult([{ role_id: "r-1" }]);
    nextResult([{ user_id: "admin-1" }, { user_id: "admin-2" }]);
    nextResult([
      { id: "admin-1", onesignal_player_id: "pid-1" },
      { id: "admin-2", onesignal_player_id: "pid-2" },
    ]);

    const res = await POST(makeRequest({ userId: "u-1", userName: "Alex Smith", companyId: "c-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notified).toBe(2);

    const insertCalls = callsFor("notifications", "insert");
    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0].args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("role_needed");
    expect(rows[0].persistent).toBe(true);
    expect(rows[0].action_label).toBe("ASSIGN ROLE");
    expect(rows[0].title).toBe("Alex needs a role");

    expect(sendOneSignalPushMock).toHaveBeenCalledTimes(1);
    const pushCall = sendOneSignalPushMock.mock.calls[0][0];
    expect(pushCall.playerIds).toEqual(["pid-1", "pid-2"]);
    expect(pushCall.title).toBe("Alex needs a role");
    expect(pushCall.body).toBe("Tap to assign their role.");
    expect(pushCall.data.type).toBe("role_needed");
  });

  it("does NOT call sendOneSignalPush when no admins have onesignal_player_id", async () => {
    nextResult({ name: "Acme" });
    nextResult([{ role_id: "r-1" }]);
    nextResult([{ user_id: "admin-1" }]);
    nextResult([{ id: "admin-1", onesignal_player_id: null }]);

    const res = await POST(makeRequest({ userId: "u-1", userName: "Alex", companyId: "c-1" }));
    expect(res.status).toBe(200);
    expect(sendOneSignalPushMock).not.toHaveBeenCalled();
    expect(callsFor("notifications", "insert")).toHaveLength(1);
  });
});
