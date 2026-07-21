import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveEmailOpportunityAccess,
  type EmailOpportunityOperation,
} from "@/lib/email/email-opportunity-access";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PhaseCEmailActorNoWorkReason =
  | "invalid_identifiers"
  | "connection_not_found"
  | "connection_cross_company"
  | "connection_inactive"
  | "opportunity_required"
  | "opportunity_not_found"
  | "opportunity_cross_company"
  | "opportunity_unassigned"
  | "assignment_contract_unavailable"
  | "assignment_stale"
  | "personal_connection_owner_missing"
  | "personal_owner_not_assignee"
  | "actor_identity_invalid"
  | "actor_not_found"
  | "actor_cross_company"
  | "actor_inactive"
  | "lead_thread_unauthorized"
  | "lookup_failed";

export interface PhaseCEmailActorContext {
  actorUserId: string;
  assignmentVersion: number;
  assignmentEventId: string | null;
  companyId: string;
  connectionId: string;
  opportunityId: string;
  internalThreadId: string;
  providerThreadId: string;
  connectionType: "company" | "individual";
  actorNameSnapshot: string | null;
  actorEmailSnapshot: string | null;
  clientFacingAddressSnapshot: string;
}

export type PhaseCEmailActorResolution =
  | { kind: "resolved"; context: PhaseCEmailActorContext }
  | {
      kind: "no_work";
      reason: PhaseCEmailActorNoWorkReason;
      authorizationReason?: string;
    };

export interface PhaseCEmailAuthorizationInput {
  actorUserId: string;
  companyId: string;
  connectionId: string;
  opportunityId: string;
  internalThreadId: string;
  providerThreadId: string;
  operation: Extract<EmailOpportunityOperation, "read" | "edit" | "send">;
  opportunityAction: "view" | "edit" | "convert" | null;
  supabase: SupabaseClient;
}

export type PhaseCEmailAuthorizationResolver = (
  input: PhaseCEmailAuthorizationInput
) => Promise<{ allowed: true } | { allowed: false; reason: string }>;

export interface ResolvePhaseCEmailActorInput {
  companyId: string;
  connectionId: string;
  opportunityId: string | null;
  internalThreadId: string;
  providerThreadId: string;
  expectedAssignmentVersion?: number | null;
  /** Email-side permission intersection required by the pending work. */
  operation?: Extract<EmailOpportunityOperation, "read" | "edit" | "send">;
  /** Optional stricter lead action, such as conversion review. */
  opportunityAction?: "view" | "edit" | "convert";
  supabase?: SupabaseClient;
  /** Test seam. Production uses the canonical opportunity/inbox intersection. */
  authorize?: PhaseCEmailAuthorizationResolver;
}

interface EmailConnectionRow {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
  email: string;
  status: string | null;
  sync_enabled: boolean | null;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  assigned_to: string | null;
  assignment_version: number | string | null;
}

interface UserRow {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
}

interface AssignmentEventRow {
  id: string;
}

function noWork(
  reason: PhaseCEmailActorNoWorkReason,
  authorizationReason?: string
): PhaseCEmailActorResolution {
  return authorizationReason
    ? { kind: "no_work", reason, authorizationReason }
    : { kind: "no_work", reason };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseAssignmentVersion(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^\d+$/.test(value))
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function actorNameSnapshot(user: UserRow): string | null {
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => isNonEmpty(part))
    .map((part) => part.trim())
    .join(" ");
  return name || null;
}

const authorizeWithCanonicalAccess: PhaseCEmailAuthorizationResolver = async (
  input
) => {
  const decision = await resolveEmailOpportunityAccess({
    actor: { userId: input.actorUserId, companyId: input.companyId },
    operation: input.operation,
    threadId: input.internalThreadId,
    connectionId: input.connectionId,
    providerThreadId: input.providerThreadId,
    opportunityId: input.opportunityId,
    supabase: input.supabase,
  });
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  if (input.opportunityAction) {
    const { data, error } = await input.supabase.rpc(
      "authorize_opportunity_action_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_opportunity_id: input.opportunityId,
        p_action: input.opportunityAction,
      }
    );
    if (error || data !== true) {
      return {
        allowed: false,
        reason: error ? "opportunity_authorization_failed" : "access_denied",
      };
    }
  }

  return { allowed: true };
};

/**
 * Resolve the only OPS user Phase C may act as for a lead-bound email action.
 * Mailbox addresses are retained as client-facing snapshots only; they never
 * participate in actor or assignment identity.
 */
