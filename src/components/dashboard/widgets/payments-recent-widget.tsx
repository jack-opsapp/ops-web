"use client";

import { useMemo, useState, useRef } from "react";
import { Loader2, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetTitle } from "./shared/widget-title";
import { ScrollFade } from "./shared/scroll-fade";
import { formatCompactCurrency, formatLocaleCurrency } from "./shared/widget-utils";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices, useClientMap } from "@/lib/hooks";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { WidgetTrendContext } from "./shared/widget-trend-context";

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
          <div className="flex items-baseline justify-between">
            <span className={`font-mono text-data-lg font-bold leading-none ${isLoading ? "text-text-mute" : lastPayment ? "text-status-success" : "text-text-mute"}`}>
              {isLoading ? "—" : lastPayment ? formatLocaleCurrency(lastPayment.total, getDateLocale(locale), 2) : "$0"}
            </span>
            {onNavigate && (
              <button
                onClick={() => onNavigate("/books?segment=invoices&view=aging")}
                className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            )}
          </div>
          <span className="font-mono text-micro text-text-3 uppercase tracking-[0.16em] mt-1">
            {t("payments.lastPayment")}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.latest") ?? "Latest"} />
          {!isLoading && lastPayment && (
            <span className="font-mohave text-caption-sm text-text-2 truncate mt-0.5">
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
          <WidgetTitle>
            {t("payments.title")}
          </WidgetTitle>
          <span className="font-mono text-micro text-text-3">
            {isLoading ? "..." : t("payments.total").replace("{count}", String(paidInvoices.length))}
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
            <span className="font-mono text-[11px] text-text-mute ml-1">
              {t("payments.loadingPayments")}
            </span>
          </div>
        ) : paidInvoices.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-mute py-2">
            {t("payments.noPaymentsReceived")}
          </p>
        ) : expanded ? (
            <ScrollFade>
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
                          <span className="font-mono text-micro text-status-success font-medium">
                            {formatLocaleCurrency(invoice.amountPaid, getDateLocale(locale), 2)}
                          </span>
                          {pctPaid < 100 && (
                            <span className="font-mono text-micro text-text-mute">
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
              {/* Show less */}
              {remaining > 0 && (
                <div className="flex items-center mt-1 px-1">
                  <WidgetMoreButton
                    remaining={remaining}
                    expanded={expanded}
                    onToggle={() => setExpanded(!expanded)}
                  />
                </div>
              )}
            </ScrollFade>
          ) : (
            <>
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
                          <span className="font-mono text-micro text-status-success font-medium">
                            {formatLocaleCurrency(invoice.amountPaid, getDateLocale(locale), 2)}
                          </span>
                          {pctPaid < 100 && (
                            <span className="font-mono text-micro text-text-mute">
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
              {/* +N more */}
              {remaining > 0 && (
                <div className="flex items-center mt-1 px-1">
                  <WidgetMoreButton
                    remaining={remaining}
                    expanded={expanded}
                    onToggle={() => setExpanded(!expanded)}
                  />
                </div>
              )}
            </>
          )}
      </div>
    </Card>
  );
}
