"use client";

import {
  OpportunityStage,
  type OpportunityStage as OpportunityStageType,
} from "@/lib/types/pipeline";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";
import type { PipelineMode } from "./pipeline-mode-types";

export type PipelineFocusedDropIntent =
  | "stage-target"
  | "archive-target"
  | "discard-target";

export type PipelineDropData = {
  mode?: PipelineMode;
  stage?: OpportunityStageType;
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
      stage: OpportunityStageType;
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

/**
 * Final client-side permission gate for a resolved focused drop. Droppable
 * disabling prevents an unauthorized Won target from advertising itself, but
 * authority can still change during a drag; this check keeps the mutation and
 * its live-region success announcement atomic with the latest row access.
 */
export function isPipelineDropAuthorized(
  drop: PipelineDragEndResolution,
  access: Pick<LeadAccess, "canEdit" | "canConvert"> | undefined
): boolean {
  if (drop.type === "cancel" || !access?.canEdit) return false;
  if (drop.type !== "focused-stage") return true;
  return drop.stage !== OpportunityStage.Won || access.canConvert;
}
