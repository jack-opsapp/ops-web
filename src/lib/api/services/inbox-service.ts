/**
 * OPS Web - Inbox Service
 *
 * Client-side Supabase queries for the Pipeline tab of the inbox.
 * Groups activities by email_thread_id and joins opportunity data.
 *
 * For All Mail, the client hits the API route which proxies to Gmail/M365.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  PipelineThread,
  ThreadMessage,
} from "@/lib/types/inbox";
import type { OpportunityStage } from "@/lib/types/pipeline";

// ─── Pipeline Threads ─────────────────────────────────────────────────────────

/**
 * Fetch email threads linked to pipeline opportunities.
 * Groups activities by email_thread_id, joins opportunity + client data.
 */
async function getPipelineThreads(companyId: string): Promise<PipelineThread[]> {
  const supabase = requireSupabase();

  // Step 1: Get all email activities linked to opportunities
  const { data: activities, error: actError } = await supabase
    .from("activities")
    .select(
      "id, email_thread_id, subject, content, from_email, direction, is_read, created_at, opportunity_id, has_attachments"
    )
    .eq("company_id", companyId)
    .eq("type", "email")
    .not("opportunity_id", "is", null)
    .not("email_thread_id", "is", null)
    .order("created_at", { ascending: false });

  if (actError) throw new Error(`Failed to fetch pipeline activities: ${actError.message}`);
  if (!activities || activities.length === 0) return [];

  // Step 2: Get unique opportunity IDs and fetch them
  const oppIds = [...new Set(activities.map((a) => a.opportunity_id as string))];

  const { data: opportunities, error: oppError } = await supabase
    .from("opportunities")
    .select("id, title, stage, ai_summary, client_id")
    .in("id", oppIds);

  if (oppError) throw new Error(`Failed to fetch opportunities: ${oppError.message}`);

  // Step 3: Get client names for those opportunities
  const clientIds = (opportunities ?? [])
    .map((o) => o.client_id as string)
    .filter(Boolean);

  let clientMap: Record<string, string> = {};
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", [...new Set(clientIds)]);

    clientMap = Object.fromEntries(
      (clients ?? []).map((c) => [c.id, c.name as string])
    );
  }

  // Build opportunity lookup
  const oppMap = Object.fromEntries(
    (opportunities ?? []).map((o) => [
      o.id,
      {
        title: o.title as string,
        stage: o.stage as OpportunityStage,
        aiSummary: (o.ai_summary as string) ?? null,
        clientId: (o.client_id as string) ?? null,
        clientName: o.client_id ? clientMap[o.client_id as string] ?? null : null,
      },
    ])
  );

  // Step 4: Group activities by email_thread_id
  const threadMap = new Map<string, typeof activities>();
  for (const act of activities) {
    const tid = act.email_thread_id as string;
    if (!threadMap.has(tid)) threadMap.set(tid, []);
    threadMap.get(tid)!.push(act);
  }

  // Step 5: Build PipelineThread objects
  const threads: PipelineThread[] = [];

  for (const [threadId, msgs] of threadMap) {
    // Use the first message's opportunity (most recent, since sorted desc)
    const oppId = msgs[0].opportunity_id as string;
    const opp = oppMap[oppId];
    if (!opp) continue;

    const latest = msgs[0]; // Already sorted desc by created_at
    const unreadCount = msgs.filter((m) => !m.is_read).length;
    const hasAttachments = msgs.some((m) => m.has_attachments);

    threads.push({
      threadId,
      opportunityId: oppId,
      opportunityTitle: opp.title,
      opportunityStage: opp.stage,
      aiSummary: opp.aiSummary,
      clientId: opp.clientId,
      clientName: opp.clientName,
      latestSubject: (latest.subject as string) || "(no subject)",
      latestSnippet: (latest.content as string) || "",
      latestSender: (latest.from_email as string) || "",
      latestDirection: (latest.direction as "inbound" | "outbound") ?? null,
      latestAt: parseDate(latest.created_at) ?? new Date(),
      messageCount: msgs.length,
      unreadCount,
      hasAttachments,
    });
  }

  // Sort by latest message time (most recent first)
  threads.sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());

  return threads;
}

// ─── Thread Messages ──────────────────────────────────────────────────────────

/**
 * Fetch all messages in a thread (by email_thread_id), ordered chronologically.
 */
async function getThreadMessages(
  companyId: string,
  emailThreadId: string
): Promise<ThreadMessage[]> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, subject, content, body_text, from_email, to_emails, cc_emails, direction, is_read, has_attachments, attachment_count, email_message_id, created_at"
    )
    .eq("company_id", companyId)
    .eq("type", "email")
    .eq("email_thread_id", emailThreadId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch thread messages: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    subject: (row.subject as string) || "",
    content: (row.content as string) ?? null,
    bodyText: (row.body_text as string) ?? null,
    fromEmail: (row.from_email as string) ?? null,
    toEmails: (row.to_emails as string[]) ?? [],
    ccEmails: (row.cc_emails as string[]) ?? [],
    direction: (row.direction as "inbound" | "outbound") ?? null,
    isRead: (row.is_read as boolean) ?? true,
    hasAttachments: (row.has_attachments as boolean) ?? false,
    attachmentCount: (row.attachment_count as number) ?? 0,
    emailMessageId: (row.email_message_id as string) ?? null,
    createdAt: parseDate(row.created_at) ?? new Date(),
  }));
}

// ─── Read/Unread ──────────────────────────────────────────────────────────────

/** Mark a single activity as read */
async function markRead(activityId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from("activities")
    .update({ is_read: true })
    .eq("id", activityId);

  if (error) throw new Error(`Failed to mark as read: ${error.message}`);
}

/** Mark a single activity as unread */
async function markUnread(activityId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from("activities")
    .update({ is_read: false })
    .eq("id", activityId);

  if (error) throw new Error(`Failed to mark as unread: ${error.message}`);
}

/** Mark all activities in a thread as read */
async function markThreadRead(
  companyId: string,
  emailThreadId: string
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from("activities")
    .update({ is_read: true })
    .eq("company_id", companyId)
    .eq("type", "email")
    .eq("email_thread_id", emailThreadId)
    .eq("is_read", false);

  if (error) throw new Error(`Failed to mark thread as read: ${error.message}`);
}

/** Mark all activities in a thread as unread */
async function markThreadUnread(
  companyId: string,
  emailThreadId: string
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from("activities")
    .update({ is_read: false })
    .eq("company_id", companyId)
    .eq("type", "email")
    .eq("email_thread_id", emailThreadId);

  if (error) throw new Error(`Failed to mark thread as unread: ${error.message}`);
}

// ─── Unread Count ─────────────────────────────────────────────────────────────

/** Get total unread email count for pipeline activities */
async function getUnreadCount(companyId: string): Promise<number> {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("type", "email")
    .eq("is_read", false)
    .not("opportunity_id", "is", null);

  if (error) return 0;
  return count ?? 0;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const InboxService = {
  getPipelineThreads,
  getThreadMessages,
  markRead,
  markUnread,
  markThreadRead,
  markThreadUnread,
  getUnreadCount,
};
