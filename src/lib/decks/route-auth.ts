/**
 * Shared auth resolution for the Deckset (/api/decks/*) routes.
 *
 * The standalone Deckset iOS app authenticates every call with a bearer
 * Firebase ID token. Routes need one of two levels:
 *
 *  - verifyDecksRequestAuth — token verification only. Used by provisioning,
 *    where the user row may not exist yet.
 *  - resolveDecksCompanyAuth — token verification + users-row lookup +
 *    company scope. Used by every company-scoped route.
 *
 * Two error envelopes exist historically: the checkout route ships
 * `{ code, message }` and the zoning route shipped `{ error }` before this
 * module existed. The Deckset app is already in the field parsing both, so
 * the envelope is preserved per route via `errorShape` instead of being
 * unified under one contract.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export interface DecksVerifiedAuth {
  uid: string;
  email?: string;
  /**
   * True only when the identity provider attests the email (Firebase
   * `email_verified` claim). Callers that WRITE identity linkage off an
   * email match must require this — an unverified email is attacker-chosen.
   */
  emailVerified: boolean;
}

export interface DecksCompanyAuth {
  uid: string;
  email?: string;
  emailVerified: boolean;
  userId: string;
  companyId: string;
}

export interface DecksAuthOptions {
  /** Log prefix, e.g. "[decks/checkout]". */
  logTag: string;
  /** Message returned when the user/company lookup itself fails (503). */
  unavailableMessage: string;
  /** Error envelope: "code" → { code, message }, "legacy" → { error }. */
  errorShape: "code" | "legacy";
}

function errorResponse(
  opts: DecksAuthOptions,
  status: number,
  code: string,
  message: string
): NextResponse {
  const body =
    opts.errorShape === "code" ? { code, message } : { error: message };
  return NextResponse.json(body, { status });
}

function isEmailVerified(claims: Record<string, unknown>): boolean {
  return claims.email_verified === true;
}

/**
 * Verify the request's bearer token. Returns the verified identity or a
 * ready-to-return error response (401).
 */
export async function verifyDecksRequestAuth(
  req: NextRequest,
  opts: DecksAuthOptions
): Promise<DecksVerifiedAuth | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return errorResponse(
      opts,
      401,
      "unauthorized",
      "Missing Authorization bearer token"
    );
  }

  let verified: Awaited<ReturnType<typeof verifyAuthToken>>;
  try {
    verified = await verifyAuthToken(idToken);
  } catch {
    return errorResponse(opts, 401, "unauthorized", "Invalid auth token");
  }

  return {
    uid: verified.uid,
    email: verified.email,
    emailVerified: isEmailVerified(verified.claims),
  };
}

/**
 * Verify the bearer token AND resolve the caller's users row + company
 * scope. Returns the full auth context or a ready-to-return error response
 * (401 invalid token, 403 no company, 503 lookup failure).
 */
export async function resolveDecksCompanyAuth(
  req: NextRequest,
  opts: DecksAuthOptions
): Promise<DecksCompanyAuth | NextResponse> {
  const verified = await verifyDecksRequestAuth(req, opts);
  if (verified instanceof NextResponse) return verified;

  try {
    const user = await findUserByAuth(
      verified.uid,
      verified.email,
      "id, company_id"
    );
    const companyId = user?.company_id;

    if (typeof companyId !== "string" || !companyId) {
      return errorResponse(
        opts,
        403,
        "company_required",
        "User has no company association"
      );
    }

    return {
      uid: verified.uid,
      email: verified.email,
      emailVerified: verified.emailVerified,
      userId: user?.id as string,
      companyId,
    };
  } catch (error) {
    console.error(`${opts.logTag} auth lookup failed`, error);
    return errorResponse(
      opts,
      503,
      "auth_lookup_failed",
      opts.unavailableMessage
    );
  }
}
