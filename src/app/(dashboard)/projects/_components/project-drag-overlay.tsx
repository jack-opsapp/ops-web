"use client";

import { DragOverlay } from "@dnd-kit/core";
import type { Project } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { CARD_WIDTH } from "./project-canvas-store";
import { DRAG_GRABBED_SHADOW } from "@/lib/utils/motion";

interface ProjectDragOverlayProps {
  activeProject: Project | null;
  clientName: string;
  batchCount: number;
}

function formatStreetAddress(address: string | null): string | null {
  if (!address) return null;
  const firstPart = address.split(",")[0].trim();
  return firstPart || null;
}

export function ProjectDragOverlay({
  activeProject,
  clientName,
  batchCount,
}: ProjectDragOverlayProps) {
  if (!activeProject) return null;

  const statusColor =
    PROJECT_STATUS_COLORS[activeProject.status] ?? "#BCBCBC";
  const primaryLabel =
    activeProject.title || formatStreetAddress(activeProject.address) || "Untitled Project";

  return (
    <DragOverlay dropAnimation={null}>
      <div
        className="relative"
        style={{ width: CARD_WIDTH }}
      >
        <div
          className="w-full rounded-[4px] backdrop-blur-xl"
          style={{
            background: "rgba(13,13,13,0.8)",
            border: "1px solid rgba(255,255,255,0.20)",
            borderLeft: `3px solid ${statusColor}`,
            boxShadow: DRAG_GRABBED_SHADOW,
            transform: "scale(1.03)",
            padding: "8px 10px",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mohave text-body-sm font-medium text-text-primary truncate">
              {primaryLabel}
            </span>
          </div>
          {clientName && (
            <div className="font-mohave text-[11px] text-text-tertiary mt-[2px] truncate">
              {clientName}
            </div>
          )}
        </div>

        {batchCount > 1 && (
          <div
            className="absolute -top-2 -right-2 flex items-center justify-center"
            style={{
              background: "rgba(10,10,10,0.8)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              padding: "2px 8px",
            }}
          >
            <span className="font-kosugi text-micro-sm text-text-primary">
              +{batchCount - 1}
            </span>
          </div>
        )}
      </div>
    </DragOverlay>
  );
}
