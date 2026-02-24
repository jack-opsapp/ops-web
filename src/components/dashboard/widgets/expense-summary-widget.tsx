"use client";

import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExpenseSummaryWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PeriodKey = "this-month" | "last-month" | "ytd";

const PERIOD_LABELS: Record<PeriodKey, string> = {
  "this-month": "This Month",
  "last-month": "Last Month",
  ytd: "Year to Date",
};

/** Placeholder expense categories shown in LG mode */
const PLACEHOLDER_CATEGORIES = [
  { label: "Materials", color: "bg-ops-accent" },
  { label: "Labor", color: "bg-ops-amber" },
  { label: "Overhead", color: "bg-text-disabled" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpenseSummaryWidget({
  size,
  config,
}: ExpenseSummaryWidgetProps) {
  const period = (config.period as PeriodKey) ?? "this-month";
  const periodLabel = PERIOD_LABELS[period] ?? "This Month";

  // ── MD: Centered placeholder message ────────────────────────────────────
  if (size === "md") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Receipt className="w-[12px] h-[12px] text-text-tertiary" />
              <CardTitle className="text-card-subtitle">Expenses</CardTitle>
            </div>
            <span className="font-mono text-[11px] text-text-disabled">
              {periodLabel}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 flex flex-col items-center justify-center min-h-0">
          <Receipt className="w-[28px] h-[28px] text-text-disabled mb-2" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            Connect accounting to see expenses
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── LG: Placeholder with category breakdown ─────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Receipt className="w-[12px] h-[12px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">
              Expense Summary
            </CardTitle>
          </div>
          <span className="font-mono text-[11px] text-text-disabled">
            {periodLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 flex flex-col min-h-0">
        {/* Centered placeholder message */}
        <div className="flex flex-col items-center justify-center py-3">
          <Receipt className="w-[28px] h-[28px] text-text-disabled mb-2" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            Connect accounting to see expenses
          </p>
        </div>

        {/* Category breakdown placeholders */}
        <div className="mt-auto pt-2 border-t border-border">
          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
            Categories
          </span>
          <div className="space-y-[6px] mt-1.5">
            {PLACEHOLDER_CATEGORIES.map((cat) => (
              <div key={cat.label} className="flex items-center gap-1.5">
                <span className="font-mohave text-body-sm text-text-disabled flex-1">
                  {cat.label}
                </span>
                <span className="font-mono text-[11px] text-text-disabled">
                  $0.00
                </span>
                {/* Empty bar */}
                <div className="w-[60px] h-[6px] rounded-full bg-[rgba(255,255,255,0.04)] overflow-hidden shrink-0">
                  <div
                    className={`h-full rounded-full ${cat.color} opacity-20`}
                    style={{ width: "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
