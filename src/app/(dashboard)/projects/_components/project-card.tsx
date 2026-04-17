"use client";

import { memo, useCallback } from "react";
import { useReducedMotion } from "framer-motion";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import type { Project } from "@/lib/types/models";
import { CARD_WIDTH, CARD_HEIGHT, CARD_PILL_HEIGHT } from "./project-canvas-store";

// ── Helpers ──

/** Extract street number + name from a full address */
function formatStreetAddress(address: string | null): string | null {
  if (!address) return null;
  const firstPart = address.split(",")[0].trim();
  return firstPart || null;
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

// ── Types ──

export interface ProjectCardProps {
  project: Project;
  clientName: string;
  statusColor: string;
  stalenessOpacity: number;
  isSelected: boolean;
  isExpanded: boolean;
  isHovered: boolean;
  isBirdEye: boolean;
  canManage: boolean;
  canViewAccounting: boolean;
  projectValue: number;
  completedTasks: number;
  totalTasks: number;
  draggable?: boolean;
  onToggleExpand: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  expandedContent?: React.ReactNode;
}

// ── Component ──

export const ProjectCard = memo(function ProjectCard({
  project,
  clientName,
  statusColor,
  stalenessOpacity,
  isSelected,
  isExpanded,
  isHovered,
  isBirdEye,
  canManage,
  canViewAccounting,
  projectValue,
  completedTasks,
  totalTasks,
  draggable = true,
  onToggleExpand,
  onHover,
  onHoverEnd,
  onSelect,
  onContextMenu,
  expandedContent,
}: ProjectCardProps) {
  const reduced = useReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: project.id,
    data: { project },
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

  const primaryLabel =
    project.title || formatStreetAddress(project.address) || "Untitled Project";

  const progressFraction = totalTasks > 0 ? completedTasks / totalTasks : 0;

  // ── Bird's eye rendering (zoom < 0.5) ──
  if (isBirdEye) {
    return (
      <div
        ref={setNodeRef}
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        data-spatial-card
        className="relative cursor-pointer"
        style={{
          width: CARD_WIDTH,
          height: CARD_PILL_HEIGHT,
          background: statusColor,
          opacity: isDragging ? 0.2 : stalenessOpacity,
          borderRadius: 4,
          boxShadow: isSelected ? `0 0 12px ${statusColor}40` : undefined,
          border: isSelected ? `2px solid ${statusColor}` : "1px solid transparent",
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
  const cardEdgeBorder = isSelected
    ? `2px solid ${statusColor}`
    : isHovered || isExpanded
      ? `1px solid ${statusColor}50`
      : "1px solid rgba(255,255,255,0.08)";

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      data-spatial-card
      role="button"
      tabIndex={0}
      aria-label={`${primaryLabel}, ${clientName}`}
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
      <div
        className={cn(
          "w-full rounded-[4px]",
          !reduced && "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "rgba(13,13,13,0.6)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          borderTop: cardEdgeBorder,
          borderRight: cardEdgeBorder,
          borderBottom: cardEdgeBorder,
          borderLeft: `3px solid ${statusColor}`,
          boxShadow: isSelected ? `0 0 12px ${statusColor}40` : undefined,
          padding: "8px 10px 6px 10px",
        }}
      >
        {/* Line 1: Primary label + value */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mohave text-body-sm font-medium text-text truncate">
            {primaryLabel}
          </span>
          {canViewAccounting && projectValue > 0 && (
            <span className="font-mohave text-body-sm text-text-2 whitespace-nowrap">
              {formatCompactCurrency(projectValue)}
            </span>
          )}
        </div>

        {/* Line 2: Client name */}
        {clientName && (
          <div className="font-mohave text-[11px] text-text-3 mt-[2px] truncate">
            {clientName}
          </div>
        )}

        {/* Progress bar */}
        <div
          className="mt-[6px] rounded-[1px] overflow-hidden"
          style={{ height: 2, background: "rgba(255,255,255,0.06)" }}
        >
          <div
            style={{
              width: `${progressFraction * 100}%`,
              height: "100%",
              background: statusColor,
              borderRadius: 1,
              transition: "width 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </div>

        {/* Expanded content */}
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
      </div>
    </div>
  );
});
