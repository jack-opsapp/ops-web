"use client";

/**
 * DayHourlyGrid — Phase 3
 *
 * The Day view's timed-mode layout. Renders an hourly column from
 * FIRST_HOUR (6 AM) to LAST_HOUR (10 PM, exclusive) and absolutely positions
 * timed events by their start_time / end_time. All-day events live in a
 * fixed-height strip above the hourly grid (so users can still see them
 * without losing context).
 *
 * Drag = reschedule. Vertical movement maps to 15-min snapping via
 * `snapToGrid()`. Top / bottom resize handles edit the start_time and
 * end_time respectively. Series tasks open the recurrence prompt before
 * applying the change.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useDraggable } from "@dnd-kit/core";
import { toast } from "sonner";
import { useUpdateTask, useTasks, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
import {
  HOURS,
  HOUR_HEIGHT,
  FIRST_HOUR,
} from "@/lib/utils/calendar-constants";
import {
  formatHour,
  getEventTopOffset,
  getEventHeight,
  resolveEventColumns,
  type InternalCalendarEvent,
} from "@/lib/utils/calendar-utils";
import { useTeamMembers } from "@/lib/hooks";
import type { ProjectTask } from "@/lib/types/models";
import { UserAvatar } from "@/components/ops/user-avatar";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SNAP_MINUTES = 15;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const SNAP_PX = SNAP_MINUTES * PX_PER_MINUTE;

function snapPx(px: number): number {
  return Math.round(px / SNAP_PX) * SNAP_PX;
}

function formatTimeHHmm(d: Date): string {
  return format(d, "HH:mm");
}

// ─── Timed task block ───────────────────────────────────────────────────────

interface TimedBlockProps {
  event: InternalCalendarEvent;
  columnIndex: number;
  totalColumns: number;
  onClick: (event: InternalCalendarEvent) => void;
  onResize: (
    event: InternalCalendarEvent,
    edge: "top" | "bottom",
    deltaMinutes: number
  ) => void;
}

function TimedBlock({
  event,
  columnIndex,
  totalColumns,
  onClick,
  onResize,
}: TimedBlockProps) {
  const { data: teamData } = useTeamMembers();
  const allUsers = teamData?.users ?? [];

  const visibleCrew = useMemo(() => {
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    return event.crewIds
      .map((id) => userMap.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .slice(0, 3);
  }, [event.crewIds, allUsers]);

  // Status guard — completed / cancelled events are display-only (matches
  // the iOS rule where status badge replaces interactive affordances).
  const locked =
    event.statusKey === "completed" || event.statusKey === "cancelled";

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `day-hourly-event-${event.id}`,
      data: { type: "day-hourly-event", event },
      disabled: locked,
    });

  // Resize state — pixel delta tracked locally; committed on mouseup.
  const [resize, setResize] = useState<{
    edge: "top" | "bottom";
    initialY: number;
    deltaPx: number;
  } | null>(null);
  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  const top = getEventTopOffset(event.startDate);
  const baseHeight = getEventHeight(event.startDate, event.endDate);
  const widthPercent = 100 / Math.max(totalColumns, 1);
  const leftPercent = columnIndex * widthPercent;

  // Apply resize preview adjustments
  let displayTop = top;
  let displayHeight = baseHeight;
  if (resize) {
    const snappedDelta = snapPx(resize.deltaPx);
    if (resize.edge === "top") {
      displayTop = top + snappedDelta;
      displayHeight = Math.max(baseHeight - snappedDelta, SNAP_PX);
    } else {
      displayHeight = Math.max(baseHeight + snappedDelta, SNAP_PX);
    }
  }

  // Apply drag preview
  let dragTransform = "";
  if (transform) {
    const snappedY = snapPx(transform.y);
    dragTransform = `translate3d(0, ${snappedY}px, 0)`;
  }

  const handleResizeStart = useCallback(
    (edge: "top" | "bottom", e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const initialY = e.clientY;
      setResize({ edge, initialY, deltaPx: 0 });

      const onMouseMove = (mv: MouseEvent) => {
        setResize((prev) =>
          prev ? { ...prev, deltaPx: mv.clientY - initialY } : null
        );
      };
      const onMouseUp = () => {
        const state = resizeRef.current;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setResize(null);
        if (!state) return;
        const snapped = snapPx(state.deltaPx);
        const minutes = Math.round(snapped / PX_PER_MINUTE);
        if (minutes !== 0) {
          onResize(event, state.edge, minutes);
        }
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [event, onResize]
  );

  // Drag end is handled by the parent's DragEndEvent — pixel delta is
  // converted to minutes there and dispatched through the series-aware
  // mutation path.

  return (
    <motion.div
      ref={setNodeRef}
      data-task-id={event.id}
      onClick={(e) => {
        if (isDragging || resize) return;
        e.stopPropagation();
        onClick(event);
      }}
      className="absolute cursor-pointer"
      style={{
        left: `${leftPercent}%`,
        width: `calc(${widthPercent}% - 4px)`,
        top: displayTop,
        height: displayHeight,
        transform: dragTransform,
        opacity: isDragging ? 0.6 : resize ? 0.85 : 1,
        background: event.statusColors.bg,
        border: `1px solid ${event.statusColors.border}`,
        borderRadius: 4,
        zIndex: isDragging ? 30 : resize ? 20 : 5,
      }}
      {...attributes}
      {...listeners}
    >
      {/* Type stripe (left edge) */}
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

      {/* Top resize handle — hidden for locked events */}
      {!locked && (
        <div
          onMouseDown={(e) => handleResizeStart("top", e)}
          className="absolute left-0 right-0 top-0 z-10"
          style={{ height: 6, cursor: "ns-resize" }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Resize event start"
          role="separator"
        />
      )}

      {/* Bottom resize handle — hidden for locked events */}
      {!locked && (
        <div
          onMouseDown={(e) => handleResizeStart("bottom", e)}
          className="absolute left-0 right-0 bottom-0 z-10"
          style={{ height: 6, cursor: "ns-resize" }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Resize event end"
          role="separator"
        />
      )}

      {/* Body */}
      <div
        className="flex flex-col gap-[2px] min-w-0"
        style={{ padding: "6px 8px 6px 12px", overflow: "hidden" }}
      >
        <span
          className="font-cakemono font-light text-[12px] uppercase truncate leading-tight"
          style={{
            color: "var(--text)",
            letterSpacing: "0.02em",
          }}
        >
          {event.projectTitle ?? event.taskTitle}
        </span>
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{
            color: "var(--text-3)",
            fontFeatureSettings: '"tnum" 1, "zero" 1',
          }}
        >
          {`${formatTimeHHmm(event.startDate)} → ${formatTimeHHmm(event.endDate)}`}
        </span>
        {visibleCrew.length > 0 && (
          <div className="flex items-center -space-x-[6px] mt-[2px]">
            {visibleCrew.map((u) => (
              <UserAvatar
                key={u.id}
                name={`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || (u.email ?? "?")}
                imageUrl={u.profileImageURL}
                size="sm"
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── All-day strip ──────────────────────────────────────────────────────────

function AllDayStrip({
  events,
  onClick,
}: {
  events: InternalCalendarEvent[];
  onClick: (event: InternalCalendarEvent) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div
      className="shrink-0 px-[16px] py-[8px] flex flex-wrap gap-[4px]"
      style={{
        borderBottom: "1px solid var(--line)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <span
        className="font-mono text-micro uppercase tracking-wider mr-[4px] self-center"
        style={{ color: "var(--text-mute)" }}
      >
        // ALL-DAY
      </span>
      {events.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => onClick(event)}
          className="px-[8px] py-[3px] rounded-[4px] font-mohave text-[12px] truncate"
          style={{
            maxWidth: 240,
            background: event.statusColors.bg,
            border: `1px solid ${event.statusColors.border}`,
            color: "var(--text)",
          }}
        >
          {event.projectTitle ?? event.taskTitle}
        </button>
      ))}
    </div>
  );
}

// ─── Grid ───────────────────────────────────────────────────────────────────

interface DayHourlyGridProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onEventClick: (event: InternalCalendarEvent) => void;
}

export function DayHourlyGrid({
  currentDate,
  events,
  onEventClick,
}: DayHourlyGridProps) {
  const updateTask = useUpdateTask();
  const recurrenceEdit = useRecurrenceEdit();
  const recurrencePrompt = useRecurrenceEditPrompt();
  const { data: taskData } = useTasks();
  const tasksById = useMemo(() => {
    const map = new Map<string, ProjectTask>();
    for (const t of taskData?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [taskData]);

  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  const columns = useMemo(() => resolveEventColumns(timed), [timed]);

  const handleResize = useCallback(
    async (
      event: InternalCalendarEvent,
      edge: "top" | "bottom",
      deltaMinutes: number
    ) => {
      if (deltaMinutes === 0) return;
      let newStart = event.startDate;
      let newEnd = event.endDate;
      if (edge === "top") {
        newStart = new Date(newStart.getTime() + deltaMinutes * 60_000);
      } else {
        newEnd = new Date(newEnd.getTime() + deltaMinutes * 60_000);
      }
      // Guard: ensure end > start with at least 15-min gap.
      if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60_000) {
        return;
      }
      const patch: Partial<ProjectTask> = {
        startDate: newStart,
        endDate: newEnd,
        startTime: `${formatTimeHHmm(newStart)}:00`,
        endTime: `${formatTimeHHmm(newEnd)}:00`,
      };
      const sourceTask = tasksById.get(event.id);
      if (sourceTask?.recurrenceId) {
        const scope = await recurrencePrompt.request({
          description: "Resize this occurrence, or the entire series?",
        });
        if (!scope) return;
        recurrenceEdit.mutate(
          { task: sourceTask, scope, patch },
          {
            onError: (err) =>
              toast.error("Failed to resize recurring task", {
                description: err.message,
              }),
          }
        );
        return;
      }
      updateTask.mutate(
        { id: event.id, data: patch },
        {
          onError: (err) =>
            toast.error("Failed to resize task", { description: err.message }),
        }
      );
    },
    [tasksById, updateTask, recurrenceEdit, recurrencePrompt]
  );

  // Empty state
  if (timed.length === 0 && allDay.length === 0) {
    return (
      <div className="flex items-center justify-start pt-[48px] px-[16px]">
        <span
          className="font-mono text-[12px] uppercase tracking-wider"
          style={{ color: "rgba(255, 255, 255, 0.30)" }}
        >
          NO TASKS SCHEDULED
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AllDayStrip events={allDay} onClick={onEventClick} />

      <div className="flex-1 overflow-y-auto">
        <div
          className="relative"
          style={{ height: HOURS.length * HOUR_HEIGHT }}
        >
          {/* Hour rows */}
          {HOURS.map((hour, i) => (
            <div
              key={hour}
              className="absolute left-0 right-0 flex"
              style={{
                top: i * HOUR_HEIGHT,
                height: HOUR_HEIGHT,
                borderTop: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span
                className="font-mono text-[10px] uppercase tabular-nums shrink-0"
                style={{
                  color: "var(--text-mute)",
                  width: 56,
                  paddingLeft: 8,
                  paddingTop: 2,
                  fontFeatureSettings: '"tnum" 1, "zero" 1',
                }}
              >
                {formatHour(hour)}
              </span>
              {/* 15-min grid lines */}
              <div className="flex-1 relative">
                {[1, 2, 3].map((q) => (
                  <div
                    key={q}
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: (HOUR_HEIGHT / 4) * q,
                      borderTop: "1px dashed rgba(255,255,255,0.03)",
                    }}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Event blocks layer */}
          <div
            className="absolute"
            style={{
              left: 56,
              right: 8,
              top: -((FIRST_HOUR) * HOUR_HEIGHT) + (FIRST_HOUR) * HOUR_HEIGHT, // 0
              bottom: 0,
            }}
          >
            {columns.map(({ event, columnIndex, totalColumns }) => (
              <TimedBlock
                key={event.id}
                event={event}
                columnIndex={columnIndex}
                totalColumns={totalColumns}
                onClick={onEventClick}
                onResize={handleResize}
              />
            ))}
          </div>
        </div>
      </div>

      {recurrencePrompt.promptElement}
    </div>
  );
}

