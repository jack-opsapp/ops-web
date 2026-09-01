/**
 * Integration test — POST /api/employee-setup/complete
 *
 * Regression cover for the crew-onboarding twin of bug
 * bb4775c1-07a5-444c-a9b2-952e9b9b2f0e (fixed for owners in 9c39e56f).
 *
 * The fallback that seeds the Unassigned role sent `assigned_at` and
 * `assigned_by` — columns that do not exist on `public.user_roles` (it carries
 * exactly id, user_id, role_id, created_at). PostgREST rejects unknown columns
 * before the statement ever reaches Postgres:
 *
 *   PGRST204 — Could not find the 'assigned_at' column of 'user_roles'
 *              in the schema cache
 *
 * The call discarded its `{ error }`, so the write failed silently and a crew
 * member could finish employee setup with no `user_roles` row at all. This is
 * the ONLY place the web path seeds a role for crew — join-company, sync-user
 * and employee-setup/progress all write none.
 *
 * Verifies:
 *   1. The upsert payload carries ONLY real columns — the assertion that
 *      actually catches the bug.
 *   2. It targets the `user_id` unique index (`user_roles_user_id_key`).
 *   3. A role-write failure is FATAL (500), not swallowed.
 *   4. The write is skipped when the user already has a role row.
 *   5. No admin-granting update precedes the role write — the constraint
 *      trigger `private.guard_user_roles_final_state()` raises
 *      `target_is_admin` (42501) against a target that is already an admin.
 *
 * External boundaries mocked: verifyAuthToken, getServiceRoleClient,
 * dispatchRoleNeededNotification.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  verifyAuthTokenMock,
  getServiceRoleClientMock,
  dispatchRoleNeededNotificationMock,
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  dispatchRoleNeededNotificationMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  dispatchRoleNeededNotification: dispatchRoleNeededNotificationMock,
}));

import { POST } from "@/app/api/employee-setup/complete/route";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";

// ─── Recording Supabase double ────────────────────────────────────────────────

const USER_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "44444444-4444-4444-8444-444444444444";

/** Every column that actually exists on public.user_roles. */
const USER_ROLES_COLUMNS = ["id", "user_id", "role_id", "created_at"] as const;

interface Op {
  table: string;
  kind: "upsert" | "update";
  payload: Record<string, unknown>;
  options?: Record<string, unknown>;
}

type Failure = { message: string; code?: string; details?: string } | null;

interface DbOptions {
  /**
   * Per-call-site failures. Key: `${table}:${kind}`, where `kind` names the
   * individual call rather than just the verb — the route reads `users`
   * twice for different columns, and those two reads fail independently:
   *
   *   users:lookup      auth_id -> user resolution
   *   users:onboarding  onboarding_completed merge read
   *   users:update      setup_progress / onboarding_completed write
   *   user_roles:select existing-role probe
   *   user_roles:upsert Unassigned role seed
   */
  fail?: Record<string, Failure>;
  /** Existing public.user_roles row for the caller, or null for none. */
  existingRole?: { role_id: string } | null;
  /** Overrides merged onto the resolved users row. */
  userRow?: Record<string, unknown> | null;
}

