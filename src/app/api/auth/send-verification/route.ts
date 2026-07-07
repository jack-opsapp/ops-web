/**
 * POST /api/auth/send-verification
 *
 * Sends an OPS-branded Firebase email-verification message (CRIT-3 Phase B).
 *
 * OPS historically never sent Firebase email verification, so `email_verified`
 * was permanently false for every email/password account — which is why the
 * identity model could not safely trust the email claim. This route wires the
 * previously-dormant verification stack: it generates a Firebase verification
 * action link with the Admin SDK (no send), routes it through OUR
 * `/auth/action?mode=verifyEmail` handler (VerifyFlow → applyActionCode), and
 * sends it via the OPS-branded SendGrid template. Rebuilding the URL from the
 * oobCode makes delivery independent of the Firebase console's configured
 * action-handler domain.
 *
 * Soft UX: callers invoke this best-effort after signup; the user is never
 * gated on verification or on email deliverability.
 *
 * Body: { token }  — a verified Firebase ID token (sub == firebase_uid).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getAdminAuth } from "@/lib/firebase/admin";
import { sendEmailVerification } from "@/lib/email/sendgrid";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

interface SendVerificationBody {
  token: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { token } = (await req.json()) as SendVerificationBody;
    if (!token) {
      return NextResponse.json(
        { error: "Missing required field: token" },
        { status: 400 }
      );
    }

    const user = await verifyAuthToken(token);
    if (!user.email) {
      return NextResponse.json(
        { error: "Token has no email claim" },
        { status: 400 }
      );
    }

    // Already verified — nothing to send.
    if (user.claims.email_verified === true) {
      return NextResponse.json({ sent: false, alreadyVerified: true });
    }

    // Generate the Firebase verification action link (does not send), then
    // route it through our branded handler so the OPS SendGrid template is used
    // instead of Firebase's default message.
    const generated = await getAdminAuth().generateEmailVerificationLink(user.email, {
      url: `${APP_URL}/auth/action`,
    });
    const oobCode = new URL(generated).searchParams.get("oobCode");
    if (!oobCode) {
      return NextResponse.json(
        { error: "Failed to generate verification link" },
        { status: 500 }
      );
    }
    const verifyLink = `${APP_URL}/auth/action?mode=verifyEmail&oobCode=${encodeURIComponent(oobCode)}`;

    await sendEmailVerification({ email: user.email, verifyLink });

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("[api/auth/send-verification] Error:", error);

    const msg = error instanceof Error ? error.message : "";
    if (
      msg.includes("Token") ||
      msg.includes("iss") ||
      msg.includes("exp") ||
      msg.includes("aud") ||
      msg.includes("JWK") ||
      msg.includes("signature") ||
      msg.includes("verification")
    ) {
      return NextResponse.json(
        { error: "Authentication failed. Please try signing in again." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
