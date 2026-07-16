import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailOpportunityNotificationEvent =
  | "terminal_likely_won"
  | "terminal_likely_lost"
  | "accept_auto_won"
  | "accept_review_won"
  | "thread_customer"
  | "thread_platform_bid"
  | "thread_urgent";

export interface EmailThreadNotificationSnapshot {
  id: string;
  companyId: string;
  connectionId: string;
  providerThreadId: string;
  opportunityId: string | null;
  primaryCategory: string;
  labels: string[];
  latestDirection: "inbound" | "outbound" | null;
}

interface NotificationRpcClient {
  rpc(
    name: "create_email_opportunity_notification_as_system",
    args: {
      p_opportunity_id: string;
      p_connection_id: string;
      p_provider_thread_id: string;
      p_expected_assignment_version: number;
      p_event_type: EmailOpportunityNotificationEvent;
    }
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface CreateEmailOpportunityNotificationInput {
  opportunityId: string;
  connectionId: string;
  providerThreadId: string;
  expectedAssignmentVersion: number;
  eventType: EmailOpportunityNotificationEvent;
  supabase: SupabaseClient;
}

/**
 * Ask the database to derive and notify the current assigned OPS user while
 * holding the lead assignment lock. `false` is typed no-work: the assignment,
 * exact thread relationship, or canonical lead/inbox access changed.
 */
export async function createEmailOpportunityNotification(
  input: CreateEmailOpportunityNotificationInput
): Promise<boolean> {
  if (
    !input.opportunityId ||
    !input.connectionId ||
    !input.providerThreadId.trim() ||
    !Number.isSafeInteger(input.expectedAssignmentVersion) ||
    input.expectedAssignmentVersion < 0
  ) {
    return false;
  }

  const { data, error } = await (
    input.supabase as unknown as NotificationRpcClient
  ).rpc("create_email_opportunity_notification_as_system", {
    p_opportunity_id: input.opportunityId,
    p_connection_id: input.connectionId,
    p_provider_thread_id: input.providerThreadId,
    p_expected_assignment_version: input.expectedAssignmentVersion,
    p_event_type: input.eventType,
  });
  if (error) {
    throw new Error(
      `email opportunity notification failed: ${error.message ?? "unknown error"}`
    );
  }
  return data === true;
}

/**
 * Deliver post-classification lead alerts without using a mailbox connector as
 * a recipient. Unlinked or unassigned shared-mailbox threads intentionally do
 * no work; the database derives the current assignee and rechecks the exact
 * assignment/thread/access intersection under the lead row lock.
 */
export async function createClassifiedEmailThreadNotifications(input: {
  previous: EmailThreadNotificationSnapshot;
  next: EmailThreadNotificationSnapshot;
  supabase: SupabaseClient;
}): Promise<number> {
  const { previous, next, supabase } = input;
  if (
    next.latestDirection !== "inbound" ||
    !next.opportunityId ||
    previous.id !== next.id ||
    previous.companyId !== next.companyId ||
    previous.connectionId !== next.connectionId ||
    previous.providerThreadId !== next.providerThreadId
  ) {
    return 0;
  }

  const events: EmailOpportunityNotificationEvent[] = [];
  if (
    next.primaryCategory === "CUSTOMER" &&
    previous.primaryCategory !== "CUSTOMER"
  ) {
    events.push("thread_customer");
  }
  if (
    next.primaryCategory === "PLATFORM_BID" &&
    previous.primaryCategory !== "PLATFORM_BID"
  ) {
    events.push("thread_platform_bid");
  }
  if (
    next.labels.includes("URGENT") &&
    !previous.labels.includes("URGENT")
  ) {
    events.push("thread_urgent");
  }
  if (events.length === 0) return 0;

  const { data, error } = await supabase
    .from("opportunities")
    .select("assignment_version")
    .eq("id", next.opportunityId)
    .eq("company_id", next.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(
      `email opportunity notification assignment lookup failed: ${error.message}`
    );
  }
  const assignmentVersion = Number(data?.assignment_version);
  if (!Number.isSafeInteger(assignmentVersion) || assignmentVersion < 0) {
    return 0;
  }

  let delivered = 0;
  for (const eventType of events) {
    if (
      await createEmailOpportunityNotification({
        opportunityId: next.opportunityId,
        connectionId: next.connectionId,
        providerThreadId: next.providerThreadId,
        expectedAssignmentVersion: assignmentVersion,
        eventType,
        supabase,
      })
    ) {
      delivered += 1;
    }
  }
  return delivered;
}
