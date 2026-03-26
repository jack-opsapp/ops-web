"use client";

import { useMemo, useRef } from "react";
import { useWidgetIntersection } from "./use-widget-intersection";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({ data, width = 60, height = 24, color = "currentColor", className }: SparklineProps) {
  const ref = useRef<SVGSVGElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const pathD = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const usableW = width - padding * 2;
    const usableH = height - padding * 2;
    const stepX = usableW / (data.length - 1);

    return data
      .map((val, i) => {
        const x = padding + i * stepX;
        const y = padding + usableH - ((val - min) / range) * usableH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data, width, height]);

  const totalLength = useMemo(() => {
    // Approximate path length for stroke-dashoffset draw animation
    if (data.length < 2) return 0;
    return data.length * 10;
  }, [data]);

  if (data.length < 2) return null;

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Sparkline trend"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: totalLength,
          strokeDashoffset: isVisible ? 0 : totalLength,
          transition: "stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </svg>
  );
}
