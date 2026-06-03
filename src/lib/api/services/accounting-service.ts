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
    // OAuth secrets (access_token / refresh_token) and the customer-identifying
    // realm_id are NEVER read into the client bundle (Intuit security req):
    // they are encrypted at rest and only the server decrypts them. The client
    // model carries `null` so the UI can never render or leak them.
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: parseDate(row.token_expires_at),
    realmId: null,
    isConnected: (row.is_connected as boolean) ?? false,
    lastSyncAt: parseDate(row.last_sync_at),
    syncEnabled: (row.sync_enabled as boolean) ?? false,
    webhookVerifierToken: null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const AccountingService = {
  async getConnections(companyId: string): Promise<AccountingConnection[]> {
    const supabase = requireSupabase();

    // Select only non-secret columns. Never pull access_token / refresh_token /
    // realm_id / webhook_verifier_token into the client (Intuit security req).
    const { data, error } = await supabase
      .from("accounting_connections")
      .select(
        "id, company_id, provider, token_expires_at, is_connected, last_sync_at, sync_enabled, created_at, updated_at"
      )
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
      const errorBody = await response.json().catch(() => null);
      throw new Error(
        errorBody?.error || `Failed to initiate ${provider} OAuth`
      );
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

  async updateSyncEnabled(
    companyId: string,
    provider: AccountingProvider,
    syncEnabled: boolean
  ): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("accounting_connections")
      .update({ sync_enabled: syncEnabled, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("provider", provider);
    if (error) throw new Error(`Failed to update sync enabled: ${error.message}`);
  },

  async triggerSync(
    companyId: string,
    provider: AccountingProvider
  ): Promise<void> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ companyId, provider }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.error || "Sync failed");
    }
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
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch(`/api/sync?companyId=${companyId}`, {
      headers: {
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
    });
    if (!response.ok) return [];
    return response.json();
  },
};
