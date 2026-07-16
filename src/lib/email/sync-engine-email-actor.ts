import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolvePhaseCEmailActor,
  type PhaseCEmailActorResolution,
  type ResolvePhaseCEmailActorInput,
} from "@/lib/email/phase-c-email-actor";
import type { EmailOpportunityOperation } from "@/lib/email/email-opportunity-access";

type ActorResolver = (
  input: ResolvePhaseCEmailActorInput
) => Promise<PhaseCEmailActorResolution>;

export interface ResolveSyncEngineEmailActorInput {
  companyId: string;
  connectionId: string;
  opportunityId: string;
  providerThreadId: string;
  operation: Extract<EmailOpportunityOperation, "read" | "edit" | "send">;
  opportunityAction?: "view" | "edit" | "convert";
  expectedAssignmentVersion?: number | null;
  supabase: SupabaseClient;
  /** Test seam. Production resolves through the canonical Phase C boundary. */
  actorResolver?: ActorResolver;
}

export type SyncEngineEmailActorResolution =
  | PhaseCEmailActorResolution
  | { kind: "no_work"; reason: "thread_not_found" | "lookup_failed" };

/**
 * Resolve one assigned OPS actor from the exact durable mailbox/thread/lead
 * tuple. A mailbox connector user and an email-address match are never actor
 * evidence. Missing or conflicting linkage returns typed no-work.
 */
export async function resolveSyncEngineEmailActor(
  input: ResolveSyncEngineEmailActorInput
): Promise<SyncEngineEmailActorResolution> {
  const { data, error } = await input.supabase
    .from("email_threads")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("connection_id", input.connectionId)
    .eq("provider_thread_id", input.providerThreadId)
    .eq("opportunity_id", input.opportunityId)
    .maybeSingle();
  if (error) return { kind: "no_work", reason: "lookup_failed" };
  const internalThreadId =
    typeof data?.id === "string" && data.id ? data.id : null;
  if (!internalThreadId) {
    return { kind: "no_work", reason: "thread_not_found" };
  }

  const actorResolver = input.actorResolver ?? resolvePhaseCEmailActor;
  return actorResolver({
    companyId: input.companyId,
    connectionId: input.connectionId,
    opportunityId: input.opportunityId,
    internalThreadId,
    providerThreadId: input.providerThreadId,
    expectedAssignmentVersion: input.expectedAssignmentVersion,
    operation: input.operation,
    opportunityAction: input.opportunityAction,
    supabase: input.supabase,
  });
}
