"use client";

import { useMemo, useRef } from "react";
import { ChevronUp, ChevronDown, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

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
  onNavigate,
}: CashPositionWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const period = (config.period as string) ?? "this-month";
  const { start, end } = getPeriodRange(period);

  const reducedMotion = useReducedMotion();

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
  const netColor = cashFlow.net >= 0 ? WT.success : WT.error;
  const netPrefix = cashFlow.net >= 0 ? "+" : "-";

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
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

  // ── Empty state ────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("cashPosition.title") ?? "Cash Flow"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              $0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("cashPosition.noTransactions") ?? "No transactions this period"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("cashPosition.viewInvoices") ?? "View Invoices"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero net amount + direction ────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/invoices")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className={`font-mono ${formatCurrency(animatedNet).length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none`} style={{ color: netColor }}>
            {formatCurrency(animatedNet)}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("cashPosition.title") ?? "Cash Flow"}
          </span>
          <div className="flex items-center gap-0.5">
            {cashFlow.net >= 0 ? (
              <ChevronUp className="w-3 h-3" style={{ color: netColor }} />
            ) : (
              <ChevronDown className="w-3 h-3" style={{ color: netColor }} />
            )}
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("cashPosition.netCashFlow") ?? "Net"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + collected/spent ───────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color: netColor }}>
              {formatCurrency(animatedNet)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/invoices"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("cashPosition.title") ?? "Cash Flow"}
          </span>
          {/* Row 3: Collected/Spent */}
          <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
            {t("cashPosition.collected") ?? "Collected"}: {formatCurrency(cashFlow.collected)} · {t("cashPosition.spent") ?? "Spent"}: {formatCurrency(cashFlow.spent)}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD: Hero + dual bars (collected vs spent) + net summary + footer ───
  const maxBar = Math.max(cashFlow.collected, cashFlow.spent, 1);
  const barHeight = isCompact(size) ? 14 : showActions(size) ? 24 : 20;

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("cashPosition.title") ?? "Cash Flow"}
          </span>
        </div>

        {/* HERO */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold leading-none`} style={{ color: netColor }}>
            {formatCurrency(animatedNet)}
          </span>
          {cashFlow.net >= 0 ? (
            <ChevronUp className="w-4 h-4" style={{ color: netColor }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: netColor }} />
          )}
        </div>

        {/* DETAIL ZONE — MD+ */}
        {showDetail(size) && (
          <ScrollFade>
            <div className="flex flex-col gap-2">
              {/* Collected bar */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider">
                    {t("cashPosition.collected") ?? "Collected"}
                  </span>
                  <span className="font-mono text-micro text-status-success">{formatCurrency(cashFlow.collected)}</span>
                </div>
                <div className="rounded-sm overflow-hidden" style={{ height: `${barHeight}px`, backgroundColor: WT.faint }}>
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: isVisible ? `${(cashFlow.collected / maxBar) * 100}%` : "0%",
                      backgroundColor: WT.successMuted,
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
              </div>
              {/* Spent bar */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider">
                    {t("cashPosition.spent") ?? "Spent"}
                  </span>
                  <span className="font-mono text-micro text-status-error">{formatCurrency(cashFlow.spent)}</span>
                </div>
                <div className="rounded-sm overflow-hidden" style={{ height: `${barHeight}px`, backgroundColor: WT.faint }}>
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: isVisible ? `${(cashFlow.spent / maxBar) * 100}%` : "0%",
                      backgroundColor: WT.errorMuted,
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : "100ms",
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
              </div>
              {/* Net summary */}
              <div className="flex items-center justify-between pt-1 border-t border-border-subtle">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider">
                  {t("cashPosition.netCashFlow") ?? "Net"}
                </span>
                <span className="font-mono text-data-sm font-medium" style={{ color: netColor }}>
                  {netPrefix}{formatCurrency(Math.abs(cashFlow.net))}
                </span>
              </div>
            </div>
          </ScrollFade>
        )}

        {/* FOOTER — SM+ */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/invoices")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("cashPosition.viewInvoices") ?? "View Invoices"}
          </button>
        )}
      </div>
    </Card>
  );
}
