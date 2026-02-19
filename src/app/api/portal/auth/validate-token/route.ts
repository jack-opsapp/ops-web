/**
 * GET /api/portal/auth/validate-token?token=...
 *
 * Checks if a magic link token is still valid (exists, not expired, not revoked).
 * Used by the landing page before showing the email verification form.
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const portalToken = await PortalAuthService.getTokenByValue(token);

    if (!portalToken) {
      return NextResponse.json({ valid: false, reason: "not_found" });
    }

    if (portalToken.revokedAt) {
      return NextResponse.json({ valid: false, reason: "revoked" });
    }

    if (new Date() > portalToken.expiresAt) {
      return NextResponse.json({ valid: false, reason: "expired" });
    }

    return NextResponse.json({
      valid: true,
      companyId: portalToken.companyId,
    });
  } catch (error) {
    console.error("[portal/auth/validate-token] Error:", error);
    return NextResponse.json(
      { error: "Failed to validate token" },
      { status: 500 }
    );
  }
}
