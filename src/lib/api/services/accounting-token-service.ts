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
 *
 * CONCURRENCY: QuickBooks rotates the refresh token on every refresh, so two
 * concurrent refreshes double-spend it — the loser gets `invalid_grant` for a
 * connection that is actually alive (bug 363f16d7). Two guards close that:
 *   1. In-process single-flight — concurrent callers inside one server
 *      instance share a single token-endpoint call per connection.
 *   2. Cross-instance adoption — before treating a refresh failure as a dead
 *      grant, re-read the row; if a sibling instance already persisted a
 *      rotated pair, adopt it instead of disconnecting.
 * A successful refresh also repairs `is_connected=true`, so a stale
 * disconnect flag left by a lost race can never stick.
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

// Transient-failure retry: one retry after a short delay on 429 / 5xx / 401.
const RETRY_DELAY_MS = 500;

type AccountingRefreshProvider = "quickbooks" | "sage";

const PROVIDER_LABELS: Record<AccountingRefreshProvider, string> = {
  quickbooks: "QuickBooks",
  sage: "Sage",
};

interface TokenResult {
  accessToken: string;
  realmId: string | null;
  providerEnvironment: QuickBooksEnvironment;
}

/** Raw token-endpoint success payload (Intuit and Sage share this shape). */
interface RefreshedTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
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

/**
 * Internal: the token endpoint answered 400 with an OAuth `invalid_grant`
 * body. NOT exported — after the sibling-adoption check this either becomes a
 * ReconnectRequiredError (grant truly dead) or is recovered from silently.
 */
class InvalidGrantError extends Error {
  readonly code = "invalid_grant" as const;
  constructor(providerLabel: string) {
    super(`${providerLabel} token refresh was rejected (invalid_grant)`);
    this.name = "InvalidGrantError";
  }
}

/**
 * Internal: any other non-OK token-endpoint answer. Carries the HTTP status so
 * the recovery layer can branch (401 → adoption-eligible) without
 * string-matching its own message.
 */
class TokenEndpointHttpError extends Error {
  constructor(providerLabel: string, readonly status: number) {
    super(`${providerLabel} token refresh failed (HTTP ${status})`);
    this.name = "TokenEndpointHttpError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True for token-endpoint statuses we retry once: 429 (rate limit), any 5xx,
 * and 401. Including 401 is evidence-driven: Intuit's token endpoint
 * intermittently 401s a refresh that succeeds seconds later (prod runs
 * 2026-06-04 04:33 / 04:34 / 05:39 all self-recovered on the next attempt),
 * and a dead grant is signalled by 400 `invalid_grant`, never 401 — so the
 * retry cannot mask a real reconnect-required state.
 */
function isRetryableTokenStatus(status: number): boolean {
  return status === 429 || status >= 500 || status === 401;
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

// ─── Token-endpoint HTTP (no persistence, no state decisions) ────────────────

/**
 * POST the provider's token endpoint with a refresh grant. Pure HTTP: retries
 * once on a retryable status, then throws a typed error (InvalidGrantError /
 * TokenEndpointHttpError). Never touches the database — the caller decides
 * what a failure means (transient, sibling race, or truly dead grant).
 */
async function requestRefreshedTokens(
  provider: AccountingRefreshProvider,
  refreshToken: string,
  providerEnvironment: QuickBooksEnvironment
): Promise<RefreshedTokens> {
  const label = PROVIDER_LABELS[provider];

  let url: string;
  let headers: Record<string, string>;
  let body: URLSearchParams;
  if (provider === "quickbooks") {
    const config = getQuickBooksConfigForEnvironment(providerEnvironment);
    const basicAuth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString("base64");
    url = INTUIT_TOKEN_URL;
    headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    };
    body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  } else {
    url = SAGE_TOKEN_URL;
    headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: SAGE_CLIENT_ID,
      client_secret: SAGE_CLIENT_SECRET,
    });
  }

  const doFetch = () => fetch(url, { method: "POST", headers, body });

  let response = await doFetch();
  if (!response.ok && isRetryableTokenStatus(response.status)) {
    await sleep(RETRY_DELAY_MS);
    response = await doFetch();
  }

  if (!response.ok) {
    const errorText = await response.text();
    // invalid_grant → the refresh token is dead (or already spent by a
    // sibling refresh — the caller checks which before disconnecting).
    if (response.status === 400 && isInvalidGrant(errorText)) {
      throw new InvalidGrantError(label);
    }
    // Never surface the raw provider body to logs/callers.
    throw new TokenEndpointHttpError(label, response.status);
  }

  return (await response.json()) as RefreshedTokens;
}

/**
 * Encrypt + persist a refreshed token pair. Also repairs `is_connected=true`:
 * a successful refresh PROVES the grant is alive, so any stale disconnect flag
 * (left by a lost concurrent-refresh race) must not stick.
 */
