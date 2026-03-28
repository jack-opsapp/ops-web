"use client";

import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { Calendar, FileText, Clock, HelpCircle, Tag, Percent, Receipt, Building2, User } from "lucide-react";
import { PortalStatusBadge } from "./portal-status-badge";
import { PortalLineItemCard } from "./portal-line-item-card";
import { formatCurrency } from "@/lib/types/pipeline";
import type { Estimate, LineItem } from "@/lib/types/pipeline";
import type { LineItemQuestion } from "@/lib/types/portal";
import type { FieldVisibility } from "@/lib/types/document-template";
import { DEFAULT_FIELD_VISIBILITY } from "@/lib/types/document-template";
import type { DocumentPartyInfo } from "./portal-invoice-view";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date | string | null, locale: Locale): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(date: Date | string | null, locale: Locale): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalEstimateViewProps {
  estimate: Estimate & { lineItems: LineItem[] };
  questions?: LineItemQuestion[];
  /** IDs of line items that have questions */
  lineItemIdsWithQuestions?: Set<string>;
  fieldVisibility?: FieldVisibility;
  companyInfo?: DocumentPartyInfo | null;
  clientInfo?: DocumentPartyInfo | null;
}

// ─── Party Section ────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalEstimateView({
  estimate,
  questions = [],
  lineItemIdsWithQuestions = new Set(),
  fieldVisibility = DEFAULT_FIELD_VISIBILITY,
  companyInfo,
  clientInfo,
}: PortalEstimateViewProps) {
  const { t } = useDictionary("portal");
  const { locale } = useLocale();
  const v = fieldVisibility;

  const standardItems = estimate.lineItems
    .filter((li) => !li.isOptional)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const optionalItems = estimate.lineItems
    .filter((li) => li.isOptional)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const hasQuestions = questions.length > 0;
  const isExpired =
    estimate.expirationDate &&
    new Date(estimate.expirationDate) < new Date() &&
    estimate.status !== "approved" &&
    estimate.status !== "converted";

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="rounded-xl"
        style={{
          padding: "var(--portal-card-padding, 24px)",
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <FileText
                className="w-5 h-5 shrink-0"
                style={{ color: "var(--portal-accent)" }}
              />
              <h1
                className="text-xl"
                style={{
                  fontFamily: "var(--portal-heading-font)",
                  fontWeight: "var(--portal-heading-weight)",
                  textTransform:
                    "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
                }}
              >
                {t("estimate.heading")} #{estimate.estimateNumber}
              </h1>
            </div>
            {estimate.title && (
              <p
                className="text-sm ml-8"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                {estimate.title}
              </p>
            )}
          </div>
          <PortalStatusBadge status={estimate.status} />
        </div>

        {/* Meta row */}
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-xs"
          style={{ color: "var(--portal-text-tertiary)" }}
        >
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {t("estimate.issued")} {formatShortDate(estimate.issueDate, locale)}
          </span>
          {estimate.expirationDate && (
            <span
              className="flex items-center gap-1.5"
              style={{
                color: isExpired
                  ? "var(--portal-error)"
                  : "var(--portal-text-tertiary)",
              }}
            >
              <Clock className="w-3.5 h-3.5" />
              {isExpired ? t("estimate.expired") : t("estimate.expires")}{" "}
              {formatShortDate(estimate.expirationDate, locale)}
            </span>
          )}
          {hasQuestions && (
            <span
              className="flex items-center gap-1.5"
              style={{ color: "var(--portal-accent)" }}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              {questions.length} question{questions.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── From / To Sections ─────────────────────────────────────────────── */}
      {(v.showFromSection && companyInfo) || (v.showToSection && clientInfo) ? (
        <div
          className="rounded-xl"
          style={{
            padding: "var(--portal-card-padding, 24px)",
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
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

      {/* ── Client Message ─────────────────────────────────────────────────── */}
      {estimate.clientMessage && (
        <div
          className="rounded-xl"
          style={{
            padding: "var(--portal-card-padding, 24px)",
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
          }}
        >
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            {t("estimate.providerMessage")}
          </h2>
          <p
            className="text-sm whitespace-pre-wrap"
            style={{
              color: "var(--portal-text-secondary)",
              lineHeight: "1.6",
            }}
          >
            {estimate.clientMessage}
          </p>
        </div>
      )}

      {/* ── Line Items ─────────────────────────────────────────────────────── */}
      <div>
        <h2
          className="text-sm font-medium uppercase tracking-wider mb-3"
          style={{ color: "var(--portal-text-tertiary)" }}
        >
          {t("estimate.lineItems")}
        </h2>
        <div className="space-y-2">
          {standardItems.map((item) => (
            <PortalLineItemCard
              key={item.id}
              name={item.name}
              description={v.showDescriptions ? item.description : null}
              quantity={v.showQuantities ? item.quantity : undefined}
              unit={item.unit}
              unitPrice={v.showUnitPrices ? item.unitPrice : undefined}
              lineTotal={v.showLineTotals ? item.lineTotal : undefined}
              isOptional={false}
              hasQuestions={lineItemIdsWithQuestions.has(item.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Optional Items ─────────────────────────────────────────────────── */}
      {optionalItems.length > 0 && (
        <div>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            {t("estimate.optionalItems")}
          </h2>
          <div className="space-y-2">
            {optionalItems.map((item) => (
              <PortalLineItemCard
                key={item.id}
                name={item.name}
                description={v.showDescriptions ? item.description : null}
                quantity={v.showQuantities ? item.quantity : undefined}
                unit={item.unit}
                unitPrice={v.showUnitPrices ? item.unitPrice : undefined}
                lineTotal={v.showLineTotals ? item.lineTotal : undefined}
                isOptional={true}
                hasQuestions={lineItemIdsWithQuestions.has(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Totals ─────────────────────────────────────────────────────────── */}
      <div
        className="rounded-xl"
        style={{
          padding: "var(--portal-card-padding, 24px)",
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
        }}
      >
        <div className="space-y-3">
          {/* Subtotal */}
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: "var(--portal-text-secondary)" }}>
              {t("estimate.subtotal")}
            </span>
            <span style={{ color: "var(--portal-text)" }}>
              {formatCurrency(estimate.subtotal)}
            </span>
          </div>

          {/* Discount */}
          {v.showDiscount && estimate.discountAmount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span
                className="flex items-center gap-1.5"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                <Tag className="w-3.5 h-3.5" />
                {t("estimate.discount")}
                {estimate.discountType === "percentage" &&
                  estimate.discountValue != null && (
                    <span className="text-xs">({estimate.discountValue}%)</span>
                  )}
              </span>
              <span style={{ color: "var(--portal-success)" }}>
                -{formatCurrency(estimate.discountAmount)}
              </span>
            </div>
          )}

          {/* Tax */}
          {v.showTax && estimate.taxAmount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span
                className="flex items-center gap-1.5"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                <Percent className="w-3.5 h-3.5" />
                {t("estimate.tax")}
                {estimate.taxRate != null && (
                  <span className="text-xs">
                    ({(estimate.taxRate * 100).toFixed(2)}%)
                  </span>
                )}
              </span>
              <span style={{ color: "var(--portal-text)" }}>
                {formatCurrency(estimate.taxAmount)}
              </span>
            </div>
          )}

          {/* Divider */}
          <div
            style={{
              borderTop: "1px solid var(--portal-border)",
              margin: "4px 0",
            }}
          />

          {/* Total */}
          <div className="flex items-center justify-between">
            <span
              className="text-base font-semibold"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
                color: "var(--portal-text)",
              }}
            >
              {t("estimate.total")}
            </span>
            <span
              className="text-lg font-bold"
              style={{
                fontFamily: "var(--portal-heading-font)",
                color: "var(--portal-text)",
              }}
            >
              {formatCurrency(estimate.total)}
            </span>
          </div>

          {/* Deposit */}
          {estimate.depositAmount != null && estimate.depositAmount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span
                className="flex items-center gap-1.5"
                style={{ color: "var(--portal-warning)" }}
              >
                <Receipt className="w-3.5 h-3.5" />
                {t("estimate.depositRequired")}
              </span>
              <span style={{ color: "var(--portal-warning)" }}>
                {formatCurrency(estimate.depositAmount)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Terms & Conditions ──────────────────────────────────────────────── */}
      {v.showTerms && estimate.terms && (
        <div
          className="rounded-xl"
          style={{
            padding: "var(--portal-card-padding, 24px)",
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
          }}
        >
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            {t("estimate.termsConditions")}
          </h2>
          <p
            className="text-sm whitespace-pre-wrap"
            style={{
              color: "var(--portal-text-secondary)",
              lineHeight: "1.6",
            }}
          >
            {estimate.terms}
          </p>
        </div>
      )}
    </div>
  );
}
