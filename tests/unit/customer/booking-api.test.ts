import { describe, it, expect, vi } from "vitest";
import {
  classifyBookingVerifyFailure,
  holdBookingSlot,
  readAvailability,
  readSlot,
  sendBookingCode,
  verifyBooking,
  MAX_HOLD_SECONDS,
} from "@/components/customer/booking/booking-api";
import { DEFAULT_RETRY_AFTER_SECONDS } from "@/components/customer/customer-api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function fetchReturning(response: Response | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
}

const CONTACT = { name: "Jordan Lee", email: "jordan@example.com", phone: null };

describe("readSlot", () => {
  it("reads the shipped shape — { startAt, ref } — and the obvious variants", () => {
    // What /api/customer/booking/availability actually returns.
    expect(readSlot({ startAt: "2026-09-08T15:00:00Z", ref: "sl_a" })).toEqual({
      slot: "sl_a",
      startAt: new Date("2026-09-08T15:00:00Z"),
    });
    expect(readSlot({ slot: "sl_a", startAt: "2026-09-08T15:00:00Z" })).toEqual({
      slot: "sl_a",
      startAt: new Date("2026-09-08T15:00:00Z"),
    });
    expect(readSlot({ descriptor: "sl_b", start: "2026-09-08T16:00:00Z" })?.slot).toBe("sl_b");
    expect(readSlot({ token: "sl_c", startsAt: "2026-09-08T17:00:00Z" })?.slot).toBe("sl_c");
  });

  it("drops an entry it cannot render rather than guessing a time", () => {
    // The descriptor is an opaque HMAC (design §4.4) — no time can be read out
    // of it, so a bare string or a missing instant is unusable, not decodable.
    expect(readSlot("sl_opaque")).toBeNull();
    expect(readSlot({ slot: "sl_a" })).toBeNull();
    expect(readSlot({ startAt: "2026-09-08T15:00:00Z" })).toBeNull();
    expect(readSlot({ slot: "sl_a", startAt: "not-a-date" })).toBeNull();
    expect(readSlot(null)).toBeNull();
    expect(readSlot([])).toBeNull();
  });
});

describe("readAvailability", () => {
  it("asks for the window by handle and returns renderable slots", async () => {
    const f = fetchReturning(
      jsonResponse(200, {
        slots: [{ slot: "sl_a", startAt: "2026-09-08T15:00:00Z" }],
        timezone: "America/Denver",
        durationMinutes: 60,
      })
    );
    const out = await readAvailability("acme", "2026-09-07", "2026-10-12", f);
    expect(out).toEqual({
      ok: true,
      availability: {
        slots: [{ slot: "sl_a", startAt: new Date("2026-09-08T15:00:00Z") }],
        timezone: "America/Denver",
        durationMinutes: 60,
        mode: null,
      },
    });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "/api/customer/booking/availability?handle=acme&from=2026-09-07&to=2026-10-12"
    );
    expect(init.method).toBe("GET");
  });

  it("reads the mode only when the broker states one", async () => {
    const known = await readAvailability(
      "acme",
      "a",
      "b",
      fetchReturning(jsonResponse(200, { slots: [], timezone: "UTC", durationMinutes: 60, mode: "request" }))
    );
    expect(known).toMatchObject({ ok: true, availability: { mode: "request" } });

    const silent = await readAvailability(
      "acme",
      "a",
      "b",
      fetchReturning(jsonResponse(200, { slots: [], timezone: "UTC", durationMinutes: 60 }))
    );
    expect(silent).toMatchObject({ ok: true, availability: { mode: null } });

    const nonsense = await readAvailability(
      "acme",
      "a",
      "b",
      fetchReturning(jsonResponse(200, { slots: [], mode: "sideways" }))
    );
    expect(nonsense).toMatchObject({ ok: true, availability: { mode: null } });
  });

  it("treats an empty list as a real answer — mode 'off' and sold out look the same", async () => {
    const out = await readAvailability(
      "acme",
      "a",
      "b",
      fetchReturning(jsonResponse(200, { slots: [], timezone: "America/Denver", durationMinutes: 60 }))
    );
    expect(out).toMatchObject({ ok: true, availability: { slots: [] } });
  });

  it("defaults a missing timezone and duration instead of printing NaN", async () => {
    const out = await readAvailability("acme", "a", "b", fetchReturning(jsonResponse(200, {})));
    expect(out).toMatchObject({
      ok: true,
      availability: { slots: [], timezone: "UTC", durationMinutes: 0 },
    });
  });

  it("maps 404, 503 and a dead network", async () => {
    expect(
      await readAvailability("acme", "a", "b", fetchReturning(jsonResponse(404, { error: "not_found" })))
    ).toEqual({ ok: false, kind: "unknown_handle" });
    expect(
      await readAvailability("acme", "a", "b", fetchReturning(jsonResponse(503, { error: "unavailable" })))
    ).toEqual({ ok: false, kind: "unavailable" });
    expect(
      await readAvailability("acme", "a", "b", fetchReturning(new TypeError("offline")))
    ).toEqual({ ok: false, kind: "offline" });
    expect(
      await readAvailability("acme", "a", "b", fetchReturning(jsonResponse(500, { error: "boom" })))
    ).toEqual({ ok: false, kind: "failed" });
  });
});

