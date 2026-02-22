/**
 * OPS Web - Gmail OAuth Callback
 *
 * GET /api/integrations/gmail/callback?code=...&state=companyId
 * Exchanges auth code for tokens, stores in gmail_connections table.
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

    // Get user email from the access token
    let gmailEmail = "";
    try {
      const userInfoResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        gmailEmail = userInfo.email || "";
      }
    } catch {
      // Non-critical — email is nice to have
    }

    // Store tokens in gmail_connections table
    const supabase = getServiceRoleClient();
    const { error: upsertError } = await supabase
      .from("gmail_connections")
      .upsert(
        {
          company_id: companyId,
          email: gmailEmail,
          access_token: tokens.access_token || "",
          refresh_token: tokens.refresh_token || "",
          expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
          sync_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,email" }
      );

    if (upsertError) {
      console.error("Failed to store Gmail tokens:", upsertError.message);
      return NextResponse.redirect(
        `${BASE_URL}/settings?tab=integrations&status=error&message=storage_failed`
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
