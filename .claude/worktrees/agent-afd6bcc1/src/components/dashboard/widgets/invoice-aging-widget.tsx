"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices } from "@/lib/hooks";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvoiceAgingWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Aging bucket definitions
// ---------------------------------------------------------------------------

interface AgingBucket {
  label: string;
  color: string;
  /** Tailwind bg class for the bar segment */
  bgClass: string;
  count: number;
  amount: number;
}

const BUCKET_DEFS = [
  { labelKey: "invoiceAging.bucketCurrent", color: "var(--ops-accent, #8195B5)", bgClass: "bg-ops-accent" },
  { labelKey: "invoiceAging.bucket1to30", color: "var(--ops-amber, #C4A868)", bgClass: "bg-ops-amber" },
  { labelKey: "invoiceAging.bucket31to60", color: "#F97316", bgClass: "bg-[#F97316]" },
  { labelKey: "invoiceAging.bucket61to90", color: "rgba(var(--ops-error-rgb, 181,130,137), 0.7)", bgClass: "bg-ops-error/70" },
  { labelKey: "invoiceAging.bucket90plus", color: "var(--ops-error, #B58289)", bgClass: "bg-ops-error" },
] as const;

function formatCurrency(amount: number, locale: Locale): string {
  return amount.toLocaleString(getDateLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoiceAgingWidget({ size }: InvoiceAgingWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const { data: invoices, isLoading } = useInvoices();

  const buckets: AgingBucket[] = useMemo(() => {
    // Filter to unpaid invoices (exclude Paid, Void, WrittenOff, Draft)
    const unpaid = (invoices ?? []).filter(
      (inv) =>
        inv.status !== InvoiceStatus.Paid &&
        inv.status !== InvoiceStatus.Void &&
        inv.status !== InvoiceStatus.WrittenOff &&
        inv.status !== InvoiceStatus.Draft
    );

    const now = new Date();

    // Initialise buckets
    const result: AgingBucket[] = BUCKET_DEFS.map((def) => ({
      label: t(def.labelKey),
      color: def.color,
      bgClass: def.bgClass,
      count: 0,
      amount: 0,
    }));

    for (const inv of unpaid) {
      const dueDate =
        typeof inv.dueDate === "string" ? new Date(inv.dueDate) : inv.dueDate;
      const diffMs = now.getTime() - dueDate.getTime();
      const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      let bucketIdx: number;
      if (daysOverdue <= 0) {
        bucketIdx = 0; // Current (not yet due)
      } else if (daysOverdue <= 30) {
        bucketIdx = 1;
      } else if (daysOverdue <= 60) {
        bucketIdx = 2;
      } else if (daysOverdue <= 90) {
        bucketIdx = 3;
      } else {
        bucketIdx = 4;
      }

      result[bucketIdx].count += 1;
      result[bucketIdx].amount += inv.balanceDue;
    }

    return result;
  }, [invoices, t]);

  const totalAmount = useMemo(
    () => buckets.reduce((sum, b) => sum + b.amount, 0),
    [buckets]
  );

  const totalCount = useMemo(
    () => buckets.reduce((sum, b) => sum + b.count, 0),
    [buckets]
  );

  // ── MD / LG: Stacked bar + list breakdown ──────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("invoiceAging.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading
              ? "..."
              : `${totalCount} \u00B7 ${formatCurrency(totalAmount, locale)}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("invoiceAging.loading")}
            </span>
          </div>
        ) : totalCount === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("invoiceAging.empty")}
          </p>
        ) : (
          <>
            {/* Stacked horizontal bar */}
            <div className="flex h-[8px] rounded-full overflow-hidden mb-2">
              {buckets.map((bucket, i) => {
                if (bucket.amount <= 0) return null;
                const widthPct =
                  totalAmount > 0
                    ? Math.max((bucket.amount / totalAmount) * 100, 1)
                    : 0;
                return (
                  <div
                    key={i}
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: bucket.color,
                      marginRight:
                        i < buckets.length - 1 && bucket.amount > 0
                          ? "1px"
                          : "0",
                    }}
                  />
                );
              })}
            </div>

            {/* Bucket breakdown list */}
            <div className="space-y-[3px]">
              {buckets.map((bucket, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-1 py-[1px] rounded transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="w-[8px] h-[8px] rounded-sm shrink-0"
                      style={{ backgroundColor: bucket.color }}
                    />
                    <span className="font-mohave text-body-sm text-text-secondary">
                      {bucket.label}
                      {i > 0 ? ` ${t("invoiceAging.days")}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {bucket.count} {t("invoiceAging.inv")}
                    </span>
                    <span className="font-mono text-body-sm text-text-primary font-medium">
                      {formatCurrency(bucket.amount, locale)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* LG extra: percentage breakdown */}
            {size === "lg" && totalAmount > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  {t("invoiceAging.distribution")}
                </span>
                <div className="space-y-[4px] mt-1">
                  {buckets
                    .filter((b) => b.amount > 0)
                    .map((bucket, i) => {
                      const pct = Math.round(
                        (bucket.amount / totalAmount) * 100
                      );
                      return (
                        <div key={i} className="flex items-center gap-1">
                          <span
                            className="w-[6px] h-[6px] rounded-full shrink-0"
                            style={{ backgroundColor: bucket.color }}
                          />
                          <span className="font-mohave text-[12px] text-text-tertiary flex-1">
                            {bucket.label}
                            {i > 0 ? ` ${t("invoiceAging.days")}` : ""}
                          </span>
                          <span className="font-mono text-[11px] text-text-secondary">
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
