export type JobConversationAnchor = {
  readonly kind: "opportunity" | "project";
  readonly id: string;
};

export interface ConversationAnchorEvidence {
  readonly eventOpportunityId: string | null;
  readonly activityOpportunityId: string | null;
  readonly activityProjectId: string | null;
}

export function resolveConversationAnchor(
  input: ConversationAnchorEvidence
): JobConversationAnchor {
  const eventOpportunityId = normalizedId(input.eventOpportunityId);
  const activityOpportunityId = normalizedId(input.activityOpportunityId);
  const activityProjectId = normalizedId(input.activityProjectId);

  if (
    eventOpportunityId &&
    activityOpportunityId &&
    eventOpportunityId !== activityOpportunityId
  ) {
    throw new Error("CONVERSATION_ANCHOR_CONFLICT");
  }

  const opportunityId = eventOpportunityId ?? activityOpportunityId;
  if (opportunityId) {
    return Object.freeze({ kind: "opportunity", id: opportunityId });
  }
  if (activityProjectId) {
    return Object.freeze({ kind: "project", id: activityProjectId });
  }
  throw new Error("CONVERSATION_ANCHOR_MISSING");
}

function normalizedId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
