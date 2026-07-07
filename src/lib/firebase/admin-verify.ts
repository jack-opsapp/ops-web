/**
 * OPS Web - Server-side JWT Verification
 *
 * Verifies auth tokens from both Supabase Auth (iOS app) and Firebase Auth
 * (web dashboard) in API routes using jose.
 *
 * - Supabase JWTs: Asymmetric (RS256/ES256) verified via Supabase JWKS endpoint
 * - Firebase JWTs: RS256 signed, verified via Google's public JWKS
 *
 * NEVER import this from client-side code.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";

// Cache the JWKS fetchers — they handle key rotation automatically
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

// Supabase JWKS — uses the project's public key endpoint
function getSupabaseJWKS() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
  }
  return createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
  );
}

// Lazy-initialized cached instance
let _supabaseJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
function supabaseJWKS() {
  if (!_supabaseJWKS) {
    _supabaseJWKS = getSupabaseJWKS();
  }
  return _supabaseJWKS;
}

export interface VerifiedUser {
  uid: string;
  email?: string;
  claims: JWTPayload;
}

// Keep backward-compatible alias
export type VerifiedFirebaseUser = VerifiedUser;

/**
 * True when a verified token was issued by Firebase (vs Supabase Auth).
 * `users.firebase_uid` must only ever hold Firebase UIDs, so every write to
 * that column is gated on this check — a Supabase-issued token's `sub` is a
 * Supabase auth UUID and would poison the column.
 */
export function isFirebaseIssuedToken(claims: JWTPayload): boolean {
  return (
    typeof claims.iss === "string" &&
    claims.iss.startsWith("https://securetoken.google.com/")
  );
}

/**
 * Verify a Supabase Auth JWT (asymmetric, verified via Supabase JWKS endpoint).
 * Throws if the token is invalid, expired, or signature doesn't match.
 */
export async function verifySupabaseToken(
  token: string
): Promise<VerifiedUser> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
  }

  const issuer = `${supabaseUrl}/auth/v1`;

  const { payload } = await jwtVerify(token, supabaseJWKS(), {
    issuer,
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
 * Verify an auth token — tries Supabase first (iOS app), then Firebase (web).
 * Throws if neither verification succeeds.
 */
export async function verifyAuthToken(
  token: string
): Promise<VerifiedUser> {
  let supabaseError: unknown;
  let firebaseError: unknown;

  // Try Supabase JWT first (primary auth for iOS app)
  try {
    return await verifySupabaseToken(token);
  } catch (err) {
    supabaseError = err;
  }

  // Try Firebase JWT (web dashboard auth)
  try {
    return await verifyFirebaseToken(token);
  } catch (err) {
    firebaseError = err;
  }

  // Both failed — log the verifier errors for debugging. LOW-2: do not log any
  // portion of the token itself (even a prefix), only the failure reasons.
  console.error("[verifyAuthToken] Both verification methods failed:", {
    supabase: supabaseError instanceof Error ? supabaseError.message : String(supabaseError),
    firebase: firebaseError instanceof Error ? firebaseError.message : String(firebaseError),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });

  throw firebaseError;
}

/**
 * Extract and verify an auth token from a Next.js request.
 * Checks Authorization header, then cookie fallbacks.
 * Supports both Supabase (iOS) and Firebase (web) tokens.
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
