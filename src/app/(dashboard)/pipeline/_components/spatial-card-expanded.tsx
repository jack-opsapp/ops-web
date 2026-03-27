"use client";

import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Phone, Mail } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import { PipelineCardActions } from "./pipeline-card-actions";
import {
  pipelineCardContentVariants,
  pipelineCardContentVariantsReduced,
} from "@/lib/utils/motion";

// ── Date helpers ──

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

  // Most recent correspondence date
  const lastCorrespondenceDate = (() => {
    const dates = [
      opportunity.lastInboundAt,
      opportunity.lastOutboundAt,
    ].filter(Boolean) as Date[];
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  })();

  return (
    <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
      {/* Contact info */}
      {opportunity.contactName && (
        <motion.div
          custom={0}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
          className="mb-1"
        >
          <p className="font-mohave text-sm text-[#999]">
            {opportunity.contactName}
          </p>
          <div className="flex items-center gap-3 mt-1">
            {opportunity.contactPhone && (
              <a
                href={`tel:${opportunity.contactPhone}`}
                className="flex items-center gap-1 text-[#597794] hover:text-white transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone className="w-3 h-3" />
                <span className="font-kosugi text-[10px]">
                  {opportunity.contactPhone}
                </span>
              </a>
            )}
            {opportunity.contactEmail && (
              <a
                href={`mailto:${opportunity.contactEmail}`}
                className="flex items-center gap-1 text-[#597794] hover:text-white transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Mail className="w-3 h-3" />
                <span className="font-kosugi text-[10px] truncate max-w-[120px]">
                  {opportunity.contactEmail}
                </span>
              </a>
            )}
          </div>
        </motion.div>
      )}

      {/* Email correspondence stats */}
      {opportunity.correspondenceCount > 0 && (
        <motion.div
          custom={1}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
          className="mb-1"
        >
          <p className="font-kosugi text-[10px] text-[#666]">
            {opportunity.correspondenceCount} email
            {opportunity.correspondenceCount !== 1 ? "s" : ""}
            {" · "}
            {opportunity.inboundCount} in / {opportunity.outboundCount} out
          </p>
          {lastCorrespondenceDate && (
            <p className="font-kosugi text-[10px] text-[#555]">
              last {formatTimeAgo(lastCorrespondenceDate)}
            </p>
          )}
        </motion.div>
      )}

      {/* Actions bar */}
      <motion.div
        custom={2}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="mt-2"
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

      {/* Last activity */}
      {opportunity.lastActivityAt && (
        <motion.p
          custom={3}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
          className="font-kosugi text-[10px] text-[#555] mt-1"
        >
          {t("spatial.activity").replace("{timeAgo}", formatTimeAgo(opportunity.lastActivityAt))}
        </motion.p>
      )}

      {/* Details link */}
      <motion.button
        custom={4}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="font-mohave text-sm text-[#597794] hover:text-white cursor-pointer mt-2"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetail();
        }}
      >
        {t("spatial.viewDetails")} →
      </motion.button>
    </div>
  );
});
