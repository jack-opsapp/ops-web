"use client";

import { useMemo } from "react";
import { Search, ChevronRight, ChevronLeft, GripVertical } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import { useTasks } from "@/lib/hooks";
import { TaskStatus, type ProjectTask } from "@/lib/types/models";
import {
  useCalendarStore,
  type UnscheduledTrayGroupBy,
  type UnscheduledTraySort,
} from "@/stores/calendar-store";
import type { SchedulerView } from "@/lib/types/scheduling";

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];
const COLLAPSED_WIDTH = 32;
const EXPANDED_WIDTH = 280;

// ─── Props ─────────────────────────────────────────────────────────────────

interface UnscheduledTrayProps {
  view: SchedulerView;
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * Promoted (T15) from `unscheduled-panel.tsx` (which lived inside the filter
 * sidebar). Now a first-class collapsible rail that docks based on view:
 *   - Day view  → left rail (mirrors Jobber/Housecall convention)
 *   - Week / Month / Crew → right rail
 *
 * State persists in calendar-store: collapsed flag, groupBy, sort. Search is
 * session-scoped (not persisted) per common UX expectation.
 *
 * Drag source: each card emits dnd-kit data { type: 'unscheduled-task', task }
 * so existing droppable targets in calendar-grid-month, week-day-column, and
 * the crew swimlane can accept drops to schedule.
 */
export function UnscheduledTray({ view }: UnscheduledTrayProps) {
  const {
    unscheduledTrayCollapsed,
    unscheduledTrayGroupBy,
    unscheduledTraySort,
    unscheduledTraySearch,
    toggleUnscheduledTray,
    setUnscheduledTrayGroupBy,
    setUnscheduledTraySort,
    setUnscheduledTraySearch,
  } = useCalendarStore();

  const { data: taskData } = useTasks();

  // Tasks: unscheduled, not completed/cancelled, not deleted
  const allUnscheduled = useMemo(() => {
    const all = taskData?.tasks ?? [];
    return all.filter(
      (t) =>
        !t.startDate &&
        t.status !== TaskStatus.Completed &&
        t.status !== TaskStatus.Cancelled &&
        !t.deletedAt
    );
  }, [taskData]);

  // Search filter
  const filtered = useMemo(() => {
    if (!unscheduledTraySearch.trim()) return allUnscheduled;
    const q = unscheduledTraySearch.toLowerCase();
    return allUnscheduled.filter(
      (t) =>
        (t.customTitle ?? "").toLowerCase().includes(q) ||
        (t.taskType?.display ?? "").toLowerCase().includes(q) ||
        (t.project?.title ?? "").toLowerCase().includes(q) ||
        (t.project?.address ?? "").toLowerCase().includes(q)
    );
  }, [allUnscheduled, unscheduledTraySearch]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (unscheduledTraySort) {
        case "title": {
          const at = a.customTitle ?? a.taskType?.display ?? "";
          const bt = b.customTitle ?? b.taskType?.display ?? "";
          return at.localeCompare(bt);
        }
        case "project": {
          const ap = a.project?.title ?? "";
          const bp = b.project?.title ?? "";
          return ap.localeCompare(bp);
        }
        case "created":
        default: {
          // Fallback: by id (UUIDv7-ish ordering or stable order)
          return a.id.localeCompare(b.id);
        }
      }
    });
    return arr;
  }, [filtered, unscheduledTraySort]);

  // Group
  const groups = useMemo(() => {
    if (unscheduledTrayGroupBy === "none") {
      return [{ key: "all", label: "ALL", tasks: sorted }];
    }
    const keyOf = (t: ProjectTask): string => {
      switch (unscheduledTrayGroupBy) {
        case "project":
          return t.project?.title ?? "// NO PROJECT";
        case "client":
          // ProjectTask doesn't expose client directly; project carries clientId.
          // Without joining, fall back to project title (best available proxy).
          return t.project?.title ?? "// NO CLIENT";
        case "type":
          return t.taskType?.display?.toUpperCase() ?? "// NO TYPE";
      }
    };

    const map = new Map<string, ProjectTask[]>();
    for (const t of sorted) {
      const k = keyOf(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }

    return Array.from(map.entries()).map(([key, tasks]) => ({
      key,
      label: key,
      tasks,
    }));
  }, [sorted, unscheduledTrayGroupBy]);

  const dockSide: "left" | "right" = view === "day" ? "left" : "right";
  const count = allUnscheduled.length;

  // ── Collapsed state ─────────────────────────────────────────────────────

  if (unscheduledTrayCollapsed) {
    return (
      <button
        type="button"
        onClick={toggleUnscheduledTray}
        className="shrink-0 h-full flex flex-col items-center justify-start gap-3 cursor-pointer group"
        style={{
          width: COLLAPSED_WIDTH,
          background: "var(--glass-bg)",
          borderLeft: dockSide === "right" ? "1px solid var(--line)" : "none",
          borderRight: dockSide === "left" ? "1px solid var(--line)" : "none",
          padding: "16px 0",
          transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--surface-hover)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--glass-bg)";
        }}
        aria-label={`Show ${count} unscheduled tasks`}
        title={`// UNSCHEDULED [${count}]`}
      >
        {dockSide === "right" ? (
          <ChevronLeft
            className="w-[14px] h-[14px]"
            style={{ color: "var(--text-3)" }}
          />
        ) : (
          <ChevronRight
            className="w-[14px] h-[14px]"
            style={{ color: "var(--text-3)" }}
          />
        )}
        <div
          className="flex-1 flex items-center justify-center"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          <span
            className="font-mono text-[11px] uppercase tracking-wider tabular-nums"
            style={{
              color: "var(--text-3)",
              fontFeatureSettings: '"tnum" 1, "zero" 1',
            }}
          >
            {`// UNSCHEDULED [${count}]`}
          </span>
        </div>
        <GripVertical
          className="w-[14px] h-[14px]"
          style={{ color: "var(--text-mute)" }}
        />
      </button>
    );
  }

  // ── Expanded state ──────────────────────────────────────────────────────

  return (
    <motion.div
      initial={false}
      animate={{ width: EXPANDED_WIDTH }}
      transition={{ duration: 0.22, ease: EASE_SMOOTH }}
      className="shrink-0 h-full flex flex-col min-h-0"
      style={{
        width: EXPANDED_WIDTH,
        background: "var(--glass-bg)",
        borderLeft: dockSide === "right" ? "1px solid var(--line)" : "none",
        borderRight: dockSide === "left" ? "1px solid var(--line)" : "none",
      }}
    >
      {/* Header row */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-3"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <span
          className="font-mono text-[11px] uppercase tracking-wider tabular-nums"
          style={{
            color: "var(--text)",
            fontFeatureSettings: '"tnum" 1, "zero" 1',
          }}
        >
          {`// UNSCHEDULED [${count}]`}
        </span>
        <button
          type="button"
          onClick={toggleUnscheduledTray}
          className="cursor-pointer p-1 -mr-1"
          aria-label="Collapse unscheduled tray"
          title="Collapse"
        >
          {dockSide === "right" ? (
            <ChevronRight
              className="w-[14px] h-[14px]"
              style={{ color: "var(--text-3)" }}
            />
          ) : (
            <ChevronLeft
              className="w-[14px] h-[14px]"
              style={{ color: "var(--text-3)" }}
            />
          )}
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-[10px] top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-3)" }}
          />
          <input
            type="text"
            value={unscheduledTraySearch}
            onChange={(e) => setUnscheduledTraySearch(e.target.value)}
            placeholder="SEARCH"
            className="w-full pl-[30px] pr-2 py-[6px] font-mono text-[11px] uppercase tracking-wider"
            style={{
              background: "var(--surface-input)",
              border: "1px solid var(--line)",
              borderRadius: 5,
              color: "var(--text)",
              outline: "none",
              letterSpacing: "0.06em",
            }}
            onFocus={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor =
                "rgba(255,255,255,0.20)")
            }
            onBlur={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = "var(--line)")
            }
          />
        </div>
      </div>

      {/* Group / Sort selects */}
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2 pb-3">
        <TraySelect
          label="// GROUP"
          value={unscheduledTrayGroupBy}
          onChange={(v) =>
            setUnscheduledTrayGroupBy(v as UnscheduledTrayGroupBy)
          }
          options={[
            { value: "project", label: "PROJECT" },
            { value: "client", label: "CLIENT" },
            { value: "type", label: "TYPE" },
            { value: "none", label: "NONE" },
          ]}
        />
        <TraySelect
          label="// SORT"
          value={unscheduledTraySort}
          onChange={(v) => setUnscheduledTraySort(v as UnscheduledTraySort)}
          options={[
            { value: "created", label: "CREATED" },
            { value: "title", label: "TITLE" },
            { value: "project", label: "PROJECT" },
          ]}
        />
      </div>

      {/* Card list — grouped */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
        {count === 0 ? (
          <div className="pt-6">
            <span
              className="font-mono text-[10px] uppercase tracking-wider"
              style={{ color: "var(--text-mute)" }}
            >
              // ALL TASKS SCHEDULED
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-1.5">
                  {unscheduledTrayGroupBy !== "none" && (
                    <div className="flex items-center justify-between">
                      <span
                        className="font-mono text-[10px] uppercase tracking-wider truncate"
                        style={{ color: "var(--text-3)" }}
                      >
                        {`// ${group.label}`}
                      </span>
                      <span
                        className="font-mono text-[10px] tabular-nums"
                        style={{
                          color: "var(--text-mute)",
                          fontFeatureSettings: '"tnum" 1, "zero" 1',
                        }}
                      >
                        {`[${group.tasks.length}]`}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {group.tasks.map((task) => (
                      <UnscheduledTrayCard key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Tray card ─────────────────────────────────────────────────────────────

function UnscheduledTrayCard({ task }: { task: ProjectTask }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `unscheduled-${task.id}`,
      data: { type: "unscheduled-task", task },
    });

  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  // Use task color for the stripe (as proxy for type — matches what other
  // card consumers do when they don't have access to mapped event colors)
  const stripeColor = task.taskColor || "#6F94B0";

  const projectName = task.project?.title ?? "Untitled Project";
  const taskTypeLabel = task.taskType?.display?.toUpperCase() ?? "TASK";
  const customTitle = task.customTitle;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="relative cursor-grab"
      style={{
        ...dragStyle,
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        padding: "8px 10px 8px 13px",
        opacity: isDragging ? 0.4 : 1,
        transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          "rgba(255, 255, 255, 0.06)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          "rgba(255, 255, 255, 0.03)";
      }}
    >
      {/* Stripe */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: stripeColor,
          borderRadius: "4px 0 0 4px",
        }}
      />

      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span
          className="font-cakemono font-light text-[12px] uppercase truncate leading-tight"
          style={{ color: "var(--text)" }}
        >
          {projectName}
        </span>
        <span
          className="font-mono text-[9px] uppercase tracking-wider shrink-0"
          style={{ color: "var(--text-3)", letterSpacing: "0.04em" }}
        >
          {taskTypeLabel}
        </span>
      </div>
      {customTitle && customTitle !== task.taskType?.display && (
        <div
          className="font-mono text-[10px] truncate mt-1"
          style={{ color: "var(--text-3)" }}
        >
          {customTitle}
        </div>
      )}
    </div>
  );
}

// ─── Tray select ───────────────────────────────────────────────────────────

interface TraySelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

function TraySelect({ label, value, onChange, options }: TraySelectProps) {
  return (
    <label className="flex flex-col gap-1 flex-1 min-w-0">
      <span
        className="font-mono text-[9px] uppercase tracking-wider"
        style={{ color: "var(--text-mute)" }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full font-mono text-[10px] uppercase cursor-pointer"
        style={{
          background: "var(--surface-input)",
          border: "1px solid var(--line)",
          borderRadius: 5,
          color: "var(--text-2)",
          padding: "5px 6px",
          outline: "none",
          letterSpacing: "0.04em",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
