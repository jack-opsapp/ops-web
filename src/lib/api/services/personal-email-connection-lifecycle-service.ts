import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { EmailConnectionService } from "@/lib/api/services/email-connection-service";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailConnection } from "@/lib/types/email-connection";

const PROCESS_LIFECYCLE_RPC = "process_personal_mailbox_lifecycle_event";
const SIGNATURE_LIFECYCLE_OUTBOX =
  "email_signature_notification_lifecycle_outbox";
const PROCESS_SIGNATURE_LIFECYCLE_RPC =
  "process_email_signature_notification_lifecycle";
const FAIL_SIGNATURE_LIFECYCLE_RPC =
  "fail_email_signature_notification_lifecycle";

export interface PersonalMailboxLifecycleResult {
  state: "processed" | "queued";
  affectedConversationCount: number | null;
  notifiedUserCount: number | null;
  resolvedNotificationCount: number | null;
}

export interface PersonalMailboxLifecycleDrainResult {
  selected: number;
  processed: number;
  failed: number;
}

type PersonalConnectionIdentity = Pick<
  EmailConnection,
  "id" | "type" | "userId" | "companyId" | "email"
>;

function firstRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function count(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function queuedResult(): PersonalMailboxLifecycleResult {
  return {
    state: "queued",
    affectedConversationCount: null,
    notifiedUserCount: null,
    resolvedNotificationCount: null,
  };
}

async function recordProcessingFailure(
  supabase: SupabaseClient,
  connectionId: string,
  error: unknown
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : "Mailbox warning processing failed";
  try {
    const { error: updateError } = await supabase
      .from("email_connection_lifecycle_outbox")
      .update({ last_error: message.slice(0, 2_000) })
      .eq("connection_id", connectionId)
      .is("processed_at", null);

    if (!updateError) return;
    console.error(
      "[personal-mailbox-lifecycle] Failed to record processor error",
      { connectionId, error: updateError.message }
    );
  } catch (recordError) {
    // The original outbox row is already durable. Failure to annotate it must
    // never turn a successful disconnect into an API failure.
    console.error(
      "[personal-mailbox-lifecycle] Failed to annotate queued event",
      {
        connectionId,
        error:
          recordError instanceof Error
            ? recordError.message
            : String(recordError),
      }
    );
  }
}

async function processConnection(
  connectionId: string,
  supabase: SupabaseClient
): Promise<PersonalMailboxLifecycleResult> {
  const { data, error } = await supabase.rpc(PROCESS_LIFECYCLE_RPC, {
    p_connection_id: connectionId,
  });
  if (error) {
    throw new Error(
      `Failed to process personal mailbox lifecycle: ${error.message}`
    );
  }

  const row = firstRow(data);
  if (!row) {
    throw new Error("Personal mailbox lifecycle processor returned no result");
  }

  return {
    state: "processed",
    affectedConversationCount: count(row, "affected_conversation_count"),
    notifiedUserCount: count(row, "notified_user_count"),
    resolvedNotificationCount: count(row, "resolved_notification_count"),
  };
}

async function processConnectionBestEffort(
  connectionId: string,
  supabase: SupabaseClient
): Promise<PersonalMailboxLifecycleResult> {
  try {
    return await processConnection(connectionId, supabase);
  } catch (error) {
    console.error("[personal-mailbox-lifecycle] Durable event remains queued", {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    await recordProcessingFailure(supabase, connectionId, error);
    return queuedResult();
  }
}

interface SignatureLifecycleEvent {
  actorUserId: string;
  connectionId: string;
  companyId: string;
  requestedAt: string;
}

function signatureLifecycleEvents(data: unknown): SignatureLifecycleEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const actorUserId = (row as Record<string, unknown>).actor_user_id;
    const connectionId = (row as Record<string, unknown>).connection_id;
    const companyId = (row as Record<string, unknown>).company_id;
    const requestedAt = (row as Record<string, unknown>).requested_at;
    return typeof actorUserId === "string" &&
      typeof connectionId === "string" &&
      typeof companyId === "string" &&
      typeof requestedAt === "string"
      ? [{ actorUserId, connectionId, companyId, requestedAt }]
      : [];
  });
}

async function recordSignatureProcessingFailure(
  supabase: SupabaseClient,
  event: SignatureLifecycleEvent,
  error: unknown
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : "Signature notification reconciliation failed";
  try {
    const { error: failureError } = await supabase.rpc(
      FAIL_SIGNATURE_LIFECYCLE_RPC,
      {
        p_actor_user_id: event.actorUserId,
        p_connection_id: event.connectionId,
        p_company_id: event.companyId,
        p_expected_requested_at: event.requestedAt,
        p_error: message.slice(0, 2_000),
      }
    );
    if (!failureError) return;
    console.error(
      "[personal-mailbox-lifecycle] Failed to record signature reconciliation error",
      {
        actorUserId: event.actorUserId,
        connectionId: event.connectionId,
        companyId: event.companyId,
        error: failureError.message,
      }
    );
  } catch (recordError) {
    console.error(
      "[personal-mailbox-lifecycle] Failed to annotate signature lifecycle event",
      {
        actorUserId: event.actorUserId,
        connectionId: event.connectionId,
        companyId: event.companyId,
        error:
          recordError instanceof Error
            ? recordError.message
            : String(recordError),
      }
    );
  }
}

