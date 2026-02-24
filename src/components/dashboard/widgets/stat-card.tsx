"use client";

import { useState, useEffect } from "react";
import { TrendingUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

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
  accentColor?: string | null;
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
  accentColor,
  size,
}: StatCardProps) {
  const animatedVal = useAnimatedValue(value);
  const isXs = size === "xs";
  const accent = accentColor ?? null;

  // ── XS: Square, left-aligned, compact ──
  if (isXs) {
    return (
      <div
        className="h-full w-full flex flex-col items-start justify-end rounded-md overflow-hidden p-[10px]"
        style={{
          background: accent
            ? `linear-gradient(135deg, ${accent}18, ${accent}08)`
            : "rgba(255, 255, 255, 0.03)",
          borderLeft: accent ? `3px solid ${accent}` : "3px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {isLoading ? (
          <Loader2
            className="w-[20px] h-[20px] animate-spin"
            style={{ color: accent ?? "var(--text-disabled)" }}
          />
        ) : (
          <>
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-widest mb-auto">
              {label}
            </span>
            <p
              className="font-mono text-[28px] leading-none font-semibold"
              style={{ color: accent ?? "var(--text-primary)" }}
            >
              {displayPrefix}
              {animatedVal.toLocaleString()}
              {displaySuffix}
            </p>
          </>
        )}
      </div>
    );
  }

  // ── SM (default): Rectangle card with optional accent border ──
  return (
    <Card
      className="p-2 h-full flex flex-col"
      style={{
        borderLeft: accent ? `3px solid ${accent}` : undefined,
      }}
    >
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
          style={{
            background: accent ? `${accent}15` : "rgba(255, 255, 255, 0.05)",
          }}
        >
          <span style={{ color: accent ?? "var(--text-tertiary)" }}>
            <Icon className="w-[20px] h-[20px]" />
          </span>
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
