/**
 * Integration test — POST /api/setup/progress must not report a step complete
 * for a write the database rejected.
 *
 * Incident 2026-09-03 (Cluster M): public.idx_users_agent_team_directory_v1
 * evaluates a private helper the API roles could not execute, so every non-HOT
 * public.users write failed 42501. The identity step writes first_name /
 * last_name — both covered by that index's key expression, which makes the
 * write permanently non-HOT and therefore a guaranteed failure for the whole
 * outage. The route discarded the error object entirely (`await db.from(...)
 * .update(...).eq(...)` with no destructuring) and still answered
 * `{ success: true }`, so the operator's name vanished mid-onboarding with no
 * signal on either side.
 *
 * All three of this route's bare writes are covered here: the identity update,
 * the existing-company update, and the setup_progress checkpoint that the
 * `success: true` claim is actually about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  verifyAuthTokenMock,
  findUserByAuthMock,
  getServiceRoleClientMock,
  readServerFirstTouchMock,
  recordTrialAttributionMock,
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  readServerFirstTouchMock: vi.fn(),
  recordTrialAttributionMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));
vi.mock("@/lib/pmf/utm-capture", () => ({
  readServerFirstTouch: readServerFirstTouchMock,
}));
vi.mock("@/lib/pmf/trial-attribution", () => ({
  recordTrialAttribution: recordTrialAttributionMock,
}));
vi.mock("@/lib/email/sendgrid", () => ({
  sendOnboardingDay0Welcome: vi.fn().mockResolvedValue({ status: "skipped" }),
}));

import { POST } from "@/app/api/setup/progress/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

interface UpdateOp {
  table: string;
  payload: Record<string, unknown>;
}
type Failure = { message: string; code?: string } | null;

/** The exact rejection the expression-index privilege gap produced in prod. */
const INDEX_PRIVILEGE_ERROR = {
  code: "42501",
  message: "permission denied for function agent_p2_optional_canonical_text",
};

/**
 * Supabase double whose `.update().eq()` can be made to fail per table, and
 * — for public.users — per call index, so the identity write and the trailing
 * setup_progress checkpoint can be failed independently.
 */
