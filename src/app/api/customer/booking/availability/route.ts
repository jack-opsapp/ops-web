/**
 * GET /api/customer/booking/availability?handle&from&to
 *
 * The times a business is offering, expanded from the windows its owner set
 * and already net of notice, horizon, existing bookings, live holds and the
 * per-day cap (design D10). Each time is paired with an opaque, signed
 * proposal the page hands back to hold it; the proposal carries no client, no
 * lead and no crew, and a valid signature never means the time is still free
 * (I11, I12).
 *
 * A company that has not turned booking on has no surface here — the same 404
 * an unknown handle gets, because there is nothing to render either way.
 */

import type { NextRequest, NextResponse } from "next/server";

import { getCustomerIdentityDeps } from "@/lib/customer-identity";
import { readBookingAvailability } from "@/lib/customer-identity/booking-broker";
import { encodeSlotDescriptor } from "@/lib/customer-identity/booking-refs";

import {
  IP_LIMITS,
  brokerErrorResponse,
  brokerJson,
  enforceIpLimit,
  invalidRequestResponse,
  notFoundResponse,
  parsePublicHandle,
  resolveCompanyIdByHandle,
} from "../../_lib/broker-request";
import { parseAvailabilityRange } from "../_lib/booking-request";

const ROUTE = "booking-availability";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.bookingAvailability);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const handle = parsePublicHandle(request.nextUrl.searchParams.get("handle"));
    if (handle === null) return notFoundResponse();
    const range = parseAvailabilityRange(request);
    if (range === null) return invalidRequestResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const availability = await readBookingAvailability(deps, {
      companyId,
      from: range.from,
      to: range.to,
    });
    if (availability === null) return notFoundResponse();

    return brokerJson(
      {
        mode: availability.mode,
        timezone: availability.timezone,
        durationMinutes: availability.durationMinutes,
        slots: availability.slots.map((slotStartAt) => ({
          startAt: slotStartAt.toISOString(),
          ref: encodeSlotDescriptor(companyId, slotStartAt, deps.keyRing),
        })),
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
