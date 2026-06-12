"use client";

/**
 * Books — A/R aging view (?segment=invoices&view=aging). Port of the
 * retired /accounting dashboard tab (capability inventory A1–A4):
 * aging buckets, top clients, invoice status breakdown — restyled to
 * the approved direction-A pixels. /accounting redirects land here.
 */

import { useMemo } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { useAccountingMetrics } from "@/lib/hooks";
import { InvoiceStatus, formatCurrency } from "@/lib/types/pipeline";
import type { Invoice } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";
import { formatEnumLabel } from "@/lib/utils/format";
import { SegmentStatLine, formatMetricValue, type StatLineItem } from "../segment-toolbar";

// ─── Aging buckets (semantics identical to the retired page) ─────────────────

function calculateAgingBuckets(invoices: Invoice[]) {
  const now = new Date();
  const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0 };

  for (const inv of invoices) {
    if (
      inv.status === InvoiceStatus.Void ||
      inv.status === InvoiceStatus.Draft ||
      inv.status === InvoiceStatus.Paid
    )
      continue;

    const balance = inv.balanceDue;
    if (balance <= 0) continue;

    if (!inv.dueDate) {
      buckets.current += balance;
      continue;
    }

    const diffDays = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
    if (diffDays <= 0) buckets.current += balance;
    else if (diffDays <= 30) buckets.days1_30 += balance;
    else if (diffDays <= 60) buckets.days31_60 += balance;
    else if (diffDays <= 90) buckets.days61_90 += balance;
    else buckets.days90Plus += balance;
  }

  return buckets;
}

function AgingBar({
  label,
  amount,
  maxAmount,
  barClass,
}: {
  label: string;
  amount: number;
  maxAmount: number;
  /** Tailwind background class tracing to a design-system token. */
  barClass: string;
}) {
  const pct = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
  return (
    <div className="space-y-[4px]">
      <div className="flex justify-between">
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">
          {label}
        </span>
        <span className="font-mono text-data-sm text-text-2 tabular-nums">
          {formatCurrency(amount)}
        </span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[2px] bg-fill-neutral-dim">
        <div
          className={cn(
            "h-full rounded-[2px] transition-[width] duration-500 ease-smooth motion-reduce:transition-none",
            barClass,
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </h2>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function ArAgingView({
  invoices,
  clientMap,
  onBackToList,
}: {
  invoices: Invoice[];
  clientMap: Map<string, string>;
  /** Absent for accounting.view-only users (no document list to go back to). */
  onBackToList?: () => void;
}) {
  const { t } = useDictionary("accounting");
  const { t: tb } = useDictionary("books");
  const { t: tp } = useDictionary("pipeline");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const { data: accountingMetrics = [] } = useAccountingMetrics();

  const aging = useMemo(() => calculateAgingBuckets(invoices), [invoices]);
  const maxAging = Math.max(
    aging.current,
    aging.days1_30,
    aging.days31_60,
    aging.days61_90,
    aging.days90Plus,
    1,
  );

  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; total: number; paid: number }>();
    for (const inv of invoices) {
      if (inv.status === InvoiceStatus.Void || !inv.clientId) continue;
      const existing = map.get(inv.clientId) || {
        name: clientMap.get(inv.clientId) ?? inv.clientId,
        total: 0,
        paid: 0,
      };
      existing.total += inv.total;
      existing.paid += inv.amountPaid;
      map.set(inv.clientId, existing);
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [invoices, clientMap]);

  const statItems = useMemo<StatLineItem[]>(() => {
    const find = (needle: string) =>
      accountingMetrics.find((m) => m.label.toLowerCase().includes(needle));
    const entries: Array<[string, ReturnType<typeof find>]> = [
      [tb("stat.outstanding"), find("outstanding")],
      [tb("stat.collectedMtd"), find("collected")],
      [tb("ledger.overdue"), find("overdue")],
      [tb("stat.aging90"), find("aging") ?? find("90")],
    ];
    return entries
      .filter((e): e is [string, NonNullable<ReturnType<typeof find>>] => !!e[1])
      .map(([label, m]) => ({ label, value: formatMetricValue(m, numLocale), note: m.breakdown }));
  }, [accountingMetrics, tb, numLocale]);

  return (
    // Sibling glass panels sit 24px apart (DESIGN.md §7 panel gap).
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-[12px]">
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="rounded-[4px] border border-border px-[10px] py-[4px] font-mono text-micro font-medium uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text-2"
          >
            ← {tb("view.list")}
          </button>
        )}
        <SegmentStatLine items={statItems} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Aging report */}
        <div className="glass-surface space-y-1.5 p-2">
          <PanelTitle>{t("aging.title")}</PanelTitle>
          <div className="space-y-[12px] pt-0.5">
            <AgingBar label={t("aging.current")} amount={aging.current} maxAmount={maxAging} barClass="bg-olive" />
            <AgingBar label={t("aging.1to30")} amount={aging.days1_30} maxAmount={maxAging} barClass="bg-tan" />
            <AgingBar label={t("aging.31to60")} amount={aging.days31_60} maxAmount={maxAging} barClass="bg-financial-receivables" />
            <AgingBar label={t("aging.61to90")} amount={aging.days61_90} maxAmount={maxAging} barClass="bg-rose" />
            <AgingBar label={t("aging.90plus")} amount={aging.days90Plus} maxAmount={maxAging} barClass="bg-financial-overdue" />
          </div>
        </div>

        {/* Top clients */}
        <div className="glass-surface space-y-1.5 p-2">
          <PanelTitle>{t("topClients.title")}</PanelTitle>
          {topClients.length === 0 ? (
            <p className="py-3 font-mono text-micro text-text-mute">—</p>
          ) : (
            <div className="space-y-[2px] pt-0.5">
              {topClients.map((client, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded px-1 py-[6px] hover:bg-surface-hover-subtle"
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="w-[16px] shrink-0 text-right font-mono text-micro text-text-3 tabular-nums">
                      {idx + 1}.
                    </span>
                    <span className="truncate font-mohave text-body-sm text-text-2">
                      {client.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="font-mono text-data-sm text-text tabular-nums">
                      {formatCurrency(client.total)}
                    </span>
                    <span className="font-mono text-micro text-text-3 tabular-nums">
                      ({t("topClients.paid").replace("{amount}", formatCurrency(client.paid))})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invoice status breakdown */}
      <div className="glass-surface space-y-1.5 p-2">
        <PanelTitle>{t("invoiceBreakdown.title")}</PanelTitle>
        <div className="grid grid-cols-2 gap-1.5 pt-0.5 sm:grid-cols-3 lg:grid-cols-6">
          {Object.values(InvoiceStatus).map((status) => {
            const list = invoices.filter((i) => i.status === status);
            const total = list.reduce((sum, i) => sum + i.total, 0);
            return (
              <div
                key={status}
                className="flex flex-col gap-[4px] rounded-[10px] border border-border bg-transparent p-1.5"
              >
                <span className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">
                  {tp(`invoices.status.${status}`, formatEnumLabel(status))}
                </span>
                <span className="font-mono text-data-lg text-text tabular-nums">{list.length}</span>
                <span className="font-mono text-micro text-text-3 tabular-nums">
                  {formatCurrency(total)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
