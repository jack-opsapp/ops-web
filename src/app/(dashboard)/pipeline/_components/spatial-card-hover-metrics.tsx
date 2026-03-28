"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import { getDaysInStage, getStageDisplayName } from "@/lib/types/pipeline";
import {
  isDateToday,
  isDateOverdue,
  daysOverdue,
  formatShortDay,
  formatTimeAgo,
} from "@/lib/utils/date";
import {
  spatialHoverMetricsVariants,
  spatialHoverMetricsVariantsReduced,
} from "@/lib/utils/motion";
import { CARD_WIDTH } from "./spatial-canvas-store";

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
            top: "calc(100% - 4px)",
            width: CARD_WIDTH,
            zIndex: 10,
            padding: "2px 10px 32px",
            background: "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.4) 70%, transparent 100%)",
            maskImage: "linear-gradient(to right, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)",
          }}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
        >
          <div className="flex flex-col gap-[2px]">
            {/* Days in stage */}
            <span className="font-kosugi text-micro-sm text-text-tertiary">
              {t("spatial.daysInStage")
                .replace("{count}", String(days))
                .replace("{stage}", stageName)}
            </span>

            {/* Last correspondence */}
            <span className="font-kosugi text-micro-sm text-text-tertiary">
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
                className="font-kosugi text-micro-sm"
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
