/**
 * OPS Web - Sage Accounting OAuth Callback
 *
 * GET /api/integrations/sage/callback?code=...&state=...
 * Exchanges auth code for tokens, stores in accounting_connections.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID;
const SAGE_CLIENT_SECRET = process.env.SAGE_CLIENT_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
const SAGE_REDIRECT_URI =
  process.env.SAGE_REDIRECT_URI ?? `${BASE_URL}/api/integrations/sage/callback`;

const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle user denial
  if (error) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=missing_params`
    );
  }

  if (!SAGE_CLIENT_ID || !SAGE_CLIENT_SECRET) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=not_configured`
    );
  }

  // Parse state: companyId:randomHex
  const colonIdx = state.indexOf(":");
  if (colonIdx < 1) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=invalid_state`
    );
  }
  const companyId = state.substring(0, colonIdx);

  const supabase = getServiceRoleClient();

  // CSRF check: verify state token matches what we stored
  const { data: existing } = await supabase
    .from("accounting_connections")
    .select("webhook_verifier_token")
    .eq("company_id", companyId)
    .eq("provider", "sage")
    .single();

  if (!existing || existing.webhook_verifier_token !== state) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=csrf_mismatch`
    );
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch(SAGE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SAGE_REDIRECT_URI,
        client_id: SAGE_CLIENT_ID,
        client_secret: SAGE_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Sage token exchange failed:", errorData);
      return NextResponse.redirect(
        `${BASE_URL}/accounting?status=error&message=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    // Sage access tokens expire after 5 minutes (300s)
    const expiresIn = tokens.expires_in || 300;

    // Store tokens in accounting_connections
    const { error: upsertError } = await supabase
      .from("accounting_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(
          Date.now() + expiresIn * 1000
        ).toISOString(),
        is_connected: true,
        sync_enabled: true,
        webhook_verifier_token: null, // Clear CSRF token
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "sage");

    if (upsertError) {
      console.error("Failed to store Sage tokens:", upsertError.message);
      return NextResponse.redirect(
        `${BASE_URL}/accounting?status=error&message=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${BASE_URL}/accounting?connected=sage`
    );
  } catch (err) {
    console.error("Sage OAuth callback error:", err);
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=unexpected_error`
    );
  }
}
