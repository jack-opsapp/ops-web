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
import { stripQuotedContent, extractEmailAddress, isCommonEmailDomain } from "@/lib/utils/email-parsing";
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

// ─── Provider-based thread fetch ────────────────────────────────────────────

/**
 * Fetch thread messages from the email provider API (Gmail/M365).
 * This returns the actual email body, unlike activities table stubs.
 * Falls back to activities table if provider is unavailable.
 */
async function fetchProviderThreadMessages(
  companyId: string,
  threadId: string
): Promise<InboxMessage[]> {
  try {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    if (!idToken) {
      // No auth — fall back to activities table
      const msgs = await InboxService.getThreadMessages(companyId, threadId);
      return normalizeEmailMessages(msgs, threadId);
    }

    const params = new URLSearchParams({ companyId, threadId });
    const res = await fetch(`/api/integrations/email/inbox?${params}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!res.ok) {
      // Provider unavailable — fall back to activities table
      const msgs = await InboxService.getThreadMessages(companyId, threadId);
      return normalizeEmailMessages(msgs, threadId);
    }

    const data = await res.json();
    const messages = data.messages ?? [];

    return messages.map((m: Record<string, unknown>) => {
      const rawBody = (m.bodyText as string) || (m.snippet as string) || "";
      const rawAttachments = (m.attachments as Array<Record<string, unknown>>) ?? [];
      return {
        id: m.id as string,
        channel: "email" as const,
        direction: "inbound" as const, // Provider doesn't track this — will refine below
        senderName: (m.fromName as string) || extractEmailAddress(m.from as string)?.split("@")[0] || "Unknown",
        senderEmail: extractEmailAddress(m.from as string),
        content: stripQuotedContent(rawBody),
        timestamp: new Date(m.date as string),
        isRead: (m.isRead as boolean) ?? true,
        hasAttachments: (m.hasAttachments as boolean) ?? false,
        attachmentCount: rawAttachments.length || ((m.hasAttachments as boolean) ? 1 : 0),
        attachments: rawAttachments.map((a) => ({
          attachmentId: a.attachmentId as string,
          filename: a.filename as string,
          mimeType: a.mimeType as string,
          size: a.size as number,
        })),
        emailThreadId: threadId,
        emailMessageId: m.id as string,
        subject: m.subject as string,
        toEmails: (m.to as string[]) ?? [],
        ccEmails: (m.cc as string[]) ?? [],
        projectId: null,
        estimateId: null,
        invoiceId: null,
      };
    });
  } catch {
    // Any error — fall back to activities table
    const msgs = await InboxService.getThreadMessages(companyId, threadId);
    return normalizeEmailMessages(msgs, threadId);
  }
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
  return messages.map((msg) => {
    const rawBody = msg.bodyText || msg.content || "";
    return {
      id: msg.id,
      channel: "email" as const,
      direction: msg.direction ?? "inbound",
      senderName: extractEmailAddress(msg.fromEmail)?.split("@")[0] ?? "Unknown",
      senderEmail: extractEmailAddress(msg.fromEmail),
      content: stripQuotedContent(rawBody),
      timestamp: msg.createdAt,
      isRead: msg.isRead,
      hasAttachments: msg.hasAttachments,
      attachmentCount: msg.attachmentCount,
      attachments: [],
      emailThreadId,
      emailMessageId: msg.emailMessageId,
      subject: msg.subject,
      toEmails: msg.toEmails,
      ccEmails: msg.ccEmails,
      projectId: null,
      estimateId: null,
      invoiceId: null,
    };
  });
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
    attachments: [],
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

// ─── Client thread discovery (Gmail search) ───────────────────────────────

export interface ClientThreadSummary {
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

interface ClientThreadsResult {
  threads: ClientThreadSummary[];
  emails: string[];
  connectionEmail: string | null;
}

/**
 * Fetch the client-threads API — searches Gmail for all threads
 * involving a client's email addresses (primary + sub-clients).
 */
async function fetchClientThreads(
  companyId: string,
  clientId: string | null,
  email: string | null
): Promise<ClientThreadsResult> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  if (!idToken) return { threads: [], emails: [], connectionEmail: null };

  const params = new URLSearchParams({ companyId });
  if (clientId) params.set("clientId", clientId);
  else if (email) params.set("email", email);
  else return { threads: [], emails: [], connectionEmail: null };

  const res = await fetch(`/api/integrations/email/client-threads?${params}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) return { threads: [], emails: [], connectionEmail: null };

  const data = await res.json();
  return {
    threads: data.threads ?? [],
    emails: data.emails ?? [],
    connectionEmail: data.connectionEmail ?? null,
  };
}

// ─── Direction detection ───────────────────────────────────────────────────

/**
 * Determine if a message is outbound based on sender email.
 * Checks against both the Firebase auth email and the email connection address.
 */
function detectDirection(
  senderEmail: string,
  currentUserEmail: string | null,
  connectionEmail: string | null
): "inbound" | "outbound" {
  const senderLower = senderEmail.toLowerCase();

  // Check exact match against current user email
  if (currentUserEmail && senderLower === currentUserEmail.toLowerCase()) {
    return "outbound";
  }

  // Check exact match against email connection address
  if (connectionEmail && senderLower === connectionEmail.toLowerCase()) {
    return "outbound";
  }

  // Check domain match for custom/business domains (not gmail, outlook, etc.)
  const senderDomain = senderLower.split("@")[1];
  if (senderDomain && !isCommonEmailDomain(senderDomain)) {
    if (currentUserEmail) {
      const userDomain = currentUserEmail.toLowerCase().split("@")[1];
      if (senderDomain === userDomain) return "outbound";
    }
    if (connectionEmail) {
      const connDomain = connectionEmail.toLowerCase().split("@")[1];
      if (senderDomain === connDomain) return "outbound";
    }
  }

  return "inbound";
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
 * Discover ALL email threads for a client by searching Gmail/M365.
 * Returns thread summaries (subject, date, message count) and the connection email.
 */
export function useClientThreads(
  clientId: string | null,
  unmatchedEmail: string | null
) {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [
      ...queryKeys.inbox.all,
      "client-threads",
      companyId ?? "",
      clientId ?? "",
      unmatchedEmail ?? "",
    ],
    queryFn: () => fetchClientThreads(companyId!, clientId, unmatchedEmail),
    enabled: !!companyId && !!(clientId || unmatchedEmail),
    staleTime: 60_000, // Cache for 1 min — Gmail search is relatively slow
    refetchInterval: 60_000,
  });
}

/**
 * Fetch unified thread messages for a conversation.
 * Merges email thread messages + portal messages, applies channel filter.
 *
 * @param emailThreadIds - Thread IDs to fetch (from useClientThreads or fallback)
 * @param connectionEmail - The connected email address for direction detection
 */
export function useUnifiedThread(
  conversationId: string | null,
  clientId: string | null,
  emailThreadIds: string[],
  filter: ChannelFilter,
  connectionEmail?: string | null
) {
  const companyId = useAuthStore((s) => s.company?.id);
  const currentUserEmail = useAuthStore((s) => s.currentUser?.email);

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

      // Fetch email messages from provider (if filter allows)
      if (filter !== "portal" && emailThreadIds.length > 0) {
        const emailPromises = emailThreadIds.map((tid) =>
          fetchProviderThreadMessages(companyId!, tid)
        );
        const emailResults = await Promise.all(emailPromises);

        for (const msg of emailResults.flat()) {
          if (msg.senderEmail) {
            msg.direction = detectDirection(
              msg.senderEmail,
              currentUserEmail ?? null,
              connectionEmail ?? null
            );
          }
          results.push(msg);
        }
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
