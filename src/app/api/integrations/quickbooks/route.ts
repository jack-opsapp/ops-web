/**
 * OPS Web - QuickBooks OAuth Initiation & Disconnect
 *
 * POST /api/integrations/quickbooks  — Generate Intuit OAuth URL
 * DELETE /api/integrations/quickbooks — Disconnect & revoke tokens
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { decryptToken } from "@/lib/api/services/token-cipher";
import {
  getQuickBooksConfig,
  getQuickBooksConfigForEnvironment,
  getQuickBooksProviderEnvironment,
} from "@/lib/api/services/quickbooks-config";
import crypto from "crypto";

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_REVOKE_URL =
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

// ─── POST: Initiate OAuth ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const config = getQuickBooksConfig();

    // Generate CSRF state token: companyId:providerEnvironment:randomHex.
    // The environment in state makes the callback stable even if the active
    // profile switch changes while the Intuit OAuth window is open.
    const stateToken = `${companyId}:${config.providerEnvironment}:${crypto.randomBytes(16).toString("hex")}`;

    // Store state token temporarily in the connection row for CSRF validation
    const supabase = getServiceRoleClient();
    await supabase.from("accounting_connections").upsert(
      {
        company_id: companyId,
        provider: "quickbooks",
        provider_environment: config.providerEnvironment,
        webhook_verifier_token: stateToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider,provider_environment" }
    );

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      state: stateToken,
    });

    const authUrl = `${INTUIT_AUTH_URL}?${params.toString()}`;

    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error("QuickBooks OAuth initiation error:", err);
    return NextResponse.json(
      { error: "Failed to initiate QuickBooks OAuth" },
      { status: 500 }
    );
  }
}

// ─── DELETE: Disconnect ────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const providerEnvironment = getQuickBooksProviderEnvironment();
    const config = (() => {
      try {
        return getQuickBooksConfigForEnvironment(providerEnvironment);
      } catch {
        return null;
      }
    })();

    // Fetch current connection to revoke token
    const { data: connection } = await supabase
      .from("accounting_connections")
      .select("access_token, refresh_token")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .eq("provider_environment", providerEnvironment)
      .single();

    // Attempt to revoke token at Intuit. The stored value is encrypted at
    // rest — decrypt before sending to the revoke endpoint. Prefer the refresh
    // token (Intuit revokes the whole grant from either token).
    const revokeToken =
      decryptToken(connection?.refresh_token) ??
      decryptToken(connection?.access_token);
    if (revokeToken && config) {
      try {
        await fetch(INTUIT_REVOKE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          },
          body: JSON.stringify({ token: revokeToken }),
        });
      } catch {
        // Non-critical — continue with local disconnect
      }
    }

    // Clear tokens and mark disconnected
    const { error } = await supabase
      .from("accounting_connections")
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        realm_id: null,
        realm_id_lookup: null,
        is_connected: false,
        sync_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .eq("provider_environment", providerEnvironment);

    if (error) {
      console.error("Failed to disconnect QuickBooks:", error.message);
      return NextResponse.json(
        { error: "Failed to disconnect" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("QuickBooks disconnect error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect QuickBooks" },
      { status: 500 }
    );
  }
}
