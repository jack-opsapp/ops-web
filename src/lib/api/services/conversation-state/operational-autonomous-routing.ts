import type { AllowedEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

import type { DraftMessageKind } from "./draft-system-prompt";
import type { RoutingDecision } from "./types";

export type OperationalAutonomousRoutingAuthority =
  "phase_c_stale_lead_follow_up";

interface OperationalAutonomousRoutingInput {
  authority: OperationalAutonomousRoutingAuthority | null | undefined;
  autonomous: boolean;
  routing: RoutingDecision | null | undefined;
  sourceActivityId: string | null;
  companyId: string;
  userId: string;
  connectionId: string;
  opportunityId: string | undefined;
  threadId: string | undefined;
  origin: string | undefined;
  profileTypeOverride: string | undefined;
  draftPurposeKind: DraftMessageKind;
  signatureWillBeAppended: boolean;
  emailAccess: AllowedEmailOpportunityAccess | undefined;
}

/**
 * A stale lead follow-up is intentionally proactive: the latest message is an
 * operator outbound, so the ordinary conversation router correctly reports
 * `update_lead_only`. Only the Phase C queue's exact assignment-, mailbox-,
 * thread-, and opportunity-bound follow-up may reinterpret that one decision
 * as draftable. Every other route and every incomplete authority is preserved.
 */
export function resolveOperationalAutonomousRouting(
  input: OperationalAutonomousRoutingInput
): RoutingDecision | null | undefined {
  if (
    input.authority !== "phase_c_stale_lead_follow_up" ||
    !input.autonomous ||
    input.routing !== "update_lead_only" ||
    input.sourceActivityId !== null ||
    input.origin !== "phase_c" ||
    input.profileTypeOverride !== "client_followup" ||
    input.draftPurposeKind !== "operational_outbound" ||
    !input.signatureWillBeAppended
  ) {
    return input.routing;
  }

  const access = input.emailAccess;
  const opportunityId = input.opportunityId?.trim() ?? "";
  const threadId = input.threadId?.trim() ?? "";
  const pipelineScopeAllowsAssignment =
    access?.pipelineScope === "assigned" || access?.pipelineScope === "all";
  const inboxScopeAllowsThread =
    access?.inboxScope === "assigned" ||
    access?.inboxScope === "all" ||
    (access?.inboxScope === "own" &&
      access.connectionType === "individual" &&
      access.connectionOwnerId === input.userId);
  if (
    !access ||
    access.operation !== "send" ||
    !pipelineScopeAllowsAssignment ||
    !inboxScopeAllowsThread ||
    !access.threadId ||
    !access.providerThreadId ||
    !opportunityId ||
    !threadId ||
    access.actor.companyId !== input.companyId ||
    access.actor.userId !== input.userId ||
    access.connectionId !== input.connectionId ||
    access.opportunityId !== opportunityId ||
    access.providerThreadId !== threadId
  ) {
    return input.routing;
  }

  return "draft";
}
