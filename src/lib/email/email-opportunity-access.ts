import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailRouteActor } from "@/lib/email/email-route-auth";
import { canUseEmailMailboxForSend } from "@/lib/email/server-mailbox-access";
import {
  resolvePermissionScopeById,
  type PermissionScope,
} from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export type EmailOpportunityOperation = "read" | "edit" | "mutate" | "send";

export type EmailOpportunityAccessDenialReason =
  | "invalid_actor"
  | "internal_thread_required"
  | "thread_not_found"
  | "connection_not_found"
  | "opportunity_not_found"
  | "opportunity_required"
  | "connection_identity_mismatch"
  | "thread_identity_mismatch"
  | "opportunity_identity_mismatch"
  | "canonical_relationship_conflict"
  | "lookup_failed"
  | "missing_pipeline_permission"
  | "missing_inbox_permission"
  | "opportunity_other_assignee"
  | "opportunity_unassigned"
  | "unlinked_shared_thread"
  | "mailbox_scope_denied"
  | "inbox_scope_denied"
  | "mailbox_transport_denied";

export interface EmailOpportunityAccessInput {
  actor: EmailRouteActor;
  operation: EmailOpportunityOperation;
  /** Canonical OPS email_threads.id for an existing provider conversation. */
  threadId?: string;
  /** Optional compatibility assertion, or selected sender for a new thread. */
  connectionId?: string;
  /** Optional compatibility assertion. Never accepted without threadId. */
  providerThreadId?: string;
  /** Optional compatibility assertion, or lead target for a new thread. */
  opportunityId?: string;
  /** Injectable only for tests; production defaults to service role. */
  supabase?: SupabaseClient;
}

export interface AllowedEmailOpportunityAccess {
  allowed: true;
  actor: EmailRouteActor;
  operation: EmailOpportunityOperation;
  threadId: string | null;
  connectionId: string;
  providerThreadId: string | null;
  opportunityId: string | null;
  connectionType: "company" | "individual";
  connectionOwnerId: string | null;
  pipelineScope: PermissionScope | null;
  inboxScope: PermissionScope;
  usedLegacyPipelineManage: boolean;
  usedLegacyInboxViewCompany: boolean;
}

export interface DeniedEmailOpportunityAccess {
  allowed: false;
  reason: EmailOpportunityAccessDenialReason;
}

export type EmailOpportunityAccessDecision =
  | AllowedEmailOpportunityAccess
  | DeniedEmailOpportunityAccess;

export interface AllowedEmailInboxListAccess {
  allowed: true;
  actor: EmailRouteActor;
  inboxScope: PermissionScope;
  pipelineScope: PermissionScope | null;
  ownPersonalConnectionIds: string[];
  assignedOpportunityIds: string[];
  usedLegacyPipelineManage: boolean;
  usedLegacyInboxViewCompany: boolean;
}

export type EmailInboxListAccessDecision =
  | AllowedEmailInboxListAccess
  | DeniedEmailOpportunityAccess;

export interface EmailThreadListAuthorizationFilter {
  empty: boolean;
  connectionIds?: string[];
  unlinkedOnly?: boolean;
  or?: string;
}

interface EmailThreadRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  opportunity_id: string | null;
}

interface EmailConnectionRow {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
  status: string | null;
}

interface OpportunityThreadLinkRow {
  opportunity_id: string;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  assigned_to: string | null;
}

interface ScopedPermission {
  scope: PermissionScope | null;
  usedLegacy: boolean;
}

interface CanonicalOpportunityAuthorization {
  allowed: boolean;
  error: boolean;
}

interface CanonicalInboxAuthorization {
  allowed: boolean;
  error: boolean;
}

function deny(
  reason: EmailOpportunityAccessDenialReason
): DeniedEmailOpportunityAccess {
  return { allowed: false, reason };
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function personalConnectionOwnerId(
  connection: EmailConnectionRow
): string | null {
  return connection.type === "individual" ? connection.user_id : null;
}

async function resolveScopedPermission(
  userId: string,
  primaryPermission: string
): Promise<ScopedPermission> {
  const primary = await resolvePermissionScopeById(userId, primaryPermission);
  return { scope: primary, usedLegacy: false };
}

async function authorizeCanonicalOpportunityAction(
  db: SupabaseClient,
  input: {
    actorUserId: string;
    opportunityId: string;
    action: "view" | "edit";
  }
): Promise<CanonicalOpportunityAuthorization> {
  const { data, error } = await db.rpc(
    "authorize_opportunity_action_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_opportunity_id: input.opportunityId,
      p_action: input.action,
    }
  );
  if (error) {
    console.error(
      "[email-opportunity-access] canonical opportunity authorization failed",
      {
        actorUserId: input.actorUserId,
        opportunityId: input.opportunityId,
        action: input.action,
        error: error.message,
      }
    );
    return { allowed: false, error: true };
  }
  return { allowed: data === true, error: false };
}

