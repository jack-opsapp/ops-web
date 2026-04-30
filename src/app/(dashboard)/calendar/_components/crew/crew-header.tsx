"use client";

import { format, addDays, isToday, isWeekend } from "date-fns";
import {
  CREW_HEADER_HEIGHT,
  CREW_GUTTER_WIDTH,
  CREW_DAY_MIN_WIDTH,
} from "@/lib/utils/crew-constants";

// ─── Props ──────────────────────────────────────────────────────────────────

interface CrewHeaderProps {
  startDate: Date;
  daysShown: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CrewHeader({ startDate, daysShown }: CrewHeaderProps) {
  const days = Array.from({ length: daysShown }, (_, i) => addDays(startDate, i));

  return (
    <div
      className="flex shrink-0 border-b"
      style={{
        height: CREW_HEADER_HEIGHT,
        borderColor: "var(--line)",
      }}
    >
      {/* Left gutter — "// CREW" label */}
      <div
        className="shrink-0 flex items-center px-[12px]"
        style={{
          width: CREW_GUTTER_WIDTH,
          borderRight: "1px solid var(--line)",
        }}
      >
        <span
          className="font-mono text-micro uppercase tracking-wider"
          style={{ color: "var(--text-2)" }}
        >
          {"// CREW"}
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
              className="relative flex flex-col justify-center px-[8px] min-w-0"
              style={{
                // 1 1 0% allows shrinking so all 7 days fit on narrow viewports
                // without horizontal overflow.
                flex: "1 1 0%",
                opacity: weekend ? 0.6 : 1,
                background: today
                  ? "linear-gradient(rgba(111, 148, 176, 0.22), rgba(111, 148, 176, 0.22)), rgba(18, 18, 20, 0.78)"
                  : "transparent",
                backdropFilter: today ? "blur(28px) saturate(1.3)" : undefined,
                WebkitBackdropFilter: today
                  ? "blur(28px) saturate(1.3)"
                  : undefined,
                borderTop: today ? "2px solid var(--ops-accent)" : "2px solid transparent",
              }}
            >
              <span
                className="font-mono text-micro uppercase tracking-wider"
                style={{ color: "var(--text-3)" }}
              >
                {format(day, "EEE")}
              </span>

              {/* Day number — today gets a 24x24 accent square (T14 — signal #1) */}
              {today ? (
                <span
                  className="inline-flex items-center justify-center font-cakemono font-light"
                  style={{
                    width: 24,
                    height: 24,
                    background: "var(--ops-accent)",
                    color: "#000",
                    fontSize: 13,
                    borderRadius: 4,
                    letterSpacing: 0,
                  }}
                >
                  {format(day, "d")}
                </span>
              ) : (
                <span
                  className="font-cakemono font-light leading-tight"
                  style={{ fontSize: 16, color: "var(--text)" }}
                >
                  {format(day, "d")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
