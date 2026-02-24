"use client";

import { useMemo } from "react";
import { CreditCard, Loader2, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useInvoices } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PaymentsRecentWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a date as relative time if within 7 days, otherwise short date.
 */
function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return formatShortDate(d);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "1d ago";
  if (diffDays <= 7) return `${diffDays}d ago`;
  return formatShortDate(d);
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentsRecentWidget({ size }: PaymentsRecentWidgetProps) {
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
            <CardTitle className="text-card-subtitle">Last Payment</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                Loading...
              </span>
            </div>
          ) : !lastPayment ? (
            <p className="font-mohave text-body-sm text-text-disabled">
              No payments yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-mohave text-[24px] leading-none text-status-success font-medium">
                {formatCurrency(lastPayment.total)}
              </span>
              <span className="font-mohave text-body-sm text-text-primary truncate">
                {lastPayment.client?.name ?? "Unknown Client"}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                {formatRelativeDate(lastPayment.paidAt)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD: List of up to 5 recent payments ─────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <CreditCard className="w-[12px] h-[12px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">
              Recent Payments
            </CardTitle>
          </div>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${paidInvoices.length} total`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading payments...
            </span>
          </div>
        ) : paidInvoices.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No payments received
          </p>
        ) : (
          <div className="space-y-[6px]">
            {paidInvoices.slice(0, 5).map((invoice) => (
              <PaymentRow key={invoice.id} invoice={invoice} />
            ))}
            {paidInvoices.length > 5 && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{paidInvoices.length - 5} more
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
  const clientName = invoice.client?.name ?? "Unknown Client";

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
          {invoice.invoiceNumber} · {formatRelativeDate(invoice.paidAt)}
        </span>
      </div>

      {/* Amount in green */}
      <span className="font-mono text-[11px] text-status-success shrink-0 font-medium">
        {formatCurrency(invoice.total)}
      </span>
    </div>
  );
}
