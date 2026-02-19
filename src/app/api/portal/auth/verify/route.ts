/**
 * POST /api/portal/auth/verify
 *
 * Verifies a magic link token + email and creates a portal session.
 * Sets the ops-portal-session cookie on success.
 *
 * Body: { token, email }
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, email } = body as {
      token?: string;
      email?: string;
    };

    if (!token || !email) {
      return NextResponse.json(
        { error: "Missing required fields: token, email" },
        { status: 400 }
      );
    }

    // Validate token + email and create session
    const session = await PortalAuthService.verifyAndCreateSession(token, email);

    // Set session cookie
    const response = NextResponse.json({
      success: true,
      clientId: session.clientId,
      companyId: session.companyId,
    });

    response.cookies.set("ops-portal-session", session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error) {
    console.error("[portal/auth/verify] Error:", error);

    const message = error instanceof Error ? error.message : "Verification failed";
    const status = message.includes("expired") || message.includes("Invalid")
      ? 401
      : message.includes("does not match")
        ? 403
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
