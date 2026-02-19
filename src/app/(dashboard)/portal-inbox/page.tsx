"use client";

/**
 * OPS Web - Portal Inbox Page
 *
 * Admin-side inbox for viewing and replying to client portal messages.
 * Uses direct Supabase queries (via requireSupabase) for data fetching
 * since this is an authenticated admin route.
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import { useAuthStore, selectCompanyId } from "@/lib/store/auth-store";
import {
  PortalInbox,
  type Conversation,
} from "@/components/ops/portal-inbox";
import type {
  PortalMessage,
  PortalMessageSender,
} from "@/lib/types/portal";
import { Loader2 } from "lucide-react";

// ─── Query Keys ──────────────────────────────────────────────────────────────

const inboxKeys = {
  all: ["portal-inbox"] as const,
  conversations: () => [...inboxKeys.all, "conversations"] as const,
  messages: (clientId: string) =>
    [...inboxKeys.all, "messages", clientId] as const,
};

// ─── Database Mapping ────────────────────────────────────────────────────────

function mapMessageFromDb(row: Record<string, unknown>): PortalMessage {
  return {
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
  };
}

// ─── Data Fetching Helpers ───────────────────────────────────────────────────

async function fetchConversations(
  companyId: string
): Promise<Conversation[]> {
  const supabase = requireSupabase();

  // Fetch all messages for this company, newest first
  const { data: messages, error } = await supabase
    .from("portal_messages")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch conversations: ${error.message}`);
  if (!messages || messages.length === 0) return [];

  // Group by client_id
  const clientMap = new Map<string, Conversation>();

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

    // Count unread messages from clients (sender_type = 'client')
    if (
      (row.sender_type as string) === "client" &&
      row.read_at == null
    ) {
      clientMap.get(clientId)!.unreadCount += 1;
    }
  }

  // Fetch actual client names from the clients table
  const clientIds = Array.from(clientMap.keys());
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

  // Sort by most recent message first
  return Array.from(clientMap.values()).sort(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
  );
}

async function fetchMessages(
  companyId: string,
  clientId: string
): Promise<PortalMessage[]> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("portal_messages")
    .select("*")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
  return (data ?? []).map(mapMessageFromDb);
}

async function sendAdminMessage(
  companyId: string,
  clientId: string,
  content: string,
  senderName: string
): Promise<PortalMessage> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("portal_messages")
    .insert({
      company_id: companyId,
      client_id: clientId,
      sender_type: "company",
      sender_name: senderName,
      content,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to send message: ${error.message}`);
  return mapMessageFromDb(data);
}

async function markClientMessagesRead(
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

// ─── Page Component ──────────────────────────────────────────────────────────

export default function PortalInboxPage() {
  const companyId = useAuthStore(selectCompanyId);
  const currentUser = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const senderName = currentUser
    ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() ||
      currentUser.email ||
      "Admin"
    : "Admin";

  // ─── Conversations Query ────────────────────────────────────────────

  const {
    data: conversations = [],
    isLoading: isLoadingConversations,
  } = useQuery({
    queryKey: inboxKeys.conversations(),
    queryFn: () => fetchConversations(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000, // Poll every 30 seconds for new messages
  });

  // ─── Messages Query ─────────────────────────────────────────────────

  const {
    data: messages = [],
    isLoading: isLoadingMessages,
  } = useQuery({
    queryKey: inboxKeys.messages(selectedClientId ?? ""),
    queryFn: () => fetchMessages(companyId!, selectedClientId!),
    enabled: !!companyId && !!selectedClientId,
    refetchInterval: 15_000, // Poll every 15 seconds for active thread
  });

  // ─── Send Message Mutation ──────────────────────────────────────────

  const sendMessageMutation = useMutation({
    mutationFn: (content: string) =>
      sendAdminMessage(companyId!, selectedClientId!, content, senderName),
    onSuccess: () => {
      // Invalidate messages for this conversation
      queryClient.invalidateQueries({
        queryKey: inboxKeys.messages(selectedClientId!),
      });
      // Invalidate conversations to update preview
      queryClient.invalidateQueries({
        queryKey: inboxKeys.conversations(),
      });
    },
  });

  // ─── Mark Read Handler ──────────────────────────────────────────────

  const handleMarkRead = useCallback(
    async (clientId: string) => {
      if (!companyId) return;
      try {
        await markClientMessagesRead(companyId, clientId);
        // Invalidate to update unread counts
        queryClient.invalidateQueries({
          queryKey: inboxKeys.conversations(),
        });
      } catch {
        // Silently fail - non-critical operation
      }
    },
    [companyId, queryClient]
  );

  // Auto-select first conversation if none selected
  useEffect(() => {
    if (!selectedClientId && conversations.length > 0) {
      setSelectedClientId(conversations[0].clientId);
    }
  }, [conversations, selectedClientId]);

  // ─── Loading Gate ───────────────────────────────────────────────────

  if (!companyId) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-2 max-w-[1400px]">
      <div>
        <h1 className="font-mohave text-display text-text-primary">
          Portal Inbox
        </h1>
        <p className="font-kosugi text-caption-sm text-text-tertiary mt-[4px] uppercase">
          Client portal messages and conversations
        </p>
      </div>

      <PortalInbox
        conversations={conversations}
        isLoadingConversations={isLoadingConversations}
        selectedClientId={selectedClientId}
        onSelectConversation={setSelectedClientId}
        messages={messages}
        isLoadingMessages={isLoadingMessages}
        onSendMessage={(content) => sendMessageMutation.mutate(content)}
        isSending={sendMessageMutation.isPending}
        onMarkRead={handleMarkRead}
      />
    </div>
  );
}
