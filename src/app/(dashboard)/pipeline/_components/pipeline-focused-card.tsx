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
      data-pipeline-transition-card
      data-opportunity-id={opportunity.id}
      className={cn(
        "relative w-full select-none",
        isDragging && "z-[1]"
      )}
      style={dragStyle}
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
          leadingAccessory={
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={t(
                "focused.dragHandle.label",
                "Drag card to another stage"
              )}
              disabled={!canManage}
              className="group flex min-h-11 w-11 shrink-0 cursor-grab touch-none appearance-none items-center justify-center rounded-sm bg-transparent text-line transition-colors duration-150 hover:text-text-3 focus-visible:text-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent active:cursor-grabbing disabled:cursor-not-allowed disabled:text-line"
              {...(canManage ? attributes : {})}
              {...(canManage ? listeners : {})}
            >
              <span
                aria-hidden="true"
                className="grid grid-cols-2 gap-x-1.5 gap-y-1.5 text-current"
              >
                {Array.from({ length: 12 }).map((_, index) => (
                  <span
                    key={index}
                    className="h-0.5 w-0.5 rounded-full bg-current transition-colors duration-150"
                  />
                ))}
              </span>
            </button>
          }
        />
      </div>
    </article>
  );
});