describe("holdBookingSlot", () => {
  it("posts the opaque descriptor and returns the intent with its expiry", async () => {
    const expires = new Date(Date.now() + 300_000).toISOString();
    const f = fetchReturning(jsonResponse(200, { intentRef: "in_1", holdExpiresAt: expires }));
    const out = await holdBookingSlot("acme", "sl_a", f);
    expect(out).toEqual({ ok: true, intentRef: "in_1", holdExpiresAt: Date.parse(expires) });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/customer/booking/hold");
    expect(JSON.parse(init.body as string)).toEqual({ handle: "acme", slot: "sl_a" });
  });

  it("caps a hold with no readable expiry at five minutes (I13)", async () => {
    const before = Date.now();
    const out = await holdBookingSlot(
      "acme",
      "sl_a",
      fetchReturning(jsonResponse(200, { intentRef: "in_1" }))
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.holdExpiresAt).toBeGreaterThanOrEqual(before + MAX_HOLD_SECONDS * 1000);
    expect(out.holdExpiresAt).toBeLessThanOrEqual(Date.now() + MAX_HOLD_SECONDS * 1000);
  });

  it("reads the cap refusal shaped like a success (I5/I13: success minus the intent)", async () => {
    expect(
      await holdBookingSlot("acme", "sl_a", fetchReturning(jsonResponse(200, { retryAfterSeconds: 30 })))
    ).toEqual({ ok: false, kind: "limited", retryAfterSeconds: 30 });
    expect(
      await holdBookingSlot("acme", "sl_a", fetchReturning(jsonResponse(429, { error: "rate_limited" }, { "Retry-After": "45" })))
    ).toEqual({ ok: false, kind: "limited", retryAfterSeconds: 45 });
  });

  it("recognises a slot that is already gone (I12)", async () => {
    expect(
      await holdBookingSlot("acme", "sl_a", fetchReturning(jsonResponse(409, { error: "slot_no_longer_available" })))
    ).toMatchObject({ ok: false, kind: "slot_taken" });
    expect(
      await holdBookingSlot("acme", "sl_a", fetchReturning(jsonResponse(400, { error: "slot_no_longer_available" })))
    ).toMatchObject({ ok: false, kind: "slot_taken" });
  });

  it("maps 404, 503 and a dead network", async () => {
    expect(
      await holdBookingSlot("acme", "sl_a", fetchReturning(jsonResponse(404, { error: "not_found" })))
    ).toMatchObject({ ok: false, kind: "unknown_handle" });
    expect(
      await holdBookingSlot("acme", "sl_a", fetchReturning(jsonResponse(503, { error: "unavailable" })))
    ).toMatchObject({ ok: false, kind: "unavailable" });
    expect(await holdBookingSlot("acme", "sl_a", fetchReturning(new TypeError("x")))).toMatchObject({
      ok: false,
      kind: "offline",
    });
  });
});

describe("sendBookingCode", () => {
  it("posts the details against the intent and returns the challenge", async () => {
    const f = fetchReturning(jsonResponse(200, { challengeId: "ch_1", retryAfterSeconds: 45 }));
    const out = await sendBookingCode("acme", "in_1", CONTACT, f);
    expect(out).toEqual({ ok: true, challengeId: "ch_1", retryAfterSeconds: 45 });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/customer/booking/contact");
    expect(JSON.parse(init.body as string)).toEqual({
      handle: "acme",
      intentRef: "in_1",
      name: "Jordan Lee",
      email: "jordan@example.com",
    });
  });

  it("sends the phone only when one was given (it is evidence, not an identifier)", async () => {
    const f = fetchReturning(jsonResponse(200, { challengeId: "ch_1" }));
    await sendBookingCode("acme", "in_1", { ...CONTACT, phone: "403-555-0199" }, f);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string).phone).toBe("403-555-0199");
  });

  it("defaults the resend window when the broker omits it", async () => {
    expect(
      await sendBookingCode("acme", "in_1", CONTACT, fetchReturning(jsonResponse(200, { challengeId: "ch_1" })))
    ).toEqual({ ok: true, challengeId: "ch_1", retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS });
  });

  it("separates a lost hold from a rate limit — one goes back a step, the other waits", async () => {
    expect(
      await sendBookingCode("acme", "in_1", CONTACT, fetchReturning(jsonResponse(410, { error: "hold_expired" })))
    ).toMatchObject({ ok: false, kind: "hold_expired" });
    expect(
      await sendBookingCode("acme", "in_1", CONTACT, fetchReturning(jsonResponse(404, { error: "intent_not_found" })))
    ).toMatchObject({ ok: false, kind: "hold_expired" });
    expect(
      await sendBookingCode("acme", "in_1", CONTACT, fetchReturning(jsonResponse(429, { error: "rate_limited", retryAfterSeconds: 20 })))
    ).toEqual({ ok: false, kind: "rate_limited", retryAfterSeconds: 20 });
  });
});

