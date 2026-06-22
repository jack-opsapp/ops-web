"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WidgetTitle } from "./shared/widget-title";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, HERO_SIZE_CLASS, isCompact } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Margin color — WT tokens, thresholds per widget reference spec
// ---------------------------------------------------------------------------
function marginColor(pct: number): string {
  if (pct >= 50) return WT.success;    // Healthy
  if (pct >= 30) return WT.warning;    // Watch
  return WT.error;                      // Low
}

const PERIOD_KEYS = [
  { value: "mtd", i18nKey: "period.mtd" },
  { value: "qtd", i18nKey: "period.qtd" },
  { value: "ytd", i18nKey: "period.ytd" },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ProfitGaugeWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  invoices: Invoice[];
  expenses: ExpenseLineItem[];
  isLoading: boolean;
  onNavigate?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;

  switch (period) {
    case "qtd": {
      const quarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    }
    case "ytd":
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case "mtd":
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }

  return { start, end };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ProfitGaugeWidget({
  size,
  config,
  invoices,
  expenses,
  isLoading,
  onNavigate,
}: ProfitGaugeWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);

  const reducedMotion = useReducedMotion();

  const periodOptions = useMemo(() => PERIOD_KEYS.map((p) => ({ value: p.value, label: t(p.i18nKey) })), [t]);
  const [period, setPeriod] = useState((config.period as string) ?? "mtd");
  const { start, end } = getPeriodRange(period);

  // ── Compute financials ────────────────────────────────────────────────
  const financials = useMemo(() => {
    let revenue = 0;
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status !== InvoiceStatus.Paid) continue;
      const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
      if (!paidDate || paidDate < start || paidDate > end) continue;
      revenue += inv.amountPaid;
    }

    let totalExpenses = 0;
    for (const exp of expenses) {
      if (exp.deletedAt) continue;
      if (exp.status !== "approved") continue;
      if (!exp.expenseDate) continue;
      const expDate = new Date(exp.expenseDate);
      if (expDate < start || expDate > end) continue;
      totalExpenses += exp.amount;
    }

    const profit = revenue - totalExpenses;
    const marginPct = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;

    return { revenue, expenses: totalExpenses, profit, marginPct };
  }, [invoices, expenses, start, end]);

  const animatedMargin = useAnimatedValue(isVisible ? financials.marginPct : 0, 1000);
  const color = marginColor(financials.marginPct);
  const hasData = financials.revenue > 0 || financials.expenses > 0;

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <WidgetTitle>{t("profitGauge.title") ?? "Profit"}</WidgetTitle>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="ring" />
        </div>
      </Card>
    );
  }

  // ── XS: Hero percentage ───────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full" ref={ref}>
        <div className="h-full flex flex-col pt-3">
          <span className="font-mono text-display font-bold leading-none" style={{ color }}>
            {hasData ? `${animatedMargin}%` : "0%"}
          </span>
          <WidgetTitle className="mt-1">{t("profitGauge.title") ?? "Profit"}</WidgetTitle>
          <span className="font-mono text-micro text-text-mute uppercase">
            {t("profitGauge.margin") ?? "Margin"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + stacked breakdown bar + period picker ──────────────────
  if (size === "sm") {
    const revPct = financials.revenue > 0 ? 100 : 0;
    const expPct = financials.revenue > 0 ? Math.min((financials.expenses / financials.revenue) * 100, 100) : 0;

    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + period picker + nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
              {hasData ? `${animatedMargin}%` : "0%"}
            </span>
            <div className="flex items-center gap-1">
              <WidgetPeriodPicker
                options={periodOptions}
                value={period}
                onChange={setPeriod}
                size={size}
              />
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate?.("/books?segment=invoices&view=aging"); }}
                className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
          </div>
          {/* Row 2: Title */}
          <WidgetTitle className="mt-1">{t("profitGauge.title") ?? "Profit"}</WidgetTitle>
          {/* Row 3: Visual breakdown — stacked bar showing revenue vs expense proportion */}
          {hasData && (
            <div className="mt-1.5">
              <div className="w-full h-[8px] rounded-sm overflow-hidden flex" style={{ backgroundColor: WT.faint }}>
                {/* Revenue fills full width as the base */}
                <div
                  className="h-full"
                  style={{
                    width: `${expPct}%`,
                    backgroundColor: WT.cost,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "400ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
                <div
                  className="h-full"
                  style={{
                    width: `${revPct - expPct}%`,
                    backgroundColor: color,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "400ms",
                    transitionDelay: reducedMotion ? "0ms" : "80ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="font-mono text-micro text-text-3">
                  {t("profitGauge.expenses") ?? "Exp"}: {formatCompactCurrency(financials.expenses)}
                </span>
                <span className="font-mono text-micro" style={{ color }}>
                  {formatCompactCurrency(financials.profit)}
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ── MD+: Waterfall chart — revenue → expenses → profit ────────────────
  // The waterfall reads: Revenue (full bar) minus Expenses = Profit
  const expensePct = financials.revenue > 0 ? (financials.expenses / financials.revenue) * 100 : 0;
  const profitPct = financials.revenue > 0 ? Math.max(0, (financials.profit / financials.revenue) * 100) : 0;

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* Header with period picker */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>{t("profitGauge.title") ?? "Profit"}</WidgetTitle>
          <div className="flex items-center gap-2">
            <span className="font-mono text-micro font-medium" style={{ color }}>
              {hasData ? `${financials.marginPct}%` : "0%"}
            </span>
            <WidgetPeriodPicker
              options={periodOptions}
              value={period}
              onChange={setPeriod}
              size={size}
            />
          </div>
        </div>

        {/* Detail zone */}
        <div className="flex-1 min-h-0 flex flex-col">
          {!hasData ? (
            <div className="flex flex-col justify-center flex-1">
              <span className={`font-mono ${HERO_SIZE_CLASS.expanded} font-bold text-text-mute leading-none`}>
                0%
              </span>
              <span className="font-mohave text-caption-sm text-text-mute mt-1">
                {t("profitGauge.noData") ?? "No data for this period"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 flex-1">
              {/* Revenue bar — full width baseline */}
              <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-mono text-micro text-text-mute uppercase">
                    {t("profitGauge.revenue") ?? "Revenue"}
                  </span>
                  <span className="font-mono text-micro text-text">{formatCompactCurrency(financials.revenue)}</span>
                </div>
                <div className="h-[14px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: isVisible ? "100%" : "0%",
                      backgroundColor: WT.accent,
                      transitionProperty: "width",
                      transitionDuration: reducedMotion ? "200ms" : "600ms",
                      transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />
                </div>
              </div>

              {/* Expenses bar — shows what's subtracted */}
              <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-mono text-micro text-text-mute uppercase">
                    {t("profitGauge.expenses") ?? "Expenses"}
                  </span>
                  <span className="font-mono text-micro text-text-3">{formatCompactCurrency(financials.expenses)}</span>
                </div>
                <div className="h-[14px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: isVisible ? `${Math.min(expensePct, 100)}%` : "0%",
                      backgroundColor: WT.cost,
                      transitionProperty: "width",
                      transitionDuration: reducedMotion ? "200ms" : "600ms",
                      transitionDelay: reducedMotion ? "0ms" : "100ms",
                      transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />
                </div>
              </div>

              {/* Profit bar — the result (revenue - expenses) */}
              <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-mono text-micro text-text-mute uppercase">
                    {t("profitGauge.profit") ?? "Profit"}
                  </span>
                  <span className="font-mono text-micro font-medium" style={{ color }}>
                    {formatCompactCurrency(financials.profit)}
                  </span>
                </div>
                <div className="h-[14px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: isVisible ? `${profitPct}%` : "0%",
                      backgroundColor: color,
                      transitionProperty: "width",
                      transitionDuration: reducedMotion ? "200ms" : "600ms",
                      transitionDelay: reducedMotion ? "0ms" : "200ms",
                      transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </Card>
  );
}
