"use client";

import { useMemo, useState, useRef } from "react";
import { DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BAR_COLOR = "#C4A868";
const BAR_COLOR_PAST = "rgba(196, 168, 104, 0.6)";
const GHOST_OPACITY = 0.2;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface RevenuePulseWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  invoices: Invoice[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RevenuePulseWidget({
  size,
  config,
  invoices,
  isLoading,
  onNavigate,
}: RevenuePulseWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const period = (config.period as string) ?? "ytd";

  // Group paid invoices by month
  const monthlyData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Determine how many months to show
    let monthCount: number;
    let startMonth: number;
    let startYear: number;

    if (period === "6mo") {
      monthCount = 6;
      const s = new Date(currentYear, currentMonth - 5, 1);
      startMonth = s.getMonth();
      startYear = s.getFullYear();
    } else if (period === "12mo") {
      monthCount = 12;
      const s = new Date(currentYear, currentMonth - 11, 1);
      startMonth = s.getMonth();
      startYear = s.getFullYear();
    } else {
      // ytd
      monthCount = currentMonth + 1;
      startMonth = 0;
      startYear = currentYear;
    }

    // Build month buckets for this year
    const months: { year: number; month: number; label: string; amount: number; lastYearAmount: number }[] = [];
    for (let i = 0; i < monthCount; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      months.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleString("en", { month: "short" }),
        amount: 0,
        lastYearAmount: 0,
      });
    }

    // Sum paid invoices into months
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status !== InvoiceStatus.Paid || !inv.paidAt) continue;
      const paidDate = new Date(inv.paidAt);
      const paidYear = paidDate.getFullYear();
      const paidMonth = paidDate.getMonth();

      for (const m of months) {
        if (paidYear === m.year && paidMonth === m.month) {
          m.amount += inv.amountPaid;
        }
        // Last year comparison
        if (paidYear === m.year - 1 && paidMonth === m.month) {
          m.lastYearAmount += inv.amountPaid;
        }
      }
    }

    // MTD = last month's amount (or current partial month)
    const mtd = months[months.length - 1]?.amount ?? 0;
    const ytd = months.reduce((sum, m) => sum + m.amount, 0);
    const maxAmount = Math.max(...months.map((m) => Math.max(m.amount, m.lastYearAmount)), 1);

    // Prior month for trend
    const priorAmount = months.length >= 2 ? months[months.length - 2]?.amount ?? 0 : 0;
    const trend: "up" | "down" | "neutral" = mtd > priorAmount ? "up" : mtd < priorAmount ? "down" : "neutral";

    return { months, mtd, ytd, maxAmount, trend };
  }, [invoices, period]);

  const animatedMtd = useAnimatedValue(isVisible ? Math.round(monthlyData.mtd) : 0, 1000);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    month: string;
    amount: number;
    lastYear: number;
  }>({ visible: false, x: 0, y: 0, month: "", amount: 0, lastYear: 0 });

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="bar-chart" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  const hasData = monthlyData.months.some((m) => m.amount > 0);
  if (!hasData) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex flex-col items-start justify-center h-[calc(100%-28px)]">
          <DollarSign className="w-6 h-6 text-text-quaternary opacity-20 mb-1" />
          <span className="font-mohave text-[13px] text-text-tertiary">{t("revenuePulse.noData") ?? "No paid invoices yet"}</span>
        </CardContent>
      </Card>
    );
  }

  // ── XS: MTD number + trend ──────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full flex flex-col items-start justify-center px-3">
        <span className="font-mono text-[28px] font-medium leading-none" style={{ color: BAR_COLOR }}>
          {formatCurrency(animatedMtd)}
        </span>
        <div className="flex items-center gap-1 mt-1">
          <span className="font-mono text-[11px]" style={{
            color: monthlyData.trend === "up" ? "#6B8F71" : monthlyData.trend === "down" ? "#B58289" : "var(--text-tertiary)",
          }}>
            {monthlyData.trend === "up" ? "↑" : monthlyData.trend === "down" ? "↓" : "→"}
          </span>
          <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
            {t("revenuePulse.mtdRevenue") ?? "MTD Revenue"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: MTD + sparkline + YTD ───────────────────────────────────────────
  if (size === "sm") {
    const sparkData = monthlyData.months.map((m) => m.amount);
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[20px] font-medium" style={{ color: BAR_COLOR }}>
              {formatCurrency(monthlyData.mtd)}
            </span>
            <Sparkline data={sparkData} width={60} height={24} color={BAR_COLOR} />
          </div>
          <p className="font-mono text-[11px] text-text-tertiary mt-0.5">
            {t("revenuePulse.ytd") ?? "YTD"}: {formatCurrency(monthlyData.ytd)}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: Bar chart ──────────────────────────────────────────────────
  const showGhosts = size === "lg";
  const chartHeight = 80;

  return (
    <Card className="h-full cursor-pointer" ref={ref} onClick={() => onNavigate("/invoices?status=paid")}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("revenuePulse.title") ?? "Revenue"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">
          {new Date().getFullYear()}
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden relative">
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
          <TooltipRow label={tooltip.month} value={formatCurrency(tooltip.amount)} color={BAR_COLOR} />
          {showGhosts && tooltip.lastYear > 0 && (
            <TooltipRow
              label={`vs ${new Date().getFullYear() - 1}`}
              value={formatCurrency(tooltip.lastYear)}
              delta={{
                value: tooltip.lastYear > 0
                  ? `${Math.round(((tooltip.amount - tooltip.lastYear) / tooltip.lastYear) * 100)}%`
                  : "--",
                direction: tooltip.amount >= tooltip.lastYear ? "up" : "down",
              }}
            />
          )}
        </WidgetTooltip>

        {/* Bar chart */}
        <div className="flex items-end gap-[4px]" style={{ height: `${chartHeight}px` }}>
          {monthlyData.months.map((m, i) => {
            const barH = (m.amount / monthlyData.maxAmount) * chartHeight;
            const ghostH = showGhosts ? (m.lastYearAmount / monthlyData.maxAmount) * chartHeight : 0;
            const isCurrent = i === monthlyData.months.length - 1;

            return (
              <div
                key={`${m.year}-${m.month}`}
                className="flex-1 flex flex-col items-center justify-end relative"
                style={{ height: `${chartHeight}px` }}
                onMouseEnter={(e) => {
                  const parentRect = ref.current?.getBoundingClientRect();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  if (!parentRect) return;
                  setTooltip({
                    visible: true,
                    x: rect.left - parentRect.left + rect.width / 2,
                    y: rect.top - parentRect.top,
                    month: `${m.label} ${m.year}`,
                    amount: m.amount,
                    lastYear: m.lastYearAmount,
                  });
                }}
                onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
              >
                {/* Ghost bar (last year) */}
                {showGhosts && ghostH > 0 && (
                  <div
                    className="absolute bottom-0 w-[70%] rounded-t-sm"
                    style={{
                      height: `${ghostH}px`,
                      backgroundColor: BAR_COLOR,
                      opacity: isVisible ? GHOST_OPACITY : 0,
                      transition: reducedMotion ? "opacity 200ms ease" : `opacity 400ms ease ${500 + 200}ms`,
                    }}
                  />
                )}
                {/* Primary bar */}
                <div
                  className="w-[70%] rounded-t-sm relative z-10 transition-all"
                  style={{
                    height: isVisible ? `${Math.max(barH, m.amount > 0 ? 2 : 0)}px` : "0px",
                    backgroundColor: isCurrent ? BAR_COLOR : BAR_COLOR_PAST,
                    transitionDuration: reducedMotion ? "200ms" : "600ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Bottom summary */}
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border-primary">
          <div>
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
              {t("revenuePulse.mtdRevenue") ?? "MTD"}
            </span>
            <p className="font-mono text-[13px] text-text-primary font-medium">
              {formatCurrency(monthlyData.mtd)}
            </p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
              {t("revenuePulse.ytdTotal") ?? "YTD Total"}
            </span>
            <p className="font-mono text-[13px] text-text-primary font-medium">
              {formatCurrency(monthlyData.ytd)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
