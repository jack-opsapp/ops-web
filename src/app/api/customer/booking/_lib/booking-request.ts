import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import {
  OTP_MAX_ATTEMPTS,
  appendIdentityEvent,
  type CustomerIdentityDeps,
} from "@/lib/customer-identity";
import { recordOtpAttempt } from "@/lib/customer-identity/rpc";
import {
  decodeBookingRef,
  decodeIntentRef,
  decodeSlotDescriptor,
  type RefDecoding,
} from "@/lib/customer-identity/booking-refs";
import type { CustomerIdentityHmacKeyRing } from "@/lib/customer-identity";

import {
  brokerJson,
  invalidRequestResponse,
  slotGoneResponse,
} from "../../_lib/broker-request";

/**
 * Plumbing shared by the six guest-booking routes (design §6).
 *
 * Every route resolves the company by handle first, then reads its refs
 * against that company — an intent, booking or slot descriptor minted for one
 * business is meaningless at another's handle and is refused before any
 * database call.
 *
 * A ref that fails its signature is not a statement about any booking: it says
 * only that the caller did not get it from OPS. That answers `invalid_request`
 * everywhere. The enumeration-sensitive case is the opposite one — a genuine
 * ref naming a hold that is dead, foreign or already used — and that is
 * answered inside the broker with a challenge that never resolves (I5).
 */

const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const CODE_PATTERN = /^[0-9]{6}$/;

/** A month at a time: enough for any picker, small enough to bound a response. */
export const MAX_AVAILABILITY_SPAN_DAYS = 31;

export type BookingRouteFailure = { readonly response: NextResponse };

function failure(response: NextResponse): BookingRouteFailure {
  return Object.freeze({ response });
}

/**
 * Read a ref bound to this company. A malformed ref and one that fails its
 * signature answer identically; neither reaches the database.
 */
function readRef(
  decoding: RefDecoding<{ intentId: string }>
): { readonly intentId: string } | BookingRouteFailure {
  if (!decoding.ok) return failure(invalidRequestResponse());
  return Object.freeze({ intentId: decoding.intentId });
}

export function readIntentRef(
  value: unknown,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): { readonly intentId: string } | BookingRouteFailure {
  return readRef(decodeIntentRef(value, companyId, keyRing));
}

export function readBookingRefValue(
  value: unknown,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): { readonly intentId: string } | BookingRouteFailure {
  return readRef(decodeBookingRef(value, companyId, keyRing));
}

/**
 * Read a slot proposal. A descriptor that is well-formed but does not verify
 * — expired, or minted for another company — is a time the customer can no
 * longer have, so it answers as a gone slot rather than a client error. A
 * signature that verifies still proves nothing about availability (I12).
 */
export function readSlotDescriptor(
  value: unknown,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): { readonly slotStartAt: Date } | BookingRouteFailure {
  const decoded = decodeSlotDescriptor(value, companyId, keyRing);
  if (decoded.ok) return Object.freeze({ slotStartAt: decoded.slotStartAt });
  return failure(
    decoded.reason === "malformed" ? invalidRequestResponse() : slotGoneResponse()
  );
}

export function isBookingRouteFailure(
  value: object
): value is BookingRouteFailure {
  return "response" in value;
}

/** A calendar date, exact or nothing: `2026-02-30` is not a date. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

export interface AvailabilityRange {
  readonly from: string;
  readonly to: string;
}

export function parseAvailabilityRange(
  request: NextRequest
): AvailabilityRange | null {
  const from = parseIsoDate(request.nextUrl.searchParams.get("from"));
  const to = parseIsoDate(request.nextUrl.searchParams.get("to"));
  if (from === null || to === null) return null;
  const span = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  if (span < 0) return null;
  if (span > (MAX_AVAILABILITY_SPAN_DAYS - 1) * 86_400_000) return null;
  return Object.freeze({ from, to });
}

export function parseCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return CODE_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseManageAction(value: unknown): "reschedule" | "cancel" | null {
  return value === "reschedule" || value === "cancel" ? value : null;
}

/**
 * Every booking response the customer sees, minus the ones that carry a
 * window. The codes are fixed strings: no message, no identifier, nothing that
 * distinguishes one person's booking from another's (I5, I11).
 */
export function bookingRefusalResponse(
  reason:
    | "invalid_code"
    | "challenge_exhausted"
    | "challenge_closed"
    | "not_confirmable"
    | "not_manageable"
    | "slot_no_longer_available",
  attemptsRemaining?: number
): NextResponse {
  if (reason === "slot_no_longer_available") return slotGoneResponse();
  if (reason === "invalid_code") {
    return brokerJson({ error: "invalid_code", attemptsRemaining }, 400);
  }
  return brokerJson({ error: reason }, 400);
}

/**
 * The challenge ref was not minted for this email. Charge the attempt against
 * the challenge it names — a leaked ref burns out like any other guessing —
 * skip the provider, and answer as a wrong code would.
 */
export async function refuseUnboundEmail(
  deps: CustomerIdentityDeps,
  challengeId: string,
  fingerprint: string,
  stage: "verify" | "manage"
): Promise<NextResponse> {
  const attempt = await recordOtpAttempt(deps.rpc, { challengeId, success: false });
  await appendIdentityEvent(deps.rpc, {
    eventType: "otp_failed",
    identityId: null,
    companyId: null,
    sessionId: null,
    networkFingerprint: fingerprint,
    metadata: {
      flow: "booking",
      stage,
      binding: "mismatch",
      attempts: attempt === null ? null : attempt.attempts,
    },
  });
  if (attempt === null) return bookingRefusalResponse("challenge_closed");
  if (attempt.exhausted || attempt.attempts > OTP_MAX_ATTEMPTS) {
    return bookingRefusalResponse("challenge_exhausted");
  }
  return bookingRefusalResponse(
    "invalid_code",
    Math.max(0, OTP_MAX_ATTEMPTS - attempt.attempts)
  );
}
