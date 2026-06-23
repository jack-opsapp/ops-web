"use client";

import { memo } from "react";
import { cn } from "@/lib/utils/cn";
import type { QueueStats } from "@/lib/types/approval-queue";

interface QueueStatsRibbonProps {
  stats: QueueStats | undefined;
  isLoading: boolean;
  t: (key: string) => string;
}

function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return "--";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

export const QueueStatsRibbon = memo(function QueueStatsRibbon({
  stats,
  isLoading,
  t,
}: QueueStatsRibbonProps) {
  const cells = [
    {
      label: t("stats.pending"),
      value: stats?.pending ?? 0,
      accent: (stats?.pending ?? 0) > 0,
    },
    {
      label: t("stats.approvedToday"),
      value: stats?.approvedToday ?? 0,
      accent: false,
    },
    {
      label: t("stats.rejectedToday"),
      value: stats?.rejectedToday ?? 0,
      accent: false,
    },
    {
      label: t("stats.avgResponse"),
      value: formatResponseTime(stats?.avgResponseTimeMinutes ?? null),
      accent: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className={cn(
            "rounded-lg border border-[rgba(255,255,255,0.08)] p-3",
            "bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2]"
          )}
        >
          <span className="font-mono text-[11px] text-text-3 uppercase block">
            [{cell.label}]
          </span>
          <span
            className={cn(
              "font-mohave text-[24px] leading-tight mt-1 block",
              isLoading && "animate-pulse",
              cell.accent ? "text-[#6F94B0]" : "text-text"
            )}
          >
            {isLoading ? "--" : cell.value}
          </span>
        </div>
      ))}
    </div>
  );
});
