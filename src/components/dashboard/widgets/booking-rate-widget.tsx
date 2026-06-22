"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetTitle } from "./shared/widget-title";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail } from "@/lib/widget-tokens";
import type { Project } from "@/lib/types/models";
import { ProjectStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface BookingRateWidgetProps {
  size: WidgetSize;
  projects: Project[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BookingRateWidget({
  size,
  projects,
  isLoading,
  onNavigate,
}: BookingRateWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const reducedMotion = useReducedMotion();

  const bookings = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const months: { label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const count = projects.filter((p) => {
        if (p.deletedAt) return false;
        if (p.status === ProjectStatus.RFQ || p.status === ProjectStatus.Estimated) return false;
        const created = p.createdAt ? new Date(p.createdAt) : null;
        if (!created) return false;
        return created >= d && created < nextD;
      }).length;
      months.push({ label: d.toLocaleString("default", { month: "short" }), count });
    }

    const thisMonth = months[months.length - 1].count;
    const lastMonth = months[months.length - 2].count;
    const delta = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
    const trend: "up" | "down" | "neutral" = thisMonth > lastMonth ? "up" : thisMonth < lastMonth ? "down" : "neutral";
    const maxCount = Math.max(...months.map((m) => m.count), 1);

    const sparkData = months.map((m) => m.count);
    return { months, thisMonth, lastMonth, delta, trend, maxCount, sparkData };
  }, [projects]);

  const animatedCount = useAnimatedValue(isVisible ? bookings.thisMonth : 0, 1000);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    month: string;
    count: number;
  }>({ visible: false, x: 0, y: 0, month: "", count: 0 });

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <WidgetTitle>{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </div>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (bookings.thisMonth === 0 && bookings.lastMonth === 0) {
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-mute leading-none">0</span>
            <WidgetTitle className="mt-1">{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
          </div>
        </Card>
      );
    }
    if (size === "sm") {
      return (
        <Card className="h-full p-0">
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold text-text-mute leading-none">0</span>
              <button onClick={() => onNavigate("/projects")} className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <WidgetTitle className="mt-1">{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
            <span className="font-mohave text-caption-sm text-text-mute mt-1 truncate">
              {t("bookingRate.noProjects") ?? "No projects yet"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-mute leading-none">0</span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("bookingRate.noProjects") ?? "No projects yet"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Hero count + trend ────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text">
            {animatedCount}
          </span>
          <WidgetTitle className="mt-1">{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
          <WidgetTrendContext
            variant="trend"
            direction={bookings.trend}
            delta={`${Math.abs(bookings.delta)}%`}
            comparison={t("trend.vsLastMonth") ?? "vs last month"}
          />
        </div>
      </Card>
    );
  }

  // ── SM: Hero + background sparkline + trend ────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={<Sparkline data={bookings.sparkData} width={200} height={100} color={WT.accent} showDots={false} />}
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            {/* Row 1: Hero number + tiny nav icon */}
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text">
                {animatedCount}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/projects"); }}
                className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            {/* Row 2: Title */}
            <WidgetTitle className="mt-1">{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
            {/* Row 3: Trend indicator */}
            <div className="mt-1">
              <WidgetTrendContext
                variant="trend"
                direction={bookings.trend}
                delta={`${Math.abs(bookings.delta)}%`}
                comparison={t("trend.vsLastMonth") ?? "vs last month"}
              />
            </div>
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── MD: Hero + bar chart with tooltips + footer ────────────────────────
  const chartHeight = 80;

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>{t("bookingRate.title") ?? "Bookings"}</WidgetTitle>
        </div>

        {/* HERO */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`font-mono ${heroClass} font-bold text-text leading-none`}>
            {animatedCount}
          </span>
        </div>
        <div className="mb-2">
          <WidgetTrendContext
            variant="trend"
            direction={bookings.trend}
            delta={`${Math.abs(bookings.delta)}%`}
            comparison={t("trend.vsLastMonth") ?? "vs last month"}
          />
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade className="relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.month} value={`${tooltip.count}`} />
            </WidgetTooltip>

            {/* Bar chart */}
            <div className="flex items-end gap-[4px]" style={{ height: `${chartHeight}px` }}>
              {bookings.months.map((m, i) => {
                const barH = (m.count / bookings.maxCount) * chartHeight;
                const isCurrent = i === bookings.months.length - 1;

                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end"
                    style={{ height: `${chartHeight}px` }}
                    onMouseEnter={(e) => {
                      const parentRect = ref.current?.getBoundingClientRect();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (!parentRect) return;
                      setTooltip({
                        visible: true,
                        x: rect.left - parentRect.left + rect.width / 2,
                        y: rect.top - parentRect.top,
                        month: m.label,
                        count: m.count,
                      });
                    }}
                    onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                  >
                    <div
                      className="w-[70%] rounded-sm flex items-end justify-center pb-0.5 overflow-hidden"
                      style={{
                        height: isVisible ? `${Math.max(barH, m.count > 0 ? 24 : 0)}px` : "0px",
                        border: `1px solid ${isCurrent ? WT.accent : `color-mix(in srgb, ${WT.accent} 50%, transparent)`}`,
                        backgroundColor: `color-mix(in srgb, ${WT.accent} ${isCurrent ? '25%' : '12%'}, transparent)`,
                        transitionProperty: "height",
                        transitionDuration: reducedMotion ? "200ms" : "600ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                        transitionTimingFunction: WIDGET_EASE_CSS,
                      }}
                    >
                      {barH >= 24 && (
                        <span className="font-mono text-micro font-medium" style={{ color: WT.accent }}>
                          {m.count}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Month labels */}
            <div className="flex gap-[4px] mt-1">
              {bookings.months.map((m, i) => (
                <span key={i} className="flex-1 text-center font-mono text-micro text-text-mute uppercase">
                  {m.label}
                </span>
              ))}
            </div>
          </ScrollFade>
        )}

      </div>
    </Card>
  );
}
