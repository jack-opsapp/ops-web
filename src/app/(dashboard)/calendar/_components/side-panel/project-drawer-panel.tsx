"use client";

import { useMemo, useState, useCallback } from "react";
import { format, isSameMonth } from "date-fns";
import { GripVertical, Ban, Zap, Plus } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import { useCalendarStore } from "@/stores/calendar-store";
import {
  useProject,
  useClient,
  useProjectTasks,
  useTaskTypes,
  useCreateTask,
} from "@/lib/hooks";
import {
  PROJECT_STATUS_COLORS,
  getTaskDisplayTitle,
  getTaskEffectiveColor,
} from "@/lib/types/models";
import type { ProjectTask, TaskType } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { SidePanelShell } from "./side-panel-shell";

// ─── Date Range Formatter ──────────────────────────────────────────────────

function formatTaskDateRange(
  startTime?: string | null,
  endTime?: string | null,
  calendarEvent?: ProjectTask["calendarEvent"]
): string | null {
  const start = calendarEvent?.startDate
    ? new Date(calendarEvent.startDate)
    : startTime
      ? new Date(startTime)
      : null;
  const end = calendarEvent?.endDate
    ? new Date(calendarEvent.endDate)
    : endTime
      ? new Date(endTime)
      : null;

  if (!start) return null;

  if (!end || start.toDateString() === end.toDateString()) {
    return format(start, "MMM d");
  }

  if (isSameMonth(start, end)) {
    return `${format(start, "MMM d")}-${format(end, "d")}`;
  }

  return `${format(start, "MMM d")} - ${format(end, "MMM d")}`;
}

// ─── Draggable Task Card ───────────────────────────────────────────────────

