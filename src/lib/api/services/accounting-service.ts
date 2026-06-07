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
    providerEnvironment:
      row.provider_environment === "sandbox" ? "sandbox" : "production",
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
    syncDirection:
      (row.sync_direction as "pull_only" | "push_only" | "bidirectional") ?? "pull_only",
    propagateDeletes: (row.propagate_deletes as boolean) ?? false,
    webhookVerifierToken: null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

export interface AccountingSyncIssue {
  id: string;
  entityType: "customer" | "invoice" | "estimate" | "payment";
  entityId: string;
  externalId: string | null;
  operation: "create" | "update" | "void" | "inactivate" | "delete_soft" | "link" | "reconcile";
  status: "blocked" | "needs_review";
  lastError: string | null;
  updatedAt: Date;
}

function mapSyncIssue(row: Record<string, unknown>): AccountingSyncIssue {
  const updatedAt = parseDate(row.updatedAt as string | null | undefined) ?? new Date(0);

  return {
    id: String(row.id),
    entityType: row.entityType as AccountingSyncIssue["entityType"],
    entityId: String(row.entityId),
    externalId: (row.externalId as string | null) ?? null,
    operation: row.operation as AccountingSyncIssue["operation"],
    status: row.status as AccountingSyncIssue["status"],
    lastError: (row.lastError as string | null) ?? null,
    updatedAt,
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
        "id, company_id, provider, provider_environment, token_expires_at, is_connected, last_sync_at, sync_enabled, sync_direction, propagate_deletes, created_at, updated_at"
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
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch(`/api/integrations/${provider}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
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
    provider: AccountingProvider,
    providerEnvironment?: "production" | "sandbox"
  ): Promise<void> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch(`/api/integrations/${provider}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        companyId,
        ...(providerEnvironment ? { providerEnvironment } : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.error || `Failed to disconnect ${provider}`);
    }
  },

  async updateSyncEnabled(
    companyId: string,
    provider: AccountingProvider,
    syncEnabled: boolean
  ): Promise<void> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch("/api/integrations/accounting/sync-enabled", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ companyId, provider, syncEnabled }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.error || "Failed to update sync enabled");
    }
  },

  /**
   * Set the connection's sync mode (read-only ↔ full CRUD) + delete-propagation.
   * Goes through a service-role API route — the client cannot write
   * accounting_connections directly (RLS). Selecting "bidirectional" records the
   * choice; provider writes still require ACCOUNTING_WRITE_ENABLED=true.
   */
  async updateSyncMode(
    companyId: string,
    provider: AccountingProvider,
    syncDirection: "pull_only" | "bidirectional",
    propagateDeletes: boolean
  ): Promise<{ writesEnabled: boolean }> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch("/api/integrations/accounting/sync-mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ companyId, provider, syncDirection, propagateDeletes }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.error || "Failed to update sync mode");
    }
    return response.json();
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

  async getSyncIssues(companyId: string): Promise<AccountingSyncIssue[]> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const response = await fetch(
      `/api/integrations/accounting/sync-issues?companyId=${companyId}`,
      {
        headers: {
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
      }
    );
    if (!response.ok) return [];
    const body = await response.json().catch(() => ({ issues: [] }));
    return ((body.issues ?? []) as Record<string, unknown>[]).map(mapSyncIssue);
  },
};
