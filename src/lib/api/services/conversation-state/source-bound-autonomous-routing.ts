import type { AllowedEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

import type { RoutingDecision } from "./types";

export type SourceBoundAutonomousRouting = "assigned_contact_form_review";

export const ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT = "Thanks for reaching out";

export const ASSIGNED_CONTACT_FORM_REVIEW_INSTRUCTION =
  "Write a brief, warm first reply to the prospective customer. Acknowledge the request in the untrusted email data and suggest an appropriate next step, such as a quick call or site visit. Keep it short and do not invent specifics.";

interface SourceBoundAutonomousRoutingInput {
  authority: SourceBoundAutonomousRouting | null | undefined;
  autonomous: boolean;
  routing: RoutingDecision | null | undefined;
  sourceActivityId: string | null;
  authorizedSourceActivityId: string | null;
  companyId: string;
  userId: string;
  connectionId: string;
  opportunityId: string | undefined;
  origin: string | undefined;
  profileTypeOverride: string | undefined;
  emailAccess: AllowedEmailOpportunityAccess | undefined;
}

/**
 * Contact-form submissions deliberately have no durable customer thread: the
 * provider thread belongs to the forwarding platform, while OPS must create a
 * clean new outreach thread. The assignment queue is its deterministic router.
 *
 * This narrow authority may stand in for a thread routing decision only after
 * the caller supplies canonical send access and AIDraftService has independently
 * loaded the exact inbound activity from that access scope. Any mismatch falls
 * back to an unknown route, which the autonomy gate suppresses.
 */
export function resolveSourceBoundAutonomousRouting(
  input: SourceBoundAutonomousRoutingInput
): RoutingDecision | null | undefined {
  if (!input.authority) return input.routing;

  const access = input.emailAccess;
  const sourceActivityId = input.sourceActivityId?.trim() ?? "";
  const authorizedSourceActivityId =
    input.authorizedSourceActivityId?.trim() ?? "";
  const opportunityId = input.opportunityId?.trim() ?? "";

  if (
    input.authority !== "assigned_contact_form_review" ||
    !input.autonomous ||
    !sourceActivityId ||
    authorizedSourceActivityId !== sourceActivityId ||
    !opportunityId ||
    input.origin !== "phase_c" ||
    input.profileTypeOverride !== "client_new_inquiry" ||
    !access ||
    access.operation !== "send" ||
    access.threadId !== null ||
    access.providerThreadId !== null ||
    access.actor.companyId !== input.companyId ||
    access.actor.userId !== input.userId ||
    access.connectionId !== input.connectionId ||
    access.opportunityId !== opportunityId
  ) {
    return null;
  }

  return "draft";
}
