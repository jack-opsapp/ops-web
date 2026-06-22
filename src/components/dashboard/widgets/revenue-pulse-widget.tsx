"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { Sparkline } from "./shared/sparkline";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetTitle } from "./shared/widget-title";
import { ScrollFade } from "./shared/scroll-fade";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS, WIDGET_COLLAPSE_DURATION } from "./shared/widget-motion";
import { formatCompactCurrency, computeDeltaPct } from "./shared/widget-utils";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { useRevenueProjection } from "@/lib/hooks/use-forecast";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

const GHOST_OPACITY = 0.2;
const CLIENT_VISIBLE_COUNT = 5;

const PERIOD_KEYS = [
  { value: "7d", i18nKey: "period.7d" },
  { value: "30d", i18nKey: "period.30d" },
  { value: "90d", i18nKey: "period.90d" },
  { value: "ytd", i18nKey: "period.ytd" },
] as const;

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
  const openEntity = useWidgetEntityOpen();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;
  const reducedMotion = useReducedMotion();

  const periodOptions = useMemo(() => PERIOD_KEYS.map((p) => ({ value: p.value, label: t(p.i18nKey) })), [t]);
  const [period, setPeriod] = useState((config.period as string) ?? "ytd");
  const [clientsExpanded, setClientsExpanded] = useState(false);
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  // ── Compute monthly revenue data ──────────────────────────────────────
  const monthlyData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let monthCount: number;
    let startMonth: number;
    let startYear: number;

    if (period === "7d" || period === "30d" || period === "90d") {
      // For day-based periods, still show monthly bars for the relevant span
      const daysMap: Record<string, number> = { "7d": 1, "30d": 1, "90d": 3 };
      monthCount = daysMap[period] ?? 1;
      if (period === "7d") {
        // Show just current month
        monthCount = 1;
        startMonth = currentMonth;
        startYear = currentYear;
      } else if (period === "30d") {
        monthCount = 1;
        startMonth = currentMonth;
        startYear = currentYear;
      } else {
        monthCount = 3;
        const s = new Date(currentYear, currentMonth - 2, 1);
        startMonth = s.getMonth();
        startYear = s.getFullYear();
      }
    } else if (period === "6mo") {
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

    const months: { year: number; month: number; label: string; amount: number; lastYearAmount: number }[] = [];
    for (let i = 0; i < monthCount; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      months.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleString("default", { month: "short" }),
        amount: 0,
        lastYearAmount: 0,
      });
    }

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
        if (paidYear === m.year - 1 && paidMonth === m.month) {
          m.lastYearAmount += inv.amountPaid;
        }
      }
    }

    const mtd = months[months.length - 1]?.amount ?? 0;
    const ytd = months.reduce((sum, m) => sum + m.amount, 0);
    const maxAmount = Math.max(...months.map((m) => Math.max(m.amount, m.lastYearAmount)), 1);
    const priorAmount = months.length >= 2 ? months[months.length - 2]?.amount ?? 0 : 0;
    const trend: "up" | "down" | "neutral" = mtd > priorAmount ? "up" : mtd < priorAmount ? "down" : "neutral";

    return { months, mtd, ytd, maxAmount, trend };
  }, [invoices, period]);

  // ── Top clients by revenue (LG only) ──────────────────────────────────
  const topClients = useMemo(() => {
    if (!showActions(size)) return [];
    const clientMap = new Map<string, { name: string; clientId: string; total: number; invoiceCount: number; projectName: string | null }>();
    for (const inv of invoices) {
      if (inv.deletedAt || inv.status !== InvoiceStatus.Paid || !inv.paidAt) continue;
      const cid = inv.clientId;
      if (!cid) continue;
      const existing = clientMap.get(cid);
      if (existing) {
        existing.total += inv.amountPaid;
        existing.invoiceCount += 1;
      } else {
        clientMap.set(cid, {
          name: inv.client?.name ?? "Unknown",
          clientId: cid,
          total: inv.amountPaid,
          invoiceCount: 1,
          projectName: inv.project?.title ?? null,
        });
      }
    }
    return Array.from(clientMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [invoices, size]);

  // ── Sparkline data for SM trendline background ──────────────────────
  const sparklineData = useMemo(() => {
    // Use last 6 months of paid revenue for the trendline
    const now = new Date();
    const months: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      let total = 0;
      for (const inv of invoices) {
        if (inv.deletedAt || inv.status !== InvoiceStatus.Paid || !inv.paidAt) continue;
        const paidDate = new Date(inv.paidAt);
        if (paidDate.getFullYear() === year && paidDate.getMonth() === month) {
          total += inv.amountPaid;
        }
      }
      months.push(total);
    }
    return months;
  }, [invoices]);

  const { data: projection } = useRevenueProjection();
  const animatedMtd = useAnimatedValue(isVisible ? Math.round(monthlyData.mtd) : 0, 1000);
  const deltaPercent = computeDeltaPct(monthlyData.mtd, monthlyData.months.length >= 2 ? monthlyData.months[monthlyData.months.length - 2]?.amount ?? 0 : 0);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    month: string;
    amount: number;
    lastYear: number;
  }>({ visible: false, x: 0, y: 0, month: "", amount: 0, lastYear: 0 });

  // ── Scroll handler for LG hero collapse ───────────────────────────────
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = (e.target as HTMLElement).scrollTop;
    // Hysteresis: collapse at 20px, expand at 10px — prevents rapid toggling
    setHeroCollapsed((prev) => {
      if (!prev && scrollTop > 20) return true;
      if (prev && scrollTop < 10) return false;
      return prev;
    });
  }, []);

  // ── Bar chart renderer (reused by SM/MD/LG) ──────────────────────────
  const renderBarChart = useCallback(
    (chartHeight: number, showGhosts: boolean) => (
      <div className="flex items-end gap-[4px] h-full w-full" style={{ minHeight: `${chartHeight}px` }}>
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
              {showGhosts && ghostH > 0 && (
                <div
                  className="absolute bottom-0 w-[70%] rounded-t-sm"
                  style={{
                    height: `${ghostH}px`,
                    border: `1px solid ${WT.revenue}`,
                    backgroundColor: `color-mix(in srgb, ${WT.revenue} 8%, transparent)`,
                    opacity: isVisible ? 1 : 0,
                    transition: reducedMotion ? "opacity 200ms ease" : `opacity 400ms ${WIDGET_EASE_CSS} ${500 + 200}ms`,
                  }}
                />
              )}
              <div
                className="w-[70%] rounded-sm relative z-10 flex items-end justify-center pb-0.5 overflow-hidden"
                style={{
                  height: isVisible ? `${Math.max(barH, m.amount > 0 ? 24 : 0)}px` : "0px",
                  border: isCurrent
                    ? `1px solid ${WT.revenue}`
                    : `1px solid color-mix(in srgb, ${WT.revenue} 50%, transparent)`,
                  backgroundColor: `color-mix(in srgb, ${WT.revenue} ${isCurrent ? '25%' : '12%'}, transparent)`,
                  transitionProperty: "height",
                  transitionDuration: reducedMotion ? "200ms" : "600ms",
                  transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                  transitionTimingFunction: WIDGET_EASE_CSS,
                }}
              >
                {barH >= 24 && (
                  <span className="font-mono text-micro font-semibold" style={{ color: WT.revenue }}>
                    {formatCompactCurrency(m.amount)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    ),
    [monthlyData, isVisible, reducedMotion]
  );

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <WidgetTitle>
            {t("revenuePulse.title") ?? "Revenue"}
          </WidgetTitle>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="bar-chart" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  const hasData = monthlyData.months.some((m) => m.amount > 0);
  if (!hasData) {
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-mute leading-none">$0</span>
            <WidgetTitle className="mt-1">
              {t("revenuePulse.title") ?? "Revenue"}
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
              <span className="font-mono text-data-lg font-bold text-text-mute leading-none">$0</span>
              <button onClick={() => onNavigate("/books?segment=invoices")} className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <WidgetTitle className="mt-1">
              {t("revenuePulse.title") ?? "Revenue"}
            </WidgetTitle>
            <span className="font-mohave text-caption-sm text-text-mute mt-1 truncate">
              {t("revenuePulse.noData") ?? "No payments received"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>
            {t("revenuePulse.title") ?? "Revenue"}
          </WidgetTitle>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-mute leading-none">$0</span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("revenuePulse.noData") ?? "No payments received"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Header + Hero (MTD number + trend) ────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className={`font-mono ${formatCompactCurrency(animatedMtd).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none text-text`}>
            {formatCompactCurrency(animatedMtd)}
          </span>
          <WidgetTitle className="mt-1">
            {t("revenuePulse.title") ?? "Revenue"}
          </WidgetTitle>
          <WidgetTrendContext
            variant="trend"
            direction={monthlyData.trend}
            delta={`${Math.abs(deltaPercent)}%`}
            comparison={t("trend.vsLastMonth") ?? "vs last month"}
          />
        </div>
      </Card>
    );
  }

  // ── SM: WidgetBackgroundChart with sparkline trendline behind text ──
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={
            <div className="h-full w-full flex items-end justify-center">
              <Sparkline
                data={sparklineData.length >= 2 ? sparklineData : [0, monthlyData.mtd]}
                width={140}
                height={60}
                color={WT.revenue}
                showDots={false}
              />
            </div>
          }
          opacity={0.4}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text">
                {formatCompactCurrency(animatedMtd)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/books?segment=invoices&status=paid"); }}
                className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <WidgetTitle className="mt-0.5">
              {t("revenuePulse.title") ?? "Revenue"}
            </WidgetTitle>
            <WidgetTrendContext
              variant="trend"
              direction={monthlyData.trend}
              delta={`${Math.abs(deltaPercent)}%`}
              comparison={t("trend.vsLastMonth") ?? "vs last month"}
            />
            <span className="font-mono text-micro text-text-3 mt-0.5">
              {t("revenuePulse.ytd") ?? "YTD"}: {formatCompactCurrency(monthlyData.ytd)}
            </span>
            {projection && (
              <span className="font-mono text-micro text-text-mute mt-0.5">
                {t("revenuePulse.forecast30d") ?? "30d forecast"}: {formatCompactCurrency(projection.thirtyDay.total)}
              </span>
            )}
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── MD: WidgetBackgroundChart + WidgetPeriodPicker ────────────────────
  if (size === "md") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={renderBarChart(120, false)}
          opacity={0.45}
        >
          <div className="h-full flex flex-col p-3">
            {/* Header with period picker */}
            <div className="flex items-center justify-between mb-2">
              <WidgetTitle>
                {t("revenuePulse.title") ?? "Revenue"}
              </WidgetTitle>
              <WidgetPeriodPicker
                options={periodOptions}
                value={period}
                onChange={setPeriod}
                size={size}
              />
            </div>

            {/* Hero — animated MTD + YTD beneath */}
            <div className="flex items-baseline gap-2">
              <span className={`font-mono ${heroClass} font-bold text-text leading-none`}>
                {formatCompactCurrency(animatedMtd)}
              </span>
            </div>
            <WidgetTrendContext
              variant="trend"
              direction={monthlyData.trend}
              delta={`${Math.abs(deltaPercent)}%`}
              comparison={t("trend.vsLastMonth") ?? "vs last month"}
            />
            <div className="flex items-center gap-2 mt-0.5 mb-2">
              <span className="font-mono text-micro text-text-3">
                {t("revenuePulse.ytdTotal") ?? "YTD"}: {formatCompactCurrency(monthlyData.ytd)}
              </span>
              {projection && (
                <>
                  <span className="text-text-mute">·</span>
                  <span className="font-mono text-micro text-text-mute">
                    {t("revenuePulse.forecast30d") ?? "30d forecast"}: {formatCompactCurrency(projection.thirtyDay.total)}
                  </span>
                </>
              )}
            </div>
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── LG: Period picker + HeroCollapse + client list with WidgetMoreButton
  const showGhosts = true;
  const chartHeight = 160;
  const visibleClients = clientsExpanded ? topClients : topClients.slice(0, CLIENT_VISIBLE_COUNT);
  const remainingClients = topClients.length - CLIENT_VISIBLE_COUNT;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER with period picker */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>
            {t("revenuePulse.title") ?? "Revenue"}
          </WidgetTitle>
          <WidgetPeriodPicker
            options={periodOptions}
            value={period}
            onChange={setPeriod}
            size={size}
          />
        </div>

        {/* HERO — animated MTD */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`font-mono ${heroClass} font-bold text-text leading-none`}>
            {formatCompactCurrency(animatedMtd)}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <WidgetTrendContext
            variant="trend"
            direction={monthlyData.trend}
            delta={`${Math.abs(deltaPercent)}%`}
            comparison={t("trend.vsLastMonth") ?? "vs last month"}
          />
          {projection && (
            <>
              <span className="text-text-mute">·</span>
              <span className="font-mono text-micro text-text-mute">
                {t("revenuePulse.forecast30d") ?? "30d forecast"}: {formatCompactCurrency(projection.thirtyDay.total)}
              </span>
            </>
          )}
        </div>

        {/* COLLAPSIBLE BAR CHART */}
        <WidgetHeroCollapse
          collapsed={heroCollapsed}
          collapsedHeight="80px"
          expandedHeight="200px"
        >
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.month} value={formatCompactCurrency(tooltip.amount)} color={WT.revenue} />
            {showGhosts && tooltip.lastYear > 0 && (
              <TooltipRow
                label={`vs ${new Date().getFullYear() - 1}`}
                value={formatCompactCurrency(tooltip.lastYear)}
                delta={{
                  value: tooltip.lastYear > 0
                    ? `${Math.round(((tooltip.amount - tooltip.lastYear) / tooltip.lastYear) * 100)}%`
                    : "—",
                  direction: tooltip.amount >= tooltip.lastYear ? "up" : "down",
                }}
              />
            )}
          </WidgetTooltip>

          <div
            style={{
              transform: heroCollapsed ? "scaleY(0.5)" : "scaleY(1)",
              transformOrigin: "top",
              transition: reducedMotion ? "none" : `transform ${WIDGET_COLLAPSE_DURATION}ms ${WIDGET_EASE_CSS}`,
            }}
          >
            {renderBarChart(chartHeight, showGhosts)}
          </div>
        </WidgetHeroCollapse>

        {/* Bottom summary: MTD vs YTD */}
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border-subtle">
          <div>
            <span className="font-mono text-micro text-text-mute uppercase">
              {t("revenuePulse.mtdRevenue") ?? "MTD"}
            </span>
            <p className="font-mono text-data-sm text-text font-medium">
              {formatCompactCurrency(monthlyData.mtd)}
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-micro text-text-mute uppercase">
              {t("revenuePulse.ytdTotal") ?? "YTD Total"}
            </span>
            <p className="font-mono text-data-sm text-text font-medium">
              {formatCompactCurrency(monthlyData.ytd)}
            </p>
          </div>
        </div>

        {/* Top clients — scrollable list that triggers hero collapse */}
        {topClients.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-subtle flex-1 min-h-0">
            <ScrollFade onScroll={handleListScroll}>
              {visibleClients.map((client, i) => (
                <WidgetLineItem
                  key={client.clientId}
                  indicator={{ type: "bar", color: WT.revenue, label: t("revenuePulse.title") ?? "Revenue" }}
                  primary={client.name}
                  secondary={`${client.invoiceCount} ${client.invoiceCount === 1 ? "invoice" : "invoices"}${client.projectName ? ` · ${client.projectName}` : ""}`}
                  metric={formatCompactCurrency(client.total)}
                  onClick={(e) => openEntity({
                    entityType: "client",
                    entityId: client.clientId,
                    title: client.name,
                    color: WT.revenue,
                    event: e,
                    fallbackPath: `/clients/${client.clientId}`,
                  })}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
              {remainingClients > 0 && (
                <WidgetMoreButton
                  remaining={remainingClients}
                  expanded={clientsExpanded}
                  onToggle={() => setClientsExpanded(!clientsExpanded)}
                />
              )}
            </ScrollFade>
          </div>
        )}

      </div>
    </Card>
  );
}
