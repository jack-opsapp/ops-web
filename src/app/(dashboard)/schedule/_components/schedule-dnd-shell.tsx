"use client";

/**
 * ScheduleDndShell — single dnd-kit context for the entire calendar surface.
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
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import {
  FIRST_HOUR,
  HOUR_HEIGHT,
  LAST_HOUR,
} from "@/lib/utils/schedule-constants";
import type { ProjectTask } from "@/lib/types/models";
import { useUpdateTask, useTasks, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
import { useScheduleResize, type ResizePatch } from "./use-schedule-resize";

// ─── Drag state context ─────────────────────────────────────────────────────

interface ScheduleDragState {
  isDragging: boolean;
  activeType: string | null;
}

const DragStateContext = createContext<ScheduleDragState>({
  isDragging: false,
  activeType: null,
});

/** Read live drag state — used by scroll containers to disable scroll-snap mid-drag. */
export function useScheduleDragState() {
  return useContext(DragStateContext);
}

// ─── Resize context ─────────────────────────────────────────────────────────
//
// Hoisted out of each grid so we don't mount one RecurrenceEditPrompt per
// scroll panel — the buffered Month / Week / Day containers can render up
// to ~55 panels combined, each previously mounted its own prompt. One
// useScheduleResize lives here; every grid consumes via this context.

interface ScheduleResizeAPI {
  commitResize: (
    event: InternalScheduleEvent,
    patch: ResizePatch
  ) => Promise<void>;
}

const ScheduleResizeContext = createContext<ScheduleResizeAPI | null>(null);

export function useScheduleResizeContext(): ScheduleResizeAPI {
  const ctx = useContext(ScheduleResizeContext);
  if (!ctx) {
    throw new Error(
      "useScheduleResizeContext must be used inside <ScheduleDndShell>"
    );
  }
  return ctx;
}

// ─── Active drag descriptor ────────────────────────────────────────────────

interface ActiveDrag {
  id: string;
  type: string;
  event?: InternalScheduleEvent;
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

interface ScheduleDndShellProps {
  children: React.ReactNode;
}

export function ScheduleDndShell({ children }: ScheduleDndShellProps) {
  const { t } = useDictionary("schedule");
  const updateTask = useUpdateTask();
  const recurrenceEdit = useRecurrenceEdit();
  const recurrencePrompt = useRecurrenceEditPrompt();

  // Single shared resize API. Provided to descendants via context so each
  // grid panel doesn't mount its own copy.
  const resize = useScheduleResize();
  const resizeApi = useMemo<ScheduleResizeAPI>(
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
          event?: InternalScheduleEvent;
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
            event?: InternalScheduleEvent;
            task?: { id: string; duration: number; teamMemberIds?: string[] };
          }
        | undefined;
      const overData = over.data?.current as
        | {
            type?: string;
            day?: Date;
            teamMemberId?: string;
            startDate?: Date;
            daysShown?: number;
            gridWidth?: number;
          }
        | undefined;
      if (!activeData?.type) return;

      // Recurrence-aware dispatcher — hoisted above the per-target
      // routing so crew-row handlers can use it for series tasks.
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
                toast.error(t("toast.moveRecurringFailed"), {
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
              toast.error(t("toast.moveFailed"), { description: err.message }),
          }
        );
      };

      // ── Unscheduled-dock drop (bug cc515384) ─────────────────────────
      //
      // Dragging a SCHEDULED event onto the unscheduled tray clears
      // start_date / end_date / start_time / end_time so the task
      // returns to the unscheduled list. Unscheduled-task or
      // project-drawer-task drags onto the tray are no-ops (they're
      // already unscheduled).
      if (overData?.type === "unscheduled-dock") {
        const eventTypes = new Set([
          "month-event",
          "week-event",
          "day-hourly-event",
          "day-list-event",
          "crew-event",
        ]);
        if (eventTypes.has(activeData.type) && activeData.event) {
          const calEvent = activeData.event;
          await dispatchUpdate(
            calEvent.id,
            {
              startDate: null,
              endDate: null,
              startTime: null,
              endTime: null,
            },
            "Unschedule this occurrence, or the entire series?",
          );
          return;
        }
        return;
      }

