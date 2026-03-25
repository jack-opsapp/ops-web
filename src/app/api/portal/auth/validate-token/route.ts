/**
 * GET /api/portal/auth/validate-token?token=...
 *
 * Checks if a magic link token is still valid (exists, not expired, not revoked).
 * Used by the landing page before showing the email verification form.
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";
import { PortalBrandingService } from "@/lib/api/services/portal-branding-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

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

    // Fetch branding and company name for pre-auth rendering
    const [branding, companyResult] = await Promise.all([
      PortalBrandingService.getBranding(portalToken.companyId),
      getServiceRoleClient()
        .from("companies")
        .select("name")
        .eq("id", portalToken.companyId)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      valid: true,
      companyId: portalToken.companyId,
      isPreview: portalToken.isPreview,
      branding: {
        logoUrl: branding.logoUrl,
        accentColor: branding.accentColor,
        template: branding.template,
        themeMode: branding.themeMode,
        companyName: (companyResult.data?.name as string) ?? "Company",
      },
    });
  } catch (error) {
    console.error("[portal/auth/validate-token] Error:", error);
    return NextResponse.json(
      { error: "Failed to validate token" },
      { status: 500 }
    );
  }
}
