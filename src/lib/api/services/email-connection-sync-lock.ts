import { requireSupabase } from "@/lib/supabase/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_CONNECTION_SYNC_LOCK_TTL_SECONDS = 10 * 60;
export const EMAIL_CONNECTION_SYNC_LOCK_RENEW_INTERVAL_MS = 2 * 60 * 1000;

export interface EmailConnectionSyncLockRenewer {
  (force?: boolean): Promise<void>;
  /** Stop the background heartbeat and surface any ownership loss it observed. */
  stop(): Promise<void>;
}

export type EmailConnectionSyncLockRunResult<T> =
  | { acquired: false }
  | { acquired: true; value: T };

export async function acquireEmailConnectionSyncLock(
  connectionId: string,
  context: string,
  client?: SupabaseClient
): Promise<string | null> {
  const supabase = client ?? requireSupabase();
  const { data, error } = await supabase.rpc(
    "acquire_email_connection_sync_lock_as_system",
    {
      p_connection_id: connectionId,
      p_lease_seconds: EMAIL_CONNECTION_SYNC_LOCK_TTL_SECONDS,
    }
  );

  if (error) {
    throw new Error(
      `[${context}] email connection lock acquisition failed: ${error.message ?? "unknown error"}`
    );
  }
  if (data === null) return null;
  if (typeof data !== "string") {
    throw new Error(
      `[${context}] email connection lock acquisition returned an invalid owner`
    );
  }
  return data;
}

export async function renewEmailConnectionSyncLock(
  connectionId: string,
  ownerId: string,
  context: string,
  client?: SupabaseClient
): Promise<void> {
  const supabase = client ?? requireSupabase();
  const { data, error } = await supabase.rpc(
    "renew_email_connection_sync_lock_as_system",
    {
      p_connection_id: connectionId,
      p_owner_id: ownerId,
      p_lease_seconds: EMAIL_CONNECTION_SYNC_LOCK_TTL_SECONDS,
    }
  );

  if (error) {
    throw new Error(
      `[${context}] email connection lock renewal failed: ${error.message ?? "unknown error"}`
    );
  }
  if (typeof data !== "boolean") {
    throw new Error(
      `[${context}] email connection lock renewal returned an invalid result`
    );
  }
  if (!data) {
    throw new Error(
      `[${context}] email connection lock ownership was lost for ${connectionId}`
    );
  }
}

function assertOwnerFencedWrite(
  data: unknown,
  error: { message?: string } | null,
  context: string
): void {
  if (error) {
    throw new Error(
      `[${context}] owner-fenced mailbox write failed: ${error.message ?? "unknown error"}`
    );
  }
  if (data !== true) {
    throw new Error(
      `[${context}] mailbox lock ownership was lost before write`
    );
  }
}

export async function persistEmailConnectionRecoveryCheckpoint({
  connectionId,
  ownerId,
  anchor,
  pageToken,
  targetToken,
  context,
  client,
}: {
  connectionId: string;
  ownerId: string;
  anchor: Date;
  pageToken: string | null;
  targetToken: string;
  context: string;
  client?: SupabaseClient;
}): Promise<void> {
  const supabase = client ?? requireSupabase();
  const { data, error } = await supabase.rpc(
    "persist_email_connection_recovery_checkpoint_as_system",
    {
      p_connection_id: connectionId,
      p_owner_id: ownerId,
      p_anchor: anchor.toISOString(),
      p_page_token: pageToken,
      p_target_token: targetToken,
    }
  );
  assertOwnerFencedWrite(data, error, context);
}

export async function persistEmailConnectionSyncCompletion({
  connectionId,
  ownerId,
  lastSyncedAt,
  historyId,
  clearRecovery,
  context,
  client,
}: {
  connectionId: string;
  ownerId: string;
  lastSyncedAt: Date;
  historyId: string;
  clearRecovery: boolean;
  context: string;
  client?: SupabaseClient;
}): Promise<void> {
  const supabase = client ?? requireSupabase();
  const { data, error } = await supabase.rpc(
    "persist_email_connection_sync_completion_as_system",
    {
      p_connection_id: connectionId,
      p_owner_id: ownerId,
      p_last_synced_at: lastSyncedAt.toISOString(),
      p_history_id: historyId,
      p_clear_recovery: clearRecovery,
    }
  );
  assertOwnerFencedWrite(data, error, context);
}

