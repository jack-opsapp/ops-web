"use client";

import { useMemo, useState, useRef } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

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
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;
  const period = (config.period as string) ?? "ytd";

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  // ── Compute monthly revenue data ──────────────────────────────────────
  const monthlyData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

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
        label: d.toLocaleString("en", { month: "short" }),
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
      .slice(0, 5);
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

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="bar-chart" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  const hasData = monthlyData.months.some((m) => m.amount > 0);
  if (!hasData) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              $0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("revenuePulse.noData") ?? "No payments received"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("revenuePulse.viewInvoices") ?? "View Invoices"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Header + Hero (MTD number + trend) ────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices?status=paid")}>
        <div className="h-full flex flex-col pt-3">
          <span className={`font-mono ${formatCurrency(animatedMtd).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none text-text-primary`}>
            {formatCurrency(animatedMtd)}
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

  // ── SM: Hero + title + sparkline/YTD ───────────────────────────────────
  if (size === "sm") {
    const sparkData = monthlyData.months.map((m) => m.amount);
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {formatCurrency(animatedMtd)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/invoices?status=paid"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
          {/* Row 3: Sparkline + YTD */}
          <div className="flex items-center gap-2 mt-1">
            <Sparkline data={sparkData} width={60} height={20} color={WT.revenue} />
            <span className="font-mono text-micro-sm text-text-tertiary">
              {t("revenuePulse.ytd") ?? "YTD"}: {formatCurrency(monthlyData.ytd)}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── MD / LG: Bar chart + detail ───────────────────────────────────────
  const showGhosts = showActions(size);
  const chartHeight = compact ? 80 : showActions(size) ? 100 : 80;

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("revenuePulse.title") ?? "Revenue"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {new Date().getFullYear()}
          </span>
        </div>

        {/* HERO — animated MTD */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold text-text-primary leading-none`}>
            {formatCurrency(animatedMtd)}
          </span>
          {monthlyData.trend === "up" ? (
            <ChevronUp className="w-4 h-4" style={{ color: WT.success }} />
          ) : monthlyData.trend === "down" ? (
            <ChevronDown className="w-4 h-4" style={{ color: WT.error }} />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-disabled" />
          )}
        </div>

        {/* DETAIL ZONE — MD+ */}
        {showDetail(size) && (
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {/* Bar chart */}
            <div className="relative">
              <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
                <TooltipRow label={tooltip.month} value={formatCurrency(tooltip.amount)} color={WT.revenue} />
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
                            backgroundColor: WT.revenue,
                            opacity: isVisible ? GHOST_OPACITY : 0,
                            transition: reducedMotion ? "opacity 200ms ease" : `opacity 400ms ease ${500 + 200}ms`,
                          }}
                        />
                      )}
                      {/* Primary bar */}
                      <div
                        className="w-[70%] rounded-t-sm relative z-10"
                        style={{
                          height: isVisible ? `${Math.max(barH, m.amount > 0 ? 2 : 0)}px` : "0px",
                          backgroundColor: WT.revenue,
                          opacity: isCurrent ? 1 : 0.6,
                          transitionProperty: "height, opacity",
                          transitionDuration: reducedMotion ? "200ms" : "600ms",
                          transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom summary: MTD vs YTD */}
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border-subtle">
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("revenuePulse.mtdRevenue") ?? "MTD"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCurrency(monthlyData.mtd)}
                </p>
              </div>
              <div className="text-right">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("revenuePulse.ytdTotal") ?? "YTD Total"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCurrency(monthlyData.ytd)}
                </p>
              </div>
            </div>

            {/* Top clients (LG only) */}
            {showActions(size) && topClients.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border-subtle">
                {topClients.map((client, i) => (
                  <div
                    key={client.clientId}
                    className="flex items-center justify-between py-1 px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    style={{
                      opacity: isVisible ? 1 : 0,
                      transform: isVisible ? "translateY(0)" : "translateY(4px)",
                      transition: reducedMotion
                        ? "opacity 200ms ease"
                        : `opacity 300ms ease ${600 + i * 50}ms, transform 300ms ease ${600 + i * 50}ms`,
                    }}
                    onClick={() => onNavigate(`/clients/${client.clientId}`)}
                  >
                    <span className="font-mohave text-caption-sm text-text-primary truncate flex-1 min-w-0">
                      {client.name}
                    </span>
                    <span className="font-mono text-micro-sm text-text-secondary shrink-0 ml-2">
                      {formatCurrency(client.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FOOTER — SM+ */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/invoices?status=paid")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("revenuePulse.viewAll") ?? "View Invoices"}
          </button>
        )}
      </div>
    </Card>
  );
}
