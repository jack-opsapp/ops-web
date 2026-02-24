"use client";

import { useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { Invoice } from "@/lib/types/pipeline";
import { useInvoices } from "@/lib/hooks";
import { differenceInDays } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PastDueInvoicesWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PastDueInvoicesWidget({ size }: PastDueInvoicesWidgetProps) {
  const { data: invoices, isLoading } = useInvoices();
  const today = useMemo(() => new Date(), []);

  const pastDue = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => inv.status === InvoiceStatus.PastDue);
  }, [invoices]);

  const totalPastDue = useMemo(
    () => pastDue.reduce((sum, inv) => sum + inv.balanceDue, 0),
    [pastDue]
  );

  // ── SM: Count + total ─────────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">Past Due</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                Loading...
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "font-mohave text-[24px] leading-none font-medium",
                  pastDue.length > 0
                    ? "text-status-error"
                    : "text-text-primary"
                )}
              >
                {pastDue.length}
              </span>
              <span
                className={cn(
                  "font-mono text-[11px]",
                  pastDue.length > 0
                    ? "text-status-error"
                    : "text-text-tertiary"
                )}
              >
                {formatCurrency(totalPastDue)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD: List ──────────────────────────────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Past Due Invoices</CardTitle>
          <span
            className={cn(
              "font-mono text-[11px]",
              pastDue.length > 0
                ? "text-status-error"
                : "text-text-tertiary"
            )}
          >
            {isLoading
              ? "..."
              : `${pastDue.length} \u00B7 ${formatCurrency(totalPastDue)}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading invoices...
            </span>
          </div>
        ) : pastDue.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No past due invoices
          </p>
        ) : (
          <div className="space-y-[6px]">
            {pastDue.slice(0, 5).map((invoice) => {
              const clientName = invoice.client?.name ?? "Unknown Client";
              const daysPast = differenceInDays(today, new Date(invoice.dueDate));

              return (
                <div
                  key={invoice.id}
                  className="flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group"
                >
                  <AlertTriangle className="w-[14px] h-[14px] text-status-error shrink-0" />

                  <div className="flex-1 min-w-0">
                    <p className="font-mohave text-body-sm text-text-primary truncate">
                      {clientName}
                    </p>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      #{invoice.invoiceNumber}
                    </span>
                  </div>

                  <span className="font-mono text-[11px] text-text-secondary shrink-0">
                    {formatCurrency(invoice.balanceDue)}
                  </span>

                  <span className="font-mono text-[11px] text-status-error shrink-0">
                    {daysPast}d
                  </span>
                </div>
              );
            })}
            {pastDue.length > 5 && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{pastDue.length - 5} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
