"use client";

/**
 * OPS Web — Sparkline
 *
 * Monochrome 14-day sparkline for the inbox empty-status-view.
 * Per OPS Design System: the line itself is text-2 stroke (no semantic
 * color) — any meaning ("falling" / "climbing") lives in the delta
 * label beside it, never in the line color.
 *
 * Draws in on mount via stroke-dashoffset (400ms, EASE_SMOOTH).
 * Reduced-motion: fades in at 150ms, no draw.
 */

import { useRef, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

/**
 * Convert a sequence of daily counts into an SVG `path` `d` string.
 * Max value → y=0, min value → y=height. When all values are equal
 * (including all-zero), renders a flat line at y = height / 2.
 */
export function buildSparklinePath(
  values: number[],
  width: number,
  height: number
): string {
  if (values.length === 0) return "";

  if (values.length === 1) {
    const y = height / 2;
    return `M 0,${y} L ${width},${y}`;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  const xStep = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * xStep;
    const y = range === 0 ? height / 2 : height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  return `M ${points[0]} ${points.slice(1).map((p) => `L ${p}`).join(" ")}`;
}

export interface EmptyStatusSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  reanimateKey?: string;
}

export function EmptyStatusSparkline({
  values,
  width = 600,
  height = 72,
  reanimateKey,
}: EmptyStatusSparklineProps) {
  const reduceMotion = useReducedMotion();
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState<number>(0);

  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    setPathLength(el.getTotalLength());
  }, [values, reanimateKey]);

  const d = buildSparklinePath(values, width, height);
  if (!d) {
    return (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="No classification activity"
      >
        <line
          x1={0}
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`14-day classification trend, ${values.reduce((a, b) => a + b, 0)} total`}
    >
      <line
        x1={0}
        y1={height - 0.5}
        x2={width}
        y2={height - 0.5}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={1}
      />
      <motion.path
        key={reanimateKey ?? d}
        ref={pathRef}
        d={d}
        fill="none"
        stroke="var(--text-2, #B5B5B5)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={
          reduceMotion
            ? { opacity: 0 }
            : { opacity: 0, strokeDasharray: pathLength, strokeDashoffset: pathLength }
        }
        animate={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: 1, strokeDashoffset: 0 }
        }
        transition={
          reduceMotion
            ? { duration: 0.15 }
            : { duration: 0.4, ease: EASE_SMOOTH }
        }
      />
    </svg>
  );
}
