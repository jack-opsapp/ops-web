"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Search, GripVertical } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import { useTasks } from "@/lib/hooks";
import { TaskStatus } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";

// ─── Unscheduled Panel ───────────────────────────────────────────────────────

export function UnscheduledPanel() {
  const [search, setSearch] = useState("");
  const { data: taskData } = useTasks();

  const allUnscheduled = useMemo(() => {
    const all = taskData?.tasks ?? [];
    return all.filter(
      (t) => !t.calendarEventId && t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled && !t.deletedAt
    );
  }, [taskData]);

  const unscheduledTasks = useMemo(() => {
    if (!search.trim()) return allUnscheduled;
    const q = search.toLowerCase();
    return allUnscheduled.filter(
      (t) =>
        (t.customTitle ?? "").toLowerCase().includes(q) ||
        (t.taskType?.display ?? "").toLowerCase().includes(q)
    );
  }, [allUnscheduled, search]);

  return (
    <div className="border-t border-border-subtle">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CalendarPlus className="w-3 h-3 text-text-disabled" />
          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-[0.12em]">
            Unscheduled
          </span>
        </div>
        {unscheduledTasks.length > 0 && (
          <span className="font-mono text-[9px] text-ops-accent bg-ops-accent-muted/20 px-[6px] py-[1px] rounded-sm">
            {unscheduledTasks.length}
          </span>
        )}
      </div>

      {/* Search */}
      {allUnscheduled.length > 3 && (
        <div className="px-3 pb-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-[26px] pr-2 py-[5px] bg-background-elevated/50 border border-border-subtle rounded-sm font-mono text-[11px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-ops-accent/40 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex flex-col max-h-[240px] overflow-y-auto px-1">
        {unscheduledTasks.map((task) => (
          <UnscheduledTaskCard key={task.id} task={task} />
        ))}
        {unscheduledTasks.length === 0 && (
          <div className="px-2 py-3 text-center">
            <span className="font-mono text-[10px] text-text-disabled">
              {search ? "No matching tasks" : "All tasks scheduled"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Draggable Task Card ─────────────────────────────────────────────────────

function UnscheduledTaskCard({ task }: { task: ProjectTask }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `unscheduled-${task.id}`,
      data: { type: "unscheduled-task", task },
    });

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const title = task.customTitle || task.taskType?.display || "Untitled Task";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex items-center gap-1.5 px-2 py-[6px] rounded-sm cursor-grab transition-all duration-100",
        "hover:bg-background-elevated/50",
        isDragging && "opacity-40 border-dashed"
      )}
      style={dragStyle}
    >
      <GripVertical className="w-3 h-3 text-text-disabled shrink-0" />
      <div
        className="w-[6px] h-[6px] rounded-full shrink-0"
        style={{ backgroundColor: task.taskColor || "#59779F" }}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-mohave text-body-sm text-text-secondary truncate">
          {title}
        </span>
        {task.project?.title && (
          <span className="font-mono text-[9px] text-text-disabled truncate">
            {task.project.title}
          </span>
        )}
      </div>
    </div>
  );
}
