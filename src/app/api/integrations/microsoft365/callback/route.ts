/**
 * OPS Web - Microsoft 365 OAuth Callback
 *
 * GET /api/integrations/microsoft365/callback?code=...&state=...
 * Exchanges auth code for tokens, stores in email_connections table.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle user denial
  if (error) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=missing_params`
    );
  }

  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=not_configured`
    );
  }

  try {
    const { companyId, userId, type } = JSON.parse(
      Buffer.from(stateParam, "base64").toString()
    );

    // Exchange authorization code for tokens
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          code,
          redirect_uri: `${getAppUrl()}/api/integrations/microsoft365/callback`,
          grant_type: "authorization_code",
          // Full mail access — must match the scope requested in
          // microsoft365/route.ts so the exchange succeeds without
          // prompting the user for additional consent.
          scope: "Mail.Read Mail.ReadWrite Mail.Send offline_access",
        }),
      }
    );

    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error("[M365 OAuth] Token exchange failed:", tokenRes.status, errorData);
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=token_exchange_failed`
      );
    }

    const tokens = await tokenRes.json();

    // Get user profile to get email address
    let email = "";
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        email = profile.mail || profile.userPrincipalName || "";
      }
    } catch {
      // Non-critical — email is nice to have
    }

    // Store in email_connections table
    const supabase = getServiceRoleClient();
    const { error: insertError } = await supabase
      .from("email_connections")
      .insert({
        company_id: companyId,
        provider: "microsoft365",
        type: type || "individual",
        user_id: userId || null,
        email,
        access_token: tokens.access_token || "",
        refresh_token: tokens.refresh_token || "",
        expires_at: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
        sync_enabled: true,
        sync_interval_minutes: 60,
        status: "setup_incomplete",
      });

    if (insertError) {
      console.error("[M365 OAuth] Failed to store tokens:", insertError.message);
      return NextResponse.redirect(
        `${getAppUrl()}/settings?tab=integrations&status=error&message=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=connected&provider=microsoft365&firstConnect=true`
    );
  } catch (err) {
    console.error("[M365 OAuth] Callback error:", err);
    return NextResponse.redirect(
      `${getAppUrl()}/settings?tab=integrations&status=error&message=unexpected_error`
    );
  }
}
