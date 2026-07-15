import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeReturnTo } from "@/lib/utils/oauth-return";

export type EmailOAuthProvider = "gmail" | "microsoft365";
export type EmailConnectionType = "company" | "individual";
export type EmailOAuthSource = "wizard" | "alert";

interface EmailOAuthContextBase {
  provider: EmailOAuthProvider;
  companyId: string;
  userId: string;
  type: EmailConnectionType;
  returnTo?: string | null;
}

export type EmailOAuthContext = EmailOAuthContextBase &
  (
    | {
        source: "wizard";
        connectionId?: never;
        expectedEmail?: never;
      }
    | {
        source: "alert";
        connectionId: string;
        expectedEmail: string;
      }
  );

type WithoutProvider<T> = T extends unknown ? Omit<T, "provider"> : never;

export type ConsumedEmailOAuthContext = WithoutProvider<EmailOAuthContext>;

export interface EmailOAuthAlertConnectionInput {
  companyId: string;
  provider: EmailOAuthProvider;
  type: EmailConnectionType;
  connectionId: string;
  expectedEmail: string;
}

export interface EmailOAuthAlertConnection {
  connectionId: string;
  expectedEmail: string;
}

const EMAIL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashStateToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Persist an opaque, provider-bound OAuth nonce. Tenant/user identifiers never
 * leave the database in `state`; the browser receives only 256 random bits.
 */
export async function createEmailOAuthState(
  supabase: SupabaseClient,
  context: EmailOAuthContext,
  now = new Date()
): Promise<string> {
  const stateToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    now.getTime() + EMAIL_OAUTH_STATE_TTL_MS
  ).toISOString();
  const connectionId =
    context.source === "alert" ? context.connectionId.trim() : null;
  const expectedEmail =
    context.source === "alert" ? normalizeEmail(context.expectedEmail) : null;
  const returnTo = sanitizeReturnTo(context.returnTo);
  if (
    context.source === "alert" &&
    (!connectionId ||
      !expectedEmail ||
      !EMAIL_ADDRESS_PATTERN.test(expectedEmail))
  ) {
    throw new Error(
      "Alert email OAuth state requires an exact connection and mailbox"
    );
  }

  // Abandoned provider consent screens never reach the callback. Prune their
  // expired nonces opportunistically so the one-time state table stays bounded.
  const { error: cleanupError } = await supabase
    .from("email_oauth_states")
    .delete()
    .lt("expires_at", now.toISOString());
  if (cleanupError) {
    throw new Error(
      `Failed to prune email OAuth state: ${cleanupError.message}`
    );
  }

  const { error } = await supabase.from("email_oauth_states").insert({
    nonce_hash: hashStateToken(stateToken),
    provider: context.provider,
    company_id: context.companyId,
    user_id: context.userId,
    connection_type: context.type,
    source: context.source,
    connection_id: connectionId,
    expected_email: expectedEmail,
    return_to: returnTo,
    expires_at: expiresAt,
  });
  if (error) {
    throw new Error(`Failed to persist email OAuth state: ${error.message}`);
  }

  return stateToken;
}

/**
 * Consume state exactly once. The database DELETE ... RETURNING operation is
 * atomic, so expiry, replay, and concurrent callback attempts all fail closed.
 */
export async function consumeEmailOAuthState(
  supabase: SupabaseClient,
  provider: EmailOAuthProvider,
  stateToken: string
): Promise<ConsumedEmailOAuthContext | null> {
  if (!stateToken || stateToken.length > 512) return null;

  const { data, error } = await supabase.rpc("consume_email_oauth_state", {
    p_nonce_hash: hashStateToken(stateToken),
    p_provider: provider,
  });
  if (error) {
    throw new Error(`Failed to consume email OAuth state: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;
  const commonStateIsInvalid =
    !row ||
    typeof row.company_id !== "string" ||
    typeof row.user_id !== "string" ||
    (row.connection_type !== "company" &&
      row.connection_type !== "individual") ||
    (row.source !== "wizard" && row.source !== "alert");
  if (commonStateIsInvalid) {
    return null;
  }

  if (row.source === "alert") {
    const expectedEmail =
      typeof row.expected_email === "string"
        ? normalizeEmail(row.expected_email)
        : "";
    if (
      typeof row.connection_id !== "string" ||
      !row.connection_id.trim() ||
      !EMAIL_ADDRESS_PATTERN.test(expectedEmail)
    ) {
      return null;
    }

    return {
      companyId: row.company_id,
      userId: row.user_id,
      type: row.connection_type,
      source: "alert",
      connectionId: row.connection_id,
      expectedEmail,
      returnTo: sanitizeReturnTo(row.return_to),
    };
  }

  if (row.connection_id != null || row.expected_email != null) {
    return null;
  }

  return {
    companyId: row.company_id,
    userId: row.user_id,
    type: row.connection_type,
    source: "wizard",
    returnTo: sanitizeReturnTo(row.return_to),
  };
}

/**
 * Resolve an alert URL against the current connection row before minting OAuth
 * state. Every caller supplies all identity dimensions so a modified or stale
 * link cannot be broadened into a different mailbox reconnect.
 */
export async function resolveEmailOAuthAlertConnection(
  supabase: SupabaseClient,
  input: EmailOAuthAlertConnectionInput
): Promise<EmailOAuthAlertConnection | null> {
  const connectionId = input.connectionId.trim();
  const expectedEmail = normalizeEmail(input.expectedEmail);
  if (
    !connectionId ||
    !expectedEmail ||
    !EMAIL_ADDRESS_PATTERN.test(expectedEmail)
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from("email_connections")
    .select("id, email, status, sync_enabled")
    .eq("id", connectionId)
    .eq("company_id", input.companyId)
    .eq("provider", input.provider)
    .eq("type", input.type)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to verify alert email connection: ${error.message}`
    );
  }
  if (
    !data ||
    data.id !== connectionId ||
    normalizeEmail(data.email) !== expectedEmail ||
    data.sync_enabled !== true ||
    (data.status !== "active" && data.status !== "needs_reconnect")
  ) {
    return null;
  }

  return { connectionId, expectedEmail };
}
