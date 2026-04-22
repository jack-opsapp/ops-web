"use client";

/**
 * OPS Web — Empty-Status Velocity Section
 *
 * Renders the 14-day classification sparkline + this-week total +
 * delta vs prior week. Consumes useInboxVelocity.
 *
 * Per design system: the sparkline is monochrome; meaning lives in
 * the delta label (rose when falling, olive when climbing, text-2
 * when within ±1%).
 */

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useInboxVelocity } from "@/lib/hooks/use-inbox-velocity";
import { EmptyStatusSparkline } from "./empty-status-sparkline";
import type { InboxScope } from "@/lib/types/email-thread";

export interface EmptyStatusVelocityProps {
  scope: InboxScope;
}

function useCountUp(target: number, duration = 800, disabled = false): number {
  const [value, setValue] = useState<number>(disabled ? target : 0);
  const lastTarget = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) {
      setValue(target);
      return;
    }
    if (lastTarget.current === target) return;
    lastTarget.current = target;

    const start = performance.now();
    const from = 0;
    let frame: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) * (1 - t); // quadratic ease-out
      const current = Math.round(from + (target - from) * eased);
      setValue(current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, disabled]);

  return value;
}

export function EmptyStatusVelocity({ scope }: EmptyStatusVelocityProps) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading, isError } = useInboxVelocity(scope);

  const weekTotal = data?.weekTotal ?? 0;
  const animated = useCountUp(
    weekTotal,
    800,
    !!reduceMotion || isLoading || isError
  );

  const deltaPct = data ? Math.round(data.weekDelta * 100) : 0;
  const deltaAbsPct = Math.abs(deltaPct);
  const deltaDirection: "up" | "down" | "flat" =
    deltaAbsPct < 1 ? "flat" : deltaPct > 0 ? "up" : "down";
  const deltaColor =
    deltaDirection === "up"
      ? "var(--olive, #9DB582)"
      : deltaDirection === "down"
      ? "var(--rose, #B58289)"
      : "var(--text-2, #B5B5B5)";
  const deltaArrow =
    deltaDirection === "up" ? "↑" : deltaDirection === "down" ? "↓" : "·";

  const hasNoActivity =
    data !== undefined && weekTotal === 0 && data.priorWeekTotal === 0;

  return (
    <section className="px-3 py-3 border-b border-[rgba(255,255,255,0.10)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">// </span>CLASSIFIED · LAST 14D
      </p>

      <div className="mt-3">
        {isLoading ? (
          <div
            className="rounded-[5px] animate-pulse bg-[rgba(255,255,255,0.04)]"
            style={{ height: 72 }}
          />
        ) : isError ? (
          <div style={{ height: 72 }} />
        ) : (
          <EmptyStatusSparkline
            values={data?.daily ?? []}
            reanimateKey={scope}
          />
        )}
      </div>

      <div className="mt-2">
        {isError ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            SYS :: VELOCITY UNAVAILABLE
          </p>
        ) : isLoading ? (
          <div className="h-[18px] w-[220px] rounded bg-[rgba(255,255,255,0.04)] animate-pulse" />
        ) : hasNoActivity ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            — NO ACTIVITY
          </p>
        ) : (
          <motion.div
            className="flex items-baseline gap-3"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
          >
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums text-text",
                "[font-feature-settings:'tnum'_1,'zero'_1]"
              )}
            >
              {animated} THIS WEEK
            </span>
            <span
              className="font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums"
              style={{ color: deltaColor }}
            >
              {deltaArrow} {deltaAbsPct}% VS PRIOR
            </span>
          </motion.div>
        )}
      </div>
    </section>
  );
}
