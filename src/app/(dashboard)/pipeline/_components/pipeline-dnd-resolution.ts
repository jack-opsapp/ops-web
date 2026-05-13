"use client";

import type { OpportunityStage } from "@/lib/types/pipeline";
import type { PipelineMode } from "./pipeline-mode-types";

export type PipelineDropData = {
  mode?: PipelineMode;
  stage?: OpportunityStage;
  isTerminal?: boolean;
};

export type PipelineDragEndResolution =
  | { type: "cancel" }
  | {
      type: "focused-stage";
      opportunityId: string;
      stage: OpportunityStage;
      isTerminal: boolean;
    }
  | {
      type: "spatial-stage";
      opportunityIds: string[];
      stage: OpportunityStage;
      isTerminal: boolean;
    };

type ResolvePipelineDragEndInput = {
  mode: PipelineMode;
  draggedId: string;
  selectedCardIds: ReadonlySet<string>;
  dropData?: PipelineDropData | null;
};

export function resolvePipelineDragEnd({
  mode,
  draggedId,
  selectedCardIds,
  dropData,
}: ResolvePipelineDragEndInput): PipelineDragEndResolution {
  if (mode === "focused") {
    if (dropData?.mode !== "focused" || !dropData.stage) {
      return { type: "cancel" };
    }

    return {
      type: "focused-stage",
      opportunityId: draggedId,
      stage: dropData.stage,
      isTerminal: Boolean(dropData.isTerminal),
    };
  }

  if (!dropData?.stage) {
    return { type: "cancel" };
  }

  return {
    type: "spatial-stage",
    opportunityIds: selectedCardIds.has(draggedId)
      ? Array.from(selectedCardIds)
      : [draggedId],
    stage: dropData.stage,
    isTerminal: Boolean(dropData.isTerminal),
  };
}
