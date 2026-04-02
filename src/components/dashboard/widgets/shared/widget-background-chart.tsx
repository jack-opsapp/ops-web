"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface WidgetBackgroundChartProps {
  /** The chart component to render as ambient background */
  chart: ReactNode;
  /** Text content layered on top of the chart */
  children: ReactNode;
  /** Chart opacity (default 0.35 — visible but not competing with text) */
  opacity?: number;
  className?: string;
}

/** Renders a chart as an ambient background behind text content (SM widgets) */
export function WidgetBackgroundChart({
  chart,
  children,
  opacity = 0.35,
  className,
}: WidgetBackgroundChartProps) {
  return (
    <div className={cn("relative h-full", className)}>
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ opacity }}
      >
        {chart}
      </div>
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
