/**
 * POST /api/customer/booking/contact — the details, and the code that will
 * prove one channel of them (design §6, I1, I5, I8).
 *
 * The response is the same shape for a live hold, a dead one and a send the
 * limits refused, so nothing about anyone's booking is observable from here.
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

import { encodeIntentRef } from "@/lib/customer-identity/booking-refs";
import { decodeChallengeRef } from "@/app/api/customer/_lib/broker-request";
import { POST } from "@/app/api/customer/booking/contact/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const OTHER_COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const EMAIL = "jordan@example.com";
const IP = "203.0.113.7";
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function contact(body: unknown, init: { ip?: string } = {}): Promise<NextResponse> {
  return POST(
    new NextRequest("http://localhost/api/customer/booking/contact", {
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

function heldIntentRef(): string {
  const intent = fake.seedIntent({
    companyId: COMPANY_ID,
    slotStartAt: SLOT.toISOString(),
    state: "held",
  });
  return encodeIntentRef(intent.intentId, COMPANY_ID, FAKE_KEY_RING);
}

const DETAILS = { name: "Jordan Reese", email: EMAIL, phone: "+1 403 555 0134" };

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  fake.setBookingPolicy(COMPANY_ID, { mode: "instant", visit_duration_minutes: 90 });
  fake.setAvailability(COMPANY_ID, [SLOT]);
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/booking/contact — success", () => {
  it("sends one code and answers an opaque challenge ref bound to the email", async () => {
    const intentRef = heldIntentRef();
    const res = await contact({ handle: HANDLE, intentRef, ...DETAILS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(body.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(fake.otpSends).toEqual([EMAIL]);
    expect(decodeChallengeRef(body.challengeId, EMAIL, FAKE_KEY_RING).ok).toBe(true);
    expect(
      decodeChallengeRef(body.challengeId, "someone.else@example.com", FAKE_KEY_RING).ok
    ).toBe(false);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("stores the phone as evidence and never verifies or matches it (I1)", async () => {
    const intentRef = heldIntentRef();
    await contact({ handle: HANDLE, intentRef, ...DETAILS });
    const [intent] = [...fake.intents.values()];
    expect(intent.contactPhone).toBe("+1 403 555 0134");
    expect(fake.otpSends).toEqual([EMAIL]);
    expect(intent.verifiedChannel).toBeNull();
    // The row keeps a digest and broker ciphertext, never the address itself.
    expect(intent.contactEmailEncrypted).not.toContain("@");
    expect(
      JSON.stringify(fake.callsTo("record_guest_booking_contact_as_system"))
    ).not.toContain("@");
  });

  it("carries the website's own answers through, bounded", async () => {
    const intentRef = heldIntentRef();
    await contact({
      handle: HANDLE,
      intentRef,
      ...DETAILS,
      answers: [{ question: "Gate code", answer: "west side" }],
    });
    const [intent] = [...fake.intents.values()];
    expect(intent.answers).toEqual([{ question: "Gate code", answer: "west side" }]);
  });

  it("returns no uuid and creates no identity or session", async () => {
    const intentRef = heldIntentRef();
    const res = await contact({ handle: HANDLE, intentRef, ...DETAILS });
    expect(await res.text()).not.toMatch(UUID);
    expect(fake.identities.size).toBe(0);
    expect(fake.sessions.size).toBe(0);
  });
});

describe("POST /api/customer/booking/contact — enumeration safety (I5)", () => {
  it("answers a dead hold exactly like a live one, and sends nothing", async () => {
    const expired = fake.seedIntent({
      companyId: COMPANY_ID,
      state: "held",
      holdExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await contact({
      handle: HANDLE,
      intentRef: encodeIntentRef(expired.intentId, COMPANY_ID, FAKE_KEY_RING),
      ...DETAILS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(body.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers a hold that never existed exactly the same way", async () => {
    const res = await contact({
      handle: HANDLE,
      intentRef: encodeIntentRef(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        COMPANY_ID,
        FAKE_KEY_RING
      ),
      ...DETAILS,
    });
    expect(res.status).toBe(200);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers a refused send the same way, with a retry hint", async () => {
    const intentRef = heldIntentRef();
    fake.refuseSends = true;
    const res = await contact({ handle: HANDLE, intentRef, ...DETAILS });
    expect(res.status).toBe(200);
    expect((await res.json()).retryAfterSeconds).toBe(60);
    expect(fake.otpSends).toEqual([]);
  });
});

describe("POST /api/customer/booking/contact — refusals", () => {
  it("refuses an intent ref that was not minted for this company", async () => {
    const foreign = encodeIntentRef(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      OTHER_COMPANY_ID,
      FAKE_KEY_RING
    );
    const res = await contact({ handle: HANDLE, intentRef: foreign, ...DETAILS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(fake.otpSends).toEqual([]);
  });

  it("refuses a malformed body, ref, name, email, phone or answers", async () => {
    const intentRef = heldIntentRef();
    for (const body of [
      "not json",
      { handle: HANDLE, ...DETAILS },
      { handle: HANDLE, intentRef: "in_short", ...DETAILS },
      { handle: HANDLE, intentRef, email: EMAIL },
      { handle: HANDLE, intentRef, name: "   ", email: EMAIL },
      { handle: HANDLE, intentRef, name: "Jordan", email: "not-an-address" },
      { handle: HANDLE, intentRef, ...DETAILS, phone: "1".repeat(41) },
      { handle: HANDLE, intentRef, ...DETAILS, answers: [{ nested: { deep: 1 } }] },
      { handle: HANDLE, intentRef, ...DETAILS, answers: { gate: "code" } },
      { handle: HANDLE, intentRef, ...DETAILS, answers: ["a"] },
    ]) {
      const res = await contact(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(fake.otpSends).toEqual([]);
  });

  it("is not found for an unknown handle", async () => {
    const res = await contact({
      handle: "nobody-here",
      intentRef: heldIntentRef(),
      ...DETAILS,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("refuses before sending anything when the per-IP limit is spent", async () => {
    const intentRef = heldIntentRef();
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 45 });
    const res = await contact({ handle: HANDLE, intentRef, ...DETAILS });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    expect(fake.otpSends).toEqual([]);
  });
});
