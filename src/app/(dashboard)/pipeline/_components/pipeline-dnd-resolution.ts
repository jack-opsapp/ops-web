"use client";

import type { OpportunityStage } from "@/lib/types/pipeline";
import type { PipelineMode } from "./pipeline-mode-types";

export type PipelineFocusedDropIntent =
  | "stage-target"
  | "archive-target"
  | "discard-target";

export type PipelineDropData = {
  mode?: PipelineMode;
  stage?: OpportunityStage;
  isTerminal?: boolean;
  focusedDropIntent?: PipelineFocusedDropIntent;
};

export type PipelineDragEndResolution =
  | { type: "cancel" }
  | {
      type: "focused-action";
      opportunityId: string;
      action: "archive" | "discard";
    }
  | {
      type: "focused-stage";
      opportunityId: string;
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
  dropData,
}: ResolvePipelineDragEndInput): PipelineDragEndResolution {
  if (mode !== "focused") {
    return { type: "cancel" };
  }

  if (
    dropData?.mode === "focused" &&
    dropData.focusedDropIntent === "archive-target"
  ) {
    return {
      type: "focused-action",
      opportunityId: draggedId,
      action: "archive",
    };
  }

  if (
    dropData?.mode === "focused" &&
    dropData.focusedDropIntent === "discard-target"
  ) {
    return {
      type: "focused-action",
      opportunityId: draggedId,
      action: "discard",
    };
  }

  if (
    dropData?.mode !== "focused" ||
    dropData.focusedDropIntent !== "stage-target" ||
    !dropData.stage
  ) {
    return { type: "cancel" };
  }

  return {
    type: "focused-stage",
    opportunityId: draggedId,
    stage: dropData.stage,
    isTerminal: Boolean(dropData.isTerminal),
  };
}
