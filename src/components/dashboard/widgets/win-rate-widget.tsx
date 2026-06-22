"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { WidgetTitle } from "./shared/widget-title";

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

  // ── Sparkline month labels (last 6 months) ────────────────────────────
  const monthLabels = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return d.toLocaleString("default", { month: "short" });
    });
  }, []);

  // ── Sparkline hover state ─────────────────────────────────────────────
  const sparklineAreaRef = useRef<HTMLDivElement>(null);
  const [sparkTooltip, setSparkTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    month: string;
    rate: number;
  }>({ visible: false, x: 0, y: 0, month: "", rate: 0 });

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <WidgetTitle>{t("winRate.title") ?? "Win Rate"}</WidgetTitle>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="ring" />
        </div>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (!hasData) {
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-mute leading-none">--%</span>
            <WidgetTitle className="mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </WidgetTitle>
          </div>
        </Card>
      );
    }
    if (size === "sm") {
      return (
        <Card className="h-full p-0">
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold text-text-mute leading-none">--%</span>
              <button onClick={() => onNavigate("/books?segment=estimates")} className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <WidgetTitle className="mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </WidgetTitle>
            <span className="font-mohave text-caption-sm text-text-mute mt-1 truncate">
              {t("winRate.noEstimates") ?? "No estimates"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>
            {t("winRate.title") ?? "Win Rate"}
          </WidgetTitle>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-mute leading-none">--%</span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("winRate.noEstimates") ?? "No estimates in period"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Hero % + color ────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none" style={{ color }}>
            {animatedRate}%
          </span>
          <WidgetTitle className="mt-1">
            {t("winRate.title") ?? "Win Rate"}
          </WidgetTitle>
          <span className="font-mono text-micro text-text-mute uppercase">
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
          chart={<Sparkline data={trendData} width={200} height={100} color={color} showDots={false} />}
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
                {animatedRate}%
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/books?segment=estimates"); }}
                className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <WidgetTitle className="mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </WidgetTitle>
            <span className="font-mono text-micro text-text-3 mt-0.5">
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
          <WidgetTitle>
            {t("winRate.title") ?? "Win Rate"}
          </WidgetTitle>
          <WidgetPeriodPicker
            options={periodOptions}
            value={activePeriod}
            onChange={setActivePeriod}
            size={size}
          />
        </div>

        {/* HERO — ring gauge + trend sparkline */}
        <div className="flex items-center gap-4 mb-1">
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

          {/* Trend sparkline — fills remaining space with hover zones */}
          <div className="flex-1 min-w-0 h-[64px] relative" ref={sparklineAreaRef}>
            <Sparkline data={trendData} width={200} height={ringSize} color={color} />

            {/* Invisible hover zones — one per data point */}
            <div className="absolute inset-0 flex">
              {trendData.map((rate, i) => (
                <div
                  key={i}
                  className="flex-1 h-full cursor-crosshair"
                  onMouseEnter={(e) => {
                    const parentRect = ref.current?.getBoundingClientRect();
                    const zoneRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (!parentRect) return;
                    setSparkTooltip({
                      visible: true,
                      x: zoneRect.left - parentRect.left + zoneRect.width / 2,
                      y: zoneRect.top - parentRect.top,
                      month: monthLabels[i],
                      rate,
                    });
                  }}
                  onMouseLeave={() => setSparkTooltip((prev) => ({ ...prev, visible: false }))}
                />
              ))}
            </div>

            {/* Sparkline tooltip */}
            <WidgetTooltip visible={sparkTooltip.visible} x={sparkTooltip.x} y={sparkTooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={sparkTooltip.month} value={`${sparkTooltip.rate}%`} color={color} />
            </WidgetTooltip>
          </div>
        </div>

        {/* X-axis month labels for sparkline */}
        <div className="flex justify-between mb-3" style={{ marginLeft: `${ringSize + 16}px` }}>
          {monthLabels.map((label, i) => (
            <span key={i} className="font-mono text-micro text-text-mute uppercase">
              {label}
            </span>
          ))}
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            {/* Stat grid */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">{t("winRate.sent") ?? "Sent"}</span>
                <p className="font-mono text-data text-text font-medium">{stats.sent}</p>
              </div>
              <div>
                <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">{t("winRate.won") ?? "Won"}</span>
                <p className="font-mono text-data text-status-success font-medium">{stats.won}</p>
              </div>
              <div>
                <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">{t("winRate.lost") ?? "Lost"}</span>
                <p className="font-mono text-data text-status-error font-medium">{stats.lost}</p>
              </div>
            </div>

            {/* Avg deal size */}
            {stats.avgDealSize > 0 && (
              <div className="pt-2 border-t border-border-subtle">
                <span className="font-mono text-micro text-text-mute uppercase">
                  {t("winRate.avgDealSize") ?? "Avg Deal Size"}
                </span>
                <p className="font-mono text-data-sm text-text font-medium">
                  {formatCompactCurrency(stats.avgDealSize)}
                </p>
              </div>
            )}
          </ScrollFade>
        )}

      </div>
    </Card>
  );
}
