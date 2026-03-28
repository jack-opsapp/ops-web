"use client";

import { useMemo, useCallback, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";

// ── Props ──────────────────────────────────────────────────────────────────

interface DayPersonalEventCardProps {
  event: InternalCalendarEvent;
  index: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function DayPersonalEventCard({ event, index }: DayPersonalEventCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useCalendarStore((s) => s.setSidePanelTask);

  // ── Time formatting ───────────────────────────────────────────────────

  const timeRange = useMemo(() => {
    const start = format(event.startDate, "h:mmaaa");
    const end = format(event.endDate, "h:mmaaa");
    return `${start} - ${end}`;
  }, [event.startDate, event.endDate]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    setSidePanelTask(event.id);
  }, [event.id, setSidePanelTask]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: "easeOut", delay: index * 0.06 }}
      className="cursor-pointer"
      style={{
        minHeight: 52,
        borderRadius: 2,
        background: "#0D0D0D",
        border: `1px dashed rgba(255, 255, 255, ${isHovered ? 0.35 : 0.25})`,
        padding: "14px 16px",
        transition: "border-color 0.15s ease-out",
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Line 1: Title + PERSONAL badge */}
      <div className="flex items-center justify-between min-w-0">
        <span
          className="font-mohave font-semibold text-[15px] uppercase truncate leading-tight"
          style={{ color: "#FFFFFF" }}
        >
          {event.title}
        </span>

        {/* PERSONAL badge */}
        <div
          className="shrink-0 flex items-center px-[6px] py-[2px] font-kosugi text-[9px] uppercase tracking-wider leading-tight ml-[8px]"
          style={{
            color: "#999999",
            borderRadius: 2,
            border: "1px dashed rgba(255, 255, 255, 0.25)",
          }}
        >
          PERSONAL
        </div>
      </div>

      {/* Line 2: Time range */}
      <div className="mt-[4px]">
        <span
          className="font-kosugi text-[11px] leading-tight"
          style={{ color: "rgba(255, 255, 255, 0.45)" }}
        >
          {timeRange}
        </span>
      </div>
    </motion.div>
  );
}
