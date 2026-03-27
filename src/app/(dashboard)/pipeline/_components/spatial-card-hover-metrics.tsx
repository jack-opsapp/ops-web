"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import { getDaysInStage, getStageDisplayName } from "@/lib/types/pipeline";
import {
  spatialHoverMetricsVariants,
  spatialHoverMetricsVariantsReduced,
} from "@/lib/utils/motion";
import { CARD_WIDTH } from "./spatial-canvas-store";

// ── Date helpers (copied from pipeline-card.tsx) ──

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

function isDateOverdue(date: Date | null): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dateOnly < todayOnly;
}

function daysOverdue(date: Date): number {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(
    (todayOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatShortDay(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

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

// ── Types ──

interface SpatialCardHoverMetricsProps {
  opportunity: Opportunity;
  isVisible: boolean;
}

// ── Component ──

export function SpatialCardHoverMetrics({
  opportunity,
  isVisible,
}: SpatialCardHoverMetricsProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialHoverMetricsVariantsReduced
    : spatialHoverMetricsVariants;

  const days = getDaysInStage(opportunity);
  const stageName = getStageDisplayName(opportunity.stage);

  // Find most recent correspondence
  const lastCorrespondence = (() => {
    const dates = [
      opportunity.lastInboundAt,
      opportunity.lastOutboundAt,
    ].filter(Boolean) as Date[];
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  })();

  // Follow-up status
  const followUp = opportunity.nextFollowUpAt;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: "calc(100% + 4px)",
            width: CARD_WIDTH,
            zIndex: 10,
          }}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
        >
          <div className="flex flex-col gap-[2px]">
            {/* Days in stage */}
            <span className="font-kosugi text-[10px] text-[#666]">
              {t("spatial.daysInStage")
                .replace("{count}", String(days))
                .replace("{stage}", stageName)}
            </span>

            {/* Last correspondence */}
            <span className="font-kosugi text-[10px] text-[#555]">
              {lastCorrespondence
                ? t("spatial.emailTimeAgo").replace(
                    "{timeAgo}",
                    formatTimeAgo(lastCorrespondence)
                  )
                : t("spatial.noCorrespondence")}
            </span>

            {/* Follow-up status */}
            {followUp && (
              <span
                className="font-kosugi text-[10px]"
                style={{
                  color: isDateOverdue(followUp)
                    ? "#93321A"
                    : isDateToday(followUp)
                      ? "#C4A868"
                      : "#666",
                }}
              >
                {isDateOverdue(followUp)
                  ? t("spatial.overdueCount").replace(
                      "{count}",
                      String(daysOverdue(followUp))
                    )
                  : isDateToday(followUp)
                    ? t("spatial.followUpToday")
                    : t("spatial.followUpDate").replace(
                        "{date}",
                        formatShortDay(followUp)
                      )}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
