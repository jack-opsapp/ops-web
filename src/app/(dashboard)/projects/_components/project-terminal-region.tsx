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
  isBirdEye: boolean;
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
  isBirdEye,
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
        minHeight: layout.bounds.height,
        ...(isBirdEye ? {} : {
          background: `${statusColor}${bgAlpha}`,
          borderRadius: 4,
          border: `1px solid ${statusColor}${borderAlpha}`,
          transition: "background 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        }),
      }}
      onMouseEnter={() => setIsRegionHovered(true)}
      onMouseLeave={() => setIsRegionHovered(false)}
    >
      {/* Region glow — hidden in bird's eye */}
      {!isBirdEye && (
        <div
          className="absolute inset-0 pointer-events-none rounded-[4px]"
          style={{
            boxShadow: `inset 0 0 60px ${statusColor}${glowOpacity}`,
            transition: "box-shadow 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      )}

      {/* Header — hidden in bird's eye */}
      {!isBirdEye && <div
        className="relative flex flex-col"
        style={{
          marginLeft: 20,
          marginTop: 12,
          width: layout.cols * (CARD_WIDTH + STACK_GAP) - STACK_GAP,
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
              "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-micro uppercase tracking-widest"
            style={{
              color: isRegionHovered ? statusColor : "#666",
              transition: "color 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {getProjectStatusDisplayName(status)}
          </span>
          <span className="font-mono text-body-sm text-text tabular-nums">
            {projects.length}
          </span>
          {canViewAccounting && (
            <>
              <span className="font-mohave text-body-sm text-text-mute">
                /
              </span>
              <span className="font-mono text-body-sm text-text tabular-nums">
                {totalValue > 0 ? formatCompactCurrency(totalValue) : "—"}
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
            <span className="font-mono text-micro text-text-mute">
              avg{" "}
              {Math.round(
                projects.reduce((sum, p) => sum + getDaysInStatus(p), 0) /
                  projects.length
              )}
              d
            </span>
            <span className="font-mono text-micro text-text-mute">
              oldest: {Math.max(...projects.map((p) => getDaysInStatus(p)))}d
            </span>
          </div>
        )}
      </div>}

      {/* Cards in grid layout — uses CSS grid for proper multi-column flow */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${layout.cols}, ${CARD_WIDTH}px)`,
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

      {/* Empty state — hidden in bird's eye */}
      {projects.length === 0 && !isBirdEye && (
        <div
          className="flex items-center justify-center border border-dashed border-[rgba(255,255,255,0.06)] rounded-[4px]"
          style={{
            marginLeft: 20,
            marginRight: 20,
            marginTop: 8,
            height: CARD_HEIGHT,
          }}
        >
          <span className="font-mono text-micro text-text-mute uppercase">
            {t("empty.noProjects")}
          </span>
        </div>
      )}
    </div>
  );
}
