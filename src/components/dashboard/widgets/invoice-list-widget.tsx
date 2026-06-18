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
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { formatLocaleCurrency, getStatusLabel } from "./shared/widget-utils";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { WT } from "@/lib/widget-tokens";
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
  const openEntity = useWidgetEntityOpen();
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
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {isLoading ? "—" : filtered.length}
            </span>
            <button
              onClick={() => navigate("/books?segment=invoices&view=aging")}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t(STATUS_FILTER_LABEL_KEYS[filter])} {t("invoiceList.invoices")}
          </span>
          {!isLoading && (
            <span className="font-mono text-micro text-text-3 mt-0.5">
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
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t(STATUS_FILTER_LABEL_KEYS[filter])} {t("invoiceList.invoices")}
          </span>
          <div className="flex items-center gap-1.5">
            {/* Sort dropdown */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                  <ArrowUpDown className="w-[14px] h-[14px] text-text-mute" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-1 min-w-[100px]">
                <div className="flex flex-col">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSortField(opt.value)}
                      className={cn(
                        "font-mono text-micro uppercase tracking-wider px-2 py-1 rounded-sm text-left transition-colors",
                        sortField === opt.value
                          ? "text-text bg-[rgba(255,255,255,0.08)]"
                          : "text-text-3 hover:text-text-2"
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

        {/* Hero */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-mono text-display font-bold text-text leading-none">
            {isLoading ? "—" : formatLocaleCurrency(totalAmount, getDateLocale(locale), 0)}
          </span>
          <span className="font-mono text-micro text-text-mute">
            {filtered.length} {t("invoiceList.invoicesLower") ?? "invoices"}
          </span>
        </div>

        <ScrollFade>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
              <span className="font-mono text-micro text-text-mute ml-1">
                {t("invoiceList.loading")}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-mute py-2">
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
                  openEntity={openEntity}
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

      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoice row — bar indicator (left) + currency metric (right)
// PartiallyPaid: bar color is dynamic based on % paid
// ---------------------------------------------------------------------------

/** Map invoice status to a WT CSS variable color for the bar indicator */
function invoiceStatusToColor(status: InvoiceStatus): string {
  switch (status) {
    case InvoiceStatus.Draft:
      return WT.muted;
    case InvoiceStatus.Sent:
      return WT.accent;
    case InvoiceStatus.AwaitingPayment:
      return WT.warning;
    case InvoiceStatus.PartiallyPaid:
      return WT.receivables;
    case InvoiceStatus.PastDue:
      return WT.error;
    case InvoiceStatus.Paid:
      return WT.success;
    case InvoiceStatus.Void:
    case InvoiceStatus.WrittenOff:
      return WT.muted;
    default:
      return WT.muted;
  }
}

function InvoiceRow({
  invoice,
  index,
  isVisible,
  reducedMotion,
  openEntity,
}: {
  invoice: Invoice;
  index?: number;
  isVisible?: boolean;
  reducedMotion?: boolean | null;
  openEntity: ReturnType<typeof useWidgetEntityOpen>;
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

  // Determine indicator color and label
  let indicatorColor: string;
  let indicatorLabel: string;

  if (isPartial && pctPaid !== null) {
    indicatorColor = pctPaid >= 75 ? WT.success : pctPaid >= 40 ? WT.warning : WT.error;
    indicatorLabel = `${pctPaid}% ${t("invoiceList.pctPaid") ?? "Paid"}`;
  } else {
    indicatorColor = invoiceStatusToColor(invoice.status);
    indicatorLabel = getStatusLabel(invoice.status, "invoice", t);
  }

  // Send button — drafts only, goes through the action slot
  const actionSlot = isDraft ? (
    <button
      onClick={handleSend}
      disabled={sendState !== "idle"}
      className={cn(
        "shrink-0 flex items-center gap-0.5 px-1.5 py-[2px] rounded transition-all duration-200",
        "text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.05)]",
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
          <span className="font-mohave text-micro">{t("invoiceList.send")}</span>
        </>
      )}
    </button>
  ) : undefined;

  return (
    <WidgetLineItem
      indicator={{ type: "bar", color: indicatorColor, label: indicatorLabel }}
      primary={clientName}
      secondary={`#${invoice.invoiceNumber} · ${t("invoiceList.due")} ${dueDisplay}`}
      metric={formatLocaleCurrency(invoice.balanceDue, getDateLocale(locale), 2)}
      action={actionSlot}
      onClick={(e) => openEntity({
        entityType: "invoice",
        entityId: invoice.id,
        title: clientName,
        color: indicatorColor,
        event: e,
        fallbackPath: "/books?segment=invoices",
      })}
      index={index}
      isVisible={isVisible}
      reducedMotion={reducedMotion}
    />
  );
}
