"use client";

import { useId, useRef, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const EASE_SMOOTH_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

interface MiniSparklineProps {
  data: number[];
  color: string;
  height?: number;
}

function buildPath(data: number[], width: number, height: number): { line: string; area: string } {
  if (data.length < 2) return { line: "", area: "" };

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padding + ((max - v) / range) * (height - padding * 2);
    return { x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height}Z`;

  return { line, area };
}

export function MiniSparkline({ data, color, height = 24 }: MiniSparklineProps) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(140);
  const [drawn, setDrawn] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!svgRef.current) return;
    const w = svgRef.current.getBoundingClientRect().width;
    if (w > 0) setWidth(w);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDrawn(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (!data.length) return null;

  const { line, area } = buildPath(data, width, height);
  const pathLength = width * 1.5;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend: ${data.length} data points`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area && (
        <path
          d={area}
          fill={`url(#${gradientId})`}
          style={{
            opacity: drawn ? 1 : 0,
            transition: reducedMotion ? "opacity 200ms" : `opacity 400ms ${EASE_SMOOTH_CSS}`,
          }}
        />
      )}
      {line && (
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          strokeDasharray={reducedMotion ? "none" : pathLength}
          strokeDashoffset={reducedMotion ? 0 : drawn ? 0 : pathLength}
          style={{
            transition: reducedMotion
              ? "opacity 200ms"
              : `stroke-dashoffset 600ms ${EASE_SMOOTH_CSS}`,
          }}
        />
      )}
    </svg>
  );
}
