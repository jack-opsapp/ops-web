"use client";

import { memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import type { Opportunity } from "@/lib/types/pipeline";
import { formatCurrency } from "@/lib/types/pipeline";
import { CARD_WIDTH, CARD_HEIGHT, CARD_PILL_HEIGHT } from "./spatial-canvas-store";
import { PipelineCardContent } from "./pipeline-card-content";

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
  expandedContent?: React.ReactNode;
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
  onAdvance: _onAdvance,
  onRetreat: _onRetreat,
  onLogCall: _onLogCall,
  onLogText: _onLogText,
  onAddNote: _onAddNote,
  onArchive: _onArchive,
  onDiscard: _onDiscard,
  onMarkWon: _onMarkWon,
  onMarkLost: _onMarkLost,
  onOpenDetail: _onOpenDetail,
  onAssign: _onAssign,
  onScheduleFollowUp: _onScheduleFollowUp,
  expandedContent,
}: SpatialCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: opportunity.id,
    data: { opportunity },
    disabled: !draggable || !canManage,
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
        data-opportunity-card-id={opportunity.id}
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        className="relative cursor-pointer"
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
  const effectiveOpacity = isHovered || isDragging || isExpanded ? 1.0 : stalenessOpacity;

  return (
    <div
      ref={setNodeRef}
      data-opportunity-card-id={opportunity.id}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      role="button"
      tabIndex={0}
      aria-label={`${clientName}, ${opportunity.estimatedValue ? formatCurrency(opportunity.estimatedValue) : "$--"}`}
      aria-expanded={isExpanded}
      className={cn(
        "relative cursor-pointer select-none",
        isDragging && "opacity-20"
      )}
      style={{
        width: CARD_WIDTH,
        minHeight: CARD_HEIGHT,
        opacity: isDragging ? 0.2 : effectiveOpacity,
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleExpand();
        }
      }}
      onContextMenu={handleContextMenu}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onFocus={onHover}
      onBlur={onHoverEnd}
    >
      {/* Card surface */}
      <PipelineCardContent
        opportunity={opportunity}
        clientName={clientName}
        stageColor={stageColor}
        stalenessOpacity={stalenessOpacity}
        density="compact"
        isSelected={isSelected}
        isHovered={isHovered}
        isExpanded={isExpanded}
      >
        {/* Expanded content — CSS grid height transition (no FM measurement issues) */}
        {expandedContent && (
          <div
            style={{
              display: "grid",
              gridTemplateRows: isExpanded ? "1fr" : "0fr",
              opacity: isExpanded ? 1 : 0,
              transition: "grid-template-rows 0.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <div style={{ overflow: "hidden" }}>
              {expandedContent}
            </div>
          </div>
        )}
      </PipelineCardContent>
    </div>
  );
});
