export type OpportunityLifecycleDecisionAction =
  | "create_follow_up_draft"
  | "archive_after_two_unanswered_followups"
  | "archive_no_meaningful_correspondence"
  | "archive_operator_no_response"
  | "operator_follow_up_miss"
  | "move_to_lost_operator_no_response"
  | "reactivate_on_related_inbound"
  | "no_action";

export interface LeadLifecycleSettings {
  followUpAfterDays: number;
  secondFollowUpArchiveAfterDays: number;
  noCorrespondenceArchiveDays: number;
  inboundUnrepliedLostDays: number;
  followUpTemplateSubject: string;
  followUpTemplateBody: string;
  autoArchiveEnabled: boolean;
  autoLostEnabled: boolean;
}

export interface OpportunityLifecycleOpportunity {
  id: string;
  stage: string | null;
  archivedAt?: string | Date | null;
  deletedAt?: string | Date | null;
  projectId?: string | null;
  projectRef?: string | null;
  createdAt?: string | Date | null;
  stageEnteredAt?: string | Date | null;
}

export interface OpportunityLifecycleStateInput {
  unansweredFollowUpCount?: number | null;
  secondFollowUpSentAt?: string | Date | null;
  operatorFollowUpMissAt?: string | Date | null;
  lastMeaningfulAt?: string | Date | null;
}

export interface OpportunityLifecycleMeaningfulEvent {
  id: string;
  direction: "inbound" | "outbound";
  isMeaningful: boolean;
  occurredAt: string | Date;
  partyRole?: string | null;
  linkedContactKind?: string | null;
}

export interface OpportunityLifecycleEvaluationInput {
  opportunity: OpportunityLifecycleOpportunity;
  lifecycleState: OpportunityLifecycleStateInput | null;
  meaningfulEvents: OpportunityLifecycleMeaningfulEvent[];
  settings: LeadLifecycleSettings;
  now?: Date;
}

export interface OpportunityLifecycleDecision {
  action: OpportunityLifecycleDecisionAction;
  dryRun: true;
  ignored: boolean;
  reason: string;
  opportunityId: string;
  evidence: Record<string, unknown>;
}

export const DEFAULT_FOLLOW_UP_TEMPLATE_BODY =
  "Hi {{first_name}}, just checking in to see if you had any questions about the quote. No pressure — I wanted to make sure you had everything you needed.";
export const DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT = "Following up";

export const DEFAULT_LEAD_LIFECYCLE_SETTINGS: LeadLifecycleSettings = {
  followUpAfterDays: 7,
  secondFollowUpArchiveAfterDays: 7,
  noCorrespondenceArchiveDays: 14,
  inboundUnrepliedLostDays: 30,
  followUpTemplateSubject: DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
  followUpTemplateBody: DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
  autoArchiveEnabled: true,
  autoLostEnabled: true,
};

const ACTIVE_STAGES = new Set([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
]);

const TERMINAL_STAGES = new Set([
  "won",
  "lost",
  "discarded",
  "archived",
  "merged",
  "converted",
  "disqualified",
]);

