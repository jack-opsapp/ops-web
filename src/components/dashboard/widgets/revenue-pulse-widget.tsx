"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS, WIDGET_COLLAPSE_DURATION } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
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
    const clientMap = new Map<string, { name: string; clientId: string; total: number }>();
    for (const inv of invoices) {
      if (inv.deletedAt || inv.status !== InvoiceStatus.Paid || !inv.paidAt) continue;
      const cid = inv.clientId;
      if (!cid) continue;
      const existing = clientMap.get(cid);
      if (existing) {
        existing.total += inv.amountPaid;
      } else {
        clientMap.set(cid, {
          name: inv.client?.name ?? "Unknown",
          clientId: cid,
          total: inv.amountPaid,
        });
      }
    }
    return Array.from(clientMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [invoices, size]);

  const animatedMtd = useAnimatedValue(isVisible ? Math.round(monthlyData.mtd) : 0, 1000);

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
                    backgroundColor: WT.revenue,
                    opacity: isVisible ? GHOST_OPACITY : 0,
                    transition: reducedMotion ? "opacity 200ms ease" : `opacity 400ms ${WIDGET_EASE_CSS} ${500 + 200}ms`,
                  }}
                />
              )}
              <div
                className="w-[70%] rounded-t-sm relative z-10"
                style={{
                  height: isVisible ? `${Math.max(barH, m.amount > 0 ? 2 : 0)}px` : "0px",
                  backgroundColor: WT.revenue,
                  opacity: isCurrent ? 1 : 0.6,
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
    ),
    [monthlyData, isVisible, reducedMotion]
  );

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
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
        <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices")}>
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">$0</span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("revenuePulse.title") ?? "Revenue"}
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
              <span className="font-mono text-data-lg font-bold text-text-disabled leading-none">$0</span>
              <button onClick={() => onNavigate("/invoices")} className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("revenuePulse.title") ?? "Revenue"}
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1 truncate">
              {t("revenuePulse.noData") ?? "No payments received"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-disabled leading-none">$0</span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("revenuePulse.noData") ?? "No payments received"}
            </span>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
            {t("revenuePulse.viewInvoices") ?? "View Invoices"}
          </span>
        </div>
      </Card>
    );
  }

  // ── XS: Header + Hero (MTD number + trend) ────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices?status=paid")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className={`font-mono ${formatCompactCurrency(animatedMtd).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none text-text-primary`}>
            {formatCompactCurrency(animatedMtd)}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
          <div className="flex items-center gap-0.5">
            {monthlyData.trend === "up" ? (
              <ChevronUp className="w-3 h-3" style={{ color: WT.success }} />
            ) : monthlyData.trend === "down" ? (
              <ChevronDown className="w-3 h-3" style={{ color: WT.error }} />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-disabled" />
            )}
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("revenuePulse.mtdRevenue") ?? "MTD"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── SM: WidgetBackgroundChart with bar chart behind text ──────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={renderBarChart(80, false)}
          opacity={0.3}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
                {formatCompactCurrency(animatedMtd)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/invoices?status=paid"); }}
                className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("revenuePulse.title") ?? "Revenue"}
            </span>
            <span className="font-mono text-micro-sm text-text-tertiary mt-auto">
              {t("revenuePulse.ytd") ?? "YTD"}: {formatCompactCurrency(monthlyData.ytd)}
            </span>
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
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            {/* Header with period picker */}
            <div className="flex items-center justify-between mb-2">
              <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
                {t("revenuePulse.title") ?? "Revenue"}
              </span>
              <WidgetPeriodPicker
                options={periodOptions}
                value={period}
                onChange={setPeriod}
                size={size}
              />
            </div>

            {/* Hero — animated MTD */}
            <div className="flex items-baseline gap-2 mb-2">
              <span className={`font-mono ${heroClass} font-bold text-text-primary leading-none`}>
                {formatCompactCurrency(animatedMtd)}
              </span>
              {monthlyData.trend === "up" ? (
                <ChevronUp className="w-4 h-4" style={{ color: WT.success }} />
              ) : monthlyData.trend === "down" ? (
                <ChevronDown className="w-4 h-4" style={{ color: WT.error }} />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-disabled" />
              )}
            </div>

            {/* Bottom summary: MTD vs YTD */}
            <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-border-subtle">
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("revenuePulse.mtdRevenue") ?? "MTD"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCompactCurrency(monthlyData.mtd)}
                </p>
              </div>
              <div className="text-right">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("revenuePulse.ytdTotal") ?? "YTD Total"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCompactCurrency(monthlyData.ytd)}
                </p>
              </div>
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
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
          <WidgetPeriodPicker
            options={periodOptions}
            value={period}
            onChange={setPeriod}
            size={size}
          />
        </div>

        {/* HERO — animated MTD */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold text-text-primary leading-none`}>
            {formatCompactCurrency(animatedMtd)}
          </span>
          {monthlyData.trend === "up" ? (
            <ChevronUp className="w-4 h-4" style={{ color: WT.success }} />
          ) : monthlyData.trend === "down" ? (
            <ChevronDown className="w-4 h-4" style={{ color: WT.error }} />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-disabled" />
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
                    : "--",
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
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("revenuePulse.mtdRevenue") ?? "MTD"}
            </span>
            <p className="font-mono text-data-sm text-text-primary font-medium">
              {formatCompactCurrency(monthlyData.mtd)}
            </p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("revenuePulse.ytdTotal") ?? "YTD Total"}
            </span>
            <p className="font-mono text-data-sm text-text-primary font-medium">
              {formatCompactCurrency(monthlyData.ytd)}
            </p>
          </div>
        </div>

        {/* Top clients — scrollable list that triggers hero collapse */}
        {topClients.length > 0 && (
          <div
            className="mt-2 pt-2 border-t border-border-subtle flex-1 min-h-0 overflow-y-auto scrollbar-hide"
            onScroll={handleListScroll}
          >
            {visibleClients.map((client, i) => (
              <WidgetLineItem
                key={client.clientId}
                primary={client.name}
                metric={formatCompactCurrency(client.total)}
                onClick={() => onNavigate(`/clients/${client.clientId}`)}
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
          </div>
        )}

        {/* FOOTER */}
        <button
          onClick={() => onNavigate("/invoices?status=paid")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left shrink-0"
        >
          {t("revenuePulse.viewAll") ?? "View Invoices"}
        </button>
      </div>
    </Card>
  );
}
