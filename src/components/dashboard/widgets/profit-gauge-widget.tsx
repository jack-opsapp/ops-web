"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Margin color — WT tokens, thresholds per widget reference spec
// ---------------------------------------------------------------------------
function marginColor(pct: number): string {
  if (pct >= 50) return WT.success;    // Healthy
  if (pct >= 30) return WT.warning;    // Watch
  return WT.error;                      // Low
}

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
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

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

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const period = (config.period as string) ?? "mtd";
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
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("profitGauge.title") ?? "Profit"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="ring" />
        </CardContent>
      </Card>
    );
  }

  // ── XS: Hero percentage (no ring — fits 1-col cell) ────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" ref={ref} onClick={() => onNavigate?.("/expenses")}>
        <div className="h-full flex flex-col pt-3">
          <span className="font-mono text-display font-bold leading-none" style={{ color }}>
            {hasData ? `${animatedMargin}%` : "0%"}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("profitGauge.title") ?? "Profit"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("profitGauge.margin") ?? "Margin"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + rev/exp one-liner ──────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
              {hasData ? `${animatedMargin}%` : "0%"}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate?.("/expenses"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("profitGauge.title") ?? "Profit"}
          </span>
          {/* Row 3: Rev/Exp one-liner */}
          <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
            {t("profitGauge.revenue") ?? "Rev"}: {formatCurrency(financials.revenue)} · {t("profitGauge.expenses") ?? "Exp"}: {formatCurrency(financials.expenses)}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD: Waterfall chart + footer ──────────────────────────────────────
  const expensePct = financials.revenue > 0 ? (financials.expenses / financials.revenue) * 100 : 0;
  const profitPct = financials.revenue > 0 ? Math.max(0, (financials.profit / financials.revenue) * 100) : 0;

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("profitGauge.title") ?? "Profit"}
          </span>
          <span className="font-mono text-micro font-medium" style={{ color }}>
            {hasData ? `${financials.marginPct}%` : "0%"}
          </span>
        </div>

        {/* Detail zone */}
        <ScrollFade>
          {!hasData ? (
            <div className="flex flex-col justify-center h-full">
              <span className={`font-mono ${HERO_SIZE_CLASS.expanded} font-bold text-text-disabled leading-none`}>
                0%
              </span>
              <span className="font-mohave text-caption-sm text-text-disabled mt-1">
                {t("profitGauge.noData") ?? "No data for this period"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Revenue bar */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                    {t("profitGauge.revenue") ?? "Revenue"}
                  </span>
                  <span className="font-mono text-micro text-text-primary">{formatCurrency(financials.revenue)}</span>
                </div>
                <div className="h-[14px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: isVisible ? "100%" : "0%",
                      backgroundColor: WT.accent,
                      transitionProperty: "width",
                      transitionDuration: reducedMotion ? "200ms" : "600ms",
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
              </div>

              {/* Expenses bar */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                    {t("profitGauge.expenses") ?? "Expenses"}
                  </span>
                  <span className="font-mono text-micro text-text-tertiary">{formatCurrency(financials.expenses)}</span>
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
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
              </div>

              {/* Profit bar */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                    {t("profitGauge.profit") ?? "Profit"}
                  </span>
                  <span className="font-mono text-micro font-medium" style={{ color }}>
                    {formatCurrency(financials.profit)}
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
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate?.("/expenses")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("profitGauge.viewExpenses") ?? "View Expenses"}
          </button>
        )}
      </div>
    </Card>
  );
}
