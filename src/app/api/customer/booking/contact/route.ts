/**
 * POST /api/customer/booking/contact
 *
 * Body: { handle, intentRef, name, email, phone?, answers? }. Attaches the
 * details to the held intent and starts the same six-digit challenge sign-in
 * uses, bound to that intent (design §6). The phone is stored as evidence and
 * is never verified or matched (I1); the website's own questions ride along
 * bounded.
 *
 * The answer is { challengeId, retryAfterSeconds } whether the hold was live,
 * expired, already used or never existed, and whether the send limits allowed
 * a code or refused one — a refusal simply names a challenge that will never
 * resolve (I5, I8).
 */

import type { NextRequest, NextResponse } from "next/server";

import { getCustomerIdentityDeps } from "@/lib/customer-identity";
import {
  parseBookingContact,
  startBookingContact,
} from "@/lib/customer-identity/booking-broker";

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
} from "../../_lib/broker-request";
import { isBookingRouteFailure, readIntentRef } from "../_lib/booking-request";

const ROUTE = "booking-contact";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.bookingContact);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const body = await readJsonObject(request);
    if (body === null) return invalidRequestResponse();
    const handle = parsePublicHandle(body.handle);
    if (handle === null) return notFoundResponse();
    const contact = parseBookingContact(body);
    if (contact === null) return invalidRequestResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const intent = readIntentRef(body.intentRef, companyId, deps.keyRing);
    if (isBookingRouteFailure(intent)) return intent.response;

    const started = await startBookingContact(deps, {
      intentId: intent.intentId,
      companyId,
      contact,
      networkFingerprint: requestFingerprint(request),
    });
    return brokerJson(
      {
        challengeId: encodeChallengeRef(started.challengeId, contact.email, deps.keyRing),
        retryAfterSeconds: started.retryAfterSeconds,
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
