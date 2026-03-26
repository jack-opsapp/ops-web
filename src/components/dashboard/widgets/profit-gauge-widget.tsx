"use client";

import { useMemo, useRef } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Color zones
// ---------------------------------------------------------------------------
function marginColor(pct: number): string {
  if (pct > 50) return "#6B8F71";   // Healthy — muted green
  if (pct >= 40) return "#C4A868";  // Watch — amber
  return "#B58289";                  // Low — muted red
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
}: ProfitGaugeWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const period = (config.period as string) ?? "mtd";
  const { start, end } = getPeriodRange(period);

  const financials = useMemo(() => {
    // Revenue: sum of amountPaid from paid invoices in period
    let revenue = 0;
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status !== InvoiceStatus.Paid) continue;
      const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
      if (!paidDate || paidDate < start || paidDate > end) continue;
      revenue += inv.amountPaid;
    }

    // Expenses: sum of amount from approved expenses in period
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

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("profitGauge.title") ?? "Profit"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="ring" />
        </CardContent>
      </Card>
    );
  }

  const hasData = financials.revenue > 0 || financials.expenses > 0;

  // ── XS: Ring only ───────────────────────────────────────────────────────
  if (size === "xs") {
    const ringSize = 60;
    const strokeWidth = 6;
    const radius = (ringSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const fillPct = hasData ? Math.max(0, Math.min(100, financials.marginPct)) : 0;
    const dashOffset = circumference * (1 - fillPct / 100);

    return (
      <Card className="h-full flex flex-col items-center justify-center px-3" ref={ref}>
        <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`}>
          {/* Background ring */}
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
          />
          {/* Fill ring */}
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke={hasData ? color : "rgba(255,255,255,0.08)"}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={isVisible && !reducedMotion ? dashOffset : circumference}
            style={{
              transition: reducedMotion ? "none" : "stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)",
              transform: "rotate(-90deg)",
              transformOrigin: "center",
            }}
          />
          {/* Center text */}
          <text
            x="50%"
            y="50%"
            dominantBaseline="central"
            textAnchor="middle"
            fill={hasData ? color : "rgba(255,255,255,0.3)"}
            fontSize="20"
            fontFamily="var(--font-mono)"
            fontWeight="500"
          >
            {hasData ? `${animatedMargin}%` : "--"}
          </text>
        </svg>
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider mt-1">
          {t("profitGauge.margin") ?? "Margin"}
        </span>
      </Card>
    );
  }

  // ── SM: Ring + numbers ──────────────────────────────────────────────────
  if (size === "sm") {
    const ringSize = 50;
    const strokeWidth = 5;
    const radius = (ringSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const fillPct = hasData ? Math.max(0, Math.min(100, financials.marginPct)) : 0;
    const dashOffset = circumference * (1 - fillPct / 100);

    return (
      <Card className="h-full" ref={ref}>
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("profitGauge.title") ?? "Profit"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex items-center gap-3">
          <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="shrink-0">
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth}
            />
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" stroke={hasData ? color : "rgba(255,255,255,0.08)"}
              strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={isVisible && !reducedMotion ? dashOffset : circumference}
              style={{
                transition: reducedMotion ? "none" : "stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)",
                transform: "rotate(-90deg)", transformOrigin: "center",
              }}
            />
            <text
              x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
              fill={hasData ? color : "rgba(255,255,255,0.3)"}
              fontSize="16" fontFamily="var(--font-mono)" fontWeight="500"
            >
              {hasData ? `${animatedMargin}%` : "--"}
            </text>
          </svg>
          <div className="flex flex-col gap-0.5">
            <div>
              <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                {t("profitGauge.revenue") ?? "Revenue"}
              </span>
              <p className="font-mono text-[14px] text-text-primary">{formatCurrency(financials.revenue)}</p>
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                {t("profitGauge.expenses") ?? "Expenses"}
              </span>
              <p className="font-mono text-[14px] text-text-tertiary">{formatCurrency(financials.expenses)}</p>
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                {t("profitGauge.profit") ?? "Profit"}
              </span>
              <p className="font-mono text-[14px] font-medium" style={{ color }}>
                {formatCurrency(financials.profit)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── MD: Waterfall chart ─────────────────────────────────────────────────
  const revenuePct = 100;
  const expensePct = financials.revenue > 0 ? (financials.expenses / financials.revenue) * 100 : 0;
  const profitPct = financials.revenue > 0 ? (financials.profit / financials.revenue) * 100 : 0;

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("profitGauge.title") ?? "Profit"}
        </CardTitle>
        <span className="font-mono text-[11px] font-medium" style={{ color }}>
          {hasData ? `${financials.marginPct}%` : "--"}
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
        {!hasData ? (
          <p className="font-mohave text-[13px] text-text-tertiary">
            {t("profitGauge.noData") ?? "No data for this period"}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* Revenue bar */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                  {t("profitGauge.revenue") ?? "Revenue"}
                </span>
                <span className="font-mono text-[11px] text-text-primary">{formatCurrency(financials.revenue)}</span>
              </div>
              <div className="h-[14px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: isVisible ? "100%" : "0%",
                    backgroundColor: "#597794",
                    transitionDuration: reducedMotion ? "200ms" : "600ms",
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            </div>

            {/* Expenses bar */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                  {t("profitGauge.expenses") ?? "Expenses"}
                </span>
                <span className="font-mono text-[11px] text-text-tertiary">{formatCurrency(financials.expenses)}</span>
              </div>
              <div className="h-[14px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: isVisible ? `${Math.min(expensePct, 100)}%` : "0%",
                    backgroundColor: "#B58289",
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
                <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                  {t("profitGauge.profit") ?? "Profit"}
                </span>
                <span className="font-mono text-[11px] font-medium" style={{ color }}>
                  {formatCurrency(financials.profit)}
                </span>
              </div>
              <div className="h-[14px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: isVisible ? `${Math.max(profitPct, 0)}%` : "0%",
                    backgroundColor: color,
                    transitionDuration: reducedMotion ? "200ms" : "600ms",
                    transitionDelay: reducedMotion ? "0ms" : "200ms",
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
