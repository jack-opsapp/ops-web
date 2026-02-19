/**
 * OPS Web - Gmail OAuth Callback
 *
 * GET /api/integrations/gmail/callback?code=...&state=companyId
 * Exchanges auth code for tokens, stores refresh token on Company via Bubble workflow.
 */

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
const BUBBLE_API_URL = process.env.NEXT_PUBLIC_BUBBLE_API_URL ?? "https://opsapp.co/version-test/api/1.1";
const BUBBLE_API_TOKEN = process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN ?? "";

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

    // Store the refresh token on the Company via Bubble workflow
    await fetch(`${BUBBLE_API_URL}/wf/store_gmail_tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BUBBLE_API_TOKEN}`,
      },
      body: JSON.stringify({
        company_id: companyId,
        gmail_refresh_token: refreshToken,
        gmail_connected: true,
      }),
    });

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
