"use client";

import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { PortalStatusBadge } from "@/components/portal/portal-status-badge";
import { formatCurrency } from "@/lib/types/pipeline";
import { Calendar, FileText, CreditCard, Building2, User } from "lucide-react";
import type { FieldVisibility } from "@/lib/types/document-template";
import { DEFAULT_FIELD_VISIBILITY } from "@/lib/types/document-template";

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

export interface DocumentPartyInfo {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface PortalInvoiceViewProps {
  invoice: InvoiceDetail;
  fieldVisibility?: FieldVisibility;
  companyInfo?: DocumentPartyInfo | null;
  clientInfo?: DocumentPartyInfo | null;
}

function formatDate(date: string | Date | null, locale: Locale): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPaymentMethod(method: string | null, t: (key: string) => string): string {
  if (!method) return t("invoice.payment");
  const labels: Record<string, string> = {
    credit_card: t("invoice.creditCard"),
    debit_card: t("invoice.debitCard"),
    bank_transfer: t("invoice.bankTransfer"),
    ach: t("invoice.ach"),
    check: t("invoice.check"),
    cash: t("invoice.cash"),
    other: t("invoice.other"),
  };
  return labels[method] ?? method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PartySection({
  label,
  icon: Icon,
  info,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  info: DocumentPartyInfo;
}) {
  return (
    <div className="flex-1 min-w-[180px]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5" style={{ color: "var(--portal-text-tertiary)" }} />
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--portal-text-tertiary)" }}
        >
          {label}
        </span>
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--portal-text)" }}>
        {info.name}
      </p>
      {info.address && (
        <p className="text-xs mt-0.5" style={{ color: "var(--portal-text-secondary)" }}>
          {info.address}
        </p>
      )}
      {info.phone && (
        <p className="text-xs mt-0.5" style={{ color: "var(--portal-text-secondary)" }}>
          {info.phone}
        </p>
      )}
      {info.email && (
        <p className="text-xs mt-0.5" style={{ color: "var(--portal-text-secondary)" }}>
          {info.email}
        </p>
      )}
    </div>
  );
}

