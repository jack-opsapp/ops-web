import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailRouteActor } from "@/lib/email/email-route-auth";
import {
  resolveEmailOpportunityAccess,
  type AllowedEmailOpportunityAccess,
  type EmailOpportunityAccessDenialReason,
  type EmailOpportunityOperation,
} from "@/lib/email/email-opportunity-access";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export type EmailDraftAccessOperation = "read" | "edit" | "send";

export interface EmailDraftAccessRow {
  id: string;
  company_id: string;
  user_id: string;
  opportunity_id: string | null;
  connection_id: string | null;
  thread_id: string | null;
  original_draft: string;
  profile_type: string | null;
  status: string;
  origin: string | null;
  created_at: string;
}

export type EmailDraftAccessDenialReason =
  | EmailOpportunityAccessDenialReason
  | "draft_not_found"
  | "draft_owner_mismatch"
  | "draft_identity_incomplete";

export type EmailDraftAccessDecision =
  | ({
      allowed: true;
      draft: EmailDraftAccessRow;
    } & AllowedEmailOpportunityAccess)
  | { allowed: false; reason: EmailDraftAccessDenialReason };

function deny(reason: EmailDraftAccessDenialReason): EmailDraftAccessDecision {
  return { allowed: false, reason };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve a draft through its current canonical thread/lead relationship.
 *
 * Draft rows are historical evidence, not authorization. Every request loads
 * the live internal thread and opportunity assignment before access is
 * granted, so reassignment immediately revokes stale reads and mutations.
 */
export async function resolveEmailDraftAccess({
  actor,
  draftHistoryId,
  operation,
  supabase,
}: {
  actor: EmailRouteActor;
  draftHistoryId: string;
  operation: EmailDraftAccessOperation;
  supabase?: SupabaseClient;
}): Promise<EmailDraftAccessDecision> {
  if (
    !nonEmpty(actor.userId) ||
    !nonEmpty(actor.companyId) ||
    !nonEmpty(draftHistoryId)
  ) {
    return deny("draft_not_found");
  }

  const db = supabase ?? getServiceRoleClient();
  const { data, error } = await db
    .from("ai_draft_history")
    .select(
      "id, company_id, user_id, opportunity_id, connection_id, thread_id, original_draft, profile_type, status, origin, created_at"
    )
    .eq("id", draftHistoryId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (error) return deny("lookup_failed");
  const draft = data as EmailDraftAccessRow | null;
  if (!draft) return deny("draft_not_found");

  // A user's draft feeds only that canonical OPS user's learning profile.
  // Assignment can revoke an old owner; it must never transfer profile
  // attribution to the newly assigned operator implicitly.
  if (draft.user_id !== actor.userId) return deny("draft_owner_mismatch");
  if (!nonEmpty(draft.connection_id) || !nonEmpty(draft.opportunity_id)) {
    return deny("draft_identity_incomplete");
  }

  let internalThreadId: string | undefined;
  if (nonEmpty(draft.thread_id)) {
    const { data: threadData, error: threadError } = await db
      .from("email_threads")
      .select("id")
      .eq("company_id", actor.companyId)
      .eq("connection_id", draft.connection_id)
      .eq("provider_thread_id", draft.thread_id)
      .maybeSingle();
    if (threadError) return deny("lookup_failed");
    const threadId = (threadData as { id?: unknown } | null)?.id;
    if (!nonEmpty(threadId)) return deny("thread_not_found");
    internalThreadId = threadId;
  }

  const accessOperation: EmailOpportunityOperation = operation;
  const access = await resolveEmailOpportunityAccess({
    actor,
    operation: accessOperation,
    ...(internalThreadId ? { threadId: internalThreadId } : {}),
    connectionId: draft.connection_id,
    ...(draft.thread_id ? { providerThreadId: draft.thread_id } : {}),
    opportunityId: draft.opportunity_id,
    supabase: db,
  });
  if (!access.allowed) return access;

  return { ...access, draft };
}