const BEYOND_QUALIFIED_STAGES = new Set([
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function stageOf(opportunity: OpportunityLifecycleOpportunity): string {
  return opportunity.stage?.trim().toLowerCase() ?? "";
}

function latestMeaningfulEvent(
  events: OpportunityLifecycleMeaningfulEvent[]
): OpportunityLifecycleMeaningfulEvent | null {
  return [...events]
    .filter((event) => event.isMeaningful)
    .sort((a, b) => {
      const aTime = parseDate(a.occurredAt)?.getTime() ?? 0;
      const bTime = parseDate(b.occurredAt)?.getTime() ?? 0;
      return bTime - aTime;
    })[0] ?? null;
}

function noAction(
  input: OpportunityLifecycleEvaluationInput,
  reason: string,
  ignored = false,
  evidence: Record<string, unknown> = {}
): OpportunityLifecycleDecision {
  return {
    action: "no_action",
    dryRun: true,
    ignored,
    reason,
    opportunityId: input.opportunity.id,
    evidence,
  };
}

function decision(
  input: OpportunityLifecycleEvaluationInput,
  action: OpportunityLifecycleDecisionAction,
  reason: string,
  evidence: Record<string, unknown> = {}
): OpportunityLifecycleDecision {
  return {
    action,
    dryRun: true,
    ignored: false,
    reason,
    opportunityId: input.opportunity.id,
    evidence,
  };
}

function isRelatedInbound(event: OpportunityLifecycleMeaningfulEvent | null): boolean {
  if (!event || event.direction !== "inbound" || !event.isMeaningful) return false;
  const linkedKind = event.linkedContactKind?.trim().toLowerCase();
  return linkedKind === "related_contact" || linkedKind === "high_confidence_related_contact";
}

function hasInboundAfter(
  events: OpportunityLifecycleMeaningfulEvent[],
  since: Date
): boolean {
  return events.some((event) => {
    const occurredAt = parseDate(event.occurredAt);
    return (
      event.isMeaningful &&
      event.direction === "inbound" &&
      Boolean(occurredAt && occurredAt > since)
    );
  });
}

export function evaluateOpportunityLifecycle(
  input: OpportunityLifecycleEvaluationInput
): OpportunityLifecycleDecision {
  const now = input.now ?? new Date();
  const stage = stageOf(input.opportunity);
  const archivedAt = parseDate(input.opportunity.archivedAt);
  const deletedAt = parseDate(input.opportunity.deletedAt);
  const latestEvent = latestMeaningfulEvent(input.meaningfulEvents);

  if (TERMINAL_STAGES.has(stage)) {
    return noAction(input, "Terminal opportunities are not monitored.", true, { stage });
  }

  if (deletedAt || input.opportunity.projectId || input.opportunity.projectRef) {
    return noAction(input, "Deleted or converted opportunities are protected.", true, {
      deletedAt: deletedAt?.toISOString() ?? null,
      projectId: input.opportunity.projectId ?? null,
      projectRef: input.opportunity.projectRef ?? null,
    });
  }

  if (archivedAt) {
    if (isRelatedInbound(latestEvent)) {
      return decision(
        input,
        "reactivate_on_related_inbound",
        "A related meaningful inbound arrived on an archived opportunity.",
        {
          latestEventId: latestEvent?.id ?? null,
          latestEventAt: latestEvent?.occurredAt ?? null,
        }
      );
    }
    return noAction(input, "Archived opportunities are not monitored.", true, {
      archivedAt: archivedAt.toISOString(),
    });
  }

  if (!ACTIVE_STAGES.has(stage)) {
    return noAction(input, "Opportunity stage is not monitored by P4.", true, { stage });
  }

  const secondFollowUpSentAt = parseDate(input.lifecycleState?.secondFollowUpSentAt);
  const unansweredFollowUpCount = Number(
    input.lifecycleState?.unansweredFollowUpCount ?? 0
  );
  if (
    input.settings.autoArchiveEnabled &&
    unansweredFollowUpCount >= 2 &&
    secondFollowUpSentAt &&
    daysBetween(secondFollowUpSentAt, now) >=
      input.settings.secondFollowUpArchiveAfterDays &&
    !hasInboundAfter(input.meaningfulEvents, secondFollowUpSentAt)
  ) {
    return decision(
      input,
      "archive_after_two_unanswered_followups",
      "Two tracked OPS follow-ups are unanswered past the archive threshold.",
      {
        unansweredFollowUpCount,
        secondFollowUpSentAt: secondFollowUpSentAt.toISOString(),
      }
    );
  }

  if (!latestEvent) {
    const staleClock =
      parseDate(input.lifecycleState?.lastMeaningfulAt) ??
      parseDate(input.opportunity.stageEnteredAt) ??
      parseDate(input.opportunity.createdAt);
    if (
      input.settings.autoArchiveEnabled &&
      staleClock &&
      daysBetween(staleClock, now) >= input.settings.noCorrespondenceArchiveDays
    ) {
      return decision(
        input,
        "archive_no_meaningful_correspondence",
        "No meaningful correspondence exists past the archive threshold.",
        {
          staleClock: staleClock.toISOString(),
          thresholdDays: input.settings.noCorrespondenceArchiveDays,
        }
      );
    }
    return noAction(input, "No meaningful correspondence is available yet.");
  }

  const latestAt = parseDate(latestEvent.occurredAt);
  if (!latestAt) return noAction(input, "Latest meaningful correspondence timestamp is invalid.");

  if (latestEvent.direction === "inbound") {
    const daysUnreplied = daysBetween(latestAt, now);
    // ARCHIVE-FIRST auto-cleanup. A meaningful customer inbound that OPS never
    // answered, gone stale past the no-response window, is ARCHIVED — for every
    // active stage, not only beyond-qualified ones. We deliberately do NOT
    // auto-mark these "lost": archiving is reversible and judgment-free, and a
    // later related inbound auto-reactivates the lead. Classifying the final
    // disposition (lost vs. archived vs. discarded) is deferred to phase C's
    // intelligent determination — the `beyondQualified` evidence flag preserves
    // the signal it will use (a beyond-qualified archive is a strong lost
    // candidate; an early-stage one is more likely a cold/forgotten lead).
    // `move_to_lost_operator_no_response` is intentionally no longer produced
    // here; its executor + audit path remain intact for phase C to drive.
    if (
      input.settings.autoArchiveEnabled &&
      daysUnreplied >= input.settings.inboundUnrepliedLostDays
    ) {
      return decision(
        input,
        "archive_operator_no_response",
        "Meaningful inbound went unanswered past the no-response window — archiving (lost/discard classification deferred to phase C).",
        {
          latestEventId: latestEvent.id,
          daysUnreplied,
          archiveReason: "operator_no_response",
          beyondQualified: BEYOND_QUALIFIED_STAGES.has(stage),
        }
      );
    }
    return decision(
      input,
      "operator_follow_up_miss",
      "Meaningful inbound has no later OPS reply.",
      {
        latestEventId: latestEvent.id,
        daysUnreplied,
      }
    );
  }

  if (daysBetween(latestAt, now) >= input.settings.followUpAfterDays) {
    return decision(
      input,
      "create_follow_up_draft",
      "Last meaningful OPS outbound is past the follow-up draft threshold.",
      {
        latestEventId: latestEvent.id,
        latestOutboundAt: latestAt.toISOString(),
        thresholdDays: input.settings.followUpAfterDays,
        templateBody: input.settings.followUpTemplateBody,
      }
    );
  }

  return noAction(input, "No P4 lifecycle action is due.");
}
