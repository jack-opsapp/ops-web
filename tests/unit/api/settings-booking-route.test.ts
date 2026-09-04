/**
 * Staff booking-policy routes (PUBLIC API P2-4, design §4.1 and §8).
 *
 *   GET /api/settings/booking  — the company's policy + whether its website
 *                                is wired to OPS at all
 *   PUT /api/settings/booking  — store it
 *
 * Both: Firebase staff auth → active `users` row → `settings.company` (never a
 * role name). The company is taken from the authenticated user and never from
 * the request, so no caller can name another tenant. Before the P2-1 migration
 * lands the store cannot answer, and both routes say so rather than pretending
 * the company has no policy.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, findUserMock, checkPermMock, tableMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  findUserMock: vi.fn(),
  checkPermMock: vi.fn(),
  tableMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: checkPermMock }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: (table: string) => tableMock(table) }),
}));

import { GET, PUT } from "@/app/api/settings/booking/route";

const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const TZ = "America/Vancouver";

const STORED_ROW = {
  company_id: COMPANY_ID,
  mode: "request",
  windows: [{ weekday: 1, start: "08:00", end: "16:00" }],
  timezone: TZ,
  min_notice_hours: 24,
  horizon_days: 30,
  visit_duration_minutes: 90,
  max_bookings_per_day: 2,
  default_owner_id: OWNER_ID,
};

const VALID_POLICY = {
  mode: "instant",
  windows: [{ weekday: 2, start: "07:00", end: "15:00" }],
  timezone: TZ,
  minNoticeHours: 12,
  horizonDays: 14,
  visitDurationMinutes: 60,
  maxBookingsPerDay: null,
  defaultOwnerId: OWNER_ID,
};

/** What the fake service-role client should answer for each table. */
interface StoreState {
  company: { data: unknown; error: unknown };
  policyRead: { data: unknown; error: unknown };
  policyWrite: { data: unknown; error: unknown };
}

let store: StoreState;
let upserted: unknown;

function wireStore() {
  upserted = undefined;
  tableMock.mockImplementation((table: string) => {
    if (table === "companies") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => store.company }) }),
      };
    }
    if (table === "site_visit_booking_policies") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => store.policyRead }) }),
        upsert: (row: unknown) => {
          upserted = row;
          return { select: () => ({ maybeSingle: async () => store.policyWrite }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function get() {
  return GET({ headers: new Headers() } as never);
}

function put(body: unknown) {
  return PUT({ headers: new Headers(), json: async () => body } as never);
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ uid: "fb-1", email: "staff@example.com" });
  findUserMock
    .mockReset()
    .mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID, is_active: true });
  checkPermMock.mockReset().mockResolvedValue(true);
  store = {
    company: { data: { timezone: TZ, public_handle: "maverick-projects" }, error: null },
    policyRead: { data: STORED_ROW, error: null },
    policyWrite: { data: { ...STORED_ROW, mode: "instant" }, error: null },
  };
  wireStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/settings/booking", () => {
  it("answers the stored policy in the screen's shape", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      available: true,
      publicIntegration: true,
      policy: {
        mode: "request",
        windows: [{ weekday: 1, start: "08:00", end: "16:00" }],
        timezone: TZ,
        minNoticeHours: 24,
        horizonDays: 30,
        visitDurationMinutes: 90,
        maxBookingsPerDay: 2,
        defaultOwnerId: OWNER_ID,
      },
    });
  });

  it("answers booking off, on the company clock, when no policy row exists", async () => {
    store.policyRead = { data: null, error: null };
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.policy.mode).toBe("off");
    expect(body.policy.timezone).toBe(TZ);
    expect(body.policy.windows).toEqual([]);
  });

  it("reports no public integration when the company has no hosted handle", async () => {
    // Design §8: the section is hidden entirely for a company whose website
    // is not connected — the answer the settings shell gates the section on.
    store.company = { data: { timezone: TZ, public_handle: null }, error: null };
    const response = await get();
    await expect(response.json()).resolves.toMatchObject({ publicIntegration: false });
  });

  it("says the settings are unavailable when the policy store cannot answer", async () => {
    store.policyRead = { data: null, error: { code: "42P01", message: "missing table" } };
    const response = await get();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "booking_settings_unavailable",
    });
  });

  it("refuses an unauthenticated caller", async () => {
    verifyAuthMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("refuses a deactivated staff member", async () => {
    findUserMock.mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID, is_active: false });
    expect((await get()).status).toBe(403);
  });

  it("refuses an operator without settings.company", async () => {
    checkPermMock.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith(USER_ID, "settings.company");
  });
});

describe("PUT /api/settings/booking", () => {
  it("stores the policy for the caller's own company", async () => {
    const response = await put({ policy: VALID_POLICY });
    expect(response.status).toBe(200);
    expect(upserted).toEqual({
      company_id: COMPANY_ID,
      mode: "instant",
      windows: [{ weekday: 2, start: "07:00", end: "15:00" }],
      timezone: TZ,
      min_notice_hours: 12,
      horizon_days: 14,
      visit_duration_minutes: 60,
      max_bookings_per_day: null,
      default_owner_id: OWNER_ID,
    });
  });

  it("takes the company from the session, never from the request body", async () => {
    await put({ policy: VALID_POLICY, companyId: "99999999-9999-4999-8999-999999999999" });
    expect(upserted).toMatchObject({ company_id: COMPANY_ID });
  });

  it("answers the stored row so the screen never keeps a local guess", async () => {
    const response = await put({ policy: VALID_POLICY });
    await expect(response.json()).resolves.toMatchObject({ policy: { mode: "instant" } });
  });

  it("refuses a policy the table would reject, naming the reason", async () => {
    const response = await put({
      policy: { ...VALID_POLICY, windows: [{ weekday: 2, start: "16:00", end: "07:00" }] },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "window_end_before_start" });
    expect(upserted).toBeUndefined();
  });

  it("refuses a body that is not a policy at all", async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ policy: { mode: "sometimes" } })).status).toBe(400);
    expect(upserted).toBeUndefined();
  });

  it("refuses an owner id that is not a uuid", async () => {
    const response = await put({ policy: { ...VALID_POLICY, defaultOwnerId: "steve" } });
    expect(response.status).toBe(400);
    expect(upserted).toBeUndefined();
  });

  it("says the settings are unavailable when the write cannot land", async () => {
    store.policyWrite = { data: null, error: { code: "42P01", message: "missing table" } };
    const response = await put({ policy: VALID_POLICY });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "booking_settings_unavailable",
    });
  });

  it("refuses an operator without settings.company before touching the store", async () => {
    checkPermMock.mockResolvedValue(false);
    expect((await put({ policy: VALID_POLICY })).status).toBe(403);
    expect(upserted).toBeUndefined();
  });

  it("refuses an unauthenticated caller before touching the store", async () => {
    verifyAuthMock.mockResolvedValue(null);
    expect((await put({ policy: VALID_POLICY })).status).toBe(401);
    expect(upserted).toBeUndefined();
  });
});
