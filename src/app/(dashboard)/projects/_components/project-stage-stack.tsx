"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { StackLayout } from "./project-layout-engine";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  STACK_GAP,
  STACK_HEADER_HEIGHT,
} from "./project-canvas-store";

// ── Status display name map ──
const STATUS_DISPLAY_NAMES: Record<ProjectStatus, string> = {
  [ProjectStatus.RFQ]: "RFQ",
  [ProjectStatus.Estimated]: "Estimated",
  [ProjectStatus.Accepted]: "Accepted",
  [ProjectStatus.InProgress]: "In Progress",
  [ProjectStatus.Completed]: "Completed",
  [ProjectStatus.Closed]: "Closed",
  [ProjectStatus.Archived]: "Archived",
};

export function getProjectStatusDisplayName(status: ProjectStatus): string {
  return STATUS_DISPLAY_NAMES[status] ?? status;
}

// ── Types ──

interface ProjectStageStackProps {
  status: ProjectStatus;
  projects: Project[];
  layout: StackLayout;
  isBirdEye: boolean;
  activeId: string | null;
  projectValues: Map<string, number>;
  canViewAccounting: boolean;
  renderCard: (
    project: Project,
    position: { x: number; y: number },
    draggable?: boolean,
    flow?: boolean
  ) => React.ReactNode;
}

// ── Component ──

export function ProjectStageStack({
  status,
  projects,
  layout,
  isBirdEye,
  activeId,
  projectValues,
  canViewAccounting,
  renderCard,
}: ProjectStageStackProps) {
  const { t } = useDictionary("projects-canvas");
  const statusColor = PROJECT_STATUS_COLORS[status];
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [isRegionHovered, setIsRegionHovered] = useState(false);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const { setNodeRef, isOver } = useDroppable({
    id: `status-${status}`,
    data: { status },
  });

  const totalValue = useMemo(
    () =>
      projects.reduce(
        (sum, p) => sum + (projectValues.get(p.id) ?? 0),
        0
      ),
    [projects, projectValues]
  );

  const glowOpacity = isOver ? "20" : isRegionHovered ? "15" : "08";
  const isForeignDragOver = isOver && activeId != null && !projectMap.has(activeId);

  // Days in status helper
  const daysInStatusAvg = useMemo(() => {
    if (projects.length === 0) return 0;
    const total = projects.reduce((sum, p) => {
      const ref = p.createdAt ?? p.startDate;
      if (!ref) return sum;
      return sum + Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round(total / projects.length);
  }, [projects]);

  const oldestDays = useMemo(() => {
    if (projects.length === 0) return 0;
    return Math.max(...projects.map((p) => {
      const ref = p.createdAt ?? p.startDate;
      if (!ref) return 0;
      return Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
    }));
  }, [projects]);

  function formatCompactCurrency(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
    return `$${value.toFixed(0)}`;
  }

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      role="region"
      aria-label={`${getProjectStatusDisplayName(status)} - ${projects.length} projects`}
      style={{
        left: layout.regionBounds.x,
        top: layout.regionBounds.y,
        width: layout.regionBounds.width,
        minHeight: layout.regionBounds.height,
        background: "rgba(255, 255, 255, 0.015)",
        border: "1px solid rgba(255, 255, 255, 0.04)",
        borderRadius: 8,
      }}
      onMouseEnter={() => setIsRegionHovered(true)}
      onMouseLeave={() => setIsRegionHovered(false)}
    >
      {/* Region glow */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[4px]"
        style={{
          boxShadow: `inset 0 0 60px ${statusColor}${glowOpacity}`,
          transition: "box-shadow 0.3s ease-out",
        }}
      />

      {/* Header */}
      <div
        className="relative flex flex-col"
        style={{
          marginLeft: 20,
          marginTop: 12,
          width: CARD_WIDTH,
          height: STACK_HEADER_HEIGHT,
          padding: "8px 0 0 0",
        }}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
      >
        {/* Bottom border animation */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 1,
            background: isHeaderHovered ? statusColor : `${statusColor}30`,
            width: "100%",
            opacity: isHeaderHovered ? 1 : 0.5,
            transformOrigin: "left",
            transform: isHeaderHovered ? "scaleX(1)" : "scaleX(0.3)",
            transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease-out, background 0.3s ease-out",
          }}
        />
        <div className="flex items-baseline gap-2">
          <span
            className="font-kosugi text-micro-sm uppercase tracking-widest"
            style={{
              color: isHeaderHovered ? statusColor : "#666",
              transition: "color 0.25s ease-out",
            }}
          >
            {getProjectStatusDisplayName(status)}
          </span>
          <span className="font-mohave text-body-sm text-text-primary">
            {projects.length}
          </span>
          {canViewAccounting && (
            <>
              <span className="font-mohave text-body-sm text-text-disabled">/</span>
              <span className="font-mohave text-body-sm text-text-primary">
                {totalValue > 0 ? formatCompactCurrency(totalValue) : "$--"}
              </span>
            </>
          )}
        </div>
        {isHeaderHovered && projects.length > 0 && (
          <div
            className="flex items-baseline gap-2 mt-1 opacity-0 animate-fade-in"
            style={{ animationDuration: "150ms", animationFillMode: "forwards" }}
          >
            <span className="font-kosugi text-micro-sm text-text-disabled">
              avg {daysInStatusAvg}d
            </span>
            <span className="font-kosugi text-micro-sm text-text-disabled">
              oldest: {oldestDays}d
            </span>
          </div>
        )}
      </div>

      {/* Cards */}
      <div
        className="relative flex flex-col"
        style={{
          marginLeft: 20,
          marginTop: 8,
          paddingBottom: 20,
          width: CARD_WIDTH,
          gap: STACK_GAP,
        }}
      >
        {layout.cardPositions.map((pos) => {
          const project = projectMap.get(pos.projectId);
          if (!project) return null;
          return renderCard(project, { x: 0, y: 0 }, true, true);
        })}

        {isForeignDragOver && (
          <div
            className="pointer-events-none"
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              border: `1px dashed ${statusColor}30`,
              borderRadius: 4,
              transition: "opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        )}
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <div
          className="absolute flex flex-col items-center justify-center text-center border border-dashed border-[rgba(255,255,255,0.1)] rounded-[4px]"
          style={{
            left: 12,
            top: 20 + STACK_HEADER_HEIGHT,
            right: 12,
            bottom: 12,
          }}
        >
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("empty.noProjects")}
          </span>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase mt-1">
            {t("empty.dropHere")}
          </span>
        </div>
      )}
    </div>
  );
}
