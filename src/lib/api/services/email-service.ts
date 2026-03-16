/**
 * OPS Web - Email Service
 *
 * High-level email service — delegates to provider-specific implementations.
 * Manages email connections in the email_connections table.
 *
 * Uses requireSupabase() for client-side access (same pattern as GmailService).
 * API routes should use getServiceRoleClient() with setSupabaseOverride() before
 * calling these methods.
 */

import {
  requireSupabase,
  parseDate,
  parseDateRequired,
} from "@/lib/supabase/helpers";
import type {
  EmailConnection,
  CreateEmailConnection,
  UpdateEmailConnection,
} from "@/lib/types/email-connection";
import type { EmailProviderInterface } from "./email-provider";
import { GmailProvider } from "./providers/gmail-provider";
import { Microsoft365Provider } from "./providers/microsoft365-provider";

// ─── Database ↔ TypeScript Mapping ──────────────────────────────────────────

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
    expiresAt: parseDateRequired(row.expires_at),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: parseDate(row.last_synced_at),
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as EmailConnection["syncFilters"]) ?? {},
    webhookSubscriptionId: (row.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: parseDate(row.webhook_expires_at),
    opsLabelId: (row.ops_label_id as string) ?? null,
    aiReviewEnabled: (row.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (row.ai_memory_enabled as boolean) ?? false,
    status: (row.status as EmailConnection["status"]) ?? "active",
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const EmailService = {
  /**
   * Get provider implementation for a connection.
   */
  getProvider(connection: EmailConnection): EmailProviderInterface {
    switch (connection.provider) {
      case "gmail":
        return new GmailProvider(connection);
      case "microsoft365":
        return new Microsoft365Provider(connection);
      default:
        throw new Error(`Unknown provider: ${connection.provider}`);
    }
  },

  /**
   * Fetch all email connections for a company.
   */
  async getConnections(companyId: string): Promise<EmailConnection[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("email_connections")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error)
      throw new Error(`Failed to fetch email connections: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /**
   * Get a single connection by ID.
   */
  async getConnection(connectionId: string): Promise<EmailConnection | null> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      throw new Error(`Failed to fetch email connection: ${error.message}`);
    }
    return mapFromDb(data);
  },

  /**
   * Create a new email connection.
   */
  async createConnection(
    data: CreateEmailConnection
  ): Promise<EmailConnection> {
    const supabase = requireSupabase();

    const { data: row, error } = await supabase
      .from("email_connections")
      .insert({
        company_id: data.companyId,
        provider: data.provider,
        type: data.type,
        user_id: data.userId || null,
        email: data.email,
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresAt.toISOString(),
        sync_enabled: true,
        sync_interval_minutes: 60,
        status: "setup_incomplete",
      })
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create email connection: ${error.message}`);
    return mapFromDb(row);
  },

  /**
   * Update an existing connection.
   */
  async updateConnection(
    connectionId: string,
    data: UpdateEmailConnection
  ): Promise<EmailConnection> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};

    if (data.syncEnabled !== undefined) row.sync_enabled = data.syncEnabled;
    if (data.syncIntervalMinutes !== undefined)
      row.sync_interval_minutes = data.syncIntervalMinutes;
    if (data.syncFilters !== undefined) row.sync_filters = data.syncFilters;
    if (data.historyId !== undefined) row.history_id = data.historyId;
    if (data.lastSyncedAt !== undefined) {
      row.last_synced_at =
        data.lastSyncedAt instanceof Date
          ? data.lastSyncedAt.toISOString()
          : data.lastSyncedAt;
    }
    if (data.webhookSubscriptionId !== undefined)
      row.webhook_subscription_id = data.webhookSubscriptionId;
    if (data.webhookExpiresAt !== undefined) {
      row.webhook_expires_at =
        data.webhookExpiresAt instanceof Date
          ? data.webhookExpiresAt.toISOString()
          : data.webhookExpiresAt;
    }
    if (data.opsLabelId !== undefined) row.ops_label_id = data.opsLabelId;
    if (data.aiReviewEnabled !== undefined)
      row.ai_review_enabled = data.aiReviewEnabled;
    if (data.aiMemoryEnabled !== undefined)
      row.ai_memory_enabled = data.aiMemoryEnabled;
    if (data.status !== undefined) row.status = data.status;

    const { data: updated, error } = await supabase
      .from("email_connections")
      .update(row)
      .eq("id", connectionId)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update email connection: ${error.message}`);
    return mapFromDb(updated);
  },

  /**
   * Delete a connection.
   */
  async deleteConnection(connectionId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("email_connections")
      .delete()
      .eq("id", connectionId);

    if (error)
      throw new Error(`Failed to delete email connection: ${error.message}`);
  },
};
