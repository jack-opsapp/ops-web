"use client";

import { Calendar, FileText, Clock, HelpCircle, Tag, Percent, Receipt } from "lucide-react";
import { PortalStatusBadge } from "./portal-status-badge";
import { PortalLineItemCard } from "./portal-line-item-card";
import { formatCurrency } from "@/lib/types/pipeline";
import type { Estimate, LineItem } from "@/lib/types/pipeline";
import type { LineItemQuestion } from "@/lib/types/portal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalEstimateView({
  estimate,
  questions = [],
  lineItemIdsWithQuestions = new Set(),
}: PortalEstimateViewProps) {
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
                Estimate #{estimate.estimateNumber}
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
            Issued {formatShortDate(estimate.issueDate)}
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
              {isExpired ? "Expired" : "Expires"}{" "}
              {formatShortDate(estimate.expirationDate)}
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
            Message from your provider
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
          Line Items
        </h2>
        <div className="space-y-2">
          {standardItems.map((item) => (
            <PortalLineItemCard
              key={item.id}
              name={item.name}
              description={item.description}
              quantity={item.quantity}
              unit={item.unit}
              unitPrice={item.unitPrice}
              lineTotal={item.lineTotal}
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
            Optional Items
          </h2>
          <div className="space-y-2">
            {optionalItems.map((item) => (
              <PortalLineItemCard
                key={item.id}
                name={item.name}
                description={item.description}
                quantity={item.quantity}
                unit={item.unit}
                unitPrice={item.unitPrice}
                lineTotal={item.lineTotal}
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
              Subtotal
            </span>
            <span style={{ color: "var(--portal-text)" }}>
              {formatCurrency(estimate.subtotal)}
            </span>
          </div>

          {/* Discount */}
          {estimate.discountAmount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span
                className="flex items-center gap-1.5"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                <Tag className="w-3.5 h-3.5" />
                Discount
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
          {estimate.taxAmount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span
                className="flex items-center gap-1.5"
                style={{ color: "var(--portal-text-secondary)" }}
              >
                <Percent className="w-3.5 h-3.5" />
                Tax
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
              Total
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
                Deposit required
              </span>
              <span style={{ color: "var(--portal-warning)" }}>
                {formatCurrency(estimate.depositAmount)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Terms & Conditions ──────────────────────────────────────────────── */}
      {estimate.terms && (
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
            Terms &amp; Conditions
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
