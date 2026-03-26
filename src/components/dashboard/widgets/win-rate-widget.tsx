"use client";

import { useMemo, useRef } from "react";
import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Color zones
// ---------------------------------------------------------------------------
function winRateColor(pct: number): string {
  if (pct >= 50) return "#6B8F71";   // Healthy
  if (pct >= 30) return "#C4A868";   // Watch
  return "#B58289";                   // Low
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface WinRateWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  estimates: Estimate[];
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getPeriodStart(period: string): Date | null {
  const now = new Date();
  if (period === "90d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    return d;
  }
  if (period === "ytd") return new Date(now.getFullYear(), 0, 1);
  return null; // "all" — no filter
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function WinRateWidget({
  size,
  config,
  estimates,
  isLoading,
}: WinRateWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const period = (config.period as string) ?? "90d";
  const periodStart = getPeriodStart(period);

  const stats = useMemo(() => {
    const countableStatuses = new Set([
      EstimateStatus.Sent, EstimateStatus.Viewed, EstimateStatus.Approved, EstimateStatus.Declined,
    ]);

    const filtered = estimates.filter((e) => {
      if (e.deletedAt) return false;
      if (!countableStatuses.has(e.status)) return false;
      if (periodStart) {
        const created = new Date(e.createdAt);
        if (created < periodStart) return false;
      }
      return true;
    });

    const sent = filtered.length;
    const won = filtered.filter((e) => e.status === EstimateStatus.Approved).length;
    const lost = filtered.filter((e) => e.status === EstimateStatus.Declined).length;
    const decided = won + lost;
    const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;

    return { sent, won, lost, winRate };
  }, [estimates, periodStart]);

  const animatedRate = useAnimatedValue(isVisible ? stats.winRate : 0, 1000);
  const color = winRateColor(stats.winRate);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("winRate.title") ?? "Win Rate"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="ring" />
        </CardContent>
      </Card>
    );
  }

  const hasData = stats.sent > 0;

  // ── XS ──────────────────────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full flex flex-col items-start justify-center px-3" ref={ref}>
        <span className="font-mono text-[28px] font-medium leading-none" style={{ color: hasData ? color : "var(--text-tertiary)" }}>
          {hasData ? `${animatedRate}%` : "--"}
        </span>
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider mt-1">
          {t("winRate.title") ?? "Win Rate"}
        </span>
      </Card>
    );
  }

  // ── SM: Ring + breakdown ────────────────────────────────────────────────
  const ringSize = 50;
  const strokeWidth = 5;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fillPct = hasData ? stats.winRate : 0;
  const dashOffset = circumference * (1 - fillPct / 100);

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("winRate.title") ?? "Win Rate"}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2 flex items-center gap-3">
        <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="shrink-0">
          <circle
            cx={ringSize / 2} cy={ringSize / 2} r={radius}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth}
          />
          <circle
            cx={ringSize / 2} cy={ringSize / 2} r={radius}
            fill="none" stroke={hasData ? color : "rgba(255,255,255,0.08)"}
            strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={isVisible && !reducedMotion ? dashOffset : circumference}
            style={{
              transition: reducedMotion ? "none" : "stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)",
              transform: "rotate(-90deg)", transformOrigin: "center",
            }}
          />
          <text
            x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
            fill={hasData ? color : "rgba(255,255,255,0.3)"}
            fontSize="15" fontFamily="var(--font-mono)" fontWeight="500"
          >
            {hasData ? `${animatedRate}%` : "--"}
          </text>
        </svg>
        {hasData ? (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] text-text-tertiary">
              {t("winRate.sent") ?? "Sent"}: {stats.sent}
            </span>
            <span className="font-mono text-[11px] text-status-success">
              {t("winRate.won") ?? "Won"}: {stats.won}
            </span>
            <span className="font-mono text-[11px] text-ops-error">
              {t("winRate.lost") ?? "Lost"}: {stats.lost}
            </span>
          </div>
        ) : (
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("winRate.noEstimates") ?? "No estimates in period"}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
