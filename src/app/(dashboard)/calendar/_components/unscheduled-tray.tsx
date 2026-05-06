"use client";

import { useMemo } from "react";
import { ChevronRight, ChevronLeft, GripVertical } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
// Bug 483cd85c — collapse/expand animation tuned to match the EdgeTab drawer
// pattern (220-260ms EASE_SMOOTH). The previous mode="wait" pattern caused a
// visible blank gap between the collapsed handle and the expanded panel.
// The new pattern overlaps the cross-fade so there's never a moment where
// neither variant is visible.
const TRAY_TRANSITION_MS = 240;

// Group sentinel keys — used when the underlying entity is missing (no
// project assigned / RLS-filtered client / untyped task). Held at module
// scope so the values are stable across renders. Bug e06445fe.
const NO_PROJECT_KEY = "__no_project__";
const NO_CLIENT_KEY = "__no_client__";
const NO_TYPE_KEY = "__no_type__";

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
        (t.project?.address ?? "").toLowerCase().includes(q) ||
        (t.project?.client?.name ?? "").toLowerCase().includes(q)
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
  // Bug e06445fe — group-by-client wasn't surfacing client names because the
  // group `label` was rendered as `// ${label}` while the keyOf() fallback
  // ALSO emitted a `//` prefix ("// NO CLIENT"), and RLS-filtered embeds can
  // leave `t.project.client` null even when the project has a clientId.
  // Resolution:
  //   1. Group key holds the canonical NAME only (no `//` prefix).
  //   2. Empty/missing names fall back to a separate sentinel.
  //   3. The renderer carries the `//` prefix exactly once.
  // The sentinel is rendered as `// NO CLIENT` / `// NO PROJECT` /
  // `// NO TYPE` so the operator still sees a labeled group.
  const groups = useMemo(() => {
    if (unscheduledTrayGroupBy === "none") {
      return [{ key: "all", label: "ALL", tasks: sorted }];
    }
    const keyOf = (t: ProjectTask): { key: string; label: string } => {
      switch (unscheduledTrayGroupBy) {
        case "project": {
          const name = t.project?.title?.trim();
          return name
            ? { key: name, label: name }
            : { key: NO_PROJECT_KEY, label: "NO PROJECT" };
        }
        case "client": {
          // task-service eager-loads project.client (see select clause).
          // RLS on clients can suppress the embed; fall back to the bare
          // clientId so the operator still gets a stable grouping (and a
          // hint that the client row is access-restricted).
          const clientName = t.project?.client?.name?.trim();
          if (clientName) return { key: clientName, label: clientName };
          const clientId =
            t.project?.client?.id ?? t.project?.clientId ?? null;
          if (clientId) {
            // Compact id label so the group still has a stable sort key.
            const short = clientId.slice(0, 8);
            return {
              key: `client:${clientId}`,
              label: `CLIENT ${short.toUpperCase()}`,
            };
          }
          return { key: NO_CLIENT_KEY, label: "NO CLIENT" };
        }
        case "type": {
          const display = t.taskType?.display?.trim();
          return display
            ? { key: display.toUpperCase(), label: display.toUpperCase() }
            : { key: NO_TYPE_KEY, label: "NO TYPE" };
        }
      }
    };

    const map = new Map<string, { label: string; tasks: ProjectTask[] }>();
    for (const t of sorted) {
      const { key, label } = keyOf(t);
      const entry = map.get(key);
      if (entry) {
        entry.tasks.push(t);
      } else {
        map.set(key, { label, tasks: [t] });
      }
    }

    return Array.from(map.entries()).map(([key, { label, tasks }]) => ({
      key,
      label,
      tasks,
    }));
  }, [sorted, unscheduledTrayGroupBy]);

  // Bug 8620c037 — the unscheduled tray docks LEFT in every view (canonical
  // side, documented in system.md Calendar section). Previously day docked
  // left and week/month/crew docked right, which made the tray feel like it
  // was bouncing around as the operator switched views. Locking it to the
  // LEFT means the tray reads as a permanent secondary panel separate from
  // the main calendar canvas — same affordance no matter the view. The
  // `view` prop is still threaded through so future per-view tweaks (e.g.
  // a wider tray on day view) can branch off it without re-plumbing.
  void view;
  const count = allUnscheduled.length;
  const reducedMotion = useReducedMotion();

  // Drop target — calendar events dragged ONTO the tray are unscheduled
  // (start_date / end_date / start_time / end_time → null). The task
  // returns to the tray on the next render. (Bug cc515384.) Routed via
  // CalendarDndShell.handleDragEnd.
  const { setNodeRef: setUnscheduleDropRef, isOver: isUnscheduleOver } =
    useDroppable({
      id: "unscheduled-dock",
      data: { type: "unscheduled-dock" },
    });

  // ── Animated width container ────────────────────────────────────────────
  // A single motion.div animates between COLLAPSED_WIDTH and EXPANDED_WIDTH
  // so the rail visibly slides closed / open. Inner contents cross-fade with
  // AnimatePresence so the collapsed rail (vertical label) and expanded
  // panel (search + cards) hand off smoothly without an instant swap.

  return (
    <motion.div
      ref={setUnscheduleDropRef}
      initial={false}
      animate={{
        // Reduced motion: snap directly to target width with no tween.
        width: unscheduledTrayCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { duration: TRAY_TRANSITION_MS / 1000, ease: EASE_SMOOTH }
      }
      className="shrink-0 h-full flex flex-col min-h-0 overflow-hidden relative"
      style={{
        background: "var(--glass-bg)",
        // dockSide is locked to "left" (bug 8620c037) — the divider lives on
        // the right edge to separate the tray from the main canvas.
        borderRight: "1px solid var(--line)",
        outline: isUnscheduleOver
          ? "1px solid rgba(111, 148, 176, 0.4)"
          : "none",
        outlineOffset: -1,
      }}
    >
      {/* AnimatePresence without mode="wait" — both variants overlap during
          the cross-fade so the rail never goes blank. The exiting element
          continues to occupy the absolute-positioned inset until its
          opacity/scale animation finishes, then unmounts. */}
      <AnimatePresence initial={false}>
        {unscheduledTrayCollapsed ? (
          <motion.button
            key="tray-collapsed"
            type="button"
            onClick={toggleUnscheduledTray}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 0.18, ease: EASE_SMOOTH }
            }
            className="absolute inset-0 flex flex-col items-center justify-start gap-3 cursor-pointer group"
            style={{
              padding: "16px 0",
              background: "transparent",
              transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
            aria-label={`Show ${count} unscheduled tasks`}
            title={`// UNSCHEDULED [${count}]`}
          >
            {/* Tray is LEFT-docked — collapsed handle hints "expand right". */}
            <ChevronRight
              className="w-[14px] h-[14px]"
              style={{ color: "var(--text-3)" }}
            />
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
          </motion.button>
        ) : (
          <motion.div
            key="tray-expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 0.22, ease: EASE_SMOOTH }
            }
            className="absolute inset-0 flex flex-col min-h-0"
            style={{ width: EXPANDED_WIDTH }}
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
          {/* Tray is LEFT-docked — chevron points left to collapse. */}
          <ChevronLeft
            className="w-[14px] h-[14px]"
            style={{ color: "var(--text-3)" }}
          />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <SearchInput
          value={unscheduledTraySearch}
          onChange={(e) => setUnscheduledTraySearch(e.target.value)}
        />
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
              {"// ALL TASKS SCHEDULED"}
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
        )}
      </AnimatePresence>
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
  // Mirror iOS effectiveColor — task_types.color takes precedence.
  const stripeColor =
    (task.taskType?.color && task.taskType.color.trim()) ||
    task.taskColor ||
    "#6F94B0";

  const projectName = task.project?.title ?? "Untitled Project";
  const clientName = task.project?.client?.name ?? null;
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
      {clientName && (
        <div
          className="font-mono text-[10px] uppercase truncate mt-1"
          style={{
            color: "var(--text-3)",
            letterSpacing: "0.16em",
          }}
        >
          {`[${clientName}]`}
        </div>
      )}
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
