/**
 * Booking-request routes on the lead (PUBLIC API P2-4, design §8, I14, I16).
 *
 *   GET  /api/opportunities/[id]/booking-request
 *   POST /api/opportunities/[id]/booking-request/accept
 *   POST /api/opportunities/[id]/booking-request/decline
 *
 * A `request`-mode submission is a proposal: nothing is on any calendar until
 * a staff member accepts (I14). Every route: Firebase staff auth → active
 * `users` row → `pipeline.edit` (granular, never a role name) → the lead must
 * belong to the caller's company → the system RPC, which re-checks the
 * operator's authority on that specific lead. The request id in the body must
 * be the one this lead is actually waiting on, so no route can decide another
 * lead's request.
 *
 * The RPCs land with the P2-1 migration; here they are mocked at the
 * service-role boundary against the contract this task binds to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAuthMock, findUserMock, checkPermMock, rpcMock, oppLookupMock } = vi.hoisted(
  () => ({
    verifyAuthMock: vi.fn(),
    findUserMock: vi.fn(),
    checkPermMock: vi.fn(),
    rpcMock: vi.fn(),
    oppLookupMock: vi.fn(),
  })
);

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: checkPermMock }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: rpcMock,
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column1: string, value1: string) => ({
          eq: (column2: string, value2: string) => ({
            maybeSingle: () =>
              oppLookupMock({ table, columns, column1, value1, column2, value2 }),
          }),
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/opportunities/[id]/booking-request/route";
import { POST as ACCEPT } from "@/app/api/opportunities/[id]/booking-request/accept/route";
import { POST as DECLINE } from "@/app/api/opportunities/[id]/booking-request/decline/route";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_REQUEST = "55555555-5555-4555-8555-555555555555";
const VISIT_ID = "66666666-6666-4666-8666-666666666666";

const SLOT = "2026-10-09T17:00:00.000Z";
const MOVED = "2026-10-09T18:00:00.000Z";
const REQUESTED_AT = "2026-10-02T14:12:00.000Z";

const PENDING_ROW = {
  request_id: REQUEST_ID,
  slot_start_at: SLOT,
  duration_minutes: 60,
  contact_name: "Dana Whitlock",
  // `answers` is stored as an array of flat objects (P2-1 migration,
  // `private.booking_answers_valid`): at most 100 entries, every value a
  // scalar or null.
  answers: [
    { question: "What needs doing", answer: "Back deck rebuild" },
    { question: "Storeys", answer: 2 },
    { question: "Notes", answer: null },
  ],
  requested_at: REQUESTED_AT,
};

const READ_RPC = "read_booking_request_for_opportunity_as_system";
const ACCEPT_RPC = "confirm_booking_request_as_system";
const DECLINE_RPC = "decline_booking_request_as_system";

function request(body: unknown = {}) {
  return { headers: new Headers(), json: async () => body } as never;
}

const routeParams = { params: Promise.resolve({ id: OPPORTUNITY_ID }) };

function calls(name: string) {
  return rpcMock.mock.calls.filter(([fn]) => fn === name);
}

function failRpc(name: string, code: string, message = "refused") {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === READ_RPC && name !== READ_RPC) return { data: [PENDING_ROW], error: null };
    if (fn === name) return { data: null, error: { code, message } };
    return { data: null, error: { code: "42883", message: `unknown rpc ${fn}` } };
  });
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ uid: "fb-1", email: "staff@example.com" });
  findUserMock
    .mockReset()
    .mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID, is_active: true });
  checkPermMock.mockReset().mockResolvedValue(true);
  oppLookupMock.mockReset().mockResolvedValue({ data: { id: OPPORTUNITY_ID }, error: null });
  rpcMock.mockReset().mockImplementation(async (fn: string) => {
    if (fn === READ_RPC) return { data: [PENDING_ROW], error: null };
    if (fn === ACCEPT_RPC) {
      return {
        data: [{ intent_id: REQUEST_ID, site_visit_id: VISIT_ID, scheduled_at: SLOT }],
        error: null,
      };
    }
    if (fn === DECLINE_RPC) {
      return { data: [{ intent_id: REQUEST_ID, opportunity_id: OPPORTUNITY_ID }], error: null };
    }
    return { data: null, error: { code: "42883", message: `unknown rpc ${fn}` } };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/opportunities/[id]/booking-request", () => {
  it("answers the pending request the lead is waiting on", async () => {
    const response = await GET(request(), routeParams);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: {
        requestId: REQUEST_ID,
        slotStartAt: SLOT,
        durationMinutes: 60,
        contactName: "Dana Whitlock",
        requestedAt: REQUESTED_AT,
        answers: [
          { label: "What needs doing", value: "Back deck rebuild" },
          { label: "Storeys", value: "2" },
        ],
      },
    });
  });

  it("scopes the read to the caller's own company and identity", async () => {
    await GET(request(), routeParams);
    expect(calls(READ_RPC)[0][1]).toEqual({
      p_company_id: COMPANY_ID,
      p_opportunity_id: OPPORTUNITY_ID,
      p_actor_user_id: USER_ID,
    });
  });

  it("answers null when the lead has no pending request", async () => {
    rpcMock.mockImplementation(async () => ({ data: [], error: null }));
    const response = await GET(request(), routeParams);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ request: null });
  });

  it("says the store is unavailable before the migration lands", async () => {
    failRpc(READ_RPC, "42883", "function does not exist");
    const response = await GET(request(), routeParams);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "booking_request_unavailable" });
  });

  it("refuses a lead from another company as not found", async () => {
    oppLookupMock.mockResolvedValue({ data: null, error: null });
    expect((await GET(request(), routeParams)).status).toBe(404);
    expect(calls(READ_RPC)).toHaveLength(0);
  });

  it("refuses an operator without pipeline.edit", async () => {
    checkPermMock.mockResolvedValue(false);
    expect((await GET(request(), routeParams)).status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith(USER_ID, "pipeline.edit");
  });

  it("refuses an unauthenticated caller", async () => {
    verifyAuthMock.mockResolvedValue(null);
    expect((await GET(request(), routeParams)).status).toBe(401);
  });

  it("refuses a deactivated staff member", async () => {
    findUserMock.mockResolvedValue({ id: USER_ID, company_id: COMPANY_ID, is_active: false });
    expect((await GET(request(), routeParams)).status).toBe(403);
  });
});

describe("POST …/booking-request/accept", () => {
  it("books the requested time when staff accept it as asked", async () => {
    const response = await ACCEPT(request({ requestId: REQUEST_ID }), routeParams);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ scheduledAt: SLOT });
    expect(calls(ACCEPT_RPC)[0][1]).toEqual({
      p_intent_id: REQUEST_ID,
      p_staff_user_id: USER_ID,
      p_scheduled_at: null,
    });
  });

  it("books the staff-chosen time when they move it", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === READ_RPC) return { data: [PENDING_ROW], error: null };
      if (fn === ACCEPT_RPC) {
        return {
          data: [{ intent_id: REQUEST_ID, site_visit_id: VISIT_ID, scheduled_at: MOVED }],
          error: null,
        };
      }
      return { data: null, error: { code: "42883", message: `unknown rpc ${fn}` } };
    });
    const response = await ACCEPT(
      request({ requestId: REQUEST_ID, scheduledAt: MOVED }),
      routeParams
    );
    await expect(response.json()).resolves.toEqual({ scheduledAt: MOVED });
    expect(calls(ACCEPT_RPC)[0][1]).toMatchObject({ p_scheduled_at: MOVED });
  });

  it("refuses a request id this lead is not waiting on", async () => {
    // Binding the id to the lead in the same URL keeps one route from
    // deciding another lead's request.
    const response = await ACCEPT(request({ requestId: OTHER_REQUEST }), routeParams);
    expect(response.status).toBe(404);
    expect(calls(ACCEPT_RPC)).toHaveLength(0);
  });

  it("refuses a body without a request id", async () => {
    expect((await ACCEPT(request({}), routeParams)).status).toBe(400);
    expect((await ACCEPT(request({ requestId: "nope" }), routeParams)).status).toBe(400);
    expect(calls(ACCEPT_RPC)).toHaveLength(0);
  });

  it("refuses a moved time that is not a timestamp", async () => {
    const response = await ACCEPT(
      request({ requestId: REQUEST_ID, scheduledAt: "next tuesday" }),
      routeParams
    );
    expect(response.status).toBe(400);
    expect(calls(ACCEPT_RPC)).toHaveLength(0);
  });

  it("reports a slot the policy no longer allows as a conflict", async () => {
    failRpc(ACCEPT_RPC, "22023", "slot_no_longer_available");
    expect((await ACCEPT(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(409);
  });

  it("reports a request another operator already decided as a conflict", async () => {
    // `booking_request_not_pending` — the RPC's own code for a request that
    // has moved on since this screen read it.
    failRpc(ACCEPT_RPC, "55000", "booking_request_not_pending");
    expect((await ACCEPT(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(409);
  });

  it("reports a request the store no longer knows as not found", async () => {
    failRpc(ACCEPT_RPC, "P0002", "gone");
    expect((await ACCEPT(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(404);
  });

  it("reports the RPC's own authority refusal as forbidden", async () => {
    // `pipeline.edit` can be scoped to assigned leads; the RPC is the
    // authority on this lead and its refusal is answered as the gate's own.
    failRpc(ACCEPT_RPC, "42501", "access_denied");
    expect((await ACCEPT(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(403);
  });

  it("refuses an operator without pipeline.edit before touching the store", async () => {
    checkPermMock.mockResolvedValue(false);
    expect((await ACCEPT(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(403);
    expect(calls(ACCEPT_RPC)).toHaveLength(0);
  });
});

describe("POST …/booking-request/decline", () => {
  it("declines the request the lead is waiting on", async () => {
    const response = await DECLINE(request({ requestId: REQUEST_ID }), routeParams);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(calls(DECLINE_RPC)[0][1]).toEqual({
      p_intent_id: REQUEST_ID,
      p_staff_user_id: USER_ID,
      p_reason: "declined_by_staff",
    });
  });

  it("never books anything", async () => {
    await DECLINE(request({ requestId: REQUEST_ID }), routeParams);
    expect(calls(ACCEPT_RPC)).toHaveLength(0);
  });

  it("refuses a request id this lead is not waiting on", async () => {
    const response = await DECLINE(request({ requestId: OTHER_REQUEST }), routeParams);
    expect(response.status).toBe(404);
    expect(calls(DECLINE_RPC)).toHaveLength(0);
  });

  it("reports a request already decided as a conflict", async () => {
    failRpc(DECLINE_RPC, "55000", "booking_request_not_pending");
    expect((await DECLINE(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(409);
  });

  it("refuses an unauthenticated caller before touching the store", async () => {
    verifyAuthMock.mockResolvedValue(null);
    expect((await DECLINE(request({ requestId: REQUEST_ID }), routeParams)).status).toBe(401);
    expect(calls(DECLINE_RPC)).toHaveLength(0);
  });
});

describe("answers the website carried onto the lead", () => {
  function withAnswers(answers: unknown) {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === READ_RPC) return { data: [{ ...PENDING_ROW, answers }], error: null };
      return { data: null, error: { code: "42883", message: `unknown rpc ${fn}` } };
    });
    return GET(request(), routeParams).then((response) => response.json());
  }

  it("pairs a label field with its answer field", async () => {
    await expect(
      withAnswers([{ label: "Roof pitch", value: "6/12" }])
    ).resolves.toMatchObject({
      request: { answers: [{ label: "Roof pitch", value: "6/12" }] },
    });
  });

  it("reads a single-pair object entry as one row", async () => {
    await expect(withAnswers([{ "Roof pitch": "6/12" }])).resolves.toMatchObject({
      request: { answers: [{ label: "Roof pitch", value: "6/12" }] },
    });
  });

  it("shows booleans as words rather than raw json", async () => {
    await expect(
      withAnswers([{ question: "Dog on site", answer: true }])
    ).resolves.toMatchObject({
      request: { answers: [{ label: "Dog on site", value: "Yes" }] },
    });
  });

  it("drops an entry with nothing to say", async () => {
    await expect(
      withAnswers([{ question: "Notes", answer: null }, { question: "Gate code", answer: "" }])
    ).resolves.toMatchObject({ request: { answers: [] } });
  });

  it("survives an empty or malformed payload", async () => {
    await expect(withAnswers([])).resolves.toMatchObject({ request: { answers: [] } });
    await expect(withAnswers(null)).resolves.toMatchObject({ request: { answers: [] } });
    await expect(withAnswers("nonsense")).resolves.toMatchObject({
      request: { answers: [] },
    });
  });

  it("never shows more than the hundred entries the store accepts", async () => {
    const many = Array.from({ length: 140 }, (_, index) => ({
      question: `Q${index}`,
      answer: `A${index}`,
    }));
    const body = (await withAnswers(many)) as { request: { answers: unknown[] } };
    expect(body.request.answers).toHaveLength(100);
  });
});
