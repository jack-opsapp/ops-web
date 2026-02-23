"use client";

import { useState, useEffect } from "react";
import {
  FolderKanban,
  CalendarDays,
  Users,
  DollarSign,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Animated counter hook
// ---------------------------------------------------------------------------
function useAnimatedValue(target: number, duration = 1200) {
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
interface StatCardProps {
  label: string;
  value: number;
  displayPrefix?: string;
  displaySuffix?: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  isLoading?: boolean;
}

function StatCard({
  label,
  value,
  displayPrefix = "",
  displaySuffix = "",
  subValue,
  icon: Icon,
  trend,
  trendValue,
  isLoading,
}: StatCardProps) {
  const animatedVal = useAnimatedValue(value);

  return (
    <Card className="p-2">
      <div className="flex items-start justify-between">
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
        <div className="w-[40px] h-[40px] rounded-lg bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
          <Icon className="w-[20px] h-[20px] text-text-secondary" />
        </div>
      </div>
      {trend && trendValue && !isLoading && (
        <div className="mt-1 flex items-center gap-[4px]">
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

// ---------------------------------------------------------------------------
// Stats Widget
// ---------------------------------------------------------------------------
interface StatsWidgetProps {
  size: WidgetSize;
  activeProjectCount: number;
  totalProjectCount: number;
  weekEventCount: number;
  totalClientCount: number;
  projectsLoading: boolean;
  calendarLoading: boolean;
  clientsLoading: boolean;
}

export function StatsWidget({
  size,
  activeProjectCount,
  totalProjectCount,
  weekEventCount,
  totalClientCount,
  projectsLoading,
  calendarLoading,
  clientsLoading,
}: StatsWidgetProps) {
  const allStats = [
    {
      label: "Active Projects",
      value: activeProjectCount,
      subValue: `of ${totalProjectCount} total`,
      icon: FolderKanban,
      isLoading: projectsLoading,
    },
    {
      label: "This Week",
      value: weekEventCount,
      subValue: "events scheduled",
      icon: CalendarDays,
      isLoading: calendarLoading,
    },
    {
      label: "Total Clients",
      value: totalClientCount,
      subValue: "across all projects",
      icon: Users,
      isLoading: clientsLoading,
    },
    {
      label: "Revenue MTD",
      value: 0,
      displayPrefix: "$",
      subValue: "Coming soon",
      icon: DollarSign,
      isLoading: false,
    },
  ];

  // md: show first 2 stats, full: show all 4
  const visibleStats = size === "md" ? allStats.slice(0, 2) : allStats;

  return (
    <div
      className={cn(
        "grid gap-2",
        size === "md"
          ? "grid-cols-1 sm:grid-cols-2"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      )}
    >
      {visibleStats.map((stat) => (
        <StatCard
          key={stat.label}
          label={stat.label}
          value={stat.value}
          displayPrefix={stat.displayPrefix}
          subValue={stat.subValue}
          icon={stat.icon}
          isLoading={stat.isLoading}
        />
      ))}
    </div>
  );
}
