"use client";

import { useMemo, useState } from "react";
import { Search, GripVertical } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useTasks } from "@/lib/hooks";
import { TaskStatus } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";

// ─── Spring config for expand/collapse ──────────────────────────────────────
const SPRING = { type: "spring" as const, stiffness: 300, damping: 30 };

// ─── Unscheduled Panel ───────────────────────────────────────────────────────

export function UnscheduledPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const { data: taskData } = useTasks();

  const allUnscheduled = useMemo(() => {
    const all = taskData?.tasks ?? [];
    return all.filter(
      (t) =>
        !t.calendarEventId &&
        t.status !== TaskStatus.Completed &&
        t.status !== TaskStatus.Cancelled &&
        !t.deletedAt
    );
  }, [taskData]);

  const unscheduledTasks = useMemo(() => {
    if (!search.trim()) return allUnscheduled;
    const q = search.toLowerCase();
    return allUnscheduled.filter(
      (t) =>
        (t.customTitle ?? "").toLowerCase().includes(q) ||
        (t.taskType?.display ?? "").toLowerCase().includes(q) ||
        (t.project?.title ?? "").toLowerCase().includes(q)
    );
  }, [allUnscheduled, search]);

  const count = allUnscheduled.length;
  const showSearch = isExpanded && count > 5;

  return (
    <div className="border-t border-white/10 bg-[#141414] flex-shrink-0">
      {/* ── Collapsed bar / header ── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full h-[36px] flex items-center gap-2 px-3 cursor-pointer select-none hover:bg-white/[0.03] transition-colors duration-150"
      >
        {/* Triangle indicator */}
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={SPRING}
          className="text-[#999] text-[10px] leading-none"
        >
          &#x25B8;
        </motion.span>

        {/* Label */}
        <span className="font-kosugi text-[10px] text-[#999] uppercase tracking-[0.12em]">
          {count} unscheduled task{count !== 1 ? "s" : ""}
        </span>

        {/* Count badge */}
        {count > 0 && (
          <span className="font-kosugi text-[9px] text-[#597794] bg-[#597794]/20 px-[6px] py-[1px] rounded-sm ml-auto">
            {count}
          </span>
        )}
      </button>

      {/* ── Expanded content ── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 pt-0.5">
              {count === 0 ? (
                /* ── Empty state ── */
                <div className="h-[80px] flex items-center">
                  <span className="font-kosugi text-[10px] uppercase tracking-[0.12em] text-white/30">
                    All tasks scheduled
                  </span>
                </div>
              ) : (
                /* ── Task row ── */
                <div className="flex items-start gap-2">
                  {/* Search input (only when > 5 tasks) */}
                  {showSearch && (
                    <div className="relative shrink-0 w-[140px]">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#999]" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-full pl-[26px] pr-2 py-[5px] bg-[#0D0D0D] border border-white/10 rounded-sm font-kosugi text-[10px] text-white uppercase placeholder:text-[#999] placeholder:normal-case focus:outline-none focus:border-[#597794]/40 transition-colors"
                      />
                    </div>
                  )}

                  {/* Horizontal scrollable cards */}
                  <div className="flex gap-2 overflow-x-auto flex-1 scrollbar-hide">
                    {unscheduledTasks.map((task) => (
                      <UnscheduledTaskCard key={task.id} task={task} />
                    ))}
                    {unscheduledTasks.length === 0 && search && (
                      <div className="flex items-center h-[80px]">
                        <span className="font-kosugi text-[10px] uppercase tracking-[0.12em] text-white/30">
                          No matching tasks
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

  const taskColor = task.taskColor || "#597794";
  const projectName = task.project?.title || "Untitled Project";
  const taskTypeLabel = task.taskType?.display || "Task";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "relative flex items-center shrink-0 w-[160px] h-[80px] rounded-sm cursor-grab",
        "bg-[#0D0D0D] border border-white/10",
        "transition-opacity duration-100",
        isDragging && "opacity-40"
      )}
      style={dragStyle}
    >
      {/* 3px left color stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-sm"
        style={{ backgroundColor: taskColor }}
      />

      {/* Grip handle */}
      <div className="flex items-center justify-center w-[20px] shrink-0 ml-[3px]">
        <GripVertical className="w-3 h-3 text-[#999]" />
      </div>

      {/* Card content */}
      <div className="flex flex-col justify-center min-w-0 flex-1 pr-2 py-2">
        <span className="font-mohave font-semibold text-[12px] text-white uppercase truncate leading-tight">
          {projectName}
        </span>
        <span className="font-kosugi text-[9px] text-[#999] uppercase tracking-[0.08em] truncate mt-0.5">
          {taskTypeLabel}
        </span>
      </div>
    </div>
  );
}
