import type { SupabaseClient } from "@supabase/supabase-js";

import { ProjectConversionService } from "@/lib/api/services/project-conversion-service";
import { createEmailOpportunityNotification } from "@/lib/email/email-opportunity-notification";
import type { EmailConnection } from "@/lib/types/email-connection";

import { decideAcceptStage } from "./accept-stage";
import { buildConversationState } from "./conversation-state";
import { persistRoutingDecision } from "./persist-routing";

interface AcceptanceEvaluationInput {
  supabase: SupabaseClient;
  providerThreadId: string;
  opportunityId: string;
  connection: EmailConnection;
}

/**
 * Rebuild the exact mailbox thread after message or attachment facts change,
 * then apply the deterministic acceptance decision to its attributed lead.
 * The conversion and notifications are idempotent, so both sync-time and the
 * durable attachment-inspection worker can safely call this boundary.
 */
export async function evaluateOpportunityAcceptance({
  supabase,
  providerThreadId,
  opportunityId,
  connection,
}: AcceptanceEvaluationInput): Promise<{ stageChanged: boolean }> {
  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("stage, stage_manually_set, client_id, assignment_version")
    .eq("id", opportunityId)
    .eq("company_id", connection.companyId)
    .maybeSingle();
  if (opportunityError) {
    throw new Error(
      `accept opportunity lookup failed: ${opportunityError.message}`
    );
  }
  if (!opportunity) return { stageChanged: false };
  if (opportunity.stage_manually_set) return { stageChanged: false };
  if (["won", "lost", "discarded"].includes(opportunity.stage as string)) {
    return { stageChanged: false };
  }

  const { data: thread, error: threadError } = await supabase
    .from("email_threads")
    .select("id, provider_thread_id")
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .eq("provider_thread_id", providerThreadId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (threadError) {
    throw new Error(`accept thread lookup failed: ${threadError.message}`);
  }
  const internalThreadId = (thread?.id as string | undefined) ?? null;
  const durableProviderThreadId =
    (thread?.provider_thread_id as string | undefined) ?? null;
  if (!internalThreadId || !durableProviderThreadId) {
    return { stageChanged: false };
  }

  const state = await buildConversationState(internalThreadId);
  if (!state) return { stageChanged: false };
  await persistRoutingDecision(internalThreadId, state);

  const action = decideAcceptStage(state.accept, state.stage, state.routing);
  if (action.kind === "none") return { stageChanged: false };

  if (action.kind === "auto_advance_won") {
    const assignmentVersion = opportunity.assignment_version;
    if (
      !Number.isSafeInteger(assignmentVersion) ||
      (assignmentVersion as number) < 0
    ) {
      throw new Error("email acceptance has no assignment snapshot");
    }
    const conversion =
      await ProjectConversionService.convertOpportunityToProject({
        opportunityId,
        companyId: connection.companyId,
        decidedBy: null,
        sourcePath: "email_accept",
        expectedStage: opportunity.stage as string,
        expectedAssignmentVersion: assignmentVersion as number,
        evidence: {
          connection_id: connection.id,
          email_thread_id: internalThreadId,
          provider_thread_id: durableProviderThreadId,
          decision: "auto_advance_won",
        },
      });
    if (!conversion.won) {
      throw new Error(
        "canonical email acceptance conversion did not win the opportunity"
      );
    }
    await createEmailOpportunityNotification({
      connectionId: connection.id,
      opportunityId,
      providerThreadId: durableProviderThreadId,
      expectedAssignmentVersion: assignmentVersion as number,
      eventType: "accept_auto_won",
      supabase,
    });
    return { stageChanged: true };
  }

  const assignmentVersion = opportunity.assignment_version;
  if (
    Number.isSafeInteger(assignmentVersion) &&
    (assignmentVersion as number) >= 0
  ) {
    await createEmailOpportunityNotification({
      connectionId: connection.id,
      opportunityId,
      providerThreadId: durableProviderThreadId,
      expectedAssignmentVersion: assignmentVersion as number,
      eventType: "accept_review_won",
      supabase,
    });
  }
  return { stageChanged: false };
}
