/**
 * OPS Web - QuickBooks OAuth Callback
 *
 * GET /api/integrations/quickbooks/callback?code=...&state=...&realmId=...
 * Exchanges auth code for tokens, stores in accounting_connections.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
const QB_REDIRECT_URI =
  process.env.QB_REDIRECT_URI ?? `${BASE_URL}/api/integrations/quickbooks/callback`;

const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const realmId = searchParams.get("realmId");
  const error = searchParams.get("error");

  // Handle user denial
  if (error) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=missing_params`
    );
  }

  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
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
    .eq("provider", "quickbooks")
    .single();

  if (!existing || existing.webhook_verifier_token !== state) {
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=csrf_mismatch`
    );
  }

  try {
    // Exchange authorization code for tokens
    const basicAuth = Buffer.from(
      `${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`
    ).toString("base64");

    const tokenResponse = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: QB_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("QB token exchange failed:", errorData);
      return NextResponse.redirect(
        `${BASE_URL}/accounting?status=error&message=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    // Store tokens in accounting_connections
    const { error: upsertError } = await supabase
      .from("accounting_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
        realm_id: realmId,
        is_connected: true,
        sync_enabled: true,
        webhook_verifier_token: null, // Clear CSRF token
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "quickbooks");

    if (upsertError) {
      console.error("Failed to store QB tokens:", upsertError.message);
      return NextResponse.redirect(
        `${BASE_URL}/accounting?status=error&message=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${BASE_URL}/accounting?connected=quickbooks`
    );
  } catch (err) {
    console.error("QuickBooks OAuth callback error:", err);
    return NextResponse.redirect(
      `${BASE_URL}/accounting?status=error&message=unexpected_error`
    );
  }
}
