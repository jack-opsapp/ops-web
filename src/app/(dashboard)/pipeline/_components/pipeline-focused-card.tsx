"use client";

import { memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
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
    listeners,
    setNodeRef,
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
        "relative w-full select-none",
        canManage && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-60"
      )}
      style={dragStyle}
      {...listeners}
    >
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
