/**
 * OPS Web - Unified Inbox Hooks
 *
 * Merges pipeline email threads + portal conversations into a single
 * normalized data model for the unified inbox UI.
 *
 * Portal messages use requireSupabase() (client-side) — same pattern
 * as the existing portal-inbox page. PortalMessageService uses
 * getServiceRoleClient() which is server-only and cannot be used here.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { queryKeys } from "@/lib/api/query-client";
import { InboxService } from "@/lib/api/services/inbox-service";
import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type { PipelineThread, ThreadMessage } from "@/lib/types/inbox";
import type { PortalMessage, PortalMessageSender } from "@/lib/types/portal";
import type {
  InboxConversation,
  InboxMessage,
  ChannelFilter,
} from "@/lib/types/unified-inbox";

// ─── Portal Data Fetching (client-side Supabase) ────────────────────────────

interface PortalConversation {
  clientId: string;
  clientName: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
}

async function fetchPortalConversations(companyId: string): Promise<PortalConversation[]> {
  const supabase = requireSupabase();

  const { data: messages, error } = await supabase
    .from("portal_messages")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw new Error(`Failed to fetch portal conversations: ${error.message}`);
  if (!messages || messages.length === 0) return [];

  const clientMap = new Map<string, PortalConversation>();

  for (const row of messages) {
    const clientId = row.client_id as string;

    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, {
        clientId,
        clientName: row.sender_name as string,
        lastMessage: row.content as string,
        lastMessageAt: parseDateRequired(row.created_at),
        unreadCount: 0,
      });
    }

    if ((row.sender_type as string) === "client" && row.read_at == null) {
      clientMap.get(clientId)!.unreadCount += 1;
    }
  }

  // Fetch actual client names
  const clientIds = Array.from(clientMap.keys());
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", clientIds);

    if (clients) {
      for (const client of clients) {
        const entry = clientMap.get(client.id as string);
        if (entry && client.name) {
          entry.clientName = client.name as string;
        }
      }
    }
  }

  return Array.from(clientMap.values()).sort(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
  );
}

async function fetchPortalMessages(
  companyId: string,
  clientId: string
): Promise<PortalMessage[]> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("portal_messages")
    .select("*")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(`Failed to fetch portal messages: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    companyId: row.company_id as string,
    clientId: row.client_id as string,
    projectId: (row.project_id as string) ?? null,
    estimateId: (row.estimate_id as string) ?? null,
    invoiceId: (row.invoice_id as string) ?? null,
    senderType: row.sender_type as PortalMessageSender,
    senderName: row.sender_name as string,
    content: row.content as string,
    readAt: parseDate(row.read_at),
    createdAt: parseDateRequired(row.created_at),
  }));
}

async function fetchPortalUnreadCount(companyId: string): Promise<number> {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("portal_messages")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("sender_type", "client")
    .is("read_at", null);

  if (error) return 0;
  return count ?? 0;
}

async function markPortalMessagesRead(
  companyId: string,
  clientId: string
): Promise<void> {
  const supabase = requireSupabase();

  await supabase
    .from("portal_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .eq("sender_type", "client")
    .is("read_at", null);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name[0] ?? "?").toUpperCase();
}

// ─── Normalization: Conversations ───────────────────────────────────────────

function normalizeConversations(
  pipelineThreads: PipelineThread[],
  portalConversations: PortalConversation[]
): InboxConversation[] {
  const conversations = new Map<string, InboxConversation>();

  // 1) Group pipeline threads by clientId
  for (const thread of pipelineThreads) {
    const key = thread.clientId ?? `unmatched-${thread.latestSender}`;
    const existing = conversations.get(key);

    if (existing) {
      // Merge: update if this thread is newer
      if (thread.latestAt.getTime() > existing.lastMessageAt.getTime()) {
        existing.lastMessageAt = thread.latestAt;
        existing.lastMessagePreview = thread.latestSnippet || thread.latestSubject;
        existing.lastMessageChannel = "email";
      }
      existing.unreadCount += thread.unreadCount;
      existing.hasEmailThreads = true;
      existing.emailThreadIds.push(thread.threadId);
    } else {
      conversations.set(key, {
        id: key,
        type: thread.clientId ? "client" : "unmatched",
        clientId: thread.clientId,
        displayName: thread.clientName ?? thread.latestSender,
        projectName: null,
        avatarInitials: thread.clientName
          ? getInitials(thread.clientName)
          : "?",
        lastMessageAt: thread.latestAt,
        lastMessagePreview: thread.latestSnippet || thread.latestSubject,
        lastMessageChannel: "email",
        unreadCount: thread.unreadCount,
        hasEmailThreads: true,
        hasPortalMessages: false,
        emailThreadIds: [thread.threadId],
      });
    }
  }

  // 2) Merge portal conversations
  for (const portal of portalConversations) {
    const key = portal.clientId;
    const existing = conversations.get(key);

    if (existing) {
      // Merge: update if portal message is newer
      if (portal.lastMessageAt.getTime() > existing.lastMessageAt.getTime()) {
        existing.lastMessageAt = portal.lastMessageAt;
        existing.lastMessagePreview = portal.lastMessage;
        existing.lastMessageChannel = "portal";
      }
      existing.unreadCount += portal.unreadCount;
      existing.hasPortalMessages = true;
      // Prefer the client name from portal (it's fetched from clients table)
      if (portal.clientName) {
        existing.displayName = portal.clientName;
        existing.avatarInitials = getInitials(portal.clientName);
      }
    } else {
      conversations.set(key, {
        id: key,
        type: "client",
        clientId: portal.clientId,
        displayName: portal.clientName,
        projectName: null,
        avatarInitials: getInitials(portal.clientName),
        lastMessageAt: portal.lastMessageAt,
        lastMessagePreview: portal.lastMessage,
        lastMessageChannel: "portal",
        unreadCount: portal.unreadCount,
        hasEmailThreads: false,
        hasPortalMessages: true,
        emailThreadIds: [],
      });
    }
  }

  // Sort by lastMessageAt descending
  return Array.from(conversations.values()).sort(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
  );
}

// ─── Normalization: Messages ────────────────────────────────────────────────

function normalizeEmailMessages(messages: ThreadMessage[], emailThreadId: string): InboxMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    channel: "email" as const,
    direction: msg.direction ?? "inbound",
    senderName: msg.fromEmail?.split("@")[0] ?? "Unknown",
    senderEmail: msg.fromEmail,
    content: msg.bodyText || msg.content || "",
    timestamp: msg.createdAt,
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
    attachmentCount: msg.attachmentCount,
    emailThreadId,
    emailMessageId: msg.emailMessageId,
    subject: msg.subject,
    toEmails: msg.toEmails,
    ccEmails: msg.ccEmails,
    projectId: null,
    estimateId: null,
    invoiceId: null,
  }));
}

function normalizePortalMessages(messages: PortalMessage[]): InboxMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    channel: "portal" as const,
    direction: msg.senderType === "client" ? "inbound" : "outbound",
    senderName: msg.senderName,
    senderEmail: null,
    content: msg.content,
    timestamp: msg.createdAt,
    isRead: msg.readAt !== null,
    hasAttachments: false,
    attachmentCount: 0,
    emailThreadId: null,
    emailMessageId: null,
    subject: null,
    toEmails: [],
    ccEmails: [],
    projectId: msg.projectId,
    estimateId: msg.estimateId,
    invoiceId: msg.invoiceId,
  }));
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Fetch unified conversation list — merges pipeline threads + portal conversations.
 */
