"use client";

/**
 * MetricsStrip mini-viz vocabulary — the single tokenized set of per-cell
 * visuals for the unified metric bar (WEB OVERHAUL P6-2).
 *
 * Consolidates what used to be re-derived per surface:
 *   - sparkline ← MetricColumn MiniSparkline / Books WeeklySparkline
 *   - bars      ← MetricColumn MiniBarChart
 *   - meter     ← MetricColumn MiniProgressBar / Books MarginMeter / Catalog Meter
 *   - ramp      ← Books AgingRamp (A/R) / Catalog HealthBar (stock coverage)
 *
 * Every visual: scales via viewBox + preserveAspectRatio (no ResizeObserver),
 * ≤22px tall, draws/grows on the one OPS easing curve, and snaps to final state
 * under reduced motion. Colors are passed as token references (`var(--olive)` …)
 * so nothing here hardcodes a hex — meaning lives with the caller.
 */

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export type StripVizType = "sparkline" | "bars" | "meter" | "ramp";

export interface StripVizConfig {
  type: StripVizType;
  /** sparkline / bars: the series. */
  data?: number[];
  /** meter: 0..1 fill. */
  pct?: number;
  /** ramp: stacked segments left→right (e.g. A/R aging, stock coverage). */
  segments?: { value: number; color: string }[];
  /** sparkline / bars / meter fill color — a token ref. Defaults to text-2. */
  color?: string;
}

function useDrawn(animate: boolean) {
  const [drawn, setDrawn] = useState(!animate);
  useEffect(() => {
    if (!animate) {
      setDrawn(true);
      return;
    }
    const id = window.setTimeout(() => setDrawn(true), 40);
    return () => window.clearTimeout(id);
  }, [animate]);
  return drawn;
}

function Sparkline({ data, color = "var(--text-2)", animate }: { data: number[]; color?: string; animate: boolean }) {
  const W = 120;
  const H = 22;
  if (data.length < 2) return <div style={{ height: H }} aria-hidden />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const d = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i * W) / (data.length - 1)).toFixed(1)} ${(H - 2 - ((v - min) / range) * (H - 5)).toFixed(1)}`)
    .join(" ");
  const len = W * 1.6;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="trend" style={{ overflow: "visible" }}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeDasharray={animate ? len : undefined}
        strokeDashoffset={animate ? len : 0}
        style={{ transition: animate ? `stroke-dashoffset 600ms ${EASE}` : undefined }}
        ref={(el) => {
          if (el && animate) requestAnimationFrame(() => (el.style.strokeDashoffset = "0"));
        }}
      />
    </svg>
  );
}

function Bars({ data, color = "var(--text-2)", animate }: { data: number[]; color?: string; animate: boolean }) {
  const W = 120;
  const H = 22;
  const drawn = useDrawn(animate);
  if (!data.length) return <div style={{ height: H }} aria-hidden />;
  const n = data.length;
  const gap = 0.38;
  const unit = W / (n + (n - 1) * gap);
  const max = Math.max(...data, 1);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="bars">
      {data.map((v, i) => {
        const bh = Math.max(2, (v / max) * (H - 3));
        const x = i * unit * (1 + gap);
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={(drawn ? H - bh : H).toFixed(1)}
            width={unit.toFixed(1)}
            height={(drawn ? bh : 0).toFixed(1)}
            rx={1}
            fill={color}
            opacity={(0.45 + 0.55 * (v / max)).toFixed(2)}
            style={{ transition: animate ? `y 400ms ${EASE} ${i * 45}ms, height 400ms ${EASE} ${i * 45}ms` : undefined }}
          />
        );
      })}
    </svg>
  );
}

function Meter({ pct, color = "var(--text-2)", animate }: { pct: number; color?: string; animate: boolean }) {
  const drawn = useDrawn(animate);
  const w = Math.max(0, Math.min(1, pct));
  return (
    <div className="mt-[7px] h-[8px] overflow-hidden rounded-bar bg-fill-neutral-dim" role="img" aria-label={`${Math.round(w * 100)}%`}>
      <div
        className="h-full rounded-bar"
        style={{ width: `${(drawn ? w : 0) * 100}%`, background: color, transition: animate ? `width 600ms ${EASE}` : undefined }}
      />
    </div>
  );
}

function Ramp({ segments, animate }: { segments: { value: number; color: string }[]; animate: boolean }) {
  const drawn = useDrawn(animate);
  const total = segments.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div className="mt-[7px] flex h-[8px] gap-[2px] overflow-hidden rounded-bar" role="img" aria-label="distribution">
      {segments.map((s, i) => (
        <span
          key={i}
          className="block h-full rounded-[1px]"
          style={{
            width: `${(drawn ? s.value / total : 0) * 100}%`,
            background: s.color,
            opacity: s.value > 0 ? 1 : 0.3,
            transition: animate ? `width 500ms ${EASE} ${i * 45}ms` : undefined,
          }}
        />
      ))}
    </div>
  );
}

export function StripViz({ viz }: { viz: StripVizConfig }) {
  const animate = !useReducedMotion();
  switch (viz.type) {
    case "sparkline":
      return <Sparkline data={viz.data ?? []} color={viz.color} animate={animate} />;
    case "bars":
      return <Bars data={viz.data ?? []} color={viz.color} animate={animate} />;
    case "meter":
      return <Meter pct={viz.pct ?? 0} color={viz.color} animate={animate} />;
    case "ramp":
      return <Ramp segments={viz.segments ?? []} animate={animate} />;
    default:
      return null;
  }
}
