/**
 * Integration test — POST /api/setup/progress, step "company"
 *
 * Regression cover for two related web-signup holes:
 *
 *  1. bug bb4775c1-07a5-444c-a9b2-952e9b9b2f0e — the step wrote the company but
 *     never wrote a `user_roles` row, never set `role`/`user_type`, and never
 *     minted a `company_code`, leaving five production account holders with no
 *     permissions.
 *  2. The partial-state gap that survived that fix — the step still spanned four
 *     autocommit statements, so a failure after the company insert left the
 *     company committed with the user unlinked, and the retry minted a SECOND
 *     company. One production account holder accumulated five orphan companies
 *     in 33 seconds and never got into the product.
 *
 * Both are now closed by `public.create_company_for_owner_by_id`, which does the
 * company + join code + Owner role row + owner labels + defaults in ONE
 * transaction and ADOPTS an existing unlinked company instead of duplicating it.
 *
 * These tests therefore assert the route's half of that contract:
 *   - it delegates creation to the RPC and never writes the company, the role
 *     row, or the owner labels itself (any direct write is a partial-state
 *     regression);
 *   - a retry cannot produce a second company;
 *   - the RPC's typed errors map to the right status codes.
 *
 * External boundaries mocked: verifyAuthToken, findUserByAuth,
 * getServiceRoleClient, the PMF attribution helpers, and the SendGrid dispatch
 * behind the fire-and-forget day-0 welcome.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { verifyAuthTokenMock, findUserByAuthMock, getServiceRoleClientMock } = vi.hoisted(
  () => ({
    verifyAuthTokenMock: vi.fn(),
    findUserByAuthMock: vi.fn(),
    getServiceRoleClientMock: vi.fn(),
  })
);

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
  readServerFirstTouch: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/pmf/record-trial-attribution", () => ({
  recordTrialAttribution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendOnboardingDay0Welcome: vi.fn().mockResolvedValue({ status: "skipped" }),
}));

import { POST } from "@/app/api/setup/progress/route";

// ─── Recording Supabase double ────────────────────────────────────────────────

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const CREATE_RPC = "create_company_for_owner_by_id";

interface Op {
  table: string;
  kind: "insert" | "upsert" | "update";
  payload: Record<string, unknown>;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

type Failure = { message: string; code?: string; details?: string } | null;

interface DbOptions {
  /** Error returned by the create RPC. */
  rpcError?: Failure;
  /** Payload returned by the create RPC. */
  rpcResult?: Record<string, unknown> | null;
}

function makeDb(options: DbOptions = {}) {
  const ops: Op[] = [];
  const rpcs: RpcCall[] = [];

  const builder = (table: string) => ({
    insert(payload: Record<string, unknown>) {
      ops.push({ table, kind: "insert", payload });
      return {
        select: () => ({
          single: async () => ({ data: { id: "log-id" }, error: null }),
        }),
      };
    },
    upsert(payload: Record<string, unknown>) {
      ops.push({ table, kind: "upsert", payload });
      return Promise.resolve({ data: null, error: null });
    },
    update(payload: Record<string, unknown>) {
      ops.push({ table, kind: "update", payload });
      return { eq: async () => ({ data: null, error: null }) };
    },
  });

  return {
    ops,
    rpcs,
    client: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        if (fn === CREATE_RPC) {
          if (options.rpcError) return { data: null, error: options.rpcError };
          return {
            data:
              options.rpcResult === undefined
                ? {
                    company_id: COMPANY_ID,
                    company_code: "AB34CD78",
                    already_existed: false,
                  }
                : options.rpcResult,
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

const companyStep = (data: Record<string, unknown> = {}) =>
  request({
    token: "tok",
    step: "company",
    data: { companyName: "Brittlewood Appliances", ...data },
  });

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthTokenMock.mockResolvedValue({ uid: "fb-uid", email: "owner@example.com" });
  findUserByAuthMock.mockResolvedValue({
    id: USER_ID,
    email: "owner@example.com",
    company_id: null,
    setup_progress: {},
  });
});

describe("POST /api/setup/progress — company step", () => {
  it("delegates company creation to the atomic RPC with the owner and profile", async () => {
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(
      companyStep({
        industries: ["Appliance Repair"],
        companySize: "2-5",
        companyAge: "1-3",
        weatherDependent: "Yes",
      })
    );
    expect(res.status).toBe(200);

    const create = db.rpcs.find((r) => r.fn === CREATE_RPC);
    expect(create).toBeDefined();
    expect(create!.args).toMatchObject({
      p_user_id: USER_ID,
      p_name: "Brittlewood Appliances",
      p_industries: ["Appliance Repair"],
      p_company_size: "2-5",
      p_company_age: "1-3",
      p_weather_dependent: true,
    });
  });

  it("never writes the company, role row, or owner labels itself", async () => {
    // Every one of these writes was its own autocommit statement before the RPC.
    // A direct write here means the partial-state gap is back: the company can
    // commit while the role row or the link fails.
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    await POST(companyStep());

    expect(db.ops.find((o) => o.table === "companies")).toBeUndefined();
    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
    expect(
      db.ops.find(
        (o) =>
          o.table === "users" &&
          ("company_id" in o.payload ||
            "is_company_admin" in o.payload ||
            "user_type" in o.payload)
      )
    ).toBeUndefined();
  });

  it("does not create a second company when a retry adopts the first", async () => {
    // The retry path. The previous attempt died after the company insert, so the
    // RPC adopts that orphan and reports already_existed. The route must treat
    // this as success and must not insert anything of its own.
    const db = makeDb({
      rpcResult: {
        company_id: COMPANY_ID,
        company_code: "AB34CD78",
        already_existed: true,
      },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());

    expect(res.status).toBe(200);
    expect(db.rpcs.filter((r) => r.fn === CREATE_RPC)).toHaveLength(1);
    expect(db.ops.find((o) => o.table === "companies")).toBeUndefined();
  });

  it("leaves no partial writes behind when the RPC fails", async () => {
    const db = makeDb({
      rpcError: { message: "target_is_admin", code: "42501" },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());
    expect(res.status).toBe(500);

    // Neither the link nor the progress write may happen on a failed company step.
    expect(db.ops.find((o) => o.table === "users")).toBeUndefined();
    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
  });

  it.each([
    ["NO_USER_ROW", 409],
    ["ALREADY_IN_COMPANY", 409],
    ["INVALID_NAME", 400],
    ["USER_INACTIVE", 403],
    ["something unexpected exploded", 500],
  ])("maps RPC error %s to HTTP %i", async (token, status) => {
    const db = makeDb({ rpcError: { message: token } });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());
    expect(res.status).toBe(status);
  });

  it("falls back to a placeholder name rather than tripping INVALID_NAME", async () => {
    // The RPC rejects a blank name. A whitespace-only submission must not turn
    // into a 400 that strands the user on the company step.
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep({ companyName: "   " }));

    expect(res.status).toBe(200);
    const create = db.rpcs.find((r) => r.fn === CREATE_RPC);
    expect(create!.args.p_name).toBe("Untitled Company");
  });

  it("updates in place — and calls no create RPC — when the user already has a company", async () => {
    findUserByAuthMock.mockResolvedValue({
      id: USER_ID,
      email: "owner@example.com",
      company_id: COMPANY_ID,
      setup_progress: {},
    });
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());

    expect(res.status).toBe(200);
    expect(db.rpcs.find((r) => r.fn === CREATE_RPC)).toBeUndefined();
    const update = db.ops.find((o) => o.table === "companies" && o.kind === "update");
    expect(update!.payload).toMatchObject({ name: "Brittlewood Appliances" });
  });
});
