/**
 * POST /api/customer/auth/verify
 *
 * Body: { handle, challengeId, code, email }. Checks the six-digit code
 * against the customer auth project (the broker owns attempt accounting,
 * I8), mints the broker's opaque session and sets it as the only credential
 * that ever leaves (I6, I9), links membership for the handle's company
 * (design §5.1 step 3), and answers { ok: true, next } — never an id (I4).
 *
 * The email is required because the code is bound to it at the provider;
 * the broker holds only a keyed digest and cannot recover it. Before any
 * code is proxied the route proves the supplied email is the one the
 * challenge was begun for (the ref carries a keyed tag over both — ruled
 * 2026-09-02): a mismatch is charged as an attempt, never reaches the
 * provider, and answers exactly like a wrong code (I5).
 */

import type { NextRequest, NextResponse } from "next/server";

import {
  CustomerIdentityError,
  OTP_MAX_ATTEMPTS,
  appendIdentityEvent,
  getCustomerIdentityDeps,
  linkMembership,
  normalizeEmail,
  setSessionCookie,
  verifyOtp,
  type CustomerIdentityDeps,
} from "@/lib/customer-identity";
import { recordOtpAttempt } from "@/lib/customer-identity/rpc";

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

/**
 * The ref was not minted for this email. Charge the attempt against the
 * challenge it names (so a leaked ref burns out like any other guessing),
 * skip the provider entirely, and answer as a wrong code would — the same
 * body, the same accounting — so nothing distinguishes the two.
 */
async function refuseUnboundEmail(
  deps: CustomerIdentityDeps,
  challengeId: string,
  fingerprint: string
): Promise<NextResponse> {
  const attempt = await recordOtpAttempt(deps.rpc, { challengeId, success: false });
  await appendIdentityEvent(deps.rpc, {
    eventType: "otp_failed",
    identityId: null,
    companyId: null,
    sessionId: null,
    networkFingerprint: fingerprint,
    metadata: {
      stage: "verify",
      binding: "mismatch",
      attempts: attempt === null ? null : attempt.attempts,
    },
  });
  if (attempt === null) return brokerJson({ error: "challenge_closed" }, 400);
  if (attempt.exhausted || attempt.attempts > OTP_MAX_ATTEMPTS) {
    return brokerJson({ error: "challenge_exhausted" }, 400);
  }
  return brokerJson(
    {
      error: "invalid_code",
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - attempt.attempts),
    },
    400
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceIpLimit(request, IP_LIMITS.authVerify);
  if (limited) return limited;

  try {
    const deps = getCustomerIdentityDeps();

    const body = await readJsonObject(request);
    if (body === null) return invalidRequestResponse();
    const handle = parsePublicHandle(body.handle);
    if (handle === null) return notFoundResponse();
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (email === null) return invalidRequestResponse();
    const ref = decodeChallengeRef(body.challengeId, email, deps.keyRing);
    if (!ref.ok && ref.reason === "malformed") return invalidRequestResponse();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!CODE_PATTERN.test(code)) return invalidRequestResponse();

    const companyId = await resolveCompanyIdByHandle(handle);
    if (companyId === null) return notFoundResponse();

    const fingerprint = requestFingerprint(request);
    if (!ref.ok) {
      return refuseUnboundEmail(deps, ref.challengeId, fingerprint);
    }

    const result = await verifyOtp(deps, {
      challengeId: ref.challengeId,
      email,
      code,
      networkFingerprint: fingerprint,
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

    // Identity and session are real at this point. Linking is idempotent and
    // re-attempted on the next sign-in, so a transient store failure here
    // defers instead of stranding a customer whose code was already consumed.
    //
    // Linking establishes a membership only against a client this company
    // already has on file (I18). An email the company has never seen leaves it
    // with nothing to link, and the hosted home says so plainly — signing in
    // is not the moment a business gains a customer record.
    try {
      await linkMembership(deps, result.identityId, companyId);
    } catch (error) {
      console.error("[customer-api] membership link deferred to the next sign-in", {
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
