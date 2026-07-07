/**
 * OPS Web - Server-side JWT Verification
 *
 * Verifies Firebase ID tokens in API routes using jose. OPS authenticates
 * every client — the web dashboard AND the iOS apps — with Firebase Auth;
 * Supabase is only the database (the Firebase JWT is bridged to Postgres via
 * Supabase third-party auth). No caller presents a Supabase-issued auth token,
 * so this module verifies against Google's Firebase JWKS only.
 *
 * - Firebase JWTs: RS256 signed, verified via Google's public JWKS
 *
 * NEVER import this from client-side code.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";

// Cache the JWKS fetcher — it handles key rotation automatically
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

export interface VerifiedUser {
  uid: string;
  email?: string;
  claims: JWTPayload;
}

// Keep backward-compatible alias
export type VerifiedFirebaseUser = VerifiedUser;

/**
 * True when a verified token was issued by Firebase.
 *
 * `verifyAuthToken` only accepts Firebase-issued tokens, so for any token that
 * reached the app this is now always true. It is kept as a defense-in-depth
 * invariant guarding writes to `users.firebase_uid` (which must only ever hold
 * Firebase UIDs): if a non-Firebase issuer is ever reintroduced, this stops
 * that token's `sub` (which would not be a Firebase UID) from poisoning the
 * column.
 */
export function isFirebaseIssuedToken(claims: JWTPayload): boolean {
  return (
    typeof claims.iss === "string" &&
    claims.iss.startsWith("https://securetoken.google.com/")
  );
}

/**
 * Verify a Firebase ID token (RS256 signed, verified via Google JWKS).
 * Throws if the token is invalid, expired, or signature doesn't match.
 */
export async function verifyFirebaseToken(
  token: string
): Promise<VerifiedUser> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID not configured");
  }

  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  if (!payload.sub) {
    throw new Error("Token missing subject (uid)");
  }

  return {
    uid: payload.sub,
    email: payload.email as string | undefined,
    claims: payload,
  };
}

/**
 * Verify an auth token. OPS is Firebase-only (web + iOS), so this verifies the
 * Firebase ID token. Throws if verification fails.
 */
export async function verifyAuthToken(token: string): Promise<VerifiedUser> {
  try {
    return await verifyFirebaseToken(token);
  } catch (err) {
    // LOW-2: log only the failure reason, never any portion of the token.
    console.error("[verifyAuthToken] Firebase token verification failed:", {
      reason: err instanceof Error ? err.message : String(err),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
    throw err;
  }
}

/**
 * Extract and verify an auth token from a Next.js request.
 * Checks Authorization header, then cookie fallbacks.
 * Returns null if no token present or verification fails.
 */
export async function verifyAdminAuth(
  req: NextRequest
): Promise<VerifiedUser | null> {
  const token =
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    req.cookies.get("ops-auth-token")?.value ||
    req.cookies.get("__session")?.value;

  if (!token) return null;

  try {
    return await verifyAuthToken(token);
  } catch {
    return null;
  }
}
