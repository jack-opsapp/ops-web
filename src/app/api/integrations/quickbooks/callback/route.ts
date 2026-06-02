/**
 * OPS Web - QuickBooks OAuth Callback
 *
 * GET /api/integrations/quickbooks/callback?code=...&state=...&realmId=...
 * Exchanges auth code for tokens, stores in accounting_connections.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  getQuickBooksConfig,
  type QuickBooksConfig,
} from "@/lib/api/services/quickbooks-config";

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
      `${getAppUrl()}/accounting?status=error&message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      `${getAppUrl()}/accounting?status=error&message=missing_params`
    );
  }

  // Resolve QuickBooks credentials from the single shared config helper. This
  // reads process.env lazily (at request time, not module load) and throws loud
  // on a half-configured environment — so a real production company file can
  // never be connected against missing creds or a silent sandbox fallback.
  let config: QuickBooksConfig;
  try {
    config = getQuickBooksConfig();
  } catch (configError) {
    console.error(
      "QuickBooks not configured:",
      configError instanceof Error ? configError.message : configError
    );
    return NextResponse.redirect(
      `${getAppUrl()}/accounting?status=error&message=not_configured`
    );
  }

  // Parse state: companyId:randomHex
  const colonIdx = state.indexOf(":");
  if (colonIdx < 1) {
    return NextResponse.redirect(
      `${getAppUrl()}/accounting?status=error&message=invalid_state`
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
      `${getAppUrl()}/accounting?status=error&message=csrf_mismatch`
    );
  }

  try {
    // Exchange authorization code for tokens
    const basicAuth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
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
        redirect_uri: config.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("QB token exchange failed:", errorData);
      return NextResponse.redirect(
        `${getAppUrl()}/accounting?status=error&message=token_exchange_failed`
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
        sync_enabled: false, // read-only validation phase: no auto-sync
        sync_direction: "pull_only", // hard read-only mode (contract §6.3)
        webhook_verifier_token: null, // Clear CSRF token
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "quickbooks");

    if (upsertError) {
      console.error("Failed to store QB tokens:", upsertError.message);
      return NextResponse.redirect(
        `${getAppUrl()}/accounting?status=error&message=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${getAppUrl()}/accounting?connected=quickbooks`
    );
  } catch (err) {
    console.error("QuickBooks OAuth callback error:", err);
    return NextResponse.redirect(
      `${getAppUrl()}/accounting?status=error&message=unexpected_error`
    );
  }
}
