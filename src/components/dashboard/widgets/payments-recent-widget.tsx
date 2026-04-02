"use client";

import { useMemo, useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices, useClientMap } from "@/lib/hooks";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useWidgetIntersection } from "./shared/use-widget-intersection";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PaymentsRecentWidgetProps {
  size: WidgetSize;
  onNavigate?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrencyLocale(amount: number, locale: Locale): string {
  return amount.toLocaleString(getDateLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRelativeDate(date: Date | string, locale: Locale, t?: (key: string, params?: Record<string, unknown>) => string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return formatShortDate(d, locale);
  if (diffDays === 0) return t ? t("payments.today") : "Today";
  if (diffDays === 1) return t ? t("payments.daysAgo").replace("{count}", "1") : "1d ago";
  if (diffDays <= 7) return t ? t("payments.daysAgo").replace("{count}", String(diffDays)) : `${diffDays}d ago`;
  return formatShortDate(d, locale);
}

function formatShortDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentsRecentWidget({ size, onNavigate }: PaymentsRecentWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const { data: rawInvoices, isLoading } = useInvoices();
  const clientMap = useClientMap();
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const [expanded, setExpanded] = useState(false);

  /** Invoices that have been paid, sorted by paidAt descending */
  const paidInvoices = useMemo(() => {
    if (!rawInvoices) return [];
    return rawInvoices
      .map((inv) => {
        if (inv.client?.name) return inv;
        const c = clientMap.get(inv.clientId);
        return c ? { ...inv, client: c as Invoice["client"] } : inv;
      })
      .filter(
        (inv): inv is Invoice & { paidAt: Date | string } =>
          inv.status === InvoiceStatus.Paid && inv.paidAt != null
      )
      .sort((a, b) => {
        const aDate =
          typeof a.paidAt === "string"
            ? new Date(a.paidAt).getTime()
            : a.paidAt.getTime();
        const bDate =
          typeof b.paidAt === "string"
            ? new Date(b.paidAt).getTime()
            : b.paidAt.getTime();
        return bDate - aDate;
      });
  }, [rawInvoices, clientMap]);

  // ── SM: Hero + title + client info ──────────────────────────────────────
  if (size === "sm") {
    const lastPayment = paidInvoices[0] ?? null;

    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className={`font-mono text-data-lg font-bold leading-none ${isLoading ? "text-text-disabled" : lastPayment ? "text-status-success" : "text-text-disabled"}`}>
            {isLoading ? "—" : lastPayment ? formatCurrencyLocale(lastPayment.total, locale) : "$0"}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("payments.lastPayment")}
          </span>
          {!isLoading && lastPayment && (
            <span className="font-mohave text-caption-sm text-text-secondary truncate mt-0.5">
              {lastPayment.client?.name ?? t("payments.unknownClient")}
            </span>
          )}
        </div>
      </Card>
    );
  }

  const defaultMaxItems = size === "lg" ? 7 : 3;
  const maxItems = expanded ? paidInvoices.length : defaultMaxItems;
  const remaining = paidInvoices.length - defaultMaxItems;

  // ── MD / LG: List of recent payments with WidgetLineItem ──────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("payments.title")}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {isLoading ? "..." : t("payments.total").replace("{count}", String(paidInvoices.length))}
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("payments.loadingPayments")}
            </span>
          </div>
        ) : paidInvoices.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("payments.noPaymentsReceived")}
          </p>
        ) : (
          <div className={expanded ? "flex-1 min-h-0 overflow-y-auto scrollbar-hide" : undefined}>
            <div className="space-y-[2px]">
              {paidInvoices.slice(0, maxItems).map((invoice, i) => {
                const clientName = invoice.client?.name ?? t("payments.unknownClient");
                const pctPaid = invoice.total > 0 ? Math.round((invoice.amountPaid / invoice.total) * 100) : 100;

                return (
                  <WidgetLineItem
                    key={invoice.id}
                    indicator={{
                      type: "avatar",
                      color: "transparent",
                      initials: clientName.slice(0, 2),
                    }}
                    primary={clientName}
                    secondary={`${invoice.invoiceNumber} · ${formatRelativeDate(invoice.paidAt, locale, t)}`}
                    metric={
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-micro-sm text-status-success font-medium">
                          {formatCurrencyLocale(invoice.amountPaid, locale)}
                        </span>
                        {pctPaid < 100 && (
                          <span className="font-mono text-micro-sm text-text-disabled">
                            {t("payments.ofInvoice") ?? "of"} {formatCompactCurrency(invoice.total)} ({pctPaid}%)
                          </span>
                        )}
                      </span>
                    }
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
            </div>

            {/* +N more / Show less + View All Payments */}
            {remaining > 0 && (
              <div className="flex items-center justify-between mt-1 px-1">
                <WidgetMoreButton
                  remaining={remaining}
                  expanded={expanded}
                  onToggle={() => setExpanded(!expanded)}
                />
                {onNavigate && (
                  <button
                    onClick={() => onNavigate("/accounting")}
                    className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
                  >
                    {t("payments.viewAllPayments") ?? "View All Payments"}
                  </button>
                )}
              </div>
            )}

            {/* If no remaining but has navigate, show view all at bottom */}
            {remaining <= 0 && onNavigate && (
              <div className="mt-1 px-1">
                <button
                  onClick={() => onNavigate("/accounting")}
                  className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
                >
                  {t("payments.viewAllPayments") ?? "View All Payments"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
