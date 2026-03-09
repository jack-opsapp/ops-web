/**
 * OPS Web - Gmail Scan Preview
 *
 * GET /api/integrations/gmail/scan-preview?connectionId=...&days=30
 * Scans recent emails and classifies each as "would import" or "would filter"
 * based on the connection's current sync filters. Used by the Email Setup Wizard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailFilterService } from "@/lib/api/services/email-filter-service";
import { DEFAULT_SYNC_FILTERS } from "@/lib/types/pipeline";
import type { GmailSyncFilters } from "@/lib/types/pipeline";
import {
  classifyEmails,
  IMPORT_CATEGORIES,
  type EmailForClassification,
  type EmailCategory,
} from "@/lib/api/services/email-classifier";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConnectionRow {
  id: string;
  company_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  sync_filters: GmailSyncFilters | null;
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
  snippet?: string;
  labelIds?: string[];
}

// ─── Token helper ────────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SCAN = 500;
const BATCH_SIZE = 20;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const connectionId = request.nextUrl.searchParams.get("connectionId");
    const days = parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10);

    if (!connectionId) {
      return NextResponse.json(
        { error: "connectionId is required" },
        { status: 400 },
      );
    }

    // Load connection
    const { data: connRow, error: connError } = await supabase
      .from("gmail_connections")
      .select("id, company_id, access_token, refresh_token, expires_at, sync_filters")
      .eq("id", connectionId)
      .single();

    if (connError || !connRow) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
    }

    const conn = connRow as ConnectionRow;
    const token = await getValidToken(conn);

    const syncFilters: GmailSyncFilters =
      conn.sync_filters && typeof conn.sync_filters === "object"
        ? conn.sync_filters
        : DEFAULT_SYNC_FILTERS;

    const blocklist = await EmailFilterService.buildBlocklist(syncFilters);

    // Build date query
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - days);
    const queryDate = afterDate.toISOString().split("T")[0].replace(/-/g, "/");

    // List messages
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const listUrl = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      );
      listUrl.searchParams.set("q", `after:${queryDate}`);
      listUrl.searchParams.set("maxResults", "200");
      if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

      const listResp = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!listResp.ok) {
        throw new Error(`Gmail messages.list failed: ${listResp.status}`);
      }

      const listData: GmailMessageListResponse = await listResp.json();
      for (const msg of listData.messages ?? []) {
        allMessageIds.push(msg.id);
      }
      pageToken = listData.nextPageToken;
    } while (pageToken && allMessageIds.length < MAX_SCAN);

    if (allMessageIds.length > MAX_SCAN) {
      allMessageIds.length = MAX_SCAN;
    }

    // Process messages in batches — fetch metadata + snippet
    const emails: Array<{
      id: string;
      from: string;
      fromEmail: string;
      domain: string;
      subject: string;
      snippet: string;
      labels: string[];
      date: string;
      wouldImport: boolean;
      reason: string;
      aiCategory?: EmailCategory;
      aiConfidence?: number;
    }> = [];

    for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
      const batch = allMessageIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (msgId) => {
          try {
            const msgResp = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${token}` } },
            );

            if (!msgResp.ok) return null;

            const msg: GmailMessage = await msgResp.json();
            const headers = msg.payload?.headers ?? [];
            const from = headers.find((h) => h.name === "From")?.value ?? "";
            const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
            const date = headers.find((h) => h.name === "Date")?.value ?? "";
            const fromEmail = (from.match(/<(.+?)>/) ?? [, from])[1]?.toLowerCase() ?? "";
            const domain = fromEmail.split("@")[1] ?? "";

            const wouldFilter = EmailFilterService.shouldFilter(
              fromEmail,
              subject,
              blocklist,
              syncFilters,
              msg.labelIds,
              msg.snippet,
            );

            let reason = "";
            if (wouldFilter) {
              if (blocklist.domains.has(domain)) {
                reason = "Blocked domain";
              } else if (
                fromEmail.startsWith("noreply") ||
                fromEmail.startsWith("no-reply") ||
                fromEmail.startsWith("donotreply") ||
                fromEmail.startsWith("mailer-daemon")
              ) {
                reason = "Automated sender";
              } else if (syncFilters.excludeAddresses.includes(fromEmail)) {
                reason = "Blocked address";
              } else {
                reason = "Matched filter rule";
              }
            } else {
              reason = "Real conversation";
            }

            return {
              id: msgId,
              from,
              fromEmail,
              domain,
              subject,
              snippet: msg.snippet ?? "",
              labels: msg.labelIds ?? [],
              date,
              wouldImport: !wouldFilter,
              reason,
            };
          } catch {
            return null;
          }
        }),
      );

      for (const r of results) {
        if (r) emails.push(r);
      }

      // Rate limit
      if (i + BATCH_SIZE < allMessageIds.length) {
        await sleep(100);
      }
    }

    // ─── AI Classification ──────────────────────────────────────────────────
    // Run GPT-4o-mini classification on a sample of emails to generate
    // tailored filter recommendations (replaces generic preset filters).

    let recommendedBlockDomains: string[] = [];
    let recommendedKeepDomains: string[] = [];

    try {
      const emailsForAI: EmailForClassification[] = emails.map((e) => ({
        id: e.id,
        from: e.from,
        fromEmail: e.fromEmail,
        domain: e.domain,
        subject: e.subject,
        snippet: e.snippet,
      }));

      const aiResult = await classifyEmails(emailsForAI);

      // Merge AI classifications into email results
      for (const email of emails) {
        const classified = aiResult.classifications.get(email.id);
        if (classified) {
          email.aiCategory = classified.category;
          email.aiConfidence = classified.confidence;

          // AI overrides rule-based filtering:
          // If AI says it's a customer/lead/website_inquiry → import
          // If AI says it's noise → filter out
          const aiSaysImport = IMPORT_CATEGORIES.includes(classified.category);
          email.wouldImport = aiSaysImport;
          email.reason = aiSaysImport
            ? `AI: ${classified.category.replace("_", " ")}`
            : `AI: ${classified.category.replace("_", " ")}`;
        }
      }

      recommendedBlockDomains = aiResult.recommendedBlockDomains;
      recommendedKeepDomains = aiResult.recommendedKeepDomains;
    } catch (err) {
      console.error("[gmail-scan-preview] AI classification failed, using rule-based only:", err);
    }

    return NextResponse.json({
      ok: true,
      emails,
      total: allMessageIds.length,
      recommendedBlockDomains,
      recommendedKeepDomains,
    });
  } catch (err) {
    console.error("[gmail-scan-preview]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  } finally {
    setSupabaseOverride(null);
  }
}
