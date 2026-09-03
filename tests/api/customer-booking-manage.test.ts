/**
 * POST /api/customer/booking/manage/{start,verify} — changing a booking costs
 * a fresh code, every time (design §6, I5, I11, I12, I15).
 *
 * No long-lived management capability exists: the ref in a confirmation email
 * is not authority, it is only an address. Whether a booking exists at that
 * address is not observable from the start step.
 */

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIdentityFake, FAKE_KEY_RING } from "../utils/customer-identity-fake";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  getDeps: vi.fn(),
}));

let fake: CustomerIdentityFake;

vi.mock("@/lib/utils/ratelimit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => fake.serviceRoleClient(),
}));
vi.mock("@/lib/customer-identity/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customer-identity/config")>()),
  getCustomerIdentityDeps: () => mocks.getDeps(),
}));

import {
  encodeBookingRef,
  encodeSlotDescriptor,
} from "@/lib/customer-identity/booking-refs";
import { emailDigest } from "@/lib/customer-identity";
import { POST as START } from "@/app/api/customer/booking/manage/start/route";
import { POST as VERIFY } from "@/app/api/customer/booking/manage/verify/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const OTHER_COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const EMAIL = "jordan@example.com";
const CODE = "482913";
const IP = "203.0.113.7";
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const OTHER_SLOT = new Date("2026-09-15T17:00:00.000Z");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function post(
  handler: (request: NextRequest) => Promise<NextResponse>,
  path: string,
  body: unknown,
  init: { ip?: string } = {}
): Promise<NextResponse> {
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": init.ip ?? IP,
        "user-agent": "Safari/17",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

const start = (body: unknown, init?: { ip?: string }) =>
  post(START, "/api/customer/booking/manage/start", body, init);
const verify = (body: unknown, init?: { ip?: string }) =>
  post(VERIFY, "/api/customer/booking/manage/verify", body, init);

/** A confirmed booking whose contact email is the one we will present. */
function confirmedBooking(): string {
  const intent = fake.seedIntent({
    companyId: COMPANY_ID,
    slotStartAt: SLOT.toISOString(),
    state: "confirmed",
    contactEmail: EMAIL,
    emailDigest: emailDigest(EMAIL, FAKE_KEY_RING),
  });
  return encodeBookingRef(intent.intentId, COMPANY_ID, FAKE_KEY_RING);
}

/** Take the start step and arm the code, returning the challenge ref. */
async function armedManage(bookingRef: string): Promise<string> {
  const res = await start({ handle: HANDLE, bookingRef, email: EMAIL });
  const body = await res.json();
  fake.codes.set(EMAIL, CODE);
  return body.challengeId;
}

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  fake.setBookingPolicy(COMPANY_ID, { mode: "instant", visit_duration_minutes: 90 });
  fake.setAvailability(COMPANY_ID, [OTHER_SLOT]);
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/booking/manage/start", () => {
  it("sends a fresh code and answers a challenge ref bound to the email", async () => {
    const bookingRef = confirmedBooking();
    const res = await start({ handle: HANDLE, bookingRef, email: EMAIL });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(body.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(fake.otpSends).toEqual([EMAIL]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers a booking that does not exist identically, and sends nothing (I5)", async () => {
    const res = await start({
      handle: HANDLE,
      bookingRef: encodeBookingRef(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        COMPANY_ID,
        FAKE_KEY_RING
      ),
      email: EMAIL,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers a booking held under a different email identically", async () => {
    const bookingRef = confirmedBooking();
    const res = await start({
      handle: HANDLE,
      bookingRef,
      email: "someone.else@example.com",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(fake.otpSends).toEqual([]);
  });

  it("refuses a ref minted for another company, a malformed ref and a bad email", async () => {
    for (const body of [
      {
        handle: HANDLE,
        bookingRef: encodeBookingRef(
          "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          OTHER_COMPANY_ID,
          FAKE_KEY_RING
        ),
        email: EMAIL,
      },
      { handle: HANDLE, bookingRef: "bk_short", email: EMAIL },
      { handle: HANDLE, bookingRef: confirmedBooking(), email: "nope" },
      { handle: HANDLE, email: EMAIL },
    ]) {
      const res = await start(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(fake.otpSends).toEqual([]);
  });

  it("is not found for an unknown handle and rate limits per address", async () => {
    const bookingRef = confirmedBooking();
    expect((await start({ handle: "nobody-here", bookingRef, email: EMAIL })).status).toBe(
      404
    );
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 60 });
    const limited = await start({ handle: HANDLE, bookingRef, email: EMAIL });
    expect(limited.status).toBe(429);
    expect(fake.otpSends).toEqual([]);
  });
});

describe("POST /api/customer/booking/manage/verify", () => {
  it("reschedules onto a slot that is still offered", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const res = await verify({
      handle: HANDLE,
      bookingRef,
      challengeId,
      code: CODE,
      email: EMAIL,
      action: "reschedule",
      slot: encodeSlotDescriptor(COMPANY_ID, OTHER_SLOT, FAKE_KEY_RING),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      outcome: "rescheduled",
      scheduledAt: OTHER_SLOT.toISOString(),
    });
  });

  it("cancels", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const res = await verify({
      handle: HANDLE,
      bookingRef,
      challengeId,
      code: CODE,
      email: EMAIL,
      action: "cancel",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "cancelled" });
    const [intent] = [...fake.intents.values()];
    expect(intent.state).toBe("cancelled");
  });

  it("returns no uuid and never names a crew member", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const res = await verify({
      handle: HANDLE,
      bookingRef,
      challengeId,
      code: CODE,
      email: EMAIL,
      action: "cancel",
    });
    const raw = await res.text();
    expect(raw).not.toMatch(UUID);
    expect(raw.toLowerCase()).not.toContain("assignee");
  });

  it("re-runs slot validation and refuses a stale reschedule (I12)", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const res = await verify({
      handle: HANDLE,
      bookingRef,
      challengeId,
      code: CODE,
      email: EMAIL,
      action: "reschedule",
      slot: encodeSlotDescriptor(
        COMPANY_ID,
        new Date("2026-09-30T16:00:00.000Z"),
        FAKE_KEY_RING
      ),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "slot_no_longer_available" });
  });

  it("refuses a wrong code before touching the booking", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const res = await verify({
      handle: HANDLE,
      bookingRef,
      challengeId,
      code: "000000",
      email: EMAIL,
      action: "cancel",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code", attemptsRemaining: 4 });
    expect(fake.callsTo("cancel_guest_booking_as_system")).toEqual([]);
    const [intent] = [...fake.intents.values()];
    expect(intent.state).toBe("confirmed");
  });

  it("refuses a code proved for one email replayed under another", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const res = await verify({
      handle: HANDLE,
      bookingRef,
      challengeId,
      code: CODE,
      email: "someone.else@example.com",
      action: "cancel",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code", attemptsRemaining: 4 });
    expect(fake.otpVerifies).toEqual([]);
  });

  it("refuses a malformed action, a missing slot and a malformed slot", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    for (const body of [
      { handle: HANDLE, bookingRef, challengeId, code: CODE, email: EMAIL },
      { handle: HANDLE, bookingRef, challengeId, code: CODE, email: EMAIL, action: "delete" },
      {
        handle: HANDLE,
        bookingRef,
        challengeId,
        code: CODE,
        email: EMAIL,
        action: "reschedule",
      },
      {
        handle: HANDLE,
        bookingRef,
        challengeId,
        code: CODE,
        email: EMAIL,
        action: "reschedule",
        slot: "sl_short",
      },
    ]) {
      const res = await verify(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(fake.callsTo("reschedule_guest_booking_as_system")).toEqual([]);
  });

  it("refuses an expired slot proposal on reschedule as a gone slot, not a bad request", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
      const stale = encodeSlotDescriptor(COMPANY_ID, OTHER_SLOT, FAKE_KEY_RING);
      const bookingRef = confirmedBooking();
      const challengeId = await armedManage(bookingRef);
      vi.setSystemTime(new Date("2026-09-10T12:11:00.000Z"));
      const res = await verify({
        handle: HANDLE,
        bookingRef,
        challengeId,
        code: CODE,
        email: EMAIL,
        action: "reschedule",
        slot: stale,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "slot_no_longer_available" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not found for an unknown handle and rate limits per address", async () => {
    const bookingRef = confirmedBooking();
    const challengeId = await armedManage(bookingRef);
    const body = {
      bookingRef,
      challengeId,
      code: CODE,
      email: EMAIL,
      action: "cancel" as const,
    };
    expect((await verify({ ...body, handle: "nobody-here" })).status).toBe(404);
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 15 });
    const limited = await verify({ ...body, handle: HANDLE });
    expect(limited.status).toBe(429);
    expect(fake.otpVerifies).toEqual([]);
  });
});
