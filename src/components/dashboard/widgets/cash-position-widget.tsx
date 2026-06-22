"use client";

import { useMemo, useState, useRef } from "react";
import { ChevronUp, ChevronDown, ArrowUpRight } from "lucide-react";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WidgetTitle } from "./shared/widget-title";
import { useCashFlowForecast } from "@/lib/hooks/use-forecast";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface CashPositionWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  invoices: Invoice[];
  expenses: ExpenseLineItem[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  if (period === "last-month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
    };
  }
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CashPositionWidget({
  size,
  config,
  invoices,
  expenses,
  isLoading,
  onNavigate,
}: CashPositionWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const [period, setPeriod] = useState((config.period as string) ?? "this-month");
  const { start, end } = getPeriodRange(period);

  const periodOptions = useMemo(() => [
    { value: "this-month", label: t("cashPosition.thisMonth") ?? "This Month" },
    { value: "last-month", label: t("cashPosition.lastMonth") ?? "Last Month" },
  ], [t]);

  const periodLabel = periodOptions.find((o) => o.value === period)?.label ?? "This Month";

  const reducedMotion = useReducedMotion();

  const { data: cashForecast } = useCashFlowForecast(30);
  const forecastNet = useMemo(() => {
    if (!cashForecast) return null;
    return cashForecast.reduce((sum, d) => sum + d.netCashFlow, 0);
  }, [cashForecast]);

  const [barTooltip, setBarTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    label: string;
    collected: number;
    spent: number;
  }>({ visible: false, x: 0, y: 0, label: "", collected: 0, spent: 0 });

  const cashFlow = useMemo(() => {
    let collected = 0;
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status !== InvoiceStatus.Paid || !inv.paidAt) continue;
      const paidDate = new Date(inv.paidAt);
      if (paidDate >= start && paidDate <= end) {
        collected += inv.amountPaid;
      }
    }

    let spent = 0;
    for (const exp of expenses) {
      if (exp.deletedAt) continue;
      if (exp.status !== "approved" || !exp.expenseDate) continue;
      const expDate = new Date(exp.expenseDate);
      if (expDate >= start && expDate <= end) {
        spent += exp.amount;
      }
    }

    const net = collected - spent;
    return { collected, spent, net };
  }, [invoices, expenses, start, end]);

  // ── Weekly net cash flow sparkline data for SM background ─────────────
  const weeklyNetData = useMemo(() => {
    if (size !== "sm") return [];
    // Build 4-week buckets of net cash flow
    const weeks: number[] = [0, 0, 0, 0];
    const now = new Date();
    for (const inv of invoices) {
      if (inv.deletedAt || inv.status !== InvoiceStatus.Paid || !inv.paidAt) continue;
      const paidDate = new Date(inv.paidAt);
      const weeksAgo = Math.floor((now.getTime() - paidDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weeksAgo >= 0 && weeksAgo < 4) {
        weeks[3 - weeksAgo] += inv.amountPaid;
      }
    }
    for (const exp of expenses) {
      if (exp.deletedAt || exp.status !== "approved" || !exp.expenseDate) continue;
      const expDate = new Date(exp.expenseDate);
      const weeksAgo = Math.floor((now.getTime() - expDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weeksAgo >= 0 && weeksAgo < 4) {
        weeks[3 - weeksAgo] -= exp.amount;
      }
    }
    return weeks;
  }, [invoices, expenses, size]);

  const animatedNet = useAnimatedValue(isVisible ? Math.round(Math.abs(cashFlow.net)) : 0, 1000);
  const netColor = cashFlow.net >= 0 ? WT.success : WT.error;
  const netPrefix = cashFlow.net >= 0 ? "+" : "-";

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <WidgetTitle>
            {t("cashPosition.title") ?? "Cash Flow"}
          </WidgetTitle>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </div>
      </Card>
    );
  }

  const hasData = cashFlow.collected > 0 || cashFlow.spent > 0;

  // ── Empty state ────────────────────────────────────────────────────────
  if (!hasData) {
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-mute leading-none">$0</span>
            <WidgetTitle className="mt-1">
              {t("cashPosition.title") ?? "Cash Flow"}
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
              {t("cashPosition.title") ?? "Cash Flow"}
            </WidgetTitle>
            <span className="font-mohave text-caption-sm text-text-mute mt-1 truncate">
              {t("cashPosition.noTransactions") ?? "No transactions"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>
            {t("cashPosition.title") ?? "Cash Flow"}
          </WidgetTitle>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-mute leading-none">$0</span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("cashPosition.noTransactions") ?? "No transactions this period"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Hero net amount + direction ────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className={`font-mono ${formatCompactCurrency(animatedNet).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none`} style={{ color: netColor }}>
            {netPrefix}{formatCompactCurrency(animatedNet)}
          </span>
          <WidgetTitle className="mt-1">
            {t("cashPosition.title") ?? "Cash Flow"}
          </WidgetTitle>
          <WidgetTrendContext
            variant="snapshot"
            label={periodLabel}
          />
        </div>
      </Card>
    );
  }

  // ── SM: WidgetBackgroundChart with sparkline behind text ───────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={
            <div className="h-full w-full flex items-end justify-center">
              <Sparkline
                data={weeklyNetData.length >= 2 ? weeklyNetData : [0, cashFlow.net]}
                width={120}
                height={50}
                color={netColor}
                showDots={false}
              />
            </div>
          }
          opacity={0.3}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none" style={{ color: netColor }}>
                {netPrefix}{formatCompactCurrency(animatedNet)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/books?segment=invoices"); }}
                className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-mono text-micro text-text-3 mt-0.5">
              <WidgetTitle>{t("cashPosition.title") ?? "Cash Flow"}</WidgetTitle>
              <span className="text-text-mute"> · {periodLabel}</span>
            </span>
            <span className="font-mono text-micro text-text-3 mt-0.5">
              {t("cashPosition.collected") ?? "Collected"}: {formatCompactCurrency(cashFlow.collected)} · {t("cashPosition.spent") ?? "Spent"}: {formatCompactCurrency(cashFlow.spent)}
            </span>
            {forecastNet !== null && (
              <span className="font-mono text-micro text-text-mute mt-0.5">
                {t("cashPosition.forecast30d") ?? "30d forecast"}: {forecastNet >= 0 ? "+" : "-"}{formatCompactCurrency(Math.abs(forecastNet))}
              </span>
            )}
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── MD+: Hero + dual bars (collected vs spent) + hover breakdown ──────
  const maxBar = Math.max(cashFlow.collected, cashFlow.spent, 1);
  const barHeight = 10; // Compact bars — all content fits within MD bounds

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>
            {t("cashPosition.title") ?? "Cash Flow"}
          </WidgetTitle>
          <WidgetPeriodPicker
            options={periodOptions}
            value={period}
            onChange={setPeriod}
            size={size}
          />
        </div>

        {/* HERO */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold leading-none`} style={{ color: netColor }}>
            {formatCompactCurrency(animatedNet)}
          </span>
          {cashFlow.net >= 0 ? (
            <ChevronUp className="w-4 h-4" style={{ color: netColor }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: netColor }} />
          )}
        </div>

        {/* DETAIL ZONE — MD+ */}
        {showDetail(size) && (
          <div className="flex flex-col gap-2 flex-1 min-h-0">
            <WidgetTooltip visible={barTooltip.visible} x={barTooltip.x} y={barTooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={t("cashPosition.paymentsIn") ?? "Payments In"} value={formatCompactCurrency(barTooltip.collected)} color={WT.success} />
              <TooltipRow label={t("cashPosition.expensesOut") ?? "Expenses Out"} value={formatCompactCurrency(barTooltip.spent)} color={WT.error} />
            </WidgetTooltip>

            {/* Collected bar */}
            <div
              className="cursor-pointer"
              onMouseEnter={(e) => {
                const parentRect = ref.current?.getBoundingClientRect();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (!parentRect) return;
                setBarTooltip({
                  visible: true,
                  x: rect.left - parentRect.left + rect.width / 2,
                  y: rect.top - parentRect.top,
                  label: t("cashPosition.collected") ?? "Collected",
                  collected: cashFlow.collected,
                  spent: cashFlow.spent,
                });
              }}
              onMouseLeave={() => setBarTooltip((prev) => ({ ...prev, visible: false }))}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
                  {t("cashPosition.collected") ?? "Collected"}
                </span>
                <span className="font-mono text-micro text-status-success">{formatCompactCurrency(cashFlow.collected)}</span>
              </div>
              <div className="rounded-sm overflow-hidden" style={{ height: `${barHeight}px`, backgroundColor: WT.faint }}>
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: isVisible ? `${(cashFlow.collected / maxBar) * 100}%` : "0%",
                    backgroundColor: WT.successMuted,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
            </div>

            {/* Spent bar */}
            <div
              className="cursor-pointer"
              onMouseEnter={(e) => {
                const parentRect = ref.current?.getBoundingClientRect();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (!parentRect) return;
                setBarTooltip({
                  visible: true,
                  x: rect.left - parentRect.left + rect.width / 2,
                  y: rect.top - parentRect.top,
                  label: t("cashPosition.spent") ?? "Spent",
                  collected: cashFlow.collected,
                  spent: cashFlow.spent,
                });
              }}
              onMouseLeave={() => setBarTooltip((prev) => ({ ...prev, visible: false }))}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
                  {t("cashPosition.spent") ?? "Spent"}
                </span>
                <span className="font-mono text-micro text-status-error">{formatCompactCurrency(cashFlow.spent)}</span>
              </div>
              <div className="rounded-sm overflow-hidden" style={{ height: `${barHeight}px`, backgroundColor: WT.faint }}>
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: isVisible ? `${(cashFlow.spent / maxBar) * 100}%` : "0%",
                    backgroundColor: WT.errorMuted,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : "100ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
            </div>

            {/* Net + forecast summary */}
            <div className="pt-1 border-t border-border-subtle space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
                  {t("cashPosition.netCashFlow") ?? "Net"}
                </span>
                <span className="font-mono text-data-sm font-medium" style={{ color: netColor }}>
                  {netPrefix}{formatCompactCurrency(Math.abs(cashFlow.net))}
                </span>
              </div>
              {forecastNet !== null && (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
                    {t("cashPosition.forecast30d") ?? "30d forecast"}
                  </span>
                  <span className="font-mono text-micro text-text-mute">
                    {forecastNet >= 0 ? "+" : "-"}{formatCompactCurrency(Math.abs(forecastNet))}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </Card>
  );
}
