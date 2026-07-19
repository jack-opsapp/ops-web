"use client";

import { useCallback, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Phone, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { isDateToday, isDateOverdue, daysOverdue } from "@/lib/utils/date";
import {
  type Opportunity,
  type PipelineStageDefault,
  OPPORTUNITY_STAGE_COLORS,
  OpportunityStage,
  getDaysInStage,
  isOpportunityStale,
  isTerminalStage,
  nextOpportunityStage,
  previousOpportunityStage,
  getStageDisplayName,
  formatCurrency,
} from "@/lib/types/pipeline";
import {
  EASE_SMOOTH,
  pipelineCardContentVariants,
  pipelineCardContentVariantsReduced,
} from "@/lib/utils/motion";
import { PipelineHealthBar } from "./pipeline-health-bar";
import { PipelineCardActions } from "./pipeline-card-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineCardProps {
  opportunity: Opportunity;
  clientName: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAdvance: () => void;
  onRetreat: () => void;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onOpenDetail: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  /** Convert an already-won, unconverted deal — opens the Won dialog directly. */
  onConvert?: () => void;
  canManage: boolean;
  canAssign?: boolean;
  canConvert?: boolean;
  isDragging?: boolean;
  isOverlay?: boolean;
  stageConfig: PipelineStageDefault;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
// Date-only predicates (isDateToday / isDateOverdue / daysOverdue) come from
// the shared `@/lib/utils/date` util — no local duplicates. Display formatting
// (weekday, relative time) is locale-aware and lives inside the component so it
// can read the active locale + dictionary.
export function PipelineCard({
  opportunity,
  clientName,
  isExpanded,
  onToggleExpand,
  onAdvance,
  onRetreat,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  onConvert,
  canManage,
  canAssign = canManage,
  canConvert = canManage,
  isDragging = false,
  isOverlay = false,
  stageConfig,
}: PipelineCardProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const dateLocale = getDateLocale(locale);
  const prefersReducedMotion = useReducedMotion();

  // Weekday in the reader's locale ("Thu" / "jue").
  const formatShortDay = useCallback(
    (date: Date) =>
      new Date(date).toLocaleDateString(dateLocale, { weekday: "short" }),
    [dateLocale]
  );

  // Compact relative time, sourced from the dictionary so it localizes
  // ("5m ago" / "hace 5m"). Buckets: <1m, <1h, <1d, else days.
  const formatTimeAgo = useCallback(
    (date: Date) => {
      const diffMs = Date.now() - new Date(date).getTime();
      const diffMinutes = Math.floor(diffMs / 60_000);
      const diffHours = Math.floor(diffMs / 3_600_000);
      const diffDays = Math.floor(diffMs / 86_400_000);
      if (diffMinutes < 1) return t("card.timeAgo.now", "just now");
      if (diffMinutes < 60)
        return t("card.timeAgo.minutes", "{count}m ago").replace(
          "{count}",
          String(diffMinutes)
        );
      if (diffHours < 24)
        return t("card.timeAgo.hours", "{count}h ago").replace(
          "{count}",
          String(diffHours)
        );
      return t("card.timeAgo.days", "{count}d ago").replace(
        "{count}",
        String(diffDays)
      );
    },
    [t]
  );

  // --- Derived state ---
  const daysInStage = getDaysInStage(opportunity);
  const stale = isOpportunityStale(opportunity);
  const terminal = isTerminalStage(opportunity.stage);
  const stageColor = OPPORTUNITY_STAGE_COLORS[opportunity.stage];

  const followUpDate = opportunity.nextFollowUpAt;
  const followUpOverdue = isDateOverdue(followUpDate);
  const followUpToday = isDateToday(followUpDate);

  const rawNextStage = nextOpportunityStage(opportunity.stage);
  // Advancing into Won is a conversion — hide the forward chevron when the
  // operator can't convert, so the board's advance affordance matches the
  // focused card, the swipe, and the detail menu's Won gating.
  const nextStage =
    rawNextStage === OpportunityStage.Won && !canConvert ? null : rawNextStage;
  const prevStage = previousOpportunityStage(opportunity.stage);

  const canAdvance = !terminal && nextStage !== null;
  const canRetreat =
    !terminal && previousOpportunityStage(opportunity.stage) !== null;

  // Expected days for health bar: autoFollowUpDays * 3, fallback to 21
  const expectedDays = stageConfig.autoFollowUpDays
    ? stageConfig.autoFollowUpDays * 3
    : 21;

  // Content variants based on reduced motion preference
  const contentVariants = prefersReducedMotion
    ? pipelineCardContentVariantsReduced
    : pipelineCardContentVariants;

  // --- Follow-up status text ---
  const followUpStatus = useMemo(() => {
    if (!followUpDate) return null;

    if (followUpOverdue) {
      const count = daysOverdue(followUpDate);
      return {
        text: t("card.overdue").replace("{count}", String(count)),
        colorClass: "text-financial-overdue",
      };
    }

    if (followUpToday) {
      return {
        text: t("card.followUpToday"),
        colorClass: "text-tan",
      };
    }

    // Future follow-up: show day of week
    const day = formatShortDay(followUpDate);
    return {
      text: t("card.followUpDate").replace("{date}", day),
      colorClass: "text-text-3",
    };
  }, [followUpDate, followUpOverdue, followUpToday, formatShortDay, t]);

  // --- Days in stage text ---
  const daysText = t("card.daysInStage").replace(
    "{count}",
    String(daysInStage)
  );

  // --- Last activity text ---
  const lastActivityText = useMemo(() => {
    if (!opportunity.lastActivityAt) return null;
    const timeAgo = formatTimeAgo(opportunity.lastActivityAt);
    // Use a generic "activity" label since we don't have the activity type on the card
    return t("card.lastActivity")
      .replace("{type}", "activity")
      .replace("{timeAgo}", timeAgo);
  }, [opportunity.lastActivityAt, formatTimeAgo, t]);

  // --- Event handlers ---
  function handleAdvance(e: React.MouseEvent) {
    e.stopPropagation();
    if (canAdvance && canManage) onAdvance();
  }

  function handleRetreat(e: React.MouseEvent) {
    e.stopPropagation();
    if (canRetreat && canManage) onRetreat();
  }

  return (
    <motion.div
      layout={!prefersReducedMotion}
      transition={
        !prefersReducedMotion
          ? { layout: { duration: 0.25, ease: EASE_SMOOTH } }
          : undefined
      }
      onClick={onToggleExpand}
      style={{ borderLeftColor: stageColor }}
      className={cn(
        // Surface
        "glass-surface bg-glass backdrop-blur-xl",
        "rounded-chip border border-border",
        "border-l-[3px]",
        // Interaction
        "group cursor-pointer",
        // Stacking: expanded cards must sit above siblings so dropdowns aren't clipped
        isExpanded ? "relative z-20" : "relative z-0",
        // Hover
        "hover:border-line-hi",
        // Stale pulse animation (active stages only)
        stale && !terminal && "animate-stale-pulse",
        // Drag placeholder state
        isDragging && "opacity-20",
        // Overlay state (being dragged)
        isOverlay && "scale-[1.03] border-border-strong"
      )}
    >
      {/* ── Collapsed content ────────────────────────────────────── */}
      <div className="px-[10px] py-[8px]">
        {/* Line 1: Client name + value */}
        <div className="flex items-center justify-between gap-[8px]">
          <div className="flex min-w-0 flex-1 items-center gap-[6px]">
            <span className="truncate font-mohave text-body-sm font-medium text-text">
              {clientName}
            </span>
          </div>

          <span className="shrink-0 font-mono text-data-sm tabular-nums text-text-2">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "—"}
          </span>
        </div>

        {/* Line 2: Follow-up status + days in stage */}
        <div className="mt-[2px] flex items-center gap-0">
          {followUpStatus && (
            <>
              <span
                className={cn(
                  "font-mono text-micro",
                  followUpStatus.colorClass
                )}
              >
                {followUpStatus.text}
              </span>
              <span className="mx-[6px] font-mono text-micro text-text-mute">
                ·
              </span>
            </>
          )}
          <span className="font-mono text-micro text-text-3">{daysText}</span>
        </div>

        {/* Line 3: Health bar + chevron buttons */}
        <div className="mt-[6px] flex items-center gap-[8px]">
          <div className="min-w-0 flex-1">
            <PipelineHealthBar
              daysInStage={daysInStage}
              expectedDays={expectedDays}
            />
          </div>

          {/* Chevron buttons */}
          <div className="flex shrink-0 items-center gap-[2px]">
            {/* Retreat chevron */}
            {canRetreat && canManage && (
              <button
                type="button"
                onClick={handleRetreat}
                title={
                  prevStage
                    ? t("card.retreatStage").replace(
                        "{stage}",
                        getStageDisplayName(prevStage)
                      )
                    : undefined
                }
                className={cn(
                  "cursor-pointer rounded-bar p-[3px]",
                  "text-text-mute hover:text-text",
                  "hover:bg-surface-active",
                  "transition-all duration-150",
                  // Desktop: hidden until hover. Mobile: always visible.
                  "md:opacity-0 md:group-hover:opacity-100"
                )}
              >
                <ChevronLeft className="h-[14px] w-[14px]" />
              </button>
            )}

            {/* Advance chevron */}
            {canAdvance && canManage && (
              <button
                type="button"
                onClick={handleAdvance}
                title={
                  nextStage
                    ? t("card.advanceStage").replace(
                        "{stage}",
                        getStageDisplayName(nextStage)
                      )
                    : undefined
                }
                className={cn(
                  "cursor-pointer rounded-bar p-[3px]",
                  "text-text-mute hover:text-text",
                  "hover:bg-surface-active",
                  "transition-all duration-150",
                  // Desktop: hidden until hover. Mobile: always visible.
                  "md:opacity-0 md:group-hover:opacity-100"
                )}
              >
                <ChevronRight className="h-[14px] w-[14px]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Expanded content ─────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            className="border-t border-border-subtle"
          >
            <div className="flex flex-col gap-[8px] px-[10px] py-[8px]">
              {/* Contact info */}
              <motion.div
                variants={contentVariants}
                custom={0}
                className="flex flex-col gap-[2px]"
              >
                {opportunity.contactName && (
                  <span className="font-mohave text-body-sm text-text-2">
                    {opportunity.contactName}
                  </span>
                )}
                <div className="flex items-center gap-[10px]">
                  {opportunity.contactPhone && (
                    <a
                      href={`tel:${opportunity.contactPhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-[4px] font-mono text-micro text-text-2 transition-colors hover:text-text"
                    >
                      <Phone className="h-[12px] w-[12px]" />
                      {opportunity.contactPhone}
                    </a>
                  )}
                  {opportunity.contactEmail && (
                    <a
                      href={`mailto:${opportunity.contactEmail}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-[4px] font-mono text-micro text-text-2 transition-colors hover:text-text"
                    >
                      <Mail className="h-[12px] w-[12px]" />
                      {opportunity.contactEmail}
                    </a>
                  )}
                </div>
              </motion.div>

              {/* Email correspondence stats */}
              {opportunity.correspondenceCount > 0 && (
                <motion.div
                  variants={contentVariants}
                  custom={0.5}
                  className="flex items-center gap-[8px]"
                >
                  <div className="flex items-center gap-[4px]">
                    <Mail className="h-[11px] w-[11px] text-text-mute" />
                    <span className="font-mono text-micro text-text-3">
                      {t("card.emailCount", "{count} emails").replace(
                        "{count}",
                        String(opportunity.correspondenceCount)
                      )}
                    </span>
                  </div>
                  <span className="font-mono text-micro text-text-mute">·</span>
                  <span className="font-mono text-micro text-text-mute">
                    {t("card.inOut", "{inbound} in / {outbound} out")
                      .replace("{inbound}", String(opportunity.inboundCount))
                      .replace(
                        "{outbound}",
                        String(opportunity.outboundCount)
                      )}
                  </span>
                  {(opportunity.lastInboundAt ||
                    opportunity.lastOutboundAt) && (
                    <>
                      <span className="font-mono text-micro text-text-mute">
                        ·
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        {t("card.lastCorrespondence", "last {time}").replace(
                          "{time}",
                          formatTimeAgo(
                            opportunity.lastInboundAt &&
                              opportunity.lastOutboundAt
                              ? opportunity.lastInboundAt >
                                opportunity.lastOutboundAt
                                ? opportunity.lastInboundAt
                                : opportunity.lastOutboundAt
                              : opportunity.lastInboundAt ||
                                  opportunity.lastOutboundAt!
                          )
                        )}
                      </span>
                    </>
                  )}
                </motion.div>
              )}

              {/* Actions bar */}
              <motion.div variants={contentVariants} custom={1}>
                <PipelineCardActions
                  opportunityId={opportunity.id}
                  stage={opportunity.stage}
                  canManage={canManage}
                  canAssign={canAssign}
                  canConvert={canConvert}
                  onLogCall={onLogCall}
                  onLogText={onLogText}
                  onAddNote={onAddNote}
                  onArchive={onArchive}
                  onDiscard={onDiscard}
                  onMarkWon={onMarkWon}
                  onMarkLost={onMarkLost}
                  onAssign={onAssign}
                  onScheduleFollowUp={onScheduleFollowUp}
                  onOpenDetail={onOpenDetail}
                  onConvert={onConvert}
                />
              </motion.div>

              {/* Last activity */}
              {lastActivityText && (
                <motion.div variants={contentVariants} custom={2}>
                  <span className="font-mono text-micro text-text-mute">
                    {lastActivityText}
                  </span>
                </motion.div>
              )}

              {/* View full details link */}
              <motion.div variants={contentVariants} custom={3}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetail();
                  }}
                  className="cursor-pointer font-mohave text-body-sm text-text-2 transition-colors hover:text-text"
                >
                  {t("card.viewDetails")}
                </button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
