"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";

// `ScheduleStrip` — compact `[ start ]══●══════[ end ]` strip below the map.
// Fills the [start, today] slice with the status hex (12% alpha) so the strip
// reads as "this is how much of the project has elapsed." A 2px today-tick
// sits where today falls on the [start, end] axis.
//
// Today-tick glow (status-tinted radial bloom around the tick):
//   - ONLY when status === InProgress — outside InProgress the schedule is
//     either pre-flight (RFQ / Estimated / Accepted), wrapped (Completed /
//     Closed / Archived), or quote-only — none of those are "the clock is
//     ticking" emotional beats. The glow is reserved for the one state where
//     today's position on the timeline is operationally relevant.
//   - Suppressed under prefers-reduced-motion (vestibular-safety + pulse is
//     opacity-only on a small element so the WCAG bar is met either way).
//
// Pulse cadence matches `ModePill.editing`: 1.6s · opacity 1 → 0.5 → 1 ·
// EASE_SMOOTH · infinite. Compositor-only (opacity), no transform.

interface ScheduleStripProps {
  startDate: Date | null;
  endDate: Date | null;
  status: ProjectStatus;
  className?: string;
}

const PULSE_KEYFRAMES = { opacity: [1, 0.5, 1] };
const PULSE_TRANSITION = { duration: 1.6, repeat: Infinity, ease: EASE_SMOOTH } as const;

function formatStripDate(d: Date | null): string {
  if (!d) return "—";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

// Strip the time portion so today / start / end all live in the same daily
// quantization — fixes the "today is 0.7% past start" off-by-an-hour drift
// when project.startDate is midnight UTC and the user is in a non-UTC tz.
function dayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function ScheduleStrip({
  startDate,
  endDate,
  status,
  className,
}: ScheduleStripProps) {
  const reducedMotion = useReducedMotion();
  const statusColor = PROJECT_STATUS_COLORS[status];
  const todayMs = dayMs(new Date());

  const todayPct = React.useMemo<number | null>(() => {
    if (!startDate || !endDate) return null;
    const startTs = dayMs(startDate);
    const endTs = dayMs(endDate);
    if (endTs <= startTs) return null;
    if (todayMs < startTs || todayMs > endTs) return null;
    return (todayMs - startTs) / (endTs - startTs);
  }, [startDate, endDate, todayMs]);

  const showGlow =
    status === ProjectStatus.InProgress && !reducedMotion && todayPct !== null;
  const tickLeft =
    todayPct === null ? null : `${(todayPct * 100).toFixed(2)}%`;

  return (
    <div
      data-testid="schedule-strip"
      data-status={status}
      data-glow={String(showGlow)}
      className={cn(
        "flex items-center gap-3 px-4 py-2",
        "border-b border-glass-border bg-[var(--scrim-strip-bg)]",
        className,
      )}
    >
      <Mono color="text-3" size={10}>
        {formatStripDate(startDate)}
      </Mono>
      <div className="relative flex-1 h-[6px] rounded-bar bg-[var(--fill-neutral-dim)]">
        {tickLeft !== null && (
          <div
            data-testid="schedule-strip-fill"
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded-bar"
            style={{ width: tickLeft, background: `${statusColor}33` }}
          />
        )}
        {tickLeft !== null && (
          <div
            data-testid="schedule-strip-tick"
            aria-hidden="true"
            className="absolute -top-1 -bottom-1 w-[2px] -translate-x-1/2"
            style={{ left: tickLeft, background: statusColor }}
          >
            {showGlow && (
              <motion.span
                data-testid="schedule-strip-glow"
                animate={PULSE_KEYFRAMES}
                transition={PULSE_TRANSITION}
                className="absolute -inset-2 rounded-full"
                style={{ background: `${statusColor}55`, filter: "blur(4px)" }}
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>
      <Mono color="text-3" size={10}>
        {formatStripDate(endDate)}
      </Mono>
    </div>
  );
}
