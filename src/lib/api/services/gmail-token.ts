/**
 * OPS Web - Gmail Token Management
 *
 * Shared utility for refreshing Gmail OAuth tokens.
 * Used by scan-start, scan-preview, and other Gmail API routes.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { fetchGmailOnceWithinDeadline } from "./providers/gmail-read";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GmailConnectionRow {
  id: string;
  company_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/**
 * Returns a valid Gmail access token, refreshing via OAuth if expired.
 * Persists the new token to Supabase if refreshed.
 */
export async function getValidGmailToken(
  conn: GmailConnectionRow,
  options: {
    deadlineAt?: number;
    context?: string;
    client?: SupabaseClient;
    requirePersistence?: boolean;
  } = {}
): Promise<string> {
  const expiresAt = new Date(conn.expires_at);
  if (expiresAt > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }

  const context = options.context ?? "Gmail read";
  const deadlineAt = options.deadlineAt ?? Date.now() + 45_000;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new Error(`${context} token refresh deadline exceeded`);
  }

  const response = await fetchGmailOnceWithinDeadline(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
        client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
      }),
    },
    {
      deadlineAt,
      context: `${context} token refresh`,
    }
  );
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Gmail token refresh failed (${response.status}): ${rawBody.slice(0, 200)}`
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(rawBody) as typeof json;
  } catch {
    throw new Error("Gmail token refresh returned invalid JSON");
  }
  if (!json.access_token)
    throw new Error("Gmail token refresh returned no access_token");

  const supabase = options.client ?? getServiceRoleClient();
  const { error: updateErr } = await supabase
    .from("email_connections")
    .update({
      access_token: json.access_token,
      expires_at: new Date(
        Date.now() + (json.expires_in ?? 3600) * 1000
      ).toISOString(),
    })
    .eq("id", conn.id);

  if (updateErr) {
    if (options.requirePersistence) {
      throw new Error(
        `Failed to persist refreshed Gmail access token: ${updateErr.message}`
      );
    }
    console.warn(
      "[gmail-token] Failed to persist refreshed token:",
      updateErr.message
    );
  }

  return json.access_token;
}
