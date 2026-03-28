/**
 * OPS Web - Gmail Labels API
 *
 * GET /api/integrations/gmail/labels?connectionId=...
 * Returns the user's Gmail labels for the filter builder.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { GmailSyncFilters } from "@/lib/types/pipeline";

interface ConnectionRow {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

async function getValidToken(conn: ConnectionRow): Promise<string> {
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

  const json = await response.json();
  if (!json.access_token) throw new Error("Failed to refresh Gmail access token");

  const supabase = getServiceRoleClient();
  await supabase
    .from("gmail_connections")
    .update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("id", conn.id);

  return json.access_token as string;
}

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const connectionId = request.nextUrl.searchParams.get("connectionId");
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const { data: connRow, error: connError } = await supabase
      .from("gmail_connections")
      .select("id, access_token, refresh_token, expires_at")
      .eq("id", connectionId)
      .single();

    if (connError || !connRow) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const token = await getValidToken(connRow as ConnectionRow);

    const resp = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Gmail API error: ${resp.status}` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    const labels: GmailLabel[] = (data.labels ?? [])
      .filter((l: GmailLabel) => l.type === "user" || ["INBOX", "SENT", "IMPORTANT", "STARRED", "SPAM", "TRASH"].includes(l.id))
      .map((l: GmailLabel) => ({ id: l.id, name: l.name, type: l.type }))
      .sort((a: GmailLabel, b: GmailLabel) => {
        if (a.type === "system" && b.type !== "system") return -1;
        if (a.type !== "system" && b.type === "system") return 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ ok: true, labels });
  } catch (err) {
    console.error("[gmail-labels]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  } finally {
    setSupabaseOverride(null);
  }
}
