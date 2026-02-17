"use client";

import { cn } from "@/lib/utils/cn";
import { useDraggable } from "@dnd-kit/core";
import { Clock, ChevronRight, GripVertical, AlertCircle } from "lucide-react";
import {
  type Opportunity,
  OpportunityStage,
  getDaysInStage,
  isOpportunityStale,
  isTerminalStage,
  formatCurrency,
} from "@/lib/types/pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineCardProps {
  opportunity: Opportunity;
  clientName: string;
  isDragOverlay?: boolean;
  onSelect: () => void;
  onAdvanceStage?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a follow-up date is today */
function isToday(date: Date | null): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

/** Check if a follow-up date is overdue */
function isOverdue(date: Date | null): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  // Strip time for date-only comparison
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dateOnly < todayOnly;
}

// ---------------------------------------------------------------------------
// Pipeline Card
// ---------------------------------------------------------------------------
export function PipelineCard({
  opportunity,
  clientName,
  isDragOverlay = false,
  onSelect,
  onAdvanceStage,
}: PipelineCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: opportunity.id,
      data: { opportunity },
    });

  const daysInStage = getDaysInStage(opportunity);
  const stale = isOpportunityStale(opportunity);
  const terminal = isTerminalStage(opportunity.stage);
  const followUpToday = isToday(opportunity.nextFollowUpAt);
  const followUpOverdue = isOverdue(opportunity.nextFollowUpAt);

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      style={style}
      className={cn(
        "bg-[rgba(13,13,13,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded-[5px] p-1.5",
        "transition-all duration-150 group",
        // Stale indicator: red left border
        stale && !terminal && "border-l-2 border-l-ops-error",
        // Drag overlay styling
        isDragOverlay &&
          "shadow-elevated border-ops-accent scale-[1.02] rotate-[1deg] z-50",
        // Normal hover
        !isDragOverlay && !isDragging && "hover:border-[rgba(255,255,255,0.3)]",
        // When being dragged, show placeholder
        isDragging && "opacity-20"
      )}
    >
      {/* Row 1: Client name + value */}
      <div className="flex items-start justify-between gap-[6px]">
        {/* Drag handle + client name */}
        <div className="flex items-center gap-[4px] min-w-0 flex-1">
          {!isDragOverlay && !terminal && (
            <div
              {...attributes}
              {...listeners}
              className={cn(
                "shrink-0 cursor-grab active:cursor-grabbing",
                "opacity-0 group-hover:opacity-100 transition-opacity"
              )}
              title="Drag to move"
            >
              <GripVertical className="w-[12px] h-[12px] text-text-disabled" />
            </div>
          )}
          <button
            onClick={onSelect}
            className="min-w-0 flex-1 text-left cursor-pointer"
          >
            <h4 className="font-mohave text-body-sm text-text-primary truncate uppercase">
              {clientName}
            </h4>
          </button>
        </div>

        {/* Value */}
        <span className="shrink-0 font-mono text-[11px] text-ops-accent">
          {opportunity.estimatedValue
            ? formatCurrency(opportunity.estimatedValue)
            : "--"}
        </span>
      </div>

      {/* Row 2: Deal title */}
      <button onClick={onSelect} className="w-full text-left cursor-pointer">
        <p className="font-kosugi text-[10px] text-text-tertiary truncate">
          {opportunity.title}
        </p>
      </button>

      {/* Row 3: Metadata */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2">
          {/* Days in stage */}
          {daysInStage > 0 && (
            <div
              className="flex items-center gap-[2px]"
              title={`${daysInStage} days in stage`}
            >
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[9px] text-text-disabled">
                {daysInStage}d
              </span>
            </div>
          )}

          {/* Follow-up indicator */}
          {followUpOverdue && (
            <div
              className="flex items-center gap-[2px]"
              title="Follow-up overdue"
            >
              <AlertCircle className="w-[10px] h-[10px] text-ops-error" />
              <span className="font-mono text-[9px] text-ops-error">
                Overdue
              </span>
            </div>
          )}
          {followUpToday && !followUpOverdue && (
            <div
              className="flex items-center gap-[2px]"
              title="Follow-up due today"
            >
              <AlertCircle className="w-[10px] h-[10px] text-ops-amber" />
              <span className="font-mono text-[9px] text-ops-amber">Today</span>
            </div>
          )}
        </div>

        {/* Quick advance button */}
        {!terminal && onAdvanceStage && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAdvanceStage();
            }}
            className={cn(
              "p-[3px] rounded",
              "text-text-disabled hover:text-ops-accent hover:bg-ops-accent/10",
              "opacity-0 group-hover:opacity-100 transition-all",
              "cursor-pointer"
            )}
            title="Advance to next stage"
          >
            <ChevronRight className="w-[12px] h-[12px]" />
          </button>
        )}
      </div>
    </div>
  );
}
