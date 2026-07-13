"use client";

/**
 * Expense instrument row — the second metrics tier for the Books EXPENSES
 * segment, stacked under the shared LedgerStrip in the TableShell metrics slot
 * (both scroll away together; the workbar pins — WEB OVERHAUL P6-2).
 *
 * Four cells answer Jackson's "how much are we spending?" at a glance:
 *   SPEND · THIS MONTH — MoM trend + 6-month sparkline + jobs/overhead split
 *   TO REVIEW          — the queue's dollar weight (tan = needs the office)
 *   TO PAY             — approved money not yet settled with the crew
 *   PAID · THIS MONTH  — payouts recorded this month (olive = done)
 *
 * Derived from the SAME queries the queue renders (useExpenseBatches +
 * useAllExpenses via computeExpenseMetrics), so the strip and the list can
 * never disagree.
 */

import { useMemo } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { MetricsStrip, type MetricCell } from "@/components/ui/metrics-strip";
import type { ExpenseMetricsData } from "@/lib/utils/expense-metrics";

/** Whole-dollar strip display, locale-aware (cents live in the rows below). */
function fmtMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function ExpenseInstrumentRow({
  data,
  isLoading,
}: {
  data: ExpenseMetricsData | null;
  isLoading: boolean;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);

  const metrics = useMemo<MetricCell[]>(() => {
    if (!data) return [];

    const spendCell: MetricCell = {
      label: t("expenses.strip.spend"),
      value: data.spendMtd,
      format: (n) => fmtMoney(n, numLocale),
      // Costs rising month-over-month is the negative direction.
      trend:
        data.spendTrendPct != null
          ? {
              direction:
                data.spendTrendPct > 0 ? "up" : data.spendTrendPct < 0 ? "down" : "flat",
              value: `${Math.abs(Math.round(data.spendTrendPct))}%`,
              sentiment:
                data.spendTrendPct > 0
                  ? "negative"
                  : data.spendTrendPct < 0
                    ? "positive"
                    : "neutral",
            }
          : undefined,
      viz: { type: "sparkline", data: data.spendByMonth, color: "var(--rose)" },
      sub: t("expenses.strip.spendSplit", {
        jobs: fmtMoney(data.jobSpendMtd, numLocale),
        overhead: fmtMoney(data.overheadSpendMtd, numLocale),
      }),
    };

    const reviewCell: MetricCell = {
      label: t("expenses.strip.review"),
      value: data.reviewTotal,
      format: (n) => fmtMoney(n, numLocale),
      tone: data.reviewCount > 0 ? "tan" : "default",
      sub:
        data.reviewCount > 0
          ? t(
              data.reviewPeople === 1
                ? "expenses.strip.fromCrewOne"
                : "expenses.strip.fromCrew",
              { n: data.reviewCount, people: data.reviewPeople }
            )
          : "—",
    };

    const payCell: MetricCell = {
      label: t("expenses.strip.pay"),
      value: data.payTotal,
      format: (n) => fmtMoney(n, numLocale),
      sub:
        data.payCount > 0
          ? t(
              data.payPeople === 1
                ? "expenses.strip.fromCrewOne"
                : "expenses.strip.fromCrew",
              { n: data.payCount, people: data.payPeople }
            )
          : "—",
    };

    const paidCell: MetricCell = {
      label: t("expenses.strip.paid"),
      value: data.paidMtdTotal,
      format: (n) => fmtMoney(n, numLocale),
      tone: data.paidMtdCount > 0 ? "olive" : "default",
      sub:
        data.paidMtdCount > 0
          ? t(
              data.paidMtdCount === 1
                ? "expenses.strip.batchesOne"
                : "expenses.strip.batches",
              { n: data.paidMtdCount }
            )
          : "—",
    };

    return [spendCell, reviewCell, payCell, paidCell];
  }, [data, numLocale, t]);

  return <MetricsStrip metrics={metrics} isLoading={isLoading} ariaLabel={t("expenses.strip.spend")} />;
}