describe("verifyBooking", () => {
  it("posts the code bound to the intent and the email, and reads the outcome", async () => {
    const f = fetchReturning(jsonResponse(200, { outcome: "confirmed", bookingRef: "bk_9" }));
    const out = await verifyBooking("acme", "in_1", "ch_1", "123456", "jordan@example.com", f);
    expect(out).toEqual({ ok: true, result: "confirmed", bookingRef: "bk_9", scheduledAt: null });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/customer/booking/verify");
    expect(JSON.parse(init.body as string)).toEqual({
      handle: "acme",
      intentRef: "in_1",
      challengeId: "ch_1",
      code: "123456",
      email: "jordan@example.com",
    });
  });

  it("carries the request outcome through unchanged, with no time on any calendar (I14)", async () => {
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "123456", "j@e.co", fetchReturning(jsonResponse(200, { outcome: "submitted", scheduledAt: null })))
    ).toEqual({ ok: true, result: "submitted", bookingRef: null, scheduledAt: null });
  });

  it("prefers the server's booked time over anything the page picked", async () => {
    const out = await verifyBooking(
      "acme",
      "in_1",
      "ch_1",
      "123456",
      "j@e.co",
      fetchReturning(jsonResponse(200, { outcome: "confirmed", bookingRef: "bk_9", scheduledAt: "2026-09-08T15:00:00.000Z" }))
    );
    expect(out).toMatchObject({ ok: true, scheduledAt: new Date("2026-09-08T15:00:00.000Z") });
  });

  it("ignores a scheduledAt it cannot parse", async () => {
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "123456", "j@e.co", fetchReturning(jsonResponse(200, { outcome: "confirmed", scheduledAt: "soon" })))
    ).toMatchObject({ ok: true, scheduledAt: null });
  });

  it("refuses to invent an outcome the broker did not state", async () => {
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "123456", "j@e.co", fetchReturning(jsonResponse(200, { ok: true })))
    ).toMatchObject({ ok: false, kind: "failed" });
  });

  it("maps the code failures the same way sign-in does", async () => {
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "111111", "j@e.co", fetchReturning(jsonResponse(400, { error: "invalid_code", attemptsRemaining: 2 })))
    ).toEqual({ ok: false, kind: "invalid", attemptsRemaining: 2 });
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "111111", "j@e.co", fetchReturning(jsonResponse(400, { error: "challenge_exhausted" })))
    ).toMatchObject({ ok: false, kind: "exhausted" });
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "111111", "j@e.co", fetchReturning(jsonResponse(400, { error: "challenge_closed" })))
    ).toMatchObject({ ok: false, kind: "expired" });
  });

  it("distinguishes the two refusals that send the visitor back to step one", async () => {
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "123456", "j@e.co", fetchReturning(jsonResponse(409, { error: "slot_no_longer_available" })))
    ).toMatchObject({ ok: false, kind: "slot_taken" });
    expect(
      await verifyBooking("acme", "in_1", "ch_1", "123456", "j@e.co", fetchReturning(jsonResponse(410, { error: "hold_expired" })))
    ).toMatchObject({ ok: false, kind: "hold_expired" });
  });
});

describe("classifyBookingVerifyFailure", () => {
  it("ranks a lost slot above every code failure — it is not the visitor's mistake", () => {
    expect(classifyBookingVerifyFailure(400, "slot_no_longer_available")).toBe("slot_taken");
    expect(classifyBookingVerifyFailure(409, "slot_no_longer_available")).toBe("slot_taken");
    expect(classifyBookingVerifyFailure(400, "hold_expired")).toBe("hold_expired");
    // The broker's word for "this intent can no longer be booked".
    expect(classifyBookingVerifyFailure(400, "not_confirmable")).toBe("hold_expired");
    expect(classifyBookingVerifyFailure(400, "challenge_exhausted")).toBe("exhausted");
    expect(classifyBookingVerifyFailure(400, "challenge_closed")).toBe("expired");
    expect(classifyBookingVerifyFailure(400, "invalid_code")).toBe("invalid");
    expect(classifyBookingVerifyFailure(503, "unavailable")).toBe("unavailable");
    expect(classifyBookingVerifyFailure(500, "")).toBe("failed");
  });
});
