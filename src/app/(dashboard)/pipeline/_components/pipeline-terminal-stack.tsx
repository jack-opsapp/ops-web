"use client";

import { memo, type CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";

interface PipelineTerminalStackProps {
  wonOpportunities: Opportunity[];
  lostOpportunities: Opportunity[];
  focusedStage: OpportunityStage;
  isLoading?: boolean;
  panelId: string;
  registerTab?: (stage: OpportunityStage) => (node: HTMLElement | null) => void;
  onSelectStage: (stage: OpportunityStage.Won | OpportunityStage.Lost) => void;
}

const MAX_SILHOUETTES = 18;
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

export const PipelineTerminalStack = memo(function PipelineTerminalStack({
  wonOpportunities,
  lostOpportunities,
  focusedStage,
  isLoading = false,
  panelId,
  registerTab,
  onSelectStage,
}: PipelineTerminalStackProps) {
  const { t } = useDictionary("pipeline");
  const items = [
    { stage: OpportunityStage.Won, opportunities: wonOpportunities },
    { stage: OpportunityStage.Lost, opportunities: lostOpportunities },
  ] as const;

  return (
    <div
      role="presentation"
      className="flex h-full min-h-0 w-[72px] shrink-0 flex-col gap-2"
      aria-label={t("focused.terminalStack.label", "Terminal stages")}
    >
      {items.map(({ stage, opportunities }) => (
        <TerminalItem
          key={stage}
          stage={stage}
          opportunities={opportunities}
          isSelected={focusedStage === stage}
          isLoading={isLoading}
          tabId={`pipeline-terminal-tab-${stage}`}
          panelId={panelId}
          tabRef={registerTab?.(stage)}
          onSelectStage={onSelectStage}
          itemLabelTemplate={t(
            "focused.terminalStack.itemLabel",
            "{stage}, {count} opportunities"
          )}
        />
      ))}
    </div>
  );
});

function TerminalItem({
  stage,
  opportunities,
  isSelected,
  isLoading,
  tabId,
  panelId,
  tabRef,
  onSelectStage,
  itemLabelTemplate,
}: {
  stage: OpportunityStage.Won | OpportunityStage.Lost;
  opportunities: Opportunity[];
  isSelected: boolean;
  isLoading: boolean;
  tabId: string;
  panelId: string;
  tabRef?: (node: HTMLElement | null) => void;
  onSelectStage: (stage: OpportunityStage.Won | OpportunityStage.Lost) => void;
  itemLabelTemplate: string;
}) {
  const stageName = getStageDisplayName(stage);
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];
  const { setNodeRef, isOver } = useDroppable({
    id: `focused-terminal-${stage}`,
    data: { stage, isTerminal: true, mode: "focused" },
    disabled: false,
  });
  const count = opportunities.length;
  const renderedCount = isLoading ? "—" : String(count);
  const { t } = useDictionary("pipeline");
  const visibleOpportunities = opportunities.slice(0, MAX_SILHOUETTES);
  const ariaLabel = formatTemplate(itemLabelTemplate, {
    stage: stageName,
    count: isLoading ? t("focused.loading.count", "loading") : count,
  });
  const visualOpacity = isSelected || isOver ? 0.8 : 0.45;

  return (
    <button
      ref={(node) => {
        setNodeRef(node);
        tabRef?.(node);
      }}
      type="button"
      data-pipeline-stage-fallback={stage}
      role="tab"
      id={tabId}
      aria-label={ariaLabel}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={isSelected ? 0 : -1}
      className={cn(
        "relative flex min-h-0 flex-1 overflow-hidden rounded-sidebar border border-line bg-transparent px-1 py-2 text-left",
        transitionClasses,
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
        isSelected && "bg-surface-active"
      )}
      style={{ borderColor: isSelected || isOver ? stageColor : undefined }}
      onClick={() => onSelectStage(stage)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-0 h-full w-[2px]",
          transitionClasses
        )}
        style={{ backgroundColor: stageColor, opacity: visualOpacity }}
      />

      <div className="relative z-[1] flex h-full min-h-0 w-full flex-col items-center gap-1">
        <span className="font-cakemono text-caption-sm font-light uppercase text-text-2">
          {stageName}
        </span>
        <span className="font-mono text-data-sm text-text" style={NUMBER_STYLE}>
          {renderedCount}
        </span>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-[2px] overflow-hidden pt-1">
          {visibleOpportunities.map((opportunity) => (
            <span
              key={opportunity.id}
              aria-hidden="true"
              data-pipeline-spine-card-id={opportunity.id}
              className={cn(
                "h-1.5 w-full shrink-0 rounded-bar",
                transitionClasses
              )}
              style={{ backgroundColor: stageColor, opacity: visualOpacity }}
            />
          ))}
          {count > MAX_SILHOUETTES && (
            <span
              aria-hidden="true"
              className="font-mono text-micro text-text"
              style={NUMBER_STYLE}
            >
              {MAX_SILHOUETTES}+
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
