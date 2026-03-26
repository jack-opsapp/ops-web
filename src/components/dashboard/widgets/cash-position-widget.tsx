"use client";

import { useMemo, useRef } from "react";
import { ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) return `$${(Math.abs(amount) / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(Math.abs(amount) / 1000).toFixed(1)}K`;
  return `$${Math.abs(amount).toFixed(0)}`;
}

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
}: CashPositionWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const period = (config.period as string) ?? "this-month";
  const { start, end } = getPeriodRange(period);

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

  const animatedNet = useAnimatedValue(isVisible ? Math.round(Math.abs(cashFlow.net)) : 0, 1000);
  const netColor = cashFlow.net >= 0 ? "#6B8F71" : "#B58289";
  const netPrefix = cashFlow.net >= 0 ? "+" : "-";

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("cashPosition.title") ?? "Cash Flow"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="stat" />
        </CardContent>
      </Card>
    );
  }

  const hasData = cashFlow.collected > 0 || cashFlow.spent > 0;

  // ── SM ──────────────────────────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full" ref={ref}>
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("cashPosition.title") ?? "Cash Flow"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          {hasData ? (
            <>
              <span className="font-mono text-[24px] font-medium leading-none" style={{ color: netColor }}>
                {netPrefix}{formatCurrency(animatedNet)}
              </span>
              <span className="block font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider mt-1">
                {t("cashPosition.netCashFlow") ?? "Net Cash Flow"}
              </span>
              <p className="font-mono text-[11px] text-text-tertiary mt-0.5">
                In: {formatCurrency(cashFlow.collected)} · Out: {formatCurrency(cashFlow.spent)}
              </p>
            </>
          ) : (
            <span className="font-mohave text-[13px] text-text-tertiary">
              {t("cashPosition.noTransactions") ?? "No transactions this period"}
            </span>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD ──────────────────────────────────────────────────────────────────
  const maxBar = Math.max(cashFlow.collected, cashFlow.spent, 1);

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("cashPosition.title") ?? "Cash Flow"}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
        {!hasData ? (
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("cashPosition.noTransactions") ?? "No transactions this period"}
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Collected bar */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                  {t("cashPosition.collected") ?? "Collected"}
                </span>
                <span className="font-mono text-[11px] text-status-success">{formatCurrency(cashFlow.collected)}</span>
              </div>
              <div className="h-[12px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: isVisible ? `${(cashFlow.collected / maxBar) * 100}%` : "0%",
                    backgroundColor: "#6B8F71",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            </div>
            {/* Spent bar */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                  {t("cashPosition.spent") ?? "Spent"}
                </span>
                <span className="font-mono text-[11px] text-ops-error">{formatCurrency(cashFlow.spent)}</span>
              </div>
              <div className="h-[12px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: isVisible ? `${(cashFlow.spent / maxBar) * 100}%` : "0%",
                    backgroundColor: "#B58289",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : "100ms",
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            </div>
            {/* Net */}
            <div className="flex items-center justify-between pt-1 border-t border-border-primary">
              <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                {t("cashPosition.netCashFlow") ?? "Net"}
              </span>
              <span className="font-mono text-[14px] font-medium" style={{ color: netColor }}>
                {netPrefix}{formatCurrency(Math.abs(cashFlow.net))}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
