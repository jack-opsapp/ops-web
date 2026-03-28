/**
 * OPS Web - Gmail Scan Preview
 *
 * GET /api/integrations/gmail/scan-preview?connectionId=...&days=30
 *
 * 1. Fetches up to 500 emails from Gmail (metadata + snippet)
 * 2. Pre-filters emails from known noise domains (preset blocklist)
 * 3. Sends remaining ambiguous emails to GPT-4o-mini for classification
 * 4. Returns all emails with verdicts + a recommended filter configuration
 *
 * Cost: < 1¢ per customer (single OpenAI call).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailFilterService } from "@/lib/api/services/email-filter-service";
import { DEFAULT_SYNC_FILTERS } from "@/lib/types/pipeline";
import type { GmailSyncFilters } from "@/lib/types/pipeline";
import {
  classifyEmails,
  type EmailForClassification,
} from "@/lib/api/services/email-classifier";

// Vercel serverless function config — this route fetches 500 emails
// then calls OpenAI, so it needs more than the default 15s timeout.
export const maxDuration = 60;

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

interface ScanEmail {
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
    console.warn("[gmail-scan-preview] Failed to persist refreshed token:", updateErr.message);
  }

  return json.access_token as string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SCAN = 500;
const BATCH_SIZE = 50;

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const connectionId = request.nextUrl.searchParams.get("connectionId");
    const rawDays = parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;

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

    // Build preset blocklist for pre-filtering
    const presetFilters: GmailSyncFilters = {
      ...DEFAULT_SYNC_FILTERS,
      usePresetBlocklist: true,
    };
    const blocklist = await EmailFilterService.buildBlocklist(presetFilters);

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

    // ─── Fetch email metadata in batches ──────────────────────────────────

    const emails: ScanEmail[] = [];

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

            return {
              id: msgId,
              from,
              fromEmail,
              domain,
              subject,
              snippet: msg.snippet ?? "",
              labels: msg.labelIds ?? [],
              date,
              wouldImport: true, // Default; will be set by pre-filter or AI
              reason: "",
            };
          } catch {
            return null;
          }
        }),
      );

      for (const r of results) {
        if (r) emails.push(r);
      }

      // Gmail allows 250 req/s — no sleep needed at batch size 50
    }

    // ─── Pre-filter: strip known noise domains before AI ──────────────────
    // Emails from preset blocklist domains (mailchimp, linkedin, etc.) are
    // definitively noise — no need to waste AI tokens on them.
    // IMPORTANT: We do NOT filter by noreply patterns here — noreply senders
    // could be Procore, BuilderTrend, or other construction bid platforms.

    const presetDomains = blocklist.domains;
    const autoFiltered: ScanEmail[] = [];
    const ambiguous: ScanEmail[] = [];

    for (const email of emails) {
      if (presetDomains.has(email.domain)) {
        email.wouldImport = false;
        email.reason = "Blocked domain (preset)";
        autoFiltered.push(email);
      } else {
        ambiguous.push(email);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[gmail-scan-preview] Pre-filtered ${autoFiltered.length} emails ` +
      `from preset blocklist domains. Sending ${ambiguous.length} to AI.`,
    );

    // ─── AI Classification ────────────────────────────────────────────────
    // Single GPT-4o-mini call with only ambiguous emails.

    let recommendedFilters = null;

    try {
      const emailsForAI: EmailForClassification[] = ambiguous.map((e) => ({
        id: e.id,
        fromEmail: e.fromEmail,
        subject: e.subject,
        snippet: e.snippet,
      }));

      const aiResult = await classifyEmails(emailsForAI);
      recommendedFilters = aiResult.filters;

      // Apply AI-recommended filters to determine per-email import/filter status
      const blockedDomains = new Set(aiResult.filters.excludeDomains.map((d) => d.toLowerCase()));
      const blockedAddresses = new Set(aiResult.filters.excludeAddresses.map((a) => a.toLowerCase()));
      const blockedKeywords = aiResult.filters.excludeSubjectKeywords.map((k) => k.toLowerCase());

      for (const email of ambiguous) {
        const domainBlocked = blockedDomains.has(email.domain.toLowerCase());
        const addressBlocked = blockedAddresses.has(email.fromEmail.toLowerCase());
        const keywordBlocked = blockedKeywords.some((kw) =>
          email.subject.toLowerCase().includes(kw),
        );

        if (domainBlocked || addressBlocked || keywordBlocked) {
          email.wouldImport = false;
          email.reason = domainBlocked
            ? "AI: blocked domain"
            : addressBlocked
              ? "AI: blocked address"
              : "AI: blocked keyword";
        } else {
          email.wouldImport = true;
          email.reason = "AI: import";
        }
      }
    } catch (err) {
      console.error("[gmail-scan-preview] AI classification failed, ambiguous emails default to import:", err);
      // Ambiguous emails keep wouldImport=true — better to import too much than miss customers
      for (const email of ambiguous) {
        email.reason = "Unclassified (AI unavailable)";
      }
    }

    // Combine all emails in original order
    const allResults = [...autoFiltered, ...ambiguous];

    return NextResponse.json({
      ok: true,
      emails: allResults,
      total: allMessageIds.length,
      preFiltered: autoFiltered.length,
      aiAnalyzed: ambiguous.length,
      recommendedFilters,
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