function makeDb(options: DbOptions = {}) {
  const ops: Op[] = [];

  const failureFor = (table: string, kind: Op["kind"]): Failure =>
    options.fail?.[`${table}:${kind}`] ?? null;

  /**
   * Names the call site a select belongs to, so a test can fail exactly one
   * read. Both `users` reads hit the same table; only the column list tells
   * them apart.
   */
  const selectLane = (table: string, columns: string) =>
    table === "users"
      ? columns.includes("onboarding_completed")
        ? "users:onboarding"
        : "users:lookup"
      : `${table}:select`;

  const resolveSelect = (table: string, columns: string) => {
    // A query failure returns no rows AND an error. Reading only `data` makes
    // it indistinguishable from an empty result — the defect under test.
    const failure = options.fail?.[selectLane(table, columns)];
    if (failure) return { data: null, error: failure };

    if (table === "users") {
      if (columns.includes("onboarding_completed")) {
        return { data: { onboarding_completed: { ios: true } }, error: null };
      }
      if (options.userRow === null) return { data: null, error: null };
      return {
        data: {
          id: USER_ID,
          company_id: COMPANY_ID,
          first_name: "Dale",
          last_name: "Whitfield",
          setup_progress: { steps: {} },
          ...options.userRow,
        },
        error: null,
      };
    }
    if (table === "user_roles") {
      return { data: options.existingRole ?? null, error: null };
    }
    return { data: null, error: null };
  };

  const builder = (table: string) => ({
    select(columns: string) {
      // eq()/is() are filters — chainable and inert for the double.
      const chain = {
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => resolveSelect(table, columns),
        single: async () => resolveSelect(table, columns),
      };
      return chain;
    },
    update(payload: Record<string, unknown>) {
      ops.push({ table, kind: "update", payload });
      return {
        eq: async () => ({ data: null, error: failureFor(table, "update") }),
      };
    },
    upsert(payload: Record<string, unknown>, opts?: Record<string, unknown>) {
      ops.push({ table, kind: "upsert", payload, options: opts });
      return Promise.resolve({
        data: null,
        error: failureFor(table, "upsert"),
      });
    },
  });

  return {
    ops,
    client: { from: (table: string) => builder(table) },
  };
}

function request(body: Record<string, unknown> = { idToken: "tok" }) {
  return new NextRequest("http://localhost/api/employee-setup/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthTokenMock.mockResolvedValue({ uid: "fb-uid" });
  dispatchRoleNeededNotificationMock.mockResolvedValue(undefined);
});

describe("POST /api/employee-setup/complete — Unassigned role fallback", () => {
  it("seeds the Unassigned role with only columns that exist on user_roles", async () => {
    const db = makeDb({ existingRole: null });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      needsRole: true,
    });

    const roleWrite = db.ops.find((o) => o.table === "user_roles");
    expect(roleWrite).toBeDefined();
    expect(roleWrite!.payload).toEqual({
      user_id: USER_ID,
      role_id: PRESET_ROLE_IDS.UNASSIGNED,
    });

    // The bug: `assigned_at`/`assigned_by` do not exist on the table, and
    // PostgREST rejects the whole request with PGRST204 before Postgres sees
    // it. Any key outside the real schema reintroduces the silent failure.
    for (const key of Object.keys(roleWrite!.payload)) {
      expect(USER_ROLES_COLUMNS).toContain(key);
    }
  });

  it("targets the user_id unique index as the conflict key", async () => {
    const db = makeDb({ existingRole: null });
    getServiceRoleClientMock.mockReturnValue(db.client);

    await POST(request());

    const roleWrite = db.ops.find((o) => o.table === "user_roles");
    // public.user_roles_user_id_key — UNIQUE (user_id)
    expect(roleWrite!.options).toMatchObject({ onConflict: "user_id" });
  });

  it("fails the request when the role write fails", async () => {
    const db = makeDb({
      existingRole: null,
      fail: {
        "user_roles:upsert": {
          message:
            "Could not find the 'assigned_at' column of 'user_roles' in the schema cache",
          code: "PGRST204",
        },
      },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());
    expect(res.status).toBe(500);
    // The underlying Postgrest message reaches the response — a 500 with the
    // cause named, not a generic one.
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining(
        "Could not find the 'assigned_at' column of 'user_roles'"
      ),
    });

    // Swallowing this is what let a crew member finish setup with no role.
    expect(dispatchRoleNeededNotificationMock).not.toHaveBeenCalled();
  });

  it("does not write a role row when the user already has one", async () => {
    const db = makeDb({ existingRole: { role_id: PRESET_ROLE_IDS.OPERATOR } });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ needsRole: false });

    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
    expect(dispatchRoleNeededNotificationMock).not.toHaveBeenCalled();
  });

  it("keeps an existing Unassigned row and still notifies admins", async () => {
    const db = makeDb({ existingRole: { role_id: PRESET_ROLE_IDS.UNASSIGNED } });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ needsRole: true });

    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
    expect(dispatchRoleNeededNotificationMock).toHaveBeenCalledWith(
      USER_ID,
      db.client
    );
  });

  it("does not seed a role for a user with no company", async () => {
    const db = makeDb({ existingRole: null, userRow: { company_id: null } });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());
    expect(res.status).toBe(200);

    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
    expect(dispatchRoleNeededNotificationMock).not.toHaveBeenCalled();
  });

  it("never grants admin before the role write", async () => {
    const db = makeDb({ existingRole: null });
    getServiceRoleClientMock.mockReturnValue(db.client);

    await POST(request());

    // guard_user_roles_final_state() raises target_is_admin (42501) for any
    // user_roles write whose target is already a company admin. This route
    // must never grant admin ahead of the seed — keep the two ordered if an
    // admin-granting update is ever added here.
    const adminGrant = db.ops.find(
      (o) =>
        o.table === "users" &&
        o.kind === "update" &&
        "is_company_admin" in o.payload
    );
    expect(adminGrant).toBeUndefined();
  });
});

