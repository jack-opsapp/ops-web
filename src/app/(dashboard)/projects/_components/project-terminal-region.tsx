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

interface ProjectTerminalRegionProps {
  status: ProjectStatus;
  projects: Project[];
  layout: TerminalRegionLayout;
  isBirdEye: boolean;
  activeId: string | null;
  renderCard: (
    project: Project,
    position: { x: number; y: number },
    draggable?: boolean,
    flow?: boolean
  ) => React.ReactNode;
}

export function ProjectTerminalRegion({
  status,
  projects,
  layout,
  isBirdEye,
  activeId,
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

  const isForeignDragOver = isOver && activeId != null && !projectMap.has(activeId);
  const glowOpacity = isOver ? "28" : isRegionHovered ? "14" : "08";

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
        background: `${statusColor}06`,
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
        className="relative flex items-baseline gap-2"
        style={{
          marginLeft: 20,
          marginTop: 12,
          padding: "8px 0 0 0",
          height: STACK_HEADER_HEIGHT,
        }}
      >
        <span
          className="font-kosugi text-micro-sm uppercase tracking-widest"
          style={{ color: statusColor }}
        >
          {getProjectStatusDisplayName(status)}
        </span>
        <span className="font-mohave text-body-sm text-text-primary">
          {projects.length}
        </span>
      </div>

      {/* Cards in grid layout */}
      <div
        className="relative"
        style={{
          marginLeft: 20,
          marginTop: 8,
          paddingBottom: 20,
        }}
      >
        {layout.cardPositions.map((pos) => {
          const project = projectMap.get(pos.projectId);
          if (!project) return null;
          return (
            <div
              key={project.id}
              style={{
                position: "absolute",
                left: pos.x - layout.position.x,
                top: pos.y - layout.position.y - STACK_HEADER_HEIGHT,
              }}
            >
              {renderCard(project, pos, false, false)}
            </div>
          );
        })}
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
        </div>
      )}
    </div>
  );
}
