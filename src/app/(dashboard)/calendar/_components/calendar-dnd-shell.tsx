"use client";

/**
 * CalendarDndShell — single dnd-kit context for the entire calendar surface.
 *
 * Hoisted out of the per-view grids so cross-panel drag works in the
 * continuous-scroll Month / Week / Day containers. Also lets the unscheduled
 * tray and project drawer (siblings of the grid) participate in the same
 * context so drag-to-schedule reaches a calendar droppable.
 *
 * Routes by drag-source type:
 *   - month-event / week-event   → all-day reschedule (whole-day shift)
 *   - day-hourly-event           → 15-min snap reschedule (vertical) +
 *                                  optional cross-day shift (horizontal)
 *   - unscheduled-task           → schedule into the over day
 *   - project-drawer-task        → schedule into the over day
 *
 * Recurrence-aware: when the source task belongs to a series, prompts the
 * user for scope (this / following / all) before applying the patch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { addDays, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { HOUR_HEIGHT } from "@/lib/utils/calendar-constants";
import type { ProjectTask } from "@/lib/types/models";
import { useUpdateTask, useTasks, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";

// ─── Drag state context ─────────────────────────────────────────────────────

interface CalendarDragState {
  isDragging: boolean;
  activeType: string | null;
}

const DragStateContext = createContext<CalendarDragState>({
  isDragging: false,
  activeType: null,
});

/** Read live drag state — used by scroll containers to disable scroll-snap mid-drag. */
export function useCalendarDragState() {
  return useContext(DragStateContext);
}

// ─── Active drag descriptor ────────────────────────────────────────────────

interface ActiveDrag {
  id: string;
  type: string;
  event?: InternalCalendarEvent;
  task?: { id: string; duration: number; title?: string };
}

// ─── Snap helpers ───────────────────────────────────────────────────────────

