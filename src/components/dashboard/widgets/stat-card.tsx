"use client";

import { useState, useEffect } from "react";
import { TrendingUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";
import type { WidgetTypeId, WidgetSize } from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Per-stat accent colors (from tailwind config palette)
// ---------------------------------------------------------------------------
const STAT_ACCENT_COLORS: Partial<Record<WidgetTypeId, string>> = {
  "stat-projects": "#8195B5",      // in-progress blue
  "stat-tasks": "#9DB582",         // accepted green
  "stat-events": "#A182B5",        // purple
  "stat-clients": "#59779F",       // quote blue
  "stat-team": "#A5B368",          // success green
  "stat-revenue": "#C4A868",       // amber/gold
  "stat-invoices": "#B5A381",      // warm estimated
  "stat-estimates": "#7B68A6",     // inspection purple
  "stat-opportunities": "#B58289", // rose
};

// ---------------------------------------------------------------------------
// Animated counter hook
// ---------------------------------------------------------------------------
export function useAnimatedValue(target: number, duration = 1200) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    let raf: number;

    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
export interface StatCardProps {
  label: string;
  value: number;
  displayPrefix?: string;
  displaySuffix?: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  isLoading?: boolean;
  typeId?: WidgetTypeId;
  size?: WidgetSize;
}

export function StatCard({
  label,
  value,
  displayPrefix = "",
  displaySuffix = "",
  subValue,
  icon: Icon,
  trend,
  trendValue,
  isLoading,
  typeId,
  size,
}: StatCardProps) {
  const animatedVal = useAnimatedValue(value);
  const isXs = size === "xs";
  const accent = typeId ? STAT_ACCENT_COLORS[typeId] ?? "#8195B5" : "#8195B5";

  // ── XS: Square, borderless, colored, large number ──
  if (isXs) {
    return (
      <div
        className="h-full w-full flex flex-col items-center justify-center rounded-md overflow-hidden aspect-square max-w-[160px]"
        style={{
          background: `linear-gradient(135deg, ${accent}18, ${accent}08)`,
          borderLeft: `3px solid ${accent}`,
        }}
      >
        {isLoading ? (
          <Loader2 className="w-[20px] h-[20px] animate-spin" style={{ color: accent }} />
        ) : (
          <>
            <span className="mb-[4px] opacity-50" style={{ color: accent }}>
              <Icon className="w-[18px] h-[18px]" />
            </span>
            <p className="font-mono text-[32px] leading-none font-semibold" style={{ color: accent }}>
              {displayPrefix}
              {animatedVal.toLocaleString()}
              {displaySuffix}
            </p>
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-widest mt-[6px] text-center px-[8px]">
              {label}
            </span>
          </>
        )}
      </div>
    );
  }

  // ── SM (default): Rectangle card with border ──
  return (
    <Card className="p-2 h-full flex flex-col">
      <div className="flex items-start justify-between flex-1">
        <div>
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {label}
          </span>
          {isLoading ? (
            <div className="flex items-center gap-1 mt-[4px]">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-body-sm text-text-disabled uppercase">Loading...</span>
            </div>
          ) : (
            <>
              <p className="font-mono text-data-lg text-text-primary mt-[4px]">
                {displayPrefix}
                {animatedVal.toLocaleString()}
                {displaySuffix}
              </p>
              {subValue && (
                <p className="font-mono text-[11px] text-text-tertiary mt-[2px]">{subValue}</p>
              )}
            </>
          )}
        </div>
        <div
          className="w-[40px] h-[40px] rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${accent}15` }}
        >
          <span style={{ color: accent }}><Icon className="w-[20px] h-[20px]" /></span>
        </div>
      </div>
      {trend && trendValue && !isLoading && (
        <div className="mt-1 flex items-center gap-[4px] shrink-0">
          <TrendingUp
            className={cn(
              "w-[14px] h-[14px]",
              trend === "up" && "text-status-success",
              trend === "down" && "text-ops-error rotate-180",
              trend === "neutral" && "text-text-tertiary"
            )}
          />
          <span
            className={cn(
              "font-mono text-[11px]",
              trend === "up" && "text-status-success",
              trend === "down" && "text-ops-error",
              trend === "neutral" && "text-text-tertiary"
            )}
          >
            {trendValue}
          </span>
        </div>
      )}
    </Card>
  );
}
