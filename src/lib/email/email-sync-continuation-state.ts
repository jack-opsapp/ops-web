import { isEmailSyncContinuationPending } from "./email-sync-continuation";

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
 * Read the durable mailbox cursor and fail closed if its authority cannot be
 * proven. Phase C must never interpret a missing/failed cursor read as a
 * terminal conversation snapshot.
 */
export async function emailSyncContinuationPendingForConnection(input: {
  supabase: ContinuationStateSupabaseLike;
  connectionId: string;
  context: string;
}): Promise<boolean> {
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
  if (data.sync_in_progress_at || data.history_recovery_page_token) return true;
  return isEmailSyncContinuationPending(data.history_id ?? null);
}
