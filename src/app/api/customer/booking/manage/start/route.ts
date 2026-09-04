/**
 * POST /api/customer/booking/manage/start
 *
 * Body: { handle, bookingRef, email }. Begins a fresh six-digit challenge for
 * changing or cancelling a booking. No management capability is ever emailed:
 * the ref in a confirmation is an address, not authority, and every action
 * behind it costs a code proved now (I15).
 *
 * The answer is { challengeId, retryAfterSeconds } whether the ref names a
 * live booking, a cancelled one, one held under a different address, or
 * nothing at all — a refusal names a challenge that never resolves, so the
 * surface says nothing about whose booking exists (I5, I11).
 */

import type { NextRequest, NextResponse } from "next/server";

import { getCustomerIdentityDeps, normalizeEmail } from "@/lib/customer-identity";
import { startBookingManage } from "@/lib/customer-identity/booking-broker";

import {
  IP_LIMITS,
  brokerErrorResponse,
  brokerJson,
  encodeChallengeRef,
  enforceIpLimit,
  invalidRequestResponse,
  notFoundResponse,
  parsePublicHandle,
  readJsonObject,
  requestFingerprint,
  resolveCompanyIdByHandle,
} from "../../../_lib/broker-request";
import {
  isBookingRouteFailure,
  readBookingRefValue,
} from "../../_lib/booking-request";

const ROUTE = "booking-manage-start";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.bookingManageStart);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const body = await readJsonObject(request);
    if (body === null) return invalidRequestResponse();
    const handle = parsePublicHandle(body.handle);
    if (handle === null) return notFoundResponse();
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (email === null) return invalidRequestResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const booking = readBookingRefValue(body.bookingRef, companyId, deps.keyRing);
    if (isBookingRouteFailure(booking)) return booking.response;

    const started = await startBookingManage(deps, {
      intentId: booking.intentId,
      companyId,
      email,
      networkFingerprint: requestFingerprint(request),
    });
    return brokerJson(
      {
        challengeId: encodeChallengeRef(started.challengeId, email, deps.keyRing),
        retryAfterSeconds: started.retryAfterSeconds,
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
