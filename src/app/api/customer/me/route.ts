/**
 * GET /api/customer/me?handle=<public_handle>
 *
 * Who the signed-in customer is for the company addressed by `handle`:
 * { displayName, maskedEmail, membership: { state } }. Authority is
 * re-resolved on every request from the session row and the live
 * membership state for that company (design I3); the cookie is trusted
 * for nothing beyond its digest lookup. The body carries no id and no
 * clear email (I4).
 */

import type { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  getCustomerIdentityDeps,
  readCustomerProfile,
  readSession,
  resolveMembership,
} from "@/lib/customer-identity";

import {
  IP_LIMITS,
  brokerErrorResponse,
  brokerJson,
  enforceIpLimit,
  notFoundResponse,
  parsePublicHandle,
  resolveCompanyIdByHandle,
  unauthenticatedResponse,
} from "../_lib/broker-request";

const ROUTE = "me";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.me);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const handle = parsePublicHandle(request.nextUrl.searchParams.get("handle"));
    if (handle === null) return notFoundResponse();
    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const session = await readSession(deps, request);
    if (session === null) {
      const response = unauthenticatedResponse();
      // A presented cookie that no longer resolves is dead weight; drop it.
      if (request.cookies.get(SESSION_COOKIE_NAME) !== undefined) {
        clearSessionCookie(response);
      }
      return response;
    }

    const membership = await resolveMembership(deps, session.identityId, companyId);
    const profile = await readCustomerProfile(deps.rpc, {
      identityId: session.identityId,
      companyId,
    });

    return brokerJson(
      {
        displayName: profile.display_name,
        maskedEmail: profile.contact_email_masked,
        membership: { state: membership?.state ?? null },
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
