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

import { beforeEach, describe, expect, it, vi } from "vitest";
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
} = {}) {
  const updates: UpdateOp[] = [];
  const perTableCount: Record<string, number> = {};

  const builder = (table: string) => ({
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
    client: {
      from: (table: string) => builder(table),
      rpc: async (fn: string) => {
        if (fn === "create_company_for_owner_by_id") {
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

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/setup/progress", {
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
