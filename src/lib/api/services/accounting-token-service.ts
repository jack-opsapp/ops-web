/**
 * OPS Web - Accounting Token Service
 *
 * Handles OAuth token refresh for QuickBooks and Sage.
 * Used by the sync engine to ensure valid tokens before API calls.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const QB_CLIENT_ID = process.env.QB_CLIENT_ID ?? "";
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET ?? "";
const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID ?? "";
const SAGE_CLIENT_SECRET = process.env.SAGE_CLIENT_SECRET ?? "";

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";

// Refresh buffer — refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface TokenResult {
  accessToken: string;
  realmId: string | null;
}

// ─── QuickBooks Token Refresh ──────────────────────────────────────────────────

async function refreshQuickBooksToken(
  supabase: SupabaseClient,
  connectionId: string,
  refreshToken: string
): Promise<string> {
  const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString("base64");

  const response = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QuickBooks token refresh failed: ${errorText}`);
  }

  const tokens = await response.json();

  const { error: updateError } = await supabase
    .from("accounting_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      token_expires_at: new Date(
        Date.now() + (tokens.expires_in || 3600) * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (updateError) {
    throw new Error(`Failed to persist refreshed QuickBooks token: ${updateError.message}`);
  }

  return tokens.access_token;
}

// ─── Sage Token Refresh ────────────────────────────────────────────────────────

async function refreshSageToken(
  supabase: SupabaseClient,
  connectionId: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch(SAGE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: SAGE_CLIENT_ID,
      client_secret: SAGE_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sage token refresh failed: ${errorText}`);
  }

  const tokens = await response.json();

  const { error: updateError } = await supabase
    .from("accounting_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      token_expires_at: new Date(
        Date.now() + (tokens.expires_in || 3600) * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (updateError) {
    throw new Error(`Failed to persist refreshed Sage token: ${updateError.message}`);
  }

  return tokens.access_token;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export const AccountingTokenService = {
  /**
   * Returns a valid access token, refreshing if expired or about to expire.
   */
  async getValidToken(
    supabase: SupabaseClient,
    connectionId: string
  ): Promise<TokenResult> {
    const { data: conn, error } = await supabase
      .from("accounting_connections")
      .select("id, provider, access_token, refresh_token, token_expires_at, realm_id")
      .eq("id", connectionId)
      .single();

    if (error || !conn) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    const isExpired = Date.now() >= expiresAt - REFRESH_BUFFER_MS;

    let accessToken = conn.access_token as string;

    if (isExpired && conn.refresh_token) {
      if (conn.provider === "quickbooks") {
        accessToken = await refreshQuickBooksToken(supabase, connectionId, conn.refresh_token);
      } else if (conn.provider === "sage") {
        accessToken = await refreshSageToken(supabase, connectionId, conn.refresh_token);
      }
    }

    return { accessToken, realmId: conn.realm_id ?? null };
  },
};
