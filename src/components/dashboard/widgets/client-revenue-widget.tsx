"use client";

import { useMemo } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { Invoice } from "@/lib/types/pipeline";
import { useClients, useInvoices } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClientRevenueWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Period = "all-time" | "ytd" | "this-month";

const PERIOD_LABEL: Record<Period, string> = {
  "all-time": "All Time",
  ytd: "Year to Date",
  "this-month": "This Month",
};

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function isInPeriod(paidAt: Date | string | null, period: Period): boolean {
  if (!paidAt) return false;
  const date = typeof paidAt === "string" ? new Date(paidAt) : paidAt;
  const now = new Date();

  switch (period) {
    case "all-time":
      return true;
    case "ytd":
      return date.getFullYear() === now.getFullYear();
    case "this-month":
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth()
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientRevenueWidget({ size, config }: ClientRevenueWidgetProps) {
  const period = (config.period as Period) ?? "all-time";
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();

  const isLoading = clientsLoading || invoicesLoading;

  // Build client name lookup
  const clientNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!clientsData?.clients) return map;
    for (const c of clientsData.clients) {
      map[c.id] = c.name;
    }
    return map;
  }, [clientsData]);

  // Aggregate revenue by client
  const rankedClients = useMemo(() => {
    if (!invoices) return [];

    const revenueMap: Record<string, number> = {};

    for (const inv of invoices) {
      if (inv.status !== InvoiceStatus.Paid) continue;
      if (!isInPeriod(inv.paidAt, period)) continue;
      revenueMap[inv.clientId] = (revenueMap[inv.clientId] ?? 0) + inv.amountPaid;
    }

    const entries = Object.entries(revenueMap)
      .map(([clientId, amount]) => ({
        clientId,
        name: clientNameMap[clientId] ?? "Unknown Client",
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    return entries;
  }, [invoices, period, clientNameMap]);

  const maxItems = size === "lg" ? 7 : 3;
  const displayed = rankedClients.slice(0, maxItems);
  const maxAmount = displayed.length > 0 ? displayed[0].amount : 0;

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Client Revenue</CardTitle>
          <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-tertiary">
            {PERIOD_LABEL[period]}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading revenue...
            </span>
          </div>
        ) : displayed.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No paid invoices in this period
          </p>
        ) : (
          <div className="space-y-[6px]">
            {displayed.map((entry, i) => (
              <div
                key={entry.clientId}
                className="flex items-center gap-1.5 px-1 py-[5px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
              >
                {/* Rank */}
                <span className="font-mono text-[11px] text-text-disabled w-[16px] shrink-0 text-right">
                  {i + 1}
                </span>

                {/* Name + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-[2px]">
                    <span className="font-mohave text-body-sm text-text-primary truncate">
                      {entry.name}
                    </span>
                    <span className="font-mono text-[11px] text-text-secondary shrink-0 ml-1">
                      {formatCurrency(entry.amount)}
                    </span>
                  </div>

                  {/* Proportional bar (LG shows for all, MD shows for all too) */}
                  <div className="h-[4px] rounded-full bg-[rgba(255,255,255,0.04)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width:
                          maxAmount > 0
                            ? `${Math.max(4, (entry.amount / maxAmount) * 100)}%`
                            : "0%",
                        backgroundColor: "var(--ops-accent)",
                        opacity: 1 - i * 0.08,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {rankedClients.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{rankedClients.length - maxItems} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
