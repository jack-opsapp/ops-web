"use client";

import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Phone, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  type PipelineStageDefault,
  OPPORTUNITY_STAGE_COLORS,
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
  isDragging?: boolean;
  isOverlay?: boolean;
  stageConfig: PipelineStageDefault;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a date is today (date-only comparison) */
function isDateToday(date: Date | null): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

/** Check if a date is before today (date-only comparison) */
function isDateOverdue(date: Date | null): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dateOnly < todayOnly;
}

/** Calculate days overdue from today */
function daysOverdue(date: Date): number {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((todayOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24));
}

/** Format a date as short weekday (e.g. "Thu") */
function formatShortDay(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

/** Format relative time ago from a date */
function formatTimeAgo(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1d ago";
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
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
  isDragging = false,
  isOverlay = false,
  stageConfig,
}: PipelineCardProps) {
  const { t } = useDictionary("pipeline");
  const prefersReducedMotion = useReducedMotion();

  // --- Derived state ---
  const daysInStage = getDaysInStage(opportunity);
  const stale = isOpportunityStale(opportunity);
  const terminal = isTerminalStage(opportunity.stage);
  const stageColor = OPPORTUNITY_STAGE_COLORS[opportunity.stage];

  const followUpDate = opportunity.nextFollowUpAt;
  const followUpOverdue = isDateOverdue(followUpDate);
  const followUpToday = isDateToday(followUpDate);

  const canAdvance = !terminal && nextOpportunityStage(opportunity.stage) !== null;
  const canRetreat = !terminal && previousOpportunityStage(opportunity.stage) !== null;

  const nextStage = nextOpportunityStage(opportunity.stage);
  const prevStage = previousOpportunityStage(opportunity.stage);

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
  }, [followUpDate, followUpOverdue, followUpToday, t]);

  // --- Days in stage text ---
  const daysText = t("card.daysInStage").replace("{count}", String(daysInStage));

  // --- Last activity text ---
  const lastActivityText = useMemo(() => {
    if (!opportunity.lastActivityAt) return null;
    const timeAgo = formatTimeAgo(opportunity.lastActivityAt);
    // Use a generic "activity" label since we don't have the activity type on the card
    return t("card.lastActivity")
      .replace("{type}", "activity")
      .replace("{timeAgo}", timeAgo);
  }, [opportunity.lastActivityAt, t]);

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
        "bg-glass glass-surface backdrop-blur-xl",
        "border border-border rounded-[4px]",
        "border-l-[3px]",
        // Interaction
        "cursor-pointer group",
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
          <div className="flex items-center gap-[6px] min-w-0 flex-1">
            <span className="font-mohave text-body-sm font-medium text-text truncate">
              {clientName}
            </span>
          </div>

          <span className="shrink-0 font-mono text-data-sm text-text-2 tabular-nums">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "—"}
          </span>
        </div>

        {/* Line 2: Follow-up status + days in stage */}
        <div className="flex items-center gap-0 mt-[2px]">
          {followUpStatus && (
            <>
              <span className={cn("font-mono text-micro", followUpStatus.colorClass)}>
                {followUpStatus.text}
              </span>
              <span className="font-mono text-micro text-text-mute mx-[6px]">
                ·
              </span>
            </>
          )}
          <span className="font-mono text-micro text-text-3">
            {daysText}
          </span>
        </div>

        {/* Line 3: Health bar + chevron buttons */}
        <div className="flex items-center gap-[8px] mt-[6px]">
          <div className="flex-1 min-w-0">
            <PipelineHealthBar
              daysInStage={daysInStage}
              expectedDays={expectedDays}
            />
          </div>

          {/* Chevron buttons */}
          <div className="flex items-center gap-[2px] shrink-0">
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
                  "p-[3px] rounded-[2px] cursor-pointer",
                  "text-text-mute hover:text-text",
                  "hover:bg-surface-active",
                  "transition-all duration-150",
                  // Desktop: hidden until hover. Mobile: always visible.
                  "md:opacity-0 md:group-hover:opacity-100"
                )}
              >
                <ChevronLeft className="w-[14px] h-[14px]" />
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
                  "p-[3px] rounded-[2px] cursor-pointer",
                  "text-text-mute hover:text-text",
                  "hover:bg-surface-active",
                  "transition-all duration-150",
                  // Desktop: hidden until hover. Mobile: always visible.
                  "md:opacity-0 md:group-hover:opacity-100"
                )}
              >
                <ChevronRight className="w-[14px] h-[14px]" />
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
            <div className="px-[10px] py-[8px] flex flex-col gap-[8px]">
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
                      className="flex items-center gap-[4px] font-mono text-micro text-text-2 hover:text-text transition-colors"
                    >
                      <Phone className="w-[12px] h-[12px]" />
                      {opportunity.contactPhone}
                    </a>
                  )}
                  {opportunity.contactEmail && (
                    <a
                      href={`mailto:${opportunity.contactEmail}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-[4px] font-mono text-micro text-text-2 hover:text-text transition-colors"
                    >
                      <Mail className="w-[12px] h-[12px]" />
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
                    <Mail className="w-[11px] h-[11px] text-text-mute" />
                    <span className="font-mono text-micro text-text-3">
                      {opportunity.correspondenceCount} email{opportunity.correspondenceCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="text-text-mute font-mono text-micro">·</span>
                  <span className="font-mono text-micro text-text-mute">
                    {opportunity.inboundCount} in / {opportunity.outboundCount} out
                  </span>
                  {(opportunity.lastInboundAt || opportunity.lastOutboundAt) && (
                    <>
                      <span className="text-text-mute font-mono text-micro">·</span>
                      <span className="font-mono text-micro text-text-mute">
                        last {formatTimeAgo(
                          opportunity.lastInboundAt && opportunity.lastOutboundAt
                            ? (opportunity.lastInboundAt > opportunity.lastOutboundAt
                                ? opportunity.lastInboundAt
                                : opportunity.lastOutboundAt)
                            : opportunity.lastInboundAt || opportunity.lastOutboundAt!
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
                  className="font-mohave text-body-sm text-text-2 hover:text-text transition-colors cursor-pointer"
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
