/**
 * OPS Web - All Mail Inbox API
 *
 * GET /api/integrations/email/inbox?companyId=...&pageToken=...&q=...
 *   Lists inbox messages from the connected email provider (Gmail/M365).
 *
 * GET /api/integrations/email/inbox?companyId=...&threadId=...
 *   Fetches full thread messages from the provider.
 *
 * Auth: Firebase/Supabase JWT required. User must belong to the company.
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

function normalizeToResponse(email: NormalizedEmail) {
  return {
    id: email.id,
    threadId: email.threadId,
    from: email.from,
    fromName: email.fromName,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    snippet: email.snippet,
    date: email.date.toISOString(),
    isRead: email.isRead,
    hasAttachments: email.hasAttachments,
  };
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
    const threadId = searchParams.get("threadId");
    const query = searchParams.get("q") || "";
    const maxResults = parseInt(searchParams.get("maxResults") || "50", 10);

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    // 2. Verify user belongs to company
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user || (user.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 3. Find active email connection for this company
    const supabase = getServiceRoleClient();
    const { data: connRows, error: connError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("sync_enabled", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (connError || !connRows || connRows.length === 0) {
      return NextResponse.json(
        { error: "no_connection", messages: [], nextPageToken: null, hasMore: false },
        { status: 200 }
      );
    }

    const connection = mapFromDb(connRows[0]);
    const provider = EmailService.getProvider(connection);

    // 4a. Thread detail mode
    if (threadId) {
      const [messages, imageAttachments] = await Promise.all([
        provider.fetchThread(threadId),
        provider.getImageAttachmentsFromThread(threadId).catch(() => []),
      ]);

      // Group attachments by messageId for easy lookup
      const attachmentsByMsg = new Map<string, (typeof imageAttachments)[number][]>();
      for (const att of imageAttachments) {
        if (!attachmentsByMsg.has(att.messageId)) attachmentsByMsg.set(att.messageId, []);
        attachmentsByMsg.get(att.messageId)!.push(att);
      }

      return NextResponse.json({
        messages: messages.map((m) => ({
          ...normalizeToResponse(m),
          bodyText: m.bodyText,
          attachments: (attachmentsByMsg.get(m.id) || []).map((a) => ({
            attachmentId: a.attachmentId,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
        })),
      });
    }

    // 4b. Inbox listing mode
    // Use searchEmails with "in:inbox" query (Gmail-native, M365 provider translates)
    const searchQuery = query
      ? `in:inbox ${query}`
      : "in:inbox";

    const emails = await provider.searchEmails(searchQuery, {
      maxResults: maxResults + 1, // Fetch one extra to check hasMore
    });

    const hasMore = emails.length > maxResults;
    const page = hasMore ? emails.slice(0, maxResults) : emails;

    // Deduplicate by threadId — show only the latest message per thread
    const seen = new Set<string>();
    const deduped: NormalizedEmail[] = [];
    for (const email of page) {
      if (!seen.has(email.threadId)) {
        seen.add(email.threadId);
        deduped.push(email);
      }
    }

    // Persist refreshed tokens if they changed
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
      messages: deduped.map(normalizeToResponse),
      nextPageToken: null, // Gmail search doesn't return pageTokens easily; pagination via maxResults
      hasMore,
    });
  } catch (err) {
    console.error("All Mail inbox error:", err);
    return NextResponse.json(
      { error: `Failed to fetch inbox: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
