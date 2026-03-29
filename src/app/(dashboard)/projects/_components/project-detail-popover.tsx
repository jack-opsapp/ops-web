"use client";

import { useCallback, useRef, useState } from "react";
import { X, Minus, Maximize2 } from "lucide-react";
import type { Project } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import {
  useProjectDetailPopoverStore,
  type ProjectPopoverTab,
  type ProjectDetailPopoverState,
  POPOVER_MIN_WIDTH,
  POPOVER_MIN_HEIGHT,
} from "./project-detail-popover-store";
import { getProjectStatusDisplayName } from "./project-stage-stack";

// ── Tab definitions ──
const TABS: { id: ProjectPopoverTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "financial", label: "Financial" },
  { id: "photos", label: "Photos" },
];

// ── Single popover instance ──

interface ProjectDetailPopoverInstanceProps {
  state: ProjectDetailPopoverState;
  project: Project | undefined;
  clientName: string;
}

function ProjectDetailPopoverInstance({
  state,
  project,
  clientName,
}: ProjectDetailPopoverInstanceProps) {
  const {
    closePopover,
    focusPopover,
    minimizePopover,
    restorePopover,
    updatePosition,
    setActiveTab,
  } = useProjectDetailPopoverStore();

  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      focusPopover(state.id);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        posX: state.position.x,
        posY: state.position.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [focusPopover, state.id, state.position]
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      updatePosition(state.id, {
        x: Math.max(0, dragRef.current.posX + dx),
        y: Math.max(0, dragRef.current.posY + dy),
      });
    },
    [updatePosition, state.id]
  );

  const handleDragEnd = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    []
  );

  if (state.isMinimized) return null;

  const statusColor = state.statusColor;

  return (
    <div
      className="fixed rounded-[6px] overflow-hidden flex flex-col"
      style={{
        left: state.position.x,
        top: state.position.y,
        width: state.size.width,
        height: state.size.height,
        zIndex: state.zIndex,
        background: "rgba(14,14,14,0.95)",
        backdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)",
      }}
      onPointerDown={() => focusPopover(state.id)}
    >
      {/* Header — draggable */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: `linear-gradient(90deg, ${statusColor}10 0%, transparent 60%)`,
        }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: statusColor }}
          />
          <span className="font-mohave text-body-sm font-medium text-text-primary truncate">
            {state.title}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => minimizePopover(state.id)}
            className="p-1 rounded-[2px] text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => closePopover(state.id)}
            className="p-1 rounded-[2px] text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-0 px-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(state.id, tab.id)}
            className="relative px-3 py-2 font-kosugi text-micro-sm uppercase tracking-wider transition-colors duration-150"
            style={{
              color: state.activeTab === tab.id ? statusColor : "#666",
            }}
          >
            {tab.label}
            {state.activeTab === tab.id && (
              <div
                className="absolute bottom-0 left-3 right-3 h-[1px]"
                style={{ background: statusColor }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-4">
        {state.activeTab === "overview" && project && (
          <ProjectOverviewTab project={project} clientName={clientName} statusColor={statusColor} />
        )}
        {state.activeTab === "tasks" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">Tasks tab — coming soon</span>
          </div>
        )}
        {state.activeTab === "financial" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">Financial tab — coming soon</span>
          </div>
        )}
        {state.activeTab === "photos" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">Photos tab — coming soon</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Overview tab ──

function ProjectOverviewTab({
  project,
  clientName,
  statusColor,
}: {
  project: Project;
  clientName: string;
  statusColor: string;
}) {
  const startDate = project.startDate
    ? new Date(project.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
  const endDate = project.endDate
    ? new Date(project.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Status */}
      <div>
        <span className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-widest">Status</span>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="font-mohave text-body-sm text-text-primary">
            {getProjectStatusDisplayName(project.status)}
          </span>
        </div>
      </div>

      {/* Client */}
      {clientName && (
        <div>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-widest">Client</span>
          <p className="font-mohave text-body-sm text-text-primary mt-1">{clientName}</p>
        </div>
      )}

      {/* Address */}
      {project.address && (
        <div>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-widest">Address</span>
          <p className="font-mohave text-body-sm text-text-primary mt-1">{project.address}</p>
        </div>
      )}

      {/* Dates */}
      {(startDate || endDate) && (
        <div>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-widest">Dates</span>
          <p className="font-mohave text-body-sm text-text-primary mt-1">
            {startDate && endDate ? `${startDate} → ${endDate}` : startDate ?? endDate}
          </p>
        </div>
      )}

      {/* Description */}
      {project.projectDescription && (
        <div>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-widest">Description</span>
          <p className="font-mohave text-body-sm text-text-secondary mt-1 leading-relaxed">
            {project.projectDescription}
          </p>
        </div>
      )}

      {/* Notes */}
      {project.notes && (
        <div>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-widest">Notes</span>
          <p className="font-mohave text-body-sm text-text-secondary mt-1 leading-relaxed">
            {project.notes}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Root renderer — maps over all open popovers ──

interface ProjectDetailPopoverProps {
  projects: Map<string, Project>;
  clientNames: Map<string, string>;
}

export function ProjectDetailPopover({
  projects,
  clientNames,
}: ProjectDetailPopoverProps) {
  const popovers = useProjectDetailPopoverStore((s) => s.popovers);

  return (
    <>
      {Array.from(popovers.values()).map((state) => (
        <ProjectDetailPopoverInstance
          key={state.id}
          state={state}
          project={projects.get(state.id)}
          clientName={clientNames.get(projects.get(state.id)?.clientId ?? "") ?? ""}
        />
      ))}
    </>
  );
}
