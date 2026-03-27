"use client";

import { memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import type { Opportunity } from "@/lib/types/pipeline";
import { formatCurrency } from "@/lib/types/pipeline";
import { CARD_WIDTH, CARD_HEIGHT, CARD_PILL_HEIGHT } from "./spatial-canvas-store";

// ── Types ──

export interface SpatialCardProps {
  opportunity: Opportunity;
  clientName: string;
  stageColor: string;
  stalenessOpacity: number;
  isSelected: boolean;
  isExpanded: boolean;
  isHovered: boolean;
  isBirdEye: boolean;
  canManage: boolean;
  draggable?: boolean;
  onToggleExpand: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  // Mutation callbacks (passed through to expanded state)
  onAdvance: () => void;
  onRetreat: () => void;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onOpenDetail: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
}

// ── Component ──

export const SpatialCard = memo(function SpatialCard({
  opportunity,
  clientName,
  stageColor,
  stalenessOpacity,
  isSelected,
  isExpanded,
  isHovered,
  isBirdEye,
  canManage,
  draggable = true,
  onToggleExpand,
  onHover,
  onHoverEnd,
  onSelect,
  onContextMenu,
  onAdvance,
  onRetreat,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
}: SpatialCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: opportunity.id,
    data: { opportunity },
    disabled: !draggable,
  });

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey || e.metaKey) {
        onSelect(e);
      } else {
        onToggleExpand();
      }
    },
    [onSelect, onToggleExpand]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e);
    },
    [onContextMenu]
  );

  // ── Bird's eye rendering (zoom < 0.5) ──
  if (isBirdEye) {
    return (
      <div
        ref={setNodeRef}
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        className="absolute cursor-pointer"
        style={{
          width: CARD_WIDTH,
          height: CARD_PILL_HEIGHT,
          background: stageColor,
          opacity: isDragging ? 0.2 : stalenessOpacity,
          borderRadius: 4,
          boxShadow: isSelected
            ? `0 0 12px ${stageColor}40`
            : undefined,
          border: isSelected
            ? `2px solid ${stageColor}`
            : "1px solid transparent",
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={onHover}
        onMouseLeave={onHoverEnd}
      />
    );
  }

  // ── Normal rendering ──
  const effectiveOpacity = isHovered || isDragging ? 1.0 : stalenessOpacity;

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={cn(
        "absolute cursor-pointer select-none",
        isDragging && "opacity-20"
      )}
      style={{
        width: CARD_WIDTH,
        minHeight: CARD_HEIGHT,
        opacity: isDragging ? 0.2 : effectiveOpacity,
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
    >
      {/* Card surface */}
      <div
        className={cn(
          "w-full rounded-[4px] backdrop-blur-xl",
          "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "rgba(13,13,13,0.6)",
          borderLeft: `3px solid ${stageColor}`,
          border: isSelected
            ? `2px solid ${stageColor}`
            : isHovered
              ? "1px solid rgba(255,255,255,0.15)"
              : "1px solid rgba(255,255,255,0.08)",
          borderLeftWidth: 3,
          borderLeftColor: stageColor,
          boxShadow: isSelected
            ? `0 0 12px ${stageColor}40`
            : undefined,
          padding: "8px 10px",
        }}
      >
        {/* Collapsed content — name + value */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mohave text-sm font-medium text-white truncate">
            {clientName}
          </span>
          <span className="font-mohave text-sm text-[#999] whitespace-nowrap">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "$--"}
          </span>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
            {/* Contact info */}
            {opportunity.contactName && (
              <p className="font-mohave text-sm text-[#999] truncate">
                {opportunity.contactName}
              </p>
            )}

            {/* Correspondence stats */}
            {opportunity.correspondenceCount > 0 && (
              <p className="font-kosugi text-[10px] text-[#666] mt-1">
                {opportunity.correspondenceCount} email{opportunity.correspondenceCount !== 1 ? "s" : ""}
                {" · "}
                {opportunity.inboundCount} in / {opportunity.outboundCount} out
              </p>
            )}

            {/* Actions bar */}
            <div className="mt-2">
              <SpatialCardActionsInline
                opportunity={opportunity}
                canManage={canManage}
                onLogCall={onLogCall}
                onLogText={onLogText}
                onAddNote={onAddNote}
                onArchive={onArchive}
                onDiscard={onDiscard}
                onMarkWon={onMarkWon}
                onMarkLost={onMarkLost}
                onAssign={onAssign}
                onScheduleFollowUp={onScheduleFollowUp}
                onOpenDetail={onOpenDetail}
              />
            </div>

            {/* Details link */}
            <button
              className="font-mohave text-sm text-[#597794] hover:text-white cursor-pointer mt-2"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
            >
              View details →
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Inline actions (simplified for spatial card) ──
function SpatialCardActionsInline({
  opportunity,
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
  onOpenDetail,
}: {
  opportunity: Opportunity;
  canManage: boolean;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  onOpenDetail: () => void;
}) {
  // Import and render the existing PipelineCardActions component
  // This is done lazily to avoid circular dependencies
  const PipelineCardActions = require("./pipeline-card-actions").PipelineCardActions;

  return (
    <PipelineCardActions
      opportunityId={opportunity.id}
      stage={opportunity.stage}
      canManage={canManage}
      onLogCall={onLogCall}
      onLogText={onLogText}
      onAddNote={onAddNote}
      onArchive={onArchive}
      onMarkWon={onMarkWon}
      onMarkLost={onMarkLost}
      onDiscard={onDiscard}
      onAssign={onAssign}
      onScheduleFollowUp={onScheduleFollowUp}
      onOpenDetail={onOpenDetail}
    />
  );
}