async function authorizeCanonicalInboxAction(
  db: SupabaseClient,
  input: {
    actorUserId: string;
    connectionId: string;
    opportunityId: string | null;
    action: "view" | "send";
  }
): Promise<CanonicalInboxAuthorization> {
  const { data, error } = await db.rpc(
    "authorize_email_inbox_action_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_connection_id: input.connectionId,
      p_opportunity_id: input.opportunityId,
      p_action: input.action,
    }
  );
  if (error) {
    console.error(
      "[email-opportunity-access] canonical inbox authorization failed",
      {
        actorUserId: input.actorUserId,
        connectionId: input.connectionId,
        opportunityId: input.opportunityId,
        action: input.action,
        error: error.message,
      }
    );
    return { allowed: false, error: true };
  }
  return { allowed: data === true, error: false };
}

function opportunityScopeDenial(
  scope: PermissionScope | null,
  opportunity: OpportunityRow,
  actor: EmailRouteActor
): EmailOpportunityAccessDenialReason | null {
  if (!scope || scope === "own") return "missing_pipeline_permission";
  if (scope === "all") return null;
  if (opportunity.assigned_to === actor.userId) return null;
  return opportunity.assigned_to
    ? "opportunity_other_assignee"
    : "opportunity_unassigned";
}

function inValues(values: string[]): string {
  return values.join(",");
}

/**
 * Build the root-table filter applied before inbox pagination and enrichment.
 * Every identifier comes from a server-side database read, never the request.
 */
export function buildEmailThreadListAuthorizationFilter(
  access: Pick<
    AllowedEmailInboxListAccess,
    | "inboxScope"
    | "pipelineScope"
    | "ownPersonalConnectionIds"
    | "assignedOpportunityIds"
  >
): EmailThreadListAuthorizationFilter {
  const own = access.ownPersonalConnectionIds;
  const assigned = access.assignedOpportunityIds;
  const pipelineScope =
    access.pipelineScope === "own" ? null : access.pipelineScope;

  if (access.inboxScope === "all") {
    if (pipelineScope === "all") return { empty: false };
    if (pipelineScope === "assigned" && assigned.length > 0) {
      return {
        empty: false,
        or: `opportunity_id.is.null,opportunity_id.in.(${inValues(assigned)})`,
      };
    }
    return { empty: false, unlinkedOnly: true };
  }

  if (access.inboxScope === "own") {
    if (own.length === 0) return { empty: true };
    if (pipelineScope === "all") {
      return { empty: false, connectionIds: own };
    }
    if (pipelineScope === "assigned" && assigned.length > 0) {
      return {
        empty: false,
        connectionIds: own,
        or: `opportunity_id.is.null,opportunity_id.in.(${inValues(assigned)})`,
      };
    }
    return { empty: false, connectionIds: own, unlinkedOnly: true };
  }

  // inbox.view:assigned is a union: own personal mailbox threads plus
  // lead-linked threads currently assigned to the actor. A linked own-mailbox
  // thread still cannot exceed the actor's pipeline scope.
  if (pipelineScope === "all") {
    if (own.length === 0 && assigned.length === 0) return { empty: true };
    const clauses: string[] = [];
    if (own.length > 0) {
      clauses.push(`connection_id.in.(${inValues(own)})`);
    }
    if (assigned.length > 0) {
      clauses.push(`opportunity_id.in.(${inValues(assigned)})`);
    }
    return { empty: false, or: clauses.join(",") };
  }

  if (pipelineScope === "assigned" && assigned.length > 0) {
    const clauses = [`opportunity_id.in.(${inValues(assigned)})`];
    if (own.length > 0) {
      clauses.push(
        `and(connection_id.in.(${inValues(own)}),opportunity_id.is.null)`
      );
    }
    return { empty: false, or: clauses.join(",") };
  }

  if (own.length > 0) {
    return { empty: false, connectionIds: own, unlinkedOnly: true };
  }
  return { empty: true };
}

