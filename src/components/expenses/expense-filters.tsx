"use client";

import { useEffect, useRef } from "react";
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
 * left→right, and the newest month docks at the far right — the strip opens
 * scrolled to that end so the newest (default-selected) period is in view. The
 * NEEDS-REVIEW / HISTORY toggle was retired: all statuses render in one list.
 */
export function ExpenseFilters({
  periods,
  activePeriod,
  onPeriodChange,
}: ExpenseFiltersProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Open scrolled to the right end so the newest chip is visible. A direct
  // scrollLeft assignment is an instant jump — no smooth-scroll animation, so
  // it already honors prefers-reduced-motion with nothing to gate.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [periods]);

  if (periods.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      {periods.map((period) => (
        <button
          key={period}
          onClick={() => onPeriodChange(period)}
          className={cn(
            "px-2.5 py-1 rounded font-mono text-micro uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors border",
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
