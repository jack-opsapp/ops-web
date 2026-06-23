"use client";

/**
 * FilterChips + DismissChip — the shared DESIGN.md §9 tag-tier filter row.
 *
 * Spec: JetBrains Mono 11 / 0.12em tracked / uppercase, 4px radius, 24px
 * (h-3) height; inactive text-3 with hairline border, active text on
 * rgba(255,255,255,0.08) with the spec's 0.18 active border (no named
 * token exists for it). DismissChip is the rose applied-filter variant
 * dropped by drill-downs.
 *
 * Promoted from the Books workbar (P3.1) for app-wide reuse.
 */

import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface FilterChipOption<T extends string = string> {
  value: T;
  label: string;
}

export function FilterChips<T extends string = string>({
  options,
  value,
  onChange,
  className,
}: {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-[6px]", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-3 items-center rounded-chip border px-1",
              "font-mono text-micro font-medium uppercase tracking-[0.12em]",
              "transition-colors duration-150 ease-smooth",
              active
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Rose applied-filter chip with a dismiss ×— dropped by drill-downs. */
export function DismissChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className={cn(
        "inline-flex h-3 items-center gap-[6px] rounded-chip border border-rose-line bg-rose-soft px-1",
        "font-mono text-micro font-medium uppercase tracking-[0.12em] text-rose",
        "transition-colors duration-150 ease-smooth hover:border-rose",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
      )}
    >
      {label}
      <X className="h-[10px] w-[10px]" />
    </button>
  );
}
