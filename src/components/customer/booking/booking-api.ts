/**
 * OPS Web - Hosted Guest Booking: broker API client
 *
 * Typed wrappers over the four public booking routes (design §6, shipped in
 * P2-2). Like the sign-in client they share, every wrapper resolves to a
 * discriminated outcome and never throws — the UI maps outcomes to copy and
 * nothing else.
 *
 * ── Why each slot carries its own time ───────────────────────────────────
 * Design §4.4 makes the slot descriptor opaque: `sl_…` is an HMAC over the
 * company and the start epoch, and a valid signature proves only that OPS
 * offered the slot. The page can therefore never read a time out of it, and
 * the availability route pairs every descriptor with its instant:
 *
 *     { mode, timezone, durationMinutes,
 *       slots: [{ startAt: "2026-09-08T15:00:00Z", ref: "sl_…" }, …] }
 *
 * `readAvailability` accepts the descriptor under `ref` (shipped) or `slot` /
 * `descriptor` / `token`, and the instant under `startAt` / `start` /
 * `startsAt` / `startTime`, and drops any entry it cannot render — a payload
 * this page cannot draw becomes an honest "no open times", never a broken
 * grid.
 *
 * `mode` is read when present and tolerated when absent: with it, step one
 * can promise the truth before the visitor commits; without it, every string
 * shown before the outcome is true under both `instant` and `request`.
 */

import {
  DEFAULT_RETRY_AFTER_SECONDS,
  errorCodeOf,
  isUnavailable,
  postJson,
  readNonNegativeInt,
  requestJson,
  retryAfterFrom,
  type FetchLike,
} from "../customer-api";
import type { Availability, AvailableSlot, BookingMode } from "./booking-format";

// ─── Availability ────────────────────────────────────────────────────────────

export type AvailabilityOutcome =
  | { ok: true; availability: Availability }
  | { ok: false; kind: "unknown_handle" | "unavailable" | "offline" | "failed" };

function readString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** One entry → a renderable slot, or null when the descriptor or the instant is missing. */
export function readSlot(entry: unknown): AvailableSlot | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const source = entry as Record<string, unknown>;

  const slot = readString(source, ["slot", "descriptor", "token", "ref"]);
  const startRaw = readString(source, ["startAt", "start", "startsAt", "startTime"]);
  if (!slot || !startRaw) return null;

  const startAt = new Date(startRaw);
  if (Number.isNaN(startAt.getTime())) return null;

  return { slot, startAt };
}

function readMode(value: unknown): BookingMode | null {
  return value === "instant" || value === "request" ? value : null;
}

