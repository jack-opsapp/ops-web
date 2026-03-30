"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { TerminalRegionLayout } from "./project-layout-engine";
import { getProjectStatusDisplayName } from "./project-stage-stack";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  STACK_GAP,
  STACK_HEADER_HEIGHT,
} from "./project-canvas-store";

// ── Types ──

interface ProjectTerminalRegionProps {
  status: ProjectStatus;
  projects: Project[];
  layout: TerminalRegionLayout;
  projectValues: Map<string, number>;
  canViewAccounting: boolean;
  renderCard: (
    project: Project,
    position: { x: number; y: number }
  ) => React.ReactNode;
}

// ── Helpers ──

function getDaysInStatus(project: Project): number {
  const ref = project.createdAt ?? project.startDate;
  if (!ref) return 0;
  return Math.floor(
    (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

// ── Component ──

export function ProjectTerminalRegion({
  status,
  projects,
  layout,
  projectValues,
  canViewAccounting,
  renderCard,
}: ProjectTerminalRegionProps) {
  const { t } = useDictionary("projects-canvas");
  const statusColor = PROJECT_STATUS_COLORS[status];
  const [isRegionHovered, setIsRegionHovered] = useState(false);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const { setNodeRef, isOver } = useDroppable({
    id: `status-${status}`,
    data: { status, isTerminal: true },
  });

  const totalValue = useMemo(
    () =>
      projects.reduce(
        (sum, p) => sum + (projectValues.get(p.id) ?? 0),
        0
      ),
    [projects, projectValues]
  );

  // Hex alpha tiers: drag-over > mouse-hover > idle
  const bgAlpha = isOver ? "14" : isRegionHovered ? "0C" : "06";
  const borderAlpha = isOver ? "30" : isRegionHovered ? "20" : "10";
  const glowOpacity = isOver ? "28" : isRegionHovered ? "18" : "08";

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      role="region"
      aria-label={`${getProjectStatusDisplayName(status)} - ${projects.length} projects`}
      style={{
        left: layout.bounds.x,
        top: layout.bounds.y,
        width: layout.bounds.width,
        height: layout.bounds.height,
        background: `${statusColor}${bgAlpha}`,
        borderRadius: 4,
        border: `1px solid ${statusColor}${borderAlpha}`,
        transition: "background 0.2s ease-out, border-color 0.2s ease-out",
      }}
      onMouseEnter={() => setIsRegionHovered(true)}
      onMouseLeave={() => setIsRegionHovered(false)}
    >
      {/* Region glow background */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[4px]"
        style={{
          boxShadow: `inset 0 0 60px ${statusColor}${glowOpacity}`,
          transition: "box-shadow 0.2s ease-out",
        }}
      />

      {/* Header */}
      <div
        className="relative flex flex-col"
        style={{
          marginLeft: 20,
          marginTop: 12,
          width: layout.bounds.width - 40,
          height: STACK_HEADER_HEIGHT,
          padding: "8px 0 0 0",
        }}
      >
        {/* Bottom border — animates left-to-right on hover */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 1,
            background: isRegionHovered ? statusColor : `${statusColor}30`,
            width: "100%",
            opacity: isRegionHovered ? 1 : 0.5,
            transformOrigin: "left",
            transform: isRegionHovered ? "scaleX(1)" : "scaleX(0.3)",
            transition:
              "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease-out, background 0.3s ease-out",
          }}
        />
        <div className="flex items-baseline gap-2">
          <span
            className="font-kosugi text-micro-sm uppercase tracking-widest"
            style={{
              color: isRegionHovered ? statusColor : "#666",
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
              <span className="font-mohave text-body-sm text-text-disabled">
                /
              </span>
              <span className="font-mohave text-body-sm text-text-primary">
                {totalValue > 0 ? formatCompactCurrency(totalValue) : "$--"}
              </span>
            </>
          )}
        </div>
        {isRegionHovered && projects.length > 0 && (
          <div
            className="flex items-baseline gap-2 mt-1 opacity-0 animate-fade-in"
            style={{
              animationDuration: "150ms",
              animationFillMode: "forwards",
            }}
          >
            <span className="font-kosugi text-micro-sm text-text-disabled">
              avg{" "}
              {Math.round(
                projects.reduce((sum, p) => sum + getDaysInStatus(p), 0) /
                  projects.length
              )}
              d
            </span>
            <span className="font-kosugi text-micro-sm text-text-disabled">
              oldest: {Math.max(...projects.map((p) => getDaysInStatus(p)))}d
            </span>
          </div>
        )}
      </div>

      {/* Cards in grid layout — uses CSS grid for proper multi-column flow */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, ${CARD_WIDTH}px)`,
          gap: STACK_GAP,
          marginLeft: 20,
          marginTop: 8,
          paddingBottom: 20,
        }}
      >
        {layout.cardPositions.map((pos) => {
          const project = projectMap.get(pos.projectId);
          if (!project) return null;
          return (
            <div key={project.id}>
              {renderCard(project, { x: 0, y: 0 })}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <div
          className="flex items-center justify-center border border-dashed border-[rgba(255,255,255,0.06)] rounded-[4px]"
          style={{
            marginLeft: 20,
            marginRight: 20,
            marginTop: 8,
            height: CARD_HEIGHT,
          }}
        >
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("empty.noProjects")}
          </span>
        </div>
      )}
    </div>
  );
}
