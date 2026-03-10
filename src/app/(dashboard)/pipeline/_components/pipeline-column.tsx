"use client";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useDroppable } from "@dnd-kit/core";
import { Plus, Target } from "lucide-react";
import {
  type Opportunity,
  type OpportunityStage,
  getStageDisplayName,
  getStageColor,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import { PipelineCard } from "./pipeline-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineColumnProps {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  clientMap: Map<string, Client>;
  onSelectOpportunity: (opportunity: Opportunity) => void;
  onAdvanceStage?: (opportunity: Opportunity) => void;
  onAddLead?: () => void;
  narrow?: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

// ---------------------------------------------------------------------------
// Collapsed Column — narrow strip with vertical stage name
// ---------------------------------------------------------------------------
function CollapsedColumn({
  stage,
  count,
  isOver,
}: {
  stage: OpportunityStage;
  count: number;
  isOver: boolean;
}) {
  const stageColor = getStageColor(stage);
  const stageName = getStageDisplayName(stage);

  return (
    <div
      className={cn(
        "flex flex-col items-center h-full rounded-sm border transition-colors duration-150 cursor-pointer",
        isOver
          ? "bg-ops-accent-muted border-ops-accent"
          : "bg-[rgba(10,10,10,0.5)] border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.18)]"
      )}
    >
      {/* Stage color bar */}
      <div
        className="w-full h-[2px] shrink-0 rounded-t-sm"
        style={{ backgroundColor: stageColor }}
      />

      {/* Vertical stage name */}
      <div className="flex-1 flex items-center justify-center py-2 overflow-hidden">
        <span
          className="font-mohave text-caption-sm uppercase tracking-[0.08em] whitespace-nowrap"
          style={{
            color: stageColor,
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          {stageName}
        </span>
      </div>

      {/* Count badge */}
      {count > 0 && (
        <div className="shrink-0 pb-1.5">
          <span className="font-mono text-[10px] text-text-disabled bg-background-elevated px-[5px] py-[2px] rounded-sm">
            {count}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Column
// ---------------------------------------------------------------------------
export function PipelineColumn({
  stage,
  opportunities,
  clientMap,
  onSelectOpportunity,
  onAdvanceStage,
  onAddLead,
  narrow = false,
  isExpanded,
  onToggleExpand,
}: PipelineColumnProps) {
  const { t } = useDictionary("pipeline");
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  const stageColor = getStageColor(stage);
  const stageName = getStageDisplayName(stage);
  const columnValue = opportunities.reduce(
    (sum, o) => sum + (o.estimatedValue ?? 0),
    0
  );

  /** Resolve display name for an opportunity */
  const resolveClientName = (opp: Opportunity): string => {
    if (opp.clientId) {
      return clientMap.get(opp.clientId)?.name ?? opp.contactName ?? t("card.unknown");
    }
    return opp.contactName ?? t("newLead");
  };

  // Collapsed column — still droppable for drag-and-drop
  if (!isExpanded) {
    return (
      <div
        ref={setNodeRef}
        onClick={onToggleExpand}
        className="flex flex-col shrink-0 w-[44px] min-h-[200px]"
        title={`${stageName} (${opportunities.length})`}
      >
        <CollapsedColumn
          stage={stage}
          count={opportunities.length}
          isOver={isOver}
        />
      </div>
    );
  }

  // Expanded column
  return (
    <div
      className={cn(
        "flex flex-col shrink-0",
        narrow ? "w-[200px]" : "w-[280px]"
      )}
    >
      {/* Column header — click to collapse */}
      <div
        className="border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0 cursor-pointer"
        style={{ borderTopColor: stageColor }}
        onClick={onToggleExpand}
        title={`Collapse ${stageName}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3
              className="font-mohave text-body font-medium uppercase tracking-wider"
              style={{ color: stageColor }}
            >
              {stageName}
            </h3>
            <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
              {opportunities.length}
            </span>
          </div>
          {onAddLead && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddLead();
              }}
              className="p-[4px] rounded text-text-disabled hover:text-text-tertiary hover:bg-background-elevated transition-colors cursor-pointer"
              title={t("column.addNewLead")}
            >
              <Plus className="w-[14px] h-[14px]" />
            </button>
          )}
        </div>

        {/* Column value */}
        {columnValue > 0 && (
          <div className="mt-[2px]">
            <span className="font-mono text-[10px] text-text-disabled">
              {formatCurrency(columnValue)}
            </span>
          </div>
        )}
      </div>

      {/* Droppable cards area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] transition-colors duration-150",
          isOver
            ? "bg-ops-accent-muted border-ops-accent"
            : "bg-[rgba(10,10,10,0.5)]"
        )}
      >
        {opportunities.map((opp) => (
          <PipelineCard
            key={opp.id}
            opportunity={opp}
            clientName={resolveClientName(opp)}
            onSelect={() => onSelectOpportunity(opp)}
            onAdvanceStage={
              onAdvanceStage ? () => onAdvanceStage(opp) : undefined
            }
          />
        ))}

        {opportunities.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[120px] border border-dashed border-border-subtle rounded gap-1">
            <div className="w-[32px] h-[32px] rounded-full bg-background-elevated flex items-center justify-center">
              <Target className="w-[14px] h-[14px] text-text-disabled" />
            </div>
            <span className="font-kosugi text-[11px] text-text-disabled">
              {t("column.noDeals")}
            </span>
            <span className="font-kosugi text-[9px] text-text-disabled">
              {t("column.dropHere")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
