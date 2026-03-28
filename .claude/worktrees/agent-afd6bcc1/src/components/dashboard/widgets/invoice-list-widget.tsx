"use client";

import { useMemo, useState, useCallback } from "react";
import { Loader2, Send, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices, useSendInvoice } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvoiceListWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusFilter = "all-open" | "draft" | "sent" | "viewed" | "past_due";

const STATUS_FILTER_LABEL_KEYS: Record<StatusFilter, string> = {
  "all-open": "invoiceList.filterOpen",
  draft: "invoiceList.filterDraft",
  sent: "invoiceList.filterSent",
  viewed: "invoiceList.filterViewed",
  past_due: "invoiceList.filterPastDue",
};

/** Map config filter value to the InvoiceStatus enum values it matches */
function matchesFilter(invoice: Invoice, filter: StatusFilter): boolean {
  if (filter === "all-open") {
    return (
      invoice.status !== InvoiceStatus.Paid &&
      invoice.status !== InvoiceStatus.Void &&
      invoice.status !== InvoiceStatus.WrittenOff
    );
  }
  const map: Record<string, InvoiceStatus> = {
    draft: InvoiceStatus.Draft,
    sent: InvoiceStatus.Sent,
    viewed: InvoiceStatus.AwaitingPayment,
    past_due: InvoiceStatus.PastDue,
  };
  return invoice.status === map[filter];
}

function statusBadgeClasses(status: InvoiceStatus): string {
  switch (status) {
    case InvoiceStatus.Draft:
      return "text-text-disabled bg-text-disabled/15";
    case InvoiceStatus.Sent:
    case InvoiceStatus.AwaitingPayment:
      return "text-ops-accent bg-ops-accent/15";
    case InvoiceStatus.PastDue:
      return "text-ops-error bg-ops-error/15";
    case InvoiceStatus.PartiallyPaid:
      return "text-ops-amber bg-ops-amber/15";
    case InvoiceStatus.Paid:
      return "text-status-success bg-status-success/15";
    default:
      return "text-text-disabled bg-text-disabled/15";
  }
}

function statusLabel(status: InvoiceStatus, t: (key: string) => string): string {
  switch (status) {
    case InvoiceStatus.Draft:
      return t("invoiceList.statusDraft");
    case InvoiceStatus.Sent:
      return t("invoiceList.statusSent");
    case InvoiceStatus.AwaitingPayment:
      return t("invoiceList.statusAwaiting");
    case InvoiceStatus.PartiallyPaid:
      return t("invoiceList.statusPartial");
    case InvoiceStatus.PastDue:
      return t("invoiceList.statusPastDue");
    case InvoiceStatus.Paid:
      return t("invoiceList.statusPaid");
    case InvoiceStatus.Void:
      return t("invoiceList.statusVoid");
    case InvoiceStatus.WrittenOff:
      return t("invoiceList.statusWrittenOff");
    default:
      return status;
  }
}

function formatCurrency(amount: number, locale: Locale): string {
  return amount.toLocaleString(getDateLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoiceListWidget({ size, config }: InvoiceListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const filter = (config.statusFilter as StatusFilter) ?? "all-open";
  const { data: invoices, isLoading } = useInvoices();

  const filtered = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => matchesFilter(inv, filter));
  }, [invoices, filter]);

  const totalAmount = useMemo(
    () => filtered.reduce((sum, inv) => sum + inv.balanceDue, 0),
    [filtered]
  );

  const maxItems = size === "lg" ? 7 : size === "md" ? 3 : 0;

  // ── SM: Count + total amount ────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">
            {t(STATUS_FILTER_LABEL_KEYS[filter])} {t("invoiceList.invoices")}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                {t("invoiceList.loadingShort")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-mohave text-[24px] leading-none text-text-primary font-medium">
                {filtered.length}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                {formatCurrency(totalAmount, locale)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: List with send button ──────────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {t(STATUS_FILTER_LABEL_KEYS[filter])} {t("invoiceList.invoices")}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${filtered.length} \u00B7 ${formatCurrency(totalAmount, locale)}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("invoiceList.loading")}
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("invoiceList.noInvoicesPrefix")} {t(STATUS_FILTER_LABEL_KEYS[filter]).toLowerCase()} {t("invoiceList.invoicesLower")}
          </p>
        ) : (
          <div className="space-y-[6px]">
            {filtered.slice(0, maxItems).map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
            {filtered.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{filtered.length - maxItems} {t("invoiceList.more")}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoice row with one-click send
// ---------------------------------------------------------------------------

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const sendInvoice = useSendInvoice();
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent">("idle");

  const handleSend = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (sendState !== "idle") return;
      setSendState("sending");
      sendInvoice.mutate(invoice.id, {
        onSuccess: () => {
          setSendState("sent");
          setTimeout(() => setSendState("idle"), 2000);
        },
        onError: () => {
          setSendState("idle");
        },
      });
    },
    [invoice.id, sendState, sendInvoice]
  );

  const clientName = invoice.client?.name ?? t("invoiceList.unknownClient");
  const dueDisplay = formatDate(invoice.dueDate, locale);
  const isDraft = invoice.status === InvoiceStatus.Draft;

  return (
    <div className="flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group">
      {/* Client name */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {clientName}
        </p>
        <span className="font-mono text-[11px] text-text-tertiary">
          {t("invoiceList.due")} {dueDisplay}
        </span>
      </div>

      {/* Amount */}
      <span className="font-mono text-[11px] text-text-secondary shrink-0">
        {formatCurrency(invoice.balanceDue, locale)}
      </span>

      {/* Status badge */}
      <span
        className={cn(
          "font-mohave text-status px-1.5 py-[1px] rounded-full shrink-0",
          statusBadgeClasses(invoice.status)
        )}
      >
        {statusLabel(invoice.status, t)}
      </span>

      {/* One-click Send (draft only) */}
      {isDraft && (
        <button
          onClick={handleSend}
          disabled={sendState !== "idle"}
          className={cn(
            "shrink-0 flex items-center gap-0.5 px-1.5 py-[2px] rounded transition-all duration-200",
            "text-text-secondary hover:text-ops-accent hover:bg-ops-accent/10",
            sendState === "sent" && "text-status-success"
          )}
          title={t("invoiceList.sendInvoice")}
        >
          {sendState === "sending" ? (
            <Loader2 className="w-[12px] h-[12px] animate-spin" />
          ) : sendState === "sent" ? (
            <Check className="w-[12px] h-[12px]" />
          ) : (
            <>
              <Send className="w-[12px] h-[12px]" />
              <span className="font-mohave text-[12px]">{t("invoiceList.send")}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
