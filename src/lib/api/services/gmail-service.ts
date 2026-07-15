/**
 * OPS Web - Gmail Service
 *
 * Thin wrapper around the email_connections table for the Settings UI:
 * connection list, update, delete, and the inbox-leads review queue. All
 * sync execution now lives in SyncEngine (which the cron, manual-sync
 * route, and webhooks call) — this file stays around because the UI hooks
 * still reach for `GmailService.getInboxLeads` / `ignoreInboxLead` /
 * `getConnections` / `updateConnection` / `deleteConnection`.
 *
 * The legacy `syncInbox` method (plus its _processMessage / _getClientEmail
 * helpers) and the 3-tier `EmailMatchingService` (v1) it depended on were
 * removed — no callers remained after the email-sync pipeline rebuild
 * migrated every sync path to SyncEngine + EmailMatchingServiceV2.
 */

import {
  requireSupabase,
  parseDate,
  parseDateRequired,
} from "@/lib/supabase/helpers";
import type {
  GmailConnection,
  CreateGmailConnection,
  UpdateGmailConnection,
  GmailSyncFilters,
} from "@/lib/types/pipeline";
import { DEFAULT_SYNC_FILTERS } from "@/lib/types/pipeline";

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
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as GmailSyncFilters) ?? DEFAULT_SYNC_FILTERS,
    status: (row.status as GmailConnection["status"]) ?? "setup_incomplete",
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const GmailService = {
  async getConnections(companyId: string): Promise<GmailConnection[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("email_connections")
      .select("*")
      .eq("company_id", companyId)
      .neq("status", "disconnected")
      .order("created_at");

    if (error)
      throw new Error(`Failed to fetch Gmail connections: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async createConnection(
    data: CreateGmailConnection
  ): Promise<GmailConnection> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("email_connections")
      .insert({
        company_id: data.companyId,
        type: data.type,
        user_id: data.userId,
        email: data.email,
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at:
          data.expiresAt instanceof Date
            ? data.expiresAt.toISOString()
            : data.expiresAt,
        history_id: data.historyId,
        sync_enabled: data.syncEnabled ?? true,
      })
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create Gmail connection: ${error.message}`);
    return mapFromDb(created);
  },

  async updateConnection(
    id: string,
    data: UpdateGmailConnection
  ): Promise<GmailConnection> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (data.accessToken !== undefined) row.access_token = data.accessToken;
    if (data.refreshToken !== undefined) row.refresh_token = data.refreshToken;
    if (data.expiresAt !== undefined) {
      row.expires_at =
        data.expiresAt instanceof Date
          ? data.expiresAt.toISOString()
          : data.expiresAt;
    }
    if (data.historyId !== undefined) row.history_id = data.historyId;
    if (data.syncEnabled !== undefined) row.sync_enabled = data.syncEnabled;
    if (data.syncIntervalMinutes !== undefined)
      row.sync_interval_minutes = data.syncIntervalMinutes;
    if (data.syncFilters !== undefined) row.sync_filters = data.syncFilters;
    if (data.lastSyncedAt !== undefined) {
      row.last_synced_at =
        data.lastSyncedAt instanceof Date
          ? data.lastSyncedAt.toISOString()
          : data.lastSyncedAt;
    }

    const { data: updated, error } = await supabase
      .from("email_connections")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update Gmail connection: ${error.message}`);
    return mapFromDb(updated);
  },

  async deleteConnection(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("email_connections")
      .update({
        status: "disconnected",
        sync_enabled: false,
        access_token: "",
        refresh_token: "",
        webhook_subscription_id: null,
        webhook_expires_at: null,
        webhook_client_state_hash: null,
        history_recovery_anchor: null,
        history_recovery_page_token: null,
        history_recovery_target_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error)
      throw new Error(
        `Failed to disconnect Gmail connection: ${error.message}`
      );
  },

  /**
   * Returns unread Activities of type 'email' that don't have an opportunityId
   * (i.e., emails from unknown senders or new inquiries).
   */
  async getInboxLeads(companyId: string): Promise<
    Array<{
      messageId: string;
      threadId: string;
      subject: string;
      snippet: string;
      fromEmail: string;
      activityId: string;
      needsReview: boolean;
    }>
  > {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("activities")
      .select(
        "id, email_message_id, email_thread_id, subject, content, from_email, match_needs_review"
      )
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
      needsReview: (row.match_needs_review as boolean) ?? false,
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
