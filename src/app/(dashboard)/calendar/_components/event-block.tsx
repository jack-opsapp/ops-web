"use client";

import { useState, useCallback, useRef } from "react";
import { User } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { addMinutes } from "date-fns";
import { cn } from "@/lib/utils/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HOUR_HEIGHT } from "@/lib/utils/calendar-constants";
import {
  type InternalCalendarEvent,
  getEventColors,
  formatTime24,
  getEventTopOffset,
  getEventHeight,
  snapToGrid,
} from "@/lib/utils/calendar-utils";
import { EventTooltipContent } from "./event-tooltip";

interface EventBlockProps {
  event: InternalCalendarEvent;
  showFullDetail?: boolean;
  onClick?: (event: InternalCalendarEvent) => void;
  onContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
  onResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
  /** Column positioning for overlap resolution */
  columnIndex?: number;
  totalColumns?: number;
  /** Whether this event has a scheduling conflict */
  hasConflict?: boolean;
  /** Whether this event is currently focused/selected via keyboard */
  isSelected?: boolean;
}

export function EventBlock({
  event,
  showFullDetail,
  onClick,
  onContextMenu,
  onResize,
  columnIndex = 0,
  totalColumns = 1,
  hasConflict,
  isSelected,
}: EventBlockProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: event.id,
      data: { event },
    });

  const colors = getEventColors(event.taskType);
  const top = getEventTopOffset(event.startDate);
  const baseHeight = getEventHeight(event.startDate, event.endDate);

  // Resize state
  const [resizeDeltaY, setResizeDeltaY] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);

  const height = baseHeight + resizeDeltaY;
  const isShort = height < 40;

  // Calculate width and left offset for overlapping events
  const widthPercent = 100 / totalColumns;
  const leftPercent = columnIndex * widthPercent;

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStartY.current = e.clientY;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - resizeStartY.current;
        // Snap to 15-min increments (HOUR_HEIGHT / 4)
        const snapSize = HOUR_HEIGHT / 4;
        const snappedDelta = Math.round(delta / snapSize) * snapSize;
        // Minimum height: 15 minutes
        const minHeight = snapSize;
        if (baseHeight + snappedDelta >= minHeight) {
          setResizeDeltaY(snappedDelta);
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setIsResizing(false);

        const delta = upEvent.clientY - resizeStartY.current;
        const snapSize = HOUR_HEIGHT / 4;
        const snappedDelta = Math.round(delta / snapSize) * snapSize;
        const deltaMinutes = (snappedDelta / HOUR_HEIGHT) * 60;

        setResizeDeltaY(0);

        if (deltaMinutes !== 0 && onResize) {
          const newEnd = snapToGrid(addMinutes(event.endDate, deltaMinutes));
          if (newEnd > event.startDate) {
            onResize(event, newEnd);
          }
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [baseHeight, event, onResize]
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            data-event-block
            {...(isResizing ? {} : listeners)}
            {...(isResizing ? {} : attributes)}
            className={cn(
              "absolute rounded-sm transition-all duration-100",
              isResizing ? "cursor-ns-resize z-30" : "cursor-grab",
              "hover:brightness-125 hover:shadow-elevated hover:z-30",
              "overflow-hidden",
              isDragging && "opacity-40 border-dashed cursor-grabbing z-40",
              hasConflict && "ring-1 ring-red-500/60 shadow-[0_0_8px_rgba(239,68,68,0.3)]",
              isSelected && !hasConflict && "ring-2 ring-ops-accent shadow-[0_0_8px_rgba(65,115,148,0.3)]"
            )}
            style={{
              top: `${top}px`,
              height: `${height}px`,
              left: totalColumns > 1 ? `${leftPercent}%` : "3px",
              right: totalColumns > 1 ? `${100 - leftPercent - widthPercent}%` : "3px",
              width: totalColumns > 1 ? `${widthPercent}%` : undefined,
              backgroundColor: colors.bg,
              borderLeft: `3px solid ${colors.border}`,
              zIndex: isDragging ? 40 : isResizing ? 35 : 10,
              ...dragStyle,
            }}
            onClick={(e) => {
              if (isResizing) return;
              e.stopPropagation();
              onClick?.(event);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu?.(event, e.clientX, e.clientY);
            }}
          >
            <div className={cn("p-[4px] h-full", isShort && "flex items-center gap-[6px]")}>
              {isShort ? (
                <>
                  <span
                    className="font-mono text-[10px] shrink-0"
                    style={{ color: `${colors.text}99` }}
                  >
                    {formatTime24(event.startDate)}
                  </span>
                  <span
                    className="font-mohave text-[11px] truncate"
                    style={{ color: colors.text }}
                  >
                    {event.title}
                  </span>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-[4px] mb-[2px]">
                    <span
                      className="font-mono text-[10px]"
                      style={{ color: `${colors.text}99` }}
                    >
                      {formatTime24(event.startDate)} - {formatTime24(event.endDate)}
                    </span>
                  </div>
                  <div
                    className="font-mohave text-[12px] leading-tight truncate"
                    style={{ color: colors.text }}
                  >
                    {event.title}
                  </div>
                  {showFullDetail && height >= 70 && (
                    <>
                      {event.project && (
                        <div
                          className="font-mohave text-[11px] mt-[2px] truncate opacity-70"
                          style={{ color: colors.text }}
                        >
                          {event.project}
                        </div>
                      )}
                      {event.teamMember && height >= 90 && (
                        <div className="flex items-center gap-[3px] mt-[3px]">
                          <User
                            className="w-[10px] h-[10px]"
                            style={{ color: `${colors.text}80` }}
                          />
                          <span
                            className="font-kosugi text-[10px]"
                            style={{ color: `${colors.text}99` }}
                          >
                            {event.teamMember}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Bottom-edge resize handle */}
            {onResize && (
              <div
                className={cn(
                  "absolute bottom-0 left-0 right-0 h-[6px] cursor-ns-resize z-20",
                  "group/resize",
                  "hover:bg-white/20",
                  isResizing && "bg-white/30"
                )}
                onMouseDown={handleResizeStart}
              >
                <div
                  className={cn(
                    "absolute bottom-[1px] left-1/2 -translate-x-1/2 w-[20px] h-[2px] rounded-full",
                    "opacity-0 group-hover/resize:opacity-60 transition-opacity",
                    isResizing && "opacity-80"
                  )}
                  style={{ backgroundColor: colors.text }}
                />
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <EventTooltipContent event={event} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