      // ── Crew-row drops (bug 1b2942d5) ────────────────────────────────
      //
      // Crew rows live inside the calendar grid but don't expose a
      // single `day` value — the drop position resolves from the
      // horizontal pixel offset relative to the row's grid origin. Route
      // those here BEFORE the `!overData.day` guard so unscheduled-tray
      // and project-drawer drags don't fizzle when the user drops onto
      // a crew swimlane.
      if (
        overData?.type === "crew-row" &&
        overData.teamMemberId &&
        overData.startDate &&
        typeof overData.daysShown === "number" &&
        typeof overData.gridWidth === "number"
      ) {
        const crewStart = overData.startDate;
        const crewDaysShown = overData.daysShown;
        const dayColumnWidth =
          overData.gridWidth > 0 ? overData.gridWidth / crewDaysShown : 0;
        const dayDelta =
          dayColumnWidth > 0 ? Math.round(delta.x / dayColumnWidth) : 0;
        const targetDateClamped = addDays(
          crewStart,
          Math.max(0, Math.min(dayDelta, crewDaysShown - 1)),
        );

        // Unscheduled-task → schedule + auto-assign the crew row's member.
        if (activeData.type === "unscheduled-task" && activeData.task) {
          const task = activeData.task;
          const storedDuration = Math.max(task.duration ?? 1, 1);
          const newEnd = addDays(
            targetDateClamped,
            Math.max(storedDuration - 1, 0),
          );
          updateTask.mutate(
            {
              id: task.id,
              data: {
                startDate: targetDateClamped,
                endDate: newEnd,
                teamMemberIds: [overData.teamMemberId],
              },
            },
            {
              onError: (err) =>
                toast.error(t("toast.scheduleFailed"), {
                  description: err.message,
                }),
            },
          );
          return;
        }

        // Project-drawer-task → same behavior as unscheduled.
        if (activeData.type === "project-drawer-task" && activeData.task) {
          const task = activeData.task;
          const storedDuration = Math.max(task.duration ?? 1, 1);
          const newEnd = addDays(
            targetDateClamped,
            Math.max(storedDuration - 1, 0),
          );
          updateTask.mutate(
            {
              id: task.id,
              data: {
                startDate: targetDateClamped,
                endDate: newEnd,
                teamMemberIds: [overData.teamMemberId],
              },
            },
            {
              onError: (err) =>
                toast.error(t("toast.scheduleFailed"), {
                  description: err.message,
                }),
            },
          );
          return;
        }

        // crew-event drag — intra-crew reschedule + optional re-assign.
        // Preserves event duration; new end = newStart + (oldEnd - oldStart).
        if (activeData.type === "crew-event" && activeData.event) {
          const calEvent = activeData.event;
          const eventStart =
            calEvent.startDate instanceof Date
              ? calEvent.startDate
              : new Date(calEvent.startDate);
          const eventEnd =
            calEvent.endDate instanceof Date
              ? calEvent.endDate
              : new Date(calEvent.endDate);
          const durationDays = differenceInCalendarDays(eventEnd, eventStart);
          const eventDayDelta =
            dayColumnWidth > 0 ? Math.round(delta.x / dayColumnWidth) : 0;
          const newStart = addDays(eventStart, eventDayDelta);
          const newEnd = addDays(newStart, durationDays);

          const memberChanged =
            calEvent.teamMemberIds.length !== 1 ||
            calEvent.teamMemberIds[0] !== overData.teamMemberId;
          const dateUnchanged =
            newStart.getTime() === eventStart.getTime() &&
            newEnd.getTime() === eventEnd.getTime();
          if (dateUnchanged && !memberChanged) return;

          const patch: Partial<ProjectTask> = {
            startDate: newStart,
            endDate: newEnd,
          };
          if (memberChanged) {
            patch.teamMemberIds = [overData.teamMemberId];
          }
          await dispatchUpdate(
            calEvent.id,
            patch,
            "Move this occurrence, or shift the entire series?",
          );
          return;
        }
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
          toast.error(t("toast.moveOutsideHours"), {
            description: t("grid.errorResizeOutsideHoursDescription", {
              first: FIRST_HOUR,
              last: LAST_HOUR,
            }),
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
      // duration is the inclusive day count (1 = single calendar day,
      // 2 = two consecutive days, etc). Calendar surfaces treat
      // endDate === startDate as single-day, so endDate must land
      // (duration - 1) days after the start, never duration. The earlier
      // formula scheduled a 1-day task as a 2-day span (May 7 → May 8).
      if (activeData.type === "unscheduled-task" && activeData.task) {
        const task = activeData.task;
        const duration = Math.max(task.duration ?? 1, 1);
        const newStart = targetDay;
        const newEnd = addDays(newStart, Math.max(duration - 1, 0));
        updateTask.mutate(
          { id: task.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error(t("toast.scheduleFailed"), {
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
        const newEnd = addDays(newStart, Math.max(duration - 1, 0));
        updateTask.mutate(
          { id: task.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error(t("toast.scheduleFailed"), {
                description: err.message,
              }),
          }
        );
        return;
      }
    },
    [tasksById, updateTask, recurrenceEdit, recurrencePrompt, t]
  );

  const dragState = useMemo<ScheduleDragState>(
    () => ({
      isDragging: activeDrag !== null,
      activeType: activeDrag?.type ?? null,
    }),
    [activeDrag]
  );

  return (
    <DragStateContext.Provider value={dragState}>
      <ScheduleResizeContext.Provider value={resizeApi}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          autoScroll={{
            // Tight edge zone (~5% of axis = ~40-60px on typical layouts).
            // dnd-kit walks up to scrollable ancestors and scrolls them when
            // the pointer enters the threshold band. Each scroll container
            // toggles off scroll-snap during drag (see useScheduleDragState),
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
      </ScheduleResizeContext.Provider>
    </DragStateContext.Provider>
  );
}

// ─── Drag preview ───────────────────────────────────────────────────────────

function DragPreview({ event }: { event: InternalScheduleEvent }) {
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
