import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingSyncProvider, AccountingSyncQueueRow } from "./accounting-sync-queue-types";

type QueueDbRow = Record<string, unknown>;
type WorkerGuard = { workerId: string };

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function stringValue(value: unknown): string {
  return String(value ?? "");
}

function mapQueueRow(row: QueueDbRow): AccountingSyncQueueRow {
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    connectionId: stringValue(row.connection_id),
    provider: row.provider as AccountingSyncQueueRow["provider"],
    entityType: row.entity_type as AccountingSyncQueueRow["entityType"],
    entityId: stringValue(row.entity_id),
    externalId: stringOrNull(row.external_id),
    operation: row.operation as AccountingSyncQueueRow["operation"],
    sourceTable: stringValue(row.source_table),
    sourceAction: stringValue(row.source_action),
    sourceUpdatedAt: stringOrNull(row.source_updated_at),
    idempotencyKey: stringValue(row.idempotency_key),
    status: row.status as AccountingSyncQueueRow["status"],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    runAfter: stringValue(row.run_after),
    lockedAt: stringOrNull(row.locked_at),
    lockedBy: stringOrNull(row.locked_by),
    lastError: stringOrNull(row.last_error),
    payloadSnapshot: (row.payload_snapshot as Record<string, unknown> | null) ?? {},
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(60 * 60, Math.max(30, 30 * 2 ** Math.max(0, attempts - 1)));
}

export class AccountingSyncQueueService {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimDue(input: {
    provider: AccountingSyncProvider;
    limit: number;
    workerId: string;
  }): Promise<AccountingSyncQueueRow[]> {
    const { data, error } = await this.supabase.rpc("claim_accounting_sync_queue", {
      p_provider: input.provider,
      p_limit: input.limit,
      p_worker_id: input.workerId,
    });

    if (error) {
      throw error;
    }

    return ((data ?? []) as QueueDbRow[]).map(mapQueueRow);
  }

  async markSucceeded(id: string, input: { externalId?: string | null; workerId: string }): Promise<void> {
    await this.updateQueueRow(
      id,
      {
        status: "succeeded",
        external_id: input.externalId ?? null,
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { workerId: input.workerId }
    );
  }

  async scheduleRetry(
    row: AccountingSyncQueueRow,
    errorMessage: string,
    guard: WorkerGuard
  ): Promise<AccountingSyncQueueRow | null> {
    const exhausted = row.attempts >= row.maxAttempts;
    if (exhausted) {
      await this.markBlocked(row.id, errorMessage, guard);
      return null;
    }

    const runAfter = new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString();
    const { data, error } = await this.supabase.rpc("retry_accounting_sync_queue", {
      p_queue_id: row.id,
      p_worker_id: guard.workerId,
      p_error: errorMessage,
      p_run_after: runAfter,
    });

    if (error) {
      throw error;
    }

    const returnedRow = Array.isArray(data) ? data[0] : data;
    if (!returnedRow) {
      throw new Error("Accounting sync queue retry lost ownership");
    }

    return mapQueueRow(returnedRow as QueueDbRow);
  }

  async markBlocked(id: string, errorMessage: string, guard: WorkerGuard): Promise<void> {
    await this.updateQueueRow(
      id,
      {
        status: "blocked",
        locked_at: null,
        locked_by: null,
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      },
      guard
    );
  }

  async markNeedsReview(id: string, errorMessage: string, guard: WorkerGuard): Promise<void> {
    await this.updateQueueRow(
      id,
      {
        status: "needs_review",
        locked_at: null,
        locked_by: null,
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      },
      guard
    );
  }

  private async updateQueueRow(id: string, patch: Record<string, unknown>, guard: WorkerGuard): Promise<void> {
    const query = this.supabase.from("accounting_sync_queue").update(patch).eq("id", id);

    const { data, error } = await query
      .eq("status", "claimed")
      .eq("locked_by", guard.workerId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("Accounting sync queue update lost ownership");
    }
  }
}
