"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const EASE_SMOOTH_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

interface MiniProgressBarProps {
  value: number;
  color: string;
}

export function MiniProgressBar({ value, color }: MiniProgressBarProps) {
  const [width, setWidth] = useState(0);
  const clamped = Math.max(0, Math.min(100, value));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => setWidth(clamped), 50);
    return () => clearTimeout(timer);
  }, [clamped]);

  return (
    <div
      className="mt-2 h-[4px] rounded-bar"
      style={{ background: "rgba(255,255,255,0.06)" }}
      role="img"
      aria-label={`${Math.round(value)}%`}
    >
      <div
        className="h-full rounded-bar"
        style={{
          width: reducedMotion ? `${clamped}%` : `${width}%`,
          background: color,
          opacity: 0.7,
          transition: reducedMotion ? "none" : `width 600ms ${EASE_SMOOTH_CSS}`,
        }}
      />
    </div>
  );
}
