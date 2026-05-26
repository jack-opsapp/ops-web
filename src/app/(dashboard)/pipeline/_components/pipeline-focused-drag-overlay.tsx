"use client";

import { DragOverlay } from "@dnd-kit/core";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import { PipelineCardContent } from "./pipeline-card-content";

interface PipelineFocusedDragOverlayProps {
  activeOpportunity: Opportunity | null;
  clientName: string;
  stalenessOpacity: number;
}

export function PipelineFocusedDragOverlay({
  activeOpportunity,
  clientName,
  stalenessOpacity,
}: PipelineFocusedDragOverlayProps) {
  if (!activeOpportunity) return null;

  const stageColor =
    OPPORTUNITY_STAGE_COLORS[activeOpportunity.stage] ??
    OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];

  return (
    <DragOverlay dropAnimation={null}>
      <div className="pointer-events-none w-[min(460px,calc(100vw-32px))]">
        <PipelineCardContent
          opportunity={activeOpportunity}
          clientName={clientName}
          stageColor={stageColor}
          stalenessOpacity={stalenessOpacity}
          density="comfortable"
          surfaceVariant="focused"
          canManage={false}
          isHovered
        />
      </div>
    </DragOverlay>
  );
}
