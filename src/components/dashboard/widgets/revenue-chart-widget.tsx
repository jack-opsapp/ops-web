"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInvoices } from "@/lib/hooks";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { startOfMonth } from "@/lib/utils/date";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

const MONTH_LABEL_KEYS = [
  "revenue.jan", "revenue.feb", "revenue.mar", "revenue.apr",
  "revenue.may", "revenue.jun", "revenue.jul", "revenue.aug",
  "revenue.sep", "revenue.oct", "revenue.nov", "revenue.dec",
];
const REVENUE_BAR_COLOR = "#C4A868"; // accounting revenue amber

function formatDollar(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

interface RevenueWidgetProps {
  size: WidgetSize;
}

export function RevenueWidget({ size }: RevenueWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data } = useInvoices();
  const invoices = data ?? [];

  const { monthlyData, mtdRevenue, ytdTotal, currentMonthIndex } = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = startOfMonth(now);
    const curMonthIdx = now.getMonth();

    // Paid invoices this year
    const paidThisYear = invoices.filter(
      (inv) =>
        !inv.deletedAt &&
        inv.status === InvoiceStatus.Paid &&
        inv.paidAt &&
        new Date(inv.paidAt) >= yearStart
    );

    // Group by month of paidAt
    const monthly = new Array(curMonthIdx + 1).fill(0);
    let mtd = 0;
    let ytd = 0;

    for (const inv of paidThisYear) {
      const paidDate = new Date(inv.paidAt!);
      const monthIdx = paidDate.getMonth();
      if (monthIdx <= curMonthIdx) {
        monthly[monthIdx] += inv.amountPaid ?? 0;
        ytd += inv.amountPaid ?? 0;
        if (paidDate >= monthStart) {
          mtd += inv.amountPaid ?? 0;
        }
      }
    }

    return {
      monthlyData: monthly.map((value, i) => ({
        label: t(MONTH_LABEL_KEYS[i]),
        value,
        isCurrent: i === curMonthIdx,
      })),
      mtdRevenue: mtd,
      ytdTotal: ytd,
      currentMonthIndex: curMonthIdx,
    };
  }, [invoices, t]);

  const maxValue = useMemo(
    () => Math.max(...monthlyData.map((m) => m.value), 1),
    [monthlyData]
  );

  // sm: just show MTD number
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">{t("revenue.title")}</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          <p className="font-mono text-data-lg" style={{ color: REVENUE_BAR_COLOR }}>
            {formatDollar(mtdRevenue)}
          </p>
          <p className="font-kosugi text-[10px] text-text-tertiary mt-[2px]">{t("revenue.mtdRevenue")}</p>
          <p className="font-mono text-[10px] text-text-disabled mt-[2px]">
            {formatDollar(ytdTotal)} {t("revenue.ytd")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // md/lg: full bar chart
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("revenue.title")}</CardTitle>
          <span className="font-mono text-[10px] text-text-tertiary">
            {new Date().getFullYear()} {t("revenue.ytd")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        <div className="flex items-end gap-[6px] h-[120px]">
          {monthlyData.map((month, i) => {
            const barHeight = (month.value / maxValue) * 100;

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full">
                <div className="flex-1 w-full flex items-end justify-center relative">
                  <div
                    className="w-[70%] rounded-t-sm transition-all duration-700"
                    style={{
                      height: barHeight > 0 ? `${barHeight}%` : "2px",
                      backgroundColor: month.value > 0
                        ? month.isCurrent
                          ? REVENUE_BAR_COLOR
                          : `${REVENUE_BAR_COLOR}99`
                        : "rgba(255,255,255,0.06)",
                      animationDelay: `${i * 100}ms`,
                    }}
                  />
                </div>
                <span className="font-mono text-[9px] text-text-disabled">
                  {month.value > 0 ? formatDollar(month.value) : "--"}
                </span>
                <span
                  className={cn(
                    "font-kosugi text-[9px]",
                    month.isCurrent ? "text-text-secondary font-medium" : "text-text-disabled"
                  )}
                >
                  {month.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
          <div>
            <span className="font-kosugi text-[10px] text-text-tertiary">{t("revenue.mtdRevenue")}</span>
            <p className="font-mono text-body" style={{ color: REVENUE_BAR_COLOR }}>
              {formatDollar(mtdRevenue)}
            </p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">{t("revenue.ytdTotal")}</span>
            <p className="font-mono text-body text-text-primary">
              {formatDollar(ytdTotal)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
