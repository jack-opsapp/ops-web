/**
 * POST /api/portal/auth/send-link
 *
 * Creates a portal token and sends a magic link email.
 * Called by OPS admin users when sharing portal access.
 *
 * Body: { companyId, clientId, email }
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";
import { PortalBrandingService } from "@/lib/api/services/portal-branding-service";
import { sendMagicLink } from "@/lib/email/sendgrid";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST(req: NextRequest) {
  try {
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

    // Create the token
    const token = await PortalAuthService.createPortalToken(companyId, clientId, email);

    // Get branding for email styling
    const branding = await PortalBrandingService.getBranding(companyId);

    // Get company name if not provided
    let name = companyName;
    if (!name) {
      const supabase = getServiceRoleClient();
      const { data } = await supabase
        .from("portal_branding")
        .select("company_id")
        .eq("company_id", companyId)
        .maybeSingle();
      name = data ? companyId : "Your Company";
    }

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
    console.error("[portal/auth/send-link] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send portal link" },
      { status: 500 }
    );
  }
}
