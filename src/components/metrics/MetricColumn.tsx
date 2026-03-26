"use client";

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
  const { label, value, formatType, trend, viz, color } = config;
  const animatedValue = useAnimatedValue(value);
  const displayValue = formatMetricValue(animatedValue, formatType);

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
      aria-label={`${label}: ${formatMetricValue(value, formatType)}${trend ? `, ${trendArrow} ${trend.value}` : ""}`}
    >
      <div
        className="mb-1 font-kosugi"
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "2px",
          color: "#6B6B6B",
        }}
      >
        {label}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className="font-mono"
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-1px",
            color: valueColor,
            lineHeight: 1,
          }}
        >
          {displayValue}
        </span>
        {trend && (
          <span
            aria-hidden="true"
            className="font-mono"
            style={{
              fontSize: 10,
              color: trendColor,
            }}
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
  );
}
