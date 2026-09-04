/**
 * sync-user must never report success for a write the database rejected.
 *
 * Incident 2026-09-03 (Cluster M): a partial expression index on public.users
 * called a private helper that granted EXECUTE only to postgres, so every
 * non-HOT users UPDATE from service_role failed 42501. The existing-user branch
 * logged that failure, then built its 200 response from
 * `mapUserFromDb({ ...existingRow, ...updates })` — handing the caller auth_id
 * and firebase_uid values the database had rejected. The session then proceeded
 * on state the database did not hold.
 *
 * Two independent properties are locked here:
 *   1. the response is always the row the DATABASE returned, never a
 *      client-side merge of the values we asked to write;
 *   2. a rejected update that carried identity columns is a 500, because
 *      private.resolve_uid() keys every users RLS policy — and the onboarding
 *      RPCs — on exactly auth_id / firebase_uid. A rejected cosmetic-only
 *      update is not session-corrupting, so it stays a 200 carrying the true
 *      stored row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthTokenMock, getServiceRoleClientMock } = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
}));

// Real isFirebaseIssuedToken (issuer-prefix check); verifyAuthToken mocked.
vi.mock("@/lib/firebase/admin-verify", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/firebase/admin-verify")
  >("@/lib/firebase/admin-verify");
  return {
    isFirebaseIssuedToken: actual.isFirebaseIssuedToken,
    verifyAuthToken: verifyAuthTokenMock,
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

import { POST } from "@/app/api/auth/sync-user/route";

type Row = Record<string, unknown>;
interface PostgrestError {
  code: string;
  message: string;
}
interface UpdateCall {
  id: unknown;
  payload: Row;
}
interface DbState {
  rows: Row[];
  updates: UpdateCall[];
  /** When set, every users UPDATE is rejected with this error and writes nothing. */
  updateError: PostgrestError | null;
  /**
   * When true the users UPDATE is accepted but matches zero rows (the row was
   * hard-deleted between the lookup and the write). PostgREST's `.single()`
   * surfaces that as PGRST116 rather than as a silent success.
   */
  updateMatchesNoRows: boolean;
  /**
   * Fields the database returns on a SUCCESSFUL update that differ from the
   * payload we sent — models a normalising trigger / generated column. The
   * response must reflect these, which is only possible if the route reads the
   * row back instead of merging its own `updates` onto the stale row.
   */
  serverRewrites: Row | null;
}

/**
 * In-memory `users` double covering the sync-user existing-row path:
 *   lookups  `.select().eq().is().maybeSingle()`   (auth_id → firebase_uid → email)
 *   updates  `.update().eq("id", …).select().single()`  — returns the STORED row
 *   inserts  `.insert().select().single()`
 * `.is("deleted_at", null)` is modelled as `deleted_at == null`, and every
 * lookup matches against ALL provided filters, exactly like PostgREST.
 */
function makeDb(state: DbState) {
  class Query {
    private op: "select" | "update" | "insert" = "select";
    private payload: Row | null = null;
    private filters: Record<string, unknown> = {};
    private applied = false;
    constructor(private readonly table: string) {}

    select() {
      return this;
    }
    insert(payload: Row) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }
    update(payload: Row) {
      this.op = "update";
      this.payload = payload;
      return this;
    }
    eq(column?: string, value?: unknown) {
      if (column) this.filters[column] = value;
      return this;
    }
    is(column?: string, value?: unknown) {
      if (column) this.filters[column] = value ?? null;
      return this;
    }

    private match(): Row[] {
      if (this.table !== "users") return [];
      return state.rows.filter((r) =>
        Object.entries(this.filters).every(
          ([column, value]) => (r[column] ?? null) === (value ?? null)
        )
      );
    }

    /** Applies (or rejects) the pending update exactly once. */
    private applyUpdate(): { data: Row | null; error: PostgrestError | null } {
      if (this.applied || this.op !== "update" || !this.payload) {
        return { data: null, error: null };
      }
      this.applied = true;
      state.updates.push({ id: this.filters.id, payload: this.payload });

      // A rejected statement aborts the transaction: nothing is written, and
      // PostgREST returns no representation alongside the error.
      if (state.updateError) {
        return { data: null, error: state.updateError };
      }

      const target = state.updateMatchesNoRows
        ? undefined
        : state.rows.find((r) => r.id === this.filters.id);
      if (!target) {
        return {
          data: null,
          error: { code: "PGRST116", message: "no rows returned" },
        };
      }
      Object.assign(target, this.payload, state.serverRewrites ?? {});
      // PostgREST returns the row as it now stands in the database.
      return { data: { ...target }, error: null };
    }

    maybeSingle() {
      return { data: this.match()[0] ?? null, error: null };
    }

    single() {
      if (this.op === "update") return this.applyUpdate();
      if (this.op === "insert" && this.payload) {
        return { data: { id: "user-new", ...this.payload }, error: null };
      }
      return { data: this.match()[0] ?? null, error: null };
    }

    // A PostgrestFilterBuilder is itself thenable, so an update awaited without
    // `.select()` still executes. Kept faithful to the real client.
    then(resolve: (x: { data: Row | null; error: PostgrestError | null }) => unknown) {
      return Promise.resolve(this.applyUpdate()).then(resolve);
    }
  }
  return { from: (table: string) => new Query(table) };
}

function makeState(init: {
  rows: Row[];
  updateError?: PostgrestError | null;
  serverRewrites?: Row | null;
  updateMatchesNoRows?: boolean;
}): DbState {
  return {
    rows: init.rows,
    updates: [],
    updateError: init.updateError ?? null,
    serverRewrites: init.serverRewrites ?? null,
    updateMatchesNoRows: init.updateMatchesNoRows ?? false,
  };
}

