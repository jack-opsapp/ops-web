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
  onMarkWon: () => void;
  onMarkLost: () => void;
  onOpenDetail: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
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
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
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
        colorClass: "text-[#93321A]",
      };
    }

    if (followUpToday) {
      return {
        text: t("card.followUpToday"),
        colorClass: "text-[#C4A868]",
      };
    }

    // Future follow-up: show day of week
    const day = formatShortDay(followUpDate);
    return {
      text: t("card.followUpDate").replace("{date}", day),
      colorClass: "text-text-tertiary",
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
        "bg-[rgba(13,13,13,0.6)] backdrop-blur-xl",
        "border border-[rgba(255,255,255,0.08)] rounded-[4px]",
        "border-l-[3px]",
        // Interaction
        "cursor-pointer group",
        // Stacking: expanded cards must sit above siblings so dropdowns aren't clipped
        isExpanded ? "relative z-20" : "relative z-0",
        // Hover
        "hover:border-[rgba(255,255,255,0.15)]",
        // Stale pulse animation (active stages only)
        stale && !terminal && "animate-stale-pulse",
        // Drag placeholder state
        isDragging && "opacity-20",
        // Overlay state (being dragged)
        isOverlay && "scale-[1.03] border-[rgba(255,255,255,0.20)]"
      )}
    >
      {/* ── Collapsed content ────────────────────────────────────── */}
      <div className="px-[10px] py-[8px]">
        {/* Line 1: Client name + value */}
        <div className="flex items-center justify-between gap-[8px]">
          <div className="flex items-center gap-[6px] min-w-0 flex-1">
            <span className="font-mohave text-body-sm font-medium text-text-primary truncate">
              {clientName}
            </span>
          </div>

          <span className="shrink-0 font-mohave text-body-sm text-text-secondary">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "--"}
          </span>
        </div>

        {/* Line 2: Follow-up status + days in stage */}
        <div className="flex items-center gap-0 mt-[2px]">
          {followUpStatus && (
            <>
              <span className={cn("font-kosugi text-micro-sm", followUpStatus.colorClass)}>
                {followUpStatus.text}
              </span>
              <span className="font-kosugi text-micro-sm text-text-disabled mx-[6px]">
                ·
              </span>
            </>
          )}
          <span className="font-kosugi text-micro-sm text-text-tertiary">
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
                  "text-text-disabled hover:text-text-primary",
                  "hover:bg-[rgba(255,255,255,0.10)]",
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
                  "text-text-disabled hover:text-text-primary",
                  "hover:bg-[rgba(255,255,255,0.10)]",
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
            className="border-t border-[rgba(255,255,255,0.06)]"
          >
            <div className="px-[10px] py-[8px] flex flex-col gap-[8px]">
              {/* Contact info */}
              <motion.div
                variants={contentVariants}
                custom={0}
                className="flex flex-col gap-[2px]"
              >
                {opportunity.contactName && (
                  <span className="font-mohave text-body-sm text-text-secondary">
                    {opportunity.contactName}
                  </span>
                )}
                <div className="flex items-center gap-[10px]">
                  {opportunity.contactPhone && (
                    <a
                      href={`tel:${opportunity.contactPhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-[4px] font-kosugi text-micro-sm text-[#597794] hover:text-text-primary transition-colors"
                    >
                      <Phone className="w-[12px] h-[12px]" />
                      {opportunity.contactPhone}
                    </a>
                  )}
                  {opportunity.contactEmail && (
                    <a
                      href={`mailto:${opportunity.contactEmail}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-[4px] font-kosugi text-micro-sm text-[#597794] hover:text-text-primary transition-colors"
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
                    <Mail className="w-[11px] h-[11px] text-text-disabled" />
                    <span className="font-kosugi text-micro-sm text-text-tertiary">
                      {opportunity.correspondenceCount} email{opportunity.correspondenceCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="text-text-disabled font-kosugi text-micro-sm">·</span>
                  <span className="font-kosugi text-micro-sm text-text-disabled">
                    {opportunity.inboundCount} in / {opportunity.outboundCount} out
                  </span>
                  {(opportunity.lastInboundAt || opportunity.lastOutboundAt) && (
                    <>
                      <span className="text-text-disabled font-kosugi text-micro-sm">·</span>
                      <span className="font-kosugi text-micro-sm text-text-disabled">
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
                  onMarkWon={onMarkWon}
                  onMarkLost={onMarkLost}
                  onAssign={onAssign}
                  onScheduleFollowUp={onScheduleFollowUp}
                  onOpenDetail={onOpenDetail}
                />
              </motion.div>

              {/* Last activity */}
              {lastActivityText && (
                <motion.div variants={contentVariants} custom={2}>
                  <span className="font-kosugi text-micro-sm text-text-disabled">
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
                  className="font-mohave text-body-sm text-[#597794] hover:text-text-primary transition-colors cursor-pointer"
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
