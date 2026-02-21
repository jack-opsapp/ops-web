/**
 * OPS Web - Gmail OAuth Callback
 *
 * GET /api/integrations/gmail/callback?code=...&state=companyId
 * Exchanges auth code for tokens, stores them in Supabase gmail_connections table.
 * Bubble dependency fully removed.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const companyId = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle user denial
  if (error) {
    return NextResponse.redirect(
      `${BASE_URL}/settings?tab=integrations&status=error&message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !companyId) {
    return NextResponse.redirect(
      `${BASE_URL}/settings?tab=integrations&status=error&message=missing_params`
    );
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      `${BASE_URL}/settings?tab=integrations&status=error&message=not_configured`
    );
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${BASE_URL}/api/integrations/gmail/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Token exchange failed:", errorData);
      return NextResponse.redirect(
        `${BASE_URL}/settings?tab=integrations&status=error&message=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();
    const refreshToken = tokens.refresh_token;

    // Fetch Gmail address from Google userinfo endpoint
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = userInfoResponse.ok ? await userInfoResponse.json() : {};
    const gmailEmail = userInfo.email ?? "unknown@gmail.com";

    // Store tokens in Supabase gmail_connections table
    const supabase = getServiceRoleClient();
    const { error: dbError } = await supabase
      .from("gmail_connections")
      .upsert(
        {
          company_id: companyId,
          email: gmailEmail,
          type: "company",
          gmail_refresh_token: refreshToken,
          gmail_access_token: tokens.access_token ?? null,
          token_expiry: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          gmail_auto_log_enabled: true,
        },
        { onConflict: "company_id,email" }
      );

    if (dbError) {
      console.error("Failed to store Gmail tokens in Supabase:", dbError.message);
      return NextResponse.redirect(
        `${BASE_URL}/settings?tab=integrations&status=error&message=db_error`
      );
    }

    return NextResponse.redirect(
      `${BASE_URL}/settings?tab=integrations&status=connected`
    );
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    return NextResponse.redirect(
      `${BASE_URL}/settings?tab=integrations&status=error&message=unexpected_error`
    );
  }
}
