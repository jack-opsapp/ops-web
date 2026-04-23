"use client";

import { cn } from "@/lib/utils/cn";
import { formatPeriodDisplay } from "@/lib/types/expense-approval";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExpenseFilterTab = "review" | "history";

interface ExpenseFiltersProps {
  /** "review" = needs review, "history" = past decisions */
  activeTab: ExpenseFilterTab;
  onTabChange: (tab: ExpenseFilterTab) => void;
  /** Available period keys e.g. ["2026-03", "2026-02", "2026-01"] */
  periods: string[];
  /** Currently selected period key */
  activePeriod: string;
  onPeriodChange: (period: string) => void;
  /** Count of batches needing review (for badge) */
  reviewCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpenseFilters({
  activeTab,
  onTabChange,
  periods,
  activePeriod,
  onPeriodChange,
  reviewCount,
}: ExpenseFiltersProps) {
  return (
    <div className="space-y-2">
      {/* Tab toggle */}
      <div className="flex bg-glass glass-surface border border-border rounded-lg p-0.5">
        <button
          onClick={() => onTabChange("review")}
          className={cn(
            "px-3 py-1 rounded font-mohave text-body-sm uppercase transition-colors flex items-center gap-1.5",
            activeTab === "review"
              ? "bg-[rgba(255,255,255,0.08)] text-text"
              : "text-text-3 hover:text-text-2"
          )}
        >
          NEEDS REVIEW
          {reviewCount > 0 && (
            <span className="font-mono text-micro bg-[rgba(129,149,181,0.2)] text-[#D99A3E] px-1.5 py-0.5 rounded-full">
              {reviewCount}
            </span>
          )}
        </button>
        <button
          onClick={() => onTabChange("history")}
          className={cn(
            "px-3 py-1 rounded font-mohave text-body-sm uppercase transition-colors",
            activeTab === "history"
              ? "bg-[rgba(255,255,255,0.08)] text-text"
              : "text-text-3 hover:text-text-2"
          )}
        >
          HISTORY
        </button>
      </div>

      {/* Period pills — horizontal scroll */}
      {periods.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {periods.map((period) => (
            <button
              key={period}
              onClick={() => onPeriodChange(period)}
              className={cn(
                "px-2.5 py-1 rounded font-mono text-[11px] uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors border",
                activePeriod === period
                  ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.15)]"
                  : "text-text-3 border-transparent hover:text-text-2 hover:border-border"
              )}
            >
              {formatPeriodDisplay(period)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