const SNAP_MIN = 15;
const PX_PER_MIN = HOUR_HEIGHT / 60;
const SNAP_PX = SNAP_MIN * PX_PER_MIN;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtHHmmss(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CalendarDndShellProps {
  children: React.ReactNode;
}

export function CalendarDndShell({ children }: CalendarDndShellProps) {
  const updateTask = useUpdateTask();
  const recurrenceEdit = useRecurrenceEdit();
  const recurrencePrompt = useRecurrenceEditPrompt();

  const { data: taskData } = useTasks();
  const tasksById = useMemo(() => {
    const map = new Map<string, ProjectTask>();
    for (const t of taskData?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [taskData]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  // ── Lifecycle handlers ───────────────────────────────────────────────────

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data?.current as
      | {
          type?: string;
          event?: InternalCalendarEvent;
          task?: { id: string; duration: number; title?: string };
        }
      | undefined;
    if (!data?.type) return;
    setActiveDrag({
      id: String(e.active.id),
      type: data.type,
      event: data.event,
      task: data.task,
    });
  }, []);

  const handleDragCancel = useCallback((_e: DragCancelEvent) => {
    setActiveDrag(null);
  }, []);

  const handleDragEnd = useCallback(
    async (dragEvent: DragEndEvent) => {
      setActiveDrag(null);

      const { active, over, delta } = dragEvent;
      if (!over) return;

      const activeData = active.data?.current as
        | {
            type?: string;
            event?: InternalCalendarEvent;
            task?: { id: string; duration: number };
          }
        | undefined;
      const overData = over.data?.current as
        | { type?: string; day?: Date }
        | undefined;
      if (!activeData?.type || !overData?.day) return;

      const targetDay = overData.day;

      // Recurrence-aware dispatcher
      const dispatchUpdate = async (
        sourceTaskId: string,
        patch: Partial<ProjectTask>,
        promptDescription: string
      ) => {
        const sourceTask = tasksById.get(sourceTaskId);
        if (sourceTask?.recurrenceId) {
          const scope = await recurrencePrompt.request({
            description: promptDescription,
          });
          if (!scope) return;
          recurrenceEdit.mutate(
            { task: sourceTask, scope, patch },
            {
              onError: (err) =>
                toast.error("Failed to move recurring task", {
                  description: err.message,
                }),
            }
          );
          return;
        }
        updateTask.mutate(
          { id: sourceTaskId, data: patch },
          {
            onError: (err) =>
              toast.error("Failed to move task", { description: err.message }),
          }
        );
      };

      // ── month-event / week-event: whole-day reschedule ───────────────
      if (
        (activeData.type === "month-event" || activeData.type === "week-event") &&
        activeData.event
      ) {
        const calEvent = activeData.event;
        const eventStart =
          calEvent.startDate instanceof Date
            ? calEvent.startDate
            : new Date(calEvent.startDate);
        const eventEnd =
          calEvent.endDate instanceof Date
            ? calEvent.endDate
            : new Date(calEvent.endDate);

        const dayDelta = differenceInCalendarDays(targetDay, eventStart);
        if (dayDelta === 0) return;

        const newStart = addDays(eventStart, dayDelta);
        const newEnd = addDays(eventEnd, dayDelta);

        await dispatchUpdate(
          calEvent.id,
          { startDate: newStart, endDate: newEnd },
          "Move this occurrence, or shift the entire series?"
        );
        return;
      }

      // ── day-hourly-event: vertical 15-min snap + cross-day shift ─────
      if (activeData.type === "day-hourly-event" && activeData.event) {
        const event = activeData.event;
        const snappedY = Math.round(delta.y / SNAP_PX) * SNAP_PX;
        const minutes = Math.round(snappedY / PX_PER_MIN);

        const eventStart = event.startDate;
        const eventEnd = event.endDate;
        const dayDelta = differenceInCalendarDays(targetDay, eventStart);

        if (minutes === 0 && dayDelta === 0) return;

        const newStart = new Date(
          addDays(eventStart, dayDelta).getTime() + minutes * 60_000
        );
        const newEnd = new Date(
          addDays(eventEnd, dayDelta).getTime() + minutes * 60_000
        );

        const patch: Partial<ProjectTask> = {
          startDate: newStart,
          endDate: newEnd,
          startTime: fmtHHmmss(newStart),
          endTime: fmtHHmmss(newEnd),
        };

        await dispatchUpdate(
          event.id,
          patch,
          "Move this occurrence, or shift the entire series?"
        );
        return;
      }

      // ── day-list-event: list-mode all-day card cross-day reschedule ──
      if (activeData.type === "day-list-event" && activeData.event) {
        const calEvent = activeData.event;
        const eventStart =
          calEvent.startDate instanceof Date
            ? calEvent.startDate
            : new Date(calEvent.startDate);
        const eventEnd =
          calEvent.endDate instanceof Date
            ? calEvent.endDate
            : new Date(calEvent.endDate);

        const dayDelta = differenceInCalendarDays(targetDay, eventStart);
        if (dayDelta === 0) return;

        const newStart = addDays(eventStart, dayDelta);
        const newEnd = addDays(eventEnd, dayDelta);

        await dispatchUpdate(
          calEvent.id,
          { startDate: newStart, endDate: newEnd },
          "Move this occurrence, or shift the entire series?"
        );
        return;
      }

      // ── Schedule from unscheduled tray ───────────────────────────────
      if (activeData.type === "unscheduled-task" && activeData.task) {
        const task = activeData.task;
        const duration = Math.max(task.duration ?? 1, 1);
        const newStart = targetDay;
        const newEnd = addDays(newStart, duration);
        updateTask.mutate(
          { id: task.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error("Failed to schedule task", {
                description: err.message,
              }),
          }
        );
        return;
      }

      // ── Schedule from project drawer ────────────────────────────────
      if (activeData.type === "project-drawer-task" && activeData.task) {
        const task = activeData.task;
        const duration = Math.max(task.duration ?? 1, 1);
        const newStart = targetDay;
        const newEnd = addDays(newStart, duration);
        updateTask.mutate(
          { id: task.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error("Failed to schedule task", {
                description: err.message,
              }),
          }
        );
        return;
      }
    },
    [tasksById, updateTask, recurrenceEdit, recurrencePrompt]
  );

  const dragState = useMemo<CalendarDragState>(
    () => ({
      isDragging: activeDrag !== null,
      activeType: activeDrag?.type ?? null,
    }),
    [activeDrag]
  );

  return (
    <DragStateContext.Provider value={dragState}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeDrag?.event ? <DragPreview event={activeDrag.event} /> : null}
        </DragOverlay>
        {recurrencePrompt.promptElement}
      </DndContext>
    </DragStateContext.Provider>
  );
}

// ─── Drag preview ───────────────────────────────────────────────────────────

function DragPreview({ event }: { event: InternalCalendarEvent }) {
  const title = event.projectTitle ?? event.taskTitle;
  return (
    <div
      style={{
        background: event.typeColors.bg,
        border: `1px solid ${event.typeColors.border}`,
        borderRadius: 4,
        padding: "6px 10px",
        color: "var(--text)",
        fontFamily: "var(--font-cakemono), sans-serif",
        fontWeight: 300,
        fontSize: 12,
        lineHeight: 1.2,
        textTransform: "uppercase",
        letterSpacing: 0,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
        opacity: 0.92,
        maxWidth: 320,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        position: "relative",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: event.typeColors.border,
          borderRadius: "4px 0 0 4px",
        }}
      />
      <span style={{ paddingLeft: 6 }}>{title}</span>
    </div>
  );
}
