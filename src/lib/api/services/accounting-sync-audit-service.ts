import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingSyncAuditInput, AccountingSyncSnapshot } from "./accounting-sync-queue-types";

const BLOCKED_SNAPSHOT_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "webhookverifiertoken",
  "idtoken",
  "authorization",
  "apikey",
  "xapikey",
  "bearertoken",
  "privatekey",
]);

function isBlockedSnapshotKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    BLOCKED_SNAPSHOT_KEYS.has(normalized) ||
    normalized === "password" ||
    normalized.endsWith("password") ||
    normalized === "passphrase" ||
    normalized.endsWith("passphrase") ||
    normalized === "secret" ||
    normalized.endsWith("secret")
  );
}

function sanitizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSnapshotValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isBlockedSnapshotKey(key))
      .map(([key, nestedValue]) => [key, sanitizeSnapshotValue(nestedValue)])
  );
}

function sanitizeSnapshot(input: AccountingSyncSnapshot = {}): AccountingSyncSnapshot {
  return sanitizeSnapshotValue(input) as AccountingSyncSnapshot;
}

export class AccountingSyncAuditService {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(input: AccountingSyncAuditInput): Promise<string> {
    const { data, error } = await this.supabase
      .from("accounting_sync_events")
      .insert({
        queue_id: input.queueId ?? null,
        company_id: input.companyId,
        connection_id: input.connectionId ?? null,
        provider: input.provider,
        direction: input.direction,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        external_id: input.externalId ?? null,
        operation: input.operation,
        status: input.status,
        source: input.source,
        ops_updated_at: input.opsUpdatedAt ?? null,
        qb_updated_at: input.qbUpdatedAt ?? null,
        decision: input.decision ?? null,
        before_snapshot: sanitizeSnapshot(input.beforeSnapshot),
        after_snapshot: sanitizeSnapshot(input.afterSnapshot),
        error: input.error ?? null,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return String(data.id);
  }
}
