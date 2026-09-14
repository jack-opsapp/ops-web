import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthTokenMock, getServiceRoleClientMock } = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
}));
const experiment = vi.hoisted(() => ({ stage: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/pmf/experiment-attribution", () => ({
  stageSignupExperiment: experiment.stage,
  retrySignupExperiment: experiment.retry,
}));

// Use the REAL isFirebaseIssuedToken (issuer-prefix check) so the route's
// firebase_uid gating is exercised against actual claims, while verifyAuthToken
// is mocked to return canned verified tokens.
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

interface SyncUserState {
  userInserts: Array<Record<string, unknown>>;
  /** When set, the first users insert fails with this Postgres error code. */
  firstInsertErrorCode?: string;
  /** Row a concurrent sync-user call committed between our lookup and our
   *  insert. Only visible to lookups issued AFTER the insert attempt, which
   *  is exactly when the 23505 race recovery re-queries. */
  racedRow?: Record<string, unknown>;
  /** Filter columns of users lookups issued after the insert attempt. */
  recoveryLookups: string[][];
}

/**
 * Double for the service-role client covering the new-user path:
 * the three lookup chains (auth_id → firebase_uid → email) all miss,
 * then the insert succeeds and echoes its payload back. With
 * `firstInsertErrorCode` set, the insert instead fails (unique-violation
 * race) and `racedRow` becomes visible to the recovery lookups that follow.
 */
function makeDbDouble(state: SyncUserState) {
  class Query {
    private operation: "insert" | null = null;
    private payload: Record<string, unknown> | null = null;
    private filters: Record<string, unknown> = {};

    constructor(private readonly table: string) {}

    insert(payload: Record<string, unknown>) {
      this.operation = "insert";
      this.payload = payload;
      if (this.table === "users") state.userInserts.push(payload);
      return this;
    }

    select() {
      return this;
    }

    eq(column?: string, value?: unknown) {
      if (column) this.filters[column] = value;
      return this;
    }

    is(column?: string, value?: unknown) {
      if (column) this.filters[column] = value;
      return this;
    }

    maybeSingle() {
      // Pre-insert lookups always miss (the raced row "does not exist yet"
      // when the route runs its initial auth_id → firebase_uid → email
      // chain); post-insert recovery lookups match the raced row column by
      // column, so a firebase_uid filter against a null column misses just
      // like it would in Postgres.
      if (
        this.table === "users" &&
        state.racedRow &&
        state.userInserts.length > 0
      ) {
        state.recoveryLookups.push(Object.keys(this.filters));
        const matches = Object.entries(this.filters).every(
          ([column, value]) =>
            (state.racedRow?.[column] ?? null) === (value ?? null)
        );
        return { data: matches ? state.racedRow : null, error: null };
      }
      return { data: null, error: null };
    }

    single() {
      if (this.operation === "insert" && this.payload) {
        if (state.firstInsertErrorCode && state.userInserts.length === 1) {
          return {
            data: null,
            error: {
              code: state.firstInsertErrorCode,
              message: "duplicate key value violates unique constraint",
            },
          };
        }
        return { data: { id: "user-new", ...this.payload }, error: null };
      }
      return { data: null, error: null };
    }
  }

  return { from: (table: string) => new Query(table) };
}

function makeState(): SyncUserState {
  return { userInserts: [], recoveryLookups: [] };
}

function wireDb(state: SyncUserState) {
  getServiceRoleClientMock.mockReturnValue(makeDbDouble(state));
}

function makeJsonRequest(body: unknown, url = "http://localhost/api/auth/sync-user", cookie = ""): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function postSyncUser(body: unknown) {
  const res = await POST(
    makeJsonRequest(body) as unknown as Parameters<typeof POST>[0]
  );
  return { status: res.status, body: await res.json() };
}

