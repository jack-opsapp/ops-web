/**
 * OPS Web - Portal Message Service
 *
 * Client-company messaging for the OPS client portal.
 * Uses service role key since portal users have no Firebase auth.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  PortalMessage,
  CreatePortalMessage,
  PortalMessageSender,
} from "@/lib/types/portal";

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

function mapMessageToDb(data: CreatePortalMessage): Record<string, unknown> {
  const row: Record<string, unknown> = {
    company_id: data.companyId,
    client_id: data.clientId,
    sender_type: data.senderType,
    sender_name: data.senderName,
    content: data.content,
  };

  if (data.projectId !== undefined) row.project_id = data.projectId;
  if (data.estimateId !== undefined) row.estimate_id = data.estimateId;
  if (data.invoiceId !== undefined) row.invoice_id = data.invoiceId;

  return row;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const PortalMessageService = {
  /**
   * Fetch paginated messages between a client and company.
   * Newest first. Optionally filter by project, estimate, or invoice.
   */
  async getMessages(
    clientId: string,
    companyId: string,
    options?: {
      projectId?: string;
      estimateId?: string;
      invoiceId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<PortalMessage[]> {
    const supabase = getServiceRoleClient();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let query = supabase
      .from("portal_messages")
      .select("*")
      .eq("client_id", clientId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (options?.projectId) {
      query = query.eq("project_id", options.projectId);
    }
    if (options?.estimateId) {
      query = query.eq("estimate_id", options.estimateId);
    }
    if (options?.invoiceId) {
      query = query.eq("invoice_id", options.invoiceId);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
    return (data ?? []).map(mapMessageFromDb);
  },

  /**
   * Send a new message in a client-company conversation.
   */
  async sendMessage(data: CreatePortalMessage): Promise<PortalMessage> {
    const supabase = getServiceRoleClient();

    const { data: created, error } = await supabase
      .from("portal_messages")
      .insert(mapMessageToDb(data))
      .select()
      .single();

    if (error) throw new Error(`Failed to send message: ${error.message}`);
    return mapMessageFromDb(created);
  },

  /**
   * Mark a single message as read (sets read_at to now).
   */
  async markRead(messageId: string): Promise<void> {
    const supabase = getServiceRoleClient();

    const { error } = await supabase
      .from("portal_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("id", messageId);

    if (error) throw new Error(`Failed to mark message as read: ${error.message}`);
  },

  /**
   * Mark all messages from the company to this client as read.
   * (Only marks company -> client messages, since those are the ones
   * the client hasn't read yet.)
   */
  async markAllRead(clientId: string, companyId: string): Promise<void> {
    const supabase = getServiceRoleClient();

    const { error } = await supabase
      .from("portal_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("company_id", companyId)
      .eq("sender_type", "company")
      .is("read_at", null);

    if (error) throw new Error(`Failed to mark all messages as read: ${error.message}`);
  },

  /**
   * Count unread messages for a client (messages sent by company that
   * the client hasn't read).
   */
  async getUnreadCount(clientId: string, companyId: string): Promise<number> {
    const supabase = getServiceRoleClient();

    const { count, error } = await supabase
      .from("portal_messages")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("company_id", companyId)
      .eq("sender_type", "company")
      .is("read_at", null);

    if (error) throw new Error(`Failed to get unread count: ${error.message}`);
    return count ?? 0;
  },

  /**
   * Count all unread messages from clients for a company
   * (messages sent by any client that the company hasn't read).
   */
  async getUnreadCountForCompany(companyId: string): Promise<number> {
    const supabase = getServiceRoleClient();

    const { count, error } = await supabase
      .from("portal_messages")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("sender_type", "client")
      .is("read_at", null);

    if (error) throw new Error(`Failed to get company unread count: ${error.message}`);
    return count ?? 0;
  },

  /**
   * Get conversation list for the admin inbox.
   * Groups messages by client, returning the latest message preview
   * and unread count for each client conversation.
   */
  async getConversations(
    companyId: string
  ): Promise<
    Array<{
      clientId: string;
      clientName: string;
      lastMessage: string;
      lastMessageAt: Date;
      unreadCount: number;
    }>
  > {
    const supabase = getServiceRoleClient();

    // Fetch all messages for this company, newest first
    const { data: messages, error } = await supabase
      .from("portal_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch conversations: ${error.message}`);
    if (!messages || messages.length === 0) return [];

    // Group by client_id
    const clientMap = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        lastMessage: string;
        lastMessageAt: Date;
        unreadCount: number;
      }
    >();

    for (const row of messages) {
      const clientId = row.client_id as string;

      if (!clientMap.has(clientId)) {
        // First message we see for this client is the latest (ordered desc)
        clientMap.set(clientId, {
          clientId,
          clientName: row.sender_name as string,
          lastMessage: row.content as string,
          lastMessageAt: parseDateRequired(row.created_at),
          unreadCount: 0,
        });
      }

      // Count unread messages from this client (sender_type = 'client')
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
        if (entry) {
          entry.clientName = client.name as string;
        }
      }
    }

    // Sort by most recent message first
    return Array.from(clientMap.values()).sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
    );
  },
};
