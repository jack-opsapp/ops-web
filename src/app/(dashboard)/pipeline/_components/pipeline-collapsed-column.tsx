"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import {
  type OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getStageDisplayName,
} from "@/lib/types/pipeline";

interface PipelineCollapsedColumnProps {
  stage: OpportunityStage;
  count: number;
  /** Highest deal count across all active stages — used to scale fill height */
  maxCount: number;
  /** Called when user clicks the bar to swap it into the visible area */
  onExpand: () => void;
}

export function PipelineCollapsedColumn({
  stage,
  count,
  maxCount,
  onExpand,
}: PipelineCollapsedColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];
  const stageName = getStageDisplayName(stage);
  const fillPercent = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;

  return (
    <div
      ref={setNodeRef}
      onClick={onExpand}
      className={cn(
        "w-[40px] min-w-[40px] shrink-0 flex flex-col h-full cursor-pointer group",
        "border-t-[3px] bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
        "border border-[rgba(255,255,255,0.06)] rounded-[4px]",
        "hover:border-[rgba(255,255,255,0.15)] transition-colors",
        isOver && "bg-[rgba(89,119,148,0.12)] border-[rgba(89,119,148,0.3)]"
      )}
      style={{ borderTopColor: stageColor }}
      title={`${stageName}: ${count} deals`}
    >
      {/* Count badge */}
      <div className="flex justify-center py-[6px]">
        <span className="font-mohave text-body-sm text-text-secondary group-hover:text-text-primary transition-colors">
          {count}
        </span>
      </div>

      {/* Proportional fill bar */}
      <div className="flex-1 relative mx-[8px] mb-[4px] rounded-[2px] bg-[rgba(255,255,255,0.03)] overflow-hidden">
        <div
          className="absolute bottom-0 left-0 right-0 rounded-[2px] transition-all duration-500"
          style={{
            height: `${fillPercent}%`,
            backgroundColor: stageColor,
            opacity: 0.2,
          }}
        />
        {/* Top edge glow on the fill */}
        {fillPercent > 0 && (
          <div
            className="absolute left-0 right-0 h-px transition-all duration-500"
            style={{
              bottom: `${fillPercent}%`,
              backgroundColor: stageColor,
              opacity: 0.4,
            }}
          />
        )}
      </div>

      {/* Vertical stage name */}
      <div className="flex justify-center pb-[10px] overflow-hidden">
        <span
          className="font-kosugi text-[8px] text-text-disabled group-hover:text-text-tertiary uppercase tracking-[0.15em] whitespace-nowrap transition-colors"
          style={{ writingMode: "vertical-lr" }}
        >
          {stageName}
        </span>
      </div>
    </div>
  );
}
