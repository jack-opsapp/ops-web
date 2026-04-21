/**
 * POST /api/auth/method-hint
 *
 * Returns the Firebase Auth sign-in providers registered for a given email.
 * Used by the iOS app after an email/password sign-in failure to detect when
 * the account is actually registered with Apple or Google and route the user
 * to the correct sign-in method.
 *
 * Body: { email: string }
 *
 * Response: { providers: string[] } — Firebase provider IDs (e.g., "google.com",
 * "apple.com", "password"). Returns an empty array when the user is not found
 * or any lookup error occurs (avoids user-enumeration leakage beyond what the
 * existing `check_user_exists_by_email` RPC already reveals).
 */

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin-sdk";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = body?.email?.trim()?.toLowerCase();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ providers: [] });
    }

    try {
      const user = await getAdminAuth().getUserByEmail(email);
      const providers = user.providerData
        .map((p) => p.providerId)
        .filter((id): id is string => typeof id === "string");
      return NextResponse.json({ providers });
    } catch (error) {
      // User not found or Admin SDK error — return empty to avoid leaking state.
      return NextResponse.json({ providers: [] });
    }
  } catch (error) {
    console.error("[method-hint] Request error:", error);
    return NextResponse.json({ providers: [] });
  }
}
