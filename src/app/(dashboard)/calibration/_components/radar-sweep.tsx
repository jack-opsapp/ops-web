"use client";

/**
 * RadarSweep — the signature visual of CALIBRATION.
 *
 * A 16px radar scope with a rotating sweep arm, living in the bottom-right
 * corner of every tile. Pure CSS animation, paused when off-screen via
 * Intersection Observer, accelerated on hover via CSS selector.
 *
 * States:
 *   - "nominal"    — olive sweep, idle cycle
 *   - "running"    — tan sweep, faster cycle
 *   - "error"      — rose sweep, faster cycle
 *   - "empty"      — text-mute sweep, idle cycle
 *   - "unlocked"   — accent sweep, one-beat pulse (used for MILESTONES)
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

export type RadarSweepState =
  | "nominal"
  | "running"
  | "error"
  | "empty"
  | "unlocked";

const STATE_COLOR: Record<RadarSweepState, string> = {
  nominal: "#9DB582", // olive
  running: "#C4A868", // tan
  error: "#B58289", // rose
  empty: "#6A6A6A", // text-mute
  unlocked: "#6F94B0", // accent
};

interface RadarSweepProps {
  state: RadarSweepState;
  className?: string;
  /** px size. Defaults to 16. */
  size?: number;
}

export function RadarSweep({ state, className, size = 16 }: RadarSweepProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const color = STATE_COLOR[state];

  // Pause off-screen via Intersection Observer so off-viewport tiles
  // don't eat CPU in background tabs.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const arm = el.querySelector<SVGElement>("[data-sweep-arm]");
    if (!arm) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        arm.style.animationPlayState = entry.isIntersecting
          ? "running"
          : "paused";
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn("cal-radar-sweep", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="cal-radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="70%" stopColor="transparent" />
          </radialGradient>
          <linearGradient
            id={`cal-radar-fade-${state}`}
            x1="0"
            x2="1"
            y1="0"
            y2="0"
          >
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="8" cy="8" r="7.5" fill="url(#cal-radar-bg)" />
        <circle
          cx="8"
          cy="8"
          r="4"
          stroke={color}
          strokeOpacity="0.3"
          strokeWidth="0.5"
          fill="none"
        />
        <circle
          cx="8"
          cy="8"
          r="7"
          stroke={color}
          strokeOpacity="0.3"
          strokeWidth="0.5"
          fill="none"
        />
        <g data-sweep-arm className="cal-radar-sweep__arm">
          <line x1="8" y1="8" x2="8" y2="1" stroke={color} strokeWidth="1" />
          <path
            d="M 8,8 L 8,1 A 7,7 0 0 1 14.06,5.5 Z"
            fill={`url(#cal-radar-fade-${state})`}
          />
        </g>
      </svg>
    </div>
  );
}