/** Resolve the permission and ownership inputs used by the list query. */
export async function resolveEmailInboxListAccess({
  actor,
  supabase,
}: {
  actor: EmailRouteActor;
  supabase?: SupabaseClient;
}): Promise<EmailInboxListAccessDecision> {
  if (!isNonEmpty(actor.userId) || !isNonEmpty(actor.companyId)) {
    return deny("invalid_actor");
  }

  const inbox = await resolveScopedPermission(actor.userId, "inbox.view");
  if (!inbox.scope) return deny("missing_inbox_permission");

  const pipeline = await resolveScopedPermission(actor.userId, "pipeline.view");
  const db = supabase ?? getServiceRoleClient();
  const [connectionResult, opportunityResult] = await Promise.all([
    db
      .from("email_connections")
      .select("id")
      .eq("company_id", actor.companyId)
      .eq("type", "individual")
      .eq("user_id", actor.userId),
    db
      .from("opportunities")
      .select("id")
      .eq("company_id", actor.companyId)
      .eq("assigned_to", actor.userId)
      .is("deleted_at", null),
  ]);
  if (connectionResult.error || opportunityResult.error) {
    return deny("lookup_failed");
  }

  return {
    allowed: true,
    actor,
    inboxScope: inbox.scope,
    pipelineScope: pipeline.scope,
    ownPersonalConnectionIds: (connectionResult.data ?? []).map((row) =>
      String(row.id)
    ),
    assignedOpportunityIds: (opportunityResult.data ?? []).map((row) =>
      String(row.id)
    ),
    usedLegacyPipelineManage: pipeline.usedLegacy,
    usedLegacyInboxViewCompany: inbox.usedLegacy,
  };
}

/**
 * Resolve and authorize one email resource without trusting client identities.
 *
 * Existing conversations are anchored by the opaque internal thread id. Its
 * mailbox, provider thread id, and lead relationship are loaded server-side;
 * any supplied identifiers are consistency assertions only. New lead-bound
 * conversations deliberately have no thread/provider identity yet.
 */
