"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Clock,
  Mail,
  Phone,
  Calendar,
  CheckCircle,
  Check,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  FollowUpStatus,
  FollowUpType,
  isFollowUpOverdue,
  isFollowUpToday,
} from "@/lib/types/pipeline";
import { useCompleteFollowUp } from "@/lib/hooks";
import type {
  OpportunityAssignedContextFollowUp,
  OpportunityAssignedContextSiteVisit,
} from "@/lib/api/services/opportunity-assigned-context-service";

// ── Signal evaluation ──

interface Signal {
  icon: typeof Clock;
  text: string;
  color: "error" | "amber" | "secondary" | "disabled";
  followUpId?: string;
}

function getFollowUpIcon(type: FollowUpType) {
  switch (type) {
    case FollowUpType.Call:
      return Phone;
    case FollowUpType.Email:
      return Mail;
    case FollowUpType.Meeting:
      return Calendar;
    default:
      return Clock;
  }
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

function formatDaysAgo(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function formatDaysUntil(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

function evaluateSignals(
  pendingFollowUps: OpportunityAssignedContextFollowUp[],
  opportunity: Opportunity,
  upcomingVisitDate: Date | null,
  t: (key: string) => string
): Signal[] {
  const signals: Signal[] = [];
  const now = new Date();

  // Priority 1: Overdue follow-ups
  const overdue = pendingFollowUps.filter(isFollowUpOverdue);
  for (const fu of overdue) {
    const days = daysBetween(now, new Date(fu.dueAt));
    signals.push({
      icon: getFollowUpIcon(fu.type),
      text: `${fu.title} ${t("detail.overdueBy")} ${days}d`,
      color: "error",
      followUpId: fu.id,
    });
  }

  // Priority 2: Due today
  const dueToday = pendingFollowUps.filter(
    (fu) => !isFollowUpOverdue(fu) && isFollowUpToday(fu)
  );
  for (const fu of dueToday) {
    signals.push({
      icon: getFollowUpIcon(fu.type),
      text: `${fu.title} ${t("detail.dueToday")}`,
      color: "amber",
      followUpId: fu.id,
    });
  }

  // Priority 3: Estimate sent, no inbound since
  if (opportunity.lastOutboundAt && !opportunity.lastInboundAt) {
    const days = daysBetween(now, new Date(opportunity.lastOutboundAt));
    if (days >= 2) {
      signals.push({
        icon: Mail,
        text: `${t("detail.estimateSentNoResponse")} · ${formatDaysAgo(days)}`,
        color: "secondary",
      });
    }
  } else if (
    opportunity.lastOutboundAt &&
    opportunity.lastInboundAt &&
    new Date(opportunity.lastOutboundAt) > new Date(opportunity.lastInboundAt)
  ) {
    // Priority 4: Last message was outbound, no response
    const days = daysBetween(now, new Date(opportunity.lastOutboundAt));
    if (days >= 3) {
      signals.push({
        icon: Mail,
        text: `${t("detail.noResponseSince")} · ${formatDaysAgo(days)}`,
        color: "secondary",
      });
    }
  }

  // Priority 5: Upcoming follow-ups (next 7 days, not overdue, not today)
  const upcoming = pendingFollowUps.filter((fu) => {
    if (isFollowUpOverdue(fu) || isFollowUpToday(fu)) return false;
    const dueDate = new Date(fu.dueAt);
    const days = daysBetween(now, dueDate);
    return days <= 7 && dueDate > now;
  });
  for (const fu of upcoming) {
    const days = daysBetween(now, new Date(fu.dueAt));
    signals.push({
      icon: getFollowUpIcon(fu.type),
      text: `${fu.title} ${t("detail.scheduledIn")} ${formatDaysUntil(days)}`,
      color: "secondary",
      followUpId: fu.id,
    });
  }

  // Priority 6: Upcoming site visit
  if (upcomingVisitDate) {
    const days = daysBetween(now, upcomingVisitDate);
    signals.push({
      icon: MapPin,
      text: `${t("detail.siteVisitScheduled")} ${formatDaysUntil(days)}`,
      color: "secondary",
    });
  }

  return signals;
}

// ── Component ──

const COLOR_MAP = {
  error: "text-ops-error",
  amber: "text-ops-amber",
  secondary: "text-text-2",
  disabled: "text-text-mute",
} as const;

interface PipelineDetailNextStepsProps {
  opportunity: Opportunity;
  followUps: OpportunityAssignedContextFollowUp[];
  siteVisits: OpportunityAssignedContextSiteVisit[];
  canManage: boolean;
}

export function PipelineDetailNextSteps({
  opportunity,
  followUps,
  siteVisits,
  canManage,
}: PipelineDetailNextStepsProps) {
  const { t } = useDictionary("pipeline");
  const [expanded, setExpanded] = useState(false);

  const completeFollowUp = useCompleteFollowUp();

  const pendingFollowUps = useMemo(
    () =>
      followUps
        .filter((fu) => fu.status === FollowUpStatus.Pending)
        .sort(
          (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        ),
    [followUps]
  );

  const upcomingVisitDate = useMemo(() => {
    const now = new Date();
    const upcoming = siteVisits
      .filter(
        (sv) => sv.status === "scheduled" && new Date(sv.scheduledAt) > now
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      );
    return upcoming[0] ? new Date(upcoming[0].scheduledAt) : null;
  }, [siteVisits]);

  const signals = useMemo(
    () => evaluateSignals(pendingFollowUps, opportunity, upcomingVisitDate, t),
    [pendingFollowUps, opportunity, upcomingVisitDate, t]
  );

  const handleComplete = useCallback(
    (followUpId: string) => {
      if (!canManage) return;
      completeFollowUp.mutate({ id: followUpId });
    },
    [canManage, completeFollowUp]
  );

  const primary = signals[0];
  const remaining = signals.slice(1);

  return (
    <div className="shrink-0 border-b border-border-subtle px-3 py-1.5">
      {!primary ? (
        <div className="flex items-center gap-1.5">
          <CheckCircle className="h-3 w-3 shrink-0 text-text-mute" />
          <span className="font-mono text-[11px] text-text-mute">
            {t("detail.noPendingActions")}
          </span>
        </div>
      ) : (
        <>
          {/* Primary signal */}
          <div className="flex items-center gap-1.5">
            <primary.icon
              className={cn("h-3 w-3 shrink-0", COLOR_MAP[primary.color])}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-[11px]",
                COLOR_MAP[primary.color]
              )}
            >
              {primary.text}
            </span>

            <div className="flex shrink-0 items-center gap-1">
              {primary.followUpId && canManage && (
                <button
                  onClick={() => handleComplete(primary.followUpId!)}
                  disabled={completeFollowUp.isPending}
                  className="flex h-4 w-4 items-center justify-center rounded-bar text-text-mute transition-colors hover:bg-fill-neutral-dim hover:text-status-success"
                >
                  <Check className="h-2.5 w-2.5" />
                </button>
              )}

              {remaining.length > 0 && (
                <button
                  onClick={() => setExpanded((prev) => !prev)}
                  className="px-1 font-mono text-micro text-text-mute transition-colors hover:text-text-3"
                >
                  +{remaining.length} {t("detail.moreFollowUps")}
                </button>
              )}
            </div>
          </div>

          {/* Expanded list */}
          {expanded && remaining.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {remaining.map((signal, idx) => (
                <div
                  key={signal.followUpId ?? idx}
                  className="flex items-center gap-1.5"
                >
                  <signal.icon
                    className={cn(
                      "h-2.5 w-2.5 shrink-0",
                      COLOR_MAP[signal.color]
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-micro",
                      COLOR_MAP[signal.color]
                    )}
                  >
                    {signal.text}
                  </span>
                  {signal.followUpId && canManage && (
                    <button
                      onClick={() => handleComplete(signal.followUpId!)}
                      disabled={completeFollowUp.isPending}
                      className="flex h-4 w-4 items-center justify-center rounded-bar text-text-mute transition-colors hover:bg-fill-neutral-dim hover:text-status-success"
                    >
                      <Check className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
