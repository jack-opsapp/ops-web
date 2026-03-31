/**
 * OPS Web - Client Email Threads API
 *
 * GET /api/integrations/email/client-threads?companyId=...&clientId=...
 *   Searches Gmail/M365 for ALL threads involving a client's email addresses
 *   (primary + sub-client emails). Returns thread summaries grouped by threadId.
 *
 * GET /api/integrations/email/client-threads?companyId=...&email=...
 *   Same, but for a single email address (used for unmatched contacts).
 *
 * This powers the unified inbox — showing all correspondence with a client,
 * not just pipeline-imported threads.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { EmailService } from "@/lib/api/services/email-service";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): EmailConnection {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as EmailConnection["provider"],
    type: row.type as EmailConnection["type"],
    userId: (row.user_id as string) ?? null,
    email: row.email as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: new Date(row.expires_at as string),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as EmailConnection["syncFilters"]) ?? {},
    webhookSubscriptionId: (row.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: row.webhook_expires_at ? new Date(row.webhook_expires_at as string) : null,
    opsLabelId: (row.ops_label_id as string) ?? null,
    aiReviewEnabled: (row.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (row.ai_memory_enabled as boolean) ?? false,
    status: (row.status as EmailConnection["status"]) ?? "active",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// Common email providers where domain-level search is meaningless
const COMMON_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.ca", "yahoo.co.uk", "yahoo.com.au",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "ymail.com",
  "shaw.ca", "telus.net", "rogers.com", "bell.net",
]);

/**
 * Build a Gmail/M365-compatible search query for all threads involving these emails.
 * For custom business domains (not gmail.com etc.), also adds a domain-level search
 * to catch contacts not yet in the sub-clients list.
 */
function buildClientSearchQuery(emails: string[]): string {
  if (emails.length === 0) return "";

  const clauses: string[] = [];

  // Add per-email clauses
  for (const email of emails) {
    clauses.push(`from:${email}`, `to:${email}`);
  }

  // Extract unique custom domains and add domain-level search
  const domains = new Set<string>();
  for (const email of emails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !COMMON_DOMAINS.has(domain)) {
      domains.add(domain);
    }
  }

  for (const domain of domains) {
    clauses.push(`from:@${domain}`, `to:@${domain}`);
  }

  // Gmail syntax: {clause1 clause2} groups OR conditions
  return `{${clauses.join(" ")}}`;
}

/** Group search results by threadId and return thread summaries */
function groupByThread(emails: NormalizedEmail[]): ThreadSummary[] {
  const threadMap = new Map<string, NormalizedEmail[]>();

  for (const email of emails) {
    const tid = email.threadId;
    if (!threadMap.has(tid)) threadMap.set(tid, []);
    threadMap.get(tid)!.push(email);
  }

  const threads: ThreadSummary[] = [];

  for (const [threadId, msgs] of threadMap) {
    // Sort messages within thread by date descending
    msgs.sort((a, b) => b.date.getTime() - a.date.getTime());
    const latest = msgs[0];

    threads.push({
      threadId,
      subject: latest.subject || "(no subject)",
      snippet: latest.snippet || "",
      from: latest.from,
      fromName: latest.fromName,
      latestDate: latest.date.toISOString(),
      messageCount: msgs.length,
      isRead: latest.isRead,
      hasAttachments: msgs.some((m) => m.hasAttachments),
    });
  }

  // Sort threads by latest date descending
  threads.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());

  return threads;
}

interface ThreadSummary {
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  fromName: string;
  latestDate: string;
  messageCount: number;
  isRead: boolean;
  hasAttachments: boolean;
}

// ─── GET Handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // 1. Auth
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const clientId = searchParams.get("clientId");
    const singleEmail = searchParams.get("email");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    if (!clientId && !singleEmail) {
      return NextResponse.json({ error: "clientId or email is required" }, { status: 400 });
    }

    // 2. Verify user belongs to company
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user || (user.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 3. Collect email addresses for this client
    const supabase = getServiceRoleClient();
    const emails: string[] = [];

    if (clientId) {
      // Fetch client's primary email
      const { data: client } = await supabase
        .from("clients")
        .select("email")
        .eq("id", clientId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .single();

      if (client?.email) {
        emails.push(client.email as string);
      }

      // Fetch sub-client emails
      const { data: subClients } = await supabase
        .from("sub_clients")
        .select("email")
        .eq("client_id", clientId)
        .is("deleted_at", null);

      if (subClients) {
        for (const sc of subClients) {
          if (sc.email) emails.push(sc.email as string);
        }
      }
    } else if (singleEmail) {
      emails.push(singleEmail);
    }

    console.log(`[client-threads] clientId=${clientId}, primary email=${emails[0] ?? "none"}, sub-client emails=[${emails.slice(1).join(", ")}], total=${emails.length}`);

    if (emails.length === 0) {
      return NextResponse.json({ threads: [], emails: [] });
    }

    // Deduplicate (case-insensitive)
    const uniqueEmails = [...new Set(emails.map((e) => e.toLowerCase()))];

    // 4. Find active email connection
    const { data: connRows, error: connError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("sync_enabled", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (connError || !connRows || connRows.length === 0) {
      return NextResponse.json({
        threads: [],
        emails: uniqueEmails,
        error: "no_connection",
      });
    }

    const connection = mapFromDb(connRows[0]);
    const provider = EmailService.getProvider(connection);

    // 5. Search Gmail/M365 for all threads involving these emails
    const query = buildClientSearchQuery(uniqueEmails);
    console.log(`[client-threads] Gmail search query: ${query}`);
    const results = await provider.searchEmails(query, { maxResults: 100 });
    console.log(`[client-threads] Found ${results.length} messages across threads`);

    // 6. Group by thread and return summaries
    const threads = groupByThread(results);

    // Persist refreshed tokens if changed
    if (connection.accessToken !== connRows[0].access_token) {
      await supabase
        .from("email_connections")
        .update({
          access_token: connection.accessToken,
          expires_at: connection.expiresAt.toISOString(),
        })
        .eq("id", connection.id);
    }

    return NextResponse.json({
      threads,
      emails: uniqueEmails,
      connectionEmail: connection.email,
    });
  } catch (err) {
    console.error("Client threads error:", err);
    return NextResponse.json(
      { error: `Failed to fetch client threads: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
