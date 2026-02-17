"use client";

import { cn } from "@/lib/utils/cn";
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
}: PipelineColumnProps) {
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
      return clientMap.get(opp.clientId)?.name ?? opp.contactName ?? "Unknown";
    }
    return opp.contactName ?? "New Lead";
  };

  return (
    <div
      className={cn(
        "flex flex-col shrink-0",
        narrow ? "w-[200px]" : "w-[280px]"
      )}
    >
      {/* Column header */}
      <div
        className="border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0"
        style={{ borderTopColor: stageColor }}
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
              onClick={onAddLead}
              className="p-[4px] rounded text-text-disabled hover:text-text-tertiary hover:bg-background-elevated transition-colors cursor-pointer"
              title="Add new lead"
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
              No deals in this stage
            </span>
            <span className="font-kosugi text-[9px] text-text-disabled">
              Drop here to move
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
