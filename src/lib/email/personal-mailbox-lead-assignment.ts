import type { SupabaseClient } from "@supabase/supabase-js";

export interface PersonalMailboxLeadAssignmentInput {
  connectionType: "company" | "individual";
  connectionId: string;
  connectionOwnerId: string | null;
  opportunityId: string;
  expectedAssignmentVersion: number;
  expectedAssignedTo: string | null;
  providerThreadId: string | null;
  ingestionSource?: "email_sync" | "email_import" | "email_recovery";
  /** Durable trigger fence for an exact provider-read-only recovery run. */
  providerMutationsDisabled?: boolean;
}

export type PersonalMailboxLeadAssignmentResult =
  | { assigned: true; assignmentVersion: number; eventId: string | null }
  | {
      assigned: false;
      reason:
        | "company_mailbox"
        | "owner_missing"
        | "owner_ineligible"
        | "already_assigned"
        | "assignment_conflict";
    };

interface AssignmentRpcResult {
  ok?: unknown;
  conflict?: unknown;
  assigned_to?: unknown;
  assignment_version?: unknown;
  event_id?: unknown;
}

function firstResult(value: unknown): AssignmentRpcResult | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as AssignmentRpcResult) : null;
}

function isTargetIneligible(error: {
  message?: string;
  details?: string;
}): boolean {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return text.includes("assignment_target_ineligible");
}

/**
 * Assign a newly created personal-mailbox lead through the guarded assignment
 * operation. Company-mailbox leads remain unassigned. The mailbox address is
 * deliberately absent: application identity is the canonical OPS user UUID.
 */
export async function assignPersonalMailboxLead(
  input: PersonalMailboxLeadAssignmentInput,
  supabase: SupabaseClient
): Promise<PersonalMailboxLeadAssignmentResult> {
  if (input.connectionType !== "individual") {
    return { assigned: false, reason: "company_mailbox" };
  }
  if (!input.connectionOwnerId?.trim()) {
    return { assigned: false, reason: "owner_missing" };
  }
  if (
    input.expectedAssignedTo !== null ||
    input.expectedAssignmentVersion !== 0
  ) {
    return input.expectedAssignedTo === input.connectionOwnerId
      ? {
          assigned: true,
          assignmentVersion: input.expectedAssignmentVersion,
          eventId: null,
        }
      : { assigned: false, reason: "already_assigned" };
  }

  const { data, error } = await supabase.rpc(
    "change_opportunity_assignment_as_system",
    {
      p_opportunity_id: input.opportunityId,
      p_expected_assignment_version: input.expectedAssignmentVersion,
      p_expected_assigned_to: input.expectedAssignedTo,
      p_new_assigned_to: input.connectionOwnerId,
      p_system_source: "personal_mailbox",
      p_actor_user_id: null,
      p_suggestion_id: null,
      p_metadata: {
        connection_id: input.connectionId,
        provider_thread_id: input.providerThreadId,
        ingestion_source: input.ingestionSource ?? "email_sync",
        ...(input.providerMutationsDisabled
          ? { provider_mutations_disabled: true }
          : {}),
      },
    }
  );

  if (error) {
    if (isTargetIneligible(error)) {
      return { assigned: false, reason: "owner_ineligible" };
    }
    throw new Error(
      `Personal mailbox lead assignment failed: ${error.message ?? "unknown error"}`
    );
  }

  const result = firstResult(data);
  if (!result) {
    throw new Error("Personal mailbox lead assignment returned no result");
  }

  const assignedTo =
    typeof result.assigned_to === "string" ? result.assigned_to : null;
  const assignmentVersion = Number(result.assignment_version);
  const eventId = typeof result.event_id === "string" ? result.event_id : null;

  if (result.conflict === true) {
    return assignedTo === input.connectionOwnerId &&
      Number.isFinite(assignmentVersion)
      ? { assigned: true, assignmentVersion, eventId }
      : { assigned: false, reason: "assignment_conflict" };
  }

  if (
    result.ok !== true ||
    assignedTo !== input.connectionOwnerId ||
    !Number.isFinite(assignmentVersion) ||
    assignmentVersion < 1 ||
    !eventId
  ) {
    throw new Error(
      "Personal mailbox lead assignment returned an invalid result"
    );
  }

  return { assigned: true, assignmentVersion, eventId };
}
