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
        "relative flex w-full select-none items-stretch gap-1",
        isDragging && "opacity-60"
      )}
      style={dragStyle}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={t("focused.dragHandle.label")}
        className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-panel border border-line bg-surface-input text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent disabled:pointer-events-none disabled:opacity-40"
        disabled={!canManage}
        onClick={(event) => event.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.5} />
      </button>

      <div className="min-w-0 flex-1">
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