function wire(state: DbState) {
  getServiceRoleClientMock.mockReturnValue(makeDb(state));
}

async function postSyncUser(body: unknown) {
  const req = new Request("http://localhost/api/auth/sync-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, body: await res.json() };
}

const FIREBASE_ISS = "https://securetoken.google.com/ops-project";
const TOKEN_SUB = "firebase-sub-under-test";
// The real row from the incident, whose identity repair the index blocked.
const LEGACY_ROW_ID = "8cd7056e-85d9-4aea-899e-71614c80adb7";

/** The exact failure the expression-index privilege gap produced in production. */
const INDEX_PRIVILEGE_ERROR: PostgrestError = {
  code: "42501",
  message: "permission denied for function agent_p2_optional_canonical_text",
};

describe("POST /api/auth/sync-user — update truthfulness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 when an identity-bearing update is rejected", async () => {
    // A legacy row: both identity columns null, so the route writes both.
    const state = makeState({
      rows: [
        {
          id: LEGACY_ROW_ID,
          email: "legacy@example.com",
          first_name: "Legacy",
          last_name: "User",
          auth_id: null,
          firebase_uid: null,
          company_id: null,
          deleted_at: null,
          is_active: true,
        },
      ],
      updateError: INDEX_PRIVILEGE_ERROR,
    });
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: TOKEN_SUB,
      email: "legacy@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "legacy@example.com",
    });

    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/identity/i);
    // The rejected values must never reach the caller in any shape.
    expect(JSON.stringify(result.body)).not.toContain(TOKEN_SUB);
    // The identity write really was attempted, and really did not land.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].payload).toMatchObject({
      auth_id: TOKEN_SUB,
      firebase_uid: TOKEN_SUB,
    });
    expect(state.rows[0].auth_id).toBeNull();
    expect(state.rows[0].firebase_uid).toBeNull();
  });

  it("returns 200 with the TRUE stored row when a cosmetic-only update is rejected", async () => {
    // Identity already linked → `updates` carries only updated_at, so the
    // rejection costs the caller nothing session-critical.
    const state = makeState({
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "linked@example.com",
          first_name: "Linked",
          last_name: "User",
          profile_image_url: "https://cdn.example.com/existing.jpg",
          auth_id: TOKEN_SUB,
          firebase_uid: TOKEN_SUB,
          company_id: null,
          deleted_at: null,
          is_active: true,
        },
      ],
      updateError: INDEX_PRIVILEGE_ERROR,
    });
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: TOKEN_SUB,
      email: "linked@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "linked@example.com",
    });

    expect(result.status).toBe(200);
    // The stored value, not a merged guess.
    expect(result.body.user).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      firstName: "Linked",
      lastName: "User",
    });
    // Only the timestamp was ever at stake.
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0].payload)).toEqual(["updated_at"]);
  });

  it("returns the row the database returned, not a client-side merge", async () => {
    // The route asks to write first_name "FromToken", but the database stores
    // "Canonical" (a normalising trigger). The response must show what the
    // database holds — impossible under `{ ...existingRow, ...updates }`.
    const state = makeState({
      rows: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "normalized@example.com",
          first_name: "",
          last_name: "Operator",
          auth_id: TOKEN_SUB,
          firebase_uid: TOKEN_SUB,
          company_id: null,
          deleted_at: null,
          is_active: true,
        },
      ],
      serverRewrites: { first_name: "Canonical" },
    });
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: TOKEN_SUB,
      email: "normalized@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "normalized@example.com",
      firstName: "FromToken",
    });

    expect(result.status).toBe(200);
    expect(state.updates[0].payload).toMatchObject({ first_name: "FromToken" });
    expect(result.body.user.firstName).toBe("Canonical");
  });

  it("returns 500 when the identity-bearing update matches zero rows", async () => {
    // A silent no-op write is the same corruption as a rejected one: the caller
    // would be handed identity columns the database never stored. Reading the
    // row back with `.select().single()` surfaces it as PGRST116 instead of a
    // clean success — which is precisely why the read-back, not just the error
    // check, is load-bearing.
    const state = makeState({
      rows: [
        {
          id: LEGACY_ROW_ID,
          email: "vanished@example.com",
          first_name: "Vanished",
          last_name: "User",
          auth_id: null,
          firebase_uid: null,
          company_id: null,
          deleted_at: null,
          is_active: true,
        },
      ],
      // The row is hard-deleted between the lookup and the write.
      updateMatchesNoRows: true,
    });
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: TOKEN_SUB,
      email: "vanished@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "vanished@example.com",
    });

    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/identity/i);
    expect(JSON.stringify(result.body)).not.toContain(TOKEN_SUB);
  });

  it("returns the freshly stored identity on a successful repair", async () => {
    // The happy path the mitigation restores: the legacy row's identity
    // columns actually land, and the response carries the stored row.
    const state = makeState({
      rows: [
        {
          id: LEGACY_ROW_ID,
          email: "repaired@example.com",
          first_name: "Repaired",
          last_name: "User",
          auth_id: null,
          firebase_uid: null,
          company_id: null,
          deleted_at: null,
          is_active: true,
        },
      ],
    });
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: TOKEN_SUB,
      email: "repaired@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "repaired@example.com",
    });

    expect(result.status).toBe(200);
    expect(result.body.user).toMatchObject({
      id: LEGACY_ROW_ID,
      firstName: "Repaired",
    });
    expect(state.rows[0]).toMatchObject({
      auth_id: TOKEN_SUB,
      firebase_uid: TOKEN_SUB,
    });
  });
});
