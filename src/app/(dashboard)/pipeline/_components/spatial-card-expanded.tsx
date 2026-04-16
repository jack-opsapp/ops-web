"use client";

import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  pipelineCardContentVariants,
  pipelineCardContentVariantsReduced,
} from "@/lib/utils/motion";
import { PipelineCardActions } from "./pipeline-card-actions";

// ── Types ──

interface SpatialCardExpandedProps {
  opportunity: Opportunity;
  canManage: boolean;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  onOpenDetail: () => void;
}

// ── Component ──

export const SpatialCardExpanded = memo(function SpatialCardExpanded({
  opportunity,
  canManage,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onAssign,
  onScheduleFollowUp,
  onOpenDetail,
}: SpatialCardExpandedProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? pipelineCardContentVariantsReduced
    : pipelineCardContentVariants;

  const days = getDaysInStage(opportunity);
  const stageName = getStageDisplayName(opportunity.stage);

  // Most recent correspondence date
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
    <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
      {/* ── Compact metrics ── */}
      <motion.div
        custom={0}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="flex flex-col gap-[3px] mb-2"
      >
        {/* Email stats */}
        {opportunity.correspondenceCount > 0 ? (
          <div className="flex items-center justify-between">
            <span className="font-kosugi text-micro text-text-3">
              {t("spatial.emailCount").replace("{count}", String(opportunity.correspondenceCount))}
              {" · "}
              {t("spatial.emailInOut")
                .replace("{in}", String(opportunity.inboundCount))
                .replace("{out}", String(opportunity.outboundCount))}
            </span>
            {lastCorrespondence && (
              <span className="font-mono text-micro text-text-mute">
                {formatTimeAgo(lastCorrespondence)}
              </span>
            )}
          </div>
        ) : (
          <span className="font-kosugi text-micro text-text-mute">
            {t("spatial.noCorrespondence")}
          </span>
        )}

        {/* Days in stage + follow-up */}
        <div className="flex items-center justify-between">
          <span className="font-kosugi text-micro text-text-mute">
            {t("spatial.daysInStage")
              .replace("{count}", String(days))
              .replace("{stage}", stageName)}
          </span>
          {followUp && (
            <span
              className="font-mono text-micro"
              style={{
                color: isDateOverdue(followUp)
                  ? "#93321A"
                  : isDateToday(followUp)
                    ? "#C4A868"
                    : undefined,
              }}
            >
              {isDateOverdue(followUp)
                ? t("spatial.overdueCount").replace("{count}", String(daysOverdue(followUp)))
                : isDateToday(followUp)
                  ? t("spatial.followUpToday")
                  : t("spatial.followUpDate").replace("{date}", formatShortDay(followUp))}
            </span>
          )}
        </div>
      </motion.div>

      {/* ── Actions ── */}
      <motion.div
        custom={1}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
      >
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
          onDiscard={onDiscard}
          onAssign={onAssign}
          onScheduleFollowUp={onScheduleFollowUp}
          onOpenDetail={onOpenDetail}
        />
      </motion.div>
    </div>
  );
});
