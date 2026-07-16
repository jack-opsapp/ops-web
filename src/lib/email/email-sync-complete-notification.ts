import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SYNC_COUNT = 10_000;

interface SyncCompleteNotificationRpcClient {
  rpc(
    name: "create_email_sync_complete_notification_as_system",
    args: {
      p_connection_id: string;
      p_expected_owner_user_id: string;
      p_new_leads: number;
      p_matched: number;
      p_needs_review: number;
    }
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface CreateEmailSyncCompleteNotificationInput {
  connectionId: string;
  connectionType: "company" | "individual";
  expectedOwnerUserId: string | null;
  newLeads: number;
  matched: number;
  needsReview: number;
  supabase: SupabaseClient;
}

function isBoundedSyncCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SYNC_COUNT;
}

/**
 * Request a generic sync-complete notification for the exact current owner of
 * a personal mailbox. Company mailboxes and malformed legacy owner snapshots
 * are typed no-work before the service-only database operation is called.
 */
export async function createEmailSyncCompleteNotification(
  input: CreateEmailSyncCompleteNotificationInput
): Promise<boolean> {
  if (
    input.connectionType !== "individual" ||
    !UUID_PATTERN.test(input.connectionId) ||
    !input.expectedOwnerUserId ||
    !UUID_PATTERN.test(input.expectedOwnerUserId) ||
    !isBoundedSyncCount(input.newLeads) ||
    !isBoundedSyncCount(input.matched) ||
    !isBoundedSyncCount(input.needsReview) ||
    input.newLeads + input.matched + input.needsReview === 0
  ) {
    return false;
  }

  const { data, error } = await (
    input.supabase as unknown as SyncCompleteNotificationRpcClient
  ).rpc("create_email_sync_complete_notification_as_system", {
    p_connection_id: input.connectionId,
    p_expected_owner_user_id: input.expectedOwnerUserId,
    p_new_leads: input.newLeads,
    p_matched: input.matched,
    p_needs_review: input.needsReview,
  });
  if (error) {
    throw new Error(
      `email sync-complete notification failed: ${error.message ?? "unknown error"}`
    );
  }

  return data === true;
}
