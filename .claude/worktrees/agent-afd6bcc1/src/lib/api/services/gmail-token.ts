/**
 * OPS Web - Gmail Token Management
 *
 * Shared utility for refreshing Gmail OAuth tokens.
 * Used by scan-start, scan-preview, and other Gmail API routes.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";

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
export async function getValidGmailToken(conn: GmailConnectionRow): Promise<string> {
  const expiresAt = new Date(conn.expires_at);
  if (expiresAt > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Gmail token refresh failed (${response.status}): ${errorBody.slice(0, 200)}`);
  }

  const json = await response.json();
  if (!json.access_token) throw new Error("Gmail token refresh returned no access_token");

  const supabase = getServiceRoleClient();
  const { error: updateErr } = await supabase
    .from("gmail_connections")
    .update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("id", conn.id);

  if (updateErr) {
    console.warn("[gmail-token] Failed to persist refreshed token:", updateErr.message);
  }

  return json.access_token as string;
}
