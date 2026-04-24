"use client";

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";

interface ProgressRingProps {
  /** 0-100 */
  percent: number;
  /** px diameter; default 44 */
  size?: number;
  /** px stroke width; default 3 */
  stroke?: number;
  /** ring color (hex or rgba) */
  color: string;
  /** track color */
  trackColor?: string;
  /** center content */
  children?: React.ReactNode;
  className?: string;
  /** sr-only label */
  label?: string;
}

export function ProgressRing({
  percent,
  size = 44,
  stroke = 3,
  color,
  trackColor = "rgba(255,255,255,0.14)",
  children,
  className,
  label,
}: ProgressRingProps) {
  const prefersReducedMotion = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const target = prefersReducedMotion ? percent : 0;
  const mv = useMotionValue(target);
  // Spring physics: stiffness 60, damping 15 → ~1s settle, no overshoot.
  // Per data-viz skill: radial fills feel best with a slow, heavy spring.
  const smoothed = useSpring(mv, { stiffness: 60, damping: 15 });
  const dashoffset = useTransform(
    smoothed,
    (v) => circumference * (1 - v / 100)
  );

  useEffect(() => {
    mv.set(percent);
  }, [percent, mv]);

  return (
    <div
      className={cn("cal-progress-ring relative", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            strokeDashoffset: dashoffset,
            transform: `rotate(-90deg)`,
            transformOrigin: "center",
          }}
        />
      </svg>
      {children && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          {children}
        </div>
      )}
    </div>
  );
}
