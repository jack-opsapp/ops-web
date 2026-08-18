/**
 * Integration test — POST /api/setup/progress, step "company"
 *
 * Regression cover for the web-signup hole that left five production account
 * holders with no `user_roles` row, no `role`/`user_type`, and no company join
 * code (bug bb4775c1-07a5-444c-a9b2-952e9b9b2f0e).
 *
 * Verifies:
 *   1. Creating a company writes the Owner `user_roles` row, sets role/user_type,
 *      and mints a company_code.
 *   2. The role row is written BEFORE the users update that sets
 *      is_company_admin — the ordering the user_roles constraint trigger
 *      requires. This is the assertion that actually protects the fix: get the
 *      order wrong in prod and the write raises `target_is_admin` (42501).
 *   3. A role-write failure is FATAL (500), not swallowed.
 *   4. A company-code collision retries with a fresh code.
 *   5. A non-collision insert error is terminal — it does not burn 20 attempts.
 *
 * External boundaries mocked: verifyAuthToken, findUserByAuth,
 * getServiceRoleClient, and the PMF attribution helpers (fire-and-forget).
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

import { POST } from "@/app/api/setup/progress/route";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";
import { COMPANY_CODE_ALPHABET, COMPANY_CODE_LENGTH } from "@/lib/data/company-code";

// ─── Recording Supabase double ────────────────────────────────────────────────

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

interface Op {
  table: string;
  kind: "insert" | "upsert" | "update";
  payload: Record<string, unknown>;
}

type Failure = { message: string; code?: string; details?: string } | null;

interface DbOptions {
  /** Per-table, per-kind failures. Key: `${table}:${kind}`. */
  fail?: Record<string, Failure>;
  /** Number of leading `companies:insert` calls that collide on the code index. */
  companyCodeCollisions?: number;
}

function makeDb(options: DbOptions = {}) {
  const ops: Op[] = [];
  let companyInserts = 0;

  const failureFor = (table: string, kind: Op["kind"]): Failure =>
    options.fail?.[`${table}:${kind}`] ?? null;

  const builder = (table: string) => ({
    insert(payload: Record<string, unknown>) {
      ops.push({ table, kind: "insert", payload });
      if (table === "companies") {
        companyInserts += 1;
        if (companyInserts <= (options.companyCodeCollisions ?? 0)) {
          return {
            select: () => ({
              single: async () => ({
                data: null,
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "idx_companies_company_code"',
                  details: null,
                },
              }),
            }),
          };
        }
      }
      const failure = failureFor(table, "insert");
      return {
        select: () => ({
          single: async () => ({
            data: failure ? null : { id: COMPANY_ID },
            error: failure,
          }),
        }),
      };
    },
    upsert(payload: Record<string, unknown>) {
      ops.push({ table, kind: "upsert", payload });
      return Promise.resolve({ data: null, error: failureFor(table, "upsert") });
    },
    update(payload: Record<string, unknown>) {
      ops.push({ table, kind: "update", payload });
      return {
        eq: async () => ({ data: null, error: failureFor(table, "update") }),
      };
    },
  });

  return {
    ops,
    client: {
      from: (table: string) => builder(table),
      rpc: async () => ({ data: null, error: null }),
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

const companyStep = () =>
  request({
    token: "tok",
    step: "company",
    data: { companyName: "Brittlewood Appliances" },
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
  it("writes the Owner role row, owner labels, and a company code", async () => {
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());
    expect(res.status).toBe(200);

    const companyInsert = db.ops.find((o) => o.table === "companies" && o.kind === "insert");
    expect(companyInsert).toBeDefined();
    const code = companyInsert!.payload.company_code as string;
    expect(code).toHaveLength(COMPANY_CODE_LENGTH);
    expect([...code].every((ch) => COMPANY_CODE_ALPHABET.includes(ch))).toBe(true);

    const roleWrite = db.ops.find((o) => o.table === "user_roles");
    expect(roleWrite).toBeDefined();
    expect(roleWrite!.payload).toMatchObject({
      user_id: USER_ID,
      role_id: PRESET_ROLE_IDS.OWNER,
    });

    const link = db.ops.find(
      (o) => o.table === "users" && o.kind === "update" && "company_id" in o.payload
    );
    expect(link!.payload).toMatchObject({
      company_id: COMPANY_ID,
      is_company_admin: true,
      role: "owner",
      user_type: "company",
    });
  });

  it("writes the role row BEFORE the user becomes an admin", async () => {
    const db = makeDb();
    getServiceRoleClientMock.mockReturnValue(db.client);

    await POST(companyStep());

    const roleIdx = db.ops.findIndex((o) => o.table === "user_roles");
    const adminIdx = db.ops.findIndex(
      (o) => o.table === "users" && o.kind === "update" && o.payload.is_company_admin === true
    );

    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(adminIdx).toBeGreaterThanOrEqual(0);
    // guard_user_roles_final_state() raises target_is_admin if this order flips.
    expect(roleIdx).toBeLessThan(adminIdx);
  });

  it("fails the request when the role write fails", async () => {
    const db = makeDb({
      fail: { "user_roles:upsert": { message: "target_is_admin", code: "42501" } },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("target_is_admin"),
    });

    // The user must NOT be linked to a company it has no role in.
    const link = db.ops.find(
      (o) => o.table === "users" && o.kind === "update" && "company_id" in o.payload
    );
    expect(link).toBeUndefined();
  });

  it("retries with a fresh code when the company code collides", async () => {
    const db = makeDb({ companyCodeCollisions: 2 });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());
    expect(res.status).toBe(200);

    const inserts = db.ops.filter((o) => o.table === "companies" && o.kind === "insert");
    expect(inserts).toHaveLength(3);
    const codes = inserts.map((o) => o.payload.company_code as string);
    expect(new Set(codes).size).toBe(3);
  });

  it("does not retry a non-collision insert failure", async () => {
    const db = makeDb({
      fail: {
        "companies:insert": { message: "null value in column violates not-null", code: "23502" },
      },
    });
    getServiceRoleClientMock.mockReturnValue(db.client);

    const res = await POST(companyStep());
    expect(res.status).toBe(500);
    expect(db.ops.filter((o) => o.table === "companies" && o.kind === "insert")).toHaveLength(1);
    expect(db.ops.find((o) => o.table === "user_roles")).toBeUndefined();
  });
});