export async function resolveEmailOpportunityAccess(
  input: EmailOpportunityAccessInput
): Promise<EmailOpportunityAccessDecision> {
  const { actor, operation } = input;
  if (!isNonEmpty(actor.userId) || !isNonEmpty(actor.companyId)) {
    return deny("invalid_actor");
  }

  const hasInternalThread = isNonEmpty(input.threadId);
  if (
    operation === "read" &&
    !hasInternalThread &&
    !isNonEmpty(input.opportunityId)
  ) {
    return deny("internal_thread_required");
  }
  if (!hasInternalThread && input.providerThreadId !== undefined) {
    return deny("internal_thread_required");
  }
  if (operation === "mutate" && !hasInternalThread) {
    return deny("internal_thread_required");
  }

  const db = input.supabase ?? getServiceRoleClient();
  let thread: EmailThreadRow | null = null;

  if (hasInternalThread) {
    const { data, error } = await db
      .from("email_threads")
      .select(
        "id, company_id, connection_id, provider_thread_id, opportunity_id"
      )
      .eq("id", input.threadId)
      .eq("company_id", actor.companyId)
      .maybeSingle();
    if (error) return deny("lookup_failed");
    thread = data as EmailThreadRow | null;
    if (!thread) return deny("thread_not_found");

    if (
      input.connectionId !== undefined &&
      input.connectionId !== thread.connection_id
    ) {
      return deny("connection_identity_mismatch");
    }
    if (
      input.providerThreadId !== undefined &&
      input.providerThreadId !== thread.provider_thread_id
    ) {
      return deny("thread_identity_mismatch");
    }
  }

  const connectionId = thread?.connection_id ?? input.connectionId;
  if (!isNonEmpty(connectionId)) return deny("connection_not_found");

  const { data: connectionData, error: connectionError } = await db
    .from("email_connections")
    .select("id, company_id, type, user_id, status")
    .eq("id", connectionId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (connectionError) return deny("lookup_failed");
  const connection = connectionData as EmailConnectionRow | null;
  if (!connection) return deny("connection_not_found");

  let canonicalOpportunityId: string | null = null;
  if (thread) {
    const { data: linkData, error: linkError } = await db
      .from("opportunity_email_threads")
      .select("opportunity_id")
      .eq("connection_id", thread.connection_id)
      .eq("thread_id", thread.provider_thread_id)
      .maybeSingle();
    if (linkError) return deny("lookup_failed");
    const link = linkData as OpportunityThreadLinkRow | null;

    if (
      thread.opportunity_id &&
      link?.opportunity_id &&
      thread.opportunity_id !== link.opportunity_id
    ) {
      return deny("canonical_relationship_conflict");
    }
    canonicalOpportunityId =
      thread.opportunity_id ?? link?.opportunity_id ?? null;
    if (
      input.opportunityId !== undefined &&
      input.opportunityId !== canonicalOpportunityId
    ) {
      return deny("opportunity_identity_mismatch");
    }
  } else {
    canonicalOpportunityId = input.opportunityId ?? null;
  }

  let opportunity: OpportunityRow | null = null;
  if (canonicalOpportunityId) {
    const { data, error } = await db
      .from("opportunities")
      .select("id, company_id, assigned_to")
      .eq("id", canonicalOpportunityId)
      .eq("company_id", actor.companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return deny("lookup_failed");
    opportunity = data as OpportunityRow | null;
    if (!opportunity) return deny("opportunity_not_found");
  }

  if (!opportunity) {
    if (operation === "edit" || operation === "send") {
      return deny("opportunity_required");
    }

    const [inbox, canonicalInboxAuthorization] = await Promise.all([
      resolveScopedPermission(actor.userId, "inbox.view"),
      authorizeCanonicalInboxAction(db, {
        actorUserId: actor.userId,
        connectionId: connection.id,
        opportunityId: null,
        action: "view",
      }),
    ]);
    if (canonicalInboxAuthorization.error) return deny("lookup_failed");
    if (!inbox.scope) return deny("missing_inbox_permission");
    if (!canonicalInboxAuthorization.allowed) {
      return connection.type === "company"
        ? deny("unlinked_shared_thread")
        : deny("mailbox_scope_denied");
    }
    if (
      operation === "mutate" &&
      !canUseEmailMailboxForSend(connection, actor.userId)
    ) {
      return deny("mailbox_transport_denied");
    }

    return {
      allowed: true,
      actor,
      operation,
      threadId: thread?.id ?? null,
      connectionId: connection.id,
      providerThreadId: thread?.provider_thread_id ?? null,
      opportunityId: null,
      connectionType: connection.type,
      connectionOwnerId: personalConnectionOwnerId(connection),
      pipelineScope: null,
      inboxScope: inbox.scope,
      usedLegacyPipelineManage: false,
      usedLegacyInboxViewCompany: inbox.usedLegacy,
    };
  }

  const pipelineAction = operation === "read" ? "view" : "edit";
  const inboxPermission = operation === "send" ? "inbox.send" : "inbox.view";
  const inboxAction = operation === "send" ? "send" : "view";
  const [
    pipeline,
    inbox,
    canonicalPipelineAuthorization,
    canonicalInboxAuthorization,
  ] = await Promise.all([
    resolveScopedPermission(
      actor.userId,
      operation === "read" ? "pipeline.view" : "pipeline.edit"
    ),
    resolveScopedPermission(actor.userId, inboxPermission),
    authorizeCanonicalOpportunityAction(db, {
      actorUserId: actor.userId,
      opportunityId: opportunity.id,
      action: pipelineAction,
    }),
    authorizeCanonicalInboxAction(db, {
      actorUserId: actor.userId,
      connectionId: connection.id,
      opportunityId: opportunity.id,
      action: inboxAction,
    }),
  ]);
  if (
    canonicalPipelineAuthorization.error ||
    canonicalInboxAuthorization.error
  ) {
    return deny("lookup_failed");
  }
  if (!canonicalPipelineAuthorization.allowed) {
    return deny(
      opportunityScopeDenial(pipeline.scope, opportunity, actor) ??
        "missing_pipeline_permission"
    );
  }
  const canonicalPipelineScope: PermissionScope =
    pipeline.scope ??
    (opportunity.assigned_to === actor.userId ? "assigned" : "all");

  if (!inbox.scope) return deny("missing_inbox_permission");
  if (!canonicalInboxAuthorization.allowed) {
    if (
      (operation === "send" || operation === "mutate") &&
      !canUseEmailMailboxForSend(connection, actor.userId)
    ) {
      return deny("mailbox_transport_denied");
    }
    return deny("inbox_scope_denied");
  }
  if (
    (operation === "send" || operation === "mutate") &&
    !canUseEmailMailboxForSend(connection, actor.userId)
  ) {
    return deny("mailbox_transport_denied");
  }

  return {
    allowed: true,
    actor,
    operation,
    threadId: thread?.id ?? null,
    connectionId: connection.id,
    providerThreadId: thread?.provider_thread_id ?? null,
    opportunityId: opportunity.id,
    connectionType: connection.type,
    connectionOwnerId: personalConnectionOwnerId(connection),
    pipelineScope: canonicalPipelineScope,
    inboxScope: inbox.scope,
    usedLegacyPipelineManage: pipeline.usedLegacy || pipeline.scope === null,
    usedLegacyInboxViewCompany: inbox.usedLegacy,
  };
}
