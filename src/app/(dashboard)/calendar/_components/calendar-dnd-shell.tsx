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
import {
  FIRST_HOUR,
  HOUR_HEIGHT,
  LAST_HOUR,
} from "@/lib/utils/calendar-constants";
import type { ProjectTask } from "@/lib/types/models";
import { useUpdateTask, useTasks, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
import { useCalendarResize, type ResizePatch } from "./use-calendar-resize";

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

// ─── Resize context ─────────────────────────────────────────────────────────
//
// Hoisted out of each grid so we don't mount one RecurrenceEditPrompt per
// scroll panel — the buffered Month / Week / Day containers can render up
// to ~55 panels combined, each previously mounted its own prompt. One
// useCalendarResize lives here; every grid consumes via this context.

interface CalendarResizeAPI {
  commitResize: (
    event: InternalCalendarEvent,
    patch: ResizePatch
  ) => Promise<void>;
}

const CalendarResizeContext = createContext<CalendarResizeAPI | null>(null);

export function useCalendarResizeContext(): CalendarResizeAPI {
  const ctx = useContext(CalendarResizeContext);
  if (!ctx) {
    throw new Error(
      "useCalendarResizeContext must be used inside <CalendarDndShell>"
    );
  }
  return ctx;
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

  // Single shared resize API. Provided to descendants via context so each
  // grid panel doesn't mount its own copy.
  const resize = useCalendarResize();
  const resizeApi = useMemo<CalendarResizeAPI>(
    () => ({ commitResize: resize.commitResize }),
    [resize.commitResize]
  );

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
      if (!activeData?.type) return;

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

      // ── Drop on the unscheduled dock → unschedule the event ─────────────
      // Only existing calendar events can be unscheduled; tasks already in
      // the tray (`unscheduled-task`) have no schedule to clear.
      if (overData?.type === "unscheduled-dock") {
        const calEvent = activeData.event;
        if (
          !calEvent ||
          (activeData.type !== "month-event" &&
            activeData.type !== "week-event" &&
            activeData.type !== "day-hourly-event" &&
            activeData.type !== "day-list-event")
        ) {
          return;
        }
        // Clear startDate / endDate. Recurrence-aware to mirror reschedule
        // behavior: a series occurrence opens the prompt; a one-off updates
        // directly. startTime / endTime are explicitly cleared so the row
        // doesn't carry a phantom time slot.
        const patch: Partial<ProjectTask> = {
          startDate: null,
          endDate: null,
          startTime: null,
          endTime: null,
        };
        await dispatchUpdate(
          calEvent.id,
          patch,
          "Unschedule this occurrence, or unschedule the entire series?"
        );
        return;
      }

      if (!overData?.day) return;

      const targetDay = overData.day;

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

        // Clamp to the visible hourly band [FIRST_HOUR, LAST_HOUR].
        const startHourFloat =
          newStart.getHours() + newStart.getMinutes() / 60;
        const endHourFloat = newEnd.getHours() + newEnd.getMinutes() / 60;
        if (
          startHourFloat < FIRST_HOUR ||
          endHourFloat > LAST_HOUR ||
          newEnd.getTime() <= newStart.getTime()
        ) {
          toast.error("Cannot move outside business hours", {
            description: `Event must stay between ${FIRST_HOUR}:00 and ${LAST_HOUR}:00.`,
          });
          return;
        }

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
      <CalendarResizeContext.Provider value={resizeApi}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          autoScroll={{
            // Tight edge zone (~5% of axis = ~40-60px on typical layouts).
            // dnd-kit walks up to scrollable ancestors and scrolls them when
            // the pointer enters the threshold band. Each scroll container
            // toggles off scroll-snap during drag (see useCalendarDragState),
            // which lets autoscroll move the viewport across panel boundaries
            // without the snap engine yanking it back.
            threshold: { x: 0.05, y: 0.05 },
            acceleration: 12,
          }}
        >
          {children}
          <DragOverlay dropAnimation={null}>
            {activeDrag?.event ? <DragPreview event={activeDrag.event} /> : null}
          </DragOverlay>
          {recurrencePrompt.promptElement}
          {resize.promptElement}
        </DndContext>
      </CalendarResizeContext.Provider>
    </DragStateContext.Provider>
  );
}

// ─── Drag preview ───────────────────────────────────────────────────────────

function DragPreview({ event }: { event: InternalCalendarEvent }) {
  const title = event.projectTitle ?? event.taskTitle;
  return (
    <div
      style={{
        // glass-dense surface + type-color border. Spec forbids box-shadow
        // on dark canvas — dense glass + border IS the depth cue.
        background: "rgba(18, 18, 20, 0.78)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
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
        opacity: 0.96,
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
