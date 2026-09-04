/**
 * POST /api/opportunities/[id]/booking-request/accept
 *
 * Staff acceptance of a public booking request (PUBLIC API P2-4, design §8,
 * I14). This is the call that actually books the visit — nothing was on any
 * calendar before it. `scheduledAt` is optional: absent keeps the time the
 * customer asked for, present moves it.
 *
 * Gate: `pipeline.edit` plus the lead's own company; the request id must be
 * the one this lead is waiting on, and the RPC re-checks the operator's
 * authority on the lead before booking anything.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  acceptBookingRequest,
  authorizeBookingRequest,
  bookingRequestFailure,
  bookingRequestUnavailable,
  leadIsWaitingOn,
  parseDecisionBody,
} from "@/lib/booking/requests-server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await params;

  const authorization = await authorizeBookingRequest(request, opportunityId);
  if (!authorization.ok) return authorization.response;

  const body = await request.json().catch(() => null);
  const decision = parseDecisionBody(body, true);
  if (!decision.ok) return decision.response;

  let waiting: boolean;
  try {
    waiting = await leadIsWaitingOn(authorization.actor, decision.requestId);
  } catch {
    return bookingRequestUnavailable();
  }
  if (!waiting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const booked = await acceptBookingRequest(authorization.actor, {
      requestId: decision.requestId,
      scheduledAt: decision.scheduledAt,
    });
    return NextResponse.json({ scheduledAt: booked.scheduledAt });
  } catch (error) {
    return bookingRequestFailure(error);
  }
}