async function processSignatureEventBestEffort(
  supabase: SupabaseClient,
  event: SignatureLifecycleEvent
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc(PROCESS_SIGNATURE_LIFECYCLE_RPC, {
      p_actor_user_id: event.actorUserId,
      p_connection_id: event.connectionId,
      p_company_id: event.companyId,
    });
    if (error) {
      throw new Error(
        `Failed to process signature notification lifecycle: ${error.message}`
      );
    }
    return true;
  } catch (error) {
    console.error(
      "[personal-mailbox-lifecycle] Signature lifecycle event remains queued",
      {
        actorUserId: event.actorUserId,
        connectionId: event.connectionId,
        companyId: event.companyId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    await recordSignatureProcessingFailure(supabase, event, error);
    return false;
  }
}

async function loadSignatureLifecycleEvents(
  supabase: SupabaseClient,
  options: { connectionId?: string; limit: number }
): Promise<SignatureLifecycleEvent[]> {
  let query = supabase
    .from(SIGNATURE_LIFECYCLE_OUTBOX)
    .select("actor_user_id, connection_id, company_id, requested_at")
    .is("processed_at", null)
    .lte("available_at", new Date().toISOString());
  if (options.connectionId) {
    query = query.eq("connection_id", options.connectionId);
  }
  const { data, error } = await query
    .order("available_at", { ascending: true })
    .order("requested_at", { ascending: true })
    .limit(options.limit);
  if (error) {
    throw new Error(
      `Failed to load signature notification lifecycle events: ${error.message}`
    );
  }
  return signatureLifecycleEvents(data);
}

async function reconcileSignatureConnectionBestEffort(
  connectionId: string,
  supabase: SupabaseClient
): Promise<void> {
  try {
    const events = await loadSignatureLifecycleEvents(supabase, {
      connectionId,
      limit: 500,
    });
    for (const event of events) {
      await processSignatureEventBestEffort(supabase, event);
    }
  } catch (error) {
    console.error(
      "[personal-mailbox-lifecycle] Signature connection reconciliation remains queued",
      {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

async function drainSignatureLifecycleBestEffort(
  limit: number,
  supabase: SupabaseClient
): Promise<void> {
  try {
    const events = await loadSignatureLifecycleEvents(supabase, { limit });
    for (const event of events) {
      await processSignatureEventBestEffort(supabase, event);
    }
  } catch (error) {
    console.error(
      "[personal-mailbox-lifecycle] Signature lifecycle drain remains queued",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

export const PersonalEmailConnectionLifecycleService = {
  /**
   * Soft-disconnect one exact personal mailbox. The connection update is the
   * safety boundary: sync/send stop before notification delivery is attempted.
   * A database trigger writes the retryable lifecycle outbox event in the same
   * transaction, so a notification failure can never cause mailbox fallback.
   */
  async disconnect(
    connection: PersonalConnectionIdentity,
    supabase: SupabaseClient = requireSupabase()
  ): Promise<PersonalMailboxLifecycleResult> {
    if (connection.type !== "individual" || !connection.userId) {
      throw new Error("personal email connection required");
    }

    await EmailConnectionService.deleteConnection(connection.id);
    const result = await processConnectionBestEffort(connection.id, supabase);
    await reconcileSignatureConnectionBestEffort(connection.id, supabase);
    return result;
  },

  /** Process or resolve one already-queued lifecycle event. */
  async reconcile(
    connectionId: string,
    supabase: SupabaseClient = requireSupabase()
  ): Promise<PersonalMailboxLifecycleResult> {
    if (!connectionId.trim()) {
      throw new Error("connection id required");
    }
    const result = await processConnectionBestEffort(connectionId, supabase);
    await reconcileSignatureConnectionBestEffort(connectionId, supabase);
    return result;
  },

  /**
   * Retry pending events. The hourly provider-health cron calls this as a
   * no-provider-write maintenance step; disconnect and reconnect paths also
   * reconcile their exact connection immediately.
   */
  async drainPending(
    limit = 100,
    supabase: SupabaseClient = requireSupabase()
  ): Promise<PersonalMailboxLifecycleDrainResult> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const { data, error } = await supabase
      .from("email_connection_lifecycle_outbox")
      .select("connection_id")
      .is("processed_at", null)
      .order("requested_at", { ascending: true })
      .limit(boundedLimit);
    if (error) {
      throw new Error(
        `Failed to load personal mailbox lifecycle events: ${error.message}`
      );
    }

    const connectionIds = (data ?? [])
      .map((row) =>
        typeof row.connection_id === "string" ? row.connection_id : ""
      )
      .filter(Boolean);
    let processed = 0;
    let failed = 0;

    for (const connectionId of connectionIds) {
      const result = await processConnectionBestEffort(connectionId, supabase);
      if (result.state === "processed") processed += 1;
      else failed += 1;
    }

    // Signature prompt work is independently durable. Its failures stay on
    // the signature outbox and never change personal-mailbox warning results.
    await drainSignatureLifecycleBestEffort(boundedLimit, supabase);

    return { selected: connectionIds.length, processed, failed };
  },
};
