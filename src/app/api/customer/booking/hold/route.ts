/**
 * POST /api/customer/booking/hold
 *
 * Body: { handle, slot }. Turns a signed proposal into a bounded hold and
 * answers { intentRef, holdExpiresAt } — an opaque ref and an honest expiry,
 * never a row id (I4). The signature is checked here only to prove OPS offered
 * the time; whether it is still free is the database's answer, under the caps
 * that stop a hold from starving a calendar (I12, I13).
 */

import type { NextRequest, NextResponse } from "next/server";

import { getCustomerIdentityDeps } from "@/lib/customer-identity";
import { holdSlot } from "@/lib/customer-identity/booking-broker";
import { encodeIntentRef } from "@/lib/customer-identity/booking-refs";

import {
  IP_LIMITS,
  brokerErrorResponse,
  brokerJson,
  enforceIpLimit,
  invalidRequestResponse,
  notFoundResponse,
  parsePublicHandle,
  rateLimitedResponse,
  readJsonObject,
  requestFingerprint,
  resolveCompanyIdByHandle,
  slotGoneResponse,
} from "../../_lib/broker-request";
import { isBookingRouteFailure, readSlotDescriptor } from "../_lib/booking-request";

const ROUTE = "booking-hold";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.bookingHold);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const body = await readJsonObject(request);
    if (body === null) return invalidRequestResponse();
    const handle = parsePublicHandle(body.handle);
    if (handle === null) return notFoundResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const slot = readSlotDescriptor(body.slot, companyId, deps.keyRing);
    if (isBookingRouteFailure(slot)) return slot.response;

    const held = await holdSlot(deps, {
      companyId,
      slotStartAt: slot.slotStartAt,
      networkFingerprint: requestFingerprint(request),
    });
    if (!held.ok) {
      return held.reason === "rate_limited"
        ? rateLimitedResponse(held.retryAfterSeconds)
        : slotGoneResponse();
    }

    return brokerJson(
      {
        intentRef: encodeIntentRef(held.intentId, companyId, deps.keyRing),
        holdExpiresAt: held.holdExpiresAt,
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
