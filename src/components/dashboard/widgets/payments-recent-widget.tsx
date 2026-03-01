"use client";

import { useMemo } from "react";
import { CreditCard, Loader2, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PaymentsRecentWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number, locale: Locale): string {
  return amount.toLocaleString(getDateLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a date as relative time if within 7 days, otherwise short date.
 */
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

export function PaymentsRecentWidget({ size }: PaymentsRecentWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const { data: invoices, isLoading } = useInvoices();

  /** Invoices that have been paid, sorted by paidAt descending */
  const paidInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices
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
  }, [invoices]);

  // ── SM: Last payment amount + client info ───────────────────────────────
  if (size === "sm") {
    const lastPayment = paidInvoices[0] ?? null;

    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <div className="flex items-center gap-1">
            <CreditCard className="w-[12px] h-[12px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">{t("payments.lastPayment")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                {t("payments.loading")}
              </span>
            </div>
          ) : !lastPayment ? (
            <p className="font-mohave text-body-sm text-text-disabled">
              {t("payments.noPayments")}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-mohave text-[24px] leading-none text-status-success font-medium">
                {formatCurrency(lastPayment.total, locale)}
              </span>
              <span className="font-mohave text-body-sm text-text-primary truncate">
                {lastPayment.client?.name ?? t("payments.unknownClient")}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                {formatRelativeDate(lastPayment.paidAt, locale, t)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const maxItems = size === "lg" ? 7 : 3;

  // ── MD / LG: List of recent payments ──────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <CreditCard className="w-[12px] h-[12px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">
              {t("payments.title")}
            </CardTitle>
          </div>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : t("payments.total").replace("{count}", String(paidInvoices.length))}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
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
          <div className="space-y-[6px]">
            {paidInvoices.slice(0, maxItems).map((invoice) => (
              <PaymentRow key={invoice.id} invoice={invoice} />
            ))}
            {paidInvoices.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                {t("payments.more").replace("{count}", String(paidInvoices.length - maxItems))}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payment row
// ---------------------------------------------------------------------------

function PaymentRow({
  invoice,
}: {
  invoice: Invoice & { paidAt: Date | string };
}) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const clientName = invoice.client?.name ?? t("payments.unknownClient");

  return (
    <div className="flex items-center gap-1.5 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors">
      {/* Avatar placeholder */}
      <div className="w-[24px] h-[24px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0">
        <User className="w-[12px] h-[12px] text-text-disabled" />
      </div>

      {/* Client name + invoice number */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {clientName}
        </p>
        <span className="font-mono text-[11px] text-text-tertiary">
          {invoice.invoiceNumber} · {formatRelativeDate(invoice.paidAt, locale, t)}
        </span>
      </div>

      {/* Amount in green */}
      <span className="font-mono text-[11px] text-status-success shrink-0 font-medium">
        {formatCurrency(invoice.total, locale)}
      </span>
    </div>
  );
}