function makeDb(options: {
  failUpdatesOn?: string;
  /** 0-based index among that table's updates; every one fails when omitted. */
  failNthUpdate?: number;
  telemetryError?: boolean;
  createError?: boolean;
} = {}) {
  const updates: UpdateOp[] = [];
  const events: Record<string, unknown>[] = [];
  const perTableCount: Record<string, number> = {};

  const builder = (table: string) => ({
    upsert(row: Record<string, unknown>, settings: { onConflict: string; ignoreDuplicates: boolean }) {
      if (table !== "analytics_events") throw new Error("Unexpected telemetry table");
      expect(settings).toEqual({ onConflict: "id", ignoreDuplicates: true });
      if (!events.some((event) => event.id === row.id)) events.push(row);
      return { abortSignal: async () => ({ error: options.telemetryError ? { code: "42501", message: "private error" } : null }) };
    },
    insert() {
      return {
        select: () => ({
          single: async () => ({ data: { id: "log-id" }, error: null }),
        }),
      };
    },
    update(payload: Record<string, unknown>) {
      updates.push({ table, payload });
      const n = perTableCount[table] ?? 0;
      perTableCount[table] = n + 1;
      const shouldFail =
        options.failUpdatesOn === table &&
        (options.failNthUpdate === undefined || options.failNthUpdate === n);
      const error: Failure = shouldFail ? INDEX_PRIVILEGE_ERROR : null;
      return { eq: async () => ({ data: null, error }) };
    },
  });

  return {
    updates,
    events,
    client: {
      from: (table: string) => builder(table),
      rpc: async (fn: string) => {
        if (fn === "create_company_for_owner_by_id") {
          if (options.createError) return { data: null, error: { message: "NO_USER_ROW private details" } };
          return {
            data: {
              company_id: COMPANY_ID,
              company_code: "AB34CD78",
              already_existed: false,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  };
}

function request(body: Record<string, unknown>, origin = "http://localhost") {
  return new NextRequest(`${origin}/api/setup/progress`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthTokenMock.mockResolvedValue({
    uid: "fb-uid",
    email: "owner@example.com",
  });
  findUserByAuthMock.mockResolvedValue({
    id: USER_ID,
    email: "owner@example.com",
    company_id: null,
    setup_progress: {},
  });
  readServerFirstTouchMock.mockReturnValue(null);
  recordTrialAttributionMock.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("POST /api/setup/progress — write truthfulness", () => {
  it("fails the identity step when the users update is rejected", async () => {
    const db = makeDb({ failUpdatesOn: "users", failNthUpdate: 0 });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(
      request({
        token: "tok",
        step: "identity",
        data: { firstName: "Jackson", lastName: "Sweet", phone: "5551234567" },
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBeUndefined();
    expect(body.error).toMatch(/didn't save/i);
    // It stopped at the failed write — the checkpoint was never stamped, so the
    // client can safely retry the same step.
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].payload).toMatchObject({
      first_name: "Jackson",
      last_name: "Sweet",
      phone: "5551234567",
    });
  });

  it("fails the company step when the companies update is rejected", async () => {
    findUserByAuthMock.mockResolvedValue({
      id: USER_ID,
      email: "owner@example.com",
      company_id: COMPANY_ID, // already has a company → the UPDATE branch
      setup_progress: {},
    });
    const db = makeDb({ failUpdatesOn: "companies" });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(
      request({
        token: "tok",
        step: "company",
        data: { companyName: "Brittlewood Appliances", companySize: "2-5" },
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBeUndefined();
    expect(body.error).toMatch(/company details didn't save/i);
    // Attribution and the checkpoint both belong to a step that did not happen.
    expect(recordTrialAttributionMock).not.toHaveBeenCalled();
    expect(db.updates.filter((u) => u.table === "users")).toHaveLength(0);
  });

  it("does not claim success when the setup_progress checkpoint is rejected", async () => {
    // The identity write lands; only the trailing checkpoint fails. `success:
    // true` is a claim about that checkpoint, so it must not be made.
    const db = makeDb({ failUpdatesOn: "users", failNthUpdate: 1 });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(
      request({
        token: "tok",
        step: "identity",
        data: { firstName: "Jackson", lastName: "Sweet" },
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBeUndefined();
    expect(body.error).toMatch(/didn't save/i);
    expect(db.updates).toHaveLength(2);
    expect(db.updates[1].payload).toHaveProperty("setup_progress");
  });

  it("still reports success when every write lands", async () => {
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(
      request({
        token: "tok",
        step: "identity",
        data: { firstName: "Jackson", lastName: "Sweet" },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.setupProgress).toMatchObject({ steps: { identity: true } });
  });
});

describe("company save server outcome telemetry", () => {
  const analytics = {
    attemptId: "44444444-4444-4444-8444-444444444444",
    sessionId: "55555555-5555-4555-8555-555555555555",
  };
  const body = { token: "secret-token", step: "company", data: { companyName: "Private business", referralMethod: "friend" }, analytics };
  beforeEach(() => { vi.stubEnv("VERCEL_ENV", "production"); });

  it("records confirmed company persistence in the browser's session, once per attempt", async () => {
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    for (let i = 0; i < 2; i++) {
      expect((await POST(request(body, "https://app.opsapp.co"))).status).toBe(200);
    }
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({
      user_id: USER_ID, company_id: COMPANY_ID, session_id: analytics.sessionId,
      event_name: "setup_save_server_result", event_type: "action", platform: "web", environment: "production",
      properties: { step: "company", outcome: "succeeded", stage: "checkpoint", status_code: 200 },
    });
    expect(JSON.stringify(db.events)).not.toMatch(/Private business|secret-token|private details/);
  });

  it("records a failed checkpoint even when company creation itself succeeded", async () => {
    const db = makeDb({ failUpdatesOn: "users" }); getServiceRoleClientMock.mockReturnValue(db.client);
    expect((await POST(request(body, "https://app.opsapp.co"))).status).toBe(500);
    expect(db.events[0]).toMatchObject({ event_type: "error", company_id: COMPANY_ID,
      properties: { outcome: "failed", stage: "checkpoint", status_code: 500 },
    });
  });

  it("records a retryable rejected company creation without leaking its database message", async () => {
    const db = makeDb({ createError: true }); getServiceRoleClientMock.mockReturnValue(db.client);
    expect((await POST(request(body, "https://app.opsapp.co"))).status).toBe(409);
    expect(db.events[0]).toMatchObject({ company_id: null, properties: { outcome: "failed", stage: "company_create", status_code: 409 } });
    expect(JSON.stringify(db.events)).not.toContain("private details");
  });

  it("never turns successful setup into failure when telemetry storage rejects the event", async () => {
    const db = makeDb({ telemetryError: true }); getServiceRoleClientMock.mockReturnValue(db.client);
    const response = await POST(request(body, "https://app.opsapp.co"));
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(db.events).toHaveLength(1);
  });

  it("does not describe skipping/checkpoint-only as a saved company", async () => {
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    await POST(request({ ...body, data: undefined }, "https://app.opsapp.co"));
    expect(db.events).toEqual([]);
  });

  it.each([undefined, { attemptId: "not-a-uuid", sessionId: analytics.sessionId }, { ...analytics, sessionId: "private@example.com" }])("ignores missing or invalid telemetry context without blocking setup", async (context) => {
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    expect((await POST(request({ ...body, analytics: context }, "https://app.opsapp.co"))).status).toBe(200);
    expect(db.events).toEqual([]);
  });

  it("rejects local-origin telemetry even when calling the production API", async () => {
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    const req = request(body, "https://app.opsapp.co");
    req.headers.set("origin", "http://localhost:3000");
    expect((await POST(req)).status).toBe(200);
    expect(db.events).toEqual([]);
  });

  it("excludes a preview deployment using the canonical hostname", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    expect((await POST(request(body, "https://app.opsapp.co"))).status).toBe(200);
    expect(db.events).toEqual([]);
  });

  it.each(["http://localhost", "https://preview.vercel.app"])("excludes %s from production telemetry", async (origin) => {
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    await POST(request(body, origin));
    expect(db.events).toEqual([]);
  });

  it("preserves the signup source when later saving setup progress", async () => {
    const snapshot = { version: 1, channel: "organic_search", basis: "utm_referrer", reason: "organic_utm_medium", confidence: 0.9, recorded_at: "2026-09-14T12:00:00Z" };
    findUserByAuthMock.mockResolvedValue({ id: USER_ID, company_id: null, setup_progress: { signup_attribution: snapshot } });
    const db = makeDb(); getServiceRoleClientMock.mockReturnValue(db.client);
    const response = await POST(request(body, "https://app.opsapp.co"));
    expect((await response.json()).setupProgress.signup_attribution).toEqual(snapshot);
  });
});
