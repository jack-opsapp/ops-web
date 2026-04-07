"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useWidgetIntersection } from "./use-widget-intersection";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Hide data point dots (use when sparkline is a subtle background graphic) */
  showDots?: boolean;
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
  const deltas: number[] = [];
  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1].x - points[i].x);
    deltas.push((points[i + 1].y - points[i].y) / (h[i] || 1));
  }

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

export function Sparkline({ data, width: fallbackWidth = 60, height: fallbackHeight = 24, color = "currentColor", showDots = true, className }: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(containerRef);
  const [reducedMotion] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
  );

  // Measure actual container dimensions — eliminates preserveAspectRatio distortion
  const [size, setSize] = useState({ w: fallbackWidth, h: fallbackHeight });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) setSize({ w, h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const w = size.w;
  const h = size.h;
  const pad = 4;

  const { pathD, points } = useMemo(() => {
    if (data.length < 2) return { pathD: "", points: [] as { x: number; y: number }[] };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const usableW = w - pad * 2;
    const usableH = h - pad * 2;

    const stepX = usableW / (data.length - 1);
    const pts = data.map((val, i) => ({
      x: pad + i * stepX,
      // 2px inset from bottom so stroke at y=0 doesn't clip
      y: pad + (usableH - 2) - ((val - min) / range) * (usableH - 2),
    }));

    // Straight segments for sparse data (≤5 points), smooth curves for dense
    let d: string;
    if (pts.length <= 5) {
      d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`;
      }
    } else {
      d = monotoneCubicPath(pts);
    }

    return { pathD: d, points: pts };
  }, [data, w, h]);

  const totalLength = useMemo(() => {
    if (data.length < 2) return 0;
    return w * 2;
  }, [data, w]);

  if (data.length < 2) return null;

  return (
    <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
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
          style={{
            strokeDasharray: totalLength,
            strokeDashoffset: isVisible || reducedMotion ? 0 : totalLength,
            transition: reducedMotion ? "none" : "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
        {/* Data point dots — true circles, never distorted */}
        {showDots && data.length <= 8 && points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={2.5}
            fill={color}
            style={{
              opacity: isVisible ? 1 : 0,
              transition: reducedMotion ? "none" : `opacity 400ms ease ${200 + i * 60}ms`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
