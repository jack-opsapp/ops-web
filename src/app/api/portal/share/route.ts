/**
 * POST /api/portal/share
 *
 * Admin route that creates a portal token and sends the magic link email.
 * Authenticated via Firebase auth (admin users, not portal session).
 *
 * Body: { companyId, clientId, email, companyName, context? }
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";
import { PortalBrandingService } from "@/lib/api/services/portal-branding-service";
import { sendMagicLink } from "@/lib/email/sendgrid";

export async function POST(req: NextRequest) {
  try {
    // Verify the request has a Firebase auth token (admin user)
    const authHeader = req.headers.get("authorization");
    const cookieToken = req.cookies.get("ops-auth-token")?.value
      || req.cookies.get("__session")?.value;

    if (!authHeader && !cookieToken) {
      return NextResponse.json(
        { error: "Unauthorized - admin authentication required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { companyId, clientId, email, companyName } = body as {
      companyId?: string;
      clientId?: string;
      email?: string;
      companyName?: string;
    };

    if (!companyId || !clientId || !email) {
      return NextResponse.json(
        { error: "Missing required fields: companyId, clientId, email" },
        { status: 400 }
      );
    }

    // Create the portal token
    const token = await PortalAuthService.createPortalToken(
      companyId,
      clientId,
      email
    );

    // Get branding for email styling
    const branding = await PortalBrandingService.getBranding(companyId);

    // Use provided company name or fallback
    const name = companyName || "Your Company";

    // Send the magic link email
    await sendMagicLink({
      email,
      token: token.token,
      companyName: name,
      accentColor: branding.accentColor,
      logoUrl: branding.logoUrl,
    });

    return NextResponse.json({ success: true, tokenId: token.id });
  } catch (error) {
    console.error("[portal/share] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send portal link",
      },
      { status: 500 }
    );
  }
}
