/**
 * OPS Web - Gmail Service
 *
 * Manages Gmail OAuth connections and email syncing.
 * Stores tokens in Supabase gmail_connections table.
 * Syncs inbox using Gmail History API to auto-log Activities.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  GmailConnection,
  CreateGmailConnection,
  UpdateGmailConnection,
} from "@/lib/types/pipeline";
import { ActivityType, OpportunityStage } from "@/lib/types/pipeline";
import { OpportunityService } from "./opportunity-service";
import { ClientService } from "./client-service";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): GmailConnection {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    type: row.type as GmailConnection["type"],
    userId: (row.user_id as string) ?? null,
    email: row.email as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: parseDateRequired(row.expires_at),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: parseDate(row.last_synced_at),
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

// ─── Gmail API response types ─────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  threadId: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; body: { data?: string } }>;
    body?: { data?: string };
  };
  snippet?: string;
  labelIds?: string[];
}

interface GmailHistoryResponse {
  history?: Array<{
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

// ─── Token refresh helper ─────────────────────────────────────────────────────

async function refreshAccessToken(connection: GmailConnection): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const json = await response.json();
  if (!json.access_token) throw new Error("Failed to refresh Gmail access token");

  // Persist updated token
  const supabase = requireSupabase();
  await supabase
    .from("gmail_connections")
    .update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("id", connection.id);

  return json.access_token as string;
}

async function getValidToken(connection: GmailConnection): Promise<string> {
  if (connection.expiresAt > new Date(Date.now() + 60_000)) {
    return connection.accessToken;
  }
  return refreshAccessToken(connection);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const GmailService = {
  async getConnections(companyId: string): Promise<GmailConnection[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("gmail_connections")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at");

    if (error) throw new Error(`Failed to fetch Gmail connections: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async createConnection(data: CreateGmailConnection): Promise<GmailConnection> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("gmail_connections")
      .insert({
        company_id: data.companyId,
        type: data.type,
        user_id: data.userId,
        email: data.email,
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresAt instanceof Date
          ? data.expiresAt.toISOString()
          : data.expiresAt,
        history_id: data.historyId,
        sync_enabled: data.syncEnabled ?? true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create Gmail connection: ${error.message}`);
    return mapFromDb(created);
  },

  async updateConnection(id: string, data: UpdateGmailConnection): Promise<GmailConnection> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (data.accessToken !== undefined) row.access_token = data.accessToken;
    if (data.refreshToken !== undefined) row.refresh_token = data.refreshToken;
    if (data.expiresAt !== undefined) {
      row.expires_at = data.expiresAt instanceof Date
        ? data.expiresAt.toISOString()
        : data.expiresAt;
    }
    if (data.historyId !== undefined) row.history_id = data.historyId;
    if (data.syncEnabled !== undefined) row.sync_enabled = data.syncEnabled;
    if (data.lastSyncedAt !== undefined) {
      row.last_synced_at = data.lastSyncedAt instanceof Date
        ? data.lastSyncedAt.toISOString()
        : data.lastSyncedAt;
    }

    const { data: updated, error } = await supabase
      .from("gmail_connections")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update Gmail connection: ${error.message}`);
    return mapFromDb(updated);
  },

  async deleteConnection(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("gmail_connections")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`Failed to delete Gmail connection: ${error.message}`);
  },

  /**
   * Sync inbox for a single connection using Gmail History API.
   * Creates Activity records for emails matched to known clients.
   * Returns count of new activities created.
   */
  async syncInbox(connectionId: string): Promise<{ activitiesCreated: number }> {
    const supabase = requireSupabase();

    // Load connection
    const { data: connRow, error: connError } = await supabase
      .from("gmail_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (connError) throw new Error(`Connection not found: ${connError.message}`);
    const connection = mapFromDb(connRow);

    if (!connection.syncEnabled) return { activitiesCreated: 0 };

    const token = await getValidToken(connection);

    // First sync: fetch current historyId from Gmail profile as a baseline,
    // store it, and return 0 activities. Subsequent syncs use incremental history.
    if (!connection.historyId) {
      const profileResp = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const profile = await profileResp.json() as { historyId?: string };
      if (profile.historyId) {
        await supabase
          .from("gmail_connections")
          .update({ history_id: profile.historyId, last_synced_at: new Date().toISOString() })
          .eq("id", connectionId);
      }
      return { activitiesCreated: 0 };
    }

    // Fetch history since last sync
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/history?historyTypes=messageAdded&startHistoryId=${connection.historyId}`;

    const historyResp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const history: GmailHistoryResponse = await historyResp.json();

    let activitiesCreated = 0;
    const newHistoryId = history.historyId;

    const messageIds: string[] = [];
    for (const h of history.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        messageIds.push(added.message.id);
      }
    }

    // Load all clients for matching
    const { clients } = await ClientService.fetchClients(connection.companyId);
    const emailToClientId = new Map<string, string>();
    for (const client of clients) {
      if (client.email) emailToClientId.set(client.email.toLowerCase(), client.id);
    }

    for (const msgId of messageIds) {
      try {
        const msgResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const msg: GmailMessage = await msgResp.json();

        const headers = msg.payload?.headers ?? [];
        const from = headers.find((h) => h.name === "From")?.value ?? "";
        const to = headers.find((h) => h.name === "To")?.value ?? "";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        const threadId = msg.threadId;

        // Extract email address from "Name <email>" format
        const fromEmail = (from.match(/<(.+?)>/) ?? [, from])[1]?.toLowerCase() ?? "";
        const toEmail = (to.match(/<(.+?)>/) ?? [, to])[1]?.toLowerCase() ?? "";

        const isInbound = !!emailToClientId.get(fromEmail);
        const matchedEmail = isInbound ? fromEmail : emailToClientId.has(toEmail) ? toEmail : null;
        const clientId = matchedEmail ? emailToClientId.get(matchedEmail) ?? null : null;

        // Dedup: check if we already have this message
        const { data: existing } = await supabase
          .from("activities")
          .select("id")
          .eq("email_message_id", msgId)
          .limit(1);

        if ((existing ?? []).length > 0) continue;

        // Find open opportunity for matched client
        let opportunityId: string | null = null;
        if (clientId) {
          const opps = await OpportunityService.fetchOpportunities(connection.companyId, {
            clientId,
            stages: [
              OpportunityStage.NewLead,
              OpportunityStage.Qualifying,
              OpportunityStage.Quoting,
              OpportunityStage.Quoted,
              OpportunityStage.FollowUp,
              OpportunityStage.Negotiation,
            ],
          });
          opportunityId = opps[0]?.id ?? null;
        }

        // Create activity (with or without client match — unmatched become inbox leads)
        await OpportunityService.createActivity({
          companyId: connection.companyId,
          opportunityId,
          clientId,
          estimateId: null,
          invoiceId: null,
          projectId: null,
          siteVisitId: null,
          type: ActivityType.Email,
          subject,
          content: msg.snippet ?? null,
          outcome: null,
          direction: isInbound ? "inbound" : "outbound",
          durationMinutes: null,
          attachments: [],
          emailThreadId: threadId,
          emailMessageId: msgId,
          isRead: !!clientId, // Unmatched emails are unread (show in inbox leads)
          fromEmail: fromEmail || null,
          createdBy: null,
        });

        activitiesCreated++;
      } catch {
        // Skip individual message failures
      }
    }

    // Update historyId and lastSyncedAt
    if (newHistoryId) {
      await supabase
        .from("gmail_connections")
        .update({
          history_id: newHistoryId,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", connectionId);
    }

    return { activitiesCreated };
  },

  /**
   * Returns unread Activities of type 'email' that don't have an opportunityId
   * (i.e., emails from unknown senders or new inquiries).
   */
  async getInboxLeads(companyId: string): Promise<Array<{
    messageId: string;
    threadId: string;
    subject: string;
    snippet: string;
    fromEmail: string;
    activityId: string;
  }>> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("activities")
      .select("id, email_message_id, email_thread_id, subject, content, from_email")
      .eq("company_id", companyId)
      .eq("type", "email")
      .is("opportunity_id", null)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(`Failed to fetch inbox leads: ${error.message}`);

    return (data ?? []).map((row) => ({
      activityId: row.id as string,
      messageId: (row.email_message_id as string) ?? "",
      threadId: (row.email_thread_id as string) ?? "",
      subject: (row.subject as string) ?? "(no subject)",
      snippet: (row.content as string) ?? "",
      fromEmail: (row.from_email as string) ?? "",
    }));
  },

  /**
   * Mark an inbox lead activity as read (ignore/dismiss it).
   */
  async ignoreInboxLead(activityId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("activities")
      .update({ is_read: true })
      .eq("id", activityId);

    if (error) throw new Error(`Failed to ignore inbox lead: ${error.message}`);
  },
};
