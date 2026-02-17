/**
 * OPS Web - Accounting Service
 *
 * Manages accounting provider connections (QuickBooks, Sage) and sync operations.
 * `getConnections` uses Supabase; OAuth and sync operations use Next.js API routes.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  AccountingConnection,
  AccountingProvider,
} from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapConnectionFromDb(
  row: Record<string, unknown>
): AccountingConnection {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as AccountingProvider,
    accessToken: (row.access_token as string) ?? null,
    refreshToken: (row.refresh_token as string) ?? null,
    tokenExpiresAt: parseDate(row.token_expires_at),
    realmId: (row.realm_id as string) ?? null,
    isConnected: (row.is_connected as boolean) ?? false,
    lastSyncAt: parseDate(row.last_sync_at),
    syncEnabled: (row.sync_enabled as boolean) ?? false,
    webhookVerifierToken: (row.webhook_verifier_token as string) ?? null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const AccountingService = {
  async getConnections(companyId: string): Promise<AccountingConnection[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("accounting_connections")
      .select("*")
      .eq("company_id", companyId);

    if (error)
      throw new Error(`Failed to fetch accounting connections: ${error.message}`);
    return (data ?? []).map(mapConnectionFromDb);
  },

  // ─── OAuth & Sync (Next.js API routes — unchanged) ─────────────────────────

  async initiateOAuth(
    companyId: string,
    provider: AccountingProvider
  ): Promise<{ authUrl: string }> {
    const response = await fetch(`/api/integrations/${provider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to initiate ${provider} OAuth`);
    }

    return response.json();
  },

  async disconnectProvider(
    companyId: string,
    provider: AccountingProvider
  ): Promise<void> {
    await fetch(`/api/integrations/${provider}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
  },

  async triggerSync(
    companyId: string,
    provider: AccountingProvider
  ): Promise<void> {
    await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, provider }),
    });
  },

  async getSyncHistory(
    companyId: string
  ): Promise<
    Array<{
      id: string;
      provider: string;
      status: string;
      timestamp: Date;
      details: string | null;
    }>
  > {
    const response = await fetch(`/api/sync?companyId=${companyId}`);
    if (!response.ok) return [];
    return response.json();
  },
};
