"use client";

import { memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import { usePipelineModeStore } from "./pipeline-mode-store";
import {
  PipelineCardContent,
  type PipelineCardActionHandlers,
} from "./pipeline-card-content";

interface PipelineFocusedCardProps
  extends Omit<PipelineCardActionHandlers, "onOpenDetail"> {
  opportunity: Opportunity;
  clientName: string;
  stageColor: string;
  stalenessOpacity: number;
  canManage: boolean;
}

export const PipelineFocusedCard = memo(function PipelineFocusedCard({
  opportunity,
  clientName,
  stageColor,
  stalenessOpacity,
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
}: PipelineFocusedCardProps) {
  const { t } = useDictionary("pipeline");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: opportunity.id,
    data: { opportunity, mode: "focused" },
    disabled: !canManage,
  });

  const openDetailPanel = useCallback(() => {
    usePipelineModeStore.getState().openDetailPanel(opportunity.id);
  }, [opportunity.id]);

  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;
  const openDetailLabel = `${t("focused.openDetail.label")}: ${opportunity.title || clientName}`;

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "group/focused-card relative w-full select-none",
        isDragging && "opacity-60"
      )}
      style={dragStyle}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={t("focused.dragHandle.label")}
        className={cn(
          "absolute left-2 top-1/2 z-[2] flex h-8 w-8 -translate-x-2 -translate-y-1/2 items-center justify-center rounded-[5px] border border-line bg-[var(--surface-glass-dense)] text-text-3 opacity-0 backdrop-blur-[20px] backdrop-saturate-[1.2]",
          "transition-[opacity,transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "hover:border-line-hi hover:bg-surface-hover hover:text-text",
          "focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
          "group-hover/focused-card:translate-x-0 group-hover/focused-card:opacity-100 group-focus-within/focused-card:translate-x-0 group-focus-within/focused-card:opacity-100",
          "motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-0",
          isDragging && "translate-x-0 opacity-100"
        )}
        disabled={!canManage}
        onClick={(event) => event.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.5} />
      </button>

      <div className="min-w-0">
        <PipelineCardContent
          opportunity={opportunity}
          clientName={clientName}
          stageColor={stageColor}
          stalenessOpacity={stalenessOpacity}
          density="comfortable"
          canManage={canManage}
          isHovered={isDragging}
          openDetailLabel={openDetailLabel}
          onLogCall={onLogCall}
          onLogText={onLogText}
          onAddNote={onAddNote}
          onArchive={onArchive}
          onDiscard={onDiscard}
          onMarkWon={onMarkWon}
          onMarkLost={onMarkLost}
          onAssign={onAssign}
          onScheduleFollowUp={onScheduleFollowUp}
          onOpenDetail={openDetailPanel}
        />
      </div>
    </article>
  );
});
