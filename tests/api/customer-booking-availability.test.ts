/**
 * GET /api/customer/booking/availability — the times a business is offering
 * (P2 plan task P2-2, design §6, D10, I4, I11).
 *
 * Runs the real broker library against the in-memory fake. What matters as
 * much as the slots is what never appears: no uuid, no crew, no count of
 * anything, and no surface at all when the company has booking off.
 */

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIdentityFake } from "../utils/customer-identity-fake";

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

import { CustomerIdentityUnavailableError } from "@/lib/customer-identity";
import { FAKE_KEY_RING } from "../utils/customer-identity-fake";
import { decodeSlotDescriptor } from "@/lib/customer-identity/booking-refs";
import { IP_LIMITS } from "@/app/api/customer/_lib/broker-request";
import { GET } from "@/app/api/customer/booking/availability/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const IP = "203.0.113.7";
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const OTHER_SLOT = new Date("2026-09-15T17:00:00.000Z");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function availability(
  query: Record<string, string | undefined>,
  init: { ip?: string } = {}
): Promise<NextResponse> {
  const url = new URL("http://localhost/api/customer/booking/availability");
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return GET(
    new NextRequest(url, {
      method: "GET",
      headers: { "x-forwarded-for": init.ip ?? IP, "user-agent": "Safari/17" },
    })
  );
}

const RANGE = { handle: HANDLE, from: "2026-09-15", to: "2026-09-16" };

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  fake.setBookingPolicy(COMPANY_ID, {
    mode: "instant",
    timezone: "America/Edmonton",
    visit_duration_minutes: 90,
  });
  fake.setAvailability(COMPANY_ID, [SLOT, OTHER_SLOT]);
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/customer/booking/availability — success", () => {
  it("answers signed slots, the policy timezone and the visit length", async () => {
    const res = await availability(RANGE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      mode: "instant",
      timezone: "America/Edmonton",
      durationMinutes: 90,
      slots: [
        { startAt: SLOT.toISOString(), ref: expect.stringMatching(/^sl_[A-Za-z0-9_-]{56}$/) },
        {
          startAt: OTHER_SLOT.toISOString(),
          ref: expect.stringMatching(/^sl_[A-Za-z0-9_-]{56}$/),
        },
      ],
    });
  });

  it("mints descriptors this company can verify and nobody else can", async () => {
    const body = await (await availability(RANGE)).json();
    const decoded = decodeSlotDescriptor(body.slots[0].ref, COMPANY_ID, FAKE_KEY_RING);
    expect(decoded).toEqual({ ok: true, slotStartAt: SLOT });
    expect(
      decodeSlotDescriptor(
        body.slots[0].ref,
        "11111111-2222-4333-8444-555555555555",
        FAKE_KEY_RING
      ).ok
    ).toBe(false);
  });

  it("never returns a uuid, a crew member or a count (I4, I11)", async () => {
    const raw = await (await availability(RANGE)).text();
    expect(raw).not.toMatch(UUID);
    expect(raw.toLowerCase()).not.toContain("assignee");
    expect(raw.toLowerCase()).not.toContain("crew");
    expect(raw).not.toContain(COMPANY_ID);
  });

  it("is never cached", async () => {
    const res = await availability(RANGE);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers an empty week without pretending it is an error", async () => {
    fake.setAvailability(COMPANY_ID, []);
    const res = await availability(RANGE);
    expect(res.status).toBe(200);
    expect((await res.json()).slots).toEqual([]);
  });

  it("hides a slot the moment somebody else holds it", async () => {
    fake.seedIntent({
      companyId: COMPANY_ID,
      slotStartAt: SLOT.toISOString(),
      state: "held",
    });
    const body = await (await availability(RANGE)).json();
    expect(body.slots.map((slot: { startAt: string }) => slot.startAt)).toEqual([
      OTHER_SLOT.toISOString(),
    ]);
  });
});

describe("GET /api/customer/booking/availability — no surface", () => {
  it("is not found when the company has booking off (D9)", async () => {
    fake.setBookingPolicy(COMPANY_ID, { mode: "off" });
    const res = await availability(RANGE);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("is not found for an unknown handle, a soft-deleted company and a uuid", async () => {
    fake.addCompany("deleted-co", { id: COMPANY_ID, deleted_at: "2026-01-01T00:00:00Z" });
    for (const handle of ["no-such-company", "deleted-co", COMPANY_ID, "AB"]) {
      const res = await availability({ ...RANGE, handle });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers the same 404 whether booking is off or the company is unknown", async () => {
    fake.setBookingPolicy(COMPANY_ID, { mode: "off" });
    const off = await (await availability(RANGE)).json();
    const unknown = await (await availability({ ...RANGE, handle: "nobody-here" })).json();
    expect(off).toEqual(unknown);
  });
});

describe("GET /api/customer/booking/availability — refusals", () => {
  it("refuses a malformed, reversed or oversized range", async () => {
    for (const range of [
      { from: "2026-9-15", to: "2026-09-16" },
      { from: "2026-09-15", to: "not-a-date" },
      { from: "2026-09-16", to: "2026-09-15" },
      { from: "2026-02-30", to: "2026-03-02" },
      { from: "2026-09-15", to: "2026-11-30" },
      { from: undefined, to: "2026-09-16" },
      { from: "2026-09-15", to: undefined },
    ]) {
      const res = await availability({ handle: HANDLE, ...range });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("refuses before reading anything when the per-IP limit is spent", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 12 });
    const res = await availability(RANGE);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(fake.calls).toEqual([]);
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `customer-api:${IP_LIMITS.bookingAvailability.name}:${IP}`,
      })
    );
  });

  it("fails closed when the broker is unconfigured", async () => {
    mocks.getDeps.mockImplementation(() => {
      throw new CustomerIdentityUnavailableError("blank", "OPS_CUSTOMER_AUTH_URL is blank");
    });
    const res = await availability(RANGE);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "customer_identity_unavailable" });
  });

  it("answers a store failure without leaking why", async () => {
    fake.failOn("read_public_availability_as_system", { message: "boom" });
    const res = await availability(RANGE);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
  });
});
