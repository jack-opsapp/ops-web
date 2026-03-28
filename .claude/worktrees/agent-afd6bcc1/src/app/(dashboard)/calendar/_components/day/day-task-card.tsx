"use client";

import { useMemo, useCallback, useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { motion } from "framer-motion";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { getEventColors } from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface DayTaskCardProps {
  event: InternalCalendarEvent;
  index: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function DayTaskCard({ event, index }: DayTaskCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useCalendarStore((s) => s.setSidePanelTask);
  const setInlineEdit = useCalendarStore((s) => s.setInlineEdit);

  // ── Color computation ─────────────────────────────────────────────────

  const colors = useMemo(() => getEventColors(event.taskType), [event.taskType]);
  const rgb = useMemo(() => hexToRgb(colors.border), [colors.border]);
  const rgbStr = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : "89, 119, 159";

  // ── Multi-day detection ───────────────────────────────────────────────

  const multiDayInfo = useMemo(() => {
    const totalDays = differenceInCalendarDays(event.endDate, event.startDate);
    if (totalDays <= 1) return null;

    const dayOfTask = differenceInCalendarDays(new Date(), event.startDate) + 1;
    const clampedDay = Math.max(1, Math.min(dayOfTask, totalDays));
    return { current: clampedDay, total: totalDays };
  }, [event.startDate, event.endDate]);

  // ── Time formatting ───────────────────────────────────────────────────

  const timeRange = useMemo(() => {
    if (multiDayInfo) return null;
    const start = format(event.startDate, "h:mmaaa");
    const end = format(event.endDate, "h:mmaaa");
    return `${start} - ${end}`;
  }, [event.startDate, event.endDate, multiDayInfo]);

  // ── Labels ────────────────────────────────────────────────────────────

  const projectName = event.title;
  const clientName = event.project ?? null;
  const taskTypeLabel = event.taskType.toUpperCase();

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    setSidePanelTask(event.id);
  }, [event.id, setSidePanelTask]);

  const handleDoubleClick = useCallback(() => {
    setInlineEdit({ taskId: event.id, field: "title" });
  }, [event.id, setInlineEdit]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: "easeOut", delay: index * 0.06 }}
      className="cursor-pointer"
      style={{
        display: "flex",
        minHeight: 64,
        borderRadius: 2,
        overflow: "hidden",
        border: `1px solid rgba(255, 255, 255, ${isHovered ? 0.2 : 0.1})`,
        transition: "border-color 0.15s ease-out",
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Left color stripe */}
      <div
        className="shrink-0"
        style={{
          width: 4,
          background: colors.border,
        }}
      />

      {/* Card body */}
      <div
        className="flex-1 flex flex-col justify-center min-w-0"
        style={{
          background: "#141414",
          padding: "14px 16px",
        }}
      >
        {/* Line 1: Project name + Client */}
        <div className="flex items-center gap-[6px] min-w-0">
          <span
            className="font-mohave font-semibold text-[15px] uppercase truncate leading-tight"
            style={{ color: "#FFFFFF" }}
          >
            {projectName}
          </span>
          {clientName && (
            <>
              <span
                className="font-kosugi text-[12px] shrink-0"
                style={{ color: "#666666" }}
              >
                ·
              </span>
              <span
                className="font-kosugi text-[12px] truncate leading-tight"
                style={{ color: "#999999" }}
              >
                {clientName}
              </span>
            </>
          )}
        </div>

        {/* Line 2: Address (placeholder) + Task type badge */}
        <div className="flex items-center justify-between mt-[4px] min-w-0">
          <span
            className="font-kosugi text-[11px] truncate leading-tight"
            style={{ color: "rgba(255, 255, 255, 0.45)" }}
          >
            {/* Address placeholder — will display when address data is available */}
          </span>

          {/* Task type badge */}
          <div
            className="shrink-0 flex items-center px-[6px] py-[2px] font-kosugi text-[9px] uppercase tracking-wider leading-tight ml-[8px]"
            style={{
              color: colors.text,
              background: `rgba(${rgbStr}, 0.12)`,
              border: `1px solid rgba(${rgbStr}, 0.35)`,
              borderRadius: 2,
            }}
          >
            {taskTypeLabel}
          </div>
        </div>

        {/* Line 3: Team members + Time range / Multi-day indicator */}
        <div className="flex items-center justify-between mt-[4px] min-w-0">
          <span
            className="font-kosugi text-[11px] truncate leading-tight"
            style={{ color: "#999999" }}
          >
            {event.teamMember ?? (event.teamMemberIds.length > 0
              ? `${event.teamMemberIds.length} member${event.teamMemberIds.length !== 1 ? "s" : ""}`
              : "")}
          </span>
          <span
            className="font-kosugi text-[11px] shrink-0 leading-tight"
            style={{ color: "rgba(255, 255, 255, 0.45)" }}
          >
            {multiDayInfo
              ? `Day ${multiDayInfo.current} of ${multiDayInfo.total}`
              : timeRange}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
