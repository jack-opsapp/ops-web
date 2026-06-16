"use client";

import { useMemo, useCallback, useState } from "react";
import { format } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import { useScheduleStore } from "@/stores/schedule-store";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// ── Props ──────────────────────────────────────────────────────────────────

interface DayPersonalEventCardProps {
  event: InternalScheduleEvent;
  index: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function DayPersonalEventCard({ event, index }: DayPersonalEventCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useScheduleStore((s) => s.setSidePanelTask);
  const reducedMotion = useReducedMotion();

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
      initial={reducedMotion ? { opacity: 0 } : { y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: reducedMotion ? 0.15 : 0.22,
        ease: EASE_SMOOTH,
        delay: reducedMotion ? 0 : index * 0.06,
      }}
      className="cursor-pointer"
      style={{
        minHeight: 52,
        borderRadius: 2,
        background: "#0D0D0D",
        border: `1px dashed rgba(255, 255, 255, ${isHovered ? 0.35 : 0.25})`,
        padding: "14px 16px",
        transition: "border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Line 1: Title + PERSONAL badge */}
      <div className="flex items-center justify-between min-w-0">
        <span
          className="font-cakemono font-light text-[15px] uppercase truncate leading-tight"
          style={{ color: "#FFFFFF" }}
        >
          {event.title}
        </span>

        {/* PERSONAL badge */}
        <div
          className="shrink-0 flex items-center px-[6px] py-[2px] font-mono text-micro uppercase tracking-[0.16em] leading-tight ml-[8px]"
          style={{
            color: "var(--text-3)",
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
          className="font-mono text-[11px] leading-tight"
          style={{ color: "rgba(255, 255, 255, 0.45)" }}
        >
          {timeRange}
        </span>
      </div>
    </motion.div>
  );
}
