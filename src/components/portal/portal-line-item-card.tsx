"use client";

import { HelpCircle } from "lucide-react";
import { formatCurrency } from "@/lib/types/pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalLineItemCardProps {
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  hasQuestions: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalLineItemCard({
  name,
  description,
  quantity,
  unit,
  unitPrice,
  lineTotal,
  isOptional,
  hasQuestions,
}: PortalLineItemCardProps) {
  return (
    <div
      className="rounded-lg"
      style={{
        padding: "16px",
        backgroundColor: "var(--portal-card)",
        border: "1px solid var(--portal-border)",
      }}
    >
      {/* Header row: name + badges + total */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4
              className="text-sm font-semibold"
              style={{ color: "var(--portal-text)" }}
            >
              {name}
            </h4>
            {isOptional && (
              <span
                className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: "rgba(196,168,104,0.15)",
                  color: "#C4A868",
                }}
              >
                Optional
              </span>
            )}
            {hasQuestions && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: "rgba(65,115,148,0.15)",
                  color: "var(--portal-accent)",
                }}
                title="This item has questions for you"
              >
                <HelpCircle className="w-3 h-3" />
              </span>
            )}
          </div>
          {description && (
            <p
              className="text-xs mt-1 line-clamp-2"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              {description}
            </p>
          )}
        </div>
        <span
          className="text-sm font-semibold shrink-0"
          style={{ color: "var(--portal-text)" }}
        >
          {formatCurrency(lineTotal)}
        </span>
      </div>

      {/* Quantity x Price row */}
      <div
        className="flex items-center gap-2 mt-2 text-xs"
        style={{ color: "var(--portal-text-tertiary)" }}
      >
        <span>
          {quantity} {unit}
        </span>
        <span style={{ color: "var(--portal-border-strong, var(--portal-border))" }}>
          &times;
        </span>
        <span>{formatCurrency(unitPrice)}</span>
      </div>
    </div>
  );
}
