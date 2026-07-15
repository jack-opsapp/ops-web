// Sync-time bridge into the canonical durable attachment pipeline.
//
// The database trigger queues every exact email activity for background
// convergence, including Gmail/Microsoft false negatives where the provider's
// hasAttachments flag is false. Existing-lead acceptance routing also needs a
// freshly returned signed estimate to be available before conversation state is
// rebuilt, so this bridge runs the same idempotent canonical ingestion boundary
// for the newest inbound messages on that thread. It never uses the legacy
// thread-wide metadata path and never writes opportunities.images.

import { ingestExactActivityAttachments } from "@/lib/api/services/email-attachments/attachment-runtime";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailConnection } from "@/lib/types/email-connection";

const MAX_SYNC_TIME_MESSAGES = 10;

interface ExactInboundActivityRow {
  id: string;
  email_message_id: string;
  email_thread_id: string;
}

/**
 * Warm durable attachment metadata, private bytes, and cost-once inspections
 * before deterministic acceptance/state evaluation. Resolves even when one
 * message fails; the durable worker owns retries and reconnect recovery.
 */
export async function ingestAndInspectThreadAttachments(args: {
  connection: EmailConnection;
  providerThreadId: string;
  companyId: string;
}): Promise<void> {
  const { connection, providerThreadId, companyId } = args;
  if (
    companyId !== connection.companyId ||
    !providerThreadId.trim() ||
    !connection.id
  ) {
    console.error(
      "[attachment-ingest] refused mismatched mailbox/thread identity"
    );
    return;
  }

  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("activities")
      .select("id,email_message_id,email_thread_id")
      .eq("company_id", companyId)
      .eq("email_connection_id", connection.id)
      .eq("email_thread_id", providerThreadId)
      .eq("direction", "inbound")
      .eq("type", "email")
      .not("email_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_SYNC_TIME_MESSAGES);

    if (error) {
      console.error(
        "[attachment-ingest] exact activity lookup failed (worker will retry):",
        error.message
      );
      return;
    }

    for (const row of (data ?? []) as ExactInboundActivityRow[]) {
      if (!row.id || !row.email_message_id) continue;
      try {
        await ingestExactActivityAttachments(
          supabase,
          connection,
          {
            companyId,
            connectionId: connection.id,
            activityId: row.id,
            messageId: row.email_message_id,
          },
          { inspectImmediately: true }
        );
      } catch (error) {
        console.error(
          "[attachment-ingest] canonical message ingest failed (worker will retry):",
          {
            activityId: row.id,
            messageId: row.email_message_id,
            error: error instanceof Error ? error.message : "unknown error",
          }
        );
      }
    }
  } catch (error) {
    console.error(
      "[attachment-ingest] run failed (non-fatal; worker will retry):",
      error
    );
  }
}
