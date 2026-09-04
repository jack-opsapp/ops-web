/**
 * POST /api/customer/booking/hold — a signed proposal becomes a bounded hold
 * (design §6, I12, I13).
 *
 * The descriptor the page presents is a proposal and nothing more: this route
 * exists to prove that the database, not the signature, decides whether a time
 * is still free.
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
  decodeIntentRef,
  encodeSlotDescriptor,
} from "@/lib/customer-identity/booking-refs";
import { POST } from "@/app/api/customer/booking/hold/route";

const HANDLE = "maverick-projects";
const OTHER_HANDLE = "northside-electric";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const OTHER_COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const IP = "203.0.113.7";
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const OTHER_SLOT = new Date("2026-09-15T17:00:00.000Z");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function hold(body: unknown, init: { ip?: string } = {}): Promise<NextResponse> {
  return POST(
    new NextRequest("http://localhost/api/customer/booking/hold", {
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

const SLOT_REF = () => encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  fake.addCompany(OTHER_HANDLE, { id: OTHER_COMPANY_ID, deleted_at: null });
  fake.setBookingPolicy(COMPANY_ID, { mode: "instant", visit_duration_minutes: 90 });
  fake.setBookingPolicy(OTHER_COMPANY_ID, { mode: "instant" });
  fake.setAvailability(COMPANY_ID, [SLOT, OTHER_SLOT]);
  fake.setAvailability(OTHER_COMPANY_ID, [SLOT]);
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/booking/hold — success", () => {
  it("answers an opaque intent ref and the honest expiry, nothing else", async () => {
    const res = await hold({ handle: HANDLE, slot: SLOT_REF() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["holdExpiresAt", "intentRef"]);
    expect(body.intentRef).toMatch(/^in_[A-Za-z0-9_-]{46}$/);
    expect(Number.isFinite(Date.parse(body.holdExpiresAt))).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns no uuid, and the ref resolves only under this company", async () => {
    const res = await hold({ handle: HANDLE, slot: SLOT_REF() });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(UUID);
    const [intentId] = [...fake.intents.keys()];
    expect(decodeIntentRef(body.intentRef, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: true,
      intentId,
    });
    expect(decodeIntentRef(body.intentRef, OTHER_COMPANY_ID, FAKE_KEY_RING).ok).toBe(false);
  });
});

describe("POST /api/customer/booking/hold — a signature is not a reservation (I12)", () => {
  it("refuses a slot already held by somebody else", async () => {
    await hold({ handle: HANDLE, slot: SLOT_REF() });
    const second = await hold({ handle: HANDLE, slot: SLOT_REF() }, { ip: "198.51.100.4" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "slot_no_longer_available" });
  });

  it("refuses a descriptor whose ten minutes have run out", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
      const stale = SLOT_REF();
      vi.setSystemTime(new Date("2026-09-10T12:11:00.000Z"));
      const res = await hold({ handle: HANDLE, slot: stale });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "slot_no_longer_available" });
      expect(fake.intents.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a descriptor minted for another company, replayed here", async () => {
    const foreign = encodeSlotDescriptor(OTHER_COMPANY_ID, SLOT, FAKE_KEY_RING);
    const res = await hold({ handle: HANDLE, slot: foreign });
    expect(res.status).toBe(409);
    expect(fake.intents.size).toBe(0);
  });

  it("refuses a forged descriptor without ever calling the database", async () => {
    const forged = `sl_${"A".repeat(56)}`;
    const res = await hold({ handle: HANDLE, slot: forged });
    expect(res.status).toBe(409);
    expect(fake.callsTo("hold_booking_slot_as_system")).toEqual([]);
  });

  it("refuses every hold once the company turns booking off", async () => {
    const ref = SLOT_REF();
    fake.setBookingPolicy(COMPANY_ID, { mode: "off" });
    const res = await hold({ handle: HANDLE, slot: ref });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/customer/booking/hold — abuse bounds (I13)", () => {
  it("refuses a fourth concurrent hold from one fingerprint, as a gone slot (I5)", async () => {
    fake.setAvailability(COMPANY_ID, [
      SLOT,
      OTHER_SLOT,
      new Date("2026-09-15T18:00:00.000Z"),
      new Date("2026-09-15T19:00:00.000Z"),
    ]);
    for (const at of [SLOT, OTHER_SLOT, new Date("2026-09-15T18:00:00.000Z")]) {
      const res = await hold({
        handle: HANDLE,
        slot: encodeSlotDescriptor(COMPANY_ID, at, FAKE_KEY_RING),
      });
      expect(res.status).toBe(200);
    }
    const fourth = await hold({
      handle: HANDLE,
      slot: encodeSlotDescriptor(
        COMPANY_ID,
        new Date("2026-09-15T19:00:00.000Z"),
        FAKE_KEY_RING
      ),
    });
    // The migration answers a reached cap exactly as it answers a taken slot,
    // so the surface cannot be used to count anybody's holds.
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: "slot_no_longer_available" });
  });

  it("refuses before touching the database when the per-IP limit is spent", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 30 });
    const res = await hold({ handle: HANDLE, slot: SLOT_REF() });
    expect(res.status).toBe(429);
    expect(fake.calls).toEqual([]);
  });
});

describe("POST /api/customer/booking/hold — refusals", () => {
  it("refuses a malformed body, handle or descriptor", async () => {
    for (const body of [
      "not json",
      { handle: HANDLE },
      { handle: HANDLE, slot: 42 },
      { handle: HANDLE, slot: "" },
      { handle: HANDLE, slot: "ch_abc" },
    ]) {
      const res = await hold(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("is not found for an unknown handle, before any descriptor work", async () => {
    const res = await hold({ handle: "nobody-here", slot: SLOT_REF() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
