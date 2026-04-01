"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function winRateColor(pct: number): string {
  if (pct >= 50) return WT.success;
  if (pct >= 30) return WT.warning;
  return WT.error;
}

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

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface WinRateWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  estimates: Estimate[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function WinRateWidget({
  size,
  config,
  estimates,
  isLoading,
  onNavigate,
}: WinRateWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const period = (config.period as string) ?? "90d";
  const periodStart = getPeriodStart(period);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

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

    // Average deal size (won estimates only)
    const wonEstimates = filtered.filter((e) => e.status === EstimateStatus.Approved);
    const totalWonValue = wonEstimates.reduce((sum, e) => sum + (e.total ?? 0), 0);
    const avgDealSize = wonEstimates.length > 0 ? totalWonValue / wonEstimates.length : 0;

    return { sent, won, lost, winRate, avgDealSize };
  }, [estimates, periodStart]);

  const animatedRate = useAnimatedValue(isVisible ? stats.winRate : 0, 1000);
  const color = winRateColor(stats.winRate);
  const hasData = stats.sent > 0;

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("winRate.title") ?? "Win Rate"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="ring" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/estimates")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("winRate.title") ?? "Win Rate"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              --%
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("winRate.noEstimates") ?? "No estimates in period"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("winRate.viewEstimates") ?? "View Estimates"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero % + color ────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/estimates")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none" style={{ color }}>
            {animatedRate}%
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("winRate.title") ?? "Win Rate"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {stats.won}/{stats.sent} {t("winRate.won") ?? "won"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + won/lost counts ──────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
              {animatedRate}%
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/estimates"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("winRate.title") ?? "Win Rate"}
          </span>
          {/* Row 3: Won/lost counts */}
          <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
            {stats.won}/{stats.sent} {t("winRate.won") ?? "won"} · {stats.lost} {t("winRate.lost") ?? "lost"}
          </span>
        </div>
      </Card>
    );
  }

  // ── Ring SVG (MD only now) ────────────────────────────────────────────
  const ringSize = compact ? 50 : 64;
  const strokeWidth = compact ? 5 : 6;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - stats.winRate / 100);
  const fontSize = compact ? 14 : 18;

  // ── MD: Larger ring + avg deal size + stat grid + footer ───────────────
  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("winRate.title") ?? "Win Rate"}
          </span>
        </div>

        {/* HERO — ring + percentage */}
        <div className="flex items-center gap-4 mb-3">
          <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="shrink-0">
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" strokeWidth={strokeWidth}
              style={{ stroke: WT.faint }}
            />
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={isVisible && !reducedMotion ? dashOffset : circumference}
              style={{
                stroke: color,
                transition: reducedMotion ? "none" : "stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)",
                transform: "rotate(-90deg)", transformOrigin: "center",
              }}
            />
            <text
              x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
              fontSize={fontSize} fontFamily="var(--font-mono)" fontWeight="600"
              style={{ fill: color }}
            >
              {animatedRate}%
            </text>
          </svg>
          <div className="flex flex-col gap-1">
            <span className={`font-mono ${heroClass} font-bold leading-none`} style={{ color }}>
              {animatedRate}%
            </span>
            <span className="font-mohave text-caption-sm text-text-secondary">
              {t("winRate.title") ?? "Win Rate"}
            </span>
          </div>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            {/* Stat grid */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("winRate.sent") ?? "Sent"}</span>
                <p className="font-mono text-data-sm text-text-primary font-medium">{stats.sent}</p>
              </div>
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("winRate.won") ?? "Won"}</span>
                <p className="font-mono text-data-sm text-status-success font-medium">{stats.won}</p>
              </div>
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("winRate.lost") ?? "Lost"}</span>
                <p className="font-mono text-data-sm text-status-error font-medium">{stats.lost}</p>
              </div>
            </div>

            {/* Avg deal size */}
            {stats.avgDealSize > 0 && (
              <div className="pt-2 border-t border-border-subtle">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("winRate.avgDealSize") ?? "Avg Deal Size"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCurrency(stats.avgDealSize)}
                </p>
              </div>
            )}
          </ScrollFade>
        )}

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/estimates")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("winRate.viewEstimates") ?? "View Estimates"}
          </button>
        )}
      </div>
    </Card>
  );
}
