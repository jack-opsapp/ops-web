"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const EASE_SMOOTH_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

interface MiniBarChartProps {
  data: number[];
  color: string;
  height?: number;
}

export function MiniBarChart({ data, color, height = 24 }: MiniBarChartProps) {
  const [animated, setAnimated] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const barCount = data.length;
  const gap = 0.35;
  const totalUnits = barCount + (barCount - 1) * gap;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 140 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Bar chart: ${data.length} values`}
    >
      {data.map((value, i) => {
        const unitWidth = 140 / totalUnits;
        const barWidth = unitWidth;
        const x = i * unitWidth * (1 + gap);
        const barHeight = (value / max) * (height - 2);
        const y = height - barHeight;

        const isRecent = i >= data.length - 2;
        const isLatest = i === data.length - 1;
        const fill = isLatest
          ? color
          : isRecent
            ? color
            : "rgba(255,255,255,0.07)";
        const opacity = isLatest ? 0.6 : isRecent ? 0.35 : 1;

        const delay = reducedMotion ? 0 : i * 50;

        return (
          <rect
            key={i}
            x={x}
            y={reducedMotion || animated ? y : height}
            width={barWidth}
            height={reducedMotion || animated ? barHeight : 0}
            rx={1}
            fill={fill}
            opacity={opacity}
            style={{
              transition: reducedMotion
                ? "opacity 200ms"
                : `y 400ms ${EASE_SMOOTH_CSS} ${delay}ms, height 400ms ${EASE_SMOOTH_CSS} ${delay}ms`,
            }}
          />
        );
      })}
    </svg>
  );
}
