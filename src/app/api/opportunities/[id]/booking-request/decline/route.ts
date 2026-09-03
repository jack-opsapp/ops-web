/**
 * POST /api/opportunities/[id]/booking-request/decline
 *
 * Staff turning a public booking request down (PUBLIC API P2-4, design §8).
 * Books nothing and sends the customer nothing — the lead stays in the
 * pipeline with the request recorded, to be worked like any other (I16).
 *
 * Gate: `pipeline.edit` plus the lead's own company; the request id must be
 * the one this lead is waiting on.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authorizeBookingRequest,
  bookingRequestFailure,
  bookingRequestUnavailable,
  declineBookingRequest,
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
  const decision = parseDecisionBody(body, false);
  if (!decision.ok) return decision.response;

  let waiting: boolean;
  try {
    waiting = await leadIsWaitingOn(authorization.actor, decision.requestId);
  } catch {
    return bookingRequestUnavailable();
  }
  if (!waiting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await declineBookingRequest(authorization.actor, { requestId: decision.requestId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return bookingRequestFailure(error);
  }
}