const FIREBASE_ISS = "https://securetoken.google.com/ops-project";
// Synthetic NON-Firebase issuer — a defensive-guard input only. OPS is
// Firebase-only (web + iOS); no live client produces a token with this issuer.
// It exists here purely to exercise the isFirebaseIssuedToken guard (keeps
// firebase_uid null) and the firebase_uid-null race-recovery edge.
const NON_FIREBASE_ISS = "https://ops-project.supabase.co/auth/v1";

describe("POST /api/auth/sync-user row creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defensive guard: creates a new row with firebase_uid null for a NON-Firebase-issued token", async () => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "supabase-auth-uuid-1",
      email: "crew@example.com",
      claims: { iss: NON_FIREBASE_ISS, sub: "supabase-auth-uuid-1" },
    });
    const state = makeState();
    wireDb(state);

    const result = await postSyncUser({
      idToken: "valid-token",
      email: "crew@example.com",
      displayName: "Crew Member",
    });

    expect(result.status).toBe(200);
    expect(state.userInserts).toHaveLength(1);
    // auth_id always carries the token sub; firebase_uid must only ever hold
    // Firebase UIDs, so the isFirebaseIssuedToken guard keeps it null for a
    // non-Firebase issuer. No live client hits this today (OPS is Firebase-
    // only) — this asserts the defense-in-depth guard holds if one ever did.
    expect(state.userInserts[0]).toMatchObject({
      auth_id: "supabase-auth-uuid-1",
      firebase_uid: null,
      email: "crew@example.com",
    });
    expect(result.body.user).toMatchObject({ id: "user-new" });
    expect(experiment.stage).toHaveBeenCalledWith(expect.anything(), expect.any(Request), "user-new");
    expect(experiment.retry).not.toHaveBeenCalled();
  });

  it("creates a new row with firebase_uid set for a Firebase-issued token", async () => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "firebase-user-1",
      email: "owner@example.com",
      claims: { iss: FIREBASE_ISS, sub: "firebase-user-1" },
    });
    const state = makeState();
    wireDb(state);

    const result = await postSyncUser({
      idToken: "valid-token",
      email: "owner@example.com",
      displayName: "Owner User",
    });

    expect(result.status).toBe(200);
    expect(state.userInserts).toHaveLength(1);
    expect(state.userInserts[0]).toMatchObject({
      auth_id: "firebase-user-1",
      firebase_uid: "firebase-user-1",
      email: "owner@example.com",
    });
    expect(result.body.user).toMatchObject({ id: "user-new" });
  });

  it("recovers from a 23505 insert race via the auth_id-first lookup (firebase_uid-null raced row)", async () => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "supabase-auth-uuid-2",
      email: "crew2@example.com",
      claims: { iss: NON_FIREBASE_ISS, sub: "supabase-auth-uuid-2" },
    });
    const state = makeState();
    // A concurrent sync-user call (e.g. JoinPage + AuthProvider firing in
    // parallel) committed this row between our lookup and our insert, so the
    // insert hits Postgres unique_violation 23505. The raced row has the sub in
    // auth_id and firebase_uid null (a legacy/divergent row, or the defensive
    // non-Firebase path) — a firebase_uid-first recovery lookup would miss it;
    // auth_id-first finds it.
    state.firstInsertErrorCode = "23505";
    state.racedRow = {
      id: "user-raced",
      auth_id: "supabase-auth-uuid-2",
      firebase_uid: null,
      email: "crew2@example.com",
      company_id: null,
    };
    wireDb(state);

    const result = await postSyncUser({
      idToken: "valid-token",
      email: "crew2@example.com",
      displayName: "Crew Member",
    });

    // Both racers see a 200 with the same row, as if this call created it.
    expect(result.status).toBe(200);
    expect(state.userInserts).toHaveLength(1);
    expect(result.body.user).toMatchObject({ id: "user-raced" });
    expect(experiment.stage).toHaveBeenCalledWith(expect.anything(), expect.any(Request), "user-raced");
    // Recovery resolved the row on its first lookup, which filters by
    // auth_id; the firebase_uid fallback lookup was never needed.
    expect(state.recoveryLookups).toEqual([["auth_id", "deleted_at"]]);
  });
});