export async function resolvePhaseCEmailActor(
  input: ResolvePhaseCEmailActorInput
): Promise<PhaseCEmailActorResolution> {
  if (
    !isUuid(input.companyId) ||
    !isUuid(input.connectionId) ||
    !isUuid(input.internalThreadId) ||
    !isNonEmpty(input.providerThreadId)
  ) {
    return noWork("invalid_identifiers");
  }
  if (!input.opportunityId) return noWork("opportunity_required");
  if (!isUuid(input.opportunityId)) return noWork("invalid_identifiers");

  const db =
    input.supabase ?? (getServiceRoleClient() as unknown as SupabaseClient);

  try {
    const { data: connectionData, error: connectionError } = await db
      .from("email_connections")
      .select("id, company_id, type, user_id, email, status, sync_enabled")
      .eq("id", input.connectionId)
      .maybeSingle();
    if (connectionError) return noWork("lookup_failed");
    const connection = connectionData as EmailConnectionRow | null;
    if (!connection) return noWork("connection_not_found");
    if (connection.company_id !== input.companyId) {
      return noWork("connection_cross_company");
    }
    if (connection.status !== "active" || connection.sync_enabled === false) {
      return noWork("connection_inactive");
    }
    if (
      (connection.type !== "company" && connection.type !== "individual") ||
      !isNonEmpty(connection.email)
    ) {
      return noWork("lookup_failed");
    }

    const { data: opportunityData, error: opportunityError } = await db
      .from("opportunities")
      .select("id, company_id, assigned_to, assignment_version")
      .eq("id", input.opportunityId)
      .is("deleted_at", null)
      .maybeSingle();
    if (opportunityError) return noWork("lookup_failed");
    const opportunity = opportunityData as OpportunityRow | null;
    if (!opportunity) return noWork("opportunity_not_found");
    if (opportunity.company_id !== input.companyId) {
      return noWork("opportunity_cross_company");
    }
    if (!opportunity.assigned_to) {
      return noWork("opportunity_unassigned");
    }

    const assignmentVersion = parseAssignmentVersion(
      opportunity.assignment_version
    );
    if (assignmentVersion === null) {
      return noWork("assignment_contract_unavailable");
    }
    if (
      input.expectedAssignmentVersion != null &&
      input.expectedAssignmentVersion !== assignmentVersion
    ) {
      return noWork("assignment_stale");
    }

    let actorUserId = opportunity.assigned_to;
    if (connection.type === "individual") {
      const connectionOwnerUserId = connection.user_id?.trim();
      if (!connectionOwnerUserId) {
        return noWork("personal_connection_owner_missing");
      }
      if (connectionOwnerUserId !== opportunity.assigned_to) {
        return noWork("personal_owner_not_assignee");
      }
      actorUserId = connectionOwnerUserId;
    }
    if (!isUuid(actorUserId)) return noWork("actor_identity_invalid");

    const { data: actorData, error: actorError } = await db
      .from("users")
      .select(
        "id, company_id, first_name, last_name, email, is_active, deleted_at"
      )
      .eq("id", actorUserId)
      .maybeSingle();
    if (actorError) return noWork("lookup_failed");
    const actor = actorData as UserRow | null;
    if (!actor) return noWork("actor_not_found");
    if (actor.company_id !== input.companyId) {
      return noWork("actor_cross_company");
    }
    if (actor.is_active !== true || actor.deleted_at !== null) {
      return noWork("actor_inactive");
    }

    const authorize = input.authorize ?? authorizeWithCanonicalAccess;
    const operation = input.operation ?? "send";
    const authorization = await authorize({
      actorUserId,
      companyId: input.companyId,
      connectionId: connection.id,
      opportunityId: opportunity.id,
      internalThreadId: input.internalThreadId,
      providerThreadId: input.providerThreadId,
      operation,
      opportunityAction: input.opportunityAction ?? null,
      supabase: db,
    });
    if (!authorization.allowed) {
      return noWork("lead_thread_unauthorized", authorization.reason);
    }

    const { data: assignmentEventData, error: assignmentEventError } = await db
      .from("opportunity_assignment_events")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("opportunity_id", opportunity.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assignmentEventError) return noWork("lookup_failed");
    const assignmentEvent = assignmentEventData as AssignmentEventRow | null;
    if (assignmentEvent && !isUuid(assignmentEvent.id)) {
      return noWork("lookup_failed");
    }

    // Authorization and event lookup are separate service-role reads. Re-read
    // the assignment fence so a concurrent handoff cannot return an old actor
    // paired with the new assignment event (or vice versa).
    const { data: currentOpportunityData, error: currentOpportunityError } =
      await db
        .from("opportunities")
        .select("id, company_id, assigned_to, assignment_version")
        .eq("id", opportunity.id)
        .is("deleted_at", null)
        .maybeSingle();
    if (currentOpportunityError) return noWork("lookup_failed");
    const currentOpportunity = currentOpportunityData as OpportunityRow | null;
    const currentAssignmentVersion = parseAssignmentVersion(
      currentOpportunity?.assignment_version
    );
    if (
      !currentOpportunity ||
      currentOpportunity.company_id !== input.companyId ||
      currentOpportunity.assigned_to !== actorUserId ||
      currentAssignmentVersion !== assignmentVersion
    ) {
      return noWork("assignment_stale");
    }

    return {
      kind: "resolved",
      context: {
        actorUserId,
        assignmentVersion,
        assignmentEventId: assignmentEvent?.id ?? null,
        companyId: input.companyId,
        connectionId: connection.id,
        opportunityId: opportunity.id,
        internalThreadId: input.internalThreadId,
        providerThreadId: input.providerThreadId,
        connectionType: connection.type,
        actorNameSnapshot: actorNameSnapshot(actor),
        actorEmailSnapshot: isNonEmpty(actor.email) ? actor.email.trim() : null,
        clientFacingAddressSnapshot: connection.email.trim(),
      },
    };
  } catch {
    return noWork("lookup_failed");
  }
}
