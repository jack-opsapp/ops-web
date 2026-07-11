"use client";

import { cn } from "@/lib/utils/cn";
import { formatPeriodDisplay } from "@/lib/types/expense-approval";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExpenseFiltersProps {
  /** Available period keys, oldest→newest e.g. ["2026-01", "2026-02", "2026-03"] */
  periods: string[];
  /** Currently selected period key */
  activePeriod: string;
  onPeriodChange: (period: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Month-chip strip for the expenses segment. Chips run oldest→newest,
 * left→right; the NEEDS-REVIEW / HISTORY toggle was retired — all statuses
 * render in one list (review sections above history).
 */
export function ExpenseFilters({
  periods,
  activePeriod,
  onPeriodChange,
}: ExpenseFiltersProps) {
  if (periods.length === 0) return null;

  return (
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
  );
}
