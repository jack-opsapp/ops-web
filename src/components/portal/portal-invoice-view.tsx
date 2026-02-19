"use client";

import { PortalStatusBadge } from "@/components/portal/portal-status-badge";
import { formatCurrency } from "@/lib/types/pipeline";
import { Calendar, FileText, CreditCard } from "lucide-react";

interface InvoiceLineItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface InvoicePayment {
  id: string;
  amount: number;
  paymentMethod: string | null;
  paymentDate: string;
  referenceNumber: string | null;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  subject: string | null;
  status: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  clientMessage: string | null;
  footer: string | null;
  lineItems: InvoiceLineItem[];
  payments: InvoicePayment[];
  projectId: string | null;
}

interface PortalInvoiceViewProps {
  invoice: InvoiceDetail;
}

function formatDate(date: string | Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPaymentMethod(method: string | null): string {
  if (!method) return "Payment";
  const labels: Record<string, string> = {
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    bank_transfer: "Bank Transfer",
    ach: "ACH",
    check: "Check",
    cash: "Cash",
    other: "Other",
  };
  return labels[method] ?? method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PortalInvoiceView({ invoice }: PortalInvoiceViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="rounded-xl p-6"
        style={{
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-5 h-5" style={{ color: "var(--portal-accent)" }} />
              <h1
                className="text-xl"
                style={{
                  fontFamily: "var(--portal-heading-font)",
                  fontWeight: "var(--portal-heading-weight)",
                  textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
                }}
              >
                Invoice #{invoice.invoiceNumber}
              </h1>
            </div>
            {invoice.subject && (
              <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
                {invoice.subject}
              </p>
            )}
          </div>
          <PortalStatusBadge status={invoice.status} />
        </div>

        {/* Date info */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" style={{ color: "var(--portal-text-tertiary)" }} />
            <span style={{ color: "var(--portal-text-secondary)" }}>
              Issued: {formatDate(invoice.issueDate)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" style={{ color: "var(--portal-text-tertiary)" }} />
            <span style={{ color: "var(--portal-text-secondary)" }}>
              Due: {formatDate(invoice.dueDate)}
            </span>
          </div>
        </div>

        {/* Client message */}
        {invoice.clientMessage && (
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{
              color: "var(--portal-text-secondary)",
              padding: "12px 16px",
              backgroundColor: "var(--portal-bg-secondary)",
              borderRadius: "var(--portal-radius)",
            }}
          >
            {invoice.clientMessage}
          </p>
        )}
      </div>

      {/* Line Items Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <h2
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Line Items
          </h2>
        </div>

        {/* Table header */}
        <div
          className="hidden sm:grid grid-cols-12 gap-4 px-6 py-3 text-xs font-medium uppercase tracking-wider"
          style={{
            color: "var(--portal-text-tertiary)",
            backgroundColor: "var(--portal-bg-secondary)",
          }}
        >
          <div className="col-span-5">Item</div>
          <div className="col-span-2 text-right">Qty</div>
          <div className="col-span-2 text-right">Unit Price</div>
          <div className="col-span-3 text-right">Total</div>
        </div>

        {/* Table rows */}
        {invoice.lineItems.map((item, index) => (
          <div
            key={item.id}
            className="px-6 py-4"
            style={{
              borderBottom:
                index < invoice.lineItems.length - 1
                  ? "1px solid var(--portal-border)"
                  : undefined,
            }}
          >
            {/* Desktop row */}
            <div className="hidden sm:grid grid-cols-12 gap-4 items-start">
              <div className="col-span-5">
                <p className="text-sm font-medium">{item.name}</p>
                {item.description && (
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "var(--portal-text-secondary)" }}
                  >
                    {item.description}
                  </p>
                )}
              </div>
              <div
                className="col-span-2 text-right text-sm"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                {item.quantity}
              </div>
              <div
                className="col-span-2 text-right text-sm"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                {formatCurrency(item.unitPrice)}
              </div>
              <div className="col-span-3 text-right text-sm font-medium">
                {formatCurrency(item.lineTotal)}
              </div>
            </div>

            {/* Mobile row */}
            <div className="sm:hidden">
              <div className="flex justify-between items-start mb-1">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-sm font-medium">{formatCurrency(item.lineTotal)}</p>
              </div>
              {item.description && (
                <p
                  className="text-xs mb-1"
                  style={{ color: "var(--portal-text-secondary)" }}
                >
                  {item.description}
                </p>
              )}
              <p className="text-xs" style={{ color: "var(--portal-text-tertiary)" }}>
                {item.quantity} x {formatCurrency(item.unitPrice)}
              </p>
            </div>
          </div>
        ))}

        {invoice.lineItems.length === 0 && (
          <div className="px-6 py-8 text-center">
            <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
              No line items
            </p>
          </div>
        )}
      </div>

      {/* Totals */}
      <div
        className="rounded-xl p-6"
        style={{
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        <div className="max-w-xs ml-auto space-y-2">
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--portal-text-secondary)" }}>Subtotal</span>
            <span>{formatCurrency(invoice.subtotal)}</span>
          </div>

          {invoice.discountAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--portal-text-secondary)" }}>Discount</span>
              <span style={{ color: "var(--portal-success)" }}>
                -{formatCurrency(invoice.discountAmount)}
              </span>
            </div>
          )}

          {invoice.taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--portal-text-secondary)" }}>Tax</span>
              <span>{formatCurrency(invoice.taxAmount)}</span>
            </div>
          )}

          <div
            className="flex justify-between text-sm font-semibold pt-2"
            style={{ borderTop: "1px solid var(--portal-border)" }}
          >
            <span>Total</span>
            <span>{formatCurrency(invoice.total)}</span>
          </div>

          {invoice.amountPaid > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--portal-text-secondary)" }}>Amount Paid</span>
              <span style={{ color: "var(--portal-success)" }}>
                -{formatCurrency(invoice.amountPaid)}
              </span>
            </div>
          )}

          {/* Balance Due */}
          <div
            className="flex justify-between items-center pt-3 mt-2"
            style={{ borderTop: "2px solid var(--portal-border-strong)" }}
          >
            <span
              className="text-base font-bold"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
              }}
            >
              Balance Due
            </span>
            <span
              className="text-2xl font-bold"
              style={{
                color: invoice.balanceDue > 0
                  ? "var(--portal-warning)"
                  : "var(--portal-success)",
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
              }}
            >
              {formatCurrency(invoice.balanceDue)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment History */}
      {invoice.payments.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
            borderRadius: "var(--portal-radius-lg)",
          }}
        >
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--portal-border)" }}>
            <h2
              className="text-sm font-medium uppercase tracking-wider"
              style={{ color: "var(--portal-text-tertiary)" }}
            >
              Payment History
            </h2>
          </div>

          {invoice.payments.map((payment, index) => (
            <div
              key={payment.id}
              className="flex items-center justify-between px-6 py-4"
              style={{
                borderBottom:
                  index < invoice.payments.length - 1
                    ? "1px solid var(--portal-border)"
                    : undefined,
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "rgba(157,181,130,0.15)" }}
                >
                  <CreditCard className="w-4 h-4" style={{ color: "var(--portal-success)" }} />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {formatPaymentMethod(payment.paymentMethod)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--portal-text-tertiary)" }}>
                    {formatDate(payment.paymentDate)}
                    {payment.referenceNumber && ` · Ref: ${payment.referenceNumber}`}
                  </p>
                </div>
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--portal-success)" }}>
                {formatCurrency(payment.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {invoice.footer && (
        <p
          className="text-xs text-center"
          style={{ color: "var(--portal-text-tertiary)" }}
        >
          {invoice.footer}
        </p>
      )}
    </div>
  );
}
