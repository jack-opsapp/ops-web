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
interface UpdateCall {
  id: unknown;
  payload: Row;
}
interface DbState {
  rows: Row[];
  updates: UpdateCall[];
  inserts: Row[];
}

/**
 * In-memory `users` double covering the sync-user existing-row path:
 *   lookups  `.select().eq().is().maybeSingle()`  (auth_id → firebase_uid → email)
 *   updates  `.update().eq("id", …)`              (awaited directly)
 *   inserts  `.insert().select().single()`
 * `.is("deleted_at", null)` is modelled as `deleted_at == null`. Every lookup
 * matches against ALL provided filters, exactly like PostgREST — so an email
 * lookup resolves a row only when the FILTER email (which the route sets from
 * the verified token, never the request body) equals a row's email.
 */
function makeDb(state: DbState) {
  class Query {
    private op: "select" | "update" | "insert" = "select";
    private payload: Row | null = null;
    private filters: Record<string, unknown> = {};
    constructor(private readonly table: string) {}

    select() {
      return this;
    }
    insert(payload: Row) {
      this.op = "insert";
      this.payload = payload;
      if (this.table === "users") state.inserts.push(payload);
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

    maybeSingle() {
      return { data: this.match()[0] ?? null, error: null };
    }

    single() {
      if (this.op === "insert" && this.payload) {
        return { data: { id: "user-new", ...this.payload }, error: null };
      }
      return { data: null, error: null };
    }

    // The update chain terminates on `.eq("id", …)` and is awaited directly,
    // so Query is a thenable: awaiting it applies the update to the matched row.
    then(resolve: (x: { error: null }) => unknown) {
      if (this.op === "update" && this.payload) {
        const target = state.rows.find((r) => r.id === this.filters.id);
        state.updates.push({ id: this.filters.id, payload: this.payload });
        if (target) Object.assign(target, this.payload);
      }
      return Promise.resolve({ error: null }).then(resolve);
    }
  }
  return { from: (table: string) => new Query(table) };
}

function wire(state: DbState) {
  getServiceRoleClientMock.mockReturnValue(makeDb(state));
}

function makeState(rows: Row[]): DbState {
  return { rows, updates: [], inserts: [] };
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

describe("POST /api/auth/sync-user — CRIT-3 identity guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses an unverified email-only match against a row bound to a DIFFERENT firebase_uid (403)", async () => {
    const state = makeState([
      {
        id: "victim",
        auth_id: null,
        firebase_uid: "victim-fb",
        email: "shared@example.com",
        company_id: "c-victim",
        deleted_at: null,
      },
    ]);
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: "attacker-fb",
      email: "shared@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "shared@example.com",
    });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      error: "Email verification required to access this account.",
    });
    // The victim row is neither rewritten nor handed back.
    expect(state.updates).toHaveLength(0);
    expect(state.rows[0].firebase_uid).toBe("victim-fb");
    expect(state.rows[0].auth_id).toBeNull();
  });

  it("refuses an unverified email-only match against a row bound to a DIFFERENT auth_id (403)", async () => {
    const state = makeState([
      {
        id: "victim2",
        auth_id: "victim-auth",
        firebase_uid: null,
        email: "shared2@example.com",
        company_id: "c-victim2",
        deleted_at: null,
      },
    ]);
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: "attacker-fb2",
      email: "shared2@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "shared2@example.com",
    });

    expect(result.status).toBe(403);
    expect(state.updates).toHaveLength(0);
    expect(state.rows[0].auth_id).toBe("victim-auth");
  });

  it("keeps the legacy-link path open: attaches an UNCLAIMED row (both identity columns null) and backfills both", async () => {
    const state = makeState([
      {
        id: "legacy",
        auth_id: null,
        firebase_uid: null,
        email: "legacy@example.com",
        company_id: null,
        deleted_at: null,
      },
    ]);
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: "web-fb",
      email: "legacy@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "legacy@example.com",
    });

    expect(result.status).toBe(200);
    expect(result.body.user).toMatchObject({ id: "legacy" });
    // An unclaimed row is not bound to anyone, so the caller may attach and
    // both identity columns are stamped from the verified Firebase token.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].payload).toMatchObject({
      auth_id: "web-fb",
      firebase_uid: "web-fb",
    });
  });

  it("resolves the email fallback on the VERIFIED TOKEN email, never the request-body email (CRIT-3)", async () => {
    // The victim's row is keyed by victim@example.com. The attacker holds a
    // token for attacker@example.com but puts the victim's address in the
    // request body. Because the route looks up by the TOKEN email, the victim
    // row is never matched, returned, or touched.
    const state = makeState([
      {
        id: "victim3",
        auth_id: "victim-auth3",
        firebase_uid: "victim-fb3",
        email: "victim@example.com",
        company_id: "c-victim3",
        deleted_at: null,
      },
    ]);
    wire(state);
    verifyAuthTokenMock.mockResolvedValue({
      uid: "attacker-fb3",
      email: "attacker@example.com",
      claims: { iss: FIREBASE_ISS, email_verified: false },
    });

    const result = await postSyncUser({
      idToken: "valid",
      email: "victim@example.com",
      createIfMissing: false,
    });

    // No account resolves for the attacker's verified email → 404, and the
    // victim row is untouched. Had the body email been used for lookup, this
    // would have returned 200 with the victim's account.
    expect(result.status).toBe(404);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
    expect(state.rows[0]).toMatchObject({
      auth_id: "victim-auth3",
      firebase_uid: "victim-fb3",
    });
  });
});