async function persistRefreshedTokens(
  supabase: SupabaseClient,
  connectionId: string,
  providerLabel: string,
  tokens: RefreshedTokens,
  spentRefreshToken: string
): Promise<void> {
  const { error: updateError } = await supabase
    .from("accounting_connections")
    .update({
      // Encrypt before persisting (Intuit at-rest requirement).
      access_token: encryptToken(tokens.access_token),
      refresh_token: encryptToken(tokens.refresh_token ?? spentRefreshToken),
      token_expires_at: new Date(
        Date.now() + (tokens.expires_in || 3600) * 1000
      ).toISOString(),
      is_connected: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (updateError) {
    throw new Error(
      `Failed to persist refreshed ${providerLabel} token: ${updateError.message}`
    );
  }
}

/**
 * Cross-instance race recovery. Our refresh failed with a status that can mean
 * "this refresh token was already spent" (400 invalid_grant, or a 401). If a
 * SIBLING refresh already persisted a rotated pair, the stored refresh token
 * no longer matches the one we spent — adopt the sibling's result instead of
 * failing: use its access token while fresh, or spend its rotated refresh
 * token (one hop, no further adoption) when it has already gone stale.
 *
 * Returns null when the stored refresh token is unchanged — i.e. no sibling
 * won, and the original failure stands on its own meaning.
 */
async function adoptSiblingRefresh(
  supabase: SupabaseClient,
  connectionId: string,
  provider: AccountingRefreshProvider,
  providerEnvironment: QuickBooksEnvironment,
  spentRefreshToken: string
): Promise<string | null> {
  const { data: conn, error } = await supabase
    .from("accounting_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("id", connectionId)
    .single();
  if (error || !conn) return null;

  const storedRefresh = decryptToken(conn.refresh_token as string | null);
  if (!storedRefresh || storedRefresh === spentRefreshToken) return null;

  const expiresAt = conn.token_expires_at
    ? new Date(conn.token_expires_at as string).getTime()
    : 0;
  const stillFresh = Date.now() < expiresAt - REFRESH_BUFFER_MS;
  const storedAccess = decryptToken(conn.access_token as string | null);
  if (stillFresh && storedAccess) return storedAccess;

  return refreshConnectionToken(
    supabase,
    connectionId,
    provider,
    providerEnvironment,
    storedRefresh,
    { allowSiblingAdoption: false }
  );
}

/**
 * Refresh a connection's tokens end-to-end: token-endpoint call → persist →
 * plaintext access token. On failure, first checks for a sibling-won rotation
 * race (see adoptSiblingRefresh); only an invalid_grant with NO sibling
 * progress disconnects the row and raises ReconnectRequiredError. A 401 never
 * disconnects — it is not proof of a dead grant.
 */
async function refreshConnectionToken(
  supabase: SupabaseClient,
  connectionId: string,
  provider: AccountingRefreshProvider,
  providerEnvironment: QuickBooksEnvironment,
  refreshToken: string,
  opts: { allowSiblingAdoption: boolean } = { allowSiblingAdoption: true }
): Promise<string> {
  const label = PROVIDER_LABELS[provider];
  try {
    const tokens = await requestRefreshedTokens(
      provider,
      refreshToken,
      providerEnvironment
    );
    await persistRefreshedTokens(supabase, connectionId, label, tokens, refreshToken);
    return tokens.access_token;
  } catch (err) {
    const invalidGrant = err instanceof InvalidGrantError;
    const unauthorized =
      err instanceof TokenEndpointHttpError && err.status === 401;

    if (opts.allowSiblingAdoption && (invalidGrant || unauthorized)) {
      const adopted = await adoptSiblingRefresh(
        supabase,
        connectionId,
        provider,
        providerEnvironment,
        refreshToken
      );
      if (adopted) return adopted;
    }

    if (invalidGrant) {
      // No sibling progress → the grant itself is dead; require a fresh OAuth
      // connect and surface the reconnect UI.
      await markReconnectRequired(supabase, connectionId);
      throw new ReconnectRequiredError(label);
    }

    throw err;
  }
}

// ─── In-process single-flight ────────────────────────────────────────────────

/**
 * One refresh per connection at a time within this server instance. Vercel
 * reuses instances across concurrent requests (Fluid Compute), so parallel
 * pulls / crons / webhook handlers frequently share an instance — they must
 * share ONE token-endpoint call instead of double-spending the rotated
 * refresh token. Cross-instance races are covered by adoptSiblingRefresh.
 */
const refreshInFlight = new Map<string, Promise<string>>();

function refreshSingleFlight(
  supabase: SupabaseClient,
  connectionId: string,
  provider: AccountingRefreshProvider,
  providerEnvironment: QuickBooksEnvironment,
  refreshToken: string
): Promise<string> {
  const existing = refreshInFlight.get(connectionId);
  if (existing) return existing;

  const flight = refreshConnectionToken(
    supabase,
    connectionId,
    provider,
    providerEnvironment,
    refreshToken
  ).finally(() => {
    refreshInFlight.delete(connectionId);
  });
  refreshInFlight.set(connectionId, flight);
  return flight;
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

    const providerEnvironment: QuickBooksEnvironment =
      conn.provider_environment === "sandbox" ? "sandbox" : "production";

    if (
      isExpired &&
      refreshToken &&
      (conn.provider === "quickbooks" || conn.provider === "sage")
    ) {
      accessToken = await refreshSingleFlight(
        supabase,
        connectionId,
        conn.provider,
        providerEnvironment,
        refreshToken
      );
    }

    return {
      accessToken,
      realmId: decryptToken(conn.realm_id as string | null),
      providerEnvironment,
    };
  },
};
