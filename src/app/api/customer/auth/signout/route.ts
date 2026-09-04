/**
 * POST /api/customer/auth/signout
 *
 * Revokes the presented broker session (design I6: revocable per session,
 * every revoke in the identity event log) and clears the cookie. From the
 * visitor's side the outcome is always the same — 204 and no cookie —
 * whether the session was live, expired, already revoked, unknown or
 * malformed. The body is ignored: nothing a caller sends can keep a
 * session alive. The one honest exception is a presented session the
 * broker cannot reach: the cookie stays so the visitor can retry.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  getCustomerIdentityDeps,
  sessionDigest,
  signOut,
} from "@/lib/customer-identity";

import {
  IP_LIMITS,
  brokerErrorResponse,
  enforceIpLimit,
  requestFingerprint,
} from "../../_lib/broker-request";

const ROUTE = "auth-signout";

function signedOut(): NextResponse {
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  clearSessionCookie(response);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.authSignout);
  if (limited) return limited;

  // Nothing presented, or nothing this broker could have minted: there is
  // no row to revoke, so the broker is not consulted at all.
  const presented = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!presented || sessionDigest(presented) === null) return signedOut();

  try {
    const deps = getCustomerIdentityDeps();
    await signOut(deps, request, { networkFingerprint: requestFingerprint(request) });
    return signedOut();
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
