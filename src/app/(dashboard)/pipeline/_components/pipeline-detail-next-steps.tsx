"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Clock,
  Mail,
  Phone,
  Calendar,
  CalendarClock,
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
import { useOpenBooking } from "@/lib/hooks/use-site-visits";
import { useBookingRequest } from "@/lib/hooks/use-booking-request";
import type { OpportunityAssignedContextFollowUp } from "@/lib/api/services/opportunity-assigned-context-service";
import { BookSiteVisitModal } from "@/components/ops/site-visit/book-site-visit-modal";
import { BookingRequestDecision } from "@/components/ops/site-visit/booking-request-decision";
import { formatVisitSlot } from "@/components/ops/site-visit/visit-slot";

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

  // Booked site visits are NOT a signal here — the booking slot at the end
  // of the strip carries the appointment state (exact day + time from the
  // booked_at-guarded read), replacing the old status-only projection that
  // could surface legacy junk scheduled_at values. A public booking request
  // rides the same slot for the same reason: one visit entry, whatever state
  // it is in.

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
  canManage: boolean;
}

export function PipelineDetailNextSteps({
  opportunity,
  followUps,
  canManage,
}: PipelineDetailNextStepsProps) {
  const { t } = useDictionary("pipeline");
  const [expanded, setExpanded] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);

  const completeFollowUp = useCompleteFollowUp();

  // The lead's one open booking (booked_at discriminator — never the
  // assigned-context rows, which carry no booked_at and would surface
  // legacy junk scheduled_at values).
  const { data: openBooking } = useOpenBooking(opportunity.id);

  // A public booking request in `request` mode put nothing on any calendar
  // (I14) — until somebody decides, it IS this lead's visit state.
  const { data: bookingRequest } = useBookingRequest(opportunity.id);

  const pendingFollowUps = useMemo(
    () =>
      followUps
        .filter((fu) => fu.status === FollowUpStatus.Pending)
        .sort(
          (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        ),
    [followUps]
  );

  const signals = useMemo(
    () => evaluateSignals(pendingFollowUps, opportunity, t),
    [pendingFollowUps, opportunity, t]
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

  // ── Booking slot — the strip's single state-aware visit entry ─────────
  //   open booking          → BOOKED — THU 10:00 (filled tan; manages behind it)
  //   pending request       → REQUESTED — THU 10:00 (outlined tan; decide behind it)
  //   free slot + canManage → quiet BOOK VISIT affordance
  //   free slot, read-only  → nothing
  //
  // `request` mode creates no visit, so a booking and a request should never
  // both be true. If they are, what is really on the calendar is the truth.
  const pendingRequest = openBooking ? null : (bookingRequest ?? null);

  const bookedLabel = openBooking
    ? t("nextSteps.booked", "BOOKED — {slot}").replace(
        "{slot}",
        formatVisitSlot(openBooking.scheduledAt)
      )
    : null;

  const requestedLabel = pendingRequest
    ? t("nextSteps.requested", "REQUESTED — {slot}").replace(
        "{slot}",
        formatVisitSlot(new Date(pendingRequest.slotStartAt))
      )
    : null;

  const chipClass = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 py-[2px]",
    "font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums",
    "[font-feature-settings:'tnum'_1,'zero'_1]"
  );

  // Filled = committed; outlined = proposed. The fill is what separates a
  // visit that exists from one that has only been asked for.
  const bookedChipClass = cn(
    chipClass,
    "border-[var(--tan-line)] bg-[var(--tan-soft)] text-[var(--tan)]"
  );
  const requestedChipClass = cn(
    chipClass,
    "border-[var(--tan-line)] bg-transparent text-[var(--tan)]"
  );

  const bookingSlot = bookedLabel ? (
    canManage ? (
      <button
        type="button"
        onClick={() => setBookingOpen(true)}
        className={cn(
          bookedChipClass,
          "transition-colors duration-150 hover:border-[var(--tan)]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        )}
      >
        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
        {bookedLabel}
      </button>
    ) : (
      <span className={bookedChipClass}>
        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
        {bookedLabel}
      </span>
    )
  ) : requestedLabel ? (
    canManage ? (
      <button
        type="button"
        onClick={() => setDecisionOpen(true)}
        className={cn(
          requestedChipClass,
          "transition-colors duration-150 hover:border-[var(--tan)]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        )}
      >
        <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
        {requestedLabel}
      </button>
    ) : (
      <span className={requestedChipClass}>
        <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
        {requestedLabel}
      </span>
    )
  ) : canManage ? (
    <button
      type="button"
      onClick={() => setBookingOpen(true)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1",
        "font-mono text-micro uppercase tracking-[0.14em] text-text-3",
        "transition-colors duration-150 hover:text-text-2",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      )}
    >
      <MapPin className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      {t("nextSteps.bookVisit", "BOOK VISIT")}
    </button>
  ) : null;

  return (
    <div className="shrink-0 border-b border-border-subtle px-3 py-1.5">
      {!primary ? (
        <div className="flex items-center gap-1.5">
          <CheckCircle className="h-3 w-3 shrink-0 text-text-mute" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-mute">
            {t("detail.noPendingActions")}
          </span>
          {bookingSlot}
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

            <div className="flex shrink-0 items-center gap-1.5">
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

              {bookingSlot}
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

      {/* One modal, mode derived from the slot state: free → book, open
          booking → reschedule/cancel. Never a second stacked booking. */}
      {canManage && (
        <BookSiteVisitModal
          opportunityId={opportunity.id}
          open={bookingOpen}
          onOpenChange={setBookingOpen}
          existingBooking={openBooking ?? null}
        />
      )}

      {/* Accepting here is what books the visit — nothing was on a calendar
          before it (I14). Declining books nothing and sends nothing. */}
      {canManage && pendingRequest && (
        <BookingRequestDecision
          opportunityId={opportunity.id}
          request={pendingRequest}
          open={decisionOpen}
          onOpenChange={setDecisionOpen}
        />
      )}
    </div>
  );
}
