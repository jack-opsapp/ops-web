"use client";

import { useState, useCallback } from "react";
import type { MetricColumnConfig } from "./types";
import { formatMetricValue } from "./format";
import { useAnimatedValue } from "./hooks/useAnimatedValue";
import { MiniSparkline } from "./viz/MiniSparkline";
import { MiniBarChart } from "./viz/MiniBarChart";
import { MiniProgressBar } from "./viz/MiniProgressBar";
import { SeverityDots } from "./viz/SeverityDots";

interface MetricColumnProps {
  config: MetricColumnConfig;
}

export function MetricColumn({ config }: MetricColumnProps) {
  const { label, value, formatType, trend, viz, color, breakdown } = config;
  const animatedValue = useAnimatedValue(value);
  const displayValue = formatMetricValue(animatedValue, formatType);
  const [flipped, setFlipped] = useState(false);

  const handleFlip = useCallback(() => {
    if (breakdown) setFlipped((f) => !f);
  }, [breakdown]);

  const trendColor = trend
    ? trend.sentiment === "positive"
      ? "#A5B368"
      : trend.sentiment === "negative"
        ? "#93321A"
        : "#6B6B6B"
    : undefined;

  const trendArrow = trend
    ? trend.direction === "up"
      ? "▲"
      : trend.direction === "down"
        ? "▼"
        : "—"
    : undefined;

  const valueColor = color ?? "#E5E5E5";

  return (
    <div
      className="flex-1 min-w-0"
      style={{ perspective: breakdown ? 600 : undefined }}
      aria-label={`${label}: ${formatMetricValue(value, formatType)}${trend ? `, ${trendArrow} ${trend.value}` : ""}${breakdown ? ". Click to see breakdown." : ""}`}
    >
      <div
        onClick={handleFlip}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleFlip(); } }}
        role={breakdown ? "button" : undefined}
        tabIndex={breakdown ? 0 : undefined}
        className={breakdown ? "cursor-pointer" : undefined}
        style={{
          transformStyle: breakdown ? "preserve-3d" : undefined,
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* ── Front face ── */}
        <div style={{ backfaceVisibility: "hidden" }}>
          <div className="mb-1 font-kosugi text-micro uppercase tracking-[2px] text-[#6B6B6B]">
            {label}
          </div>

          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono text-display tracking-[-1px] leading-none"
              style={{ color: valueColor }}
            >
              {displayValue}
            </span>
            {trend && (
              <span
                aria-hidden="true"
                className="font-mono text-micro"
                style={{ color: trendColor }}
              >
                {trendArrow} {trend.value}
              </span>
            )}
          </div>

          {viz?.type === "sparkline" && <MiniSparkline data={viz.data} color={viz.color} />}
          {viz?.type === "bars" && <MiniBarChart data={viz.data} color={viz.color} />}
          {viz?.type === "progress" && <MiniProgressBar value={value} color={viz.color} />}
          {viz?.type === "dots" && <SeverityDots count={value} color={viz.color} />}
        </div>

        {/* ── Back face (breakdown) ── */}
        {breakdown && (
          <div
            className="absolute inset-0 flex flex-col justify-center"
            style={{
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            <div className="mb-1 font-kosugi text-micro uppercase tracking-[2px] text-[#6B6B6B]">
              {label}
            </div>
            <div
              className="font-mono text-[13px] leading-relaxed tracking-wide"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {breakdown}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
