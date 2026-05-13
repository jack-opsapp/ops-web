"use client";

import { memo, type CSSProperties } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import { usePipelineModeStore } from "./pipeline-mode-store";

type SpineDistanceFromFocus = 1 | 2 | 3;

export interface PipelineSpineColumnProps {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  distanceFromFocus: SpineDistanceFromFocus;
  isHovered: boolean;
  tabId: string;
  panelId: string;
  isFocusedTab?: false;
  onFocusStage?: (stage: OpportunityStage) => void;
}

const MAX_SILHOUETTES = 30;
const DRAG_HOVER_OPACITY = 0.8;
const VISUAL_OPACITY_BY_DISTANCE: Record<SpineDistanceFromFocus, number> = {
  1: 0.6,
  2: 0.35,
  3: 0.25,
};

const NUMBER_STYLE: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

const transitionClasses =
  "transition-[border-color,opacity] duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

function formatTemplate(
  template: string,
  values: Record<string, string | number>
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export const PipelineSpineColumn = memo(function PipelineSpineColumn({
  stage,
  opportunities,
  distanceFromFocus,
  isHovered,
  tabId,
  panelId,
  onFocusStage,
}: PipelineSpineColumnProps) {
  const { t } = useDictionary("pipeline");
  const stageName = getStageDisplayName(stage);
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];
  const count = opportunities.length;
  const visualOpacity = isHovered
    ? DRAG_HOVER_OPACITY
    : VISUAL_OPACITY_BY_DISTANCE[distanceFromFocus];
  const visibleOpportunities = opportunities.slice(0, MAX_SILHOUETTES);
  const hasOverflow = count > MAX_SILHOUETTES;
  const ariaLabel = formatTemplate(
    t("focused.spineLabel", "{stage}, {count} opportunities"),
    { stage: stageName, count }
  );

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={false}
      aria-controls={panelId}
      aria-label={ariaLabel}
      tabIndex={-1}
      className={cn(
        "relative flex h-full min-h-0 w-[64px] shrink-0 overflow-hidden rounded-sidebar border border-line bg-transparent px-0 py-1 text-left",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
        transitionClasses
      )}
      style={{
        borderColor: isHovered ? stageColor : undefined,
      }}
      onClick={() => {
        if (onFocusStage) {
          onFocusStage(stage);
          return;
        }

        usePipelineModeStore.getState().setFocusedStage(stage);
      }}
    >
      <div
        aria-hidden="true"
        className={cn("absolute inset-0 bg-surface-input", transitionClasses)}
        style={{ opacity: visualOpacity }}
      />
      <div
        aria-hidden="true"
        className={cn("absolute left-0 top-0 h-full w-[2px]", transitionClasses)}
        style={{ backgroundColor: stageColor, opacity: visualOpacity }}
      />

      <div className="relative z-[1] flex h-full min-h-0 w-full flex-col items-center gap-1 px-0.5 py-1">
        <div className="relative h-[104px] w-full shrink-0">
          <span className="absolute left-1/2 top-1/2 block origin-center -translate-x-1/2 -translate-y-1/2 rotate-90 whitespace-nowrap font-cakemono text-caption-sm font-light uppercase text-text-2">
            {stageName}
          </span>
        </div>

        <span className="shrink-0 font-mono text-data-sm text-text" style={NUMBER_STYLE}>
          {count}
        </span>

        <div className="flex min-h-0 w-full flex-1 flex-col gap-[2px] overflow-hidden px-0.5 pt-1">
          {visibleOpportunities.map((opportunity) => (
            <div
              key={opportunity.id}
              aria-hidden="true"
              data-testid="pipeline-spine-silhouette"
              className={cn("h-1.5 w-full shrink-0 rounded-bar", transitionClasses)}
              style={{ backgroundColor: stageColor, opacity: visualOpacity }}
            />
          ))}

          {hasOverflow && (
            <div
              aria-hidden="true"
              data-testid="pipeline-spine-overflow"
              className={cn(
                "relative flex h-3 min-h-3 w-full shrink-0 items-center justify-center overflow-hidden rounded-bar font-mono text-[11px] leading-none text-text",
                transitionClasses
              )}
              style={NUMBER_STYLE}
            >
              <span
                aria-hidden="true"
                className={cn("absolute inset-0", transitionClasses)}
                style={{ backgroundColor: stageColor, opacity: visualOpacity }}
              />
              <span className="relative z-[1]">30+</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
});