export function PortalInvoiceView({
  invoice,
  fieldVisibility = DEFAULT_FIELD_VISIBILITY,
  companyInfo,
  clientInfo,
}: PortalInvoiceViewProps) {
  const { t } = useDictionary("portal");
  const { locale } = useLocale();
  const v = fieldVisibility;

  // Determine which columns to show in line items table
  const showQty = v.showQuantities;
  const showPrice = v.showUnitPrices;
  const showLineTotal = v.showLineTotals;

  // Calculate grid columns based on visible fields
  // Item always takes remaining space
  const visibleDataCols = [showQty, showPrice, showLineTotal].filter(Boolean).length;
  const itemSpan = 12 - visibleDataCols * 2;

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
                {t("invoice.heading")} #{invoice.invoiceNumber}
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
              {t("invoice.issued")} {formatDate(invoice.issueDate, locale)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" style={{ color: "var(--portal-text-tertiary)" }} />
            <span style={{ color: "var(--portal-text-secondary)" }}>
              {t("invoice.due")} {formatDate(invoice.dueDate, locale)}
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

      {/* From / To Sections */}
      {(v.showFromSection && companyInfo) || (v.showToSection && clientInfo) ? (
        <div
          className="rounded-xl p-6"
          style={{
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
            borderRadius: "var(--portal-radius-lg)",
          }}
        >
          <div className="flex flex-wrap gap-6">
            {v.showFromSection && companyInfo && (
              <PartySection label={t("estimate.from")} icon={Building2} info={companyInfo} />
            )}
            {v.showToSection && clientInfo && (
              <PartySection label={t("estimate.to")} icon={User} info={clientInfo} />
            )}
          </div>
        </div>
      ) : null}

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
            {t("invoice.lineItems")}
          </h2>
        </div>

        {/* Table header */}
        <div
          className="hidden sm:grid gap-4 px-6 py-3 text-xs font-medium uppercase tracking-wider"
          style={{
            color: "var(--portal-text-tertiary)",
            backgroundColor: "var(--portal-bg-secondary)",
            gridTemplateColumns: `${itemSpan}fr${showQty ? " 2fr" : ""}${showPrice ? " 2fr" : ""}${showLineTotal ? " 2fr" : ""}`,
          }}
        >
          <div>{t("invoice.item")}</div>
          {showQty && <div className="text-right">{t("invoice.qty")}</div>}
          {showPrice && <div className="text-right">{t("invoice.unitPrice")}</div>}
          {showLineTotal && <div className="text-right">{t("invoice.total")}</div>}
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
            <div
              className="hidden sm:grid gap-4 items-start"
              style={{
                gridTemplateColumns: `${itemSpan}fr${showQty ? " 2fr" : ""}${showPrice ? " 2fr" : ""}${showLineTotal ? " 2fr" : ""}`,
              }}
            >
              <div>
                <p className="text-sm font-medium">{item.name}</p>
                {v.showDescriptions && item.description && (
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "var(--portal-text-secondary)" }}
                  >
                    {item.description}
                  </p>
                )}
              </div>
              {showQty && (
                <div
                  className="text-right text-sm"
                  style={{ color: "var(--portal-text-secondary)" }}
                >
                  {item.quantity}
                </div>
              )}
              {showPrice && (
                <div
                  className="text-right text-sm"
                  style={{ color: "var(--portal-text-secondary)" }}
                >
                  {formatCurrency(item.unitPrice)}
                </div>
              )}
              {showLineTotal && (
                <div className="text-right text-sm font-medium">
                  {formatCurrency(item.lineTotal)}
                </div>
              )}
            </div>

            {/* Mobile row */}
            <div className="sm:hidden">
              <div className="flex justify-between items-start mb-1">
                <p className="text-sm font-medium">{item.name}</p>
                {showLineTotal && (
                  <p className="text-sm font-medium">{formatCurrency(item.lineTotal)}</p>
                )}
              </div>
              {v.showDescriptions && item.description && (
                <p
                  className="text-xs mb-1"
                  style={{ color: "var(--portal-text-secondary)" }}
                >
                  {item.description}
                </p>
              )}
              {(showQty || showPrice) && (
                <p className="text-xs" style={{ color: "var(--portal-text-tertiary)" }}>
                  {showQty && showPrice
                    ? `${item.quantity} x ${formatCurrency(item.unitPrice)}`
                    : showQty
                      ? `Qty: ${item.quantity}`
                      : formatCurrency(item.unitPrice)}
                </p>
              )}
            </div>
          </div>
        ))}

        {invoice.lineItems.length === 0 && (
          <div className="px-6 py-8 text-center">
            <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
              {t("invoice.noLineItems")}
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
            <span style={{ color: "var(--portal-text-secondary)" }}>{t("invoice.subtotal")}</span>
            <span>{formatCurrency(invoice.subtotal)}</span>
          </div>

          {v.showDiscount && invoice.discountAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--portal-text-secondary)" }}>{t("invoice.discount")}</span>
              <span style={{ color: "var(--portal-success)" }}>
                -{formatCurrency(invoice.discountAmount)}
              </span>
            </div>
          )}

          {v.showTax && invoice.taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--portal-text-secondary)" }}>{t("invoice.tax")}</span>
              <span>{formatCurrency(invoice.taxAmount)}</span>
            </div>
          )}

          <div
            className="flex justify-between text-sm font-semibold pt-2"
            style={{ borderTop: "1px solid var(--portal-border)" }}
          >
            <span>{t("invoice.total")}</span>
            <span>{formatCurrency(invoice.total)}</span>
          </div>

          {invoice.amountPaid > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--portal-text-secondary)" }}>{t("invoice.amountPaid")}</span>
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
              {t("invoice.balanceDue")}
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
      {v.showPaymentInfo && invoice.payments.length > 0 && (
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
              {t("invoice.paymentHistory")}
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
                    {formatPaymentMethod(payment.paymentMethod, t)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--portal-text-tertiary)" }}>
                    {formatDate(payment.paymentDate, locale)}
                    {payment.referenceNumber && ` · ${t("invoice.ref")} ${payment.referenceNumber}`}
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
      {v.showFooter && invoice.footer && (
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
