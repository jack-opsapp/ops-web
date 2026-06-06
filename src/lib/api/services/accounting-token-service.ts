/**
 * OPS Web - Accounting Token Service
 *
 * Handles OAuth token refresh for QuickBooks and Sage.
 * Used by the sync engine to ensure valid tokens before API calls.
 *
 * SECURITY: tokens are encrypted at rest in `accounting_connections`
 * (Intuit app-store requirement). This service is the single place that reads
 * the stored ciphertext and hands DECRYPTED tokens to callers / providers, and
 * the single place that re-ENCRYPTS the refreshed tokens before persisting.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  encryptToken,
  decryptToken,
} from "./token-cipher";
import {
  getQuickBooksConfigForEnvironment,
  type QuickBooksEnvironment,
} from "./quickbooks-config";

const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID ?? "";
const SAGE_CLIENT_SECRET = process.env.SAGE_CLIENT_SECRET ?? "";

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";

// Refresh buffer — refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Transient-failure retry: one retry after a short delay on 429 / 5xx.
const RETRY_DELAY_MS = 500;

interface TokenResult {
  accessToken: string;
  realmId: string | null;
  providerEnvironment: QuickBooksEnvironment;
}

/**
 * Thrown when the provider rejects the refresh token with `invalid_grant`
 * (expired or revoked). The connection is flipped to is_connected=false before
 * this throws, so callers can surface a "reconnect required" UI. Carries a
 * stable `.code` so callers can branch without string-matching the message.
 */
export class ReconnectRequiredError extends Error {
  readonly code = "reconnect_required" as const;
  readonly provider: string;
  constructor(provider: string) {
    super(`${provider} refresh token is invalid — reconnection required`);
    this.name = "ReconnectRequiredError";
    this.provider = provider;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for transient statuses we retry once: 429 (rate limit) + any 5xx. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Detect an OAuth `invalid_grant` in a 400 response body. Intuit and Sage both
 * return `{ "error": "invalid_grant" }` (JSON), but tolerate a form-encoded or
 * plain-text body too. Never throws.
 */
function isInvalidGrant(body: string): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error === "invalid_grant") {
      return true;
    }
  } catch {
    // not JSON — fall through to a substring check
  }
  return body.includes("invalid_grant");
}

/**
 * Flip the connection to disconnected so the UI can prompt a reconnect. Best
 * effort: a failure here must not mask the underlying invalid_grant.
 */
async function markReconnectRequired(
  supabase: SupabaseClient,
  connectionId: string
): Promise<void> {
  try {
    await supabase
      .from("accounting_connections")
      .update({ is_connected: false, updated_at: new Date().toISOString() })
      .eq("id", connectionId);
  } catch {
    // swallow — the ReconnectRequiredError still propagates
  }
}

// ─── QuickBooks Token Refresh ──────────────────────────────────────────────────

/**
 * @param refreshToken  PLAINTEXT refresh token (already decrypted by the
 *                      caller). Persisted tokens are re-encrypted here.
 */
async function refreshQuickBooksToken(
  supabase: SupabaseClient,
  connectionId: string,
  refreshToken: string,
  providerEnvironment: QuickBooksEnvironment,
): Promise<string> {
  const config = getQuickBooksConfigForEnvironment(providerEnvironment);
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const doFetch = () =>
    fetch(INTUIT_TOKEN_URL, {
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

  let response = await doFetch();

  // Transient failure (429 / 5xx): retry exactly once after a short delay.
  if (!response.ok && isTransientStatus(response.status)) {
    await sleep(RETRY_DELAY_MS);
    response = await doFetch();
  }

  if (!response.ok) {
    const errorText = await response.text();
    // invalid_grant → the refresh token is dead; require a fresh OAuth connect.
    if (response.status === 400 && isInvalidGrant(errorText)) {
      await markReconnectRequired(supabase, connectionId);
      throw new ReconnectRequiredError("QuickBooks");
    }
    // Never surface the raw provider body to logs/callers.
    throw new Error(`QuickBooks token refresh failed (HTTP ${response.status})`);
  }

  const tokens = await response.json();

  const { error: updateError } = await supabase
    .from("accounting_connections")
    .update({
      // Encrypt before persisting (Intuit at-rest requirement).
      access_token: encryptToken(tokens.access_token),
      refresh_token: encryptToken(tokens.refresh_token ?? refreshToken),
      token_expires_at: new Date(
        Date.now() + (tokens.expires_in || 3600) * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (updateError) {
    throw new Error(`Failed to persist refreshed QuickBooks token: ${updateError.message}`);
  }

  // Return the PLAINTEXT access token to the caller (used immediately).
  return tokens.access_token;
}

// ─── Sage Token Refresh ────────────────────────────────────────────────────────

/**
 * @param refreshToken  PLAINTEXT refresh token (already decrypted by the
 *                      caller). Persisted tokens are re-encrypted here.
 */
async function refreshSageToken(
  supabase: SupabaseClient,
  connectionId: string,
  refreshToken: string
): Promise<string> {
  const doFetch = () =>
    fetch(SAGE_TOKEN_URL, {
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

  let response = await doFetch();

  // Transient failure (429 / 5xx): retry exactly once after a short delay.
  if (!response.ok && isTransientStatus(response.status)) {
    await sleep(RETRY_DELAY_MS);
    response = await doFetch();
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 400 && isInvalidGrant(errorText)) {
      await markReconnectRequired(supabase, connectionId);
      throw new ReconnectRequiredError("Sage");
    }
    throw new Error(`Sage token refresh failed (HTTP ${response.status})`);
  }

  const tokens = await response.json();

  const { error: updateError } = await supabase
    .from("accounting_connections")
    .update({
      access_token: encryptToken(tokens.access_token),
      refresh_token: encryptToken(tokens.refresh_token ?? refreshToken),
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
   * Reads ciphertext from the connection row and returns PLAINTEXT (callers
   * get a usable bearer token + realm id).
   */
  async getValidToken(
    supabase: SupabaseClient,
    connectionId: string
  ): Promise<TokenResult> {
    const { data: conn, error } = await supabase
      .from("accounting_connections")
      .select("id, provider, provider_environment, access_token, refresh_token, token_expires_at, realm_id")
      .eq("id", connectionId)
      .single();

    if (error || !conn) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    const isExpired = Date.now() >= expiresAt - REFRESH_BUFFER_MS;

    // Decrypt on read — stored values are AES-encrypted (legacy plaintext is
    // returned unchanged by decryptToken so existing rows keep working).
    let accessToken = decryptToken(conn.access_token as string | null) ?? "";
    const refreshToken = decryptToken(conn.refresh_token as string | null);

    if (isExpired && refreshToken) {
      if (conn.provider === "quickbooks") {
        const providerEnvironment =
          conn.provider_environment === "sandbox" ? "sandbox" : "production";
        accessToken = await refreshQuickBooksToken(
          supabase,
          connectionId,
          refreshToken,
          providerEnvironment,
        );
      } else if (conn.provider === "sage") {
        accessToken = await refreshSageToken(supabase, connectionId, refreshToken);
      }
    }

    return {
      accessToken,
      realmId: decryptToken(conn.realm_id as string | null),
      providerEnvironment:
        conn.provider_environment === "sandbox" ? "sandbox" : "production",
    };
  },
};