export async function completeGmailImportJobUnderSyncLock({
  connectionId,
  ownerId,
  jobId,
  historyId,
  processed,
  matched,
  unmatched,
  needsReview,
  clientsCreated,
  leadsCreated,
  completedAt,
  context,
  client,
}: {
  connectionId: string;
  ownerId: string;
  jobId: string;
  historyId: string;
  processed: number;
  matched: number;
  unmatched: number;
  needsReview: number;
  clientsCreated: number;
  leadsCreated: number;
  completedAt: Date;
  context: string;
  client?: SupabaseClient;
}): Promise<void> {
  const supabase = client ?? requireSupabase();
  const args = {
    p_connection_id: connectionId,
    p_owner_id: ownerId,
    p_job_id: jobId,
    p_history_id: historyId,
    p_processed: processed,
    p_matched: matched,
    p_unmatched: unmatched,
    p_needs_review: needsReview,
    p_clients_created: clientsCreated,
    p_leads_created: leadsCreated,
    p_completed_at: completedAt.toISOString(),
  };
  let { data, error } = await supabase.rpc(
    "complete_gmail_import_job_as_system",
    args
  );
  if (error) {
    ({ data, error } = await supabase.rpc(
      "complete_gmail_import_job_as_system",
      args
    ));
  }
  assertOwnerFencedWrite(data, error, context);
}

export function createEmailConnectionSyncLockRenewer({
  connectionId,
  ownerId,
  context,
  client,
}: {
  connectionId: string;
  ownerId: string;
  context: string;
  client?: SupabaseClient;
}): EmailConnectionSyncLockRenewer {
  let renewedAt = Date.now();
  let stopped = false;
  let failure: Error | null = null;
  let renewalInFlight: Promise<void> | null = null;

  const renew = async (force = false): Promise<void> => {
    if (failure) throw failure;
    if (stopped) return;
    if (
      !force &&
      Date.now() - renewedAt < EMAIL_CONNECTION_SYNC_LOCK_RENEW_INTERVAL_MS
    ) {
      return;
    }

    if (!renewalInFlight) {
      renewalInFlight = renewEmailConnectionSyncLock(
        connectionId,
        ownerId,
        context,
        client
      )
        .then(() => {
          renewedAt = Date.now();
        })
        .catch((error: unknown) => {
          failure =
            error instanceof Error
              ? error
              : new Error(`Email connection lock renewal failed: ${error}`);
          throw failure;
        })
        .finally(() => {
          renewalInFlight = null;
        });
    }

    await renewalInFlight;
    if (failure) throw failure;
  };

  const renewer = renew as EmailConnectionSyncLockRenewer;
  const heartbeat = setInterval(() => {
    void renewer(true).catch(() => {
      // The failure is retained and is surfaced at the caller's next
      // checkpoint or when stop() is awaited. Avoid an unhandled rejection.
    });
  }, EMAIL_CONNECTION_SYNC_LOCK_RENEW_INTERVAL_MS);
  heartbeat.unref?.();

  renewer.stop = async () => {
    stopped = true;
    clearInterval(heartbeat);
    if (renewalInFlight) {
      await renewalInFlight;
    }
    if (failure) throw failure;
  };

  return renewer;
}

export async function releaseEmailConnectionSyncLock(
  connectionId: string,
  ownerId: string,
  context: string,
  client?: SupabaseClient
): Promise<void> {
  try {
    const supabase = client ?? requireSupabase();
    const { data, error } = await supabase.rpc(
      "release_email_connection_sync_lock_as_system",
      {
        p_connection_id: connectionId,
        p_owner_id: ownerId,
      }
    );

    if (error) {
      console.error(
        `[${context}] email connection lock release failed (non-fatal):`,
        error.message
      );
      return;
    }
    if (typeof data !== "boolean") {
      console.error(
        `[${context}] email connection lock release returned an invalid result`
      );
    }
  } catch (error) {
    console.error(
      `[${context}] email connection lock release threw (non-fatal):`,
      error
    );
  }
}

/**
 * Run one bounded mailbox operation under the same lease used by sync/import.
 *
 * The callback receives an owner-checkpoint function for natural batch
 * boundaries. A final forced checkpoint is always required before a successful
 * result can escape, so a worker that lost ownership cannot publish stale
 * success. Cleanup remains owner-fenced and preserves the original work error.
 */
export async function runWithEmailConnectionSyncLock<T>({
  connectionId,
  context,
  client,
  run,
}: {
  connectionId: string;
  context: string;
  client?: SupabaseClient;
  run: (checkpoint: EmailConnectionSyncLockRenewer) => Promise<T>;
}): Promise<EmailConnectionSyncLockRunResult<T>> {
  const ownerId = await acquireEmailConnectionSyncLock(
    connectionId,
    context,
    client
  );
  if (!ownerId) return { acquired: false };

  const checkpoint = createEmailConnectionSyncLockRenewer({
    connectionId,
    ownerId,
    context,
    client,
  });
  let value: T | undefined;
  let workError: unknown;
  let workFailed = false;

  try {
    value = await run(checkpoint);
    await checkpoint(true);
  } catch (error) {
    workFailed = true;
    workError = error;
  }

  let stopError: unknown;
  let stopFailed = false;
  try {
    await checkpoint.stop();
  } catch (error) {
    stopFailed = true;
    stopError = error;
  } finally {
    await releaseEmailConnectionSyncLock(
      connectionId,
      ownerId,
      context,
      client
    );
  }

  if (workFailed) throw workError;
  if (stopFailed) throw stopError;
  return { acquired: true, value: value as T };
}
