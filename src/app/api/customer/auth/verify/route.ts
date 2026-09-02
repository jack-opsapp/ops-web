/**
 * POST /api/customer/auth/verify
 *
 * Body: { handle, challengeId, code, email }. Checks the six-digit code
 * against the customer auth project (the broker owns attempt accounting,
 * I8), mints the broker's opaque session and sets it as the only credential
 * that ever leaves (I6, I9), resolves membership for the handle's company
 * (design §5.1 step 3), and answers { ok: true, next } — never an id (I4).
 *
 * The email is required because the code is bound to it at the provider;
 * the broker holds only a keyed digest and cannot recover it.
 */

import type { NextRequest, NextResponse } from "next/server";

import {
  CustomerIdentityError,
  getCustomerIdentityDeps,
  normalizeEmail,
  resolveMembership,
  setSessionCookie,
  verifyOtp,
} from "@/lib/customer-identity";

import {
  IP_LIMITS,
  brokerErrorResponse,
  brokerJson,
  customerHomePath,
  decodeChallengeRef,
  enforceIpLimit,
  invalidRequestResponse,
  notFoundResponse,
  parsePublicHandle,
  readJsonObject,
  requestFingerprint,
  resolveCompanyIdByHandle,
} from "../../_lib/broker-request";

const ROUTE = "auth-verify";
const CODE_PATTERN = /^[0-9]{6}$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.authVerify);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const body = await readJsonObject(request);
    if (body === null) return invalidRequestResponse();
    const handle = parsePublicHandle(body.handle);
    if (handle === null) return notFoundResponse();
    const challengeId = decodeChallengeRef(body.challengeId);
    if (challengeId === null) return invalidRequestResponse();
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (email === null) return invalidRequestResponse();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!CODE_PATTERN.test(code)) return invalidRequestResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const result = await verifyOtp(deps, {
      challengeId,
      email,
      code,
      networkFingerprint: requestFingerprint(request),
    });
    if (!result.ok) {
      switch (result.reason) {
        case "invalid_code":
          return brokerJson(
            { error: "invalid_code", attemptsRemaining: result.attemptsRemaining },
            400
          );
        case "challenge_exhausted":
          return brokerJson({ error: "challenge_exhausted" }, 400);
        case "challenge_closed":
          return brokerJson({ error: "challenge_closed" }, 400);
      }
    }

    // Identity and session are real at this point. Membership resolution is
    // idempotent and re-run by every hosted request (I3), so a transient
    // store failure here defers to the next request instead of stranding a
    // customer whose code was already consumed.
    try {
      await resolveMembership(deps, result.identityId, companyId);
    } catch (error) {
      console.error("[customer-api] membership resolution deferred to next request", {
        route: ROUTE,
        code: error instanceof CustomerIdentityError ? error.code : "unknown",
      });
    }

    const response = brokerJson({ ok: true, next: customerHomePath(handle) }, 200);
    setSessionCookie(response, result.credential);
    return response;
  } catch (error) {
    return brokerErrorResponse(error, ROUTE);
  }
}
