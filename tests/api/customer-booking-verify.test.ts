/**
 * POST /api/customer/booking/verify — the code, then the only thing that can
 * say a booking exists (design §6, D9, D11, I5, I12, I14).
 *
 * The instant/request branch is the product decision made visible: one answers
 * "confirmed", the other "submitted", and the customer is told the truth
 * either way. A slot lost while the code was typed refuses cleanly.
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

import { SESSION_COOKIE_NAME } from "@/lib/customer-identity";
import {
  decodeBookingRef,
  encodeIntentRef,
} from "@/lib/customer-identity/booking-refs";
import { encodeChallengeRef } from "@/app/api/customer/_lib/broker-request";
import { startBookingContact } from "@/lib/customer-identity/booking-broker";
import { POST } from "@/app/api/customer/booking/verify/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const EMAIL = "jordan@example.com";
const CODE = "482913";
const IP = "203.0.113.7";
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function verify(body: unknown, init: { ip?: string } = {}): Promise<NextResponse> {
  return POST(
    new NextRequest("http://localhost/api/customer/booking/verify", {
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

/** A live hold that has taken the contact step, with its code armed. */
async function armed(): Promise<{ intentRef: string; challengeId: string }> {
  const intent = fake.seedIntent({
    companyId: COMPANY_ID,
    slotStartAt: SLOT.toISOString(),
    state: "held",
  });
  const started = await startBookingContact(fake.deps(), {
    intentId: intent.intentId,
    companyId: COMPANY_ID,
    contact: { name: "Jordan Reese", email: EMAIL, phone: null, answers: {} },
    networkFingerprint: "f".repeat(64),
  });
  fake.codes.set(EMAIL, CODE);
  fake.otpSends.length = 0;
  return {
    intentRef: encodeIntentRef(intent.intentId, COMPANY_ID, FAKE_KEY_RING),
    challengeId: encodeChallengeRef(started.challengeId, EMAIL, FAKE_KEY_RING),
  };
}

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  fake.setBookingPolicy(COMPANY_ID, { mode: "instant", visit_duration_minutes: 90 });
  fake.setAvailability(COMPANY_ID, [SLOT]);
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/booking/verify — instant mode", () => {
  it("confirms and answers an opaque booking ref with the real window", async () => {
    const { intentRef, challengeId } = await armed();
    const res = await verify({ handle: HANDLE, intentRef, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      outcome: "confirmed",
      bookingRef: expect.stringMatching(/^bk_[A-Za-z0-9_-]{46}$/),
      scheduledAt: SLOT.toISOString(),
      durationMinutes: 90,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns no uuid, names no crew and sets no session cookie (I4, I11, D11)", async () => {
    const { intentRef, challengeId } = await armed();
    const res = await verify({ handle: HANDLE, intentRef, challengeId, code: CODE, email: EMAIL });
    const raw = await res.text();
    expect(raw).not.toMatch(UUID);
    expect(raw.toLowerCase()).not.toContain("assignee");
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    expect(fake.identities.size).toBe(0);
    expect(fake.sessions.size).toBe(0);
    expect(fake.appMetadataWrites).toEqual([]);
  });

  it("mints a booking ref that resolves only under this company", async () => {
    const { intentRef, challengeId } = await armed();
    const body = await (
      await verify({ handle: HANDLE, intentRef, challengeId, code: CODE, email: EMAIL })
    ).json();
    const [intentId] = [...fake.intents.keys()];
    expect(decodeBookingRef(body.bookingRef, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: true,
      intentId,
    });
    expect(
      decodeBookingRef(body.bookingRef, "11111111-2222-4333-8444-555555555555", FAKE_KEY_RING)
        .ok
    ).toBe(false);
  });
});

describe("POST /api/customer/booking/verify — request mode (I14)", () => {
  it("submits a request instead of booking, and says so", async () => {
    fake.setBookingPolicy(COMPANY_ID, { mode: "request", visit_duration_minutes: 90 });
    const { intentRef, challengeId } = await armed();
    const res = await verify({ handle: HANDLE, intentRef, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("submitted");
    const [intent] = [...fake.intents.values()];
    expect(intent.state).toBe("submitted");
  });
});

describe("POST /api/customer/booking/verify — refusals", () => {
  it("refuses a wrong code with the attempts that remain, and books nothing", async () => {
    const { intentRef, challengeId } = await armed();
    const res = await verify({
      handle: HANDLE,
      intentRef,
      challengeId,
      code: "000000",
      email: EMAIL,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code", attemptsRemaining: 4 });
    expect(fake.callsTo("confirm_guest_booking_as_system")).toEqual([]);
  });

  it("exhausts the challenge after five wrong codes", async () => {
    const { intentRef, challengeId } = await armed();
    const wrong = () =>
      verify({ handle: HANDLE, intentRef, challengeId, code: "000000", email: EMAIL });
    for (let index = 0; index < 5; index += 1) await wrong();
    const res = await wrong();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "challenge_exhausted" });
  });

  it("charges an attempt and answers like a wrong code when the email is not the one the challenge was begun for", async () => {
    const { intentRef, challengeId } = await armed();
    const res = await verify({
      handle: HANDLE,
      intentRef,
      challengeId,
      code: CODE,
      email: "someone.else@example.com",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code", attemptsRemaining: 4 });
    expect(fake.otpVerifies).toEqual([]);
  });

  it("surfaces the I12 refusal when the slot went while the code was typed", async () => {
    const { intentRef, challengeId } = await armed();
    fake.slotGoneOnConfirm = true;
    const res = await verify({ handle: HANDLE, intentRef, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "slot_no_longer_available" });
  });

  it("refuses a confirm whose intent belongs to another company", async () => {
    const { challengeId } = await armed();
    const foreign = encodeIntentRef(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      COMPANY_ID,
      FAKE_KEY_RING
    );
    const res = await verify({
      handle: HANDLE,
      intentRef: foreign,
      challengeId,
      code: CODE,
      email: EMAIL,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_confirmable" });
  });

  it("refuses a malformed body, ref, challenge, code or email", async () => {
    const { intentRef, challengeId } = await armed();
    for (const body of [
      "not json",
      { handle: HANDLE, challengeId, code: CODE, email: EMAIL },
      { handle: HANDLE, intentRef, code: CODE, email: EMAIL },
      { handle: HANDLE, intentRef, challengeId: "ch_short", code: CODE, email: EMAIL },
      { handle: HANDLE, intentRef, challengeId, code: "12345", email: EMAIL },
      { handle: HANDLE, intentRef, challengeId, code: CODE, email: "nope" },
    ]) {
      const res = await verify(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("is not found for an unknown handle", async () => {
    const { intentRef, challengeId } = await armed();
    const res = await verify({
      handle: "nobody-here",
      intentRef,
      challengeId,
      code: CODE,
      email: EMAIL,
    });
    expect(res.status).toBe(404);
  });

  it("refuses before proxying anything when the per-IP limit is spent", async () => {
    const { intentRef, challengeId } = await armed();
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 20 });
    const res = await verify({ handle: HANDLE, intentRef, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(429);
    expect(fake.otpVerifies).toEqual([]);
  });
});