describe("signup attribution before company creation", () => {
  const now = "2026-09-14T20:00:00.000Z";
  const touch = {
    version: 1,
    anonymous_id: "33333333-3333-4333-8333-333333333333",
    captured_at: "2026-09-14T19:55:00.000Z",
    landing_path: "/plans?email=private@example.com",
    utm_source: "google",
    utm_medium: "organic",
  };
  const cookie = (value: unknown) => `__ops_first_touch=${encodeURIComponent(JSON.stringify(value))}`;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("VERCEL_ENV", "production");
    verifyAuthTokenMock.mockResolvedValue({
      uid: "new-firebase-user", email: "owner@example.com", claims: { iss: FIREBASE_ISS },
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  async function signup(value = cookie(touch), url = "https://app.opsapp.co/api/auth/sync-user", state = makeState()) {
    wireDb(state);
    const response = await POST(makeJsonRequest(
      { idToken: "valid-token", email: "owner@example.com" }, url, value
    ) as Parameters<typeof POST>[0]);
    return { state, response, body: await response.json() };
  }

  it("atomically retains classified source with the account, without retaining raw touch identifiers", async () => {
    const { state, response, body } = await signup();
    expect(response.status).toBe(200);
    expect(body.company).toBeNull();
    expect(state.userInserts[0].setup_progress).toEqual({
      steps: {},
      signup_attribution: {
        version: 1, recorded_at: now, channel: "organic_search", basis: "utm_referrer",
        confidence: 0.9, reason: "organic_utm_medium",
      },
    });
    expect(body.user.setupProgress).toEqual(state.userInserts[0].setup_progress);
  });

  it.each([
    ["missing", "", "missing_first_touch"],
    ["malformed", "__ops_first_touch=%7Bbad", "missing_first_touch"],
    ["expired", cookie({ ...touch, captured_at: "2026-07-01T00:00:00Z" }), "expired_first_touch"],
    ["future", cookie({ ...touch, captured_at: "2026-10-01T00:00:00Z" }), "future_first_touch"],
  ])("keeps %s evidence unknown rather than inventing Direct", async (_label, value, reason) => {
    const { body } = await signup(value);
    expect(body.user.setupProgress?.signup_attribution).toMatchObject({ channel: "unknown", basis: "unknown", confidence: 0, reason });
  });

  it.each(["http://localhost:3000", "https://preview.vercel.app", "https://app.opsapp.co.evil.example"])("excludes nonproduction host %s", async (origin) => {
    const { state } = await signup(cookie(touch), `${origin}/api/auth/sync-user`);
    expect(state.userInserts[0].setup_progress).toBeUndefined();
  });

  it("excludes preview deployment even if its request uses the production host", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const { state } = await signup();
    expect(state.userInserts[0].setup_progress).toBeUndefined();
  });

  it("does not assign production attribution to a request originating on localhost", async () => {
    const state = makeState(); wireDb(state);
    const req = makeJsonRequest({ idToken: "valid-token", email: "owner@example.com" }, "https://app.opsapp.co/api/auth/sync-user", cookie(touch));
    req.headers.set("origin", "http://localhost:3000");
    expect((await POST(req as Parameters<typeof POST>[0])).status).toBe(200);
    expect(state.userInserts[0].setup_progress).toBeUndefined();
  });

  it("keeps the concurrent insert winner's attribution instead of relabeling the account", async () => {
    const state = makeState();
    state.firstInsertErrorCode = "23505";
    const original = { steps: {}, signup_attribution: { channel: "referral", recorded_at: now } };
    state.racedRow = { id: "user-raced", auth_id: "new-firebase-user", company_id: null, setup_progress: original };
    const { body } = await signup(cookie(touch), undefined, state);
    expect(body.user.setupProgress).toEqual(original);
  });
});
