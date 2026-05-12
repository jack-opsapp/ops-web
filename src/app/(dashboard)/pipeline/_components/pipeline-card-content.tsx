"use client";

import { memo } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import {
  formatCurrency,
  getDaysInStage,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import { formatTimeAgo } from "@/lib/utils/date";
import { PipelineCardActions } from "./pipeline-card-actions";

type PipelineCardDensity = "compact" | "comfortable";

type PipelineCardActionHandlers = {
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
};

export interface PipelineCardContentProps
  extends Partial<PipelineCardActionHandlers> {
  opportunity: Opportunity;
  clientName: string;
  stageColor: string;
  stalenessOpacity: number;
  density: PipelineCardDensity;
  canManage?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
  isExpanded?: boolean;
  children?: React.ReactNode;
}

const noop = () => {};

export const PipelineCardContent = memo(function PipelineCardContent({
  opportunity,
  clientName,
  stageColor,
  stalenessOpacity,
  density,
  canManage = false,
  isSelected = false,
  isHovered = false,
  isExpanded = false,
  onLogCall = noop,
  onLogText = noop,
  onAddNote = noop,
  onArchive = noop,
  onDiscard = noop,
  onMarkWon = noop,
  onMarkLost = noop,
  onAssign = noop,
  onScheduleFollowUp = noop,
  onOpenDetail = noop,
  children,
}: PipelineCardContentProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();

  if (density === "compact") {
    const cardEdgeBorder = isSelected
      ? `2px solid ${stageColor}`
      : isHovered || isExpanded
        ? `1px solid ${stageColor}50`
        : "1px solid rgba(255,255,255,0.08)";

    return (
      <div
        className={cn(
          "w-full rounded-[4px]",
          !reduced && "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "rgba(13,13,13,0.6)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          borderTop: cardEdgeBorder,
          borderRight: cardEdgeBorder,
          borderBottom: cardEdgeBorder,
          borderLeft: `3px solid ${stageColor}`,
          boxShadow: isSelected ? `0 0 12px ${stageColor}40` : undefined,
          padding: "8px 10px",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mohave text-body-sm font-medium text-text truncate">
            {clientName}
          </span>
          <span className="font-mohave text-body-sm text-text-2 whitespace-nowrap">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "$--"}
          </span>
        </div>

        {children}
      </div>
    );
  }

  const displayTitle = opportunity.title || clientName;
  const stageName = getStageDisplayName(opportunity.stage);
  const daysInStage = getDaysInStage(opportunity);
  const lastCorrespondence = [
    opportunity.lastInboundAt,
    opportunity.lastOutboundAt,
  ]
    .filter(Boolean)
    .sort((a, b) => b!.getTime() - a!.getTime())[0];

  return (
    <div
      className={cn(
        "glass-surface w-full overflow-hidden rounded-panel",
        !reduced && "transition-[border-color,opacity] duration-150"
      )}
      style={{
        borderLeft: `4px solid ${stageColor}`,
        opacity: isHovered || isExpanded ? 1 : stalenessOpacity,
      }}
    >
      <div className="flex flex-col gap-1 p-2 pl-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-cakemono text-caption-sm font-light uppercase text-text">
              {displayTitle}
            </p>
            <p className="truncate font-mohave text-body-sm text-text-2">
              {clientName}
            </p>
          </div>
          <span className="shrink-0 font-mono text-data-sm text-text">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "—"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 border-t border-line pt-1">
          <Metric label={stageName} value={`${daysInStage}d`} />
          <Metric
            label={t("spatial.emailCount").replace(
              "{count}",
              String(opportunity.correspondenceCount)
            )}
            value={
              lastCorrespondence
                ? formatTimeAgo(lastCorrespondence)
                : "—"
            }
          />
          <Metric
            label={t("card.followUpDate").replace("{date}", "")}
            value={
              opportunity.nextFollowUpAt
                ? formatTimeAgo(opportunity.nextFollowUpAt)
                : "—"
            }
          />
        </div>

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
      </div>
    </div>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-mono text-micro uppercase text-text-3">
        {label}
      </p>
      <p className="truncate font-mono text-data-sm text-text-2">{value}</p>
    </div>
  );
}
