/**
 * POST /api/customer/auth/start
 *
 * Body: { handle, email }. Begins an email OTP challenge for the hosted
 * surface of the company addressed by `handle` and answers
 * { challengeId, retryAfterSeconds } — identically for a known, unknown or
 * refused email (design §5.1, I5). The challenge id leaves as an opaque ref
 * bound to the email it was begun for, never a row id (I4). Per-IP limited
 * on top of the broker's own send limits (I8); every refusal happens before
 * the customer auth project is contacted.
 */

import type { NextRequest, NextResponse } from "next/server";

import {
  getCustomerIdentityDeps,
  normalizeEmail,
  startOtp,
} from "@/lib/customer-identity";

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

const ROUTE = "auth-start";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.authStart);
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

    const result = await startOtp(deps, {
      email,
      networkFingerprint: requestFingerprint(request),
    });
    return brokerJson(
      {
        challengeId: encodeChallengeRef(result.challengeId, email, deps.keyRing),
        retryAfterSeconds: result.retryAfterSeconds,
      },
      200
    );
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
