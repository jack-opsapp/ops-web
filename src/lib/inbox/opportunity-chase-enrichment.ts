import { isLeadYourMove } from "@/lib/leads/chase-state";

export interface OpportunityChaseRow {
  id: string;
  stage: string;
  last_message_direction: "in" | "out" | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  handled_at: string | null;
  operator_action_required_at: string | null;
}

type LinkedThread = {
  opportunityId: string | null;
};

/** Overlay the canonical lead reply state onto linked inbox threads. */
export function applyOpportunityChaseState<T extends LinkedThread>(
  threads: readonly T[],
  opportunities: readonly OpportunityChaseRow[]
): Array<T & { opportunityNeedsReply: boolean | null }> {
  const opportunityById = new Map(
    opportunities.map((opportunity) => [opportunity.id, opportunity])
  );

  return threads.map((thread) => {
    if (!thread.opportunityId) {
      return { ...thread, opportunityNeedsReply: null };
    }
    const opportunity = opportunityById.get(thread.opportunityId);
    return {
      ...thread,
      opportunityNeedsReply: opportunity
        ? isLeadYourMove({
            stage: opportunity.stage,
            lastMessageDirection: opportunity.last_message_direction,
            lastInboundAt: opportunity.last_inbound_at,
            lastOutboundAt: opportunity.last_outbound_at,
            handledAt: opportunity.handled_at,
            operatorActionRequiredAt: opportunity.operator_action_required_at,
          })
        : null,
    };
  });
}
