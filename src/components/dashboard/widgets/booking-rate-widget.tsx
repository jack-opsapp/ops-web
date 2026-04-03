"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
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
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("bookingRate.title") ?? "Bookings"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (bookings.thisMonth === 0 && bookings.lastMonth === 0) {
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">0</span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("bookingRate.title") ?? "Bookings"}
            </span>
          </div>
        </Card>
      );
    }
    if (size === "sm") {
      return (
        <Card className="h-full p-0">
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold text-text-disabled leading-none">0</span>
              <button onClick={() => onNavigate("/projects")} className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("bookingRate.title") ?? "Bookings"}
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1 truncate">
              {t("bookingRate.noProjects") ?? "No projects yet"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("bookingRate.title") ?? "Bookings"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">0</span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("bookingRate.noProjects") ?? "No projects yet"}
            </span>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
            {t("bookingRate.viewProjects") ?? "View Projects"}
          </span>
        </div>
      </Card>
    );
  }

  const trendColor = bookings.trend === "up" ? WT.success : bookings.trend === "down" ? WT.error : undefined;

  // ── XS: Hero count + trend ────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text-primary">
            {animatedCount}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("bookingRate.title") ?? "Bookings"}
          </span>
          <div className="flex items-center gap-0.5">
            {bookings.trend === "up" ? (
              <ChevronUp className="w-3 h-3" style={{ color: WT.success }} />
            ) : bookings.trend === "down" ? (
              <ChevronDown className="w-3 h-3" style={{ color: WT.error }} />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-disabled" />
            )}
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("bookingRate.thisMonth") ?? "This month"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + background sparkline + trend ────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={<Sparkline data={bookings.sparkData} width={200} height={100} color={WT.accent} />}
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            {/* Row 1: Hero number + tiny nav icon */}
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
                {animatedCount}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/projects"); }}
                className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            {/* Row 2: Title */}
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("bookingRate.title") ?? "Bookings"}
            </span>
            {/* Row 3: Trend indicator */}
            <div className="flex items-center gap-0.5 mt-1">
              {bookings.trend === "up" ? (
                <ChevronUp className="w-3 h-3" style={{ color: WT.success }} />
              ) : bookings.trend === "down" ? (
                <ChevronDown className="w-3 h-3" style={{ color: WT.error }} />
              ) : (
                <ChevronRight className="w-3 h-3 text-text-disabled" />
              )}
              <span className="font-mono text-micro-sm" style={{ color: trendColor }}>
                {bookings.delta !== 0 && `${Math.abs(bookings.delta)}%`}
              </span>
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
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("bookingRate.title") ?? "Bookings"}
          </span>
        </div>

        {/* HERO */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold text-text-primary leading-none`}>
            {animatedCount}
          </span>
          {bookings.trend === "up" ? (
            <ChevronUp className="w-4 h-4" style={{ color: WT.success }} />
          ) : bookings.trend === "down" ? (
            <ChevronDown className="w-4 h-4" style={{ color: WT.error }} />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-disabled" />
          )}
          {bookings.delta !== 0 && (
            <span className="font-mono text-micro" style={{ color: trendColor }}>
              {Math.abs(bookings.delta)}%
            </span>
          )}
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
                      className="w-[70%] rounded-t-sm"
                      style={{
                        height: isVisible ? `${Math.max(barH, m.count > 0 ? 2 : 0)}px` : "0px",
                        backgroundColor: WT.accent,
                        opacity: isCurrent ? 1 : 0.5,
                        transitionProperty: "height, opacity",
                        transitionDuration: reducedMotion ? "200ms" : "600ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                        transitionTimingFunction: WIDGET_EASE_CSS,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {/* Month labels */}
            <div className="flex gap-[4px] mt-1">
              {bookings.months.map((m, i) => (
                <span key={i} className="flex-1 text-center font-kosugi text-micro-sm text-text-disabled uppercase">
                  {m.label}
                </span>
              ))}
            </div>
          </ScrollFade>
        )}

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/projects")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("bookingRate.viewProjects") ?? "View Projects"}
          </button>
        )}
      </div>
    </Card>
  );
}
