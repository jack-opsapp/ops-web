import {
  isEmailSyncContinuationPending,
  isProviderSyncContinuationPending,
} from "./email-sync-continuation";

interface ContinuationStateSupabaseLike {
  from(table: "email_connections"): {
    select(
      columns: "history_id, history_recovery_page_token, sync_in_progress_at"
    ): {
      eq(
        column: "id",
        value: string
      ): {
        maybeSingle(): PromiseLike<{
          data: {
            history_id?: string | null;
            history_recovery_page_token?: string | null;
            sync_in_progress_at?: string | null;
          } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
}

/**
 * How much of the mailbox cursor has to be terminal before a caller may act.
 *
 * - `"complete"` — the historical contract: the provider must be caught up AND
 *   every derived OPS continuation (lead summaries) must be drained.
 * - `"provider"` — the provider high-water mark alone. Derived summary work is
 *   downstream of the conversation snapshot, so a caller that only needs "the
 *   mailbox holds no unfetched mail" must not be held hostage by it. A single
 *   non-converging summary otherwise freezes every Phase C lane on the
 *   connection indefinitely (bug 0700468d: 7 days on the primary mailbox).
 *
 * Un-leased `sync_in_progress_at` and an unfinished history-recovery page still
 * count as pending under BOTH scopes — those are mailbox-fetch state, not
 * derived state.
 */
export type EmailSyncContinuationScope = "complete" | "provider";

interface ContinuationStateInput {
  supabase: ContinuationStateSupabaseLike;
  connectionId: string;
  context: string;
  /**
   * True when the caller already holds this connection's mailbox lease.
   *
   * Acquiring that lease WRITES `sync_in_progress_at`
   * (`acquire_email_connection_sync_lock_as_system` sets it to the claim time),
   * so a lease-holder asking this question is reading its own lock. Left
   * unqualified it concludes "a sync is running" and the caller blocks on
   * itself — the deadlock that silently stopped every Phase C mailbox draft
   * placement. Holding the lease proves the mailbox is ours, not that it is
   * busy, so only that one condition is waived. The genuine "the mailbox still
   * has more to fetch" signals below are unaffected.
   */
  ownsMailboxLease?: boolean;
}

async function continuationPendingForConnection(
  input: ContinuationStateInput,
  scope: EmailSyncContinuationScope
): Promise<boolean> {
  const { data, error } = await input.supabase
    .from("email_connections")
    .select("history_id, history_recovery_page_token, sync_in_progress_at")
    .eq("id", input.connectionId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[${input.context}] mailbox continuation read failed: ${error.message ?? "unknown error"}`,
      { cause: error }
    );
  }
  if (!data) {
    throw new Error(`[${input.context}] email connection not found`);
  }
  if (!input.ownsMailboxLease && data.sync_in_progress_at) return true;
  if (data.history_recovery_page_token) return true;
  const historyId = data.history_id ?? null;
  return scope === "provider"
    ? isProviderSyncContinuationPending(historyId)
    : isEmailSyncContinuationPending(historyId);
}

/**
 * Read the durable mailbox cursor and fail closed if its authority cannot be
 * proven. Phase C must never interpret a missing/failed cursor read as a
 * terminal conversation snapshot.
 *
 * Defaults to `scope: "complete"` so every existing caller keeps its exact
 * historical semantics; pass `scope: "provider"` to ask only whether the
 * provider still owes mail.
 */
export async function emailSyncContinuationPendingForConnection(
  input: ContinuationStateInput & { scope?: EmailSyncContinuationScope }
): Promise<boolean> {
  return continuationPendingForConnection(input, input.scope ?? "complete");
}

/**
 * Provider-scoped twin of `emailSyncContinuationPendingForConnection`: true
 * only while the provider itself still owes this mailbox mail (or a foreign
 * lease / history recovery is outstanding). Derived lead-summary continuations
 * are deliberately ignored — they are computed FROM the snapshot, so they can
 * never make the snapshot less current.
 */
export async function emailProviderSyncPendingForConnection(
  input: ContinuationStateInput
): Promise<boolean> {
  return continuationPendingForConnection(input, "provider");
}
