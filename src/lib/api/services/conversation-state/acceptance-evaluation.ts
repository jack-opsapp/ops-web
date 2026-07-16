import type { SupabaseClient } from "@supabase/supabase-js";

import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";
import { ProjectConversionService } from "@/lib/api/services/project-conversion-service";
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

async function resolveNotificationRecipients(
  supabase: SupabaseClient,
  connection: EmailConnection
): Promise<string[]> {
  if (connection.userId) return [connection.userId];

  const managers = await getCompanyManagerUserIds(
    supabase,
    connection.companyId
  );
  if (managers.length > 0) return managers;

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", connection.companyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `accept notification recipient lookup failed: ${error.message}`
    );
  }
  return data?.id ? [data.id as string] : [];
}

async function notifyAcceptance(input: {
  supabase: SupabaseClient;
  connection: EmailConnection;
  opportunityId: string;
  clientName: string;
  kind: "auto-won" | "review-won";
}): Promise<void> {
  const recipients = await resolveNotificationRecipients(
    input.supabase,
    input.connection
  );
  const isAutoWon = input.kind === "auto-won";

  for (const userId of recipients) {
    const { error } = await input.supabase.rpc("create_notification_if_new", {
      p_user_id: userId,
      p_company_id: input.connection.companyId,
      p_type: "system",
      p_title: isAutoWon ? "Deal won" : "Possible deal won",
      p_body: isAutoWon
        ? `${input.clientName} accepted. This lead was moved to Won.`
        : `${input.clientName} may have accepted. Review and confirm.`,
      p_persistent: !isAutoWon,
      p_action_url: "/pipeline",
      p_action_label: isAutoWon ? "View lead" : "Mark as Won",
      p_dedupe_key: `email-accept:${input.kind}:${input.opportunityId}`,
    });
    if (error) {
      throw new Error(
        `accept notification persistence failed: ${error.message}`
      );
    }
  }
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

  let clientName = "A client";
  if (opportunity.client_id) {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("name")
      .eq("id", opportunity.client_id as string)
      .eq("company_id", connection.companyId)
      .maybeSingle();
    if (clientError) {
      throw new Error(`accept client lookup failed: ${clientError.message}`);
    }
    if (client?.name) clientName = client.name as string;
  }

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
    await notifyAcceptance({
      supabase,
      connection,
      opportunityId,
      clientName,
      kind: "auto-won",
    });
    return { stageChanged: true };
  }

  await notifyAcceptance({
    supabase,
    connection,
    opportunityId,
    clientName,
    kind: "review-won",
  });
  return { stageChanged: false };
}
