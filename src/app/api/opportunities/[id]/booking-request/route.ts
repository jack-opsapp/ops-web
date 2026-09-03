/**
 * GET /api/opportunities/[id]/booking-request
 *
 * The public booking request this lead is waiting on, or null (PUBLIC API
 * P2-4, design §8). Read gate: `pipeline.edit` — the same authority that
 * decides the request — and the lead must belong to the caller's company.
 *
 * 503 `booking_request_unavailable` when the store cannot answer, including
 * before the P2-1 migration lands, so the lead surface stays quiet instead of
 * claiming there is nothing pending.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authorizeBookingRequest,
  bookingRequestUnavailable,
  readPendingBookingRequest,
} from "@/lib/booking/requests-server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await params;

  const authorization = await authorizeBookingRequest(request, opportunityId);
  if (!authorization.ok) return authorization.response;

  try {
    const pending = await readPendingBookingRequest(authorization.actor);
    return NextResponse.json({ request: pending });
  } catch {
    return bookingRequestUnavailable();
  }
}