export async function readAvailability(
  handle: string,
  from: string,
  to: string,
  fetchImpl: FetchLike = fetch
): Promise<AvailabilityOutcome> {
  const query = new URLSearchParams({ handle, from, to });
  const res = await requestJson(fetchImpl, `/api/customer/booking/availability?${query}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if ("offline" in res) return { ok: false, kind: "offline" };

  if (res.status === 404) return { ok: false, kind: "unknown_handle" };
  if (isUnavailable(res)) return { ok: false, kind: "unavailable" };
  if (res.status < 200 || res.status >= 300 || !res.body) return { ok: false, kind: "failed" };

  const raw = Array.isArray(res.body.slots) ? res.body.slots : [];
  const slots = raw.map(readSlot).filter((slot): slot is AvailableSlot => slot !== null);

  return {
    ok: true,
    availability: {
      slots,
      timezone: typeof res.body.timezone === "string" ? res.body.timezone : "UTC",
      // A missing or nonsense duration must not print "NaN MIN" in the metadata line.
      durationMinutes: readNonNegativeInt(res.body.durationMinutes) ?? 0,
      mode: readMode(res.body.mode),
    },
  };
}

// ─── Hold (a slot is set aside while the visitor finishes) ───────────────────

export type HoldOutcome =
  | { ok: true; intentRef: string; holdExpiresAt: number }
  | {
      ok: false;
      kind: "limited" | "slot_taken" | "unknown_handle" | "unavailable" | "offline" | "failed";
      retryAfterSeconds: number | null;
    };

/**
 * The hold route answers every refusal it can give — booking switched off, an
 * inactive integration, a slot that closed, a hold cap reached — with one
 * `slot_no_longer_available` (409), so none of them can be told apart from
 * outside (I5, I13). The page treats them all as "that time is gone".
 */
function isSlotGone(status: number, code: string): boolean {
  if (status === 409 || status === 410) return true;
  return code.includes("slot_no_longer_available") || code.includes("slot_taken");
}

export async function holdBookingSlot(
  handle: string,
  slot: string,
  fetchImpl: FetchLike = fetch
): Promise<HoldOutcome> {
  const res = await postJson(fetchImpl, "/api/customer/booking/hold", { handle, slot });
  if ("offline" in res) return { ok: false, kind: "offline", retryAfterSeconds: null };

  const code = errorCodeOf(res.body);
  if (res.status === 429) {
    return { ok: false, kind: "limited", retryAfterSeconds: retryAfterFrom(res) };
  }
  if (isSlotGone(res.status, code)) {
    return { ok: false, kind: "slot_taken", retryAfterSeconds: null };
  }
  if (res.status === 404) return { ok: false, kind: "unknown_handle", retryAfterSeconds: null };
  if (isUnavailable(res)) return { ok: false, kind: "unavailable", retryAfterSeconds: null };
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, kind: "failed", retryAfterSeconds: null };
  }

  const intentRef = res.body?.intentRef;
  if (typeof intentRef !== "string" || intentRef.length === 0) {
    // A 200 without an intent is the cap refusal shaped like a success (design I5/I13).
    return { ok: false, kind: "limited", retryAfterSeconds: retryAfterFrom(res) };
  }

  const expires = typeof res.body?.holdExpiresAt === "string" ? res.body.holdExpiresAt : null;
  const holdExpiresAt = expires ? Date.parse(expires) : Number.NaN;

  return {
    ok: true,
    intentRef,
    // A hold with no readable expiry still counts down — five minutes is the ceiling (I13).
    holdExpiresAt: Number.isNaN(holdExpiresAt) ? Date.now() + MAX_HOLD_SECONDS * 1000 : holdExpiresAt,
  };
}

/** Design I13: a hold is never longer than five minutes. */
export const MAX_HOLD_SECONDS = 300;

// ─── Contact (details → a code on one channel) ───────────────────────────────

export interface BookingContact {
  name: string;
  email: string;
  phone: string | null;
}

export type ContactOutcome =
  | { ok: true; challengeId: string; retryAfterSeconds: number }
  | {
      ok: false;
      kind:
        | "rate_limited"
        | "hold_expired"
        | "unknown_handle"
        | "unavailable"
        | "offline"
        | "failed";
      retryAfterSeconds: number | null;
    };

/** The intent is gone: expired hold, swept hold, or a ref the broker no longer knows. */
function isHoldGone(status: number, code: string): boolean {
  if (status === 404 && code.includes("intent")) return true;
  if (status === 409 || status === 410) return true;
  return code.includes("expired") || code.includes("hold") || code.includes("intent_not_found");
}

export async function sendBookingCode(
  handle: string,
  intentRef: string,
  contact: BookingContact,
  fetchImpl: FetchLike = fetch
): Promise<ContactOutcome> {
  const res = await postJson(fetchImpl, "/api/customer/booking/contact", {
    handle,
    intentRef,
    name: contact.name,
    email: contact.email,
    ...(contact.phone ? { phone: contact.phone } : {}),
  });
  if ("offline" in res) return { ok: false, kind: "offline", retryAfterSeconds: null };

  const code = errorCodeOf(res.body);
  if (res.status === 429) {
    return { ok: false, kind: "rate_limited", retryAfterSeconds: retryAfterFrom(res) };
  }
  if (isHoldGone(res.status, code)) {
    return { ok: false, kind: "hold_expired", retryAfterSeconds: null };
  }
  if (res.status === 404) return { ok: false, kind: "unknown_handle", retryAfterSeconds: null };
  if (isUnavailable(res)) return { ok: false, kind: "unavailable", retryAfterSeconds: null };
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, kind: "failed", retryAfterSeconds: null };
  }

  const challengeId = res.body?.challengeId;
  if (typeof challengeId !== "string" || challengeId.length === 0) {
    return { ok: false, kind: "failed", retryAfterSeconds: null };
  }
  return {
    ok: true,
    challengeId,
    retryAfterSeconds:
      readNonNegativeInt(res.body?.retryAfterSeconds) ?? DEFAULT_RETRY_AFTER_SECONDS,
  };
}

// ─── Verify (code → a real visit, or a request on the books) ─────────────────

/** The two terminal outcomes (design §5): `instant` books, `request` waits. */
export type BookingResult = "confirmed" | "submitted";

export type BookingVerifyOutcome =
  | {
      ok: true;
      result: BookingResult;
      bookingRef: string | null;
      /** The time the server actually booked. Null in `request` mode (I14). */
      scheduledAt: Date | null;
    }
  | {
      ok: false;
      kind:
        | "invalid"
        | "expired"
        | "exhausted"
        | "slot_taken"
        | "hold_expired"
        | "unknown_handle"
        | "unavailable"
        | "offline"
        | "failed";
      attemptsRemaining: number | null;
    };

function readResult(value: unknown): BookingResult | null {
  return value === "confirmed" || value === "submitted" ? value : null;
}

/**
 * The broker's refusal vocabulary (`booking/_lib/booking-request.ts`):
 * `invalid_code` with `attemptsRemaining`, `challenge_exhausted`,
 * `challenge_closed`, `not_confirmable`, and `slot_no_longer_available` (409).
 *
 * The last two are not the visitor's mistake: the slot went while they were
 * typing (I12), or the hold was swept before they finished (I13). Both send
 * them back to step one with their details intact, and must never read like a
 * wrong code.
 */
export function classifyBookingVerifyFailure(
  status: number,
  code: string
): Exclude<Extract<BookingVerifyOutcome, { ok: false }>["kind"], "offline"> {
  if (status === 503 || code.includes("unavailable")) return "unavailable";
  if (code.includes("slot_no_longer_available") || code.includes("slot_taken")) return "slot_taken";
  // `not_confirmable`: the intent is no longer in a state that can be booked.
  if (code.includes("hold") || code.includes("intent") || code.includes("not_confirmable")) {
    return "hold_expired";
  }
  if (status === 404) return "unknown_handle";
  if (code.includes("expired") || code.includes("closed")) return "expired";
  if (code.includes("exhaust") || code.includes("attempt") || status === 429) return "exhausted";
  if (code.includes("invalid") || code.includes("mismatch") || code.includes("code")) {
    return "invalid";
  }
  if (status >= 400 && status < 500) return "invalid";
  return "failed";
}

export async function verifyBooking(
  handle: string,
  intentRef: string,
  challengeId: string,
  code: string,
  email: string,
  fetchImpl: FetchLike = fetch
): Promise<BookingVerifyOutcome> {
  const res = await postJson(fetchImpl, "/api/customer/booking/verify", {
    handle,
    intentRef,
    challengeId,
    code,
    email,
  });
  if ("offline" in res) return { ok: false, kind: "offline", attemptsRemaining: null };

  if (res.status >= 200 && res.status < 300) {
    const result = readResult(res.body?.outcome);
    if (result) {
      const ref = res.body?.bookingRef;
      // The server's own `scheduledAt` outranks the slot the page picked: it
      // is what actually landed on the calendar.
      const scheduled =
        typeof res.body?.scheduledAt === "string" ? new Date(res.body.scheduledAt) : null;
      return {
        ok: true,
        result,
        bookingRef: typeof ref === "string" && ref ? ref : null,
        scheduledAt: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null,
      };
    }
    return { ok: false, kind: "failed", attemptsRemaining: null };
  }

  const kind = classifyBookingVerifyFailure(res.status, errorCodeOf(res.body));
  return {
    ok: false,
    kind,
    attemptsRemaining: kind === "invalid" ? readNonNegativeInt(res.body?.attemptsRemaining) : null,
  };
}
