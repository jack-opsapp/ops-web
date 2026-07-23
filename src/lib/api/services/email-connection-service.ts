import "server-only";

/**
 * Server-only email connection persistence.
 *
 * Rows contain provider credentials and synchronization secrets. Browser code
 * must use email-connection-browser-service, which crosses the authenticated
 * connection route and returns an explicitly projected public descriptor.
 */

import {
  parseDate,
  parseDateRequired,
  requireSupabase,
} from "@/lib/supabase/helpers";
import type {
  CreateEmailConnection,
  EmailConnection,
  UpdateEmailConnection,
} from "@/lib/types/email-connection";

function mapFromDb(row: Record<string, unknown>): EmailConnection {
  const type = row.type as EmailConnection["type"];
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as EmailConnection["provider"],
    type,
    // `email_connections.user_id` is transport ownership only for personal
    // mailboxes. Legacy company rows may still contain the user who connected
    // the mailbox; that value is never an OPS actor or authorization source.
    userId: type === "individual" ? ((row.user_id as string) ?? null) : null,
    defaultIntakeOwnerId:
      type === "company"
        ? ((row.default_intake_owner_id as string) ?? null)
        : null,
    email: row.email as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: parseDateRequired(row.expires_at),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: parseDate(row.last_synced_at),
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as EmailConnection["syncFilters"]) ?? {},
    historyRecoveryAnchor: parseDate(row.history_recovery_anchor),
    historyRecoveryPageToken:
      (row.history_recovery_page_token as string) ?? null,
    historyRecoveryTargetToken:
      (row.history_recovery_target_token as string) ?? null,
    webhookSubscriptionId: (row.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: parseDate(row.webhook_expires_at),
    webhookClientStateHash: (row.webhook_client_state_hash as string) ?? null,
    opsLabelId: (row.ops_label_id as string) ?? null,
    aiReviewEnabled: (row.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (row.ai_memory_enabled as boolean) ?? false,
    status: (row.status as EmailConnection["status"]) ?? "active",
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

export const EmailConnectionService = {
  async getConnections(companyId: string): Promise<EmailConnection[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_connections")
      .select("*")
      .eq("company_id", companyId)
      .neq("status", "disconnected")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch email connections: ${error.message}`);
    }
    return (data ?? []).map(mapFromDb);
  },

  async getConnection(connectionId: string): Promise<EmailConnection | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to fetch email connection: ${error.message}`);
    }
    return mapFromDb(data);
  },

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
        user_id: data.type === "individual" ? data.userId || null : null,
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

    if (error) {
      throw new Error(`Failed to create email connection: ${error.message}`);
    }
    return mapFromDb(row);
  },

  async updateConnection(
    connectionId: string,
    data: UpdateEmailConnection
  ): Promise<EmailConnection> {
    const supabase = requireSupabase();
    const row: Record<string, unknown> = {};

    if (data.syncEnabled !== undefined) row.sync_enabled = data.syncEnabled;
    if (data.syncIntervalMinutes !== undefined) {
      row.sync_interval_minutes = data.syncIntervalMinutes;
    }
    if (data.syncFilters !== undefined) row.sync_filters = data.syncFilters;
    if (data.historyId !== undefined) row.history_id = data.historyId;
    if (data.lastSyncedAt !== undefined) {
      row.last_synced_at = data.lastSyncedAt.toISOString();
    }
    if (data.historyRecoveryAnchor !== undefined) {
      row.history_recovery_anchor =
        data.historyRecoveryAnchor?.toISOString() ?? null;
    }
    if (data.historyRecoveryPageToken !== undefined) {
      row.history_recovery_page_token = data.historyRecoveryPageToken;
    }
    if (data.historyRecoveryTargetToken !== undefined) {
      row.history_recovery_target_token = data.historyRecoveryTargetToken;
    }
    if (data.webhookSubscriptionId !== undefined) {
      row.webhook_subscription_id = data.webhookSubscriptionId;
    }
    if (data.webhookExpiresAt !== undefined) {
      row.webhook_expires_at = data.webhookExpiresAt.toISOString();
    }
    if (data.webhookClientStateHash !== undefined) {
      row.webhook_client_state_hash = data.webhookClientStateHash;
    }
    if (data.opsLabelId !== undefined) row.ops_label_id = data.opsLabelId;
    if (data.aiReviewEnabled !== undefined) {
      row.ai_review_enabled = data.aiReviewEnabled;
    }
    if (data.aiMemoryEnabled !== undefined) {
      row.ai_memory_enabled = data.aiMemoryEnabled;
    }
    if (data.status !== undefined) row.status = data.status;
    if (data.accessToken !== undefined) row.access_token = data.accessToken;
    if (data.refreshToken !== undefined) row.refresh_token = data.refreshToken;
    if (data.expiresAt !== undefined) {
      row.expires_at = data.expiresAt.toISOString();
    }

    const { data: updated, error } = await supabase
      .from("email_connections")
      .update(row)
      .eq("id", connectionId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update email connection: ${error.message}`);
    }
    return mapFromDb(updated);
  },

  async configureCompanyMailboxIntakeOwner(input: {
    actorUserId: string;
    connectionId: string;
    expectedOwnerId: string | null;
    newOwnerId: string | null;
  }): Promise<EmailConnection> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(
      "configure_company_mailbox_intake_owner_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_connection_id: input.connectionId,
        p_expected_owner_id: input.expectedOwnerId,
        p_new_owner_id: input.newOwnerId,
      }
    );

    if (error) {
      const wrapped = new Error(
        `Failed to configure company mailbox intake owner: ${error.message}`
      );
      if (error.code === "40001") {
        wrapped.name = "CompanyMailboxIntakeOwnerConflictError";
      }
      throw wrapped;
    }

    const result = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      (result as Record<string, unknown>).conflict === true
    ) {
      const conflict = new Error(
        "Company mailbox intake owner changed before this update completed"
      );
      conflict.name = "CompanyMailboxIntakeOwnerConflictError";
      throw conflict;
    }
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      (result as Record<string, unknown>).ok !== true
    ) {
      const validation = new Error(
        `Company mailbox intake owner was rejected: ${String(
          (result as Record<string, unknown>).reason ?? "invalid_owner"
        )}`
      );
      validation.name = "CompanyMailboxIntakeOwnerValidationError";
      throw validation;
    }

    const { data: updated, error: readError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", input.connectionId)
      .single();
    if (readError) {
      throw new Error(
        `Failed to read configured company mailbox: ${readError.message}`
      );
    }
    return mapFromDb(updated);
  },

  async deleteConnection(connectionId: string): Promise<void> {
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
      .eq("id", connectionId);

    if (error) {
      throw new Error(
        `Failed to disconnect email connection: ${error.message}`
      );
    }
  },
};
