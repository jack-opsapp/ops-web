"use client";

import { format, addDays, isToday, isWeekend } from "date-fns";
import {
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_GUTTER_WIDTH,
  TIMELINE_DAY_MIN_WIDTH,
} from "@/lib/utils/timeline-constants";

// ─── Props ──────────────────────────────────────────────────────────────────

interface TimelineHeaderProps {
  startDate: Date;
  daysShown: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TimelineHeader({ startDate, daysShown }: TimelineHeaderProps) {
  const days = Array.from({ length: daysShown }, (_, i) => addDays(startDate, i));

  return (
    <div
      className="flex shrink-0 border-b"
      style={{
        height: TIMELINE_HEADER_HEIGHT,
        borderColor: "rgba(255,255,255,0.10)",
      }}
    >
      {/* Left gutter — "TEAM" label */}
      <div
        className="shrink-0 flex items-center px-[12px]"
        style={{
          width: TIMELINE_GUTTER_WIDTH,
          borderRight: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <span className="font-kosugi text-[10px] uppercase tracking-wider text-text-secondary">
          Team
        </span>
      </div>

      {/* Day columns */}
      <div className="flex flex-1 min-w-0">
        {days.map((day) => {
          const today = isToday(day);
          const weekend = isWeekend(day);

          return (
            <div
              key={day.toISOString()}
              className="flex flex-col justify-center px-[12px]"
              style={{
                flex: "1 0 0",
                minWidth: TIMELINE_DAY_MIN_WIDTH,
                background: today ? "rgba(89,119,148,0.08)" : "transparent",
                opacity: weekend ? 0.5 : 1,
              }}
            >
              <span className="font-kosugi text-[10px] uppercase tracking-wider text-text-secondary">
                {format(day, "EEE")}
              </span>
              <span className="font-mohave font-semibold text-[16px] leading-tight text-text-primary">
                {format(day, "d")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
