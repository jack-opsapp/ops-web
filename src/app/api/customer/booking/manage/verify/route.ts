/**
 * POST /api/customer/booking/manage/verify
 *
 * Body: { handle, bookingRef, challengeId, code, email, action, slot? }.
 * Proves the code, then reschedules or cancels. A reschedule re-runs the whole
 * slot validation under the company lock — the new proposal is a proposal like
 * any other, and can be refused as gone (I12) — and a cancel is final.
 *
 * Answers { outcome: "rescheduled", scheduledAt, durationMinutes } or
 * { outcome: "cancelled" }: no uuid, no crew, nothing about anybody else's
 * booking (I4, I11).
 */

import type { NextRequest, NextResponse } from "next/server";

import { getCustomerIdentityDeps, normalizeEmail } from "@/lib/customer-identity";
import { verifyBookingManage } from "@/lib/customer-identity/booking-broker";

import {
  IP_LIMITS,
  brokerErrorResponse,
  brokerJson,
  decodeChallengeRef,
  enforceIpLimit,
  invalidRequestResponse,
  notFoundResponse,
  parsePublicHandle,
  readJsonObject,
  requestFingerprint,
  resolveCompanyIdByHandle,
} from "../../../_lib/broker-request";
import {
  bookingRefusalResponse,
  isBookingRouteFailure,
  parseCode,
  parseManageAction,
  readBookingRefValue,
  readSlotDescriptor,
  refuseUnboundEmail,
} from "../../_lib/booking-request";

const ROUTE = "booking-manage-verify";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.bookingManageVerify);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const body = await readJsonObject(request);
    if (body === null) return invalidRequestResponse();
    const handle = parsePublicHandle(body.handle);
    if (handle === null) return notFoundResponse();
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (email === null) return invalidRequestResponse();
    const ref = decodeChallengeRef(body.challengeId, email, deps.keyRing);
    if (!ref.ok && ref.reason === "malformed") return invalidRequestResponse();
    const code = parseCode(body.code);
    if (code === null) return invalidRequestResponse();
    const action = parseManageAction(body.action);
    if (action === null) return invalidRequestResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const booking = readBookingRefValue(body.bookingRef, companyId, deps.keyRing);
    if (isBookingRouteFailure(booking)) return booking.response;

    // A reschedule's new time is read before the code is spent: an offer that
    // already expired costs the customer a fresh pick, not a fresh code.
    let slotStartAt: Date | undefined;
    if (action === "reschedule") {
      const slot = readSlotDescriptor(body.slot, companyId, deps.keyRing);
      if (isBookingRouteFailure(slot)) return slot.response;
      slotStartAt = slot.slotStartAt;
    }

    const fingerprint = requestFingerprint(request);
    if (!ref.ok) {
      return refuseUnboundEmail(deps, ref.challengeId, fingerprint, "manage");
    }

    const result = await verifyBookingManage(deps, {
      intentId: booking.intentId,
      companyId,
      challengeId: ref.challengeId,
      email,
      code,
      action,
      slotStartAt,
      networkFingerprint: fingerprint,
    });
    if (!result.ok) {
      return result.reason === "invalid_code"
        ? bookingRefusalResponse("invalid_code", result.attemptsRemaining)
        : bookingRefusalResponse(result.reason);
    }

    return brokerJson(
      result.outcome === "rescheduled"
        ? {
            outcome: "rescheduled",
            scheduledAt: result.scheduledAt,
            durationMinutes: result.durationMinutes,
          }
        : { outcome: "cancelled" },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
