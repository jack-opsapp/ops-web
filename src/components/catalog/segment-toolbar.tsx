"use client";

/**
 * Catalog working-area chrome — the segment control, filter chips, and drill
 * chip. Visual sibling of the approved Books segment toolbar
 * (src/components/books/segment-toolbar.tsx); kept catalog-local so the two
 * surfaces can evolve independently.
 */

import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export function CatalogSegmentControl<T extends string = string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex gap-[2px] rounded-[7px] border border-border p-[3px]" role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-[18px] py-[6px]",
              "font-cakemono text-[13px] font-light uppercase tracking-[0.02em]",
              "border transition-colors duration-150 ease-smooth",
              active
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text-2",
              "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
            )}
          >
            {opt.label}
            {typeof opt.count === "number" && (
              <span className="font-mono text-[11px] text-text-3 tabular-nums">
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface FilterChipOption<T extends string = string> {
  value: T;
  label: string;
}

export function FilterChips<T extends string = string>({
  options,
  value,
  onChange,
}: {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-[6px]">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[4px] border px-[10px] py-[4px]",
              "font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
              "transition-colors duration-150 ease-smooth",
              active
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
              "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Rose drill chip dropped by a supply-strip drill ("BELOW THRESHOLD ×"). */
export function DrillChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className={cn(
        "inline-flex items-center gap-[6px] rounded-[4px] border border-rose-line bg-rose-soft px-[10px] py-[4px]",
        "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-rose",
        "transition-colors duration-150 ease-smooth hover:bg-[rgba(181,130,137,0.2)]",
        "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
      )}
    >
      {label}
      <X className="h-[10px] w-[10px]" />
    </button>
  );
}