export function useUnifiedConversations() {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [...queryKeys.inbox.all, "unified", companyId ?? ""],
    queryFn: async () => {
      const [pipelineThreads, portalConversations] = await Promise.all([
        InboxService.getPipelineThreads(companyId!),
        fetchPortalConversations(companyId!),
      ]);
      return normalizeConversations(pipelineThreads, portalConversations);
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });
}

/**
 * Fetch unified thread messages for a conversation.
 * Merges email thread messages + portal messages, applies channel filter.
 */
export function useUnifiedThread(
  conversationId: string | null,
  clientId: string | null,
  emailThreadIds: string[],
  filter: ChannelFilter
) {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [
      ...queryKeys.inbox.all,
      "unified-thread",
      companyId ?? "",
      conversationId ?? "",
      emailThreadIds,
      filter,
    ],
    queryFn: async () => {
      const results: InboxMessage[] = [];

      // Fetch email messages (if filter allows)
      if (filter !== "portal" && emailThreadIds.length > 0) {
        const emailPromises = emailThreadIds.map((tid) =>
          InboxService.getThreadMessages(companyId!, tid).then((msgs) =>
            normalizeEmailMessages(msgs, tid)
          )
        );
        const emailResults = await Promise.all(emailPromises);
        results.push(...emailResults.flat());
      }

      // Fetch portal messages (if filter allows and client is matched)
      if (filter !== "email" && clientId) {
        const portalMsgs = await fetchPortalMessages(companyId!, clientId);
        results.push(...normalizePortalMessages(portalMsgs));
      }

      // Sort chronologically (oldest first — newest at bottom)
      results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      return results;
    },
    enabled: !!companyId && !!conversationId,
    refetchInterval: 15_000,
  });
}

/**
 * Combined unread count: email + portal.
 */
export function useUnifiedUnreadCount() {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [...queryKeys.inbox.all, "unified-unread", companyId ?? ""],
    queryFn: async () => {
      const [emailUnread, portalUnread] = await Promise.all([
        InboxService.getUnreadCount(companyId!),
        fetchPortalUnreadCount(companyId!),
      ]);
      return emailUnread + portalUnread;
    },
    enabled: !!companyId,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}

/**
 * Mark portal messages as read for a client conversation.
 */
export { markPortalMessagesRead };
