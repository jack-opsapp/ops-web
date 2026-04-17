"use client";

import { useCallback, useRef, useState, memo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Minus,
  X,
  MoreHorizontal,
  Archive,
  Trash2,
  ListPlus,
  DollarSign,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import type { Project } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import {
  useProjectDetailPopoverStore,
  type ProjectPopoverTab,
  type ProjectDetailPopoverState,
} from "./project-detail-popover-store";
import { getProjectStatusDisplayName } from "./project-stage-stack";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Tab definitions ──
const TABS: { id: ProjectPopoverTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "financial", label: "Financial" },
  { id: "photos", label: "Photos" },
];

// ── Helpers ──
function getDaysInStatus(project: Project): number {
  // Projects don't have a statusUpdatedAt field — use createdAt as proxy
  const ref = project.createdAt ? new Date(project.createdAt) : new Date();
  const now = new Date();
  const diffMs = now.getTime() - ref.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

// ── Props ──

interface ProjectDetailPopoverInstanceProps {
  state: ProjectDetailPopoverState;
  project: Project | undefined;
  clientName: string;
  canManage: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  canDelete: boolean;
  onAddTask: (projectId: string) => void;
  onRecordPayment: (projectId: string) => void;
  onArchive: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

const ProjectDetailPopoverInstance = memo(function ProjectDetailPopoverInstance({
  state,
  project,
  clientName,
  canManage,
  canCreateTasks,
  canRecordPayment,
  canDelete,
  onAddTask,
  onRecordPayment,
  onArchive,
  onDelete,
}: ProjectDetailPopoverInstanceProps) {
  const { t } = useDictionary("projects");
  const reduced = useReducedMotion();

  const {
    closePopover,
    focusPopover,
    minimizePopover,
    updatePosition,
    updateSize,
    setActiveTab,
  } = useProjectDetailPopoverStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  const statusColor = state.statusColor;
  const statusName = project
    ? getProjectStatusDisplayName(project.status)
    : state.title;
  const daysInStatus = project ? getDaysInStatus(project) : 0;

  // ── Drag handling (title bar) — document addEventListener pattern ──
  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focusPopover(state.id);
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - state.position.x,
        y: e.clientY - state.position.y,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newX = Math.max(
          0,
          Math.min(
            moveEvent.clientX - dragOffset.current.x,
            globalThis.innerWidth - state.size.width
          )
        );
        const newY = Math.max(
          0,
          Math.min(
            moveEvent.clientY - dragOffset.current.y,
            globalThis.innerHeight - state.size.height
          )
        );
        updatePosition(state.id, { x: newX, y: newY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [
      state.id,
      state.position,
      state.size.width,
      state.size.height,
      focusPopover,
      updatePosition,
    ]
  );

  // ── Resize handling (bottom-right corner) ──
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusPopover(state.id);
      setIsResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: state.size.width,
        h: state.size.height,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const dw = moveEvent.clientX - resizeStart.current.x;
        const dh = moveEvent.clientY - resizeStart.current.y;
        updateSize(state.id, {
          width: resizeStart.current.w + dw,
          height: resizeStart.current.h + dh,
        });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [state.id, state.size, focusPopover, updateSize]
  );

  // ── Close overflow menu on outside click ──
  const handleOverflowToggle = useCallback(() => {
    setShowOverflowMenu((prev) => {
      if (!prev) {
        const handleOutsideClick = (e: globalThis.MouseEvent) => {
          if (
            overflowMenuRef.current &&
            !overflowMenuRef.current.contains(e.target as Node)
          ) {
            setShowOverflowMenu(false);
            document.removeEventListener("mousedown", handleOutsideClick);
          }
        };
        requestAnimationFrame(() => {
          document.addEventListener("mousedown", handleOutsideClick);
        });
      }
      return !prev;
    });
  }, []);

  if (state.isMinimized) return null;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className={cn(
        "fixed flex flex-col overflow-hidden",
        "bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2]",
        "border border-[rgba(255,255,255,0.08)] rounded-[4px]",
        (isDragging || isResizing) && "select-none"
      )}
      style={{
        left: state.position.x,
        top: state.position.y,
        width: state.size.width,
        height: state.size.height,
        zIndex: state.zIndex,
      }}
      onMouseDown={() => focusPopover(state.id)}
    >
      {/* ── Title bar ── */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)] cursor-grab shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="w-1.5 h-1.5 rounded-[1px] shrink-0"
            style={{
              backgroundColor:
                PROJECT_STATUS_COLORS[
                  project?.status ?? ("" as keyof typeof PROJECT_STATUS_COLORS)
                ] ?? statusColor,
            }}
          />
          <span className="font-mohave text-[13px] font-semibold text-text truncate">
            {state.title}
          </span>
        </div>
        <div className="flex items-center gap-[2px] shrink-0 ml-2">
          <button
            onClick={() => minimizePopover(state.id)}
            className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => closePopover(state.id)}
            className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-ops-error hover:bg-ops-error-muted transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Info strip ── */}
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0 space-y-1">
        {/* Row 1: Client address */}
        <div className="flex items-center gap-2 min-w-0">
          {project?.address ? (
            <div className="flex items-center gap-1 text-text-3 min-w-0">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="font-kosugi text-micro truncate">
                {project.address}
              </span>
            </div>
          ) : (
            <span className="font-kosugi text-micro text-text-mute">
              {t("detail.noAddress")}
            </span>
          )}
        </div>

        {/* Row 2: status + days + overflow */}
        <div className="flex items-center gap-1.5" ref={overflowMenuRef}>
          <span
            className="font-kosugi text-micro uppercase tracking-wide"
            style={{ color: statusColor }}
          >
            {statusName}
          </span>
          <span className="font-kosugi text-micro text-text-mute">
            · {daysInStatus}d
          </span>
          {canManage && (
            <div className="relative ml-auto">
              <button
                onClick={handleOverflowToggle}
                className="w-4 h-4 rounded-[2px] flex items-center justify-center text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
              >
                <MoreHorizontal className="w-3 h-3" />
              </button>

              {showOverflowMenu && (
                <div className="absolute top-full right-0 mt-1 z-50 min-w-[150px] bg-[var(--surface-glass-dense)] backdrop-blur-xl border border-[rgba(255,255,255,0.10)] rounded-[4px] p-1">
                  {canCreateTasks && (
                    <button
                      onClick={() => {
                        setShowOverflowMenu(false);
                        onAddTask(state.id);
                      }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-2 hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                    >
                      <ListPlus className="w-3 h-3 shrink-0" />
                      {t("taskList.addTask")}
                    </button>
                  )}
                  {canRecordPayment && (
                    <button
                      onClick={() => {
                        setShowOverflowMenu(false);
                        onRecordPayment(state.id);
                      }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-2 hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                    >
                      <DollarSign className="w-3 h-3 shrink-0" />
                      Record Payment
                    </button>
                  )}
                  {(canCreateTasks || canRecordPayment) && (
                    <div className="border-t border-[rgba(255,255,255,0.06)] my-0.5" />
                  )}
                  <button
                    onClick={() => {
                      setShowOverflowMenu(false);
                      onArchive(state.id);
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-2 hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                  >
                    <Archive className="w-3 h-3 shrink-0" />
                    Archive
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => {
                        setShowOverflowMenu(false);
                        setShowDeleteConfirm(true);
                      }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-ops-error/80 hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                    >
                      <Trash2 className="w-3 h-3 shrink-0" />
                      {t("detail.deleteProject")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)] shrink-0">
          <p className="font-kosugi text-[11px] text-text-2 mb-2">
            Permanently delete this project? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 px-2 py-1.5 font-mohave text-[11px] uppercase tracking-[0.5px] text-text-2 rounded-[2px] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setShowDeleteConfirm(false);
                onDelete(state.id);
              }}
              className="flex-1 px-2 py-1.5 font-mohave text-[11px] uppercase tracking-[0.5px] text-ops-error rounded-[2px] border border-ops-error/20 bg-ops-error/10 hover:bg-ops-error/15 transition-colors"
            >
              {t("detail.deleteProject")}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="flex items-center border-b border-[rgba(255,255,255,0.06)] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(state.id, tab.id)}
            className={cn(
              "px-3 py-2 font-mohave text-[11px] uppercase tracking-[0.5px] transition-colors relative",
              tab.id === state.activeTab
                ? "text-text"
                : "text-text-mute hover:text-text-2"
            )}
          >
            {tab.label}
            {tab.id === state.activeTab && (
              <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-2" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-3">
        {state.activeTab === "overview" && project && (
          <ProjectOverviewTab
            project={project}
            clientName={clientName}
            statusColor={statusColor}
          />
        )}
        {state.activeTab === "tasks" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro text-text-mute uppercase">
              Tasks tab — coming soon
            </span>
          </div>
        )}
        {state.activeTab === "financial" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro text-text-mute uppercase">
              Financial tab — coming soon
            </span>
          </div>
        )}
        {state.activeTab === "photos" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro text-text-mute uppercase">
              Photos tab — coming soon
            </span>
          </div>
        )}
      </div>

      {/* ── Resize handle (bottom-right) ── */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          className="opacity-15 hover:opacity-30 transition-opacity absolute bottom-[2px] right-[2px]"
        >
          <line x1="12" y1="4" x2="4" y2="12" stroke="white" strokeWidth="1" />
          <line x1="12" y1="8" x2="8" y2="12" stroke="white" strokeWidth="1" />
        </svg>
      </div>
    </motion.div>
  );
});

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
    ? new Date(project.startDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const endDate = project.endDate
    ? new Date(project.endDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Status */}
      <div>
        <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
          Status
        </span>
        <div className="flex items-center gap-2 mt-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="font-mohave text-body-sm text-text">
            {getProjectStatusDisplayName(project.status)}
          </span>
        </div>
      </div>

      {/* Client */}
      {clientName && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Client
          </span>
          <p className="font-mohave text-body-sm text-text mt-1">
            {clientName}
          </p>
        </div>
      )}

      {/* Address */}
      {project.address && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Address
          </span>
          <p className="font-mohave text-body-sm text-text mt-1">
            {project.address}
          </p>
        </div>
      )}

      {/* Dates */}
      {(startDate || endDate) && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Dates
          </span>
          <p className="font-mohave text-body-sm text-text mt-1">
            {startDate && endDate
              ? `${startDate} → ${endDate}`
              : (startDate ?? endDate)}
          </p>
        </div>
      )}

      {/* Description */}
      {project.projectDescription && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Description
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {project.projectDescription}
          </p>
        </div>
      )}

      {/* Notes */}
      {project.notes && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Notes
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {project.notes}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Root renderer — maps over all open popovers, wraps in AnimatePresence ──

interface ProjectDetailPopoverProps {
  projects: Map<string, Project>;
  clientNames: Map<string, string>;
  canManage?: boolean;
  canCreateTasks?: boolean;
  canRecordPayment?: boolean;
  canDelete?: boolean;
  onAddTask?: (projectId: string) => void;
  onRecordPayment?: (projectId: string) => void;
  onArchive?: (projectId: string) => void;
  onDelete?: (projectId: string) => void;
}

export function ProjectDetailPopover({
  projects,
  clientNames,
  canManage = false,
  canCreateTasks = false,
  canRecordPayment = false,
  canDelete = false,
  onAddTask = () => {},
  onRecordPayment = () => {},
  onArchive = () => {},
  onDelete = () => {},
}: ProjectDetailPopoverProps) {
  const popovers = useProjectDetailPopoverStore((s) => s.popovers);

  return (
    <AnimatePresence>
      {Array.from(popovers.values()).map((state) => (
        <ProjectDetailPopoverInstance
          key={state.id}
          state={state}
          project={projects.get(state.id)}
          clientName={
            clientNames.get(projects.get(state.id)?.clientId ?? "") ?? ""
          }
          canManage={canManage}
          canCreateTasks={canCreateTasks}
          canRecordPayment={canRecordPayment}
          canDelete={canDelete}
          onAddTask={onAddTask}
          onRecordPayment={onRecordPayment}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      ))}
    </AnimatePresence>
  );
}
