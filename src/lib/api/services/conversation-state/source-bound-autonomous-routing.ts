import type { AllowedEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

import type { RoutingDecision } from "./types";

export type SourceBoundAutonomousRouting = "assigned_contact_form_review";

export const ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT = "Thanks for reaching out";

/**
 * The server-owned purpose for a first reply to a new lead.
 *
 * "Acknowledge the request" produced exactly what it asked for: boilerplate
 * that never mentioned the customer's project. A first reply has to answer the
 * inquiry the customer actually sent — that is the entire value of the draft —
 * while still inventing nothing the customer did not supply.
 */
export const ASSIGNED_CONTACT_FORM_REVIEW_INSTRUCTION =
  "Respond to this new inquiry. Address exactly what the customer asked for or proposed (project type, details, any dates or appointment requests they offered) — never a generic acknowledgement. Propose the concrete next step. Do not invent specifics the customer did not provide, such as prices, measurements, or dates.";

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
