"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
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

const PERIOD_KEYS = [
  { value: "90d", i18nKey: "period.90d" },
  { value: "ytd", i18nKey: "period.ytd" },
  { value: "all", i18nKey: "period.all" },
] as const;

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

  const periodOptions = useMemo(() => PERIOD_KEYS.map((p) => ({ value: p.value, label: t(p.i18nKey) })), [t]);
  const [activePeriod, setActivePeriod] = useState(
    (config.period as string) ?? "90d"
  );

  const reducedMotion = useReducedMotion();

  // ── Core stats (filtered by period) ───────────────────────────────────
  const stats = useMemo(() => {
    const periodStart = getPeriodStart(activePeriod);
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
  }, [estimates, activePeriod]);

  // ── Monthly win rate trend (last 6 months) ────────────────────────────
  const trendData = useMemo(() => {
    const now = new Date();
    const points: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthEstimates = estimates.filter((e) => {
        if (e.deletedAt) return false;
        const created = new Date(e.createdAt);
        return created >= monthStart && created < monthEnd;
      });
      const won = monthEstimates.filter((e) => e.status === EstimateStatus.Approved).length;
      const lost = monthEstimates.filter((e) => e.status === EstimateStatus.Declined).length;
      const decided = won + lost;
      points.push(decided > 0 ? Math.round((won / decided) * 100) : 0);
    }
    return points;
  }, [estimates]);

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
    if (size === "xs") {
      return (
        <Card className="h-full cursor-pointer" onClick={() => onNavigate("/estimates")}>
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">--%</span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </span>
          </div>
        </Card>
      );
    }
    if (size === "sm") {
      return (
        <Card className="h-full cursor-pointer" onClick={() => onNavigate("/estimates")}>
          <div className="h-full flex flex-col p-3">
            <span className="font-mono text-data-lg font-bold text-text-disabled leading-none">--%</span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1 truncate">
              {t("winRate.noEstimates") ?? "No estimates"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/estimates")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("winRate.title") ?? "Win Rate"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">--%</span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("winRate.noEstimates") ?? "No estimates in period"}
            </span>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
            {t("winRate.viewEstimates") ?? "View Estimates"}
          </span>
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

  // ── SM: Hero + background sparkline ──────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={<Sparkline data={trendData} width={200} height={100} color={color} />}
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
                {animatedRate}%
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/estimates"); }}
                className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </span>
            <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
              {stats.won}/{stats.won + stats.lost} {t("winRate.won") ?? "won"} · {stats.lost} {t("winRate.lost") ?? "lost"}
            </span>
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── Ring SVG ────────────────────────────────────────────────────────────
  const ringSize = 64;
  const strokeWidth = 6;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - stats.winRate / 100);
  const fontSize = 18;

  // ── MD/LG: Ring + trend sparkline + period picker + stat grid ──────────
  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER — title + period picker */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("winRate.title") ?? "Win Rate"}
          </span>
          <WidgetPeriodPicker
            options={periodOptions}
            value={activePeriod}
            onChange={setActivePeriod}
            size={size}
          />
        </div>

        {/* HERO — ring gauge + trend sparkline */}
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
                transition: reducedMotion ? "none" : `stroke-dashoffset 800ms ${WIDGET_EASE_CSS}`,
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

          {/* Trend sparkline — fills remaining space */}
          <div className="flex-1 min-w-0">
            <Sparkline data={trendData} width={120} height={ringSize} color={color} />
          </div>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            {/* Stat grid */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <span className="font-kosugi text-micro text-text-disabled uppercase tracking-wider">{t("winRate.sent") ?? "Sent"}</span>
                <p className="font-mono text-data text-text-primary font-medium">{stats.sent}</p>
              </div>
              <div>
                <span className="font-kosugi text-micro text-text-disabled uppercase tracking-wider">{t("winRate.won") ?? "Won"}</span>
                <p className="font-mono text-data text-status-success font-medium">{stats.won}</p>
              </div>
              <div>
                <span className="font-kosugi text-micro text-text-disabled uppercase tracking-wider">{t("winRate.lost") ?? "Lost"}</span>
                <p className="font-mono text-data text-status-error font-medium">{stats.lost}</p>
              </div>
            </div>

            {/* Avg deal size */}
            {stats.avgDealSize > 0 && (
              <div className="pt-2 border-t border-border-subtle">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("winRate.avgDealSize") ?? "Avg Deal Size"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCompactCurrency(stats.avgDealSize)}
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
