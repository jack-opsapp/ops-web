"use client";

import { useMemo, useRef, useState } from "react";
import { useWidgetIntersection } from "./use-widget-intersection";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Monotone cubic (Fritsch–Carlson) interpolation — produces a smooth curve
// through sparse data points without overshoot.
// ---------------------------------------------------------------------------
function monotoneCubicPath(
  points: { x: number; y: number }[]
): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }

  const n = points.length;
  // Compute secants (slopes between consecutive points)
  const deltas: number[] = [];
  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1].x - points[i].x);
    deltas.push((points[i + 1].y - points[i].y) / (h[i] || 1));
  }

  // Compute tangents using Fritsch–Carlson method
  const m: number[] = new Array(n).fill(0);
  m[0] = deltas[0];
  m[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (deltas[i - 1] + deltas[i]) / 2;
    }
  }

  // Ensure monotonicity (Fritsch–Carlson conditions)
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(deltas[i]) < 1e-12) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / deltas[i];
      const beta = m[i + 1] / deltas[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * alpha * deltas[i];
        m[i + 1] = tau * beta * deltas[i];
      }
    }
  }

  // Build SVG cubic bezier path
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (points[i + 1].x - points[i].x) / 3;
    const cp1x = points[i].x + dx;
    const cp1y = points[i].y + m[i] * dx;
    const cp2x = points[i + 1].x - dx;
    const cp2y = points[i + 1].y - m[i + 1] * dx;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${points[i + 1].x.toFixed(1)},${points[i + 1].y.toFixed(1)}`;
  }
  return d;
}

export function Sparkline({ data, width = 60, height = 24, color = "currentColor", className }: SparklineProps) {
  const ref = useRef<SVGSVGElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const [reducedMotion] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
  );

  const pathD = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const usableW = width - padding * 2;
    const usableH = height - padding * 2;

    // Map data to coordinate points
    const stepX = usableW / (data.length - 1);
    const points = data.map((val, i) => ({
      x: padding + i * stepX,
      y: padding + usableH - ((val - min) / range) * usableH,
    }));

    // Use monotone cubic interpolation for smooth curves
    return monotoneCubicPath(points);
  }, [data, width, height]);

  const totalLength = useMemo(() => {
    // Generous estimate for stroke-dashoffset draw animation
    if (data.length < 2) return 0;
    return width * 2;
  }, [data, width]);

  if (data.length < 2) return null;

  return (
    <svg
      ref={ref}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Sparkline trend"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{
          strokeDasharray: totalLength,
          strokeDashoffset: isVisible || reducedMotion ? 0 : totalLength,
          transition: reducedMotion ? "none" : "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </svg>
  );
}