function DrawerTaskCard({
  task,
  taskTypes,
  showConnector,
}: {
  task: ProjectTask;
  taskTypes: TaskType[];
  showConnector: boolean;
}) {
  const taskType = taskTypes.find((tt) => tt.id === task.taskTypeId) ?? null;
  const title = getTaskDisplayTitle(task, taskType);
  const color = getTaskEffectiveColor(task, taskType);
  const dateRange = formatTaskDateRange(
    task.startTime,
    task.endTime,
    task.calendarEvent
  );

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `project-drawer-task-${task.id}`,
      data: { type: "project-drawer-task", task },
    });

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div className="relative">
      {/* Dependency connector line */}
      {showConnector && (
        <div
          className="absolute left-[19px] -top-[2px] w-[1px] h-[4px]"
          style={{ backgroundColor: "rgba(255,255,255,0.10)" }}
        />
      )}

      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={cn(
          "flex items-start gap-[8px] px-[10px] py-[8px] rounded-[3px] cursor-grab transition-all duration-100",
          isDragging && "opacity-40"
        )}
        style={{
          backgroundColor: "#0D0D0D",
          border: isDragging
            ? "1px dashed rgba(255,255,255,0.20)"
            : "1px solid rgba(255,255,255,0.08)",
          ...dragStyle,
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLElement).style.borderColor =
              "rgba(255,255,255,0.15)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLElement).style.borderColor =
              "rgba(255,255,255,0.08)";
          }
        }}
      >
        {/* Grip handle */}
        <GripVertical
          className="w-[14px] h-[14px] shrink-0 mt-[1px]"
          style={{ color: "#555555" }}
        />

        {/* Color dot */}
        <div
          className="w-[8px] h-[8px] rounded-full shrink-0 mt-[3px]"
          style={{ backgroundColor: color }}
        />

        {/* Content */}
        <div className="flex flex-col min-w-0 flex-1 gap-[2px]">
          <span
            className="font-mohave text-[13px] text-white truncate text-left"
            style={{ lineHeight: "1.3" }}
          >
            {title}
          </span>
          {dateRange ? (
            <span
              className="font-kosugi text-[10px] text-left"
              style={{ color: "#999999", lineHeight: "1.4" }}
            >
              {dateRange}
            </span>
          ) : (
            <span
              className="font-kosugi text-[10px] flex items-center gap-[3px] text-left"
              style={{ color: "#999999", lineHeight: "1.4" }}
            >
              <Ban className="w-[9px] h-[9px]" style={{ color: "#666666" }} />
              Not scheduled
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Project Drawer Panel ──────────────────────────────────────────────────

export function ProjectDrawerPanel() {
  const { sidePanelMode, sidePanelProjectId, closeSidePanel } =
    useCalendarStore();
  const { company } = useAuthStore();

  const isOpen = sidePanelMode === "project-drawer" && !!sidePanelProjectId;

  const { data: project } = useProject(
    isOpen ? sidePanelProjectId! : undefined
  );
  const { data: client } = useClient(project?.clientId ?? undefined);
  const { data: tasks } = useProjectTasks(
    isOpen ? sidePanelProjectId! : undefined
  );
  const { data: taskTypeData } = useTaskTypes();
  const createTask = useCreateTask();

  const taskTypes: TaskType[] = useMemo(
    () => taskTypeData ?? [],
    [taskTypeData]
  );

  // Sort tasks by displayOrder
  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    const activeTasks = tasks.filter((t) => !t.deletedAt);
    return [...activeTasks].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [tasks]);

  // Determine which tasks have dependency connectors
  const taskConnectors = useMemo(() => {
    const connectorMap = new Map<string, boolean>();
    for (let i = 0; i < sortedTasks.length; i++) {
      const task = sortedTasks[i];
      const prevTask = i > 0 ? sortedTasks[i - 1] : null;
      // Show connector if this task has dependency overrides referencing the previous task's type
      let showConnector = false;
      if (prevTask && task.dependencyOverrides?.length) {
        showConnector = task.dependencyOverrides.some(
          (dep) => dep.depends_on_task_type_id === prevTask.taskTypeId
        );
      }
      connectorMap.set(task.id, showConnector);
    }
    return connectorMap;
  }, [sortedTasks]);

  // Inline add task
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const handleAddTask = useCallback(() => {
    if (!newTaskTitle.trim() || !sidePanelProjectId || !company?.id) return;

    const defaultTaskType = taskTypes[0];
    createTask.mutate(
      {
        projectId: sidePanelProjectId,
        companyId: company.id,
        taskTypeId: defaultTaskType?.id ?? "",
        customTitle: newTaskTitle.trim(),
        status: "Booked" as ProjectTask["status"],
        taskColor: defaultTaskType?.color ?? "#59779F",
        displayOrder: sortedTasks.length,
        taskIndex: sortedTasks.length,
        teamMemberIds: [],
        calendarEventId: null,
        taskNotes: null,
        sourceLineItemId: null,
        sourceEstimateId: null,
        needsSync: true,
        lastSyncedAt: null,
        deletedAt: null,
      },
      {
        onSuccess: () => {
          setNewTaskTitle("");
          setIsAddingTask(false);
        },
      }
    );
  }, [
    newTaskTitle,
    sidePanelProjectId,
    company?.id,
    taskTypes,
    createTask,
    sortedTasks.length,
  ]);

  // Status badge color
  const statusColor = project
    ? PROJECT_STATUS_COLORS[project.status] ?? "#999999"
    : "#999999";

  return (
    <SidePanelShell
      isOpen={isOpen}
      onClose={closeSidePanel}
      title={project?.title ?? "Project"}
    >
      <div className="flex flex-col h-full">
        {/* ── Project Header ────────────────────────────────────── */}
        <div
          className="px-[16px] py-[14px] shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
        >
          {/* Client name */}
          {client?.name && (
            <p
              className="font-kosugi text-[12px] text-left mb-[4px]"
              style={{ color: "#999999", lineHeight: "1.4" }}
            >
              {client.name}
            </p>
          )}

          {/* Address */}
          {project?.address && (
            <p
              className="font-kosugi text-[11px] text-left mb-[8px]"
              style={{ color: "rgba(255,255,255,0.45)", lineHeight: "1.4" }}
            >
              {project.address}
            </p>
          )}

          {/* Status badge */}
          {project?.status && (
            <span
              className="inline-block font-kosugi text-[9px] uppercase px-[8px] py-[3px] rounded-[2px] text-left"
              style={{
                color: statusColor,
                backgroundColor: `${statusColor}1F`,
                border: `1px solid ${statusColor}4D`,
                lineHeight: "1.3",
              }}
            >
              {project.status}
            </span>
          )}
        </div>

        {/* ── Task List ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-[12px] py-[12px]">
          {/* Section label */}
          <p
            className="font-kosugi text-[10px] uppercase text-left mb-[8px] px-[4px]"
            style={{
              color: "#999999",
              letterSpacing: "0.08em",
              lineHeight: "1.4",
            }}
          >
            TASKS ({sortedTasks.length})
          </p>

          {/* Task cards */}
          <div className="flex flex-col gap-[4px]">
            {sortedTasks.map((task) => (
              <DrawerTaskCard
                key={task.id}
                task={task}
                taskTypes={taskTypes}
                showConnector={taskConnectors.get(task.id) ?? false}
              />
            ))}

            {sortedTasks.length === 0 && (
              <div className="px-[4px] py-[16px]">
                <p
                  className="font-kosugi text-[11px] text-left"
                  style={{ color: "#666666" }}
                >
                  No tasks yet
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Actions (sticky bottom) ──────────────────────────── */}
        <div
          className="shrink-0 px-[12px] pb-[14px] pt-[10px] flex flex-col gap-[6px]"
          style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}
        >
          {/* Auto-schedule button */}
          <button
            className="w-full flex items-center justify-center gap-[6px] px-[12px] py-[8px] rounded-[3px] font-kosugi text-[10px] uppercase transition-colors"
            style={{
              color: "#597794",
              border: "1px solid #597794",
              backgroundColor: "transparent",
              letterSpacing: "0.06em",
              lineHeight: "1.4",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "rgba(89,119,148,0.08)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "transparent";
            }}
          >
            <Zap className="w-[12px] h-[12px]" />
            AUTO-SCHEDULE
          </button>

          {/* Add task button / inline form */}
          {isAddingTask ? (
            <div className="flex flex-col gap-[4px]">
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTask();
                  if (e.key === "Escape") {
                    setIsAddingTask(false);
                    setNewTaskTitle("");
                  }
                }}
                placeholder="Task name..."
                autoFocus
                className="w-full px-[10px] py-[6px] rounded-[3px] font-kosugi text-[11px] text-white placeholder:text-[#555555] focus:outline-none"
                style={{
                  backgroundColor: "#141414",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
              <div className="flex gap-[4px]">
                <button
                  onClick={handleAddTask}
                  disabled={!newTaskTitle.trim() || createTask.isPending}
                  className="flex-1 px-[8px] py-[5px] rounded-[3px] font-kosugi text-[10px] uppercase text-white transition-colors disabled:opacity-40"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {createTask.isPending ? "ADDING..." : "ADD"}
                </button>
                <button
                  onClick={() => {
                    setIsAddingTask(false);
                    setNewTaskTitle("");
                  }}
                  className="px-[8px] py-[5px] rounded-[3px] font-kosugi text-[10px] uppercase transition-colors"
                  style={{
                    color: "#999999",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingTask(true)}
              className="w-full flex items-center justify-center gap-[6px] px-[12px] py-[8px] rounded-[3px] font-kosugi text-[10px] uppercase transition-colors"
              style={{
                color: "#999999",
                border: "1px solid rgba(255,255,255,0.08)",
                backgroundColor: "transparent",
                letterSpacing: "0.06em",
                lineHeight: "1.4",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "rgba(255,255,255,0.15)";
                (e.currentTarget as HTMLElement).style.color = "#CCCCCC";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLElement).style.color = "#999999";
              }}
            >
              <Plus className="w-[12px] h-[12px]" />
              ADD TASK
            </button>
          )}
        </div>
      </div>
    </SidePanelShell>
  );
}
