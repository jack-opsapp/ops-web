"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDictionary } from "@/i18n/client";
import { BOOKS_PERIODS, type BooksPeriod } from "@/lib/api/services/books-service";
import { cn } from "@/lib/utils/cn";

/**
 * Period selector for the Books ledger strip — the iOS PeriodPill adapted
 * to desktop (8 windows; NET / CASH FLOW / JOBS re-scope, A/R holds).
 */
export function PeriodPill({
  value,
  onChange,
}: {
  value: BooksPeriod;
  onChange: (period: BooksPeriod) => void;
}) {
  const { t } = useDictionary("books");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-[24px] items-center gap-1 rounded-[4px] px-1",
            "border border-border font-mono text-micro uppercase tracking-[0.12em]",
            "text-text-2 tabular-nums transition-colors duration-150 ease-smooth",
            "hover:bg-surface-hover hover:text-text",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
          )}
        >
          {t(`period.${value}`)}
          <span aria-hidden className="text-micro text-text-mute">
            &#9662;
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[176px]">
        {BOOKS_PERIODS.map((period) => (
          <DropdownMenuItem
            key={period}
            onSelect={() => onChange(period)}
            className={cn(
              "font-mono text-micro uppercase tracking-[0.12em]",
              period === value ? "text-text" : "text-text-3",
            )}
          >
            {t(`period.${period}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
