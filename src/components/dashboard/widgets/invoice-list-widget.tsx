"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Check, ArrowUpDown, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices, useSendInvoice, useClientMap } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { showFooter } from "@/lib/widget-tokens";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { formatLocaleCurrency } from "./shared/widget-utils";
import { ScrollFade } from "./shared/scroll-fade";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
type SortField = "due" | "amount" | "client";

const STATUS_FILTER_LABEL_KEYS: Record<StatusFilter, string> = {
  "all-open": "invoiceList.filterOpen",
  draft: "invoiceList.filterDraft",
  sent: "invoiceList.filterSent",
  viewed: "invoiceList.filterViewed",
  past_due: "invoiceList.filterPastDue",
};

const SORT_OPTIONS: { value: SortField; labelKey: string; fallback: string }[] = [
  { value: "due", labelKey: "invoiceList.sortByDue", fallback: "Due Date" },
  { value: "amount", labelKey: "invoiceList.sortByAmount", fallback: "Amount" },
  { value: "client", labelKey: "invoiceList.sortByClient", fallback: "Client" },
];

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

function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" });
}

function sortInvoices(invoices: Invoice[], field: SortField): Invoice[] {
  return [...invoices].sort((a, b) => {
    switch (field) {
      case "due":
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      case "amount":
        return b.balanceDue - a.balanceDue;
      case "client":
        return (a.client?.name ?? "").localeCompare(b.client?.name ?? "");
      default:
        return 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoiceListWidget({ size, config }: InvoiceListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const filter = (config.statusFilter as StatusFilter) ?? "all-open";
  const { data: rawInvoices, isLoading } = useInvoices();
  const clientMap = useClientMap();
  const [sortField, setSortField] = useState<SortField>("due");
  const [listExpanded, setListExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const filtered = useMemo(() => {
    if (!rawInvoices) return [];
    const mapped = rawInvoices
      .filter((inv) => matchesFilter(inv, filter))
      .map((inv) => {
        if (inv.client?.name) return inv;
        const c = clientMap.get(inv.clientId);
        return c ? { ...inv, client: c as Invoice["client"] } : inv;
      });
    return sortInvoices(mapped, sortField);
  }, [rawInvoices, filter, clientMap, sortField]);

  const totalAmount = useMemo(
    () => filtered.reduce((sum, inv) => sum + inv.balanceDue, 0),
    [filtered]
  );

  const defaultMaxItems = size === "lg" ? 7 : size === "md" ? 3 : 0;
  const maxItems = listExpanded ? filtered.length : defaultMaxItems;
  const remaining = filtered.length - defaultMaxItems;

  // ── SM: Hero + title + total amount ─────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {isLoading ? "—" : filtered.length}
            </span>
            <button
              onClick={() => navigate("/accounting")}
              className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t(STATUS_FILTER_LABEL_KEYS[filter])} {t("invoiceList.invoices")}
          </span>
          {!isLoading && (
            <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
              {formatLocaleCurrency(totalAmount, getDateLocale(locale), 2)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: List with sort + WidgetLineItem + WidgetStatusBadge ──────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t(STATUS_FILTER_LABEL_KEYS[filter])} {t("invoiceList.invoices")}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-micro text-text-tertiary">
              {isLoading ? "..." : `${filtered.length} \u00B7 ${formatLocaleCurrency(totalAmount, getDateLocale(locale), 2)}`}
            </span>
            {/* Sort dropdown */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                  <ArrowUpDown className="w-[14px] h-[14px] text-text-disabled" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-1 min-w-[100px]">
                <div className="flex flex-col">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSortField(opt.value)}
                      className={cn(
                        "font-kosugi text-micro-sm uppercase tracking-wider px-2 py-1 rounded-sm text-left transition-colors",
                        sortField === opt.value
                          ? "text-ops-accent bg-ops-accent/15"
                          : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {t(opt.labelKey) ?? opt.fallback}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <ScrollFade>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-micro-sm text-text-disabled ml-1">
                {t("invoiceList.loading")}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              {t("invoiceList.noInvoicesPrefix")} {t(STATUS_FILTER_LABEL_KEYS[filter]).toLowerCase()} {t("invoiceList.invoicesLower")}
            </p>
          ) : (
            <div className="space-y-[2px]">
              {filtered.slice(0, maxItems).map((invoice, i) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
              {remaining > 0 && (
                <WidgetMoreButton
                  remaining={remaining}
                  expanded={listExpanded}
                  onToggle={() => setListExpanded(!listExpanded)}
                />
              )}
            </div>
          )}
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => navigate("/accounting")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left shrink-0"
          >
            {t("invoiceList.viewAll") ?? "View Invoices"}
          </button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoice row — uses WidgetLineItem + WidgetStatusBadge
// For PartiallyPaid: shows % paid instead of status text
// ---------------------------------------------------------------------------

function InvoiceRow({
  invoice,
  index,
  isVisible,
  reducedMotion,
}: {
  invoice: Invoice;
  index?: number;
  isVisible?: boolean;
  reducedMotion?: boolean | null;
}) {
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
  const isPartial = invoice.status === InvoiceStatus.PartiallyPaid;

  // Compute % paid for partial invoices
  const pctPaid = isPartial && invoice.total > 0
    ? Math.round((invoice.amountPaid / invoice.total) * 100)
    : null;

  // Partial-paid: custom metric badge (same sizing as WidgetStatusBadge)
  const metricSlot = isPartial && pctPaid !== null ? (
    <span className="font-mono text-micro-sm px-1.5 py-[1px] rounded-sm uppercase tracking-wider border shrink-0 whitespace-nowrap text-financial-receivables bg-financial-receivables/15 border-financial-receivables/30">
      {pctPaid}% {t("invoiceList.pctPaid") ?? "paid"}
    </span>
  ) : (
    formatLocaleCurrency(invoice.balanceDue, getDateLocale(locale), 2)
  );

  // Send button — drafts only, goes through the action slot
  const actionSlot = isDraft ? (
    <button
      onClick={handleSend}
      disabled={sendState !== "idle"}
      className={cn(
        "shrink-0 flex items-center gap-0.5 px-1.5 py-[2px] rounded transition-all duration-200",
        "text-text-secondary hover:text-ops-accent hover:bg-ops-accent/10",
        sendState === "sent" && "text-status-success"
      )}
      title={t("invoiceList.sendInvoice")}
      aria-label={t("invoiceList.sendInvoice")}
    >
      {sendState === "sending" ? (
        <Loader2 className="w-[12px] h-[12px] animate-spin" />
      ) : sendState === "sent" ? (
        <Check className="w-[12px] h-[12px]" />
      ) : (
        <>
          <Send className="w-[12px] h-[12px]" />
          <span className="font-mohave text-micro-sm">{t("invoiceList.send")}</span>
        </>
      )}
    </button>
  ) : undefined;

  return (
    <WidgetLineItem
      primary={clientName}
      secondary={`${t("invoiceList.due")} ${dueDisplay}`}
      metric={metricSlot}
      badge={isPartial ? undefined : { status: invoice.status, entity: "invoice" }}
      action={actionSlot}
      index={index}
      isVisible={isVisible}
      reducedMotion={reducedMotion}
    />
  );
}