// ─── Unchecked query results ──────────────────────────────────────────────────
//
// Same defect class as the role write above: the call discards its `{ error }`,
// so a failed query is indistinguishable from an empty result. Each read below
// feeds a decision that silently goes the wrong way when the read fails.

describe("POST /api/employee-setup/complete — unchecked query results", () => {
  it("reports a failed user lookup as a server error, not a missing user", async () => {
    const db = makeDb({
      fail: {
        "users:lookup": {
          message: "canceling statement due to statement timeout",
          code: "57014",
        },
      },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());

    // A 404 tells the client the account does not exist — a permanent answer
    // to a transient fault. The employee-setup UI treats it as terminal.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("canceling statement due to statement timeout"),
    });

    // Nothing may be written off a user row that never resolved.
    expect(db.ops).toHaveLength(0);
  });

  it("aborts instead of clobbering onboarding flags when the merge read fails", async () => {
    const db = makeDb({
      fail: {
        "users:onboarding": {
          message: "canceling statement due to statement timeout",
          code: "57014",
        },
      },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("canceling statement due to statement timeout"),
    });

    // This read is the ONLY source of the platform flags already on the row.
    // Defaulting to {} and writing anyway replaces { ios: true } with
    // { web: true } — the user loses their iOS onboarding state for good.
    // The route is idempotent, so aborting costs a retry and nothing else.
    expect(
      db.ops.filter((o) => o.table === "users" && o.kind === "update")
    ).toHaveLength(0);
  });

  it("merges the web flag into flags set by other platforms", async () => {
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());
    expect(res.status).toBe(200);

    const write = db.ops.find(
      (o) => o.table === "users" && o.kind === "update"
    );
    expect(write!.payload.onboarding_completed).toEqual({
      ios: true,
      web: true,
    });
  });

  it("fails the request when the setup-progress write fails", async () => {
    const db = makeDb({
      existingRole: null,
      fail: { "users:update": { message: "deadlock detected", code: "40P01" } },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());

    // Returning success here sends the user back through employee setup on
    // their next sign-in, because the completion flag never landed.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("deadlock detected"),
    });

    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
    expect(dispatchRoleNeededNotificationMock).not.toHaveBeenCalled();
  });

  it("reports a failed role probe instead of demoting the user to Unassigned", async () => {
    const db = makeDb({
      // The row exists. The read of it is what fails.
      existingRole: { role_id: PRESET_ROLE_IDS.OPERATOR },
      fail: {
        "user_roles:select": {
          message: "canceling statement due to statement timeout",
          code: "57014",
        },
      },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(request());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("canceling statement due to statement timeout"),
    });

    // A failed probe reads as "no role row", and the seed upserts on the
    // user_id unique index — so it REPLACES the operator's real role with
    // Unassigned and strips every permission they had. guard_user_roles_
    // final_state() only protects admins, so nothing downstream catches it.
    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
    expect(dispatchRoleNeededNotificationMock).not.toHaveBeenCalled();
  });
});
