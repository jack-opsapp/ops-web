"use client";

import { useMemo, useRef } from "react";
import { CalendarPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Project } from "@/lib/types/models";
import { ProjectStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface BookingRateWidgetProps {
  size: WidgetSize;
  projects: Project[];
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BookingRateWidget({
  size,
  projects,
  isLoading,
}: BookingRateWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const bookings = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Count new projects created per month (last 6 months)
    const monthly: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const count = projects.filter((p) => {
        if (p.deletedAt) return false;
        // Count projects that moved to Accepted or beyond
        if (p.status === ProjectStatus.RFQ || p.status === ProjectStatus.Estimated) return false;
        const created = p.createdAt ? new Date(p.createdAt) : null;
        if (!created) return false;
        return created >= d && created < nextD;
      }).length;
      monthly.push(count);
    }

    const thisMonth = monthly[monthly.length - 1];
    const lastMonth = monthly[monthly.length - 2];
    const delta = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
    const trend: "up" | "down" | "neutral" = thisMonth > lastMonth ? "up" : thisMonth < lastMonth ? "down" : "neutral";

    return { monthly, thisMonth, lastMonth, delta, trend };
  }, [projects]);

  const animatedCount = useAnimatedValue(isVisible ? bookings.thisMonth : 0, 1000);

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("bookingRate.title") ?? "Bookings"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </CardContent>
      </Card>
    );
  }

  // ── XS ──────────────────────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full flex flex-col items-start justify-center px-3" ref={ref}>
        <span className="font-mono text-[28px] font-medium leading-none text-text-primary">
          {animatedCount}
        </span>
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider mt-1">
          {t("bookingRate.thisMonth") ?? "This month"}
        </span>
      </Card>
    );
  }

  // ── SM ──────────────────────────────────────────────────────────────────
  const trendColor = bookings.trend === "up" ? "#6B8F71" : bookings.trend === "down" ? "#B58289" : "var(--text-tertiary)";

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("bookingRate.title") ?? "Bookings"}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[20px] font-medium text-text-primary">
            {animatedCount}
          </span>
          <Sparkline data={bookings.monthly} width={60} height={24} color="#597794" />
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="font-mono text-[11px]" style={{ color: trendColor }}>
            {bookings.trend === "up" ? "↑" : bookings.trend === "down" ? "↓" : "→"}
            {bookings.delta !== 0 && ` ${Math.abs(bookings.delta)}%`}
          </span>
          <span className="font-kosugi text-[9px] text-text-tertiary">
            {t("bookingRate.vsLastMonth") ?? "vs last month"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
