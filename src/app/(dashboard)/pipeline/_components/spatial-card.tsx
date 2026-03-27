"use client";

import { memo, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  expandedContent,
}: SpatialCardProps) {
  const reduced = useReducedMotion();
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
      role="button"
      tabIndex={0}
      aria-label={`${clientName}, ${opportunity.estimatedValue ? formatCurrency(opportunity.estimatedValue) : "no value"}`}
      aria-expanded={isExpanded}
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
      <div
        className={cn(
          "w-full rounded-[4px]",
          !reduced && "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "rgba(13,13,13,0.6)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          border: isSelected
            ? `2px solid ${stageColor}`
            : isHovered
              ? "1px solid rgba(255,255,255,0.15)"
              : "1px solid rgba(255,255,255,0.08)",
          borderLeft: `3px solid ${stageColor}`,
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

        {/* Expanded content — rendered inside card surface */}
        <AnimatePresence initial={false}>
          {isExpanded && expandedContent && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {expandedContent}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
