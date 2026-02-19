/**
 * OPS Web - Server-side Firebase JWT Verification
 *
 * Verifies Firebase ID tokens in API routes using jose.
 * Uses Google's public JWKS endpoint to validate token signatures.
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

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  claims: JWTPayload;
}

/**
 * Verify a Firebase ID token and return the decoded claims.
 * Throws if the token is invalid, expired, or signature doesn't match.
 */
export async function verifyFirebaseToken(
  token: string
): Promise<VerifiedFirebaseUser> {
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
 * Extract and verify the Firebase auth token from a Next.js request.
 * Checks Authorization header, then cookie fallbacks.
 * Returns null if no token present or verification fails.
 */
export async function verifyAdminAuth(
  req: NextRequest
): Promise<VerifiedFirebaseUser | null> {
  const token =
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    req.cookies.get("ops-auth-token")?.value ||
    req.cookies.get("__session")?.value;

  if (!token) return null;

  try {
    return await verifyFirebaseToken(token);
  } catch {
    return null;
  }
}
