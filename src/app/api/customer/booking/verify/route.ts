/**
 * POST /api/customer/booking/verify
 *
 * Body: { handle, intentRef, challengeId, code, email }. Checks the code at
 * the customer auth project — the broker owns attempt accounting (I8) — and
 * then confirms under the company lock, which is the only step that can say a
 * booking exists (I12). Answers { outcome, bookingRef, scheduledAt,
 * durationMinutes }: `confirmed` when the business books instantly,
 * `submitted` when it holds requests for its own say-so, and nothing on any
 * calendar in that second case (D9, I14).
 *
 * No account is created and no session is set: a guest booking leaves the
 * customer exactly as anonymous as it found them, and a later sign-in with the
 * same verified email claims it (D11).
 *
 * The email is required because the code is bound to it at the provider. As on
 * sign-in, the challenge ref carries a keyed tag over both, so a supplied email
 * that does not match is charged as an attempt, never reaches the provider,
 * and answers exactly like a wrong code (I5).
 */

import type { NextRequest, NextResponse } from "next/server";

import { getCustomerIdentityDeps, normalizeEmail } from "@/lib/customer-identity";
import { verifyBookingContact } from "@/lib/customer-identity/booking-broker";
import { encodeBookingRef } from "@/lib/customer-identity/booking-refs";

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
} from "../../_lib/broker-request";
import {
  bookingRefusalResponse,
  isBookingRouteFailure,
  parseCode,
  readIntentRef,
  refuseUnboundEmail,
} from "../_lib/booking-request";

const ROUTE = "booking-verify";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.bookingVerify);
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

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const intent = readIntentRef(body.intentRef, companyId, deps.keyRing);
    if (isBookingRouteFailure(intent)) return intent.response;

    const fingerprint = requestFingerprint(request);
    if (!ref.ok) {
      return refuseUnboundEmail(deps, ref.challengeId, fingerprint, "verify");
    }

    const result = await verifyBookingContact(deps, {
      intentId: intent.intentId,
      companyId,
      challengeId: ref.challengeId,
      email,
      code,
      networkFingerprint: fingerprint,
    });
    if (!result.ok) {
      return result.reason === "invalid_code"
        ? bookingRefusalResponse("invalid_code", result.attemptsRemaining)
        : bookingRefusalResponse(result.reason);
    }

    return brokerJson(
      {
        outcome: result.outcome,
        bookingRef: encodeBookingRef(intent.intentId, companyId, deps.keyRing),
        scheduledAt: result.scheduledAt,
        durationMinutes: result.durationMinutes,
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
